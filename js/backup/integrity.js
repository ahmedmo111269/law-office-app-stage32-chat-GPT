import { STORES } from '../core/constants.js';
import { repo } from '../db/repositories.js';
import { missingRuleMetadata } from '../calculators/rule-metadata.js';

/**
 * Data-integrity checker.
 *
 * IndexedDB has no foreign keys, so referential integrity is enforced here.
 * The checker is deliberately read-only: it never repairs or deletes anything.
 *
 * Two modes:
 *  - `quick`  counts + a bounded sample of the relational stores. Used by the
 *             dashboard, which must stay fast on very large databases.
 *  - `full`   every row of every relational store. Used by the Data Quality page
 *             and by the backup exporter.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stores that hold a caseId / clientId style reference, with their FK fields. */
const RELATIONS = [
  [STORES.caseClients, [['clientId', STORES.clients], ['caseId', STORES.cases]]],
  [STORES.caseOpponents, [['opponentId', STORES.opponents], ['caseId', STORES.cases]]],
  [STORES.casePowerOfAttorneys, [['powerOfAttorneyId', STORES.powerOfAttorneys], ['caseId', STORES.cases]]],
  [STORES.powerOfAttorneys, [['clientId', STORES.clients]]],
  [STORES.caseRelations, [['sourceCaseId', STORES.cases], ['targetCaseId', STORES.cases]]],
  [STORES.caseEvents, [['caseId', STORES.cases]]],
  [STORES.caseTasks, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true], ['hearingId', STORES.hearings, true], ['judgmentId', STORES.judgments, true], ['appealId', STORES.appeals, true], ['announcementId', STORES.announcements, true], ['executionFileId', STORES.executionFiles, true]]],
  [STORES.hearings, [['caseId', STORES.cases], ['courtId', STORES.courtsAuthorities, true]]],
  [STORES.procedures, [['caseId', STORES.cases], ['relatedHearingId', STORES.hearings, true]]],
  [STORES.judgments, [['caseId', STORES.cases], ['courtId', STORES.courtsAuthorities, true]]],
  [STORES.appeals, [['caseId', STORES.cases], ['judgmentId', STORES.judgments, true], ['courtId', STORES.courtsAuthorities, true], ['nextHearingId', STORES.hearings, true]]],
  [STORES.executionFiles, [['caseId', STORES.cases, true], ['judgmentId', STORES.judgments, true], ['authorityId', STORES.courtsAuthorities, true]]],
  [STORES.executionProcedures, [['executionFileId', STORES.executionFiles]]],
  [STORES.collections, [['executionFileId', STORES.executionFiles]]],
  [STORES.announcements, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true], ['courtId', STORES.courtsAuthorities, true]]],
  [STORES.announcementFollowUps, [['announcementId', STORES.announcements]]],
  [STORES.experts, [['caseId', STORES.cases, true], ['authorityId', STORES.courtsAuthorities, true]]],
  [STORES.expertSessions, [['expertId', STORES.experts], ['caseId', STORES.cases, true]]],
  [STORES.settlements, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true]]],
  [STORES.settlementSessions, [['settlementId', STORES.settlements]]],
  [STORES.followUps, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true]]],
  [STORES.contacts, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true], ['opponentId', STORES.opponents, true]]],
  [STORES.financialRecords, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true]]],
  [STORES.feeAgreements, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true]]],
  [STORES.laborDetails, [['caseId', STORES.cases], ['clientId', STORES.clients, true]]],
  [STORES.familyDetails, [['caseId', STORES.cases, true], ['clientId', STORES.clients, true]]],
  [STORES.familyMaintenancePeriods, [['caseId', STORES.cases, true], ['familyDetailsId', STORES.familyDetails, true]]],
  [STORES.familyPayments, [['caseId', STORES.cases, true], ['familyDetailsId', STORES.familyDetails, true]]],
  [STORES.administrativeDetails, [['caseId', STORES.cases, true], ['authorityId', STORES.courtsAuthorities, true]]],
  [STORES.administrativeGrievances, [['caseId', STORES.cases, true], ['administrativeDetailsId', STORES.administrativeDetails, true]]],
  [STORES.administrativeProcedures, [['caseId', STORES.cases, true], ['administrativeDetailsId', STORES.administrativeDetails, true]]],
  [STORES.criminalDetails, [['caseId', STORES.cases], ['clientId', STORES.clients, true], ['prosecutionOfficeId', STORES.courtsAuthorities, true]]],
  [STORES.criminalProcedures, [['caseId', STORES.cases], ['criminalDetailsId', STORES.criminalDetails, true], ['relatedHearingId', STORES.hearings, true]]]
];

