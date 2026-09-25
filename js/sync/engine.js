import { APP_CONFIG } from '../config.js';
import { STORES, SYNCABLE_STORES } from '../core/constants.js';
import { repo, transaction, newUid } from '../db/repositories.js';
import { getDeviceId } from '../core/device.js';
import { getSetting, putSetting } from '../core/settings.js';
import { encryptBackupText, decryptBackupText } from '../backup/crypto.js';
import { buildBackupText } from '../backup/backup.js';
import { validateBackupPayload } from '../backup/restore.js';
import { getBackupSummary } from '../backup/restore.js';

/**
 * Two-way merge sync (local-first, no server).
 *
 * Model
 * -----
 * Every record carries a stable global identity:
 *   uid        – UUIDv4 assigned on first write (never reused)
 *   rev        – monotonically increasing per-record revision
 *   updatedAt  – ISO timestamp of the last change
 *   deviceId   – the device that produced that change
 *   deletedAt  – null, or the ISO timestamp of a tombstone
 *
 * Mutations are appended to `changeLog` (ordered by its auto-increment id) and
 * deletes also write a `tombstones` row, so a delete can be replayed on a peer.
 * `uidMap` resolves uid -> local record id, because local ids are per-device
 * auto-increment values and must never be assumed equal across devices.
 *
 * Merge rule
 * ----------
 * Last-writer-wins on `updatedAt`, with deterministic tie-breaks
 * (`rev`, then `deviceId` string compare) so both devices always converge to the
 * same winner regardless of the order they apply the bundle. When the local row
 * was also modified after the last common point, the loser is preserved in
 * `syncConflicts` for human review instead of being destroyed.
 *
 * Idempotency
 * -----------
 * Applying the same bundle twice is a no-op: every comparison is
 * "strictly newer than what I have", and applied cursors are persisted per peer.
 *
 * Wholesale replacements (backup restore, bulk import) do NOT go through the
 * change log. They set `sync.fullResyncAt`; a peer that sees a cursor older than
 * that timestamp must take a full snapshot rather than merging incrementally.
 */

const SYNC_STORES = SYNCABLE_STORES.filter((name) => STORES[name]);
const BUNDLE_FORMAT = APP_CONFIG.syncFormat;
const BUNDLE_VERSION = APP_CONFIG.syncFormatVersion;
const MAX_CHANGES_PER_BUNDLE = 20000;
const MAX_TOMBSTONES_PER_BUNDLE = 20000;

const nowISO = () => new Date().toISOString();
const peerKey = (deviceId) => `sync.peer.${deviceId}`;
const peerAtKey = (deviceId) => `sync.peerAt.${deviceId}`;

async function getPeerLastMergeAt(deviceId) {
  return (await getSetting(peerAtKey(deviceId))) || null;
}

/* ------------------------------------------------------------------ cursors */

export async function getCursorFor(deviceId) {
  return Number((await getSetting(peerKey(deviceId))) || 0);
}

async function setCursorFor(deviceId, value) {
  await putSetting(peerKey(deviceId), Number(value) || 0);
}

export async function getLocalCursor() {
  const latest = await repo(STORES.changeLog).page({ direction: 'prev', limit: 1 });
  return Number(latest.rows[0]?.id) || 0;
}

export async function getFullResyncAt() {
  return (await getSetting('sync.fullResyncAt')) || null;
}

/* --------------------------------------------------------------- changelog  */

async function collectChanges(sinceSeq, limit) {
  const range = sinceSeq > 0 ? IDBKeyRange.lowerBound(sinceSeq, true) : undefined;
  return repo(STORES.changeLog).all({ query: range, direction: 'next', limit });
}

