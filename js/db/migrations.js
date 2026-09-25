import { APP_CONFIG } from '../config.js';
import { createSchema, createStore, ensureIndex, fields } from './schema.js';

/**
 * Migration registry.
 *
 * Every entry runs inside the single `onupgradeneeded` transaction of the DB it
 * belongs to, so a migration must never `await` anything: IndexedDB commits the
 * transaction as soon as the microtask queue drains.
 *
 * Signature: (db, transaction, targetVersion) => void
 *
 * NOTE ON A HISTORIC DEFECT:
 * The previous implementation called `MIGRATIONS[v]?.(db, oldVersion, transaction)`.
 * Every migration from v4 upwards declares `(db, transaction)`, so it received a
 * *number* (`oldVersion`) where it expected an `IDBTransaction`. The first call to
 * `transaction.objectStore(...)` therefore threw `TypeError: transaction?.objectStore
 * is not a function`, which aborted the upgrade and made the application fail to
 * open its database on both fresh installs and upgrades. The registry below passes
 * the transaction as the second argument, matching the declared signatures.
 */

const addIndexes = (transaction, db, storeName, pairs) =>
  ensureIndex(transaction, db, storeName, pairs);

const MIGRATIONS = {
  // v1: the whole baseline schema (all stores + indexes that existed at the time).
  1: (db) => createSchema(db),

  2: (db) => {
    createStore(db, 'feeAgreements');
  },

  3: (db) => {
    for (const name of ['legalRules', 'holidays', 'calculationHistory']) createStore(db, name);
  },

  4: (db, transaction) => {
    addIndexes(transaction, db, 'laborDetails', [
      ['caseId', 'caseId'],
      ['clientId', 'clientId'],
      ['terminationDate', 'terminationDate'],
      ['employerName', 'employerName']
    ]);
  },

  5: (db, transaction) => {
    createStore(db, 'familyMaintenancePeriods');
    createStore(db, 'familyPayments');
    addIndexes(transaction, db, 'familyDetails', [
      ['caseId', 'caseId'],
      ['clientId', 'clientId'],
      ['status', 'status'],
      ['startDate', 'startDate']
    ]);
  },

  6: (db, transaction) => {
    createStore(db, 'administrativeGrievances');
    createStore(db, 'administrativeProcedures');
    addIndexes(transaction, db, 'administrativeDetails', [
      ['caseId', 'caseId'],
      ['authorityId', 'authorityId'],
      ['decisionDate', 'decisionDate'],
      ['status', 'status']
    ]);
  },

  7: (db, transaction) => {
    createStore(db, 'criminalProcedures');
    addIndexes(transaction, db, 'criminalDetails', [
      ['caseId', 'caseId'],
      ['clientId', 'clientId'],
      ['prosecutionOfficeId', 'prosecutionOfficeId'],
      ['investigationNumber', 'investigationNumber'],
      ['investigationYear', 'investigationYear'],
      ['statusDetails', 'statusDetails'],
      ['detentionStatus', 'detentionStatus']
    ]);
  },

  8: (db, transaction) => {
    addIndexes(transaction, db, 'courtsAuthorities', [
      ['name', 'name'],
      ['type', 'type'],
      ['city', 'city'],
      ['active', 'active'],
      ['parentId', 'parentId']
    ]);
  },

  9: (db) => {
    createStore(db, 'teamMembers');
    createStore(db, 'teamRoles');
  },

  10: (db) => {
    createStore(db, 'templates');
  },

  11: (db, transaction) => {
    addIndexes(transaction, db, 'clients', [['nameArchived', ['normalizedName', 'archived']]]);
    addIndexes(transaction, db, 'cases', [['caseNumberYear', ['caseNumber', 'caseYear']]]);
    addIndexes(transaction, db, 'hearings', [['dateTime', ['date', 'time']]]);
    addIndexes(transaction, db, 'caseTasks', [
      ['dueDateStatus', ['dueDate', 'status']],
      ['dueDateTime', ['dueDate', 'dueTime']]
    ]);
    addIndexes(transaction, db, 'templates', [['nameActive', ['name', 'active']]]);
  },

  12: (db, transaction) => {
    const batch = {
      opponents: [['nameArchived', ['normalizedName', 'archived']]],
      powerOfAttorneys: [['clientArchived', ['clientId', 'archived']], ['dateStatus', ['date', 'status']]],
      procedures: [['caseDate', ['caseId', 'date']]],
      judgments: [['caseDate', ['caseId', 'date']]],
      appeals: [['caseFiling', ['caseId', 'filingDate']]],
      announcements: [['caseService', ['caseId', 'serviceDate']], ['draftStatus', ['draftDate', 'status']]],
      executionFiles: [['statusStart', ['status', 'startDate']]],
      collections: [['executionDate', ['executionFileId', 'date']]],
      settlements: [['caseDate', ['caseId', 'date']]],
      experts: [['caseAssignment', ['caseId', 'assignmentDate']]],
      expertSessions: [['expertDate', ['expertId', 'date']], ['caseDate', ['caseId', 'date']]],
      followUps: [['caseDate', ['caseId', 'date']], ['clientDate', ['clientId', 'date']]],
      contacts: [['caseDate', ['caseId', 'date']], ['clientDate', ['clientId', 'date']]],
      courtsAuthorities: [['nameActive', ['name', 'active']]],
      financialRecords: [['clientDate', ['clientId', 'date']], ['caseDate', ['caseId', 'date']]],
      feeAgreements: [['clientDate', ['clientId', 'agreementDate']], ['caseDate', ['caseId', 'agreementDate']]],
      laborDetails: [['employerTermination', ['employerName', 'terminationDate']]],
      administrativeDetails: [['authorityDecision', ['authorityId', 'decisionDate']]],
      administrativeGrievances: [['caseDate', ['caseId', 'date']]],
      administrativeProcedures: [['caseDate', ['caseId', 'date']]],
      criminalDetails: [['caseIncident', ['caseId', 'incidentDate']]],
      criminalProcedures: [['caseDate', ['caseId', 'date']]],
      familyDetails: [['clientStart', ['clientId', 'startDate']]],
      familyMaintenancePeriods: [['familyDate', ['familyDetailsId', 'fromDate']]],
      familyPayments: [['familyDate', ['familyDetailsId', 'paymentDate']]],
      caseClients: [['clientCase', ['clientId', 'caseId']]],
      caseOpponents: [['opponentCase', ['opponentId', 'caseId']]],
      casePowerOfAttorneys: [['poaCase', ['powerOfAttorneyId', 'caseId']]],
      caseRelations: [['sourceRelation', ['sourceCaseId', 'relationType']], ['targetRelation', ['targetCaseId', 'relationType']]],
      caseEvents: [['caseDate', ['caseId', 'eventDate']]],
      caseTasks: [['clientDue', ['clientId', 'dueDate']], ['caseDue', ['caseId', 'dueDate']]]
    };
    for (const [storeName, pairs] of Object.entries(batch)) addIndexes(transaction, db, storeName, pairs);
  },

  13: (db) => {
    createStore(db, 'auditLog');
  },

  14: (db, transaction) => {
    addIndexes(transaction, db, 'cases', [['filingDate', 'filingDate']]);
  },

  /**
   * v15 — sync readiness + index gaps.
   *
   * Added stores:
   *  - changeLog      ordered, append-only log of local mutations (two-way sync)
   *  - tombstones     deleted-record markers so deletes propagate to peers
   *  - uidMap         uid -> {store, recordId} so peers can match records
   *                   without relying on local auto-increment ids
   *  - syncState      per-device/peer sync cursors (keyPath: key)
   *  - syncConflicts  unresolved merge conflicts kept for human review
   *
   * Added indexes close three query paths that previously fell back to a full
   * store scan (executionProcedures, settlementSessions, announcementFollowUps)
   * and two that silently threw (executionFiles.archived used by the Archive
   * screen, courtsAuthorities.normalizedName used by the async select).
   *
   * No keyPath is changed and no store is deleted, so no user data is lost.
   */
  15: (db, transaction) => {
    createStore(db, 'changeLog');
    createStore(db, 'tombstones');
    createStore(db, 'uidMap');
    createStore(db, 'syncState');
    createStore(db, 'syncConflicts');
    createStore(db, 'searchIndex');
    createStore(db, 'searchDoc');

    addIndexes(transaction, db, 'executionProcedures', [
      ['executionFileId', 'executionFileId'],
      ['date', 'date'],
      ['execDate', ['executionFileId', 'date']]
    ]);
    addIndexes(transaction, db, 'settlementSessions', [
      ['settlementId', 'settlementId'],
      ['date', 'date'],
      ['settlementDate', ['settlementId', 'date']]
    ]);
    addIndexes(transaction, db, 'announcementFollowUps', [
      ['announcementId', 'announcementId'],
      ['date', 'date'],
      ['announcementDate', ['announcementId', 'date']]
    ]);
    addIndexes(transaction, db, 'executionFiles', [['archived', 'archived']]);
    addIndexes(transaction, db, 'executionFiles', [['startDate', 'startDate']]);
    addIndexes(transaction, db, 'laborDetails', [['startDate', 'startDate']]);
    addIndexes(transaction, db, 'criminalDetails', [['incidentDate', 'incidentDate']]);
    addIndexes(transaction, db, 'courtsAuthorities', [['normalizedName', 'normalizedName']]);
    addIndexes(transaction, db, 'hearings', [['caseArchived', ['caseId', 'archived']]]);
    addIndexes(transaction, db, 'clients', [['archivedUpdated', ['archived', 'updatedAt']]]);

    normalizeFlagColumns(db, transaction);
  }
};

