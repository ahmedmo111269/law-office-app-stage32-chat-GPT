import { APP_CONFIG } from '../config.js';
import { STORES } from '../core/constants.js';
import { repo } from '../db/repositories.js';
import {nowISO} from '../core/utils.js';
import { inspectIntegrity } from './integrity.js';
import { encryptBackupText } from './crypto.js';
import { getSetting, putSetting } from '../core/settings.js';

const CHUNK_SIZE = 250;
import { BACKUP_STORES } from './stores.js';

const STORE_NAMES = BACKUP_STORES;

/**
 * Streams one store into the JSON parts array.
 *
 * `scan` without a limit walks the whole store with a cursor, so the export is
 * never materialised in memory. (The previous build passed `limit: null`, which
 * the repository coerced to the 1000 row default — every store larger than 1000
 * records was silently truncated in the backup.)
 */
async function appendStore(name, parts, chunkSize = CHUNK_SIZE) {
  const buffer = [];
  let first = true;
  await repo(name).scan({
    limit: Infinity,
    onRow: (row) => {
      buffer.push(JSON.stringify(row));
      if (buffer.length >= chunkSize) {
        parts.push((first ? '' : ',') + buffer.join(','));
        first = false;
        buffer.length = 0;
      }
    }
  });
  if (buffer.length) parts.push((first ? '' : ',') + buffer.join(','));
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildBackupText({ requireHealthy = true } = {}) {
  const integrity = await inspectIntegrity();
  if (requireHealthy && !integrity.ok) {
    throw new Error('لا يمكن إنشاء نسخة احتياطية آمنة قبل مراجعة مشاكل سلامة البيانات.');
  }
  const createdAt = nowISO();
  const dataParts = ['{'];
  let first = true;
  for (const name of STORE_NAMES) {
    if (!first) dataParts.push(',');
    first = false;
    dataParts.push(`${JSON.stringify(name)}:[`);
    // eslint-disable-next-line no-await-in-loop
    await appendStore(name, dataParts);
    dataParts.push(']');
  }
  dataParts.push('}');
  const dataText = dataParts.join('');
  const dataHash = await sha256Hex(dataText);

  const header = {
    format: APP_CONFIG.backupFormat,
    formatVersion: APP_CONFIG.backupFormatVersion,
    appVersion: APP_CONFIG.version,
    dbName: APP_CONFIG.dbName,
    dbVersion: APP_CONFIG.dbVersion,
    createdAt,
    integrity: { healthyAtExport: integrity.ok, issueCount: integrity.issues.length },
    recordCounts: integrity.counts,
    dataSha256: dataHash
  };

  const text = `${JSON.stringify(header).slice(0, -1)},"data":${dataText}}`;
  return { text, createdAt, recordCounts: integrity.counts, dataSha256: dataHash, integrity };
}

function download(text, fileName, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function recordHistory(type, fileName, meta, status = 'success', notes = '') {
  try {
    await repo(STORES.backupHistory).add({
      type,
      date: nowISO(),
      fileName,
      appVersion: APP_CONFIG.version,
      dbVersion: APP_CONFIG.dbVersion,
      recordCounts: meta?.recordCounts || null,
      dataSha256: meta?.dataSha256 || null,
      status,
      notes
    }, { track: false });
  } catch { /* never fail a backup because history could not be written */ }
}

export async function createBackup({ requireHealthy = true } = {}) {
  const meta = await buildBackupText({ requireHealthy });
  const fileName = `law-office-backup-${meta.createdAt.replace(/[:.]/g, '-')}.json`;
  download(meta.text, fileName);
  await recordHistory('plain', fileName, meta);
  try {
    await putSetting('backup.lastSuccessAt', meta.createdAt);
  } catch { /* settings are bookkeeping only */ }
  return { ...meta, fileName, streamed: true };
}

export async function createEncryptedBackup(password) {
  const meta = await buildBackupText({ requireHealthy: true });
  const wrapped = await encryptBackupText(meta.text, password);
  const fileName = `law-office-backup-encrypted-${meta.createdAt.replace(/[:.]/g, '-')}.lobak`;
  download(wrapped, fileName, 'application/json');
  await recordHistory('encrypted', fileName, meta);
  try {
    await putSetting('backup.lastSuccessAt', meta.createdAt);
  } catch { /* bookkeeping */ }
  return { ...meta, fileName, encrypted: true };
}

export async function getBackupHistory(limit = 30) {
  return repo(STORES.backupHistory).all({ limit, direction: 'prev' });
}

export async function getLastSuccessfulBackup() {
  return getSetting('backup.lastSuccessAt');
}