async function collectTombstones(since, limit) {
  const rows = [];
  let afterKey, afterPrimaryKey;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await repo(STORES.tombstones).page({ limit: 500, afterKey, afterPrimaryKey });
    for (const row of page.rows) {
      if (!since || String(row.deletedAt) > String(since)) rows.push(row);
      if (rows.length >= limit) return rows;
    }
    if (!page.hasMore || !page.rows.length) return rows;
    afterKey = page.nextKey;
    afterPrimaryKey = page.nextPrimaryKey;
  }
}

async function recordForChange(change) {
  if (change.op === 'delete') return null;
  const row = change.uid
    ? await repo(change.store).getByUid(change.uid).catch(() => null)
    : null;
  return row || (change.recordId != null ? repo(change.store).get(change.recordId).catch(() => null) : null);
}

/**
 * Uid backfill: records created before the sync schema (or imported without a
 * uid) cannot be matched across devices until they get one.
 * Returns the number of records that were upgraded.
 */
export async function backfillUids({ onProgress, chunkSize = 500, signal } = {}) {
  let upgraded = 0;
  let scanned = 0;
  const stores = SYNC_STORES;
  for (const storeName of stores) {
    if (signal?.aborted) break;
    let cursor = null;
    for (;;) {
      if (signal?.aborted) break;
      // eslint-disable-next-line no-await-in-loop
      const page = await repo(storeName).all({
        limit: chunkSize,
        query: cursor === null ? undefined : IDBKeyRange.lowerBound(cursor, true)
      });
      if (!page.length) break;
      const pending = page.filter((row) => !row.uid);
      if (pending.length) {
        // eslint-disable-next-line no-await-in-loop
        await transaction([storeName, STORES.uidMap], 'readwrite', tx => {
          const store = tx.objectStore(storeName);
          const map = tx.objectStore(STORES.uidMap);
          for (const row of pending) {
            row.uid = newUid();
            row.rev = Number(row.rev) || 1;
            row.updatedAt = row.updatedAt || nowISO();
            row.deviceId = row.deviceId || getDeviceId();
            store.put(row);
            map.put({ uid: row.uid, store: storeName, recordId: Number(row.id) });
          }
        });
        upgraded += pending.length;
      }
      scanned += page.length;
      cursor = page[page.length - 1].id;
      if (page.length < chunkSize) break;
    }
    onProgress?.({ store: storeName, upgraded, scanned });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { upgraded, scanned };
}

export async function countRecordsMissingUid() {
  let missing = 0;
  for (const storeName of SYNC_STORES) {
    // eslint-disable-next-line no-await-in-loop
    await repo(storeName).scan({
      limit: Infinity,
      onRow: (row) => { if (!row.uid) missing += 1; }
    });
  }
  return missing;
}

/* ------------------------------------------------------------------ export  */

/**
 * Full snapshot bundle — used when the peer has never synced, or when this
 * device replaced its data wholesale (restore / bulk import).
 */
export async function createSnapshotBundle({ password } = {}) {
  const deviceId = getDeviceId();
  const backup = await buildBackupText({ requireHealthy: false });
  const encrypted = await encryptBackupText(backup.text, password);
  const createdAt = nowISO();
  const payload = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    mode: 'snapshot',
    createdAt,
    deviceId,
    appVersion: APP_CONFIG.version,
    dbVersion: APP_CONFIG.dbVersion,
    fullResyncAt: (await getFullResyncAt()) || createdAt,
    recordCounts: backup.recordCounts
  };
  return {
    fileName: `law-office-sync-full-${createdAt.replace(/[:.]/g, '-')}.losync`,
    text: JSON.stringify({ ...payload, encrypted: JSON.parse(encrypted) }),
    summary: { snapshot: true, totalRecords: backup.recordCounts },
    deviceId
  };
}

/* ------------------------------------------------------------------ import  */

