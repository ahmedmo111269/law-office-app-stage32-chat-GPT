import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const results = [];
const record = (name, ok, detail = '', method = '') => {
  results.push({ name, ok, detail, method });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

function attachLogging(page, bucket) {
  page.on('pageerror', (e) => bucket.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') bucket.push('CONSOLE: ' + m.text()); });
}

async function newPage(options = {}) {
  const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  attachLogging(page, errors);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const el = document.getElementById('dbStatus');
    return el && /جاهزة|تعذر/.test(el.textContent);
  }, { timeout: 30000 });
  page.__errors = errors;
  page.__ctx = ctx;
  return page;
}

/* ------------------------------------------------------------------ 1. boot */
{
  const page = await newPage();
  const status = await page.textContent('#dbStatus');
  record('Boot / IndexedDB opens', status.includes('جاهزة'), status.trim());
  const version = await page.evaluate(async () => {
    const { APP_CONFIG } = await import('/js/config.js');
    return APP_CONFIG.dbVersion;
  });
  record('DB version reported', Number(version) === 15, `v${version}`);
  await page.__ctx.close();
}

/* ------------------------------------------------- 2. fresh DB schema shape */
{
  const page = await newPage();
  const shape = await page.evaluate(async () => {
    const { STORES } = await import('/js/core/constants.js');
    const { indexes } = await import('/js/db/schema.js');
    const { getDB } = await import('/js/db/db.js');
    const db = await getDB();
    const missingStores = Object.values(STORES).filter((s) => !db.objectStoreNames.contains(s));
    const missingIndexes = [];
    for (const [store, list] of Object.entries(indexes)) {
      if (!db.objectStoreNames.contains(store)) continue;
      const os = db.transaction(store).objectStore(store);
      for (const [name] of list) if (!os.indexNames.contains(name)) missingIndexes.push(`${store}.${name}`);
    }
    return { missingStores, missingIndexes, storeCount: db.objectStoreNames.length };
  });
  record('Fresh DB: all stores created', shape.missingStores.length === 0, shape.missingStores.join(',') || `${shape.storeCount} stores`);
  record('Fresh DB: all indexes created', shape.missingIndexes.length === 0, shape.missingIndexes.slice(0, 6).join(', ') || 'all present');
  await page.__ctx.close();
}

/* -------------------------------------------- 3. upgrade path v1..v14 -> v15 */
{
  const page = await newPage();
  const upgrade = await page.evaluate(async () => {
    const { APP_CONFIG } = await import('/js/config.js');
    const { MIGRATIONS } = await import('/js/db/migrations.js');
    const { STORES } = await import('/js/core/constants.js');
    const { indexes } = await import('/js/db/schema.js');
    const { closeDB, openDB, getDB } = await import('/js/db/db.js');
    const out = [];
    const name = APP_CONFIG.dbName;

    const buildAtVersion = (version) => new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const from = e.oldVersion || 0;
        for (let v = from + 1; v <= version; v += 1) {
          if (typeof MIGRATIONS[v] === 'function') MIGRATIONS[v](db, req.transaction, v);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // seed a sentinel row that must survive every later migration
        const tx = db.transaction(['clients', 'appeals'], 'readwrite');
        tx.objectStore('clients').add({ fullName: `عميل ترقية ${version}`, normalizedName: `عميل ترقية ${version}`, archived: true });
        tx.objectStore('appeals').add({ number: `طعن ترقية ${version}`, archived: true });
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(true); };
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });

    const wipe = () => new Promise((resolve) => {
      const del = indexedDB.deleteDatabase(name);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    });

    const seedAt = async (version) => {
      closeDB();               // release the application's own handle first
      await wipe();
      await buildAtVersion(version);
    };

    for (const version of [1, 5, 10, 13, 14]) {
      // eslint-disable-next-line no-await-in-loop
      await seedAt(version);
      closeDB();
      // eslint-disable-next-line no-await-in-loop
      const db = await openDB();   // opens at APP_CONFIG.dbVersion -> runs real migrate()
      const missingStores = Object.values(STORES).filter((s) => !db.objectStoreNames.contains(s));
      const missingIndexes = [];
      for (const [store, list] of Object.entries(indexes)) {
        if (!db.objectStoreNames.contains(store)) continue;
        const os = db.transaction(store).objectStore(store);
        for (const [n] of list) if (!os.indexNames.contains(n)) missingIndexes.push(`${store}.${n}`);
      }
      const rows = await new Promise((resolve) => {
        const req = db.transaction('clients').objectStore('clients').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
      });
      const sentinel = rows.find((r) => String(r.fullName || '').includes(`عميل ترقية ${version}`));
      const appeals = await new Promise((resolve) => {
        const req = db.transaction('appeals').objectStore('appeals').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
      });
      const appeal = appeals.find(r => r.number === `طعن ترقية ${version}`);
      // IndexedDB booleans must become numeric flags without losing either row.
      out.push({
        version,
        missingStores: missingStores.length,
        missingIndexes: missingIndexes.length,
        sentinelSurvived: Boolean(sentinel),
        flagNormalised: sentinel ? sentinel.archived === 1 : null,
        appealSurvived: Boolean(appeal),
        appealFlagNormalised: appeal ? appeal.archived === 1 : null
      });
      closeDB();
    }
    return out;
  });

  for (const row of upgrade) {
    record(
      `Migration v${row.version} → v15`,
      row.missingStores === 0 && row.missingIndexes === 0 && row.sentinelSurvived && row.flagNormalised && row.appealSurvived && row.appealFlagNormalised,
      `stores:${row.missingStores === 0 ? 'ok' : row.missingStores + ' missing'} idx:${row.missingIndexes === 0 ? 'ok' : row.missingIndexes + ' missing'} client:${row.sentinelSurvived ? 'kept' : 'LOST'} appeal:${row.appealSurvived ? 'kept' : 'LOST'} flags01:${row.flagNormalised && row.appealFlagNormalised}`,
      'delete DB → build vN → reopen at v15'
    );
  }
  await page.evaluate(async () => {
    const { closeDB } = await import('/js/db/db.js');
    closeDB();
    await new Promise((resolve) => { const d = indexedDB.deleteDatabase('LawOfficeDB'); d.onsuccess = resolve; d.onerror = resolve; d.onblocked = resolve; });
  });
  await page.__ctx.close();
}

