/* Chromium integration: file-based encrypted merge + full encrypted snapshot. */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexts = [];
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};
const open = async () => {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /جاهزة/.test(document.getElementById('dbStatus')?.textContent || ''), null, { timeout: 45000 });
  return page;
};

try {
  const a = await open();
  const b = await open();
  const secret = 'عميل شديد الخصوصية زهران٩٩١';
  const text = await a.evaluate(async name => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { createMergeBundle } = await import('/js/sync/engine.js');
    await repo(STORES.clients).add({ fullName: name, normalizedName: name, archived: 0 });
    return (await createMergeBundle({ password: 'اختبار-حزمة-قوي' })).text;
  }, secret);
  const outer = JSON.parse(text);
  check('Merge bundle contains no plaintext client/change rows', !text.includes(secret) && !('changes' in outer) && !('tombstones' in outer) && Boolean(outer.encrypted?.data));
  const imported = await b.evaluate(async bundle => {
    const { parseBundle, applyBundle } = await import('/js/sync/engine.js');
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { globalSearch } = await import('/js/search/search.js');
    let wrongPasswordRejected = false;
    try { await parseBundle(new File([bundle], 'encrypted.losync'), 'كلمة-خاطئة'); }
    catch { wrongPasswordRejected = true; }
    const parsed = await parseBundle(new File([bundle], 'encrypted.losync'), 'اختبار-حزمة-قوي');
    const applied = await applyBundle(parsed, { confirm: true });
    const rows = await repo(STORES.clients).all({ limit: 30 });
    const found = await globalSearch('زهران', { store: 'clients' });
    const id = rows.find(row => row.fullName.includes('الخصوصية'))?.id;
    const local = await repo(STORES.clients).get(id);
    await repo(STORES.clients).put({ ...local, fullName: 'عميل معدل ليمون', normalizedName: 'عميل معدل ليمون' });
    const old = await globalSearch('زهران', { store: 'clients' });
    const changed = await globalSearch('ليمون', { store: 'clients' });
    return {
      wrongPasswordRejected,
      mode: parsed.mode, applied: applied.applied,
      found: found.rows.some(row => row.id === id) && !found.degraded,
      update: !old.rows.some(row => row.id === id) && changed.rows.some(row => row.id === id) && !changed.degraded
    };
  }, text);
  check('Wrong sync password rejected', imported.wrongPasswordRejected);
  check('Encrypted merge imports a real indexed client', imported.mode === 'merge' && imported.applied > 0 && imported.found, `${imported.applied} changes`);
  check('Imported client remains searchable after local edit', imported.update);

  const snapshot = await a.evaluate(async () => {
    const { createSnapshotBundle } = await import('/js/sync/engine.js');
    return (await createSnapshotBundle({ password: 'لقطة-اختبار-قوية' })).text;
  });
  check('Snapshot text protects client fields too', !snapshot.includes(secret) && Boolean(JSON.parse(snapshot).encrypted?.data));
  const restored = await b.evaluate(async bundle => {
    const { parseBundle, applyBundle } = await import('/js/sync/engine.js');
    const { restoreBackup } = await import('/js/backup/restore.js');
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { globalSearch } = await import('/js/search/search.js');
    const parsed = await parseBundle(new File([bundle], 'snapshot.losync'), 'لقطة-اختبار-قوية');
    const result = await applyBundle(parsed, {
      confirm: true,
      restoreSnapshot: (payload, opts) => restoreBackup({ payload }, opts)
    });
    const rows = await repo(STORES.clients).all({ limit: 30 });
    const found = await globalSearch('زهران', { store: 'clients' });
    return {
      mode: parsed.mode,
      summary: parsed.summary.totalRecords,
      appliedMode: result.mode,
      integrity: result.integrity?.ok,
      sourcePresent: rows.some(row => row.fullName.includes('زهران')) && found.rows.some(row => row.title.includes('زهران')) && !found.degraded,
      previousGone: !rows.some(row => row.fullName.includes('ليمون'))
    };
  }, snapshot);
  check('Snapshot parses as a snapshot with accurate count', restored.mode === 'snapshot' && restored.summary > 0, String(restored.summary));
  check('Snapshot actually replaces data and rebuilds search', restored.appliedMode === 'snapshot' && restored.integrity && restored.sourcePresent && restored.previousGone);

  await b.goto(`${BASE}/index.html#/sync`, { waitUntil: 'domcontentloaded' });
  await b.waitForSelector('#importFile', { timeout: 45000 });
  await b.locator('#importFile').setInputFiles({ name: 'snapshot.losync', mimeType: 'application/json', buffer: Buffer.from(snapshot) });
  await b.locator('#importPassword').fill('لقطة-اختبار-قوية');
  await b.locator('#previewBtn').click();
  await b.waitForFunction(() => !document.querySelector('#applyBtn').disabled, null, { timeout: 30000 });
  const preview = await b.locator('#previewBox').innerText();
  check('Sync UI identifies snapshot and shows real record count', preview.includes('حزمة كاملة') && preview.includes(Number(restored.summary).toLocaleString('ar-EG')), preview.slice(0, 180));
  await b.locator('#importPassword').fill('كلمة-أخرى');
  check('Changing sync password invalidates previous preview', await b.locator('#applyBtn').isDisabled());
  await b.locator('#importPassword').fill('لقطة-اختبار-قوية');
  await b.locator('#previewBtn').click();
  await b.waitForFunction(() => !document.querySelector('#applyBtn').disabled, null, { timeout: 30000 });
  await b.locator('#importFile').setInputFiles({ name: 'merge.losync', mimeType: 'application/json', buffer: Buffer.from(text) });
  check('Changing sync file invalidates previous preview', await b.locator('#applyBtn').isDisabled());

  const deleteBundle = await b.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { createMergeBundle } = await import('/js/sync/engine.js');
    const row = (await repo(STORES.clients).all({ limit: 10 })).find(item => item.fullName.includes('زهران'));
    await repo(STORES.clients).delete(row.id);
    return (await createMergeBundle({ password: 'اختبار-حزمة-قوي' })).text;
  });
  const deletion = await a.evaluate(async bundle => {
    const { parseBundle, applyBundle } = await import('/js/sync/engine.js');
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { globalSearch } = await import('/js/search/search.js');
    const parsed = await parseBundle(new File([bundle], 'deleted.losync'), 'اختبار-حزمة-قوي');
    const applied = await applyBundle(parsed, { confirm: true });
    const old = await globalSearch('زهران', { store: 'clients' });
    return { deleted: applied.deleted, remaining: await repo(STORES.clients).count(), searchGone: old.rows.length === 0 && !old.degraded };
  }, deleteBundle);
  check('Encrypted tombstone propagates B→A and removes search postings', deletion.deleted === 1 && deletion.remaining === 0 && deletion.searchGone);

  const interruptedRestore = await a.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { buildBackupText } = await import('/js/backup/backup.js');
    const { restoreBackup } = await import('/js/backup/restore.js');
    const { forceRebuildSearchIndex, searchIndexCoverage } = await import('/js/search/index-builder.js');
    await repo(STORES.clients).add({ fullName: 'سجل استعادة متعثر', normalizedName: 'سجل استعادة متعثر' });
    const backup = JSON.parse((await buildBackupText({ requireHealthy: false })).text);
    const result = await restoreBackup({ payload: backup }, { confirm: true, onProgress: p => {
      if (p.phase === 'index') throw new Error('qa interrupted index callback');
    } });
    const count = await repo(STORES.clients).count();
    await forceRebuildSearchIndex({ chunkSize: 100 });
    const recovered = await searchIndexCoverage();
    return {
      warned: !result.ok && result.issues.some(issue => issue.store === STORES.searchIndex && issue.message.includes('لم يكتمل')),
      sourceKept: count === 1, recovered: recovered.complete
    };
  });
  check('Restore reports an index failure instead of claiming success', interruptedRestore.warned && interruptedRestore.sourceKept && interruptedRestore.recovered);

  const rejectedBackups = await a.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const { buildBackupText } = await import('/js/backup/backup.js');
    const { restoreBackup } = await import('/js/backup/restore.js');
    const payload = JSON.parse((await buildBackupText({ requireHealthy: false })).text);
    const newer = structuredClone(payload);
    newer.dbVersion += 1;
    const tampered = structuredClone(payload);
    tampered.data.clients[0].fullName = 'تعديل لم يمر بالتحقق';
    let newerBlocked = false;
    let tamperedBlocked = false;
    try { await restoreBackup({ payload: newer }, { confirm: true }); } catch (error) { newerBlocked = error.message.includes('أحدث'); }
    try { await restoreBackup({ payload: tampered }, { confirm: true }); } catch (error) { tamperedBlocked = error.message.includes('SHA-256'); }
    const rows = await repo(STORES.clients).all({ limit: 2 });
    return { newerBlocked, tamperedBlocked, intact: rows.length === 1 && rows[0].fullName === 'سجل استعادة متعثر' };
  });
  check('Newer-schema backup is rejected before modifying data', rejectedBackups.newerBlocked && rejectedBackups.intact);
  check('Tampered backup checksum is rejected before modifying data', rejectedBackups.tamperedBlocked && rejectedBackups.intact);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} passed`);
if (checks.some(c => !c.ok)) process.exitCode = 1;
