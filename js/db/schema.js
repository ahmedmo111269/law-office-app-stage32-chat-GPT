import { STORES } from '../core/constants.js';

export const fields = Object.freeze({
  clients: ['fullName', 'normalizedName', 'nationalId', 'phone1', 'phone2', 'email', 'address', 'city', 'notes', 'tags', 'favorite', 'archived', 'createdAt', 'updatedAt'],
  opponents: ['name', 'normalizedName', 'nationalId', 'phone', 'email', 'address', 'city', 'entityType', 'notes', 'archived', 'createdAt', 'updatedAt'],
  powerOfAttorneys: ['clientId', 'number', 'year', 'type', 'date', 'office', 'monthNumber', 'scope', 'expiryDate', 'cancellationDate', 'status', 'notes', 'archived', 'createdAt', 'updatedAt'],
  cases: ['caseNumber', 'caseYear', 'caseType', 'caseSubtype', 'courtId', 'chamber', 'degree', 'filingDate', 'status', 'subject', 'caseValue', 'clientRole', 'responsibleLawyerId', 'source', 'notes', 'archived', 'createdAt', 'updatedAt'],
  caseClients: ['caseId', 'clientId', 'role', 'isPrimary', 'notes', 'createdAt'],
  caseOpponents: ['caseId', 'opponentId', 'role', 'notes', 'createdAt'],
  casePowerOfAttorneys: ['caseId', 'powerOfAttorneyId', 'notes', 'createdAt'],
  hearings: ['caseId', 'date', 'time', 'estimatedEndTime', 'type', 'courtId', 'chamber', 'room', 'floor', 'building', 'location', 'orderNumber', 'status', 'attendanceStatus', 'result', 'adjournmentReason', 'nextAction', 'notes', 'archived', 'createdAt', 'updatedAt'],
  procedures: ['caseId', 'date', 'type', 'description', 'result', 'responsibleLawyerId', 'relatedHearingId', 'nextAction', 'notes', 'archived', 'createdAt', 'updatedAt'],
  judgments: ['caseId', 'number', 'year', 'date', 'type', 'courtId', 'chamber', 'description', 'summary', 'operativePart', 'status', 'appealStatus', 'executionStatus', 'notes', 'archived', 'createdAt', 'updatedAt'],
  appeals: ['caseId', 'judgmentId', 'type', 'number', 'year', 'courtId', 'chamber', 'filingDate', 'registrationDate', 'status', 'nextHearingId', 'notes', 'archived', 'createdAt', 'updatedAt'],
  caseRelations: ['sourceCaseId', 'targetCaseId', 'relationType', 'notes', 'createdAt'],
  caseEvents: ['caseId', 'eventType', 'eventDate', 'title', 'description', 'sourceType', 'sourceId', 'createdAt'],
  caseTasks: ['title', 'description', 'caseId', 'clientId', 'hearingId', 'judgmentId', 'appealId', 'announcementId', 'executionFileId', 'dueDate', 'dueTime', 'status', 'priority', 'assignedTo', 'sourceType', 'sourceId', 'repeatRule', 'completedAt', 'notes', 'archived', 'createdAt', 'updatedAt'],
  announcements: ['caseId', 'clientId', 'addresseeId', 'type', 'address', 'courtId', 'processServerOfficeId', 'bailiffName', 'draftDate', 'deliveredDate', 'serviceDate', 'announcementNumber', 'announcementYear', 'status', 'result', 'resultDetails', 'nextAction', 'notes', 'createdAt', 'updatedAt'],
  announcementFollowUps: ['announcementId', 'date', 'method', 'person', 'result', 'notes', 'createdAt'],
  executionFiles: ['caseId', 'judgmentId', 'creditorId', 'debtorId', 'executionNumber', 'executionYear', 'authorityId', 'startDate', 'status', 'amountMinor', 'currency', 'notes', 'createdAt', 'updatedAt'],
  executionProcedures: ['executionFileId', 'date', 'type', 'description', 'result', 'nextAction', 'notes', 'createdAt', 'updatedAt'],
  collections: ['executionFileId', 'date', 'amountMinor', 'currency', 'method', 'reference', 'description', 'notes', 'createdAt', 'updatedAt'],
  settlements: ['caseId', 'clientId', 'type', 'requestNumber', 'requestYear', 'date', 'officeId', 'status', 'result', 'certificateInfo', 'notes', 'archived', 'createdAt', 'updatedAt'],
  settlementSessions: ['settlementId', 'date', 'time', 'sessionType', 'attendees', 'result', 'nextAction', 'nextDate', 'notes', 'createdAt', 'updatedAt'],
  experts: ['caseId', 'authorityId', 'expertName', 'expertOffice', 'assignmentNumber', 'assignmentDate', 'assignmentType', 'status', 'firstSessionDate', 'reportDate', 'reportStatus', 'notes', 'archived', 'createdAt', 'updatedAt'],
  expertSessions: ['expertId', 'caseId', 'date', 'time', 'sessionType', 'attendanceStatus', 'result', 'nextAction', 'nextDate', 'notes', 'createdAt', 'updatedAt'],
  followUps: ['caseId', 'clientId', 'date', 'method', 'person', 'subject', 'result', 'nextDate', 'notes', 'createdAt', 'updatedAt'],
  contacts: ['caseId', 'clientId', 'opponentId', 'date', 'method', 'person', 'subject', 'result', 'nextAction', 'notes', 'createdAt', 'updatedAt'],
  courtsAuthorities: ['name', 'type', 'parentId', 'city', 'address', 'phone', 'notes', 'active', 'createdAt', 'updatedAt'],
  feeAgreements: ['clientId', 'caseId', 'feeType', 'agreedAmountMinor', 'currency', 'agreementDate', 'status', 'notes', 'createdAt', 'updatedAt'],
  financialRecords: ['clientId', 'caseId', 'type', 'direction', 'amountMinor', 'currency', 'date', 'paymentMethod', 'reference', 'description', 'status', 'notes', 'createdAt', 'updatedAt'],
  laborDetails: ['caseId', 'clientId', 'employmentType', 'employerName', 'employerEntityType', 'jobTitle', 'startDate', 'endDate', 'wageMinor', 'wagePeriod', 'wageComponents', 'terminationType', 'terminationDate', 'terminationReason', 'contractType', 'workplace', 'insuranceStatus', 'notes', 'createdAt', 'updatedAt'],
  administrativeDetails: ['caseId', 'authorityId', 'administrativeType', 'decisionNumber', 'decisionDate', 'publicationDate', 'notificationDate', 'grievanceDate', 'grievanceResponseDate', 'status', 'subject', 'notes', 'createdAt', 'updatedAt'],
  administrativeGrievances: ['caseId', 'administrativeDetailsId', 'date', 'method', 'authority', 'subject', 'responseDate', 'response', 'status', 'notes', 'createdAt', 'updatedAt'],
  administrativeProcedures: ['caseId', 'administrativeDetailsId', 'date', 'type', 'description', 'result', 'nextAction', 'notes', 'createdAt', 'updatedAt'],
  criminalDetails: ['caseId', 'clientId', 'accusation', 'investigationNumber', 'investigationYear', 'prosecutionOfficeId', 'policeReportNumber', 'policeReportYear', 'incidentDate', 'arrestDate', 'releaseDate', 'detentionStatus', 'detentionStartDate', 'detentionEndDate', 'referralDate', 'referralAuthority', 'trialDegree', 'chargeDescription', 'statusDetails', 'notes', 'createdAt', 'updatedAt'],
  criminalProcedures: ['caseId', 'criminalDetailsId', 'date', 'type', 'description', 'result', 'nextAction', 'relatedHearingId', 'notes', 'createdAt', 'updatedAt'],
  familyDetails: ['caseId', 'clientId', 'familyType', 'beneficiaryName', 'obligorName', 'judgmentNumber', 'judgmentYear', 'judgmentDate', 'monthlyAmountMinor', 'currency', 'startDate', 'endDate', 'status', 'notes', 'createdAt', 'updatedAt'],
  familyMaintenancePeriods: ['caseId', 'familyDetailsId', 'category', 'fromDate', 'toDate', 'monthlyAmountMinor', 'currency', 'notes', 'createdAt', 'updatedAt'],
  familyPayments: ['caseId', 'familyDetailsId', 'paymentDate', 'amountMinor', 'currency', 'method', 'reference', 'notes', 'createdAt', 'updatedAt'],
  lookups: ['category', 'code', 'label', 'sortOrder', 'active', 'metadata'],
  settings: ['key', 'value', 'updatedAt'],
  backupHistory: ['type', 'date', 'fileName', 'appVersion', 'dbVersion', 'recordCounts', 'status', 'notes'],
  legalRules: ['ruleId', 'name', 'category', 'jurisdiction', 'effectiveFrom', 'effectiveTo', 'duration', 'unit', 'startRule', 'firstDayRule', 'lastDayRule', 'holidayRule', 'weekendRule', 'sourceType', 'source', 'sourceReference', 'sourceUrl', 'notes', 'active', 'version', 'verificationDate'],
  holidays: ['date', 'name', 'type', 'active', 'sourceReference', 'sourceUrl', 'notes'],
  calculationHistory: ['calculatorType', 'caseId', 'ruleId', 'ruleVersion', 'inputs', 'result', 'warnings', 'assumptions', 'calculatedAt', 'notes'],
  teamMembers: ['name', 'roleId', 'phone', 'email', 'jobTitle', 'joinDate', 'active', 'notes', 'createdAt', 'updatedAt'],
  teamRoles: ['name', 'code', 'permissions', 'active', 'createdAt', 'updatedAt'],
  templates: ['name', 'category', 'content', 'variables', 'description', 'active', 'createdAt', 'updatedAt'],
  auditLog: ['action', 'store', 'recordId', 'route', 'details', 'createdAt'],
  changeLog: ['uid', 'store', 'recordId', 'op', 'rev', 'deviceId', 'updatedAt', 'seq'],
  tombstones: ['uid', 'store', 'recordId', 'deletedAt', 'deviceId'],
  uidMap: ['uid', 'store', 'recordId'],
  syncState: ['key', 'value', 'updatedAt'],
  syncConflicts: ['uid', 'store', 'recordId', 'detectedAt', 'resolved', 'local', 'remote', 'note'],
  searchIndex: ['store', 'token', 'recordId'],
  searchDoc: ['store', 'recordId', 'tokens'],
});

