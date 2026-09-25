import { STORES, LOCAL_ONLY_STORES } from '../core/constants.js';

/**
 * Which stores travel inside a backup file.
 *
 * Derived/device-local data (audit trail, sync change log, tombstones, uid map,
 * sync state and the inverted search index) is intentionally excluded: it is
 * rebuilt locally and shipping it would resurrect another device's bookkeeping.
 */
export const EXCLUDED_FROM_BACKUP = Object.freeze([...LOCAL_ONLY_STORES, STORES.auditLog]);

export const BACKUP_STORES = Object.freeze(
  Object.values(STORES).filter((name) => !EXCLUDED_FROM_BACKUP.includes(name))
);

const BACKUP_SET = new Set(BACKUP_STORES);

export const isBackupStore = (name) => BACKUP_SET.has(name);
