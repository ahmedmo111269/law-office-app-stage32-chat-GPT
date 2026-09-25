#!/usr/bin/env node
// Static import/export integrity checker for ES modules (no execution)
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === '.git' || e === 'node_modules' || e === 'qa' || e === 'eslint.config.mjs') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith('.js') || e.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const fileSet = new Set(files.map(f => resolve(f)));

// Extract exports from a file's source
function getExports(src) {
  const names = new Set();
  let hasDefault = false;
  // export function/async function/class/const/let/var NAME
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export { a, b as c }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/(?:^|\s)as\s+([A-Za-z_$][\w$]*)$/);
      names.add(as ? as[1] : t.replace(/^default\b/, 'default').split(/\s+/).pop());
      if (/^default\b/.test(t) || /\bas\s+default$/.test(t)) hasDefault = true;
    }
  }
  // export * from '...'  (re-export — mark as star)
  const stars = [...src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  if (/export\s+default\b/.test(src)) hasDefault = true;
  return { names, hasDefault, stars };
}

// Extract imports
function getImports(src) {
  const imps = [];
  // static: import default, {a, b as c}, * as ns from 'path'  |  import 'path'
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*)?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const [, def, clause, path] = m;
    const named = [];
    let ns = null;
    if (clause) {
      if (clause.startsWith('{')) {
        for (const part of clause.slice(1, -1).split(',')) {
          const t = part.trim(); if (!t) continue;
          const as = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+/);
          named.push(as ? as[1] : t);
        }
      } else ns = clause.match(/as\s+([A-Za-z_$][\w$]*)/)[1];
    }
    imps.push({ def, named, ns, path, dynamic: false });
  }
  // dynamic import('path')
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) imps.push({ path: m[1], dynamic: true, named: [] });
  return imps;
}

const exportCache = new Map();
function exportsOf(file) {
  if (!exportCache.has(file)) {
    try { exportCache.set(file, getExports(readFileSync(file, 'utf8'))); }
    catch { exportCache.set(file, null); }
  }
  return exportCache.get(file);
}

let errors = 0, checkedImports = 0, checkedNames = 0;
const report = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const imps = getImports(src);
  for (const imp of imps) {
    checkedImports++;
    if (!imp.path.startsWith('.')) continue; // Node/npm and browser-root imports are not project-local ES modules.
    const target = resolve(dirname(f), imp.path);
    const rel = relative(ROOT, f);
    if (!fileSet.has(target)) {
      // maybe extension-less or directory index
      const candidates = [target + '.js', join(target, 'index.js')];
      const found = candidates.find(c => fileSet.has(c));
      if (!found) { report.push(`MISSING FILE: ${rel} -> ${imp.path}`); errors++; continue; }
    }
    const tExports = exportsOf(target);
    if (!tExports) continue;
    const starNames = new Set();
    for (const s of tExports.stars) {
      const st = resolve(dirname(target), s);
      const se = exportsOf(st);
      if (se) for (const n of se.names) starNames.add(n);
    }
    if (imp.def && !tExports.hasDefault) { report.push(`MISSING DEFAULT EXPORT: ${rel} imports default from ${imp.path}`); errors++; }
    for (const n of imp.named) {
      checkedNames++;
      if (!tExports.names.has(n) && !starNames.has(n)) {
        report.push(`MISSING EXPORT: ${rel} imports { ${n} } from ${imp.path} — not exported there`);
        errors++;
      }
    }
  }
}

console.log(`Files scanned: ${files.length}`);
console.log(`Import statements checked: ${checkedImports}`);
console.log(`Named imports verified: ${checkedNames}`);
if (report.length) { console.log(`\n=== ${errors} PROBLEM(S) ===`); report.forEach(r => console.log(' • ' + r)); }
else console.log('\n✅ All imports resolve; all named exports exist.');
process.exit(report.length ? 1 : 0);
