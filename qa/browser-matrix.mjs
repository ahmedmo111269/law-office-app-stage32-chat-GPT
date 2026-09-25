/**
 * Click-through browser matrix for related legal-office workflows. Every write
 * here originates from a visible UI control; repository reads only verify the
 * persisted result. Runs in a fresh Chromium context and never changes user data.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Africa/Cairo', acceptDownloads: true });
const page = await context.newPage();
const results = [];
const errors = [];
page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
const record = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} ${detail}`);
};
const goto = async (path, marker) => {
  await page.goto(`${BASE}/index.html#/${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator(marker).first().waitFor({ timeout: 20000 });
};
const contains = async (selector, text, timeout = 7000) => {
  try {
    await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent?.includes(text), { selector, text }, { timeout });
    return true;
  } catch { return false; }
};
const selectFirst = async (selector) => {
  const options = await page.locator(selector).locator('option').evaluateAll(items => items.map(x => x.value).filter(Boolean));
  if (!options.length) throw new Error(`No selectable options for ${selector}`);
  await page.selectOption(selector, options[0]);
  return options[0];
};
const verify = async (store, predicate) => page.evaluate(async ({ store, predicate }) => {
  const { repo } = await import('/js/db/repositories.js');
  const rows = await repo(store).all({ limit: 50 });
  return rows.filter(r => Object.entries(predicate).every(([key, value]) => r[key] === value));
}, { store, predicate });

try {
  await goto('clients', '#addClient');
  await page.click('#addClient');
  await page.fill('#clientFullName', 'عميل مصفوفة الاختبار');
  await page.click('#clientForm button.primary-button');
  record('UI: create client', await contains('#clientsList', 'عميل مصفوفة الاختبار'));
  const clientId = Number(await page.getAttribute('[data-archive-client]', 'data-archive-client'));

  await goto('opponents', '#addOpponent');
  await page.click('#addOpponent');
  await page.fill('#opponentName', 'خصم مصفوفة الاختبار');
  await page.click('#opponentForm button.primary-button');
  record('UI: create opponent', await contains('#opponentsList', 'خصم مصفوفة الاختبار'));
  const opponentId = Number(await page.getAttribute('[data-archive-opponent]', 'data-archive-opponent'));

  await goto('cases', '#addCase');
  await page.click('#addCase');
  await page.locator('#caseForm').waitFor();
  await page.fill('#caseNumber', 'M-3601');
  await page.fill('#caseYear', '2026');
  await page.selectOption('#caseType', 'civil');
  await page.fill('#caseFilingDate', '2026-09-25');
  await page.fill('#caseSubject', 'قضية اختبار العلاقات');
  await page.click('#caseForm button.primary-button');
  record('UI: create case', await contains('#caseList', 'M-3601'));
  const firstHref = await page.getAttribute('#caseList a[href*="view=360"]', 'href');
  const caseId = Number(new URLSearchParams(firstHref.split('?')[1]).get('id'));

  await goto(`cases?id=${caseId}&view=360`, '#addClientRelation');
  await page.click('#addClientRelation');
  await page.locator('.modal-backdrop select[name="clientId"]').waitFor();
  await page.selectOption('.modal-backdrop select[name="clientId"]', String(clientId));
  await page.click('.modal-backdrop form button.primary-button');
  record('UI: case-client link appears without navigation', await contains('#page', 'عميل مصفوفة الاختبار'));
  record('DB: case-client link persists', (await verify('caseClients', { caseId, clientId })).length === 1);

  await page.locator('#addOpponentRelation').waitFor();
  await page.click('#addOpponentRelation');
  await page.locator('.modal-backdrop select[name="opponentId"]').waitFor();
  await page.selectOption('.modal-backdrop select[name="opponentId"]', String(opponentId));
  await page.fill('.modal-backdrop [name="role"]', 'مدعى عليه');
  await page.click('.modal-backdrop form button.primary-button');
  record('UI: case-opponent link appears without navigation', await contains('#page', 'خصم مصفوفة الاختبار'));
  record('DB: case-opponent link persists', (await verify('caseOpponents', { caseId, opponentId })).length === 1);

  await goto(`clients?id=${clientId}&view=360`, '#addClientPoa');
  await page.click('#addClientPoa');
  await page.locator('#poaForm').waitFor();
  await page.fill('#poaNumber', 'POA-MATRIX-77');
  await page.fill('#poaYear', '2026');
  await page.fill('#poaDate', '2026-09-25');
  await page.click('#poaForm button.primary-button');
  record('UI: create power of attorney for client', await contains('#clientPoaBlock', 'POA-MATRIX-77'));

  await goto(`cases?id=${caseId}&view=360`, '#addPoaRelation');
  await page.click('#addPoaRelation');
  await page.locator('.modal-backdrop select[name="poaId"]').waitFor();
  const poaId = Number(await selectFirst('.modal-backdrop select[name="poaId"]'));
  await page.click('.modal-backdrop form button.primary-button');
  record('UI: linked POA renders in Case 360', await contains('#page', 'POA-MATRIX-77'));
  record('DB: case-POA link persists', (await verify('casePowerOfAttorneys', { caseId, powerOfAttorneyId: poaId })).length === 1);

  await goto('cases', '#addCase');
  await page.click('#addCase');
  await page.locator('#caseForm').waitFor();
  await page.fill('#caseNumber', 'M-3602');
  await page.fill('#caseYear', '2026');
  await page.selectOption('#caseType', 'civil');
  await page.fill('#caseSubject', 'قضية ثانية للرسم البياني');
  await page.click('#caseForm button.primary-button');
  record('UI: create related second case', await contains('#caseList', 'M-3602'));
  const case2Link = await page.locator('#caseList a[href*="view=360"]').evaluateAll(links => links.find(a => a.closest('.case-list-row')?.textContent?.includes('M-3602'))?.getAttribute('href'));
  const case2Id = Number(new URLSearchParams(case2Link.split('?')[1]).get('id'));

  await goto(`cases?id=${caseId}&view=360`, '#addCaseRelation');
  await page.click('#addCaseRelation');
  await page.selectOption('.modal-backdrop select[name="targetCaseId"]', String(case2Id));
  await page.click('.modal-backdrop form button.primary-button');
  try { await page.waitForFunction(() => document.querySelectorAll('.case-graph-node').length >= 2, null, { timeout: 7000 }); } catch {}
  record('UI: case graph has two nodes after link', (await page.locator('.case-graph-node').count()) >= 2);
  record('DB: graph relation persists', (await verify('caseRelations', { sourceCaseId: caseId, targetCaseId: case2Id })).length === 1);

  await page.click('#addCaseEvent');
  await page.fill('.modal-backdrop [name="title"]', 'حدث مصفوفة الزمن');
  await page.click('.modal-backdrop form button.primary-button');
  record('UI: timeline shows freshly added event', await contains('.case-timeline', 'حدث مصفوفة الزمن'));

  await goto('hearings', '#addHearing');
  await page.click('#addHearing');
  await page.locator('#hearingForm').waitFor();
  await page.selectOption('#hearingForm [name="caseId"]', String(caseId));
  await page.fill('#hearingForm [name="date"]', '2026-09-25');
  await page.fill('#hearingForm [name="time"]', '10:30');
  await page.fill('#hearingForm [name="result"]', 'جلسة مصفوفة');
  await page.click('#hearingForm button.primary-button');
  record('UI: hearing appears after save in same route', await contains('#hearingList', 'جلسة مصفوفة'));
  const hearingId = Number(await page.getAttribute('#hearingList [data-edit]', 'data-edit'));

  await goto('procedures', '#addProcedure');
  await page.click('#addProcedure');
  await page.locator('#procedureForm').waitFor();
  await page.selectOption('#procedureForm [name="caseId"]', String(caseId));
  await page.fill('#procedureForm [name="date"]', '2026-09-25');
  await page.selectOption('#procedureForm [name="relatedHearingId"]', String(hearingId));
  await page.fill('#procedureForm [name="description"]', 'إجراء مصفوفة الاختبار');
  await page.click('#procedureForm button.primary-button');
  record('UI: procedure appears after save in same route', await contains('#procedureList', 'إجراء مصفوفة الاختبار'));
  record('DB: procedure links to hearing', (await verify('procedures', { caseId, relatedHearingId: hearingId })).length === 1);

  await goto('tasks', '#addTask');
  await page.click('#addTask');
  await page.locator('#taskForm').waitFor();
  await page.fill('#taskForm [name="title"]', 'مهمة من مصفوفة الاختبار');
  await page.fill('#taskForm [name="dueDate"]', '2026-09-26');
  await page.selectOption('#taskForm [name="caseId"]', String(caseId));
  await page.click('#taskForm button.primary-button');
  record('UI: task appears after save in same route', await contains('#taskList', 'مهمة من مصفوفة الاختبار'));
  await page.click('#taskList [data-complete]');
  record('UI: task completion updates button', await contains('#taskList', 'مكتملة'));
  record('DB: task status completed', (await verify('caseTasks', { status: 'completed' })).length >= 1);

  await goto('judgments', '#addJudgment');
  await page.click('#addJudgment');
  await page.locator('#judgmentForm').waitFor();
  await page.selectOption('#judgmentForm [name="caseId"]', String(caseId));
  await page.fill('#judgmentForm [name="number"]', 'J-MATRIX-21');
  await page.fill('#judgmentForm [name="year"]', '2026');
  await page.fill('#judgmentForm [name="date"]', '2026-09-25');
  await page.click('#judgmentForm button.primary-button');
  record('UI: judgment appears after save in same route', await contains('#judgmentList', 'J-MATRIX-21'));
  const judgmentId = Number(await page.getAttribute('#judgmentList [data-edit]', 'data-edit'));

  await goto('appeals', '#addAppeal');
  await page.click('#addAppeal');
  await page.locator('#appealForm').waitFor();
  await page.selectOption('#appealCase', String(caseId));
  await page.selectOption('#appealJudgment', String(judgmentId));
  await page.fill('#appealForm [name="number"]', 'A-MATRIX-31');
  await page.fill('#appealForm [name="year"]', '2026');
  await page.fill('#appealForm [name="filingDate"]', '2026-09-25');
  await page.click('#appealForm button.primary-button');
  record('UI: appeal appears after save in same route', await contains('#appealList', 'A-MATRIX-31'));
  record('DB: appeal links correct judgment', (await verify('appeals', { caseId, judgmentId })).length === 1);

  await goto('financial', '#addFinancial');
  await page.click('#addFinancial');
  await page.locator('#financialRecordForm').waitFor();
  await page.selectOption('#financialRecordForm [name="clientId"]', String(clientId));
  await page.selectOption('#financialRecordForm [name="caseId"]', String(caseId));
  await page.fill('#financialRecordForm [name="amount"]', '123.45');
  await page.fill('#financialRecordForm [name="date"]', '2026-09-25');
  await page.fill('#financialRecordForm [name="description"]', 'تحصيل مصفوفة');
  await page.click('#financialRecordForm button.primary-button');
  record('UI: finance shows amount in pounds', await contains('#page', '123.45'));
  record('DB: amount persists in minor units', (await verify('financialRecords', { caseId, amountMinor: 12345 })).length === 1);

  await goto('family', '#newFamily');
  await page.click('#newFamily');
  await page.locator('#familyForm').waitFor();
  await page.selectOption('#familyForm [name="caseId"]', String(caseId));
  await page.fill('#familyForm [name="beneficiaryName"]', 'مستفيد مصفوفة');
  await page.fill('#familyForm [name="monthlyAmount"]', '100.00');
  await page.fill('#familyForm [name="startDate"]', '2026-01-01');
  await page.fill('#familyForm [name="endDate"]', '2026-02-28');
  await page.click('#familyForm button.primary-button');
  await page.locator('[data-open]').first().waitFor();
  await page.click('[data-open]');
  await page.locator('#addPeriod').waitFor();
  await page.click('#addPeriod');
  const periodForm = page.locator('#page > .card').last().locator('form');
  await periodForm.locator('[name="fromDate"]').fill('2026-01-01');
  await periodForm.locator('[name="toDate"]').fill('2026-02-28');
  await periodForm.locator('[name="monthlyAmount"]').fill('100.00');
  await periodForm.locator('button.primary-button').click();
  await page.waitForFunction(() => document.querySelector('#page')?.textContent?.includes('2026-01-01 → 2026-02-28'), null, { timeout: 7000 });
  await page.click('#addPayment');
  const paymentForm = page.locator('#page > .card').last().locator('form');
  await paymentForm.locator('[name="paymentDate"]').fill('2026-01-15');
  await paymentForm.locator('[name="amount"]').fill('50.00');
  await paymentForm.locator('button.primary-button').click();
  await page.waitForFunction(() => document.querySelector('#page')?.textContent?.includes('2026-01-15'), null, { timeout: 7000 });
  record('DB: family payment stored as amountMinor', (await verify('familyPayments', { amountMinor: 5000 })).length === 1);
  await page.click('#calcForm button.primary-button');
  await page.waitForFunction(() => (document.querySelector('#calcResult')?.textContent?.length || 0) > 20, null, { timeout: 7000 });
  const arrears = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const rows = await repo('calculationHistory').all({ limit: 20, direction: 'prev' });
    return rows.find(r => r.calculatorType === 'family-maintenance-arrears')?.result;
  });
  record('UI: family arrears subtracts recorded payment', arrears?.totalDueMinor === 20000 && arrears?.totalPaidMinor === 5000 && arrears?.remainingMinor === 15000, JSON.stringify(arrears || {}));

  await goto('labor', '#addLabor');
  await page.click('#addLabor');
  await page.locator('#laborForm').waitFor();
  await page.selectOption('#laborForm [name="caseId"]', String(caseId));
  await page.fill('#laborForm [name="employerName"]', 'صاحب عمل مصفوفة');
  await page.fill('#laborForm [name="wage"]', '١٠٠٫٥٠');
  await page.click('#laborForm button.primary-button');
  record('UI: labor record visible after save', await contains('#laborList', 'صاحب عمل مصفوفة'));
  record('DB: labor wage kept in integer minor units', (await verify('laborDetails', { caseId, wageMinor: 10050 })).length === 1);

  await goto('calculators', '#deadlineForm');
  const selectedRule = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const matches = await repo('legalRules').byIndex('ruleId', 'egypt-civil-appeal-general', { limit: 1 });
    return String(matches.rows[0]?.id || '');
  });
  await page.selectOption('#ruleId', selectedRule);
  await page.fill('#startDate', '2026-09-25');
  await page.click('#deadlineForm button.primary-button');
  record('UI: legal calculator produces a dated result', await contains('#deadlineResult', 'النتيجة الحسابية'));
  const calculation = await page.evaluate(async ruleId => {
    const { repo } = await import('/js/db/repositories.js');
    const rows = await repo('calculationHistory').all({ limit: 30, direction: 'prev' });
    return rows.some(r => Number(r.ruleId) === Number(ruleId) && !!r.result?.deadline);
  }, selectedRule);
  record('DB: calculator saves the rule-specific result', calculation, `rule #${selectedRule}`);

  await goto('data-quality', '#run');
  await page.click('#run');
  await page.waitForFunction(() => /PASS|FAIL/.test(document.querySelector('#summary')?.textContent || ''), null, { timeout: 15000 });
  const reportPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#export');
  const reportFile = await reportPromise;
  const report = reportFile && JSON.parse(readFileSync(await reportFile.path(), 'utf8'));
  record('UI: data-quality report downloads actual JSON', !!report && !!report.checkedAt && report.mode === 'cursor-stream', reportFile?.suggestedFilename() || 'no download');

  await goto('appeals', '#appealList [data-archive]');
  await page.click('#appealList [data-archive]');
  await page.click('.modal-backdrop [data-confirm]');
  try { await page.waitForFunction(() => !document.querySelector('#appealList')?.textContent?.includes('A-MATRIX-31'), null, { timeout: 6000 }); } catch {}
  record('UI: archive appeal removes it from the list', !(await page.textContent('#appealList')).includes('A-MATRIX-31'));
  record('DB: archived appeal remains intact', (await verify('appeals', { caseId, judgmentId, archived: 1 })).length === 1);

  await goto('opponents', '#opponentsList [data-archive-opponent]');
  page.once('dialog', dialog => dialog.accept());
  await page.click(`[data-archive-opponent="${opponentId}"]`);
  try { await page.waitForFunction(() => !document.querySelector('#opponentsList')?.textContent?.includes('خصم مصفوفة الاختبار'), null, { timeout: 6000 }); } catch {}
  record('UI: archive opponent removes it from the list', !(await page.textContent('#opponentsList')).includes('خصم مصفوفة الاختبار'));
  record('DB: archived opponent remains intact', (await verify('opponents', { id: opponentId, archived: 1 })).length === 1);

  await goto('cases', '#caseList');
  page.once('dialog', dialog => dialog.accept());
  await page.click(`#caseList [data-archive-case="${caseId}"]`);
  try { await page.waitForFunction(id => !document.querySelector(`#caseList [data-archive-case="${id}"]`), caseId, { timeout: 6000 }); } catch {}
  record('UI: archive case removes it from the list', await page.locator(`#caseList [data-archive-case="${caseId}"]`).count() === 0);
  await goto('archive', `[data-restore="cases:${caseId}"]`);
  page.once('dialog', dialog => dialog.accept());
  await page.click(`[data-restore="cases:${caseId}"]`);
  await page.waitForFunction(id => !document.querySelector(`[data-restore="cases:${id}"]`), caseId, { timeout: 8000 });
  await goto('cases', `#caseList [data-archive-case="${caseId}"]`);
  record('UI: restore case from archive returns it to active list', (await verify('cases', { id: caseId, archived: 0 })).length === 1);

  record('Browser: no page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  console.error('TEST ABORT:', error.stack || error.message);
  record('Browser matrix completed without abort', false, String(error.message).slice(0, 120));
} finally {
  const failed = results.filter(r => !r.ok);
  console.log(`\n============ BROWSER MATRIX: ${results.length - failed.length}/${results.length} PASSED ============`);
  if (failed.length) console.log('FAILED:', failed.map(r => r.name).join(', '));
  console.log('console/page errors:', errors.length ? errors : '(none)');
  await browser.close();
  if (failed.length || errors.length) process.exitCode = 1;
}