/* ------------------------------------------------------------- 4. CRUD flow */
{
  const page = await newPage();
  const crud = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const log = {};

    // client
    const clientId = await repo(STORES.clients).add({ fullName: 'أحمد محمد خضير', normalizedName: 'احمد محمد خضير', phone1: '01000000000', archived: false });
    log.clientCreated = Boolean(clientId);
    const client = await repo(STORES.clients).get(clientId);
    log.clientRead = client?.fullName === 'أحمد محمد خضير';
    log.flagNormalisedOnWrite = client.archived === 0;
    log.uidAssigned = typeof client.uid === 'string' && client.uid.length > 8;

    await repo(STORES.clients).put({ ...client, city: 'بنها' });
    const updated = await repo(STORES.clients).get(clientId);
    log.clientUpdated = updated.city === 'بنها' && Number(updated.rev) === 2;

    // case + relations
    const caseId = await repo(STORES.cases).add({ caseNumber: '1580', caseYear: 2025, caseType: 'مدني', status: 'open', archived: false });
    await repo(STORES.caseClients).add({ caseId, clientId, role: 'مدعي', isPrimary: true });
    const links = await repo(STORES.caseClients).all({ limit: 10 });
    log.relationCreated = links.some((x) => Number(x.caseId) === Number(caseId));

    // hearing / procedure / task / judgment / appeal
    await repo(STORES.hearings).add({ caseId, date: '2025-10-01', time: '10:00', status: 'scheduled' });
    await repo(STORES.procedures).add({ caseId, date: '2025-09-01', type: 'إيداع مذكرة', description: 'مذكرة دفاع' });
    await repo(STORES.caseTasks).add({ caseId, clientId, title: 'متابعة الجلسة', dueDate: '2025-09-25', status: 'open' });
    const judgmentId = await repo(STORES.judgments).add({ caseId, number: '900', year: 2025, date: '2025-11-01', type: 'حكم', status: 'issued' });
    const appealId = await repo(STORES.appeals).add({ caseId, judgmentId, number: '77', year: 2025, filingDate: '2025-11-15', status: 'filed' });
    log.judgmentAppealLinked = Number((await repo(STORES.appeals).get(appealId)).judgmentId) === Number(judgmentId);

    // financial (minor units)
    await repo(STORES.financialRecords).add({ caseId, clientId, type: 'fee', direction: 'in', amountMinor: 150000, currency: 'EGP', date: '2025-09-01', status: 'recorded' });
    const fin = (await repo(STORES.financialRecords).all({ limit: 10 }))[0];
    log.moneyMinorUnits = fin.amountMinor === 150000 && Number.isInteger(fin.amountMinor);

    // archive (soft, data preserved)
    await repo(STORES.clients).put({ ...await repo(STORES.clients).get(clientId), archived: true });
    const archivedCount = await repo(STORES.clients).countByIndex('archived', 1);
    const activeCount = await repo(STORES.clients).countByIndex('archived', 0);
    log.archivedIndexWorks = archivedCount === 1 && activeCount === 0;
    log.archiveKeepsRow = Boolean(await repo(STORES.clients).get(clientId));

    // delete
    const tmpId = await repo(STORES.opponents).add({ name: 'خصم مؤقت', normalizedName: 'خصم مؤقت', archived: false });
    await repo(STORES.opponents).delete(tmpId);
    log.deleteWorks = (await repo(STORES.opponents).get(tmpId)) === undefined;
    const tomb = await repo(STORES.tombstones).all({ limit: 10 });
    log.tombstoneWritten = tomb.some((x) => Number(x.recordId) === Number(tmpId));

    return log;
  });
  for (const [key, value] of Object.entries(crud)) {
    record(`CRUD: ${key}`, value === true, String(value));
  }
  await page.__ctx.close();
}