export const indexes = Object.freeze({
  clients: [
    ['normalizedName', 'normalizedName'],
    ['nationalId', 'nationalId'],
    ['phone1', 'phone1'],
    ['archived', 'archived'],
    ['updatedAt', 'updatedAt'],
    ['nameArchived', ['normalizedName', 'archived']],
    ['archivedUpdated', ['archived', 'updatedAt']],
  ],
  opponents: [
    ['normalizedName', 'normalizedName'],
    ['nationalId', 'nationalId'],
    ['archived', 'archived'],
    ['nameArchived', ['normalizedName', 'archived']],
  ],
  powerOfAttorneys: [
    ['clientId', 'clientId'],
    ['number', 'number'],
    ['date', 'date'],
    ['archived', 'archived'],
    ['clientArchived', ['clientId', 'archived']],
    ['dateStatus', ['date', 'status']],
  ],
  cases: [
    ['caseNumber', 'caseNumber'],
    ['caseYear', 'caseYear'],
    ['courtId', 'courtId'],
    ['status', 'status'],
    ['archived', 'archived'],
    ['updatedAt', 'updatedAt'],
    ['filingDate', 'filingDate'],
    ['caseNumberYear', ['caseNumber', 'caseYear']],
  ],
  caseClients: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['clientCase', ['clientId', 'caseId']],
  ],
  caseOpponents: [
    ['caseId', 'caseId'],
    ['opponentId', 'opponentId'],
    ['opponentCase', ['opponentId', 'caseId']],
  ],
  casePowerOfAttorneys: [
    ['caseId', 'caseId'],
    ['powerOfAttorneyId', 'powerOfAttorneyId'],
    ['poaCase', ['powerOfAttorneyId', 'caseId']],
  ],
  hearings: [
    ['caseId', 'caseId'],
    ['date', 'date'],
    ['courtId', 'courtId'],
    ['status', 'status'],
    ['createdAt', 'createdAt'],
    ['dateTime', ['date', 'time']],
    ['caseArchived', ['caseId', 'archived']],
  ],
  procedures: [
    ['caseId', 'caseId'],
    ['date', 'date'],
    ['relatedHearingId', 'relatedHearingId'],
    ['caseDate', ['caseId', 'date']],
  ],
  judgments: [
    ['caseId', 'caseId'],
    ['date', 'date'],
    ['status', 'status'],
    ['caseDate', ['caseId', 'date']],
  ],
  appeals: [
    ['caseId', 'caseId'],
    ['judgmentId', 'judgmentId'],
    ['filingDate', 'filingDate'],
    ['status', 'status'],
    ['caseFiling', ['caseId', 'filingDate']],
  ],
  caseRelations: [
    ['sourceCaseId', 'sourceCaseId'],
    ['targetCaseId', 'targetCaseId'],
    ['relationType', 'relationType'],
    ['sourceRelation', ['sourceCaseId', 'relationType']],
    ['targetRelation', ['targetCaseId', 'relationType']],
  ],
  caseEvents: [
    ['caseId', 'caseId'],
    ['eventDate', 'eventDate'],
    ['eventType', 'eventType'],
    ['caseDate', ['caseId', 'eventDate']],
  ],
  caseTasks: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['dueDate', 'dueDate'],
    ['status', 'status'],
    ['assignedTo', 'assignedTo'],
    ['dueDateStatus', ['dueDate', 'status']],
    ['dueDateTime', ['dueDate', 'dueTime']],
    ['clientDue', ['clientId', 'dueDate']],
    ['caseDue', ['caseId', 'dueDate']],
  ],
  announcements: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['status', 'status'],
    ['serviceDate', 'serviceDate'],
    ['caseService', ['caseId', 'serviceDate']],
    ['draftStatus', ['draftDate', 'status']],
  ],
  announcementFollowUps: [
    ['announcementId', 'announcementId'],
    ['date', 'date'],
    ['announcementDate', ['announcementId', 'date']],
  ],
  executionFiles: [
    ['caseId', 'caseId'],
    ['judgmentId', 'judgmentId'],
    ['status', 'status'],
    ['statusStart', ['status', 'startDate']],
    ['archived', 'archived'],
    ['startDate', 'startDate'],
  ],
  executionProcedures: [
    ['executionFileId', 'executionFileId'],
    ['date', 'date'],
    ['execDate', ['executionFileId', 'date']],
  ],
  collections: [
    ['executionFileId', 'executionFileId'],
    ['date', 'date'],
    ['executionDate', ['executionFileId', 'date']],
  ],
  settlements: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['date', 'date'],
    ['status', 'status'],
    ['caseDate', ['caseId', 'date']],
  ],
  settlementSessions: [
    ['settlementId', 'settlementId'],
    ['date', 'date'],
    ['settlementDate', ['settlementId', 'date']],
  ],
  experts: [
    ['caseId', 'caseId'],
    ['authorityId', 'authorityId'],
    ['assignmentDate', 'assignmentDate'],
    ['caseAssignment', ['caseId', 'assignmentDate']],
  ],
  expertSessions: [
    ['expertId', 'expertId'],
    ['caseId', 'caseId'],
    ['date', 'date'],
    ['expertDate', ['expertId', 'date']],
    ['caseDate', ['caseId', 'date']],
  ],
  followUps: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['date', 'date'],
    ['caseDate', ['caseId', 'date']],
    ['clientDate', ['clientId', 'date']],
  ],
  contacts: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['opponentId', 'opponentId'],
    ['date', 'date'],
    ['caseDate', ['caseId', 'date']],
    ['clientDate', ['clientId', 'date']],
  ],
  courtsAuthorities: [
    ['name', 'name'],
    ['type', 'type'],
    ['city', 'city'],
    ['active', 'active'],
    ['parentId', 'parentId'],
    ['nameActive', ['name', 'active']],
    ['normalizedName', 'normalizedName'],
  ],
  feeAgreements: [
    ['clientId', 'clientId'],
    ['caseId', 'caseId'],
    ['agreementDate', 'agreementDate'],
    ['status', 'status'],
    ['clientDate', ['clientId', 'agreementDate']],
    ['caseDate', ['caseId', 'agreementDate']],
  ],
  financialRecords: [
    ['clientId', 'clientId'],
    ['caseId', 'caseId'],
    ['date', 'date'],
    ['direction', 'direction'],
    ['clientDate', ['clientId', 'date']],
    ['caseDate', ['caseId', 'date']],
  ],
  laborDetails: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['terminationDate', 'terminationDate'],
    ['employerName', 'employerName'],
    ['employerTermination', ['employerName', 'terminationDate']],
    ['startDate', 'startDate'],
  ],
  administrativeDetails: [
    ['caseId', 'caseId'],
    ['authorityId', 'authorityId'],
    ['decisionDate', 'decisionDate'],
    ['status', 'status'],
    ['authorityDecision', ['authorityId', 'decisionDate']],
  ],
  administrativeGrievances: [
    ['caseId', 'caseId'],
    ['administrativeDetailsId', 'administrativeDetailsId'],
    ['date', 'date'],
    ['responseDate', 'responseDate'],
    ['status', 'status'],
    ['caseDate', ['caseId', 'date']],
  ],
  administrativeProcedures: [
    ['caseId', 'caseId'],
    ['administrativeDetailsId', 'administrativeDetailsId'],
    ['date', 'date'],
    ['type', 'type'],
    ['caseDate', ['caseId', 'date']],
  ],
  criminalDetails: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['prosecutionOfficeId', 'prosecutionOfficeId'],
    ['investigationNumber', 'investigationNumber'],
    ['investigationYear', 'investigationYear'],
    ['statusDetails', 'statusDetails'],
    ['detentionStatus', 'detentionStatus'],
    ['caseIncident', ['caseId', 'incidentDate']],
    ['incidentDate', 'incidentDate'],
  ],
  criminalProcedures: [
    ['caseId', 'caseId'],
    ['criminalDetailsId', 'criminalDetailsId'],
    ['date', 'date'],
    ['type', 'type'],
    ['relatedHearingId', 'relatedHearingId'],
    ['caseDate', ['caseId', 'date']],
  ],
  familyDetails: [
    ['caseId', 'caseId'],
    ['clientId', 'clientId'],
    ['status', 'status'],
    ['startDate', 'startDate'],
    ['clientStart', ['clientId', 'startDate']],
  ],
  familyMaintenancePeriods: [
    ['caseId', 'caseId'],
    ['familyDetailsId', 'familyDetailsId'],
    ['fromDate', 'fromDate'],
    ['toDate', 'toDate'],
    ['category', 'category'],
    ['familyDate', ['familyDetailsId', 'fromDate']],
  ],
  familyPayments: [
    ['caseId', 'caseId'],
    ['familyDetailsId', 'familyDetailsId'],
    ['paymentDate', 'paymentDate'],
    ['familyDate', ['familyDetailsId', 'paymentDate']],
  ],
  lookups: [
    ['category', 'category'],
    ['active', 'active'],
  ],
  settings: [
    ['key', 'key'],
  ],
  backupHistory: [
    ['date', 'date'],
    ['status', 'status'],
  ],
  legalRules: [
    ['ruleId', 'ruleId'],
    ['category', 'category'],
    ['active', 'active'],
    ['effectiveFrom', 'effectiveFrom'],
  ],
  holidays: [
    ['date', 'date'],
    ['active', 'active'],
  ],
  calculationHistory: [
    ['calculatorType', 'calculatorType'],
    ['caseId', 'caseId'],
    ['ruleId', 'ruleId'],
    ['calculatedAt', 'calculatedAt'],
  ],
  teamMembers: [
    ['name', 'name'],
    ['roleId', 'roleId'],
    ['active', 'active'],
    ['phone', 'phone'],
    ['email', 'email'],
  ],
  teamRoles: [
    ['name', 'name'],
    ['code', 'code'],
    ['active', 'active'],
  ],
  templates: [
    ['name', 'name'],
    ['category', 'category'],
    ['active', 'active'],
    ['updatedAt', 'updatedAt'],
    ['nameActive', ['name', 'active']],
  ],
  auditLog: [
    ['createdAt', 'createdAt'],
    ['store', 'store'],
    ['action', 'action'],
    ['recordId', 'recordId'],
  ],
  changeLog: [
  ],
  tombstones: [
  ],
  uidMap: [
  ],
  syncState: [
  ],
  syncConflicts: [
  ],
  searchIndex: [],
  searchDoc: [],
});


