import { repo } from './db/repositories.js';
import { STORES } from './core/constants.js';
import { nowISO } from './core/utils.js';

export async function writeAudit({ action, store, recordId = null, route = '', details = '' }) {
  if (!store || store === STORES.auditLog) return;
  await repo(STORES.auditLog).add({
    action, store,
    recordId: recordId == null ? null : Number(recordId),
    route,
    details: String(details || '').slice(0, 500),
    createdAt: nowISO()
  }, { track: false });
}

export async function listAudit(limit = 200) {
  return repo(STORES.auditLog).all({ limit, direction: 'prev' });
}
