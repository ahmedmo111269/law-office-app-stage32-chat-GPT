import { STORES } from '../core/constants.js';
import { repo } from '../db/repositories.js';
import { escapeHtml } from '../core/utils.js';
import { tokenizeQuery } from '../core/text.js';
import { lookupTokenPage, countTokenMatches, tokensFor, searchIndexCoverage, isSearchable, rebuildInProgress, indexIsDirty, searchIndexEpoch } from './index-builder.js';

/**
 * Global search, backed by the inverted index in `searchIndex`.
 *
 * For AND queries, the rarest query-token range supplies candidates; bounded
 * keyset pages are checked against the document token lists. There is no fixed
 * 50,000-posting cutoff and no unbounded getAll(). Deep pages of very common
 * tokens may require more I/O; each individual read remains bounded.
 *
 * If the derived index is incomplete, search falls back to a clearly labelled
 * scan of recent records. A missing result while degraded is not conclusive.
 */

const LABELS = {
  clients: 'العملاء',
  opponents: 'الخصوم',
  powerOfAttorneys: 'التوكيلات',
  cases: 'القضايا',
  hearings: 'الجلسات',
  procedures: 'الإجراءات',
  judgments: 'الأحكام',
  appeals: 'الطعون',
  caseTasks: 'المهام',
  announcements: 'الإعلانات',
  executionFiles: 'ملفات التنفيذ',
  executionProcedures: 'إجراءات التنفيذ',
  collections: 'التحصيلات',
  financialRecords: 'الحركات المالية',
  feeAgreements: 'اتفاقات الأتعاب',
  experts: 'الخبراء',
  expertSessions: 'جلسات الخبراء',
  courtsAuthorities: 'المحاكم والجهات',
  settlements: 'التسويات',
  settlementSessions: 'جلسات التسوية',
  followUps: 'المتابعات',
  contacts: 'الاتصالات',
  templates: 'القوالب',
  laborDetails: 'الملفات العمالية',
  familyDetails: 'ملفات النفقة',
  administrativeDetails: 'المنازعات الإدارية',
  criminalDetails: 'الملفات الجنائية',
  teamMembers: 'فريق المكتب',
  caseRelations: 'علاقات القضايا',
  caseEvents: 'أحداث القضايا'
};

export const SEARCH_STORES = Object.freeze(Object.keys(LABELS).filter((name) => STORES[name]));

const TOKEN_PAGE_SIZE = 1000;
const FALLBACK_SCAN_LIMIT = 2000;

function titleFor(store, row) {
  if (store === 'clients') return row.fullName || `عميل #${row.id}`;
  if (store === 'opponents') return row.name || `خصم #${row.id}`;
  if (store === 'cases') return row.caseNumber ? `قضية ${row.caseNumber}/${row.caseYear || ''}` : `قضية #${row.id}`;
  if (store === 'courtsAuthorities') return row.name || `جهة #${row.id}`;
  if (store === 'powerOfAttorneys') return `توكيل ${row.number || ''}/${row.year || ''}`;
  if (store === 'judgments') return `حكم ${row.number || ''}/${row.year || ''}`;
  if (store === 'appeals') return `طعن ${row.number || ''}/${row.year || ''}`;
  if (store === 'announcements') return `إعلان ${row.announcementNumber || ''}/${row.announcementYear || ''}`;
  if (store === 'executionFiles') return `تنفيذ ${row.executionNumber || ''}/${row.executionYear || ''}`;
  if (store === 'templates') return row.name || `قالب #${row.id}`;
  if (store === 'teamMembers') return row.name || `عضو #${row.id}`;
  return row.title || row.description || row.type || row.name || row.subject || `${LABELS[store] || store} #${row.id}`;
}

function snippetFor(store, row) {
  const parts = [
    row.subject, row.description, row.notes, row.result, row.summary,
    row.address, row.reference, row.title
  ].filter(Boolean);
  const extra = parts.length ? ` — ${parts[0]}` : '';
  return `${LABELS[store] || store}${extra ? ` — ${String(parts[0]).slice(0, 90)}` : ''}`;
}

function toResult(store, row) {
  return {
    store,
    id: row.id,
    title: titleFor(store, row),
    label: LABELS[store] || store,
    row
  };
}

