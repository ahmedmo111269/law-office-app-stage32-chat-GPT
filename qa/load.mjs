import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SIZES = {
  small: { clients: 1000, cases: 1000, hearings: 3000, procedures: 5000, tasks: 1000 },
  medium: { clients: 10000, cases: 10000, hearings: 30000, procedures: 50000, tasks: 10000 },
  large: { clients: 100000, cases: 100000, hearings: 300000, procedures: 500000, tasks: 100000 }
};
const targets = (process.argv[2] || 'small,medium').split(',');
const SKIP_INDEX = process.env.SKIP_INDEX === '1';

const PERSISTENT = process.env.PERSISTENT === '1';
const profile = PERSISTENT ? mkdtempSync(`${tmpdir()}/law-office-load-`) : null;
if (profile) process.on('exit', () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
const browser = PERSISTENT ? null : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = PERSISTENT
  ? await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 900 }, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  : await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /جاهزة|تعذر/.test(document.getElementById('dbStatus').textContent), null, { timeout: 60000 });
const initialStorage = await page.evaluate(async () => {
  const e = await navigator.storage.estimate();
  return { usageMB: Math.round((e.usage || 0) / 1048576), quotaMB: Math.round((e.quota || 0) / 1048576) };
});
console.log('profile:', PERSISTENT ? 'persistent test profile' : 'isolated temporary context', 'storage:', JSON.stringify(initialStorage));
await page.exposeFunction('loadProgress', p => console.log(`seeded ${p.store}: ${p.count} rows in ${p.seconds}s, storage ${p.usageMB}/${p.quotaMB}MB`));

const summary = [];

