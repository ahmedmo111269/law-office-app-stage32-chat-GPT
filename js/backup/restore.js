import { APP_CONFIG } from '../config.js';
import { STORES } from '../core/constants.js';
import { repo } from '../db/repositories.js';
import { inspectIntegrity } from './integrity.js';
import { decryptBackupText } from './crypto.js';
import { putSetting } from '../core/settings.js';
import { rebuildSearchIndex } from '../search/index-builder.js';
import { BACKUP_STORES, EXCLUDED_FROM_BACKUP } from './stores.js';

const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

const KNOWN_STORES = new Set(BACKUP_STORES);

/**
 * Structural validation.
 *
 * Backups written by an older app version do not contain stores that were added
 * later (changeLog, tombstones, uidMap, syncState, syncConflicts since v15).
 * Those are treated as empty instead of being rejected, so a v14 backup still
 * restores cleanly. Stores the current schema does not know about are reported
 * and skipped rather than crashing the import.
 */
function validateStructure(payload) {
  if (!payload || payload.format !== APP_CONFIG.backupFormat) {
    throw new Error('ملف النسخة الاحتياطية غير معتمد لهذا التطبيق.');
  }
  if (payload.dbName !== APP_CONFIG.dbName) {
    throw new Error('ملف النسخة لا يخص قاعدة بيانات هذا التطبيق.');
  }
  if (!Number.isInteger(payload.formatVersion) || payload.formatVersion < 1 || payload.formatVersion > APP_CONFIG.backupFormatVersion) {
    throw new Error('إصدار تنسيق النسخة غير مدعوم.');
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error('بيانات النسخة الاحتياطية غير مكتملة.');
  }
  const seen = new Set();
  for (const [name, rows] of Object.entries(payload.data)) {
    seen.add(name);
    if (!Array.isArray(rows)) throw new Error(`مجموعة البيانات ${name} غير صالحة.`);
  }
  const missing = [...KNOWN_STORES].filter((name) => !seen.has(name));
  const unknown = [...seen].filter((name) => !KNOWN_STORES.has(name));
  return { missing, unknown };
}

export async function validateBackupPayload(payload) {
  const { missing, unknown } = validateStructure(payload);
  const warnings = [];

  // A backup produced by a newer schema cannot be replayed without risking
  // silent data loss for the stores/fields this build does not know about.
  if (Number(payload.dbVersion) > Number(APP_CONFIG.dbVersion)) {
    throw new Error(
      `النسخة صادرة من إصدار قاعدة بيانات أحدث (${payload.dbVersion}) من إصدار التطبيق الحالي (${APP_CONFIG.dbVersion}). ` +
      'لا تتم الاستعادة لتجنب فقد حقول أو مخازن جديدة. حدّث التطبيق ثم أعد المحاولة.'
    );
  }
  if (payload.appVersion && payload.appVersion !== APP_CONFIG.version) {
    warnings.push(`إصدار التطبيق مختلف: النسخة ${payload.appVersion} / الحالي ${APP_CONFIG.version}.`);
  }
  if (Number(payload.dbVersion) < Number(APP_CONFIG.dbVersion)) {
    warnings.push(
      `النسخة من إصدار قاعدة بيانات أقدم (${payload.dbVersion}). سيتم ترقية البيانات تلقائيًا عند الفتح التالي.`
    );
  }
  if (missing.length) {
    warnings.push(`النسخة لا تحتوي على مخازن حديثة: ${missing.join('، ')} — ستُستورد فارغة.`);
  }
  if (unknown.length) {
    warnings.push(`النسخة تحتوي على مخازن غير معروفة لهذا الإصدار: ${unknown.join('، ')} — سيتم تجاهلها.`);
  }
  if (payload.formatVersion >= 2 && payload.dataSha256) {
    const normalised = normaliseDataForHash(payload.data);
    const actual = await sha256Hex(normalised);
    if (actual !== payload.dataSha256) {
      throw new Error('فشل التحقق من SHA-256: ملف النسخة تالف أو تم تعديله.');
    }
  }
  return { ok: true, warnings, missing, unknown };
}

/**
 * Rebuilds the exact text the exporter hashed: `JSON.stringify(data)` over the
 * known stores in schema order. Missing stores are emitted as empty arrays so a
 * v14 backup still matches its original digest.
 */
function normaliseDataForHash(data) {
  const parts = [];
  for (const name of BACKUP_STORES) {
    parts.push(JSON.stringify(name) + ":" + JSON.stringify(Array.isArray(data[name]) ? data[name] : []));
  }
  return `{${parts.join(',')}}`;
}

