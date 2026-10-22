#!/usr/bin/env node
// Smart E2E selector — runs only the Playwright specs your changes can touch.
//
//   npm run test:smart              # affected specs + canary + last failures
//   npm run test:smart -- --list    # print the selection only
//   SMART_BASE=origin/main npm run test:smart
//   npm run test:smart -- --full    # entire suite
//
// Extend RULES as features grow. An unmapped source change runs only the canary
// with a loud warning; a spec not named here is an orphan and fails `lint`.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMART_BASE || 'HEAD';
const CANARY = ['smoke'];

// ---- Source -> specs map. First match wins. 'ALL' = full suite. -------------
const RULES = [
  // tooling / tests don't touch the app under test
  { g: 'scripts/**', s: [] },
  { g: '**/*.test.ts', s: [] },
  // core/config — full suite
  { g: 'package*.json', s: 'ALL' },
  { g: 'vite.config.*', s: 'ALL' },
  { g: 'playwright*.config.ts', s: 'ALL' },
  { g: 'vitest.config.*', s: 'ALL' },
  { g: 'tsconfig*.json', s: 'ALL' },
  { g: 'index.html', s: 'ALL' },
  { g: 'e2e/helpers.ts', s: 'ALL' },
  // starter mapping — replace with feature rules as specs appear
  { g: 'src/**', s: CANARY },
  { g: 'services/**', s: [...CANARY, 'realtime'] },
  { g: 'views/**', s: CANARY },
  { g: 'components/**', s: CANARY },
  { g: 'i18n/**', s: CANARY },
  { g: 'constants.ts', s: CANARY },
  { g: 'server/**', s: CANARY },
  { g: 'workers/**', s: [...CANARY, 'realtime'] },
  { g: 'lib/**', s: CANARY },
  { g: 'app/**', s: CANARY },
  // core app shell — full suite
  { g: 'App.tsx', s: 'ALL' },
  { g: 'index.tsx', s: 'ALL' },
  { g: 'types.ts', s: 'ALL' },
];

function globRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${re}$`);
}
const compiled = RULES.map(({ g, s }) => ({ re: globRe(g), s }));
const firstMatch = (file) => {
  for (const { re, s } of compiled) if (re.test(file)) return s;
  return null;
};

function gitOut(args) {
  try { return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
  catch { return ''; }
}
function isRelevant(f) {
  return (
    f.startsWith('src/') || f.startsWith('server/') || f.startsWith('workers/') ||
    f.startsWith('lib/') || f.startsWith('app/') || f.startsWith('e2e/') || f.startsWith('scripts/') ||
    /^(package(?:-lock)?\.json|vite\.config\.[cm]?[jt]s?$|playwright[\w-]*\.config\.ts$|vitest\.config\.[cm]?[jt]s?$|tsconfig[\w-]*\.json$|index\.html)$/.test(f)
  );
}
function changedFiles() {
  const files = new Set();
  for (const line of gitOut(`diff --name-only ${BASE}`).split('\n')) if (line.trim()) files.add(line.trim());
  for (const line of gitOut('ls-files --others --exclude-standard').split('\n')) if (line.trim()) files.add(line.trim());
  return [...files].filter(isRelevant).sort();
}

function execInherit(bin, args) {
  try { execFileSync(bin, args, { cwd: ROOT, stdio: 'inherit' }); process.exit(0); }
  catch (e) { process.exit(typeof e.status === 'number' ? e.status : 1); }
}
function run(selection, listOnly) {
  if (listOnly) { console.log(selection && selection.length ? selection.join('\n') : '(full suite)'); return; }
  if (!selection) { console.log('running FULL suite'); execInherit('npx', ['playwright', 'test']); }
  console.log(`running ${selection.length} spec(s):`);
  console.log(selection.map((s) => `  ${s}`).join('\n'));
  execInherit('npx', ['playwright', 'test', ...selection]);
}

function main() {
  const listOnly = process.argv.includes('--list');
  const forceFull = process.argv.includes('--full');
  const changed = changedFiles();
  if (forceFull) { console.log('--full: running entire suite'); run(null, false); }
  if (!changed.length) { console.log(`no changes since ${BASE} — nothing to run. Use --full.`); process.exit(0); }

  const wanted = new Set(CANARY.map((s) => `e2e/${s}.spec.ts`));
  const unmatched = [];
  let full = false;
  for (const file of changed) {
    if (/^e2e\/.+\.spec\.ts$/.test(file)) { wanted.add(file); continue; }
    const s = firstMatch(file);
    if (s === 'ALL') { full = true; break; }
    if (s) s.forEach((spec) => wanted.add(`e2e/${spec}.spec.ts`));
    else unmatched.push(file);
  }

  try {
    const lr = JSON.parse(readFileSync(join(ROOT, 'test-results/.last-run.json'), 'utf8'));
    for (const t of lr.failedTests ?? []) {
      const m = String(t).match(/^(?:\[[^\]]+\]\s*›\s*)?(e2e\/[\w\-]+\.spec\.ts)/);
      if (m) wanted.add(m[1]);
    }
  } catch { /* no previous run */ }

  if (full) { console.log('core/config change detected — running FULL suite.'); run(null, listOnly); }
  if (unmatched.length) {
    console.warn('\nUNMAPPED changes (cannot attribute to specs) — running canaries only:');
    for (const f of unmatched) console.warn(`  ${f}`);
    console.warn('Add a mapping rule in scripts/smart-test.mjs, or run `npm run test:full` before done.\n');
  }
  console.log(`smart selection from ${BASE} (${changed.length} changed):`);
  for (const f of changed) console.log(`  - ${f}`);
  run([...wanted].sort(), listOnly);
}
main();