/** Returns up to `limit` AND-matching IDs in deterministic posting-key order. */
async function matchIds(storeName, tokens, limit) {
  if (!tokens.length) return [];
  const estimates = await Promise.all(tokens.map(async token => ({
    token,
    count: await countTokenMatches(storeName, token)
  })));
  if (estimates.some(entry => entry.count === 0)) return [];
  const primary = estimates.reduce((best, entry) => entry.count < best.count ? entry : best);
  const size = Math.max(1, Math.min(TOKEN_PAGE_SIZE, primary.count, Math.max(50, limit * 2)));
  const matched = [];
  const seen = new Set();
  let afterKey = null;

  while (matched.length < limit) {
    // eslint-disable-next-line no-await-in-loop
    const keys = await lookupTokenPage(storeName, primary.token, { afterKey, limit: size });
    if (!keys.length) break;
    afterKey = keys[keys.length - 1];
    const candidates = [];
    for (const key of keys) {
      const id = Number(key[2]);
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(id);
    }
    let docsById = null;
    if (tokens.length > 1 && candidates.length) {
      // The document list is indexed by [store, recordId]; checking it avoids
      // scanning very common secondary token ranges or losing older matches.
      // eslint-disable-next-line no-await-in-loop
      const docs = await repo(STORES.searchDoc).getMany(candidates.map(id => [storeName, id]));
      docsById = new Map(docs.map(doc => [Number(doc.recordId), doc.tokens || []]));
    }
    for (const id of candidates) {
      if (docsById && !tokens.every(token => docsById.get(id)?.some(word => word.startsWith(token)))) continue;
      matched.push(id);
      if (matched.length >= limit) break;
    }
    if (keys.length < size) break;
  }
  return matched;
}

/** Last-resort path when the inverted index is empty. */
async function fallbackMatch(storeName, tokens, limit) {
  const repository = repo(STORES[storeName]);
  const hits = [];
  await repository.scan({
    direction: 'prev',
    limit: FALLBACK_SCAN_LIMIT,
    onRow: (row) => {
      if (hits.length >= limit) return;
      const words = tokensFor(storeName, row);
      if (tokens.every(token => words.some(word => word.startsWith(token)))) hits.push(row);
    }
  });
  return hits;
}

async function searchStore(storeName, tokens, { limit, indexReady }) {
  if (!isSearchable(storeName) || !indexReady) {
    const rows = await fallbackMatch(storeName, tokens, limit);
    return { rows: rows.map((row) => toResult(storeName, row)), degraded: true };
  }
  const ids = await matchIds(storeName, tokens, limit);
  const rows = await repo(STORES[storeName]).getMany(ids);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const ordered = ids.map((id) => byId.get(Number(id))).filter(Boolean);
  return { rows: ordered.map((row) => toResult(storeName, row)), degraded: false };
}

let indexReadyCache = null;
let indexReadyAt = 0;
let cachedEpoch = -1;
export async function isIndexReady() {
  if (rebuildInProgress() || indexIsDirty()) return false;
  const epoch = searchIndexEpoch();
  const now = Date.now();
  if (indexReadyCache !== null && cachedEpoch === epoch && now - indexReadyAt < 30000) return indexReadyCache;
  try {
    const coverage = await searchIndexCoverage();
    // A bulk write or a rebuild may have started while the counts were in flight.
    if (rebuildInProgress() || indexIsDirty() || epoch !== searchIndexEpoch()) return false;
    indexReadyCache = coverage.complete;
    indexReadyAt = now;
    cachedEpoch = epoch;
    return indexReadyCache;
  } catch {
    return false;
  }
}
export function invalidateIndexCache() {
  indexReadyCache = null;
  indexReadyAt = 0;
  cachedEpoch = -1;
}

export async function globalSearch(query, { store = 'all', limit = 30, offset = 0 } = {}) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return { rows: [], hasMore: false, totalKnown: 0, degraded: false };

  const pageSize = Math.min(Math.max(Math.floor(Number(limit)) || 30, 1), 100);
  const requestedOffset = Number(offset);
  const start = Number.isSafeInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
  const selected = store === 'all'
    ? SEARCH_STORES
    : [store].filter((name) => LABELS[name]);
  if (!selected.length) return { rows: [], hasMore: false, totalKnown: 0, degraded: false };

  const indexReady = await isIndexReady();
  // A per-store prefix of (offset + pageSize + 1) is sufficient to make a
  // merged page without silently stopping pagination at the old 200-row cap.
  const perStore = start + pageSize + 1;
  const buckets = await Promise.all(
    selected.map(name => searchStore(name, tokens, { limit: perStore, indexReady }))
  );

  const unique = [];
  const seen = new Set();
  let degraded = false;
  buckets.forEach(bucket => {
    degraded = degraded || Boolean(bucket.degraded);
    for (const row of bucket.rows) {
      const key = `${row.store}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
  });

  // Preserve store order and posting-key order. Sorting only the fetched
  // prefix by relevance would reshuffle records across page boundaries and
  // produce duplicates or omissions on page 2+.
  const sliced = unique.slice(start, start + pageSize);
  return {
    rows: sliced,
    hasMore: unique.length > start + pageSize,
    totalKnown: unique.length,
    degraded
  };
}

export async function searchStorePage(store, query, { limit = 30, offset = 0 } = {}) {
  const result = await globalSearch(query, { store, limit, offset });
  return { rows: result.rows, hasMore: result.hasMore, totalKnown: result.totalKnown };
}

export function searchPerformanceNote() {
  return 'البحث يستخدم فهرسًا مقلوبًا وصفحات مفاتيح محدودة دون getAll(). الترتيب ثابت حسب القسم ومفاتيح الفهرس؛ الصفحات المتأخرة للكلمات الشائعة قد تستغرق وقتًا أطول.';
}

export { escapeHtml };