/* --------------------------------------------- 5. pagination over big table */
{
  const page = await newPage();
  const paging = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/db/repositories.js').then(() => import('/js/core/constants.js'));
    const r = repo(STORES.clients);
    const rows = [];
    for (let i = 0; i < 1200; i += 1) {
      rows.push({ fullName: `عميل ترقيم ${i}`, normalizedName: `عميل ترقيم ${i}`, archived: false });
    }
    await r.bulkAdd(rows, { chunkSize: 500, track: false });

    const first = await r.page({ limit: 50, direction: 'next' });
    const second = await r.page({ limit: 50, direction: 'next', afterKey: first.nextKey, afterPrimaryKey: first.nextPrimaryKey });
    const idsFirst = new Set(first.rows.map((x) => x.id));
    const overlap = second.rows.filter((x) => idsFirst.has(x.id)).length;

    // deep pagination must not be O(offset)
    let key = first.nextKey; let primary = first.nextPrimaryKey; let pages = 1; let seen = first.rows.length;
    const t0 = performance.now();
    while (pages < 20) {
      const p = await r.page({ limit: 50, direction: 'next', afterKey: key, afterPrimaryKey: primary });
      if (!p.rows.length) break;
      seen += p.rows.length; pages += 1; key = p.nextKey; primary = p.nextPrimaryKey;
    }
    return { firstPage: first.rows.length, secondPage: second.rows.length, overlap, pages, seen, ms: Math.round(performance.now() - t0) };
  });
  record('Pagination: page size respected', paging.firstPage === 50 && paging.secondPage === 50, `${paging.firstPage}/${paging.secondPage}`);
  record('Pagination: no overlap between pages', paging.overlap === 0, `overlap=${paging.overlap}`);
  record('Pagination: 20 deep pages fast', paging.ms < 4000, `${paging.pages} pages / ${paging.seen} rows in ${paging.ms}ms`);
  await page.__ctx.close();
}

/* ---------------------------------------------------------- 6. backup/restore */
{
  const page = await newPage();
  const backup = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    // 2500 clients proves the export is NOT capped at 1000 rows any more
    const rows = [];
    for (let i = 0; i < 2500; i += 1) rows.push({ fullName: `عميل نسخة ${i}`, normalizedName: `عميل نسخة ${i}`, archived: false });
    await repo(STORES.clients).bulkAdd(rows, { chunkSize: 500, track: false });
    const before = await repo(STORES.clients).count();

    const { buildBackupText } = await import('/js/backup/backup.js');
    const meta = await buildBackupText({ requireHealthy: false });
    const parsed = JSON.parse(meta.text);
    const exported = parsed.data.clients.length;

    // wipe + restore
    const { restoreBackup } = await import('/js/backup/restore.js');
    const { getDB, closeDB } = await import('/js/db/db.js');
    const db = await getDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORES.clients, 'readwrite');
      tx.objectStore(STORES.clients).clear();
      tx.oncomplete = resolve;
    });
    const afterClear = await repo(STORES.clients).count();
    const result = await restoreBackup({ payload: parsed, fileName: 'test.json' }, { confirm: true });
    const after = await repo(STORES.clients).count();
    return { before, exported, afterClear, after, integrityOk: result.ok, shaMatched: Boolean(parsed.dataSha256) };
  });
  record('Backup: exports every row (>1000)', backup.exported === backup.before, `exported=${backup.exported} of ${backup.before}`);
  record('Restore: data restored after wipe', backup.afterClear === 0 && backup.after === backup.before, `cleared=${backup.afterClear} restored=${backup.after}/${backup.before}`);
  record('Restore: integrity check runs', backup.integrityOk === true, `ok=${backup.integrityOk}`);

  // wrong password must not corrupt anything
  const wrongPw = await page.evaluate(async () => {
    const { encryptBackupText, decryptBackupText } = await import('/js/backup/crypto.js');
    const wrapped = JSON.parse(await encryptBackupText('{"a":1}', 'correct-password'));
    try { await decryptBackupText(wrapped, 'wrong-password'); return { rejected: false }; }
    catch (e) { return { rejected: true, message: e.message }; }
  });
  record('Encryption: wrong password rejected', wrongPw.rejected === true, wrongPw.message || '');
  await page.__ctx.close();
}

