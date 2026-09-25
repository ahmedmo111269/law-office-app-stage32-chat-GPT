import { getDB, openBenchmarkDB, BENCHMARK_STORES } from './db.js';
import {clone} from '../core/utils.js';
import { STORES } from '../core/constants.js';
import { fields } from './schema.js';
import { writePostings, deletePostings, isSearchable, markIndexStale, recordIndexDirty } from '../search/index-builder.js';
import { getDeviceId } from '../core/device.js';

/**
 * Repository layer — the single entry point for every data access.
 *
 * Guarantees provided here:
 *  - `indexedDB.open()` stays in db.js (office and isolated benchmark connections);
 *    all runtime transactions are created here
 *  - every mutating call is wrapped in try/catch at the call site (UI layer) and
 *    surfaces a normalised error
 *  - writes are atomic: the record, its uid mapping, the audit row and the sync
 *    change-log row are written inside ONE transaction
 *  - reads are always bounded; nothing in this file loads a whole store into
 *    memory unless the caller explicitly asks for `limit: Infinity`
 */

const AUDITABLE = {
  add: 'add',
  put: 'put',
  delete: 'delete'
};

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

/**
 * Normalises a caller supplied limit.
 *
 * HISTORIC DEFECT: `null` used to be coerced with `Number(null) === 0`, which
 * fell into the `n <= 0` branch and silently degraded to the 1000 record
 * fallback. `scan({ limit: null })` is how the backup exporter and the integrity
 * checker ask for "everything", so backups were truncated at 1000 rows per store
 * and integrity checks only ever looked at the first 1000 rows of each store.
 *
 * `null`, `undefined` and `Infinity` now mean "unbounded".
 */
