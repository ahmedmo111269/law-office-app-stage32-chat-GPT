import { STORES, SEARCHABLE_STORES } from '../core/constants.js';
import { fields } from '../db/schema.js';
import { repo, transaction } from '../db/repositories.js';
import { tokenizeRecord } from '../core/text.js';

/**
 * Derived inverted index: searchIndex has one posting per
 * (store, token, recordId); searchDoc retains the tokens for each document so
 * edits and deletes can remove exactly the previous postings.
 *
 * Both stores are excluded from backups. A rebuild never deletes source rows.
 */
const SEARCHABLE = new Set(SEARCHABLE_STORES);
const MAX_TOKENS_PER_WRITE = 80;
const DOC_STORE = STORES.searchDoc;
const INDEX_STORE = STORES.searchIndex;
const DIRTY_KEY = ['__indexMeta', 0];

export const isSearchable = (storeName) => SEARCHABLE.has(storeName);

/** Persist this sentinel in the SAME transaction as a bulk source mutation.
 * Otherwise a crash after a same-row-count bulkPut could make stale tokens look
 * complete when the next browser session compares only document counts. */
export function recordIndexDirty(tx) {
  tx.objectStore(DOC_STORE).put({ store: DIRTY_KEY[0], recordId: DIRTY_KEY[1], tokens: [], dirty: 1 });
}

export function tokensFor(storeName, record) {
  const declared = fields[storeName] || [];
  return tokenizeRecord(record, declared).slice(0, MAX_TOKENS_PER_WRITE);
}

/** Called inside a transaction that includes BOTH derived stores. */
export function writePostings(tx, storeName, record, recordId) {
  if (!isSearchable(storeName)) return 0;
  if (!tx.objectStoreNames.contains(INDEX_STORE)) return 0;
  const id = Number(recordId);
  const tokens = tokensFor(storeName, record);
  const indexStore = tx.objectStore(INDEX_STORE);
  const docStore = tx.objectStoreNames.contains(DOC_STORE) ? tx.objectStore(DOC_STORE) : null;

  const commit = () => {
    for (const token of tokens) indexStore.put({ store: storeName, token, recordId: id });
    docStore?.put({ store: storeName, recordId: id, tokens });
  };
  if (recordId == null || Number.isNaN(id)) { commit(); return tokens.length; }

  const known = docStore?.get([storeName, id]) || null;
  if (!known) { commit(); return tokens.length; }
  known.onsuccess = () => {
    const previous = known.result?.tokens;
    if (Array.isArray(previous)) {
      for (const token of previous) {
        if (!tokens.includes(token)) indexStore.delete([storeName, token, id]);
      }
    }
    commit();
  };
  known.onerror = () => commit();
  return tokens.length;
}

/** Removes the source document's postings in the same transaction as its delete. */
export function deletePostings(tx, storeName, recordId) {
  if (!isSearchable(storeName)) return;
  if (!tx.objectStoreNames.contains(INDEX_STORE)) return;
  const id = Number(recordId);
  const indexStore = tx.objectStore(INDEX_STORE);
  const docStore = tx.objectStoreNames.contains(DOC_STORE) ? tx.objectStore(DOC_STORE) : null;
  if (!docStore) return;
  const known = docStore.get([storeName, id]);
  known.onsuccess = () => {
    const previous = known.result?.tokens;
    if (Array.isArray(previous)) {
      for (const token of previous) indexStore.delete([storeName, token, id]);
    }
    docStore.delete([storeName, id]);
  };
  known.onerror = () => { docStore.delete([storeName, id]); };
}

/** A bounded token-prefix range, optionally continuing after the last key. */
function tokenRange(storeName, token, afterKey = null) {
  return IDBKeyRange.bound(
    [storeName, token],
    afterKey || [storeName, `${token}￿`],
    false,
    afterKey != null
  );
}

export async function countTokenMatches(storeName, token) {
  return repo(INDEX_STORE).count(tokenRange(storeName, token));
}

/** Keyset page of postings: no fixed 50k-result cutoff or offset scan. */
export async function lookupTokenPage(storeName, token, { afterKey = null, limit = 1000 } = {}) {
  return repo(INDEX_STORE).keys({ query: tokenRange(storeName, token, afterKey), direction: 'prev', limit });
}

/** Convenience lookup for small/debug queries; the search path pages instead. */
export async function lookupToken(storeName, token, { limit = 20000 } = {}) {
  const keys = await lookupTokenPage(storeName, token, { limit });
  return keys.map(key => Number(key[2]));
}

export async function countPostings() {
  try { return await repo(INDEX_STORE).count(); }
  catch { return 0; }
}

/**
 * A nonempty posting store is NOT proof of a complete index: a stopped rebuild,
 * an older v15 DB, or a bulk import can leave most rows invisible. Count the
 * source rows and searchDoc rows per store in ONE readonly snapshot. These are
 * IndexedDB count requests, not an unbounded read of record values.
 */