/* ---------------------------------------------------------------- 7. search */
{
  const page = await newPage();
  const search = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { forceRebuildSearchIndex } = await import('/js/search/index-builder.js');
    const { globalSearch, invalidateIndexCache } = await import('/js/search/search.js');

    // seed 5000 clients; the target sits at the very beginning (oldest rows)
    const rows = [];
    for (let i = 0; i < 5000; i += 1) {
      rows.push({ fullName: i === 7 ? 'عبد الرحمن الشافعي' : `عميل بحث ${i}`, normalizedName: i === 7 ? 'عبد الرحمن الشافعي' : `عميل بحث ${i}`, archived: false });
    }
    await repo(STORES.clients).bulkAdd(rows, { chunkSize: 500, track: false });

    const t0 = performance.now();
    await forceRebuildSearchIndex({ chunkSize: 500 });
    const buildMs = Math.round(performance.now() - t0);

    invalidateIndexCache();
    const t1 = performance.now();
    const hit = await globalSearch('عبد الرحمن', { limit: 30 });
    const ms = Math.round(performance.now() - t1);

    // Arabic variant folding: user types احمد, record says أحمد
    const variantId = await repo(STORES.clients).add({ fullName: 'أحمد عبدالله سالم', normalizedName: 'احمد عبدالله سالم', archived: false });
    const variant = await globalSearch('احمد عبدالله', { limit: 30 });

    // deep record that a bounded scan would never reach
    const deep = await globalSearch('عميل بحث 4999', { limit: 30 });
    return {
      buildMs,
      ms,
      found: hit.rows.some((r) => r.store === 'clients' && String(r.title).includes('عبد الرحمن')),
      variantFound: variant.rows.some((r) => Number(r.id) === Number(variantId)),
      deepFound: deep.rows.some((r) => String(r.title).includes('عميل بحث 4999')),
      deepTotal: deep.totalKnown,
      deepSample: deep.rows.slice(0, 3).map((r) => `${r.store}:${r.title}`),
      total: hit.totalKnown
    };
  });
  record('Search: finds indexed match', search.found === true, `${search.ms}ms, ${search.total} hits`);
  record('Search: Arabic variant folding (احمد→أحمد)', search.variantFound === true, '');
  record('Search: reaches the oldest records', search.deepFound === true, `total=${search.deepTotal} sample=${(search.deepSample||[]).join(' ; ')}`);
  record('Search: index build is bounded', search.buildMs < 120000, `${search.buildMs}ms for 5k records`);
  await page.__ctx.close();
}

