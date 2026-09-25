/**
 * Device identity.
 *
 * The device id identifies *this* installation for conflict resolution and
 * change attribution. It is stored in `localStorage` (device scope) rather than
 * IndexedDB on purpose: the repository layer needs it while writing change-log
 * rows, and reading it from IndexedDB would create a circular dependency and an
 * extra round trip on every write.
 */
const KEY = 'law-office.deviceId';
const LEGACY_SETTING_KEY = 'sync.deviceId';

let cached = null;

function generate() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return `dev_${cryptoObj.randomUUID()}`;
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId() {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return cached;
    }
  } catch { /* storage disabled */ }
  cached = generate();
  try { localStorage.setItem(KEY, cached); } catch { /* storage disabled */ }
  return cached;
}

/** Adopts a device id previously stored inside the IndexedDB settings store. */
export function adoptLegacyDeviceId(value) {
  if (!value || cached) return getDeviceId();
  cached = String(value);
  try { localStorage.setItem(KEY, cached); } catch { /* storage disabled */ }
  return cached;
}

export const DEVICE_SETTING_KEY = LEGACY_SETTING_KEY;