/** Non-negative integer money fields (stored as minor units, never floats). */
const MONEY_FIELDS = [
  [STORES.financialRecords, 'amountMinor', true],
  [STORES.feeAgreements, 'agreedAmountMinor', true],
  [STORES.collections, 'amountMinor', true],
  [STORES.executionFiles, 'amountMinor', false],
  [STORES.familyDetails, 'monthlyAmountMinor', false],
  [STORES.familyMaintenancePeriods, 'monthlyAmountMinor', true],
  [STORES.familyPayments, 'amountMinor', true],
  [STORES.laborDetails, 'wageMinor', false]
];

const DATE_FIELD_CANDIDATES = ['date', 'dueDate', 'filingDate', 'eventDate', 'startDate', 'decisionDate', 'paymentDate', 'fromDate', 'toDate', 'incidentDate', 'terminationDate', 'endDate', 'registrationDate', 'serviceDate', 'draftDate', 'deliveredDate', 'assignmentDate', 'reportDate', 'agreementDate', 'expiryDate', 'cancellationDate', 'nextDate', 'createdAt'];

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectIds(storeName, { limit = Infinity, field = 'id' } = {}) {
  const ids = new Set();
  await repo(storeName).scan({
    limit,
    onRow: (row) => {
      const value = row[field];
      if (value != null && value !== '') ids.add(Number(value));
    }
  });
  return ids;
}

const isSet = (value) => value != null && value !== '';

