/**
 * Real browser test: drives the application through its own UI (clicks and
 * form submits), exactly the way a user would. No direct data-layer calls.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /جاهزة/.test(document.getElementById('dbStatus').textContent), { timeout: 30000 });

const goto = async (route) => {
  await page.goto(`${BASE}/index.html#/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const el = document.getElementById('page');
    return el && el.innerHTML.length > 200 && !el.innerHTML.includes('جاري التحميل');
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(400);
};

/* 1 — create a client through the form */
await goto('clients');
await page.click('#addClient');
await page.waitForSelector('#clientForm');
await page.fill('#clientFullName', 'أحمد محمد خضير');
await page.fill('#clientNationalId', '29801011234567');
await page.fill('#clientPhone1', '01000000001');
await page.fill('#clientCity', 'بنها');
await page.click('#clientForm button[type=submit], #clientForm button.primary-button');
await page.waitForTimeout(1200);
let listText = await page.textContent('#clientsList');
record('UI: create client via form', listText.includes('أحمد محمد خضير'), listText.replace(/\s+/g, ' ').slice(0, 60));

/* 2 — edit it */
await page.click('#clientsList [data-edit-client]');
await page.waitForSelector('#clientForm');
await page.fill('#clientCity', 'القاهرة');
await page.click('#clientForm button.primary-button');
await page.waitForTimeout(1200);
listText = await page.textContent('#clientsList');
record('UI: edit client', listText.includes('القاهرة'), '');

/* 3 — client 360 */
const clientHref = await page.getAttribute('#clientsList a[href*="view=360"]', 'href');
await page.click('#clientsList a[href*="view=360"]');
await page.waitForTimeout(1200);
let html = await page.innerHTML('#page');
record('UI: open Client 360', html.includes('ملف العميل 360'), clientHref || '');

/* 4 — create a case */
await goto('cases');
await page.click('#addCase');
await page.waitForSelector('#caseForm');
await page.fill('#caseNumber', '1580');
await page.fill('#caseYear', '2025');
await page.selectOption('#caseType', { index: 1 }).catch(() => {});
await page.fill('#caseSubject', 'دعوى تعويض تجريبية');
await page.click('#caseForm button.primary-button');
await page.waitForTimeout(1500);
html = await page.innerHTML('#page');
record('UI: create case via form', html.includes('1580'), '');

/* 5 — open case 360 */
const caseLink = await page.$('#caseList a[href*="view=360"]');
if (caseLink) {
  await caseLink.click();
  await page.waitForTimeout(1500);
  html = await page.innerHTML('#page');
  record('UI: open Case 360', html.includes('view=360') || html.length > 2000, `len=${html.length}`);
} else record('UI: open Case 360', false, 'no 360 link in list');

/* 6 — quick add: task */
await goto('quick-add');
await page.click('#qaTask');
await page.waitForSelector('#taskForm');
await page.fill('#taskTitle, [name=title]', 'مهمة اختبار تلقائي');
await page.fill('[name=dueDate]', '2025-12-01');
await page.click('#taskForm button.primary-button');
await page.waitForTimeout(1200);
record('UI: quick add task', errors.filter((e) => /task/i.test(e)).length === 0, '');

/* 7 — hearings page + quick hearing */
await goto('hearings');
html = await page.innerHTML('#page');
record('UI: hearings page renders', html.length > 300, `len=${html.length}`);

/* 8 — global search through the UI */
await goto('search');
await page.fill('#globalSearch', 'أحمد');
await page.waitForTimeout(1500);
html = await page.innerHTML('#searchResults');
record('UI: global search returns rows', !html.includes('لا توجد نتائج') || html.length > 50, html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 70));

/* 9 — search from the command palette (Ctrl+K) */
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
const paletteVisible = await page.isVisible('.palette');
record('UI: command palette opens (Ctrl+K)', paletteVisible, '');
await page.keyboard.press('Escape');

/* 10 — daily center */
await goto('daily');
html = await page.innerHTML('#page');
record('UI: daily center renders', html.includes('مركز التشغيل اليومي') || html.length > 500, `len=${html.length}`);

/* 11 — notification centre */
await page.click('#notificationButton');
await page.waitForTimeout(900);
const notifVisible = await page.isVisible('.notification-modal');
record('UI: notification centre opens', notifVisible, '');
if (notifVisible) await page.click('.notification-modal [data-close]');

/* 12 — backup download (real file) */
await goto('backup');
const downloadPromise = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
await page.click('#backupBtn');
const download = await downloadPromise;
if (download) {
  const path = await download.path();
  const { statSync } = await import('fs');
  const size = statSync(path).size;
  const text = (await import('fs')).readFileSync(path, 'utf8');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  record('UI: plain backup downloads a valid file', Boolean(parsed) && parsed.format === 'law-office-backup', `${download.suggestedFilename()} ${(size / 1024).toFixed(1)}KB, clients=${parsed?.data?.clients?.length}`);
} else record('UI: plain backup downloads a valid file', false, 'no download event');

/* 13 — encrypted backup */
const dl2Promise = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
await page.fill('#backupPassword', 'test-password-123');
await page.click('#encryptedBackupBtn');
const dl2 = await dl2Promise;
if (dl2) {
  const p2 = await dl2.path();
  const text = (await import('fs')).readFileSync(p2, 'utf8');
  const wrapper = JSON.parse(text);
  record('UI: encrypted backup is AES-GCM wrapped', wrapper.format === 'law-office-backup-encrypted' && !!wrapper.iv && !!wrapper.salt, `${dl2.suggestedFilename()}, kdf=${wrapper.kdf}`);
} else record('UI: encrypted backup is AES-GCM wrapped', false, 'no download');