/* ------------------------------------------------------------------ 8. sync */
{
  // Two isolated browser contexts = two "devices"
  const deviceA = await newPage();
  await deviceA.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    await repo(STORES.clients).add({ fullName: 'عميل من الجهاز الأول', normalizedName: 'عميل من الجهاز الاول', archived: false });
  });
  const bundleText = await deviceA.evaluate(async () => {
    const { createMergeBundle } = await import('/js/sync/engine.js');
    const b = await createMergeBundle({ password: 'sync-pass-123' });
    return b.text;
  });

  const deviceB = await newPage();
  const syncResult = await deviceB.evaluate(async (text) => {
    const { parseBundle, applyBundle } = await import('/js/sync/engine.js');
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const file = new File([text], 'sync.losync', { type: 'application/json' });
    const parsed = await parseBundle(file, 'sync-pass-123');
    const first = await applyBundle(parsed, { confirm: true });
    const clientsAfterFirst = await repo(STORES.clients).all({ limit: 500 });
    // applying twice must be idempotent
    const parsed2 = await parseBundle(new File([text], 'sync.losync'), 'sync-pass-123');
    const second = await applyBundle(parsed2, { confirm: true });
    const clientsAfterSecond = await repo(STORES.clients).all({ limit: 500 });
    return {
      mode: parsed.mode,
      appliedFirst: first.applied,
      appliedSecond: second.applied,
      countAfterFirst: clientsAfterFirst.length,
      countAfterSecond: clientsAfterSecond.length,
      hasImported: clientsAfterFirst.some((c) => String(c.fullName).includes('الجهاز الأول'))
    };
  }, bundleText);

  record('Sync: bundle parsed as merge', syncResult.mode === 'merge', syncResult.mode);
  record('Sync: record transferred A→B', syncResult.hasImported === true, `${syncResult.appliedFirst} applied`);
  record('Sync: idempotent (2nd apply is no-op)', syncResult.appliedSecond === 0 && syncResult.countAfterFirst === syncResult.countAfterSecond, `applied=${syncResult.appliedSecond}, count ${syncResult.countAfterFirst}→${syncResult.countAfterSecond}`);

  // B edits -> A merges -> update propagates
  const bundleB = await deviceB.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { createMergeBundle } = await import('/js/sync/engine.js');
    const rows = await repo(STORES.clients).all({ limit: 500 });
    const target = rows.find((c) => String(c.fullName).includes('الجهاز الأول'));
    await repo(STORES.clients).put({ ...target, city: 'القاهرة' });
    const b = await createMergeBundle({ password: 'sync-pass-123' });
    return b.text;
  });
  const mergedBack = await deviceA.evaluate(async (text) => {
    const { parseBundle, applyBundle } = await import('/js/sync/engine.js');
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const parsed = await parseBundle(new File([text], 's.losync'), 'sync-pass-123');
    const res = await applyBundle(parsed, { confirm: true });
    const rows = await repo(STORES.clients).all({ limit: 500 });
    const target = rows.find((c) => String(c.fullName).includes('الجهاز الأول'));
    return { applied: res.applied, city: target?.city, conflicts: res.conflicts };
  }, bundleB);
  record('Sync: update propagates B→A', mergedBack.city === 'القاهرة', `applied=${mergedBack.applied}, city=${mergedBack.city}`);

  // concurrent edit on both sides -> conflict recorded, nothing lost
  const conflictTest = await deviceA.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { createMergeBundle, applyBundle, parseBundle, listConflicts } = await import('/js/sync/engine.js');
    const rows = await repo(STORES.clients).all({ limit: 500 });
    const target = rows.find((c) => String(c.fullName).includes('الجهاز الأول'));
    await repo(STORES.clients).put({ ...target, phone1: '01111111111' });

    // fabricate a peer bundle editing the same uid at a later timestamp
    const fake = await createMergeBundle({ password: 'x' });
    const payload = JSON.parse(await (async () => {
      const { decryptBackupText } = await import('/js/backup/crypto.js');
      return decryptBackupText(JSON.parse(fake.text).encrypted, 'x');
    })());
    // build a remote change for the same uid with a newer timestamp
    const remote = {
      format: payload.format, version: payload.version, mode: 'merge',
      createdAt: new Date(Date.now() + 60000).toISOString(),
      deviceId: 'device-remote-test', appVersion: payload.appVersion, dbVersion: payload.dbVersion,
      fromSeq: 0, toSeq: 999999,
      changes: [{
        uid: target.uid, store: 'clients', recordId: target.id, op: 'put', rev: 99,
        deviceId: 'device-remote-test', updatedAt: new Date(Date.now() + 60000).toISOString(),
        record: { ...target, phone1: '02222222222', updatedAt: new Date(Date.now() + 60000).toISOString(), rev: 99, deviceId: 'device-remote-test' }
      }],
      tombstones: []
    };
    const { encryptBackupText } = await import('/js/backup/crypto.js');
    const encrypted = JSON.parse(await encryptBackupText(JSON.stringify(remote), 'x'));
    const wrapper = { ...JSON.parse(fake.text), encrypted, deviceId: 'device-remote-test' };
    const parsed = await parseBundle(new File([JSON.stringify(wrapper)], 'c.losync'), 'x');
    const res = await applyBundle(parsed, { confirm: true });
    const conflicts = await listConflicts(20);
    return { applied: res.applied, conflicts: res.conflicts, stored: conflicts.length };
  });
  record('Sync: concurrent edit keeps both versions', conflictTest.conflicts >= 1 && conflictTest.stored >= 1, `conflicts=${conflictTest.conflicts}`);

  await deviceA.__ctx.close();
  await deviceB.__ctx.close();
}