/** Stores whose primary key is not the default auto-increment `id`. */
export const STORE_KEY_PATHS = Object.freeze({
  uidMap: 'uid',
  syncState: 'key',
  searchIndex: ['store', 'token', 'recordId'],
  searchDoc: ['store', 'recordId']
});

const defaultKeyPath = { keyPath: 'id', autoIncrement: true };

function keyOptions(storeName) {
  const keyPath = STORE_KEY_PATHS[storeName];
  if (!keyPath) return defaultKeyPath;
  // Compound keys are supplied by the caller, never auto-generated.
  return { keyPath };
}

export function createStore(db, name) {
  if (db.objectStoreNames.contains(name)) return null;
  const store = db.createObjectStore(name, keyOptions(name));
  for (const [indexName, path] of indexes[name] || []) {
    if (!store.indexNames.contains(indexName)) store.createIndex(indexName, path, { unique: false });
  }
  return store;
}

export function createSchema(db) {
  for (const name of Object.values(STORES)) createStore(db, name);
}

export function ensureIndex(transaction, db, storeName, pairs) {
  if (!transaction || !db.objectStoreNames.contains(storeName)) return;
  const store = transaction.objectStore(storeName);
  for (const [indexName, path] of pairs) {
    if (!store.indexNames.contains(indexName)) store.createIndex(indexName, path, { unique: false });
  }
}
