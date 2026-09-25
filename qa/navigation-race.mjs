/* Rapid same-document hash navigation must leave the latest screen visible. */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};
try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /جاهزة/.test(document.querySelector('#dbStatus')?.textContent || ''), null, { timeout: 45000 });
  await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const date = '2025-01-15';
    await repo(STORES.cases).bulkAdd(Array.from({ length: 1000 }, (_, n) => ({ caseNumber: String(n + 1), caseYear: 2025, status: 'open', archived: 0 })), { chunkSize: 500 });
    await repo(STORES.hearings).bulkAdd(Array.from({ length: 3000 }, (_, n) => ({ caseId: n % 1000 + 1, date, time: '10:00', status: 'scheduled' })), { chunkSize: 500 });
    await repo(STORES.caseTasks).bulkAdd(Array.from({ length: 1000 }, (_, n) => ({ caseId: n % 1000 + 1, title: `مهمة ${n}`, dueDate: date, status: 'open' })), { chunkSize: 500 });
  });
  for (const route of ['dashboard', 'cases', 'clients', 'hearings', 'tasks']) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${BASE}/index.html#/${route}`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('#addTask', { timeout: 15000 });
  await page.waitForTimeout(350);
  const task = await page.evaluate(() => ({
    hash: location.hash,
    title: document.querySelector('#pageTitle')?.textContent,
    visible: Boolean(document.querySelector('#addTask')),
    loading: document.querySelector('#page')?.textContent.includes('جاري التحميل')
  }));
  check('Fast navigation settles on the latest tasks page', task.visible && task.hash === '#/tasks' && task.title === 'المهام' && !task.loading, JSON.stringify(task));

  await page.goto(`${BASE}/index.html#/hearings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#addHearing', { timeout: 15000 });
  await page.waitForTimeout(350);
  check('Earlier render never repaints over a later hearing page', await page.locator('#addHearing').count() === 1 && await page.locator('#addTask').count() === 0);
  check('No browser errors during rapid navigation', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context.close();
  await browser.close();
}
console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} passed`);
if (checks.some(c => !c.ok)) process.exitCode = 1;