export async function parseBundle(file, password) {
  if (!file) throw new Error('لم يتم اختيار حزمة مزامنة.');
  if (file.size > 1024 * 1024 * 1024) throw new Error('الحزمة أكبر من 1 جيجابايت.');
  let wrapper;
  try { wrapper = JSON.parse(await file.text()); } catch { throw new Error('الحزمة ليست JSON صالحًا.'); }
  if (wrapper?.format !== BUNDLE_FORMAT) throw new Error('الملف ليس حزمة مزامنة معتمدة لهذا التطبيق.');
  if (Number(wrapper.version) !== BUNDLE_VERSION) throw new Error('إصدار حزمة المزامنة غير مدعوم.');

  const plain = await decryptBackupText(wrapper.encrypted, password);
  let body;
  try { body = JSON.parse(plain); } catch { throw new Error('البيانات بعد فك التشفير غير صالحة.'); }

  // A full snapshot encrypts a *backup*, whose inner format is not a merge
  // package and has no `mode` property. Checking body.mode here used to
  // misclassify every genuine snapshot as a merge (silently importing nothing).
  if (body.format === APP_CONFIG.backupFormat) {
    if (wrapper.mode !== 'snapshot') throw new Error('نوع حزمة المزامنة لا يطابق محتواها المشفّر.');
    const validation = await validateBackupPayload(body);
    return {
      mode: 'snapshot',
      wrapper,
      payload: body,
      summary: getBackupSummary(body),
      warnings: [
        ...validation.warnings,
        'حزمة كاملة (snapshot): تطبيقها يستبدل بيانات هذا الجهاز بعد أخذ نسخة طوارئ.'
      ],
      fileName: file.name
    };
  }

  if (wrapper.mode !== 'merge' || body.format !== BUNDLE_FORMAT || body.mode !== 'merge' ||
      Number(body.version) !== BUNDLE_VERSION || wrapper.deviceId !== body.deviceId ||
      !Array.isArray(body.changes) || !Array.isArray(body.tombstones)) {
    throw new Error('محتوى حزمة الدمج لا يطابق بياناتها الوصفية أو إصداره غير مدعوم.');
  }
  return {
    mode: 'merge',
    wrapper,
    payload: body,
    summary: {
      sourceDevice: body.deviceId,
      createdAt: body.createdAt,
      changes: body.changes.length,
      tombstones: body.tombstones.length,
      fromSeq: body.fromSeq,
      toSeq: body.toSeq
    },
    warnings: [],
    fileName: file.name
  };
}

/** True when `a` strictly beats `b` under the deterministic LWW rule. */
function newerThan(a, b) {
  if (!b) return true;
  const at = Date.parse(a?.updatedAt || 0) || 0;
  const bt = Date.parse(b?.updatedAt || 0) || 0;
  if (at !== bt) return at > bt;
  const ar = Number(a?.rev) || 0;
  const br = Number(b?.rev) || 0;
  if (ar !== br) return ar > br;
  return String(a?.deviceId || '') > String(b?.deviceId || '');
}

function stripSyncMeta(row) {
  const copy = { ...row };
  return copy;
}

/**
 * Applies a parsed bundle.
 * `mode: 'merge'`   – incremental, idempotent, conflict-preserving
 * `mode: 'snapshot'– full replacement (delegates to the restore pipeline)
 */
