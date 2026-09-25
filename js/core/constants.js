export const STORES = Object.freeze({
  clients: 'clients',
  opponents: 'opponents',
  powerOfAttorneys: 'powerOfAttorneys',
  cases: 'cases',
  caseClients: 'caseClients',
  caseOpponents: 'caseOpponents',
  casePowerOfAttorneys: 'casePowerOfAttorneys',
  hearings: 'hearings',
  procedures: 'procedures',
  judgments: 'judgments',
  appeals: 'appeals',
  caseRelations: 'caseRelations',
  caseEvents: 'caseEvents',
  caseTasks: 'caseTasks',
  announcements: 'announcements',
  announcementFollowUps: 'announcementFollowUps',
  executionFiles: 'executionFiles',
  executionProcedures: 'executionProcedures',
  collections: 'collections',
  settlements: 'settlements',
  settlementSessions: 'settlementSessions',
  experts: 'experts',
  expertSessions: 'expertSessions',
  followUps: 'followUps',
  contacts: 'contacts',
  courtsAuthorities: 'courtsAuthorities',
  financialRecords: 'financialRecords',
  feeAgreements: 'feeAgreements',
  laborDetails: 'laborDetails',
  administrativeDetails: 'administrativeDetails',
  administrativeGrievances: 'administrativeGrievances',
  administrativeProcedures: 'administrativeProcedures',
  criminalDetails: 'criminalDetails',
  criminalProcedures: 'criminalProcedures',
  familyDetails: 'familyDetails',
  familyMaintenancePeriods: 'familyMaintenancePeriods',
  familyPayments: 'familyPayments',
  lookups: 'lookups',
  settings: 'settings',
  backupHistory: 'backupHistory',
  legalRules: 'legalRules',
  holidays: 'holidays',
  calculationHistory: 'calculationHistory',
  teamMembers: 'teamMembers',
  teamRoles: 'teamRoles',
  templates: 'templates',
  auditLog: 'auditLog',
  changeLog: 'changeLog',
  tombstones: 'tombstones',
  uidMap: 'uidMap',
  syncState: 'syncState',
  syncConflicts: 'syncConflicts',
  searchIndex: 'searchIndex',
  searchDoc: 'searchDoc'
});

/** Stores covered by the inverted search index. */
export const SEARCHABLE_STORES = Object.freeze([
  'clients', 'opponents', 'powerOfAttorneys', 'cases', 'hearings', 'procedures',
  'judgments', 'appeals', 'caseTasks', 'announcements', 'executionFiles',
  'executionProcedures', 'collections', 'financialRecords', 'feeAgreements',
  'experts', 'expertSessions', 'courtsAuthorities', 'settlements',
  'settlementSessions', 'followUps', 'contacts', 'templates', 'laborDetails',
  'familyDetails', 'administrativeDetails', 'criminalDetails', 'teamMembers',
  'caseRelations', 'caseEvents'
]);

/**
 * Stores that take part in two-way sync.
 * Local-only / derived stores are excluded on purpose: they are either device
 * specific (security PIN, favourites, recent pages) or reproducible bookkeeping.
 */
export const SYNCABLE_STORES = Object.freeze([
  'clients', 'opponents', 'powerOfAttorneys', 'cases', 'caseClients',
  'caseOpponents', 'casePowerOfAttorneys', 'hearings', 'procedures', 'judgments',
  'appeals', 'caseRelations', 'caseEvents', 'caseTasks', 'announcements',
  'announcementFollowUps', 'executionFiles', 'executionProcedures', 'collections',
  'settlements', 'settlementSessions', 'experts', 'expertSessions', 'followUps',
  'contacts', 'courtsAuthorities', 'financialRecords', 'feeAgreements',
  'laborDetails', 'administrativeDetails', 'administrativeGrievances',
  'administrativeProcedures', 'criminalDetails', 'criminalProcedures',
  'familyDetails', 'familyMaintenancePeriods', 'familyPayments', 'lookups',
  'teamMembers', 'teamRoles', 'templates', 'legalRules', 'holidays'
]);

/** Stores that must never be written to by sync import (device local state). */
export const LOCAL_ONLY_STORES = Object.freeze([
  'settings', 'backupHistory', 'auditLog', 'changeLog', 'tombstones',
  'uidMap', 'syncState', 'syncConflicts', 'calculationHistory', 'searchIndex', 'searchDoc'
]);

export const NAV_GROUPS = Object.freeze([
  { title: 'التشغيل اليومي', items: [['dashboard', '🏠', 'الرئيسية'], ['daily', '🎯', 'يومي'], ['quick-add', '⚡', 'إضافة سريعة'], ['search', '🔎', 'البحث الشامل']] },
  { title: 'الأشخاص', items: [['clients', '👤', 'العملاء'], ['opponents', '👥', 'الخصوم'], ['power-of-attorneys', '📄', 'التوكيلات'], ['team', '👨‍⚖️', 'فريق المكتب']] },
  { title: 'الملفات القضائية', items: [['cases', '⚖️', 'القضايا'], ['hearings', '📅', 'الجلسات'], ['judgments', '📝', 'الأحكام'], ['appeals', '📑', 'الطعون'], ['execution', '🏛️', 'التنفيذ']] },
  { title: 'الإجراءات والمتابعة', items: [['procedures', '🗂️', 'الإجراءات'], ['tasks', '📋', 'المهام'], ['announcements', '📜', 'الإعلانات والمحضرين'], ['follow-ups', '📞', 'المتابعات والاتصالات'], ['experts', '📐', 'الخبراء'], ['settlements', '📑', 'التسويات']] },
  { title: 'الجهات', items: [['courts', '🏛️', 'المحاكم والجهات']] },
  { title: 'الأدوات القانونية', items: [['financial', '💰', 'المركز المالي'], ['calculators', '🧮', 'الحاسبات القانونية'], ['labor', '👷', 'مركز القضايا العمالية'], ['family', '👨‍👩‍👧‍👦', 'مركز النفقات الأسرية'], ['administrative', '🏛️', 'المنازعات الإدارية'], ['criminal', '⚖️', 'مركز القضايا الجنائية']] },
  { title: 'المعلومات', items: [['reports', '📑', 'التقارير'], ['statistics', '📊', 'الإحصائيات والتحليلات'], ['data-quality', '🛡️', 'صحة البيانات'], ['performance', '⚡', 'أداء النظام'], ['audit', '🧾', 'سجل العمليات'], ['archive', '🗃️', 'الأرشيف']] },
  { title: 'النظام', items: [['sync', '🔄', 'المزامنة'], ['templates', '🧩', 'القوالب'], ['backup', '💾', 'النسخ الاحتياطي والاستعادة'], ['settings', '⚙️', 'الإعدادات']] }
]);
