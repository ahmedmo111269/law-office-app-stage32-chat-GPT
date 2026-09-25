/* In-browser isolated load-tool regression: real writes, measurement and cleanup. */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();
const app = await context.newPage();
const errors = [];
app.on('pageerror', error => errors.push(error.message));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};
try {
  await app.goto(`${BASE}/index.html#/performance`, { waitUntil: 'domcontentloaded' });
  await app.waitForSelector('a[href="./performance-load-test.html"]', { timeout: 30000 });
  const before = await app.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    return repo(STORES.clients).count();
  });
  const tool = await context.newPage();
  tool.on('pageerror', error => errors.push(error.message));
  const response = await tool.goto(`${BASE}/performance-load-test.html`, { waitUntil: 'domcontentloaded' });
  await tool.waitForSelector('#runTest');
  check('Performance link targets a real local page', response.status() === 200 && (await tool.title()).includes('⚖️ مكتب الأستاذ / أحمد محمد خضير المحامى'));
  await tool.locator('#runTest').click();
  await tool.waitForFunction(() => ['complete', 'failed'].includes(document.querySelector('#status').dataset.state) && !document.querySelector('#clearTest').disabled, null, { timeout: 120000 });
  const small = await tool.evaluate(() => ({ state: document.querySelector('#status').dataset.state, log: document.querySelector('#results').textContent }));
  check('Small button writes, counts, pages and measures 11,000 real rows', small.state === 'complete' && small.log.includes('"rows":11000') && small.log.includes('"page50Rows":50') && small.log.includes('"deepRows":1000'), small.log.slice(-190));
  const empty = await tool.evaluate(async () => {
    const { benchmarkRepo } = await import('/js/db/repositories.js');
    const { BENCHMARK_STORES } = await import('/js/db/db.js');
    return Promise.all(BENCHMARK_STORES.map(name => benchmarkRepo(name).count()));
  });
  check('Tool automatically clears every synthetic store', empty.every(count => count === 0), empty.join(','));

  await tool.locator('#size').selectOption('medium');
  await tool.locator('#runTest').click();
  await tool.waitForFunction(() => document.querySelector('#status').dataset.state === 'running' && Number(document.querySelector('#progress').value) >= 1, null, { timeout: 30000 });
  await tool.locator('#cancelTest').click();
  await tool.waitForFunction(() => document.querySelector('#status').dataset.state === 'cancelled' && !document.querySelector('#clearTest').disabled, null, { timeout: 30000 });
  const afterCancel = await tool.evaluate(async () => {
    const { benchmarkRepo } = await import('/js/db/repositories.js');
    const { BENCHMARK_STORES } = await import('/js/db/db.js');
    return Promise.all(BENCHMARK_STORES.map(name => benchmarkRepo(name).count()));
  });
  check('Cancel stops the run and clears partial data', afterCancel.every(count => count === 0), afterCancel.join(','));
  const after = await app.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    return repo(STORES.clients).count();
  });
  check('Benchmark does not modify real client store', before === after, `${before} → ${after}`);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context.close();
  await browser.close();
}
console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} passed`);
if (checks.some(c => !c.ok)) process.exitCode = 1;