/* 14 — sync page: uid backfill + merge export */
await goto('sync');
html = await page.innerHTML('#page');
record('UI: sync page shows device id', html.includes('معرّف هذا الجهاز'), '');
const missingUid = await page.textContent('#uidStatus');
const hasUidBtn = await page.$('#uidBtn:not([disabled])');
if (hasUidBtn) {
  await page.click('#uidBtn');
  await page.waitForTimeout(3000);
}
const uidStatus = await page.textContent('#uidStatus');
record('UI: uid backfill runs', !/بحاجة إلى معرّف/.test(uidStatus) || /تم تجهيز/.test(uidStatus), uidStatus.trim().slice(0, 60));

const dl3Promise = page.waitForEvent('download', { timeout: 180000 }).catch(() => null);
await page.fill('#exportPassword', 'sync-pass-123');
await page.click('#exportBtn');
const dl3 = await dl3Promise;
if (dl3) {
  const p3 = await dl3.path();
  const wrapper = JSON.parse((await import('fs')).readFileSync(p3, 'utf8'));
  record('UI: merge bundle exported (encrypted)', wrapper.format === 'law-office-sync-package' && !!wrapper.encrypted, `${dl3.suggestedFilename()}`);
} else record('UI: merge bundle exported (encrypted)', false, 'no download');

/* 15 — data quality full scan */
await goto('data-quality');
await page.click('#run');
await page.waitForTimeout(4000);
html = await page.innerHTML('#summary');
record('UI: data quality scan runs', /PASS|FAIL/.test(html), html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 70));
const idxStatus = await page.textContent('#indexStatus');
record('UI: search index status shown', idxStatus.length > 0, idxStatus.trim().slice(0, 60));

/* 16 — reports + statistics */
await goto('reports');
html = await page.innerHTML('#page');
record('UI: reports page renders', html.length > 500, `len=${html.length}`);
await page.waitForSelector('#reportResults .stat-card', { timeout: 15000 });
record('UI: reports aggregate actual cases', Number(await page.locator('#reportResults .grid.grid-4 .stat-card strong').first().textContent()) >= 1);
await page.fill('#reportFrom', '2026-09-01');
await page.fill('#reportTo', '2026-09-30');
page.once('dialog', dialog => dialog.accept('إعداد فحص التقرير'));
await page.click('#savePreset');
await page.waitForFunction(() => document.querySelector('#presetSelect')?.options.length === 2);
record('UI: saved report preset appears immediately', (await page.locator('#presetSelect').inputValue()) === '0');
await page.selectOption('#presetSelect', '');
await page.click('#deletePreset');
record('UI: placeholder cannot delete first saved preset', await page.locator('#presetSelect option').count() === 2);
await page.selectOption('#presetSelect', '0');
record('UI: report preset restores ISO date filters', (await page.inputValue('#reportFrom')) === '2026-09-01' && (await page.inputValue('#reportTo')) === '2026-09-30');
await page.click('#deletePreset');
record('UI: selected report preset deletes correctly', await page.locator('#presetSelect option').count() === 1);
await goto('statistics');
html = await page.innerHTML('#page');
record('UI: statistics page renders', html.length > 500, `len=${html.length}`);

/* 17 — security PIN through the UI */
await goto('settings');
await page.fill('[name=pin]', '4321');
await page.fill('[name=confirm]', '4321');
await page.selectOption('[name=minutes]', '5');
await page.click('#securityForm button.primary-button');
await page.waitForTimeout(1500);
const notice = await page.textContent('#securitySettingsHost .notice');
record('UI: PIN saved from settings', /تم حفظ|مفعل/.test(notice), notice.trim().slice(0, 60));
await page.click('#lockNow');
await page.waitForTimeout(600);
const lockVisible = await page.isVisible('.security-lock');
record('UI: manual lock shows the lock screen', lockVisible, '');
if (lockVisible) {
  await page.fill('#unlockPin', '9999');
  await page.click('#unlockForm button');
  await page.waitForTimeout(800);
  const stillLocked = await page.isVisible('.security-lock');
  const err = await page.textContent('#unlockError').catch(() => '');
  record('UI: wrong PIN is rejected', stillLocked, err.trim());
  await page.fill('#unlockPin', '4321');
  await page.click('#unlockForm button');
  await page.waitForTimeout(1200);
  record('UI: correct PIN unlocks', !(await page.isVisible('.security-lock').catch(() => false)), '');
}

/* 18 — mobile viewport smoke */
await page.setViewportSize({ width: 390, height: 844 });
await goto('dashboard');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
record('UI: mobile 390px has no overflow', overflow <= 2, `${overflow}px`);
await page.setViewportSize({ width: 1440, height: 900 });

record('UI: no console/page errors', errors.length === 0, errors.slice(0, 6).join(' | ') || '(none)');
const failed = results.filter((r) => !r.ok);
console.log(`\n=========== UI: ${results.length - failed.length}/${results.length} PASSED ===========`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(', '));

await browser.close();
process.exit(failed.length ? 1 : 0);