export async function applyBundle(parsed, { confirm = false, onProgress, restoreSnapshot } = {}) {
  if (!confirm) throw new Error('تطبيق المزامنة يتطلب تأكيدًا صريحًا.');
  const deviceId = getDeviceId();

  if (parsed.mode === 'snapshot') {
    if (typeof restoreSnapshot !== 'function') throw new Error('لا تتوفر واجهة استعادة للحزمة الكاملة.');
    const result = await restoreSnapshot(parsed.payload, { confirm: true, onProgress });
    await putSetting('sync.lastMergeAt', nowISO());
    return {
      mode: 'snapshot',
      applied: 0,
      skipped: 0,
      deleted: 0,
      conflicts: 0,
      integrity: result,
      peer: parsed.payload?.deviceId || null
    };
  }

  const payload = parsed.payload;
  if (payload.deviceId === deviceId) {
    throw new Error('هذه الحزمة صادرة من هذا الجهاز نفسه. لا حاجة لاستيرادها.');
  }

  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const tombstones = Array.isArray(payload.tombstones) ? payload.tombstones : [];
  const known = new Set(SYNC_STORES);

  let applied = 0;
  let skipped = 0;
  let deleted = 0;
  let conflicts = 0;

  // --- deletes first, so a later update cannot resurrect a deleted record ----
  for (const tomb of tombstones) {
    if (!known.has(tomb.store)) continue;
    // eslint-disable-next-line no-await-in-loop
    const local = await repo(tomb.store).getByUid(tomb.uid).catch(() => null);
    if (!local) continue;
    if (newerThan({ updatedAt: tomb.deletedAt }, local)) {
      // eslint-disable-next-line no-await-in-loop
      await repo(tomb.store).delete(local.id, { track: false });
      deleted += 1;
    }
  }

  // --- upserts --------------------------------------------------------------
  for (const change of changes) {
    if (!known.has(change.store)) continue;
    if (change.op === 'delete') continue; // handled by tombstones
    // eslint-disable-next-line no-await-in-loop
    const incoming = await readRecordFromStore(change.store, change);
    if (!incoming) continue;
    const repository = repo(change.store);
    const incomingRow = stripSyncMeta(incoming);

    // eslint-disable-next-line no-await-in-loop
    const local = await repository.getByUid(incomingRow.uid).catch(() => null);

    if (!local) {
      const insert = { ...incomingRow };
      delete insert.id; // local id is generated here
      // eslint-disable-next-line no-await-in-loop
      const newId = await repository.put(insert, { preserveTimestamps: true, track: false });
      // eslint-disable-next-line no-await-in-loop
      await rememberUid(change.store, incomingRow.uid, newId ?? insert.id);
      applied += 1;
      continue;
    }

    if (!newerThan(incomingRow, local)) {
      skipped += 1;
      continue;
    }

    // Local row also changed since we last spoke to this peer? keep the loser.
    const peerLastAt = await getPeerLastMergeAt(payload.deviceId);
    const localChangedAfterPeer = !peerLastAt || Date.parse(local.updatedAt || 0) > Date.parse(peerLastAt);
    if (localChangedAfterPeer && JSON.stringify(withoutMeta(local)) !== JSON.stringify(withoutMeta(incomingRow))) {
      // eslint-disable-next-line no-await-in-loop
      await repo(STORES.syncConflicts).add({
        uid: incomingRow.uid,
        store: change.store,
        recordId: Number(local.id),
        detectedAt: nowISO(),
        resolved: 0,
        local: withoutMeta(local),
        remote: withoutMeta(incomingRow),
        note: 'تم الاحتفاظ بالأحدث حسب updatedAt؛ النسخة الأخرى محفوظة للمراجعة.'
      }, { track: false });
      conflicts += 1;
    }

    // eslint-disable-next-line no-await-in-loop
    await repository.put({ ...incomingRow, id: local.id }, { preserveTimestamps: true, track: false });
    // eslint-disable-next-line no-await-in-loop
    await rememberUid(change.store, incomingRow.uid, local.id);
    applied += 1;
  }

  await setCursorFor(payload.deviceId, Number(payload.toSeq) || 0);
  await putSetting(peerAtKey(payload.deviceId), nowISO());
  await putSetting('sync.lastMergeAt', nowISO());

  return { mode: 'merge', applied, skipped, deleted, conflicts, peer: payload.deviceId, toSeq: payload.toSeq };
}

/** Records the uid -> local id mapping after a merge insert/upsert. */
async function rememberUid(storeName, uid, recordId) {
  if (!uid || recordId == null) return;
  await transaction([STORES.uidMap], 'readwrite', tx => {
    tx.objectStore(STORES.uidMap).put({ uid, store: storeName, recordId: Number(recordId) });
  });
}

