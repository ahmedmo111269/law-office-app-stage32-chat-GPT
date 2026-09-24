import { getDB } from './db.js';
import { clone } from '../core/utils.js';
import { STORES } from '../core/constants.js';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function normalizeLimit(value, fallback = 50, max = 500) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function prefixRange(prefix) {
  const p = String(prefix ?? '');
  return IDBKeyRange.bound(p, `${p}\uffff`);
}

function openStore(db, storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

export function repo(storeName) {
  return {
    async add(value) {
      const db = await getDB();
      const result=await requestToPromise(openStore(db, storeName, 'readwrite').add(clone(value)));
      if(storeName!==STORES.auditLog){ try{ const auditStore=openStore(db,STORES.auditLog,'readwrite'); auditStore.add({action:'add',store:storeName,recordId:Number(result),route:'',details:'',createdAt:new Date().toISOString()}); }catch{} }
      return result;
    },
    async put(value) {
      const db = await getDB();
      const result=await requestToPromise(openStore(db, storeName, 'readwrite').put(clone(value)));
      if(storeName!==STORES.auditLog){ try{ const auditStore=openStore(db,STORES.auditLog,'readwrite'); auditStore.add({action:'put',store:storeName,recordId:value?.id==null?null:Number(value.id),route:'',details:'',createdAt:new Date().toISOString()}); }catch{} }
      return result;
    },
    async delete(id) {
      const db = await getDB();
      const result=await requestToPromise(openStore(db, storeName, 'readwrite').delete(id));
      if(storeName!==STORES.auditLog){ try{ const auditStore=openStore(db,STORES.auditLog,'readwrite'); auditStore.add({action:'delete',store:storeName,recordId:Number(id),route:'',details:'',createdAt:new Date().toISOString()}); }catch{} }
      return result;
    },
    async get(id) {
      const db = await getDB();
      return requestToPromise(openStore(db, storeName).get(id));
    },
    async count() {
      const db = await getDB();
      return requestToPromise(openStore(db, storeName).count());
    },
    async countByIndex(indexName, query = undefined) {
      const db = await getDB();
      return requestToPromise(openStore(db, storeName).index(indexName).count(query));
    },
    async all({ limit = Infinity, direction = 'next', query = undefined } = {}) {
      const db = await getDB();
      const max = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : Infinity;
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
      return this.page({ index: indexName, query: value, limit, direction });
    },
    async byIndexPage(indexName, value, options = {}) {
      return this.page({ ...options, index: indexName, query: value });
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
    async page({ index = null, query = undefined, direction = 'next', limit = 50, afterKey = undefined, afterPrimaryKey = undefined } = {}) {
      const db = await getDB();
      const size = normalizeLimit(limit);
      const store = openStore(db, storeName);
      const source = index ? store.index(index) : store;
      const rows = [];
      let lastKey;
      let lastPrimaryKey;
      return new Promise((resolve, reject) => {
        const cursorRequest = source.openCursor(query, direction);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve({ rows, nextKey: lastKey, nextPrimaryKey: lastPrimaryKey, hasMore: false });
            return;
          }
          if (afterKey !== undefined) {
            const key = cursor.key;
            const primary = cursor.primaryKey;
            const keyCmp = indexedDB.cmp(key, afterKey);
            const primaryCmp = afterPrimaryKey === undefined ? 0 : indexedDB.cmp(primary, afterPrimaryKey);
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
      return this.page({ ...options, index: indexName, query: value });
    },
    async prefix(indexName, prefix, options = {}) {
      return this.page({ ...options, index: indexName, query: prefixRange(prefix) });
    },
    async scan({ index = null, query = undefined, direction = 'next', limit = 1000, onRow } = {}) {
      const db = await getDB();
      const max = limit == null ? Infinity : normalizeLimit(limit, 1000, 10000);
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
      await this.scan({ index, query, direction, limit: maxScan, onRow: row => { if (!found && predicate(row)) found = row; } });
      return found;
    },
    async bulkPut(values, { chunkSize = 250 } = {}) {
      const items = Array.isArray(values) ? values : [];
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const db = await getDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          try { chunk.forEach(value => store.put(clone(value))); }
          catch (error) { tx.abort(); reject(error); return; }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Bulk transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('Bulk transaction aborted'));
        });
      }
      return items.length;
    },
    async bulkAdd(values, { chunkSize = 250 } = {}) {
      const items = Array.isArray(values) ? values : [];
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const db = await getDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          try { chunk.forEach(value => store.add(clone(value))); }
          catch (error) { tx.abort(); reject(error); return; }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Bulk transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('Bulk transaction aborted'));
        });
      }
      return items.length;
    }
  };
}

export async function transaction(storeNames, mode, callback) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try { result = callback(tx); }
    catch (e) { tx.abort(); reject(e); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export { prefixRange };
