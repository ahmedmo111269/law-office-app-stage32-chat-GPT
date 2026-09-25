/* GitHub Pages-style nested project path: routes, manifest identity, SW/offline. */
import { chromium } from 'playwright';
import { symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ALIAS = 'law-office-app-stage32-chat-GPT';
const alias = join(ROOT, ALIAS);
const BASE = `http://127.0.0.1:8099/${ALIAS}`;
const checks = [];
const errors = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${detail}`);
};
if (lstatSync(alias, { throwIfNoEntry: false })) throw new Error('اسم مسار الاختبار موجود بالفعل؛ لن يُستبدل.');
symlinkSync('.', alias, 'dir');
let browser, context;
try {
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`${BASE}/index.html#/cases`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /جاهزة/.test(document.querySelector('#dbStatus')?.textContent || ''), null, { timeout: 30000 });
  await page.waitForSelector('#addCase', { timeout: 30000 });
  check('Nested-path office boots and renders cases', (await page.title()).includes('أحمد محمد خضير'));

  const installed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const manifest = await (await fetch('./manifest.json')).json();
    return {
      scope: registration.scope,
      resolvedId: new URL(manifest.id, location.href).href,
      expectedId: new URL('./index.html', location.href).href,
      scopeCache: (await caches.keys()).some(name => name.includes(location.pathname.split('/')[1]))
    };
  });
  check('Nested SW scope is limited to this GitHub Pages path', installed.scope === `${BASE}/`, installed.scope);
  check('Nested manifest identity stays inside project', installed.resolvedId === installed.expectedId, installed.resolvedId);
  check('Nested project uses an isolated versioned cache', installed.scopeCache);

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20000 });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('#addCase', { timeout: 25000 });
  check('Nested office still boots and renders cases offline', (await page.locator('#pageTitle').innerText()).includes('القضايا'));
  await page.goto(`${BASE}/performance-load-test.html`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('#runTest', { timeout: 25000 });
  check('Nested benchmark page and JS load offline', (await page.title()).includes('أحمد محمد خضير'));
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context?.close();
  await browser?.close();
  unlinkSync(alias);
}
console.log(`\n${checks.filter(item => item.ok).length}/${checks.length} passed`);
if (checks.some(item => !item.ok)) process.exitCode = 1;
