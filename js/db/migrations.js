import {createSchema} from './schema.js';
export const MIGRATIONS={
  1:(db)=>createSchema(db),
  2:(db)=>{
    if(!db.objectStoreNames.contains('feeAgreements')){
      const store=db.createObjectStore('feeAgreements',{keyPath:'id',autoIncrement:true});
      store.createIndex('clientId','clientId',{unique:false});store.createIndex('caseId','caseId',{unique:false});store.createIndex('agreementDate','agreementDate',{unique:false});store.createIndex('status','status',{unique:false});
    }
  },
  3:(db)=>{
    const add=(name,indexes)=>{if(db.objectStoreNames.contains(name))return;const store=db.createObjectStore(name,{keyPath:'id',autoIncrement:true});for(const [n,p] of indexes)store.createIndex(n,p,{unique:false});};
    add('legalRules',[['ruleId','ruleId'],['category','category'],['active','active'],['effectiveFrom','effectiveFrom']]);
    add('holidays',[['date','date'],['active','active']]);
    add('calculationHistory',[['calculatorType','calculatorType'],['caseId','caseId'],['ruleId','ruleId'],['calculatedAt','calculatedAt']]);
  },
  4:(db, transaction)=>{
    if(db.objectStoreNames.contains('laborDetails')){
      const store=transaction?.objectStore('laborDetails');
      if(store){
        for(const [n,p] of [['caseId','caseId'],['clientId','clientId'],['terminationDate','terminationDate'],['employerName','employerName']]){
          if(!store.indexNames.contains(n)) store.createIndex(n,p,{unique:false});
        }
      }
    }
  },
  5:(db, transaction)=>{
    const add=(name,indexes)=>{if(db.objectStoreNames.contains(name))return;const store=db.createObjectStore(name,{keyPath:'id',autoIncrement:true});for(const [n,p] of indexes)store.createIndex(n,p,{unique:false});};
    add('familyMaintenancePeriods',[['caseId','caseId'],['familyDetailsId','familyDetailsId'],['fromDate','fromDate'],['toDate','toDate'],['category','category']]);
    add('familyPayments',[['caseId','caseId'],['familyDetailsId','familyDetailsId'],['paymentDate','paymentDate']]);
    if(db.objectStoreNames.contains('familyDetails') && transaction){
      const store=transaction.objectStore('familyDetails');
      for(const [n,p] of [['caseId','caseId'],['clientId','clientId'],['status','status'],['startDate','startDate']]) if(!store.indexNames.contains(n)) store.createIndex(n,p,{unique:false});
    }
  },
  6:(db, transaction)=>{
    const add=(name,indexes)=>{if(db.objectStoreNames.contains(name))return;const store=db.createObjectStore(name,{keyPath:'id',autoIncrement:true});for(const [n,p] of indexes)store.createIndex(n,p,{unique:false});};
    add('administrativeGrievances',[['caseId','caseId'],['administrativeDetailsId','administrativeDetailsId'],['date','date'],['responseDate','responseDate'],['status','status']]);
    add('administrativeProcedures',[['caseId','caseId'],['administrativeDetailsId','administrativeDetailsId'],['date','date'],['type','type']]);
    if(db.objectStoreNames.contains('administrativeDetails') && transaction){
      const store=transaction.objectStore('administrativeDetails');
      for(const [n,p] of [['caseId','caseId'],['authorityId','authorityId'],['decisionDate','decisionDate'],['status','status']]) if(!store.indexNames.contains(n)) store.createIndex(n,p,{unique:false});
    }
  },
  7:(db, transaction)=>{
    const add=(name,indexes)=>{if(db.objectStoreNames.contains(name))return;const store=db.createObjectStore(name,{keyPath:'id',autoIncrement:true});for(const [n,p] of indexes)store.createIndex(n,p,{unique:false});};
    add('criminalProcedures',[['caseId','caseId'],['criminalDetailsId','criminalDetailsId'],['date','date'],['type','type'],['relatedHearingId','relatedHearingId']]);
    if(db.objectStoreNames.contains('criminalDetails') && transaction){
      const store=transaction.objectStore('criminalDetails');
      for(const [n,p] of [['caseId','caseId'],['clientId','clientId'],['prosecutionOfficeId','prosecutionOfficeId'],['investigationNumber','investigationNumber'],['investigationYear','investigationYear'],['statusDetails','statusDetails'],['detentionStatus','detentionStatus']]) if(!store.indexNames.contains(n)) store.createIndex(n,p,{unique:false});
    }
  },
  8:(db, transaction)=>{
    if(db.objectStoreNames.contains('courtsAuthorities') && transaction){
      const store=transaction.objectStore('courtsAuthorities');
      for(const [n,p] of [['name','name'],['type','type'],['city','city'],['active','active'],['parentId','parentId']]) if(!store.indexNames.contains(n)) store.createIndex(n,p,{unique:false});
    }
  },
  9:(db)=>{
    const add=(name,indexes)=>{if(db.objectStoreNames.contains(name))return;const store=db.createObjectStore(name,{keyPath:'id',autoIncrement:true});for(const [n,p] of indexes)store.createIndex(n,p,{unique:false});};
    add('teamMembers',[['name','name'],['roleId','roleId'],['active','active'],['phone','phone'],['email','email']]);
    add('teamRoles',[['name','name'],['code','code'],['active','active']]);
  },
  10:(db)=>{
    if(db.objectStoreNames.contains('templates')) return;
    const store=db.createObjectStore('templates',{keyPath:'id',autoIncrement:true});
    for(const [n,p] of [['name','name'],['category','category'],['active','active'],['updatedAt','updatedAt']]) store.createIndex(n,p,{unique:false});
  },
  11:(db, transaction)=>{
    const addIndexes=(storeName, list)=>{
      if(!transaction || !db.objectStoreNames.contains(storeName)) return;
      const store=transaction.objectStore(storeName);
      for(const [name,path] of list){
        if(!store.indexNames.contains(name)) store.createIndex(name,path,{unique:false});
      }
    };
    addIndexes('clients', [['nameArchived',['normalizedName','archived']]]);
    addIndexes('cases', [['caseNumberYear',['caseNumber','caseYear']]]);
    addIndexes('hearings', [['dateTime',['date','time']]]);
    addIndexes('caseTasks', [['dueDateStatus',['dueDate','status']],['dueDateTime',['dueDate','dueTime']]]);
    addIndexes('templates', [['nameActive',['name','active']]]);
  },
  12:(db, transaction)=>{
    const addIndexes=(storeName, list)=>{
      if(!transaction || !db.objectStoreNames.contains(storeName)) return;
      const store=transaction.objectStore(storeName);
      for(const [name,path] of list){ if(!store.indexNames.contains(name)) store.createIndex(name,path,{unique:false}); }
    };
    addIndexes('opponents', [['nameArchived',['normalizedName','archived']]]);
    addIndexes('powerOfAttorneys', [['clientArchived',['clientId','archived']],['dateStatus',['date','status']]]);
    addIndexes('procedures', [['caseDate',['caseId','date']]]);
    addIndexes('judgments', [['caseDate',['caseId','date']]]);
    addIndexes('appeals', [['caseFiling',['caseId','filingDate']]]);
    addIndexes('announcements', [['caseService',['caseId','serviceDate']],['draftStatus',['draftDate','status']]]);
    addIndexes('executionFiles', [['statusStart',['status','startDate']]]);
    addIndexes('collections', [['executionDate',['executionFileId','date']]]);
    addIndexes('settlements', [['caseDate',['caseId','date']]]);
    addIndexes('experts', [['caseAssignment',['caseId','assignmentDate']]]);
    addIndexes('expertSessions', [['expertDate',['expertId','date']],['caseDate',['caseId','date']]]);
    addIndexes('followUps', [['caseDate',['caseId','date']],['clientDate',['clientId','date']]]);
    addIndexes('contacts', [['caseDate',['caseId','date']],['clientDate',['clientId','date']]]);
    addIndexes('courtsAuthorities', [['nameActive',['name','active']]]);
    addIndexes('financialRecords', [['clientDate',['clientId','date']],['caseDate',['caseId','date']]]);
    addIndexes('feeAgreements', [['clientDate',['clientId','agreementDate']],['caseDate',['caseId','agreementDate']]]);
    addIndexes('laborDetails', [['employerTermination',['employerName','terminationDate']]]);
    addIndexes('administrativeDetails', [['authorityDecision',['authorityId','decisionDate']]]);
    addIndexes('administrativeGrievances', [['caseDate',['caseId','date']]]);
    addIndexes('administrativeProcedures', [['caseDate',['caseId','date']]]);
    addIndexes('criminalDetails', [['caseIncident',['caseId','incidentDate']]]);
    addIndexes('criminalProcedures', [['caseDate',['caseId','date']]]);
    addIndexes('familyDetails', [['clientStart',['clientId','startDate']]]);
    addIndexes('familyMaintenancePeriods', [['familyDate',['familyDetailsId','fromDate']]]);
    addIndexes('familyPayments', [['familyDate',['familyDetailsId','paymentDate']]]);
    addIndexes('caseClients', [['clientCase',['clientId','caseId']]]);
    addIndexes('caseOpponents', [['opponentCase',['opponentId','caseId']]]);
    addIndexes('casePowerOfAttorneys', [['poaCase',['powerOfAttorneyId','caseId']]]);
    addIndexes('caseRelations', [['sourceRelation',['sourceCaseId','relationType']],['targetRelation',['targetCaseId','relationType']]]);
    addIndexes('caseEvents', [['caseDate',['caseId','eventDate']]]);
    addIndexes('caseTasks', [['clientDue',['clientId','dueDate']],['caseDue',['caseId','dueDate']]]);
  },
  13:(db)=>{
    if(!db.objectStoreNames.contains('auditLog')){
      const store=db.createObjectStore('auditLog',{keyPath:'id',autoIncrement:true});
      store.createIndex('createdAt','createdAt',{unique:false});
      store.createIndex('store','store',{unique:false});
      store.createIndex('action','action',{unique:false});
      store.createIndex('recordId','recordId',{unique:false});
    }
  },
  14:(db, transaction)=>{
    if(!transaction || !db.objectStoreNames.contains('cases')) return;
    const store=transaction.objectStore('cases');
    if(!store.indexNames.contains('filingDate')) store.createIndex('filingDate','filingDate',{unique:false});
  },
};
export function migrate(db,oldVersion,transaction){for(let v=oldVersion+1;v<=14;v++)MIGRATIONS[v]?.(db,oldVersion,transaction)}

