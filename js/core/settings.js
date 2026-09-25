import { repo } from '../db/repositories.js';
import { STORES } from './constants.js';
import { nowISO } from './utils.js';

/**
 * Key/value settings helper.
 *
 * HISTORIC DEFECT: the `settings` object store is created by the generic schema
 * builder with `{ keyPath: 'id', autoIncrement: true }`, but several modules
 * called `repo('settings').put({ key, value })` as if `key` were the primary key.
 * IndexedDB therefore inserted a *new* row on every save, while readers did
 * `firstByIndex('key', key)` and always got the *oldest* row back. The practical
 * effect: the security PIN could never be changed or removed
 * (`repo('settings').delete('security.pin')` deleted nothing, because primary
 * keys are numbers).
 *
 * This helper resolves the row by its `key` index first and reuses its numeric
 * id, so a save updates in place and a delete removes every matching row.
 */
const settings = repo(STORES.settings);

export async function getSettingRow(key) {
  const row = await settings.firstByIndex('key', key);
  return row || null;
}

export async function getSetting(key, fallback = null) {
  const row = await getSettingRow(key);
  return row ? row.value : fallback;
}

export async function putSetting(key, value) {
  const existing = await getSettingRow(key);
  const payload = { key, value, updatedAt: nowISO() };
  if (existing?.id != null) {
    await settings.put({ ...existing, ...payload });
  } else {
    await settings.add(payload);
  }
  // Defensive cleanup: collapse rows left behind by the defective writer.
  const duplicatePage = await settings.byIndex('key', key, { limit: 100 });
  const duplicates = duplicatePage.rows || [];
  if (duplicates.length > 1) {
    const keep = existing?.id ?? duplicates[duplicates.length - 1].id;
    await Promise.all(
      duplicates
        .filter((row) => Number(row.id) !== Number(keep))
        .map((row) => settings.delete(row.id, { track: false }).catch(() => {}))
    );
  }
  return value;
}

export async function deleteSetting(key) {
  const page = await settings.byIndex('key', key, { limit: 100 });
  const rows = page.rows || [];
  await Promise.all(rows.map((row) => settings.delete(row.id, { track: false }).catch(() => {})));
  return rows.length;
}