export async function searchIndexCoverage() {
  const counts = Object.fromEntries(SEARCHABLE_STORES.map(name => [name, { rows: 0, documents: 0 }]));
  let postings = 0;
  let persistedDirty = false;
  await transaction([...SEARCHABLE_STORES, DOC_STORE, INDEX_STORE], 'readonly', tx => {
    const documents = tx.objectStore(DOC_STORE);
    const stateRequest = documents.get(DIRTY_KEY);
    stateRequest.onsuccess = () => { persistedDirty = Boolean(stateRequest.result?.dirty); };
    const postingRequest = tx.objectStore(INDEX_STORE).count();
    postingRequest.onsuccess = () => { postings = postingRequest.result; };
    for (const name of SEARCHABLE_STORES) {
      const sourceRequest = tx.objectStore(name).count();
      sourceRequest.onsuccess = () => { counts[name].rows = sourceRequest.result; };
      // For an array key [store, recordId], [] sorts after every numeric id.
      const range = IDBKeyRange.bound([name], [name, []]);
      const documentRequest = documents.count(range);
      documentRequest.onsuccess = () => { counts[name].documents = documentRequest.result; };
    }
  });
  const rows = Object.values(counts).reduce((sum, entry) => sum + entry.rows, 0);
  const documents = Object.values(counts).reduce((sum, entry) => sum + entry.documents, 0);
  const gaps = Object.entries(counts).filter(([, count]) => count.rows !== count.documents)
    .map(([name, count]) => ({ store: name, ...count }));
  return { complete: gaps.length === 0 && !persistedDirty, rows, documents, postings, gaps, persistedDirty };
}

// The epoch invalidates a cached search readiness result when a bulk import,
// clear, rebuild start, or rebuild completion changes the derived index.
let indexEpoch = 0;
let indexDirty = false;
export function markIndexStale() { indexDirty = true; indexEpoch += 1; }
export function searchIndexEpoch() { return indexEpoch; }
export function indexIsDirty() { return indexDirty; }

/**
 * Rebuild in bounded readwrite transactions. Reading the CURRENT source rows
 * and writing postings in the SAME transaction serialises concurrent tracked
 * edits/deletes with the builder; neither stale snapshots nor duplicate `add`
 * keys can resurrect old search tokens. Each chunk yields to the UI.
 */
async function buildIndex({ onProgress, chunkSize = 5000, signal } = {}) {
  const started = Date.now();
  const size = Number.isFinite(Number(chunkSize)) ? Math.max(1, Math.floor(Number(chunkSize))) : 5000;
  markIndexStale();
  const startEpoch = indexEpoch;
  await transaction([INDEX_STORE, DOC_STORE], 'readwrite', tx => {
    tx.objectStore(INDEX_STORE).clear();
    tx.objectStore(DOC_STORE).clear();
  });

  let indexed = 0;
  let rows = 0;
  for (let i = 0; i < SEARCHABLE_STORES.length; i += 1) {
    const name = SEARCHABLE_STORES[i];
    if (signal?.aborted) break;
    let afterKey = null;
    for (;;) {
      if (signal?.aborted) break;
      const batch = { seen: 0, indexed: 0, lastKey: afterKey };
      // eslint-disable-next-line no-await-in-loop
      await transaction([name, INDEX_STORE, DOC_STORE], 'readwrite', tx => {
        const range = afterKey == null ? undefined : IDBKeyRange.lowerBound(afterKey, true);
        const request = tx.objectStore(name).openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          batch.seen += 1;
          batch.lastKey = cursor.primaryKey;
          if (cursor.value?.id != null) {
            batch.indexed += writePostings(tx, name, cursor.value, cursor.primaryKey);
            rows += 1;
          }
          if (batch.seen < size) cursor.continue();
        };
      });
      indexed += batch.indexed;
      afterKey = batch.lastKey;
      if (batch.seen < size) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    onProgress?.({ store: name, index: i + 1, total: SEARCHABLE_STORES.length, indexed, rows });
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const aborted = Boolean(signal?.aborted);
  if (!aborted && startEpoch === indexEpoch) {
    // A bulk write during the rebuild keeps the index dirty, even if that row
    // happened to land behind a cursor in a previous chunk.
    indexDirty = false;
    indexEpoch += 1;
  }
  return { indexed, rows, durationMs: Date.now() - started, aborted };
}

let rebuildPromise = null;
export function rebuildInProgress() { return Boolean(rebuildPromise); }

/** Build only when coverage is missing or an unindexed bulk write occurred. */
export function ensureSearchIndex({ onProgress, chunkSize = 2000 } = {}) {
  if (rebuildPromise) return rebuildPromise;
  const run = (async () => {
    const coverage = await searchIndexCoverage();
    if (coverage.complete && !indexDirty) return { skipped: true, indexed: coverage.postings, rows: coverage.rows };
    return buildIndex({ onProgress, chunkSize });
  })();
  rebuildPromise = run;
  return run.finally(() => { if (rebuildPromise === run) rebuildPromise = null; });
}

/** Always rebuild, waiting for an existing run (including an initial probe). */
export async function forceRebuildSearchIndex(options = {}) {
  if (rebuildPromise) {
    try { await rebuildPromise; } catch { /* this fresh rebuild supersedes the failed one */ }
  }
  const run = buildIndex(options);
  rebuildPromise = run;
  try { return await run; }
  finally { if (rebuildPromise === run) rebuildPromise = null; }
}

/** Backwards-compatible public name; direct rebuilds are serialised too. */
export const rebuildSearchIndex = forceRebuildSearchIndex;
