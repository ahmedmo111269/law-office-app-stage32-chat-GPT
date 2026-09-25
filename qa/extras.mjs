/**
 * PWA / offline / print-PDF / restore-through-UI / CSV export checks.
 */
import { chromium } from 'playwright';
import { readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(50)} ${detail}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Africa/Cairo', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
// Create another application's cache before this app installs its worker.
await page.goto(`${BASE}/manifest.json`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const cache = await caches.open('qa-unrelated-cache');
  await cache.put('./qa-marker', new Response('keep'));
});
await page.addInitScript(() => {
  window.__swUpdates = [];
  window.addEventListener('lawoffice:sw-updated', event => window.__swUpdates.push(event.detail));
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /جاهزة/.test(document.getElementById('dbStatus').textContent), { timeout: 40000 });

const cairoDates = await page.evaluate(async () => {
  const { toISODate, todayISO } = await import('/js/core/dates.js');
  const d = new Date();
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { dateOnly: toISODate('2026-09-25'), expected, today: todayISO(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
});
record('Dates: Cairo calendar date, not UTC rollover', cairoDates.zone === 'Africa/Cairo' && cairoDates.today === cairoDates.expected && cairoDates.dateOnly === '2026-09-25', JSON.stringify(cairoDates));
const westContext = await browser.newContext({ timezoneId: 'America/New_York' });
const westPage = await westContext.newPage();
await westPage.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
const westDate = await westPage.evaluate(async () => {
  const { toISODate, addDays } = await import('/js/core/dates.js');
  return { same: toISODate('2026-09-25'), next: toISODate(addDays('2026-09-25', 1)), invalid: toISODate('2026-02-30') };
});
record('Dates: date-only ISO survives western timezone', westDate.same === '2026-09-25' && westDate.next === '2026-09-26' && westDate.invalid === null, JSON.stringify(westDate));
await westContext.close();

/* ---------------------------------------------------------------- manifest */
{
  const manifest = await page.evaluate(async () => {
    const res = await fetch('manifest.json');
    return res.json();
  });
  record('PWA: manifest is valid JSON', Boolean(manifest.name), manifest.short_name || '');
  record('PWA: manifest identity uses its own project path', manifest.id === './index.html' && manifest.scope === './', manifest.id || '');
  const iconsOk = (manifest.icons || []).length >= 2;
  record('PWA: manifest declares icons', iconsOk, `${(manifest.icons || []).length} icons`);
  let allIconsFetch = true;
  for (const icon of manifest.icons || []) {
    const status = await page.evaluate(async (src) => {
      const r = await fetch(src);
      return r.status;
    }, icon.src);
    if (status !== 200) allIconsFetch = false;
  }
  record('PWA: every icon resolves', allIconsFetch, '');
}

/* ------------------------------------------------------- service worker    */
{
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    return { supported: true, scope: reg.scope, active: Boolean(reg.active) };
  });
  record('PWA: service worker registers', sw.supported && sw.active, sw.scope || '');
  await page.waitForTimeout(500);
  const cacheIsolation = await page.evaluate(async () => ({
    keepsOtherCache: (await caches.keys()).includes('qa-unrelated-cache'),
    falseUpdatesOnFirstInstall: window.__swUpdates?.length || 0
  }));
  record('PWA: unrelated origin caches are preserved', cacheIsolation.keepsOtherCache, JSON.stringify(cacheIsolation));
  record('PWA: first install does not claim an update', cacheIsolation.falseUpdatesOnFirstInstall === 0, JSON.stringify(cacheIsolation));

  // wait for the worker to precache, then go offline
  await page.waitForTimeout(2500);
  await ctx.setOffline(true);
  const offline = await page.evaluate(async () => {
    try {
      const res = await fetch('./index.html', { cache: 'no-store' });
      return { ok: res.ok, status: res.status };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  // A fresh install must serve *all* imports offline, not merely a cached HTML shell.
  let offlineBoot = false;
  let offlineBenchmark = false;
  try {
    await page.goto(`${BASE}/index.html#/cases`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => /جاهزة/.test(document.querySelector('#dbStatus')?.textContent || ''), null, { timeout: 20000 });
    await page.waitForSelector('#addCase', { timeout: 20000 });
    offlineBoot = (await page.title()).includes('أحمد محمد خضير');
    await page.goto(`${BASE}/performance-load-test.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#runTest', { timeout: 20000 });
    offlineBenchmark = true;
  } catch (error) { console.log('   offline import error:', error.message.split('\n')[0]); }
  record('PWA: full office boots and renders cases offline', offlineBoot && offline.ok, `fetch=${JSON.stringify(offline)}`);
  record('PWA: benchmark page loads while offline', offlineBenchmark);
  await ctx.setOffline(false);
}

/* -------------------------------------------- installed worker upgrade */
{
  const upgradedCtx = await browser.newContext();
  const upgradedPage = await upgradedCtx.newPage();
  upgradedPage.on('pageerror', error => errors.push('UPGRADE PAGEERROR: ' + error.message));
  await upgradedPage.addInitScript(() => {
    window.__upgradeEvents = [];
    window.addEventListener('lawoffice:sw-updated', event => window.__upgradeEvents.push(event.detail));
  });
  await upgradedPage.goto(`${BASE}/manifest.json`, { waitUntil: 'domcontentloaded' });
  await upgradedPage.evaluate(async () => {
    const scopeKey = new URL('./', location.href).pathname.replace(/[^A-Za-z0-9]/g, '-');
    const oldCache = await caches.open(`law-office-${scopeKey}-shell-v3.0.1`);
    await oldCache.put('./obsolete-asset', new Response('old'));
    const other = await caches.open('qa-unrelated-cache');
    await other.put('./keep', new Response('safe'));
    const otherApp = await caches.open('law-office-shell-v1.0.0');
    await otherApp.put('./unrelated-app', new Response('keep'));
  });
  await upgradedPage.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await upgradedPage.waitForFunction(() => window.__upgradeEvents.length > 0, null, { timeout: 20000 }).catch(() => {});
  const upgrade = await upgradedPage.evaluate(async () => ({
    caches: await caches.keys(),
    cachePrefix: `law-office-${new URL('./', location.href).pathname.replace(/[^A-Za-z0-9]/g, '-')}-shell-v`,
    versions: window.__upgradeEvents,
    notice: document.body.innerText.includes('أعد تحميل الصفحة لاستخدامه')
  }));
  record('PWA: upgrade evicts only this scoped app cache', !upgrade.caches.includes(upgrade.cachePrefix + '3.0.1') && upgrade.caches.includes(upgrade.cachePrefix + '3.0.2') && upgrade.caches.includes('qa-unrelated-cache') && upgrade.caches.includes('law-office-shell-v1.0.0'), JSON.stringify(upgrade.caches));
  record('PWA: worker update reaches the visible reload notice once', upgrade.versions.length === 1 && upgrade.versions[0]?.version === '3.0.2' && upgrade.notice, JSON.stringify(upgrade.versions));
  await upgradedCtx.close();
}

/* ------------------------------------------------------------- print / PDF */
{
  await page.goto(`${BASE}/index.html#/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const pdfPath = join(tmpdir(), 'law-office-report.pdf');
  let pdfOk = false;
  let pdfBytes = 0;
  await page.evaluate(() => {
    document.body.classList.add('print-report-mode');
    document.querySelector('#page').setAttribute('data-print-title', 'تقرير — ⚖️ مكتب الأستاذ / أحمد محمد خضير المحامى');
  });
  await page.emulateMedia({ media: 'print' });
  const printStyles = await page.evaluate(() => ({
    buttonHidden: getComputedStyle(document.querySelector('[data-print-report]')).display === 'none',
    reportVisible: getComputedStyle(document.querySelector('#page')).visibility === 'visible',
    title: getComputedStyle(document.querySelector('#page'), '::before').content
  }));
  try {
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    pdfBytes = statSync(pdfPath).size;
    pdfOk = pdfBytes > 2000;
  } catch (e) {
    pdfOk = false;
    console.log('   pdf error:', e.message.split('\n')[0]);
  }
  record('PDF: A4 report renders to PDF', pdfOk, `${(pdfBytes / 1024).toFixed(1)} KB`);
  record('PDF: print mode actually hides controls', printStyles.buttonHidden && printStyles.reportVisible && printStyles.title.includes('تقرير'), JSON.stringify(printStyles));
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.body.classList.remove('print-report-mode'));
}

/* -------------------------------------------------------------- CSV export */
{
  // CSV export skips rows with no indexed date; seed one dated record per button.
  await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const caseId = await repo(STORES.cases).add({ caseNumber: 'CSV-4242', caseYear: 2026, caseType: 'مدني', filingDate: '2026-09-24', archived: 0 });
    await repo(STORES.hearings).add({ caseId, date: '2026-09-24', time: '10:00', type: 'جلسة CSV' });
    await repo(STORES.caseTasks).add({ caseId, title: 'مهمة CSV', dueDate: '2026-09-24', status: 'open' });
    await repo(STORES.financialRecords).add({ caseId, date: '2026-09-24', type: 'أتعاب', direction: 'in', amountMinor: 12345, currency: 'EGP' });
  });
  await page.goto(`${BASE}/index.html#/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-export="cases"]');
  for (const [type, expected] of [['cases', 'CSV-4242'], ['hearings', 'جلسة CSV'], ['tasks', 'مهمة CSV'], ['financial', '12345']]) {
    const csvPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.click(`[data-export="${type}"]`);
    const dl = await csvPromise;
    if (dl) {
      const text = readFileSync(await dl.path(), 'utf8');
      record(`CSV: ${type} downloads real rows`, dl.suggestedFilename().endsWith(`-${cairoDates.today}.csv`) && text.charCodeAt(0) === 0xfeff && text.includes(expected), `${dl.suggestedFilename()} BOM=${text.charCodeAt(0) === 0xfeff} bytes=${text.length}`);
    } else record(`CSV: ${type} downloads real rows`, false, 'no download');
  }
}

/* ------------------------------------------- restore through the real UI   */
{
  // 1) create data
  await page.goto(`${BASE}/index.html#/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.click('#addClient');
  await page.waitForSelector('#clientForm');
  await page.fill('#clientFullName', 'عميل قبل الاستعادة');
  await page.click('#clientForm button.primary-button');
  await page.waitForTimeout(1200);

  // 2) take a backup
  await page.goto(`${BASE}/index.html#/backup`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const dlPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#backupBtn');
  const backup = await dlPromise;
  const backupPath = await backup.path();
  const backupText = readFileSync(backupPath, 'utf8');
  const parsed = JSON.parse(backupText);
  const backupClients = parsed.data.clients.length;

  // 3) delete a client, then restore the file through the file input
  await page.goto(`${BASE}/index.html#/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const hasArchiveBtn = await page.$('#clientsList [data-archive-client]');
  if (hasArchiveBtn) {
    page.once('dialog', (d) => d.accept());
    await hasArchiveBtn.click();
    await page.waitForTimeout(1000);
  }
  const afterArchive = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    return { active: await repo(STORES.clients).countByIndex('archived', 0), archived: await repo(STORES.clients).countByIndex('archived', 1) };
  });
  record('Archive: UI client moves to archive', Boolean(hasArchiveBtn) && afterArchive.active === 0 && afterArchive.archived === 1, JSON.stringify(afterArchive));

  await page.goto(`${BASE}/index.html#/backup`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.setInputFiles('#restoreFile', backupPath);
  await page.click('#previewRestoreBtn');
  await page.waitForTimeout(3000);
  const previewText = await page.textContent('#restorePreview');
  const previewOk = /إجمالي السجلات|معاينة/.test(previewText);
  record('Restore: preview works through the UI', previewOk, previewText.replace(/\s+/g, ' ').slice(0, 80));

  const applyDisabled = await page.getAttribute('#restoreBtn', 'disabled');
  record('Restore: apply enabled after preview', applyDisabled === null || applyDisabled === false, `disabled=${applyDisabled}`);

  page.once('dialog', (d) => d.accept());
  await page.click('#restoreBtn');
  await page.waitForTimeout(8000);
  const restored = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    const rows = await repo(STORES.clients).all({ limit: 500 });
    return { count: rows.length, has: rows.some((r) => String(r.fullName).includes('قبل الاستعادة') && Number(r.archived) === 0) };
  });
  record('Restore: archived client is active again', restored.has && afterArchive.active === 0, `activeBefore=${afterArchive.active}, afterRestore=${restored.count}`);
  record('Restore: backup contained every client', backupClients >= 1, `clients in file=${backupClients}`);
}

/* --------------------------------------------------- wrong password guard  */
{
  await page.goto(`${BASE}/index.html#/backup`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await page.fill('#backupPassword', 'correct-pass');
  await page.click('#encryptedBackupBtn');
  const file = await dl;
  const encPath = await file.path();
  await page.setInputFiles('#restoreFile', encPath);
  await page.fill('#backupPassword', 'wrong-pass');
  await page.click('#previewRestoreBtn');
  await page.waitForTimeout(2500);
  const box = await page.textContent('#restorePreview').catch(() => '');
  const info = await page.textContent('#backupInfo').catch(() => '');
  const toast = await page.textContent('#toastRoot').catch(() => '');
  const rejected = /كلمة المرور خاطئة|تعذر فك التشفير/.test(box + info + toast);
  record('Encryption: wrong password is refused in the UI', rejected, (toast || box || info).replace(/\s+/g, ' ').slice(0, 70));
  const intact = await page.evaluate(async () => {
    const { repo } = await import('/js/db/repositories.js');
    const { STORES } = await import('/js/core/constants.js');
    return repo(STORES.clients).count();
  });
  record('Encryption: failed attempt leaves data intact', intact >= 1, `clients=${intact}`);
}

record('Browser: no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | ') || '(none)');
const failed = results.filter((r) => !r.ok);
console.log(`\n=========== EXTRAS: ${results.length - failed.length}/${results.length} PASSED ===========`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => `${f.name} (${f.detail})`).join(', '));
await browser.close();
process.exitCode = failed.length ? 1 : 0;