/**
 * v15 data normalisation (no keyPath or store changes, no data loss).
 *
 * Booleans are not valid IndexedDB keys, so any row written with
 * `archived: true` / `active: false` was invisible to those indexes. Rewriting
 * them to 1/0 inside the upgrade transaction makes the indexes usable and keeps
 * every existing UI truthiness check working (`!row.archived` is still correct).
 */
const FLAG_DEFAULTS = { archived: 0, active: 1, favorite: 0, isPrimary: 0, resolved: 0 };

function normalizeFlagColumns(db, transaction) {
  if (!transaction) return;

  for (const [storeName, declared] of Object.entries(fields || {})) {
    const flags = Object.keys(FLAG_DEFAULTS).filter((name) => declared.includes(name));
    if (!flags.length) continue;
    if (!db.objectStoreNames.contains(storeName)) continue;
    let store;
    try { store = transaction.objectStore(storeName); } catch { continue; }
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value;
      let dirty = false;
      for (const name of flags) {
        const value = row[name];
        const next = value === undefined || value === null || value === ''
          ? FLAG_DEFAULTS[name]
          : (value ? 1 : 0);
        if (row[name] !== next) { row[name] = next; dirty = true; }
      }
      if (dirty) { try { cursor.update(row); } catch { /* noop */ } }
      cursor.continue();
    };
  }
}

export const CURRENT_DB_VERSION = Math.max(
  Number(APP_CONFIG.dbVersion) || 0,
  ...Object.keys(MIGRATIONS).map(Number)
);

/**
 * Runs every migration strictly above `oldVersion`.
 * A fresh database reports `oldVersion === 0`, so it replays the whole chain and
 * ends up byte-identical to an upgraded database.
 */
export function migrate(db, oldVersion, transaction) {
  const from = Number(oldVersion) || 0;
  const to = Number(APP_CONFIG.dbVersion) || CURRENT_DB_VERSION;
  for (let version = from + 1; version <= to; version += 1) {
    const step = MIGRATIONS[version];
    if (typeof step !== 'function') continue;
    step(db, transaction, version);
  }
}

export { MIGRATIONS };
