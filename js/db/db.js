import { APP_CONFIG } from '../config.js';
import { migrate } from './migrations.js';
import { AppError } from '../core/errors.js';

let connection = null;

/**
 * Opens (once) and memoises the database connection.
 *
 * All `indexedDB.open()` calls live in this DB module (the office DB and the
 * separate synthetic benchmark DB). Other modules use the repository layer.
 *
 * A failed open is *not* cached: the memoised promise is cleared so a later
 * attempt (e.g. after the user closes a blocking tab) can succeed.
 */
export function openDB() {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new AppError('المتصفح لا يدعم IndexedDB.', 'NO_INDEXEDDB'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(APP_CONFIG.dbName, Number(APP_CONFIG.dbVersion));
    } catch (error) {
      connection = null;
      reject(new AppError(error?.message || 'تعذر فتح قاعدة البيانات.', 'DB_OPEN_FAILED', error));
      return;
    }

    request.onupgradeneeded = (event) => {
      try {
        migrate(request.result, event.oldVersion, request.transaction);
      } catch (error) {
        try { request.transaction?.abort(); } catch { /* already aborted */ }
        connection = null;
        reject(new AppError(
          `فشل تحديث قاعدة البيانات إلى الإصدار ${APP_CONFIG.dbVersion}: ${error?.message || error}`,
          'DB_MIGRATION_FAILED',
          error
        ));
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another tab requesting a newer version must not be blocked by us.
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };

    request.onerror = () => {
      connection = null;
      reject(new AppError(
        request.error?.message || 'تعذر فتح قاعدة البيانات.',
        'DB_OPEN_FAILED',
        request.error
      ));
    };

    request.onblocked = () => {
      connection = null;
      reject(new AppError(
        'قاعدة البيانات مشغولة في نافذة أخرى. أغلق النسخة الأخرى ثم أعد المحاولة.',
        'DB_BLOCKED'
      ));
    };
  });

  return connection;
}

export function getDB() {
  if (!connection) throw new AppError('قاعدة البيانات لم تُفتح بعد.', 'DB_NOT_READY');
  return connection;
}

export async function closeDB() {
  if (!connection) return;
  const db = await connection.catch(() => null);
  try { db?.close?.(); } catch { /* noop */ }
  connection = null;
}

/** Test/utility helper: drops the memoised handle without closing the DB. */
export function resetConnection() {
  connection = null;
}

/** Separate, synthetic-only DB for the optional in-browser performance tool.
 * Never touches LawOfficeDB and never uses deleteDatabase to reset it. Both
 * connections are owned here; all reads/writes go through repositories.js. */
export const BENCHMARK_STORES = Object.freeze(['clients', 'cases', 'hearings', 'procedures', 'caseTasks']);
const BENCHMARK_DB_NAME = 'LawOfficeBenchmarkDB';
let benchmarkConnection = null;

export function openBenchmarkDB() {
  if (benchmarkConnection) return benchmarkConnection;
  benchmarkConnection = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new AppError('المتصفح لا يدعم IndexedDB.', 'NO_INDEXEDDB')); return; }
    const request = indexedDB.open(BENCHMARK_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of BENCHMARK_STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        store.createIndex('caseId', 'caseId');
        store.createIndex('date', 'date');
        store.createIndex('status', 'status');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); benchmarkConnection = null; };
      resolve(db);
    };
    request.onerror = () => {
      benchmarkConnection = null;
      reject(new AppError(request.error?.message || 'تعذر فتح قاعدة بيانات الاختبار.', 'BENCHMARK_DB_OPEN_FAILED', request.error));
    };
    request.onblocked = () => {
      benchmarkConnection = null;
      reject(new AppError('قاعدة بيانات الاختبار مشغولة في نافذة أخرى.', 'BENCHMARK_DB_BLOCKED'));
    };
  });
  return benchmarkConnection;
}