export async function parseBackupFile(file, password = '') {
  if (!file) throw new Error('لم يتم اختيار ملف.');
  if (file.size > MAX_FILE_BYTES) throw new Error('الملف أكبر من 1 جيجابايت؛ لا يُنصح باستعادته عبر واجهة المتصفح.');
  let payload;
  const raw = await file.text();
  try { payload = JSON.parse(raw); } catch { throw new Error('الملف ليس JSON صالحًا.'); }

  if (payload && payload.format === 'law-office-backup-encrypted') {
    const plain = await decryptBackupText(payload, password);
    try { payload = JSON.parse(plain); } catch { throw new Error('البيانات بعد فك التشفير غير صالحة.'); }
  }

  const validation = await validateBackupPayload(payload);
  return { payload, warnings: validation.warnings, fileName: file.name, fileSize: file.size };
}

export function getBackupSummary(payload) {
  const { missing } = validateStructure(payload);
  const counts = {};
  let total = 0;
  for (const name of BACKUP_STORES) {
    const rows = Array.isArray(payload.data[name]) ? payload.data[name] : [];
    counts[name] = rows.length;
    total += rows.length;
  }
  return {
    createdAt: payload.createdAt || 'غير معروف',
    appVersion: payload.appVersion || 'غير معروف',
    dbVersion: payload.dbVersion ?? 'غير معروف',
    formatVersion: payload.formatVersion || 1,
    totalRecords: payload.recordCounts
      ? Object.values(payload.recordCounts).reduce((sum, n) => sum + Number(n || 0), 0)
      : total,
    counts,
    missing
  };
}

async function clearStore(name) {
  // Clear through the repository layer; callers never open IndexedDB directly.
  return repo(name).clear();
}

/**
 * Replaces the whole database with the backup payload.
 *
 * Device-local bookkeeping (audit trail, change log, tombstones, sync state) is
 * intentionally rebuilt rather than imported, and the device is flagged for a
 * full re-sync so peers never try to merge a wholesale replacement as if it were
 * a set of incremental edits.
 */
export async function restoreBackup(parsed, { confirm = false, onProgress } = {}) {
  const payload = parsed?.payload || parsed;
  await validateBackupPayload(payload);
  if (!confirm) throw new Error('الاستعادة تتطلب تأكيدًا صريحًا.');

  const names = BACKUP_STORES;
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const rows = Array.isArray(payload.data[name]) ? payload.data[name] : [];
    // eslint-disable-next-line no-await-in-loop
    await clearStore(name);
    if (rows.length) {
      // eslint-disable-next-line no-await-in-loop
      await repo(name).bulkPut(rows, { chunkSize: 500, track: false });
    }
    onProgress?.({ store: name, index: i + 1, total: names.length, records: rows.length });
  }

  // Derived/device-local bookkeeping is rebuilt, not imported.
  for (const name of EXCLUDED_FROM_BACKUP) {
    if (name === STORES.backupHistory) continue;
    // eslint-disable-next-line no-await-in-loop
    await clearStore(name).catch(() => {});
  }

  await putSetting('sync.fullResyncAt', new Date().toISOString()).catch(() => {});

  // Rebuild the derived index. A failure does not destroy the restored source
  // rows, but MUST be reported: success would falsely imply searchable data.
  let indexFailure = null;
  try {
    await rebuildSearchIndex({ chunkSize: 400, onProgress: (p) => onProgress?.({ ...p, phase: 'index' }) });
  } catch (error) { indexFailure = error; }

  const result = await inspectIntegrity();
  if (indexFailure) {
    result.ok = false;
    result.issues.push({
      store: STORES.searchIndex,
      id: null,
      severity: 'error',
      message: `استُعيدت البيانات لكن فهرس البحث لم يكتمل: ${indexFailure.message || indexFailure}. أعد بناءه من مركز صحة البيانات.`
    });
  }
  try {
    await repo(STORES.backupHistory).add({
      type: 'restore',
      date: new Date().toISOString(),
      fileName: parsed?.fileName || '',
      appVersion: APP_CONFIG.version,
      dbVersion: APP_CONFIG.dbVersion,
      recordCounts: payload.recordCounts || null,
      dataSha256: payload.dataSha256 || null,
      status: result.ok ? 'success' : 'warning',
      notes: result.ok
        ? 'تمت الاستعادة وفحص سلامة البيانات.'
        : `تمت الاستعادة مع ${result.issues.length} مشكلة.`
    }, { track: false });
  } catch { /* bookkeeping only */ }

  return result;
}
