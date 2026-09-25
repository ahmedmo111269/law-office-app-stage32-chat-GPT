/* Complete Medium and Large runs from the real in-browser benchmark controls.
 * Persistent disposable Chromium profile gives the synthetic DB an explicit
 * storage quota; only the five benchmark stores are cleared afterwards. */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const profile = mkdtempSync(`${tmpdir()}/law-office-benchmark-`);
const checks = [];
const errors = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    viewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const office = context.pages()[0] || await context.newPage();
  office.on('pageerror', error => errors.push('office: ' + error.message));
  await office.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await office.waitForFunction(() => /جاهزة/.test(document.querySelector('#dbStatus')?.textContent || ''), null, { timeout: 45000 });
  const before = await office.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const id = await repo(STORES.clients).add({ fullName: 'علامة حماية بيانات المكتب', archived: 0 });
    return { id, count: await repo(STORES.clients).count() };
  });
  const tool = await context.newPage();
  tool.on('pageerror', error => errors.push('benchmark: ' + error.message));
  tool.on('dialog', dialog => dialog.accept()); // The Large quota warning is acknowledged in this disposable profile.
  await tool.goto(`${BASE}/performance-load-test.html`, { waitUntil: 'domcontentloaded' });
  await tool.waitForSelector('#runTest');
  const quota = await tool.evaluate(async () => {
    const estimate = await navigator.storage.estimate();
    return Math.round(estimate.quota / 1048576);
  });
  console.log(`PERSISTENT PROFILE quota=${quota}MB; office sentinel id=${before.id}`);
  let previousIds = null;

  for (const [size, expected] of [['medium', 110000], ['large', 1100000]]) {
    // eslint-disable-next-line no-await-in-loop
    await tool.locator('#size').selectOption(size);
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await tool.locator('#runTest').click();
    // eslint-disable-next-line no-await-in-loop
    await tool.waitForFunction(() => ['complete', 'failed'].includes(document.querySelector('#status')?.dataset.state)
      && !document.querySelector('#clearTest')?.disabled, null, { timeout: size === 'large' ? 900000 : 300000 });
    // eslint-disable-next-line no-await-in-loop
    const state = await tool.evaluate(() => ({ state: document.querySelector('#status').dataset.state, log: document.querySelector('#results').textContent }));
    const resultLine = state.log.match(/^RESULT: (\{.*\})$/m)?.[1];
    const result = resultLine ? JSON.parse(resultLine) : null;
    const expectedCounts = size === 'medium'
      ? { clients: 10000, cases: 10000, hearings: 30000, procedures: 50000, caseTasks: 10000 }
      : { clients: 100000, cases: 100000, hearings: 300000, procedures: 500000, caseTasks: 100000 };
    const completed = state.state === 'complete' && result?.rows === expected
      && Object.entries(expectedCounts).every(([name, count]) => result.counts[name] === count)
      && result.page50Rows === 50 && result.deepRows === 1000 && result.linkedHearings === 3
      && Number.isSafeInteger(result.firstIds?.cases) && Number.isSafeInteger(result.firstIds?.clients)
      && result.firstCaseId === result.firstIds.cases && result.firstCaseClientId === result.firstIds.clients
      && (!previousIds || (result.firstIds.cases > previousIds.cases && result.firstIds.clients > previousIds.clients))
      && Number.isFinite(result.seedMs) && result.seedMs > 0;
    if (result) previousIds = result.firstIds;
    check(`${size}: writes, counts, actual FK keys, pages and index lookup`, completed,
      completed ? `rows=${result.rows} seed=${result.seedMs}ms page50=${result.page50Ms}ms deep=${result.deepPagesMs}ms storage=${JSON.stringify(result.storage)} wall=${Date.now() - started}ms`
        : state.log.slice(-700));
    // eslint-disable-next-line no-await-in-loop
    const empty = await tool.evaluate(async () => {
      const { benchmarkRepo } = await import('/js/db/repositories.js');
      const { BENCHMARK_STORES } = await import('/js/db/db.js');
      return Promise.all(BENCHMARK_STORES.map(name => benchmarkRepo(name).count()));
    });
    check(`${size}: cleanup empties only all synthetic stores`, empty.every(count => count === 0), empty.join(','));
    if (!completed) break; // Do not run a still larger test after a failed Medium run.
  }
  const officeAfter = await office.evaluate(async id => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    return { count: await repo(STORES.clients).count(), name: (await repo(STORES.clients).get(id))?.fullName };
  }, before.id);
  check('Medium/Large do not modify the office client', officeAfter.count === before.count && officeAfter.name === 'علامة حماية بيانات المكتب', JSON.stringify(officeAfter));
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(`\n${checks.filter(item => item.ok).length}/${checks.length} passed`);
if (checks.some(item => !item.ok)) process.exitCode = 1;
