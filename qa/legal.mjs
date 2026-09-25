/** Browser checks for metadata, historical backfill, date-only calculations, and minor-unit payments. */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} ${detail}`);
};
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ timezoneId: 'Africa/Cairo' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /جاهزة/.test(document.querySelector('#dbStatus')?.textContent), null, { timeout: 20000 });
  const data = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { missingRuleMetadata } = await import('/js/calculators/rule-metadata.js');
    const legal = await import('/js/calculators/legal-engine.js');
    const labor = await import('/js/calculators/labor-engine.js');
    const family = await import('/js/calculators/family-engine.js');
    const admin = await import('/js/calculators/administrative-engine.js');
    const criminal = await import('/js/criminal/criminal-engine.js');
    const { toISODate, addDays } = await import('/js/core/dates.js');
    const { parseMoneyMinor } = await import('/js/core/money.js');
    const all = await repo('legalRules').all({ limit: 200 });
    const missing = all.flatMap(rule => missingRuleMetadata(rule).map(field => `${rule.ruleId}:${field}`));
    const otherMissing = [...labor.ENTITLEMENT_RULES, ...criminal.listCriminalLawVersions()].flatMap(rule => missingRuleMetadata(rule));
    const appealRule = all.find(rule => rule.ruleId === 'egypt-civil-appeal-general');
    const appeal = await legal.calculateDeadline({ ruleId: appealRule.id, startDate: '2026-09-25', applyHolidays: false });
    const laborRule = all.find(rule => rule.ruleId === 'egypt-labor-individual-dispute-request');
    const laborDeadline = await labor.calculateLaborDeadline({ ruleId: laborRule.id, startDate: '2026-09-25' });
    const adminRule = all.find(rule => rule.ruleId === 'egypt-admin-cancellation-60');
    const adminDeadline = await admin.calculateAdministrativeDeadline({ ruleId: adminRule.id, startDate: '2026-09-25' });
    const arrears = family.calculateArrears({
      fromDate: '2026-01-01', toDate: '2026-02-28',
      periods: [{ fromDate: '2026-01-01', toDate: '2026-02-28', monthlyAmountMinor: 10000 }],
      payments: [{ paymentDate: '2026-01-15', amountMinor: 5000 }]
    });
    const legacyAmount = family.calculateArrears({
      fromDate: '2026-01-01', toDate: '2026-01-31',
      periods: [{ fromDate: '2026-01-01', toDate: '2026-01-31', monthlyAmountMinor: 10000 }],
      payments: [{ paymentDate: '2026-01-15', amount: '50.00' }]
    });
    const finance = { westernDigits: parseMoneyMinor('123.45'), arabicDigits: parseMoneyMinor('١٢٣٫٤٥'), tooPreciseRejected: false };
    try { parseMoneyMinor('1.999'); } catch { finance.tooPreciseRejected = true; }
    const criminalBefore = criminal.getCriminalLawVersion('2026-09-30')?.ruleId;
    const criminalAfter = criminal.getCriminalLawVersion('2026-10-01')?.ruleId;
    const savedNotes = 'تحرير المستخدم — لا يجب استبداله';
    const copy = { ...appealRule, notes: savedNotes };
    delete copy.source;
    await repo('legalRules').put(copy);
    await legal.ensureSeedRules();
    const recovered = await repo('legalRules').get(appealRule.id);
    const invalidId = await repo('legalRules').add({
      ruleId: 'custom-unverified-test', name: 'قاعدة غير موثقة', active: 1,
      duration: 3, unit: 'days', effectiveFrom: '2026-01-01'
    });
    let invalidRejected = false;
    try { await legal.calculateDeadline({ ruleId: invalidId, startDate: '2026-09-25' }); }
    catch (e) { invalidRejected = e.message.includes('ناقصة بيانات التوثيق'); }
    await repo('legalRules').delete(invalidId, { track: false });
    return {
      ruleCount: all.length, missing, otherMissing,
      appeal: { deadline: appeal.deadline, expected: toISODate(addDays('2026-09-25', 40)) },
      labor: laborDeadline.deadline, admin: adminDeadline.deadline,
      arrears: { totalDueMinor: arrears.totalDueMinor, totalPaidMinor: arrears.totalPaidMinor, remainingMinor: arrears.remainingMinor },
      legacyPaid: legacyAmount.totalPaidMinor, finance,
      criminalBefore, criminalAfter,
      recovered: { source: recovered.source, preservedNotes: recovered.notes === savedNotes, verificationDate: recovered.verificationDate },
      invalidRejected
    };
  });
  record('Rules: every seeded and catalogue rule has 7 fields', data.ruleCount >= 16 && data.missing.length === 0 && data.otherMissing.length === 0, `${data.ruleCount} seeded, missing=${data.missing.concat(data.otherMissing).join(',') || 'none'}`);
  record('Civil deadline: 40 calendar days, ISO local date', data.appeal.deadline === data.appeal.expected, JSON.stringify(data.appeal));
  record('Labor & admin deadline calculators run', /^\d{4}-\d{2}-\d{2}$/.test(data.labor) && /^\d{4}-\d{2}-\d{2}$/.test(data.admin), `labor=${data.labor} admin=${data.admin}`);
  record('Family: saved payment reduces arrears exactly', data.arrears.totalDueMinor === 20000 && data.arrears.totalPaidMinor === 5000 && data.arrears.remainingMinor === 15000, JSON.stringify(data.arrears));
  record('Family: legacy decimal input still converts to minor', data.legacyPaid === 5000, `paid=${data.legacyPaid}`);
  record('Currency: Arabic decimals + precision validation', data.finance.westernDigits === 12345 && data.finance.arabicDigits === 12345 && data.finance.tooPreciseRejected, JSON.stringify(data.finance));
  record('Criminal procedure law switches at 2026-10-01', data.criminalBefore === 'egypt-criminal-procedure-legacy' && data.criminalAfter === 'egypt-criminal-procedure-174-2025', `${data.criminalBefore} → ${data.criminalAfter}`);
  record('Known-rule metadata backfills without overwriting notes', !!data.recovered.source && data.recovered.preservedNotes && data.recovered.verificationDate === '2026-09-24', JSON.stringify(data.recovered));
  record('Undocumented custom rule cannot be calculated', data.invalidRejected);
  record('Browser has no page/console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  console.error('TEST ABORT:', error.stack || error.message);
  record('Legal checks complete without abort', false, error.message);
} finally {
  const failed = results.filter(r => !r.ok);
  console.log(`\n=========== LEGAL & MONEY: ${results.length - failed.length}/${results.length} PASSED ===========`);
  await browser.close();
  if (failed.length || errors.length) process.exitCode = 1;
}
