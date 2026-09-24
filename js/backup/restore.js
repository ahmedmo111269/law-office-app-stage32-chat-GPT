import { APP_CONFIG } from '../config.js';
import { STORES } from '../core/constants.js';
import { repo } from '../db/repositories.js';
import { getDB } from '../db/db.js';
import { inspectIntegrity } from './integrity.js';
import { decryptBackupText } from './crypto.js';

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function validateStructure(payload) {
  if (!payload || payload.format !== APP_CONFIG.backupFormat) throw new Error('ملف النسخة الاحتياطية غير معتمد لهذا التطبيق.');
  if (payload.dbName !== APP_CONFIG.dbName) throw new Error('ملف النسخة لا يخص قاعدة بيانات هذا التطبيق.');
  if (!Number.isInteger(payload.formatVersion) || payload.formatVersion < 1 || payload.formatVersion > 2) throw new Error('إصدار تنسيق النسخة غير مدعوم.');
  if (!payload.data || typeof payload.data !== 'object') throw new Error('بيانات النسخة الاحتياطية غير مكتملة.');
  for (const name of Object.values(STORES)) {
    if (!Array.isArray(payload.data[name])) throw new Error(`النسخة الاحتياطية تفتقد مجموعة البيانات: ${name}`);
  }
}

export async function validateBackupPayload(payload) {
  validateStructure(payload);
  const warnings = [];
  if (Number(payload.dbVersion) > Number(APP_CONFIG.dbVersion)) warnings.push('النسخة صادرة من إصدار قاعدة بيانات أحدث من الإصدار الحالي؛ لا تتم الاستعادة لتجنب فقد حقول أو مخازن جديدة.');
  if (payload.appVersion && payload.appVersion !== APP_CONFIG.version) warnings.push(`إصدار التطبيق مختلف: النسخة ${payload.appVersion} / الحالي ${APP_CONFIG.version}.`);
  if (payload.formatVersion >= 2 && payload.dataSha256) {
    const actual = await sha256Hex(JSON.stringify(payload.data));
    if (actual !== payload.dataSha256) throw new Error('فشل التحقق من SHA-256: ملف النسخة تالف أو تم تعديله.');
  }
  return { ok: true, warnings };
}

export async function parseBackupFile(file, password = '') {
  if (!file) throw new Error('لم يتم اختيار ملف.');
  if (file.size > 1024 * 1024 * 1024) throw new Error('الملف أكبر من 1 جيجابايت؛ لا يُنصح باستعادته عبر واجهة المتصفح.');
  const raw = await file.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('الملف ليس JSON صالحًا.'); }
  if (payload.format === 'law-office-backup-encrypted') {
    const plain = await decryptBackupText(payload, password);
    try { payload = JSON.parse(plain); } catch { throw new Error('البيانات بعد فك التشفير غير صالحة.'); }
  }
  const validation = await validateBackupPayload(payload);
  return { payload, warnings: validation.warnings, fileName: file.name, fileSize: file.size };
}

export function getBackupSummary(payload) {
  validateStructure(payload);
  const counts = payload.recordCounts || Object.fromEntries(Object.values(STORES).map(name => [name, payload.data[name].length]));
  return {
    createdAt: payload.createdAt || 'غير معروف',
    appVersion: payload.appVersion || 'غير معروف',
    dbVersion: payload.dbVersion ?? 'غير معروف',
    formatVersion: payload.formatVersion || 1,
    totalRecords: Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0),
    counts
  };
}

async function clearStore(name) {
  const db = await getDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error(`تعذر تفريغ ${name}`));
    tx.onabort = () => reject(tx.error || new Error(`تعذر تفريغ ${name}`));
  });
}

export async function restoreBackup(parsed, { confirm = false, onProgress } = {}) {
  const payload = parsed?.payload || parsed;
  await validateBackupPayload(payload);
  if (!confirm) throw new Error('الاستعادة تتطلب تأكيدًا صريحًا.');
  const names = Object.values(STORES);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    await clearStore(name);
    await repo(name).bulkPut(payload.data[name], { chunkSize: 500 });
    onProgress?.({ store: name, index: i + 1, total: names.length, records: payload.data[name].length });
  }
  const result = await inspectIntegrity();
  try {
    await repo(STORES.backupHistory).add({
      type: 'restore', date: new Date().toISOString(), fileName: parsed?.fileName || '',
      appVersion: APP_CONFIG.version, dbVersion: APP_CONFIG.dbVersion,
      recordCounts: payload.recordCounts || null, dataSha256: payload.dataSha256 || null,
      status: result.ok ? 'success' : 'warning', notes: result.ok ? 'تمت الاستعادة وفحص سلامة البيانات.' : `تمت الاستعادة مع ${result.issues.length} مشكلة.`
    });
  } catch {}
  return result;
}