function withoutMeta(row) {
  const copy = { ...row };
  delete copy.rev;
  delete copy.updatedAt;
  delete copy.deviceId;
  delete copy.deletedAt;
  delete copy.uid;
  return copy;
}

/** Reads the record a change refers to out of the bundle's own store data. */
async function readRecordFromStore(storeName, change) {
  // Merge bundles are self-contained: every change carries the full record.
  return change?.record || null;
}

export async function createMergeBundle({ password, peerCursor = 0, onProgress } = {}) {
  const deviceId = getDeviceId();
  const changes = await collectChanges(Number(peerCursor) || 0, MAX_CHANGES_PER_BUNDLE);
  const enriched = [];
  let index = 0;
  for (const change of changes) {
    index += 1;
    if (change.op === 'delete') { enriched.push(change); continue; }
    // eslint-disable-next-line no-await-in-loop
    const row = await recordForChange(change);
    if (!row) continue; // record deleted later in the same window
    enriched.push({ ...change, record: row });
    onProgress?.({ index, total: changes.length, store: change.store });
  }
  const tombstones = await collectTombstones(null, MAX_TOMBSTONES_PER_BUNDLE);
  const cursor = await getLocalCursor();
  const createdAt = nowISO();

  const payload = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    mode: 'merge',
    createdAt,
    deviceId,
    appVersion: APP_CONFIG.version,
    dbVersion: APP_CONFIG.dbVersion,
    fromSeq: Number(peerCursor) || 0,
    toSeq: cursor,
    changes: enriched,
    tombstones
  };

  const encrypted = await encryptBackupText(JSON.stringify(payload), password);
  return {
    fileName: `law-office-sync-${createdAt.replace(/[:.]/g, '-')}.losync`,
    // Public metadata only. Records, tombstones and even change details MUST
    // remain solely inside the AES-GCM ciphertext, not beside it in the JSON.
    text: JSON.stringify({
      format: BUNDLE_FORMAT, version: BUNDLE_VERSION, mode: 'merge',
      createdAt, deviceId, encrypted: JSON.parse(encrypted)
    }),
    summary: { changes: enriched.length, tombstones: tombstones.length, fromSeq: payload.fromSeq, toSeq: payload.toSeq },
    deviceId
  };
}

export async function getSyncStatus() {
  const deviceId = getDeviceId();
  const [lastMerge, localCursor, missingUids, resyncAt, conflicts, changeCount] = await Promise.all([
    getSetting('sync.lastMergeAt'),
    getLocalCursor().catch(() => 0),
    countRecordsMissingUid().catch(() => 0),
    getFullResyncAt(),
    repo(STORES.syncConflicts).count().catch(() => 0),
    repo(STORES.changeLog).count().catch(() => 0)
  ]);
  return {
    deviceId,
    lastMergeAt: lastMerge,
    localCursor,
    missingUids,
    fullResyncAt: resyncAt,
    conflicts,
    changeCount
  };
}

export async function listConflicts(limit = 100) {
  return repo(STORES.syncConflicts).all({ limit, direction: 'prev' });
}

export async function resolveConflict(id, { keep = 'local' } = {}) {
  const conflict = await repo(STORES.syncConflicts).get(Number(id));
  if (!conflict) throw new Error('سجل التعارض غير موجود.');
  const repository = repo(conflict.store);
  const winner = keep === 'remote' ? conflict.remote : conflict.local;
  const current = await repository.getByUid(conflict.uid).catch(() => null);
  if (current) {
    await repository.put({ ...winner, id: current.id }, { preserveTimestamps: true });
  } else if (winner) {
    const insert = { ...winner };
    delete insert.id;
    await repository.put(insert, { preserveTimestamps: true });
  }
  await repo(STORES.syncConflicts).put({ ...conflict, resolved: 1 });
  return true;
}