/* ------------------------------------------------------- 9. security / PIN */
{
  const page = await newPage();
  const pin = await page.evaluate(async () => {
    const security = await import('/js/security.js');
    await security.setPin('1234');
    const okRight = await security.verifyPin('1234');
    const okWrong = await security.verifyPin('9999');
    // change the PIN: with the old settings bug this silently kept the old one
    await security.setPin('5678');
    const stillOld = await security.verifyPin('1234');
    const newWorks = await security.verifyPin('5678');
    await security.clearPin();
    const cleared = await security.hasPin();
    return { okRight, okWrong, stillOld, newWorks, cleared };
  });
  record('Security: correct PIN accepted', pin.okRight === true);
  record('Security: wrong PIN rejected', pin.okWrong === false);
  record('Security: PIN change takes effect', pin.newWorks === true && pin.stillOld === false, `old=${pin.stillOld} new=${pin.newWorks}`);
  record('Security: PIN can be cleared', pin.cleared === false, `hasPin=${pin.cleared}`);
  await page.__ctx.close();
}

/* --------------------------------------------- 10. data integrity checks */
{
  const page = await newPage();
  const integrity = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { inspectIntegrity } = await import('/js/backup/integrity.js');
    await repo(STORES.caseClients).add({ caseId: 999999, clientId: 999999 }); // dangling FKs
    await repo(STORES.financialRecords).add({ amountMinor: -5, date: '2025-01-01', status: 'recorded' });
    await repo(STORES.courtsAuthorities).add({ name: 'محكمة وهمية', parentId: 987654, archived: 0 });
    const res = await inspectIntegrity({ mode: 'full' });
    const msgs = res.issues.map((i) => i.message).join(' | ');
    await repo(STORES.caseClients).all({ limit: 500 }).then(async (rows) => {
      const bad = rows.filter((r) => Number(r.caseId) === 999999);
      for (const r of bad) await repo(STORES.caseClients).delete(r.id);
    });
    return {
      ok: res.ok,
      issues: res.issues.length,
      hasOrphan: /غير موجود/.test(msgs),
      hasMoney: /amountMinor/.test(msgs),
      hasParent: /parentId/.test(msgs)
    };
  });
  record('Integrity: dangling FK detected', integrity.hasOrphan === true, `${integrity.issues} issues`);
  record('Integrity: negative money detected', integrity.hasMoney === true);
  record('Integrity: dangling parent authority detected', integrity.hasParent === true);
  record('Integrity: report marks DB unhealthy', integrity.ok === false, `ok=${integrity.ok}`);
  await page.__ctx.close();
}

/* --------------------------------------------------------- 11. UI routes */
{
  const page = await newPage();
  const routes = ['dashboard','clients','cases','hearings','tasks','judgments','appeals','execution','financial','reports','statistics','data-quality','performance','audit','archive','templates','backup','settings','sync','search','daily','quick-add'];
  let failures = 0;
  for (const r of routes) {
    await page.goto(`${BASE}/index.html#/${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const html = await page.innerHTML('#page');
    const broken = html.includes('تعذر إتمام العملية') || html.trim().length < 40;
    if (broken) { failures += 1; console.log(`   broken route: ${r}`); }
  }
  record('UI: all routes render', failures === 0, `${routes.length - failures}/${routes.length}`);
  record('UI: no console errors', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.__ctx.close();
}

/* ------------------------------------------------------ 12. mobile layout */
{
  const page = await newPage({ viewport: { width: 390, height: 844 } });
  const mobile = await page.evaluate(async () => {
    const results = {};
    const routes = ['dashboard', 'clients', 'cases', 'reports', 'backup', 'sync', 'settings'];
    for (const r of routes) {
      location.hash = `#/${r}`;
      await new Promise((res) => setTimeout(res, 700));
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      results[r] = overflow;
    }
    return results;
  });
  const overflowing = Object.entries(mobile).filter(([, v]) => v > 2);
  record('Mobile: no horizontal overflow (390px)', overflowing.length === 0, overflowing.map(([k, v]) => `${k}:${v}px`).join(', ') || 'clean');
  await page.__ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n================ ${results.length - failed.length}/${results.length} PASSED ================`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