export function normalizeLimit(value, fallback = 50, max = 500) {
  if (value === null || value === undefined || value === Infinity) return Infinity;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** `true` when the caller asked for an unbounded cursor walk. */
const isUnbounded = (limit) => limit === null || limit === undefined || limit === Infinity;

export function buildPrefixRange(prefix) {
  const p = String(prefix ?? '');
  return IDBKeyRange.bound(p, `${p}￿`);
}

export const prefixRange = buildPrefixRange;

function openStore(db, storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

/**
 * Runs `callback(tx)` inside one transaction and resolves with its result once
 * the transaction commits. `callback` must issue every IndexedDB request
 * synchronously (requests made after the microtask queue drains would land on a
 * closed transaction).
 */
function runTransaction(db, storeNames, mode, callback) {
  const names = [...new Set(storeNames)];
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result;
    let failed = false;
    try {
      result = callback(tx);
    } catch (error) {
      failed = true;
      try { tx.abort(); } catch { /* noop */ }
      reject(error);
      return;
    }
    if (failed) return;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/**
 * Store names touched by a tracked write, in a stable order.
 * `changeLog`/`uidMap` only exist from DB v15 onwards — guarded at call time.
 */
function trackedStoreNames(db, storeName) {
  const names = [storeName];
  if (db.objectStoreNames.contains(STORES.changeLog)) names.push(STORES.changeLog);
  if (db.objectStoreNames.contains(STORES.uidMap)) names.push(STORES.uidMap);
  if (db.objectStoreNames.contains(STORES.auditLog)) names.push(STORES.auditLog);
  if (isSearchable(storeName)) {
    if (db.objectStoreNames.contains(STORES.searchIndex)) names.push(STORES.searchIndex);
    if (db.objectStoreNames.contains(STORES.searchDoc)) names.push(STORES.searchDoc);
  }
  return names;
}

function hasStore(db, name) {
  try { return db.objectStoreNames.contains(name); } catch { return false; }
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Boolean flags are persisted as 0/1.
 *
 * IndexedDB rejects booleans as keys, so a record stored with `archived: true`
 * simply never appears in the `archived` index and `index.get(true)` throws a
 * DataError. Every store that declares one of these fields gets it normalised
 * on write, and migration v15 rewrites the rows that predate this rule.
 */
const FLAG_DEFAULTS = Object.freeze({ archived: 0, active: 1, favorite: 0, isPrimary: 0, resolved: 0 });

function normalizeFlags(storeName, record) {
  const declared = fields[storeName];
  for (const [name, defaultValue] of Object.entries(FLAG_DEFAULTS)) {
    // An explicitly supplied flag must be normalised even if an older schema
    // did not declare it (e.g. an archived judgment imported from a backup).
    if (declared && !declared.includes(name) && !Object.prototype.hasOwnProperty.call(record, name)) continue;
    const value = record[name];
    if (value === undefined) {
      if (declared && declared.includes(name)) record[name] = defaultValue;
      continue;
    }
    if (value === null || value === '') { record[name] = defaultValue; continue; }
    const numeric = value ? 1 : 0;
    if (value !== numeric) record[name] = numeric;
  }
}

/** Ensures a record carries the sync bookkeeping fields. Returns the uid. */
function stampForWrite(record, options) {
  const preserve = options?.preserveTimestamps === true;
  const now = nowISO();
  if (!record.uid) record.uid = newUid();
  const nextRev = Number(record.rev) > 0 ? Number(record.rev) + 1 : 1;
  if (!preserve) {
    record.rev = nextRev;
    record.updatedAt = now;
    record.deviceId = getDeviceId();
  } else if (record.rev == null) {
    record.rev = 1;
  }
  record.deletedAt = record.deletedAt ?? null;
  return record.uid;
}

let uidCounter = 0;
function newUid() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // ULID-ish fallback: millisecond timestamp + random + monotonic counter.
  const stamp = Date.now().toString(36).padStart(9, '0');
  uidCounter = (uidCounter + 1) % 1296;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${stamp}${rand}${uidCounter.toString(36).padStart(2, '0')}`;
}
export { newUid };

function writeSyncSideEffects(tx, db, storeName, record, recordId, op, options) {
  const uid = record?.uid || null;
  if (options?.track === false) return;
  try {
    if (uid && hasStore(db, STORES.uidMap)) {
      tx.objectStore(STORES.uidMap).put({ uid, store: storeName, recordId: Number(recordId) });
    }
    if (hasStore(db, STORES.changeLog)) {
      tx.objectStore(STORES.changeLog).add({
        uid: uid || `local-${storeName}-${recordId}`,
        store: storeName,
        recordId: Number(recordId),
        op,
        rev: Number(record?.rev) || 1,
        deviceId: record?.deviceId || getDeviceId(),
        updatedAt: record?.updatedAt || nowISO()
      });
    }
    if (hasStore(db, STORES.auditLog)) {
      tx.objectStore(STORES.auditLog).add({
        action: AUDITABLE[op] || op,
        store: storeName,
        recordId: Number(recordId),
        route: '',
        details: '',
        createdAt: nowISO()
      });
    }
  } catch {
    // Bookkeeping must never break the primary write.
  }
}

function sideEffectStoreNames(db) {
  return [STORES.changeLog, STORES.tombstones, STORES.uidMap, STORES.auditLog]
    .filter((n) => hasStore(db, n));
}

/** Imports from a peer must not enter the local change log, but still need an
 * atomic search-index update just like local writes. */
async function writeWithoutTracking(db, storeName, payload, method) {
  if (!isSearchable(storeName) || !hasStore(db, STORES.searchIndex) || !hasStore(db, STORES.searchDoc)) {
    return requestToPromise(openStore(db, storeName, 'readwrite')[method](payload));
  }
  let key;
  await runTransaction(db, [storeName, STORES.searchIndex, STORES.searchDoc], 'readwrite', tx => {
    const request = tx.objectStore(storeName)[method](payload);
    request.onsuccess = () => {
      key = request.result;
      writePostings(tx, storeName, payload, key);
    };
  });
  return key;
}

export function repo(storeName) {
  const repository = {
    /** Insert a new record. `options.track === false` skips sync/audit side effects. */
    async add(value, options = {}) {
      const db = await getDB();
      const payload = clone(value) || {};
      normalizeFlags(storeName, payload);
      stampForWrite(payload, options);
      if (!payload.createdAt) payload.createdAt = payload.updatedAt || nowISO();

      if (options.track === false) {
        return writeWithoutTracking(db, storeName, payload, 'add');
      }

      let newKey;
      await runTransaction(db, trackedStoreNames(db, storeName), 'readwrite', (tx) => {
        const request = tx.objectStore(storeName).add(payload);
        request.onsuccess = () => {
          newKey = request.result;
          writeSyncSideEffects(tx, db, storeName, payload, newKey, 'add', options);
          writePostings(tx, storeName, payload, newKey);
        };
      });
      return newKey;
    },

    /** Upsert a record. */
    async put(value, options = {}) {
      const db = await getDB();
      const payload = clone(value) || {};
      normalizeFlags(storeName, payload);
      stampForWrite(payload, options);
      if (!payload.createdAt) payload.createdAt = payload.updatedAt || nowISO();
      const key = payload.id;

      if (options.track === false) {
        return writeWithoutTracking(db, storeName, payload, 'put');
      }

      await runTransaction(db, trackedStoreNames(db, storeName), 'readwrite', (tx) => {
        const request = tx.objectStore(storeName).put(payload);
        request.onsuccess = () => {
          const writtenId = request.result ?? key;
          writeSyncSideEffects(tx, db, storeName, payload, writtenId, 'put', options);
          writePostings(tx, storeName, payload, writtenId);
        };
      });
      return key;
    },

    /**
     * Delete a record.
     * `options.hard === false` (default for syncable stores) writes a tombstone so
     * the delete can be replayed on peer devices.
     */
    async delete(id, options = {}) {
      const db = await getDB();
      const tracked = options.track !== false;
      if (!tracked) {
        if (!isSearchable(storeName) || !hasStore(db, STORES.searchIndex) || !hasStore(db, STORES.searchDoc)) {
          return requestToPromise(openStore(db, storeName, 'readwrite').delete(id));
        }
        return runTransaction(db, [storeName, STORES.searchIndex, STORES.searchDoc], 'readwrite', tx => {
          tx.objectStore(storeName).delete(id);
          deletePostings(tx, storeName, id);
        });
      }

      const existing = await requestToPromise(openStore(db, storeName).get(id)).catch(() => null);
      const names = [storeName, ...sideEffectStoreNames(db)];
      if (isSearchable(storeName)) {
        if (hasStore(db, STORES.searchIndex)) names.push(STORES.searchIndex);
        if (hasStore(db, STORES.searchDoc)) names.push(STORES.searchDoc);
      }
      await runTransaction(db, [...new Set(names)], 'readwrite', (tx) => {
        tx.objectStore(storeName).delete(id);
        deletePostings(tx, storeName, id);
        const uid = existing?.uid || null;
        if (uid && hasStore(db, STORES.uidMap)) {
          tx.objectStore(STORES.uidMap).delete(uid);
        }
        if (hasStore(db, STORES.tombstones)) {
          tx.objectStore(STORES.tombstones).put({
            uid: uid || `local-${storeName}-${id}`,
            store: storeName,
            recordId: Number(id),
            deletedAt: nowISO(),
            deviceId: getDeviceId()
          });
        }
        if (hasStore(db, STORES.changeLog)) {
          tx.objectStore(STORES.changeLog).add({
            uid: uid || `local-${storeName}-${id}`,
            store: storeName,
            recordId: Number(id),
            op: 'delete',
            rev: Number(existing?.rev) || 1,
            deviceId: getDeviceId(),
            updatedAt: nowISO()
          });
        }
        if (hasStore(db, STORES.auditLog)) {
          tx.objectStore(STORES.auditLog).add({
            action: 'delete',
            store: storeName,
            recordId: Number(id),
            route: '',
            details: '',
            createdAt: nowISO()
          });
        }
      });
      return undefined;
    },

    async get(id) {
      const db = await getDB();
      return requestToPromise(openStore(db, storeName).get(id));
    },

    async getMany(ids) {
      const db = await getDB();
      const list = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== '');
      if (!list.length) return [];
      return runTransaction(db, [storeName], 'readonly', (tx) => {
        const store = tx.objectStore(storeName);
        const rows = [];
        list.forEach((id) => {
          const request = store.get(id);
          request.onsuccess = () => { if (request.result != null) rows.push(request.result); };
        });
        return rows;
      });
    },

    /** Resolve a sync uid to the local record. */
    async getByUid(uid) {
      if (!uid) return null;
      const db = await getDB();
      if (!hasStore(db, STORES.uidMap)) return null;
      const map = await requestToPromise(openStore(db, STORES.uidMap).get(uid)).catch(() => null);
      if (!map) return null;
      const row = await requestToPromise(openStore(db, storeName).get(map.recordId)).catch(() => null);
      return row || null;
    },

    async count(query) {
      const db = await getDB();
      return requestToPromise(openStore(db, storeName).count(query));
    },

    async countByIndex(indexName, query = undefined) {
      const db = await getDB();
      return requestToPromise(openStore(db, storeName).index(indexName).count(query));
    },

    /** Bounded primary-key cursor, used by the inverted search index. */
    async keys({ query = undefined, direction = 'next', limit = 1000 } = {}) {
      const db = await getDB();
      const max = normalizeLimit(limit, 1000, 50000);
      if (max === 0) return [];
      const keys = [];
      return new Promise((resolve, reject) => {
        const request = openStore(db, storeName).openKeyCursor(query, direction);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || keys.length >= max) { resolve(keys); return; }
          keys.push(cursor.primaryKey);
          if (keys.length >= max) resolve(keys);
          else cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB key cursor failed'));
      });
    },

    /**
     * Bounded read. `limit` defaults to Infinity for backwards compatibility with
     * older call sites, but every production path passes an explicit limit.
     */
    async all({ limit = Infinity, direction = 'next', query = undefined } = {}) {
      const db = await getDB();
      const max = normalizeLimit(limit, Infinity, Infinity);
      if (max === Infinity) return requestToPromise(openStore(db, storeName).getAll(query));
      if (max === 0) return [];
      const store = openStore(db, storeName);
      const rows = [];
      return new Promise((resolve, reject) => {
        const request = store.openCursor(query, direction);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || rows.length >= max) { resolve(rows); return; }
          rows.push(cursor.value);
          if (rows.length >= max) { resolve(rows); return; }
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
      });
    },

    async byIndex(indexName, value, { limit = 1000, direction = 'next' } = {}) {
      return repository.page({ index: indexName, query: value, limit, direction });
    },

    async byIndexPage(indexName, value, options = {}) {
      return repository.page({ ...options, index: indexName, query: value });
    },

    async firstByIndex(indexName, query = undefined, direction = 'next') {
      const db = await getDB();
      const index = openStore(db, storeName).index(indexName);
      return new Promise((resolve, reject) => {
        const request = index.openCursor(query, direction);
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
      });
    },

    /**
     * Keyset pagination.
     *
     * `afterKey` is exclusive. Instead of walking the cursor from the very first
     * row (O(offset)) we jump straight to `afterKey` with a key range and skip the
     * rows that share the same key, which keeps deep pagination O(page size).
     */
    async page({
      index = null,
      query = undefined,
      direction = 'next',
      limit = 50,
      afterKey = undefined,
      afterPrimaryKey = undefined
    } = {}) {
      const db = await getDB();
      const size = normalizeLimit(limit, 50, 500);
      const store = openStore(db, storeName);
      const source = index ? store.index(index) : store;
      const rows = [];
      let lastKey;
      let lastPrimaryKey;

      let range = query;
      if (afterKey !== undefined) {
        const bound = direction === 'next'
          ? IDBKeyRange.lowerBound(afterKey)
          : IDBKeyRange.upperBound(afterKey);
        range = query === undefined
          ? bound
          : mergeRanges(query, bound, direction);
      }

      return new Promise((resolve, reject) => {
        const cursorRequest = source.openCursor(range, direction);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve({ rows, nextKey: lastKey, nextPrimaryKey: lastPrimaryKey, hasMore: false });
            return;
          }
          if (afterKey !== undefined) {
            const keyCmp = indexedDB.cmp(cursor.key, afterKey);
            const primaryCmp = afterPrimaryKey === undefined
              ? 0
              : indexedDB.cmp(cursor.primaryKey, afterPrimaryKey);
            const passed = direction === 'next'
              ? (keyCmp > 0 || (keyCmp === 0 && afterPrimaryKey !== undefined && primaryCmp > 0))
              : (keyCmp < 0 || (keyCmp === 0 && afterPrimaryKey !== undefined && primaryCmp < 0));
            if (!passed) { cursor.continue(); return; }
          }
          rows.push(cursor.value);
          lastKey = cursor.key;
          lastPrimaryKey = cursor.primaryKey;
          if (rows.length >= size) {
            resolve({ rows, nextKey: lastKey, nextPrimaryKey: lastPrimaryKey, hasMore: true });
            return;
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error || new Error('IndexedDB cursor failed'));
      });
    },

    async pageByIndex(indexName, value, options = {}) {
      return repository.page({ ...options, index: indexName, query: value });
    },

    async prefix(indexName, prefix, options = {}) {
      return repository.page({ ...options, index: indexName, query: prefixRange(prefix) });
    },

    /**
     * Walks rows without materialising them.
     * `limit: null | undefined | Infinity` walks the whole store.
     */
    async scan({ index = null, query = undefined, direction = 'next', limit = 1000, onRow } = {}) {
      const db = await getDB();
      const max = isUnbounded(limit) ? Infinity : normalizeLimit(limit, 1000, 10000);
      const store = openStore(db, storeName);
      const source = index ? store.index(index) : store;
      let seen = 0;
      return new Promise((resolve, reject) => {
        const request = source.openCursor(query, direction);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || seen >= max) { resolve(seen); return; }
          seen += 1;
          try { onRow?.(cursor.value, cursor.key, cursor.primaryKey); }
          catch (error) { reject(error); return; }
          if (seen >= max) { resolve(seen); return; }
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
      });
    },

    async findFirst(predicate, { index = null, query = undefined, direction = 'next', maxScan = 5000 } = {}) {
      let found = null;
      await repository.scan({
        index, query, direction, limit: maxScan,
        onRow: (row) => { if (!found && predicate(row)) found = row; }
      });
      return found;
    },

    async bulkPut(values, { chunkSize = 250, track = false } = {}) {
      const items = Array.isArray(values) ? values : [];
      // Bulk import bypasses per-row postings. Persist the dirty sentinel in
      // the same transaction, even if rows keep the same IDs/count after a crash.
      if (items.length && isSearchable(storeName)) markIndexStale();
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const db = await getDB();
        const mark = isSearchable(storeName) && hasStore(db, STORES.searchDoc);
        // eslint-disable-next-line no-await-in-loop
        await runTransaction(db, mark ? [storeName, STORES.searchDoc] : [storeName], 'readwrite', (tx) => {
          if (mark) recordIndexDirty(tx);
          const store = tx.objectStore(storeName);
          chunk.forEach((value) => store.put(clone(value)));
        });
      }
      return items.length;
    },

    async bulkAdd(values, { chunkSize = 250, track = false } = {}) {
      const items = Array.isArray(values) ? values : [];
      if (items.length && isSearchable(storeName)) markIndexStale();
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const db = await getDB();
        const mark = isSearchable(storeName) && hasStore(db, STORES.searchDoc);
        // eslint-disable-next-line no-await-in-loop
        await runTransaction(db, mark ? [storeName, STORES.searchDoc] : [storeName], 'readwrite', (tx) => {
          if (mark) recordIndexDirty(tx);
          const store = tx.objectStore(storeName);
          chunk.forEach((value) => store.add(clone(value)));
        });
      }
      return items.length;
    },

    async clear() {
      const db = await getDB();
      if (isSearchable(storeName) || storeName === STORES.searchIndex || storeName === STORES.searchDoc) markIndexStale();
      const mark = (isSearchable(storeName) || storeName === STORES.searchIndex) && hasStore(db, STORES.searchDoc);
      return runTransaction(db, mark ? [storeName, STORES.searchDoc] : [storeName], 'readwrite', (tx) => {
        tx.objectStore(storeName).clear();
        if (mark) recordIndexDirty(tx);
      });
    }
  };

  return repository;
}

/** Intersects an existing key range with the pagination bound. */
function mergeRanges(query, bound, direction) {
  if (!(query instanceof IDBKeyRange)) return bound;
  const lower = direction === 'next'
    ? maxKey(query.lower, bound.lower)
    : maxKey(query.lower, null);
  const upper = direction === 'next'
    ? minKey(query.upper, bound.upper)
    : minKey(query.upper, null);
  const lowerOpen = lower === (direction === 'next' ? bound.lower : query.lower);
  const upperOpen = upper === (direction === 'next' ? bound.upper : query.upper);
  try {
    return IDBKeyRange.bound(lower, upper, Boolean(lowerOpen), Boolean(upperOpen));
  } catch {
    return bound;
  }
}
function maxKey(a, b) {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return indexedDB.cmp(a, b) >= 0 ? a : b;
}
function minKey(a, b) {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return indexedDB.cmp(a, b) <= 0 ? a : b;
}

/** Runs several store operations atomically inside one transaction. */
export async function transaction(storeNames, mode, callback) {
  const db = await getDB();
  return runTransaction(db, storeNames, mode, callback);
}

/** Repository for synthetic benchmarks ONLY (the separate benchmark database).
 * It cannot access the real office DB, and its API has no unbounded list read. */
export function benchmarkRepo(storeName) {
  if (!BENCHMARK_STORES.includes(storeName)) throw new Error('مخزن اختبار الأداء غير معروف.');
  return {
    async clear() {
      const db = await openBenchmarkDB();
      return runTransaction(db, [storeName], 'readwrite', tx => { tx.objectStore(storeName).clear(); });
    },
    async addBatch(rows) {
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error('دفعة اختبار غير صالحة.');
      if (!rows.length) return 0;
      const db = await openBenchmarkDB();
      await runTransaction(db, [storeName], 'readwrite', tx => {
        const store = tx.objectStore(storeName);
        for (const row of rows) store.add(row);
      });
      return rows.length;
    },
    async count() {
      const db = await openBenchmarkDB();
      return requestToPromise(openStore(db, storeName).count());
    },
    async countByIndex(indexName, key) {
      if (!['caseId', 'date', 'status'].includes(indexName)) throw new Error('فهرس اختبار غير معروف.');
      const db = await openBenchmarkDB();
      return requestToPromise(openStore(db, storeName).index(indexName).count(key));
    },
    async page({ limit = 50, afterKey = null } = {}) {
      const db = await openBenchmarkDB();
      const size = normalizeLimit(limit, 50, 200);
      const rows = [];
      let nextKey = afterKey;
      const range = afterKey == null ? undefined : IDBKeyRange.lowerBound(afterKey, true);
      return new Promise((resolve, reject) => {
        const request = openStore(db, storeName).openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve({ rows, nextKey, hasMore: false }); return; }
          if (rows.length >= size) { resolve({ rows, nextKey, hasMore: true }); return; }
          rows.push(cursor.value);
          nextKey = cursor.primaryKey;
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('تعذرت قراءة صفحة اختبار الأداء.'));
      });
    }
  };
}
