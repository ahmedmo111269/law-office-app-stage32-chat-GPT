#!/usr/bin/env node
/**
 * Static audit: syntax, forbidden patterns, layer violations, duplicates.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
let failures = 0;
const line = (ok, name, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
};

/** Removes /* *\/ and // comments so doc text is not matched as code. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === '.git' || e === 'node_modules' || e === 'icons') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const syntaxFiles = files.filter((f) => /\.(?:js|mjs)$/.test(f));

// 1. syntax (production, test harness, and ESLint config)
let syntaxOk = 0;
const syntaxErrors = [];
for (const f of syntaxFiles) {
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' });
    syntaxOk += 1;
  } catch (e) {
    syntaxErrors.push(`${f}: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
}
line(syntaxErrors.length === 0, `node --check (${syntaxFiles.length} JS/MJS files)`, syntaxErrors.slice(0, 3).join(' | '));

// 2. forbidden / risky patterns
const rules = [
  { name: 'indexedDB.open only in db/db.js', re: /indexedDB\s*\.\s*open\s*\(/, allow: /js\/db\/db\.js$/, note: 'DB layer owns the connection' },
  { name: 'no indexedDB.deleteDatabase', re: /indexedDB\s*\.\s*deleteDatabase/, allow: null },
  { name: 'no eval()', re: /\beval\s*\(/, allow: null },
  { name: 'no new Function()', re: /new\s+Function\s*\(/, allow: null },
  { name: 'no TODO/FIXME/XXX', re: /\b(TODO|FIXME|XXX)\b/, allow: null },
  { name: 'no obvious XSS sink (document.write)', re: /document\s*\.\s*write\s*\(/, allow: null }
];
for (const rule of rules) {
  const hits = [];
  for (const f of jsFiles) {
    const rel = f.slice(ROOT.length + 1);
    if (rule.allow && rule.allow.test(rel)) continue;
    const s = stripComments(readFileSync(f, 'utf8'));
    const m = s.match(rule.re);
    if (m) hits.push(rel);
  }
  line(hits.length === 0, rule.name, hits.slice(0, 4).join(', '));
}

// 2b. No module may bypass the repository/DB layers to open raw transactions.
{
  const bad = [];
  for (const f of jsFiles) {
    const rel = f.slice(ROOT.length + 1);
    if (/^js\/db\/(db|repositories|migrations|schema)\.js$/.test(rel)) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    if (/\b(?:db|getDB\(\))\s*\.\s*transaction\s*\(/.test(src) || /\bgetDB\s*\(/.test(src) || /import\s*\{[^}]*\bgetDB\b[^}]*\}\s*from\s*['"][^'"]*\/db\/db\.js['"]/.test(src)) bad.push(rel);
  }
  line(bad.length === 0, 'all runtime DB access goes through repositories', bad.join(', '));
}

// 3. getAll() must not be used in hot paths (allowed only in repositories + explicit non-UI helpers)
{
  const hits = [];
  for (const f of jsFiles) {
    const rel = f.slice(ROOT.length + 1);
    const s = readFileSync(f, 'utf8');
    if (/\.getAll\s*\(/.test(s)) hits.push(rel);
  }
  const allowed = new Set(['js/db/repositories.js']);
  const violations = hits.filter((h) => !allowed.has(h));
  line(violations.length === 0, 'getAll() confined to repository layer', violations.join(', ') || `found only in: ${hits.join(', ')}`);
}

// 4. money must use minor units
{
  const bad = [];
  for (const f of jsFiles) {
    const s = readFileSync(f, 'utf8');
    // float money literals: suspicious patterns like amount: parseFloat / amount * 100 in UI
    if (/parseFloat\s*\([^)]*amount/i.test(s)) bad.push(f.slice(ROOT.length + 1));
  }
  line(bad.length === 0, 'no float parsing of money amounts', bad.join(', '));
}

// 5. every store in constants has schema metadata
{
  const src = readFileSync(join(ROOT, 'js/core/constants.js'), 'utf8');
  const stores = [...src.matchAll(/^\s*(\w+):\s*'(\w+)'/gm)].map((m) => m[1]);
  const schema = readFileSync(join(ROOT, 'js/db/schema.js'), 'utf8');
  const missing = stores.filter((s) => !new RegExp(`\\n  ${s}: \\['`).test(schema));
  line(missing.length === 0, `all ${stores.length} stores present in schema`, missing.join(', '));
}

// 6. duplicate exported function names across modules (shadowing risk)
{
  const seen = new Map();
  const dupes = [];
  for (const f of jsFiles) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
      const name = m[1];
      const rel = f.slice(ROOT.length + 1);
      if (seen.has(name) && seen.get(name) !== rel) dupes.push(`${name} (${seen.get(name)} + ${rel})`);
      else seen.set(name, rel);
    }
  }
  console.log(`INFO  duplicate export names across modules: ${dupes.length}`);
  if (dupes.length) console.log('      ' + dupes.slice(0, 8).join('\n      '));
}

// 7. config/version consistency
{
  const cfg = readFileSync(join(ROOT, 'js/config.js'), 'utf8');
  const version = cfg.match(/version:\s*'([\d.]+)'/)?.[1];
  const dbVersion = Number(cfg.match(/dbVersion:\s*(\d+)/)?.[1]);
  const migrations = readFileSync(join(ROOT, 'js/db/migrations.js'), 'utf8');
  const maxMigration = Math.max(...[...migrations.matchAll(/^\s{2}(\d+):\s*\(/gm)].map((m) => Number(m[1])));
  const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
  const swVersion = sw.match(/APP_VERSION\s*=\s*'([\d.]+)'/)?.[1];
  line(version === swVersion, `app version matches service worker`, `config=${version} sw=${swVersion}`);
  line(dbVersion === maxMigration, `dbVersion matches latest migration`, `db=${dbVersion} max=${maxMigration}`);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  line((manifest.icons || []).length >= 2, 'manifest has icons', `${(manifest.icons || []).length} icons`);
  line(manifest.id === './index.html' && manifest.start_url === './index.html' && manifest.scope === './', 'manifest identity is scoped to this installed project', manifest.id);
  line(manifest.name.includes('أحمد محمد خضير'), 'manifest uses the office name', manifest.short_name);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  line(html.includes('أحمد محمد خضير'), 'index.html uses the office name');
  line(html.includes('dir="rtl"') && html.includes('lang="ar"'), 'HTML is RTL Arabic');
}

// 7b. Every registered route and sidebar link has a concrete renderer.
{
  const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const routeBlock = app.match(/export const ROUTES = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] || '';
  const routes = [...routeBlock.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z][\w-]*))\s*:/g)].map(match => match[1] || match[2]);
  const implemented = new Set([...app.matchAll(/route === ['"]([^'"]+)['"]/g)].map(match => match[1]));
  const missingRenderers = routes.filter(route => !implemented.has(route));
  line(routes.length === 37 && missingRenderers.length === 0, `all ${routes.length} routes implement a renderer`, missingRenderers.join(', '));
  const constants = readFileSync(join(ROOT, 'js/core/constants.js'), 'utf8');
  const menuBlock = constants.match(/export const NAV_GROUPS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
  const menuRoutes = [...menuBlock.matchAll(/\[\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*\]/g)].map(match => match[1]);
  const unknownLinks = menuRoutes.filter(route => !routes.includes(route));
  line(menuRoutes.length >= 30 && unknownLinks.length === 0, 'all sidebar links resolve to registered routes', unknownLinks.join(', ') || `${menuRoutes.length} links`);
}

// 8. service worker cache strategy
{
  const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
  line(/staleWhileRevalidate|stale-while-revalidate/.test(sw), 'service worker revalidates js/css');
  line(/networkFirst/.test(sw), 'service worker serves HTML network-first');
  line(/CACHE_NAME\s*=\s*`[^`]*APP_VERSION/.test(sw), 'cache name is versioned');
  line(/SCOPE_KEY\s*=\s*new URL\(self\.registration\.scope\)/.test(sw), 'cache name is isolated by installation scope');
  const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] || '';
  const assets = [...block.matchAll(/['"](\.\/[^'"]*)['"]/g)].map(match => match[1]);
  const absent = assets.filter(path => path !== './' && !existsSync(join(ROOT, path.slice(2))));
  line(assets.length > 0 && absent.length === 0, 'all service worker precache assets exist', absent.join(', ') || `${assets.length} assets`);
  const missingModules = jsFiles.filter(path => path.startsWith(join(ROOT, 'js/')))
    .map(path => './' + path.slice(ROOT.length + 1)).filter(path => !assets.includes(path));
  line(missingModules.length === 0, 'fresh offline install precaches every app module', missingModules.join(', ') || 'complete');
}

console.log(`\n${failures === 0 ? 'ALL STATIC CHECKS PASSED' : failures + ' STATIC CHECK(S) FAILED'}`);
process.exit(failures ? 1 : 0);
