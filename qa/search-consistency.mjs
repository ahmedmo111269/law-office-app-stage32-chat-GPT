/* Real Chromium + IndexedDB regression for the derived global-search index. */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const checks = [];
const check = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};

try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /جاهزة/.test(document.getElementById('dbStatus')?.textContent || ''), null, { timeout: 45000 });

  const lifecycle = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { forceRebuildSearchIndex, lookupToken } = await import('/js/search/index-builder.js');
    const { globalSearch, invalidateIndexCache } = await import('/js/search/search.js');
    await forceRebuildSearchIndex({ chunkSize: 100 });
    invalidateIndexCache();

    const store = repo(STORES.clients);
    const id = await store.add({ fullName: 'شهاب عقيق', normalizedName: 'شهاب عقيق', archived: 0 });
    const createdDoc = await repo(STORES.searchDoc).get([STORES.clients, id]);
    const created = await globalSearch('عقيق', { store: 'clients' });

    const row = await store.get(id);
    await store.put({ ...row, fullName: 'مرجان زمرد', normalizedName: 'مرجان زمرد' });
    const oldResult = await globalSearch('عقيق', { store: 'clients' });
    const updated = await globalSearch('زمرد', { store: 'clients' });
    const updatedDoc = await repo(STORES.searchDoc).get([STORES.clients, id]);
    const oldPostings = await lookupToken(STORES.clients, 'عقيق');

    await store.delete(id);
    const deleted = await globalSearch('زمرد', { store: 'clients' });
    const deletedDoc = await repo(STORES.searchDoc).get([STORES.clients, id]);
    const deletedPostings = await lookupToken(STORES.clients, 'زمرد');

    return {
      id,
      createdFound: created.rows.some(result => result.id === id),
      createdIndexed: created.degraded === false && createdDoc?.tokens?.includes('عقيق'),
      updatedFound: updated.rows.some(result => result.id === id),
      oldGone: !oldResult.rows.some(result => result.id === id) && !oldPostings.includes(id),
      updatedIndexed: updated.degraded === false && updatedDoc?.tokens?.includes('زمرد') && !updatedDoc.tokens.includes('عقيق'),
      deletedGone: !deleted.rows.some(result => result.id === id) && !deletedPostings.includes(id) && deletedDoc === undefined,
      deletedIndexed: deleted.degraded === false
    };
  });
  check('Tracked add creates postings and searchDoc', lifecycle.createdFound && lifecycle.createdIndexed, `id=${lifecycle.id}`);
  check('Tracked edit removes old token and adds new token', lifecycle.updatedFound && lifecycle.oldGone && lifecycle.updatedIndexed);
  check('Tracked delete removes postings and searchDoc', lifecycle.deletedGone && lifecycle.deletedIndexed);

  // A peer merge uses track:false: it must not echo sync changes to the peer,
  // but the imported/edited/deleted records must still be searchable at once.
  const peer = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { globalSearch } = await import('/js/search/search.js');
    const store = repo(STORES.clients);
    const before = await repo(STORES.changeLog).count();
    const id = await store.put({ fullName: 'لؤلؤ المرج', normalizedName: 'لؤلؤ المرج', uid: 'qa-peer-client', rev: 1, updatedAt: new Date().toISOString() }, { track: false, preserveTimestamps: true });
    const added = await globalSearch('المرج', { store: 'clients' });
    const row = await store.get(id);
    await store.put({ ...row, fullName: 'لؤلؤ الشفق', normalizedName: 'لؤلؤ الشفق', rev: 2 }, { track: false, preserveTimestamps: true });
    const stale = await globalSearch('المرج', { store: 'clients' });
    const updated = await globalSearch('الشفق', { store: 'clients' });
    await store.delete(id, { track: false });
    const deleted = await globalSearch('الشفق', { store: 'clients' });
    const after = await repo(STORES.changeLog).count();
    return { added: added.rows.some(r => r.id === id), stale: stale.rows.some(r => r.id === id), updated: updated.rows.some(r => r.id === id), deleted: deleted.rows.some(r => r.id === id), noEcho: before === after };
  });
  check('Peer insert and update searchable without echoing to changeLog', peer.added && !peer.stale && peer.updated && peer.noEcho);
  check('Peer delete removes imported postings', !peer.deleted);

  const recovery = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { ensureSearchIndex, forceRebuildSearchIndex, searchIndexCoverage } = await import('/js/search/index-builder.js');
    const { globalSearch, isIndexReady } = await import('/js/search/search.js');
    const clients = repo(STORES.clients);
    await clients.add({ fullName: 'وردة كهرمان', normalizedName: 'وردة كهرمان' });
    await clients.bulkAdd([{ fullName: 'مروى صنوبر', normalizedName: 'مروى صنوبر' }], { track: false });
    const incomplete = await searchIndexCoverage();
    const partialReady = await isIndexReady();
    const degraded = await globalSearch('صنوبر', { store: 'clients' });
    const repaired = await ensureSearchIndex({ chunkSize: 1 });
    const full = await searchIndexCoverage();
    const found = await globalSearch('صنوبر', { store: 'clients' });

    const opponent = await repo(STORES.opponents).add({ name: 'خصم زعفران', normalizedName: 'خصم زعفران' });
    const controller = new AbortController();
    const stopped = await forceRebuildSearchIndex({ chunkSize: 1, signal: controller.signal, onProgress: p => {
      if (p.store === STORES.clients) controller.abort();
    } });
    const interrupted = await searchIndexCoverage();
    const whileStopped = await isIndexReady();
    const afterStop = await ensureSearchIndex({ chunkSize: 1 });
    const recovered = await searchIndexCoverage();
    const opponentFound = await globalSearch('زعفران', { store: 'opponents' });
    return {
      incomplete: !incomplete.complete && incomplete.postings > 0 && incomplete.gaps.some(g => g.store === STORES.clients),
      degraded: !partialReady && degraded.degraded && degraded.rows.some(r => r.title.includes('صنوبر')),
      repaired: !repaired.skipped && full.complete && found.rows.some(r => r.title.includes('صنوبر')) && !found.degraded,
      interrupted: stopped.aborted && !interrupted.complete && !whileStopped,
      recovered: !afterStop.skipped && recovered.complete && opponentFound.rows.some(r => r.id === opponent) && !opponentFound.degraded
    };
  });
  check('Partial nonempty index is NOT reported ready', recovery.incomplete && recovery.degraded);
  check('Partial index rebuild preserves rows and restores indexed search', recovery.repaired);
  check('Interrupted rebuild stays unready', recovery.interrupted);
  check('Interrupted rebuild recovers instead of skipping existing postings', recovery.recovered);

  const pagination = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { ensureSearchIndex } = await import('/js/search/index-builder.js');
    const { globalSearch } = await import('/js/search/search.js');
    const rows = Array.from({ length: 275 }, (_, n) => ({ fullName: `موجة ${n}`, normalizedName: `موجة ${n}` }));
    rows.push({ fullName: 'موجة موجي', normalizedName: 'موجة موجي' }); // two postings match the prefix
    await repo(STORES.clients).bulkAdd(rows, { chunkSize: 100, track: false });
    await ensureSearchIndex({ chunkSize: 100 });
    const pages = [];
    let lastHasMore = true;
    for (let offset = 0; offset < 300 && lastHasMore; offset += 30) {
      // eslint-disable-next-line no-await-in-loop
      const result = await globalSearch('موج', { store: 'clients', limit: 30, offset });
      pages.push({ offset, ids: result.rows.map(row => row.id), degraded: result.degraded });
      lastHasMore = result.hasMore;
    }
    const all = pages.flatMap(p => p.ids);
    const specific = await globalSearch('موجة 7', { store: 'clients' });
    return {
      count: all.length,
      unique: new Set(all).size,
      pages: pages.length,
      deepPage: pages.some(p => p.offset === 210 && p.ids.length === 30),
      lastHasMore,
      allIndexed: pages.every(p => !p.degraded),
      rareAnd: specific.rows.some(row => row.title === 'موجة 7') && !specific.degraded
    };
  });
  check('Search paginates beyond 200 without duplicates or omissions', pagination.count === 276 && pagination.unique === 276 && pagination.deepPage && !pagination.lastHasMore && pagination.allIndexed, `${pagination.count}/${pagination.unique} rows, ${pagination.pages} pages`);
  check('AND search chooses a selective token for old records', pagination.rareAnd);

  const sameCount = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { searchIndexCoverage } = await import('/js/search/index-builder.js');
    const clients = repo(STORES.clients);
    const id = await clients.add({ fullName: 'غيمة أولية', normalizedName: 'غيمة أولية' });
    const row = await clients.get(id);
    await clients.bulkPut([{ ...row, fullName: 'غيمة ختامية', normalizedName: 'غيمة ختامية' }], { track: false });
    const coverage = await searchIndexCoverage();
    return { id, dirty: coverage.persistedDirty && !coverage.complete && coverage.gaps.length === 0 };
  });
  check('Same-row-count bulk update persists an index-dirty marker', sameCount.dirty);
  await page.goto(`${BASE}/index.html#/data-quality`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#indexStatus')?.textContent.includes('غير مكتمل'), null, { timeout: 10000 });
  check('Data Quality warns rather than calls partial postings complete', (await page.locator('#indexStatus').innerText()).includes('غير مكتمل'));
  // A separate document resets the module's in-memory dirty flag; the DB
  // sentinel must still prevent the old postings from appearing complete.
  await page.goto(`${BASE}/performance-load-test.html`, { waitUntil: 'domcontentloaded' });
  const afterRestart = await page.evaluate(async id => {
    const { openDB } = await import('/js/db/db.js');
    const { searchIndexCoverage, ensureSearchIndex } = await import('/js/search/index-builder.js');
    const { globalSearch, isIndexReady } = await import('/js/search/search.js');
    await openDB();
    const before = await searchIndexCoverage();
    const readyBefore = await isIndexReady();
    await ensureSearchIndex({ chunkSize: 100 });
    const after = await searchIndexCoverage();
    const old = await globalSearch('أولية', { store: 'clients' });
    const current = await globalSearch('ختامية', { store: 'clients' });
    return {
      dirtyOnReload: before.persistedDirty && !before.complete && !readyBefore,
      repaired: after.complete && !after.persistedDirty && current.rows.some(row => row.id === id) && !old.rows.some(row => row.id === id) && !current.degraded
    };
  }, sameCount.id);
  check('Across a page restart, stale tokens remain unready', afterRestart.dirtyOnReload);
  check('Restarted session rebuilds and removes obsolete tokens', afterRestart.repaired);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context.close();
  await browser.close();
}
console.log(`\n${checks.filter(c => c.passed).length}/${checks.length} passed`);
if (checks.some(c => !c.passed)) process.exitCode = 1;
