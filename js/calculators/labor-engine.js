import {isActive} from '../core/utils.js';
import { repo } from '../db/repositories.js';
import { STORES } from '../core/constants.js';
import { addDays, toDate, toISODate } from '../core/dates.js';
import { ensureRuleSet, requireRuleMetadata } from './rule-metadata.js';
import { parseMoneyMinor } from '../core/money.js';

const NOW = () => new Date().toISOString();
const SOURCE_URL = 'https://lawhub.info/eg/?p=11848';
const VERSION = '2026-09-24-verified';

export const LABOR_RULES = Object.freeze([
  { ruleId:'egypt-labor-individual-dispute-request', name:'طلب التسوية الودية للنزاع الفردي', category:'labor-dispute', jurisdiction:'Egypt', effectiveFrom:'2025-09-01', effectiveTo:null, duration:10, unit:'days', startRule:'date-of-dispute', firstDayRule:'rule-specific-review-required', lastDayRule:'include-last-day-subject-to-legal-review', holidayRule:'not-automatically-applied', weekendRule:'none', sourceType:'legislation', source:'قانون العمل رقم 14 لسنة 2025', sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 149', sourceUrl:SOURCE_URL, notes:'يجوز لأي من طرفي النزاع خلال عشرة أيام من تاريخ نشوء النزاع أن يطلب تسويته ودياً. لا يحسم البرنامج وحده طريقة حساب الميعاد في كل واقعة أو أثر العطلات والظروف الخاصة.', active:true, version:VERSION, verificationDate:'2026-09-24' },
  { ruleId:'egypt-labor-settlement-committee', name:'انتهاء لجنة تسوية النزاع الفردي من أعمالها', category:'labor-dispute', jurisdiction:'Egypt', effectiveFrom:'2025-09-01', effectiveTo:null, duration:21, unit:'days', startRule:'date-of-settlement-request', firstDayRule:'rule-specific-review-required', lastDayRule:'include-last-day-subject-to-legal-review', holidayRule:'not-automatically-applied', weekendRule:'none', sourceType:'legislation', source:'قانون العمل رقم 14 لسنة 2025', sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 149', sourceUrl:SOURCE_URL, notes:'يجب أن تنتهي اللجنة من أعمالها خلال واحد وعشرين يوماً من تاريخ تقديم الطلب. هذا ميعاد لعمل اللجنة وليس ميعاداً لإقامة دعوى.', active:true, version:VERSION, verificationDate:'2026-09-24' },
  { ruleId:'egypt-labor-court-session-setting', name:'تحديد جلسة النزاع العمالي بعد الإحالة', category:'labor-dispute', jurisdiction:'Egypt', effectiveFrom:'2025-09-01', effectiveTo:null, duration:20, unit:'days', startRule:'date-of-referral-request', firstDayRule:'rule-specific-review-required', lastDayRule:'include-last-day-subject-to-legal-review', holidayRule:'not-automatically-applied', weekendRule:'none', sourceType:'legislation', source:'قانون العمل رقم 14 لسنة 2025', sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 150', sourceUrl:SOURCE_URL, notes:'يلتزم قلم كتاب المحكمة بتحديد جلسة لنظر النزاع في مدة لا تجاوز عشرين يوماً من تاريخ ورود الطلب. لا يمثل ذلك في ذاته ميعاد سقوط لحق الخصم.', active:true, version:VERSION, verificationDate:'2026-09-24' },
  { ruleId:'egypt-labor-experience-certificate', name:'منح شهادة انتهاء الخدمة', category:'labor-employer-obligation', jurisdiction:'Egypt', effectiveFrom:'2025-09-01', effectiveTo:null, duration:15, unit:'days', startRule:'date-of-certificate-request', firstDayRule:'rule-specific-review-required', lastDayRule:'include-last-day-subject-to-legal-review', holidayRule:'not-automatically-applied', weekendRule:'none', sourceType:'legislation', source:'قانون العمل رقم 14 لسنة 2025', sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 175', sourceUrl:SOURCE_URL, notes:'يلتزم صاحب العمل بمنح الشهادة خلال خمسة عشر يوماً من تاريخ طلبها.', active:true, version:VERSION, verificationDate:'2026-09-24' },
  { ruleId:'egypt-labor-indefinite-notice', name:'مهلة إخطار إنهاء العقد غير محدد المدة', category:'labor-termination', jurisdiction:'Egypt', effectiveFrom:'2025-09-01', effectiveTo:null, duration:3, unit:'months', startRule:'date-notice-received', firstDayRule:'rule-specific-review-required', lastDayRule:'rule-specific-review-required', holidayRule:'not-automatically-applied', weekendRule:'none', sourceType:'legislation', source:'قانون العمل رقم 14 لسنة 2025', sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 156، مع مراعاة المواد 158 إلى 164', sourceUrl:SOURCE_URL, notes:'المدة ثلاثة أشهر. يبدأ سريان مهلة الإخطار من تاريخ تسلمه وفق المادة 158، مع مراعاة المادة 159 في الإجازات والمرضية. لا يحسم البرنامج هذه الوقائع تلقائياً.', active:true, version:VERSION, verificationDate:'2026-09-24' },
  { ruleId:'egypt-labor-sickness-notice', name:'إخطار إنهاء العقد بسبب المرض', category:'labor-termination', jurisdiction:'Egypt', effectiveFrom:'2025-09-01', effectiveTo:null, duration:15, unit:'days', startRule:'date-of-exhaustion-of-leave', firstDayRule:'rule-specific-review-required', lastDayRule:'rule-specific-review-required', holidayRule:'not-automatically-applied', weekendRule:'none', sourceType:'legislation', source:'قانون العمل رقم 14 لسنة 2025', sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 173', sourceUrl:SOURCE_URL, notes:'على صاحب العمل أن يخطر العامل برغبته في إنهاء العقد قبل مضي خمسة عشر يوماً من تاريخ استنفاد العامل لإجازاته، مع القيود الواردة بالمادة 173.', active:true, version:VERSION, verificationDate:'2026-09-24' }
]);

function parseISODate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))) return null;
  const [y,m,d]=String(value).split('-').map(Number);
  const x=new Date(y,m-1,d);
  return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?x:null;
}
function addMonths(date, months){
  const d=toDate(date); if(!d) return null;
  const day=d.getDate(); const result=new Date(d.getFullYear(),d.getMonth()+Number(months),1);
  const last=new Date(result.getFullYear(),result.getMonth()+1,0).getDate();
  result.setDate(Math.min(day,last));
  return result;
}

export async function ensureLaborRules(){
  await ensureRuleSet(LABOR_RULES);
}
export async function listLaborRules(){
  const rows=await repo(STORES.legalRules).all({ limit: 500 });
  return rows.filter(x=>isActive(x)&&String(x.ruleId||'').startsWith('egypt-labor-')).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
}
export async function calculateLaborDeadline({ruleId,startDate,caseId=null,notes=''}){
  const start=parseISODate(startDate); if(!start) throw new Error('أدخل تاريخ بدء صحيحاً بصيغة YYYY-MM-DD.');
  const rule=await repo(STORES.legalRules).get(Number(ruleId)); if(!rule) throw new Error('القاعدة العمالية غير موجودة.');
  requireRuleMetadata(rule);
  if(!String(rule.ruleId||'').startsWith('egypt-labor-')) throw new Error('هذه ليست قاعدة عمالية.');
  let deadline=rule.unit==='months'?addMonths(start,rule.duration):addDays(start,rule.duration);
  const warnings=[
    'الحساب إرشادي قابل للمراجعة ولا يحسم وحده بدء الميعاد أو أثر الإجازات والعطلات أو الوقف والانقطاع أو أي نص خاص.',
    'تم استخدام التاريخ المدخل كنقطة بداية كما هي؛ يجب التحقق من الواقعة والسند القانوني الذي يحددها قبل الاعتماد.'
  ];
  if(rule.ruleId==='egypt-labor-indefinite-notice') warnings.push('مهلة الثلاثة أشهر مرتبطة بعقد غير محدد المدة وبإخطار كتابي، وتخضع للمادتين 158 و159؛ البرنامج لا يتحقق من صحة الإخطار أو الإجازات تلقائياً.');
  return {ruleId:rule.id,ruleKey:rule.ruleId,ruleVersion:rule.version,ruleName:rule.name,startDate:toISODate(start),duration:Number(rule.duration),unit:rule.unit,deadline:toISODate(deadline),calculatedAt:NOW(),warnings,assumptions:[rule.firstDayRule,rule.lastDayRule,rule.holidayRule],sourceReference:rule.sourceReference,sourceUrl:rule.sourceUrl,caseId:caseId?Number(caseId):null,notes};
}
export async function saveLaborCalculation(result){
  return repo(STORES.calculationHistory).add({calculatorType:'labor-deadline',caseId:result.caseId||null,ruleId:result.ruleId,ruleVersion:result.ruleVersion,inputs:{startDate:result.startDate,duration:result.duration,unit:result.unit},result:{deadline:result.deadline},warnings:result.warnings,assumptions:result.assumptions,calculatedAt:result.calculatedAt,notes:result.notes||''});
}

function quantity(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('المدة أو عدد الأيام يجب أن يكون غير سالب.');
  return number;
}
function roundedMinor(value) {
  const minor = Math.round(value);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('القيمة المالية تتجاوز الحد الآمن.');
  return minor;
}

export const ENTITLEMENT_RULES=Object.freeze([
  {id:'notice-compensation',name:'مقابل مهلة الإخطار غير المنفذة',sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 164',sourceUrl:SOURCE_URL},
  {id:'unlawful-termination-minimum',name:'الحد الأدنى لتعويض الإنهاء غير المشروع',sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 165',sourceUrl:SOURCE_URL},
  {id:'leave-balance',name:'مقابل رصيد الإجازات السنوية',sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادتان 124 و125',sourceUrl:SOURCE_URL},
  {id:'post-60-gratuity',name:'مكافأة مدة العمل بعد سن الستين',sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 172',sourceUrl:SOURCE_URL},
  {id:'fixed-term-over-5-years',name:'مكافأة إنهاء العقد الذي تجاوز خمس سنوات من جانب صاحب العمل',sourceReference:'قانون العمل رقم 14 لسنة 2025 — المادة 154',sourceUrl:SOURCE_URL}
].map(rule => Object.freeze({
  ...rule, ruleId: `egypt-labor-${rule.id}`, source: 'قانون العمل رقم 14 لسنة 2025',
  effectiveFrom: '2025-09-01', version: VERSION, verificationDate: '2026-09-24'
})));

export function calculateEntitlements(input) {
  const warnings=['النتيجة حسابية وليست حكماً باستحقاق المبلغ. يجب التحقق من توافر شروط المادة والنزاع والوقائع والأجر القانوني المستخدم في الحساب.'];
  const items=[];
  const monthlyWageMinor=parseMoneyMinor(input.monthlyWage,{emptyValue:0});
  const dailyWageMinor=input.dailyWage == null || input.dailyWage === ''
    ? monthlyWageMinor/30 : parseMoneyMinor(input.dailyWage);
  const noticeMonths=quantity(input.noticeMonths);
  const leaveDays=quantity(input.leaveDays);
  const serviceYears=quantity(input.serviceYears);
  const addItem=(key,label,rawMinor,formula)=>{
    const amountMinor=roundedMinor(rawMinor);
    items.push({key,label,amountMinor,amount:amountMinor/100,formula});
  };
  if(noticeMonths>0){
    addItem('notice-compensation','مقابل مهلة الإخطار',monthlyWageMinor*noticeMonths,`${monthlyWageMinor/100} × ${noticeMonths} شهر`);
    warnings.push('مقابل الإخطار يتطلب تحديد جهة الإنهاء وحالة العقد وما إذا كان هناك جزء غير منفذ من المهلة وفق المادة 164.');
  }
  if(leaveDays>0){
    addItem('leave-balance','مقابل رصيد الإجازات المدخل',dailyWageMinor*leaveDays,`${(dailyWageMinor/100).toFixed(2)} × ${leaveDays} يوم`);
    warnings.push('رصيد الإجازات رقم مدخل من المستخدم؛ البرنامج لا يستنتج الرصيد من سنوات الخدمة أو السجلات.');
  }
  if(serviceYears>0){
    if(input.unlawfulTermination==='yes'){
      addItem('unlawful-termination-minimum','الحد الأدنى الحسابي لتعويض الإنهاء غير المشروع',monthlyWageMinor*2*serviceYears,`${monthlyWageMinor/100} × 2 × ${serviceYears} سنة`);
      warnings.push('المادة 165 تقرر حداً أدنى للتعويض في حالة إنهاء العقد غير محدد المدة لسبب غير مشروع؛ البرنامج لا يقرر أن الإنهاء غير مشروع.');
    }
    if(input.post60==='yes'){
      const first=Math.min(5,serviceYears),rest=Math.max(0,serviceYears-5);
      addItem('post-60-gratuity','مكافأة مدة العمل بعد سن الستين',monthlyWageMinor*(0.5*first+rest),`${monthlyWageMinor/100} × (0.5 × ${first} + ${rest})`);
      warnings.push('هذا الحساب يفترض أن سنوات الخدمة المدخلة هي السنوات التي ينطبق عليها حكم المادة 172 وأن شرط عدم وجود حقوق عن المدة وفق تأمين الشيخوخة والعجز والوفاة متحقق؛ يجب التحقق منه.');
    }
    if(input.fixedTermOver5==='yes'){
      addItem('fixed-term-over-5-years','مكافأة العقد الذي تجاوز خمس سنوات',monthlyWageMinor*serviceYears,`${monthlyWageMinor/100} × ${serviceYears} سنة`);
      warnings.push('الحساب مخصص للحالة الواردة بالمادة 154 عند إنهاء صاحب العمل بعد تجاوز المدة المشار إليها، ولا يقرر البرنامج تحقق شروطها.');
    }
  }
  const totalMinor=roundedMinor(items.reduce((sum,item)=>sum+item.amountMinor,0));
  return {
    calculatorType:'labor-entitlements',items,totalMinor,total:totalMinor/100,currency:'EGP',calculatedAt:NOW(),warnings,
    inputs:{monthlyWageMinor,dailyWageMinor:roundedMinor(dailyWageMinor),noticeMonths,leaveDays,serviceYears,
      unlawfulTermination:input.unlawfulTermination||'no',post60:input.post60||'no',fixedTermOver5:input.fixedTermOver5||'no'}
  };
}
export async function saveEntitlementCalculation(result,caseId=null){
  return repo(STORES.calculationHistory).add({calculatorType:'labor-entitlements',caseId:caseId?Number(caseId):null,ruleId:'labor-entitlements-bundle',ruleVersion:VERSION,inputs:result.inputs,result:{items:result.items.map(({amount,...item})=>item),totalMinor:result.totalMinor,currency:result.currency},warnings:result.warnings,assumptions:['الحساب مبني على البيانات التي أدخلها المستخدم'],calculatedAt:result.calculatedAt,notes:''});
}