export async function inspectIntegrity({ mode = 'full', sampleLimit = 2000, onProgress } = {}) {
  const quick = mode === 'quick';
  const counts = {};
  for (const name of Object.values(STORES)) {
    // eslint-disable-next-line no-await-in-loop
    try { counts[name] = await repo(name).count(); } catch { counts[name] = null; }
  }

  const issues = [];
  const push = (store, id, message, severity = 'error') => {
    issues.push({ store, id: id ?? null, message, severity });
  };

  // --- primary key sets used for referential checks -------------------------
  const idCache = new Map();
  const idsOf = async (storeName) => {
    if (!idCache.has(storeName)) {
      const limit = quick ? sampleLimit : Infinity;
      // eslint-disable-next-line no-await-in-loop
      idCache.set(storeName, await collectIds(storeName, { limit }));
    }
    return idCache.get(storeName);
  };
  for (const name of [STORES.clients, STORES.opponents, STORES.cases, STORES.judgments, STORES.executionFiles, STORES.experts, STORES.settlements, STORES.familyDetails, STORES.criminalDetails, STORES.administrativeDetails, STORES.courtsAuthorities, STORES.announcements, STORES.hearings, STORES.powerOfAttorneys]) {
    // eslint-disable-next-line no-await-in-loop
    await idsOf(name);
  }

  // --- referential integrity -----------------------------------------------
  for (const [storeName, fields] of RELATIONS) {
    // eslint-disable-next-line no-await-in-loop
    await yieldToBrowser();
    const targets = new Map();
    for (const [, target] of fields) {
      // eslint-disable-next-line no-await-in-loop
      targets.set(target, await idsOf(target));
    }
    let scanned = 0;
    // eslint-disable-next-line no-await-in-loop
    await repo(storeName).scan({
      limit: quick ? sampleLimit : Infinity,
      onRow: (row) => {
        scanned += 1;
        for (const [field, target, optional] of fields) {
          const value = row[field];
          if (!isSet(value)) {
            if (!optional) push(storeName, row.id, `${field} فارغ`);
            continue;
          }
          if (!targets.get(target).has(Number(value))) {
            push(storeName, row.id, `${field} = ${value} غير موجود في ${target}`);
          }
        }
      }
    });
    if (quick && scanned === sampleLimit && (counts[storeName] || 0) > sampleLimit) {
      push(storeName, null, `تم فحص عينة من ${sampleLimit} سجل فقط من ${counts[storeName]} — استخدم الفحص الكامل.`, 'info');
    }
    onProgress?.({ store: storeName, index: RELATIONS.indexOf(RELATIONS.find((r) => r[0] === storeName)) + 1, total: RELATIONS.length });
  }

  // --- money ----------------------------------------------------------------
  for (const [storeName, field, required] of MONEY_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    await yieldToBrowser();
    // eslint-disable-next-line no-await-in-loop
    await repo(storeName).scan({
      limit: quick ? sampleLimit : Infinity,
      onRow: (row) => {
        const raw = row[field];
        if (raw == null || raw === '') {
          if (required) push(storeName, row.id, `${field} مفقود`);
          return;
        }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) push(storeName, row.id, `${field} غير صالح (${raw})`);
        if (Math.abs(n) > Number.MAX_SAFE_INTEGER / 1000) push(storeName, row.id, `${field} يتجاوز الحد الآمن`);
      }
    });
  }

  // --- dates ----------------------------------------------------------------
  const DATE_STORES = [
    STORES.cases, STORES.hearings, STORES.procedures, STORES.judgments, STORES.appeals,
    STORES.caseEvents, STORES.caseTasks, STORES.announcements, STORES.executionFiles,
    STORES.executionProcedures, STORES.collections, STORES.settlements, STORES.settlementSessions,
    STORES.experts, STORES.expertSessions, STORES.followUps, STORES.contacts,
    STORES.financialRecords, STORES.feeAgreements, STORES.laborDetails,
    STORES.administrativeDetails, STORES.administrativeGrievances, STORES.administrativeProcedures,
    STORES.criminalDetails, STORES.criminalProcedures, STORES.familyDetails,
    STORES.familyMaintenancePeriods, STORES.familyPayments, STORES.powerOfAttorneys
  ];
  for (const storeName of DATE_STORES) {
    // eslint-disable-next-line no-await-in-loop
    await yieldToBrowser();
    // eslint-disable-next-line no-await-in-loop
    await repo(storeName).scan({
      limit: quick ? sampleLimit : Infinity,
      onRow: (row) => {
        for (const field of DATE_FIELD_CANDIDATES) {
          const value = row[field];
          if (value == null || value === '') continue;
          if (field === 'createdAt' || field === 'updatedAt') continue;
          if (typeof value !== 'string' || !ISO_DATE.test(value)) {
            push(storeName, row.id, `تاريخ غير صالح في ${field}: ${value}`);
          }
        }
      }
    });
  }

  // --- business rules -------------------------------------------------------
  // eslint-disable-next-line no-await-in-loop
  await repo(STORES.legalRules).scan({
    limit: quick ? sampleLimit : Infinity,
    onRow: (row) => {
      const missing = missingRuleMetadata(row);
      if (missing.length) {
        push(STORES.legalRules, row.id, `قاعدة قانونية ناقصة بيانات: ${missing.join('، ')}`);
      }
      for (const field of ['effectiveFrom', 'verificationDate']) {
        if (row[field] && !ISO_DATE.test(String(row[field]))) {
          push(STORES.legalRules, row.id, `${field} في القاعدة القانونية غير صالح`);
        }
      }
    }
  });

  // eslint-disable-next-line no-await-in-loop
  await repo(STORES.holidays).scan({
    limit: quick ? sampleLimit : Infinity,
    onRow: (row) => {
      if (!ISO_DATE.test(String(row.date || ''))) push(STORES.holidays, row.id, 'تاريخ عطلة غير صالح');
    }
  });

  // eslint-disable-next-line no-await-in-loop
  await repo(STORES.calculationHistory).scan({
    limit: quick ? sampleLimit : Infinity,
    onRow: (row) => {
      if (!row.ruleId || !row.ruleVersion || !row.calculatedAt) {
        push(STORES.calculationHistory, row.id, 'سجل حساب ناقص بيانات القاعدة أو وقت الحساب');
      }
    }
  });

  // Authority hierarchy: empty name, dangling parent, self reference, cycle.
  const authorityById = new Map();
  // eslint-disable-next-line no-await-in-loop
  await repo(STORES.courtsAuthorities).scan({
    limit: quick ? sampleLimit : Infinity,
    onRow: (row) => {
      authorityById.set(Number(row.id), row);
      if (!row.name) push(STORES.courtsAuthorities, row.id, 'اسم الجهة فارغ');
      if (isSet(row.parentId) && Number(row.parentId) === Number(row.id)) {
        push(STORES.courtsAuthorities, row.id, 'الجهة تشير إلى نفسها');
      }
    }
  });
  for (const row of authorityById.values()) {
    if (!isSet(row.parentId)) continue;
    if (!authorityById.has(Number(row.parentId))) {
      push(STORES.courtsAuthorities, row.id, `parentId ${row.parentId} غير موجود`);
      continue;
    }
    const seen = new Set([Number(row.id)]);
    let cursor = row;
    let hops = 0;
    while (cursor && isSet(cursor.parentId) && hops < 64) {
      if (seen.has(Number(cursor.parentId))) {
        push(STORES.courtsAuthorities, row.id, 'دورة في تسلسل الجهات (parentId)');
        break;
      }
      seen.add(Number(cursor.parentId));
      cursor = authorityById.get(Number(cursor.parentId));
      hops += 1;
    }
  }

  // Appeal must belong to the same case as its judgment.
  const caseOfJudgment = new Map();
  // eslint-disable-next-line no-await-in-loop
  await repo(STORES.judgments).scan({
    limit: quick ? sampleLimit : Infinity,
    onRow: (row) => caseOfJudgment.set(Number(row.id), Number(row.caseId))
  });
  // eslint-disable-next-line no-await-in-loop
  await repo(STORES.appeals).scan({
    limit: quick ? sampleLimit : Infinity,
    onRow: (row) => {
      if (!isSet(row.judgmentId)) return;
      const owner = caseOfJudgment.get(Number(row.judgmentId));
      if (owner == null) return; // already reported as a dangling FK
      if (owner !== Number(row.caseId)) {
        push(STORES.appeals, row.id, 'الطعن يشير إلى حكم يتبع قضية أخرى');
      }
    }
  });

  // Duplicate active names (clients / opponents) — reported, never auto-merged.
  const seenNames = new Map();
  for (const [storeName, field] of [[STORES.clients, 'fullName'], [STORES.opponents, 'name']]) {
    const local = new Map();
    // eslint-disable-next-line no-await-in-loop
    await repo(storeName).scan({
      limit: quick ? sampleLimit : Infinity,
      onRow: (row) => {
        if (row.archived) return;
        const key = String(row[field] || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar-EG');
        if (!key) return;
        if (local.has(key)) push(storeName, row.id, `اسم مكرر لحقل ${field}`, 'warning');
        else local.set(key, row.id);
      }
    });
    seenNames.set(storeName, local);
  }

  const errors = issues.filter((x) => x.severity === 'error');
  return {
    ok: errors.length === 0,
    counts,
    issues,
    checkedAt: new Date().toISOString(),
    mode: quick ? 'quick-sample' : 'cursor-stream'
  };
}