for (const sizeName of targets) {
  const spec = SIZES[sizeName];
  if (!spec) continue;
  console.log(`\n================ ${sizeName.toUpperCase()} ================`);
  console.log(JSON.stringify(spec));

  const seed = await page.evaluate(async (cfg) => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const t0 = performance.now();
    const mk = async (store, count, build) => {
      const t = performance.now();
      const out = [];
      for (let i = 0; i < count; i += 1) out.push(build(i));
      await repo(store).bulkAdd(out, { chunkSize: 1000, track: false });
      const usage = await navigator.storage.estimate();
      await window.loadProgress({ store, count: out.length, seconds: Math.round((performance.now() - t) / 1000), usageMB: Math.round((usage.usage || 0) / 1048576), quotaMB: Math.round((usage.quota || 0) / 1048576) });
      return out.length;
    };
    const now = new Date().toISOString();
    const total = {
      clients: await mk(STORES.clients, cfg.clients, (i) => ({
        fullName: `عميل ${i}`, normalizedName: `عميل ${i}`, phone1: `0100000${(i % 100000).toString().padStart(5, '0')}`,
        notes: i === 7 ? 'معيارقديمفريد' : '',
        city: ['بنها', 'القاهرة', 'الإسكندرية', 'طنطا'][i % 4], archived: 0, createdAt: now, updatedAt: now
      })),
      cases: await mk(STORES.cases, cfg.cases, (i) => ({
        caseNumber: String(1000 + i), caseYear: 2020 + (i % 6), caseType: ['مدني', 'جنائي', 'عمالي', 'أحوال'][i % 4],
        status: ['open', 'closed', 'pending'][i % 3], filingDate: `202${i % 6}-0${(i % 9) + 1}-15`, archived: 0, createdAt: now, updatedAt: now
      })),
      hearings: await mk(STORES.hearings, cfg.hearings, (i) => ({
        caseId: (i % cfg.cases) + 1, date: `2025-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`, time: '10:00',
        status: ['scheduled', 'done', 'cancelled'][i % 3], createdAt: now, updatedAt: now
      })),
      procedures: await mk(STORES.procedures, cfg.procedures, (i) => ({
        caseId: (i % cfg.cases) + 1, date: `2025-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`,
        type: 'إجراء', description: `إجراء رقم ${i}`, createdAt: now, updatedAt: now
      })),
      tasks: await mk(STORES.caseTasks, cfg.tasks, (i) => ({
        title: `مهمة ${i}`, caseId: (i % cfg.cases) + 1, dueDate: `2025-1${i % 2}-${String((i % 28) + 1).padStart(2, '0')}`,
        status: ['open', 'completed'][i % 2], createdAt: now, updatedAt: now
      }))
    };
    return { total, seedMs: Math.round(performance.now() - t0) };
  }, spec);
  console.log(`seed: ${JSON.stringify(seed.total)} in ${(seed.seedMs / 1000).toFixed(1)}s`);

  let indexMs = { ms: 0, indexed: 0, postings: 0, skipped: true };
  if (!SKIP_INDEX) {
    indexMs = await page.evaluate(async () => {
      const { forceRebuildSearchIndex, countPostings } = await import('/js/search/index-builder.js');
      const t = performance.now();
      const r = await forceRebuildSearchIndex({ chunkSize: 5000 });
      return { ms: Math.round(performance.now() - t), indexed: r.indexed, postings: await countPostings(), skipped: false };
    });
  }
  console.log(`search index: ${indexMs.indexed.toLocaleString('ar-EG')} postings in ${(indexMs.ms / 1000).toFixed(1)}s`);

  // Operational timings
  const timings = await page.evaluate(async ({ clientCount }) => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { globalSearch, invalidateIndexCache } = await import('/js/search/search.js');
    const { getDashboardSummary, getTodayItems, getAttentionItems, getDataHealth } = await import('/js/dashboard/dashboard.js');
    const t = async (fn) => { const s = performance.now(); const v = await fn(); return { ms: Math.round(performance.now() - s), v }; };

    invalidateIndexCache();
    const page50 = await t(() => repo(STORES.cases).page({ limit: 50 }));
    const pageDeep = await t(async () => {
      let key; let primary; let rows = 0;
      for (let i = 0; i < 20; i += 1) {
        const p = await repo(STORES.cases).page({ limit: 50, afterKey: key, afterPrimaryKey: primary });
        rows += p.rows.length; key = p.nextKey; primary = p.nextPrimaryKey;
        if (!p.hasMore) break;
      }
      return rows;
    });
    const byIndex = await t(() => repo(STORES.hearings).byIndex('caseId', 1, { limit: 50 }));
    const search = await t(() => globalSearch('معيارقديمفريد', { store: 'clients', limit: 30 }));
    const searchRecent = await t(() => globalSearch(`عميل ${clientCount - 1}`, { store: 'clients', limit: 30 }));
    const searchAr = await t(() => globalSearch('مهمة 999', { store: 'caseTasks', limit: 30 }));
    const dash = await t(() => getDashboardSummary());
    const today = await t(() => getTodayItems());
    const attention = await t(() => getAttentionItems());
    const health = await t(() => getDataHealth());
    const count = await t(() => repo(STORES.procedures).count());

    return {
      page50: page50.ms,
      pageDeep: pageDeep.ms,
      byIndex: byIndex.ms,
      search: search.ms,
      searchHits: search.v.rows.some(row => row.title === 'عميل 7') ? 1 : 0,
      searchDegraded: search.v.degraded,
      searchRecent: searchRecent.ms,
      searchRecentHits: searchRecent.v.rows.some(row => row.title === `عميل ${clientCount - 1}`) ? 1 : 0,
      searchRecentDegraded: searchRecent.v.degraded,
      searchAr: searchAr.ms,
      searchArHits: searchAr.v.rows.some(row => row.title === 'مهمة 999') ? 1 : 0,
      searchArDegraded: searchAr.v.degraded,
      dashboard: dash.ms,
      today: today.ms,
      attention: attention.ms,
      health: health.ms,
      count: count.ms,
      procedureRows: count.v
    };
  }, { clientCount: spec.clients });
  console.log('timings(ms):', JSON.stringify(timings));
  if (timings.procedureRows !== spec.procedures) errors.push(`Procedure count mismatch: ${timings.procedureRows} != ${spec.procedures}`);
  if (!SKIP_INDEX && (!timings.searchHits || !timings.searchRecentHits || !timings.searchArHits ||
      timings.searchDegraded || timings.searchRecentDegraded || timings.searchArDegraded)) {
    errors.push('Indexed search missed a seeded old/recent client or task, or fell back to a degraded scan');
  }
  if (SKIP_INDEX) console.log('INDEXED SEARCH NOT TESTED: full index was intentionally skipped; any search here is degraded fallback only.');

  // UI responsiveness: hash-only navigation does NOT reload the document.
  // Waiting for any non-loading HTML could accept the *previous* route before
  // the requested route starts; require a route-specific element instead.
  const ui = {};
  const readySelectors = {
    dashboard: '.dashboard-hero', cases: '#addCase', clients: '#addClient',
    hearings: '#addHearing', tasks: '#addTask', reports: '#page h2', 'data-quality': '#indexStatus'
  };
  for (const route of ['dashboard', 'cases', 'clients', 'hearings', 'tasks', 'reports', 'data-quality']) {
    const started = Date.now();
    await page.goto(`${BASE}/index.html#/${route}`, { waitUntil: 'domcontentloaded' });
    const loaded = await page.waitForFunction(({ route, selector }) => {
      const target = document.querySelector(selector);
      if (!target) return false;
      if (route === 'reports' && !target.textContent.includes('التقارير')) return false;
      const page = document.getElementById('page');
      return page && page.innerHTML.length > 200 && !page.innerHTML.includes('جاري التحميل');
    }, { route, selector: readySelectors[route] }, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!loaded) {
      const state = await page.evaluate(async routeName => {
        const { repo } = await import('/js/db/repositories.js');
        const { STORES } = await import('/js/core/constants.js');
        const probeStore = routeName === 'hearings' ? STORES.hearings : STORES.caseTasks;
        const probe = await Promise.race([
          repo(probeStore).all({ limit: 500 }).then(rows => `${rows.length} rows`).catch(e => e.message),
          new Promise(resolve => setTimeout(() => resolve('read timeout'), 2500))
        ]);
        return {
          hash: location.hash, title: document.querySelector('#pageTitle')?.textContent,
          dbStatus: document.querySelector('#dbStatus')?.textContent,
          pageHtml: document.querySelector('#page')?.innerHTML.slice(0, 320),
          pageText: document.querySelector('#page')?.innerText.slice(0, 200), probe
        };
      }, route);
      console.log(`UI timeout details (${route}):`, JSON.stringify(state));
      errors.push(`UI render timed out: ${route}`);
    }
    ui[route] = Date.now() - started;
    if (route === 'reports' && loaded) {
      const aggregateDone = await page.waitForFunction(() => {
        const root = document.querySelector('#reportResults');
        return Boolean(root?.querySelector('.stat-card') && !root.hasAttribute('aria-busy'));
      }, null, { timeout: sizeName === 'large' ? 90000 : 45000 }).then(() => true).catch(() => false);
      ui.reportsAggregate = Date.now() - started;
      if (!aggregateDone) errors.push(`Reports aggregate timed out at ${sizeName}`);
      else {
        const totals = await page.evaluate(() => [...document.querySelectorAll('#reportResults .grid.grid-4 .stat-card strong')].slice(0, 2).map(node => Number(node.textContent)));
        if (totals[0] !== spec.cases || totals[1] !== spec.hearings) errors.push(`Reports count mismatch: ${totals} != ${spec.cases},${spec.hearings}`);
      }
      if (sizeName === 'large' && aggregateDone) {
        // Starting a second large report then navigating away must cancel its
        // page reads, not leave the next route stuck behind aggregation.
        await page.click('#clearReport');
        const awayStart = Date.now();
        await page.goto(`${BASE}/index.html#/data-quality`, { waitUntil: 'domcontentloaded' });
        const left = await page.waitForFunction(() =>
          document.querySelector('#pageTitle')?.textContent.includes('صحة البيانات') && document.querySelector('#indexStatus'),
        null, { timeout: 15000 }).then(() => true).catch(() => false);
        ui.reportCancelNavigation = Date.now() - awayStart;
        if (!left) errors.push('Navigation from aggregating report did not cancel in time');
      }
    }
  }
  console.log('ui render(ms):', JSON.stringify(ui));

  // Chromium can quantise performance.memory (often to a constant 10 MB).
  // CDP returns actual post-test renderer JS heap; this is NOT peak RSS.
  let memory = null;
  let memorySource = 'unavailable';
  try {
    const session = await ctx.newCDPSession(page);
    const heap = await session.send('Runtime.getHeapUsage');
    memory = Math.round(heap.usedSize / 1048576);
    memorySource = 'CDP Runtime.getHeapUsage, post-test';
    await session.detach();
  } catch {
    memory = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    memorySource = 'performance.memory, approximate';
  }
  const storage = await page.evaluate(async () => {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usageMB: Math.round((e.usage || 0) / 1048576), quotaMB: Math.round((e.quota || 0) / 1048576) };
  });
  console.log(`heap=${memory}MB (${memorySource}) storage=${JSON.stringify(storage)}`);

  summary.push({ size: sizeName, seed: seed.total, seedMs: seed.seedMs, indexMs, timings, ui, memory, memorySource, storage });
}

console.log('\n================ SUMMARY ================');
for (const s of summary) {
  console.log(`${s.size}: seeded=${Object.values(s.seed).reduce((a, b) => a + b, 0).toLocaleString('ar-EG')} rows, seedTime=${(s.seedMs / 1000).toFixed(1)}s, index=${(s.indexMs.ms / 1000).toFixed(1)}s, page50=${s.timings.page50}ms, search=${s.timings.search}ms, searchAr=${s.timings.searchAr}ms, dashboard=${s.timings.dashboard}ms, health(quick)=${s.timings.health}ms, heap=${s.memory}MB`);
}
console.log('errors:', errors.length ? errors.slice(0, 5) : '(none)');

await ctx.close();
if (browser) await browser.close();
if (errors.length) process.exitCode = 1;
