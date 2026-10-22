#!/usr/bin/env node
// Deterministic guard against agent-doc bloat + roadmap/e2e drift.
//
// AGENTS.md loads into every session → hard budget. docs/*.md manuals are read on
// demand → looser budget. The live roadmap holds OPEN items only; the archive has
// unique stable ids. Every e2e spec must be reachable from smart-test RULES.
//
// Wired into `npm run lint` (and `npm run lint:docs`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BYTES_PER_TOKEN = 4;
const HUB = { file: 'AGENTS.md', maxLines: 200, maxBytes: 36000 };
const MANUAL = { maxLines: 400, maxBytes: 50000 };
const EXEMPT = new Set(['ROADMAP.md', 'ROADMAP-ARCHIVE.md', 'ROADMAP-KIT.md']);

const errors = [];
const warnings = [];
const read = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
};
const measure = (text) => {
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const bytes = Buffer.byteLength(text, 'utf8');
  return { lines, bytes, tokens: Math.round(bytes / BYTES_PER_TOKEN) };
};
const fmt = (n) => n.toLocaleString('en-US');
const row = (rel, m, cap) => {
  const pct = cap ? Math.round((m.lines / cap.maxLines) * 100) : null;
  const over = cap && (m.lines > cap.maxLines || m.bytes > cap.maxBytes);
  return `  ${rel.padEnd(42)} ${String(m.lines).padStart(5)} lines  ${fmt(m.bytes).padStart(8)} B  ~${fmt(m.tokens).padStart(6)} tok  ${cap ? (over ? 'OVER' : `${pct}%`) : 'exempt'}`;
};

// --- hub + manuals -----------------------------------------------------------
const hubText = read(HUB.file);
if (!hubText) {
  warnings.push(`no ${HUB.file} — add the Roadmap + Testing pointer sections.`);
} else {
  const hub = measure(hubText);
  console.log(`Agent-doc budget (hub cap: ${HUB.maxLines} lines / ${fmt(HUB.maxBytes)} B)\n`);
  console.log(row(HUB.file, hub, HUB));
  if (hub.lines > HUB.maxLines || hub.bytes > HUB.maxBytes) {
    errors.push(`${HUB.file} is over budget (${hub.lines}/${HUB.maxLines} lines, ${fmt(hub.bytes)}/${fmt(HUB.maxBytes)} B). Move detail to a docs manual and leave a summary + pointers.`);
  }
}

const docsDir = join(ROOT, 'docs');
if (existsSync(docsDir)) {
  console.log('\nOn-demand manuals (cap: ~%d lines / %s B):', MANUAL.maxLines, fmt(MANUAL.maxBytes));
  for (const f of readdirSync(docsDir).filter((x) => x.endsWith('.md')).sort()) {
    const rel = `docs/${f}`;
    const text = read(rel);
    if (text === null) continue;
    const m = measure(text);
    if (EXEMPT.has(f)) { console.log(row(rel, m, null)); continue; }
    console.log(row(rel, m, MANUAL));
    if (m.lines > MANUAL.maxLines || m.bytes > MANUAL.maxBytes) {
      warnings.push(`${rel} is over its manual cap (${m.lines}/${MANUAL.maxLines} lines, ${fmt(m.bytes)}/${fmt(MANUAL.maxBytes)} B) — split it or move detail into a focused sibling doc.`);
    }
    const head = text.split('\n').slice(0, 8).join('\n');
    if (!/^#\s+\S/m.test(head)) warnings.push(`${rel} has no "# Title" in its first lines.`);
    if (!/read this|read before|status:/i.test(head)) warnings.push(`${rel} has no read-first/Status line in its first 8 lines.`);
  }
} else {
  warnings.push('no docs/ directory — run the scaffold with --docs.');
}

// --- roadmap -----------------------------------------------------------------
const roadmapText = read('docs/ROADMAP.md');
const archiveText = read('docs/ROADMAP-ARCHIVE.md');
if (!roadmapText || !archiveText) {
  warnings.push('no docs/ROADMAP.md or docs/ROADMAP-ARCHIVE.md — run the scaffold with --roadmap.');
} else {
  const doneInLive = [...roadmapText.matchAll(/^##\s+\d+\..*\[x\]/gm)].map((m) => m[0].trim());
  const openCount = [...roadmapText.matchAll(/^##\s+\d+\..*/gm)].length;
  const ids = [...archiveText.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  const dupIds = [...new Set(ids.filter((n, i) => ids.indexOf(n) !== i))];
  console.log('\nRoadmap hygiene: %d open item(s); %d archived index row(s).', openCount, ids.length);
  if (doneInLive.length) {
    errors.push(`docs/ROADMAP.md contains ${doneInLive.length} completed ([x]) item(s) — the live roadmap must hold OPEN items only. Move each to a one-line archive row and delete the section. Found: ${doneInLive.slice(0, 5).join(' | ')}`);
  }
  if (dupIds.length) errors.push(`docs/ROADMAP-ARCHIVE.md has duplicate item id(s): ${dupIds.join(', ')} — ids are stable and unique.`);
}

// --- e2e hygiene -------------------------------------------------------------
const e2eDir = join(ROOT, 'e2e');
const smartSrc = read('scripts/smart-test.mjs');
const specFiles = existsSync(e2eDir) ? readdirSync(e2eDir).filter((x) => x.endsWith('.spec.ts')).sort() : [];
if (existsSync(e2eDir)) {
  const orphans = [];
  if (smartSrc) {
    for (const f of specFiles) {
      const base = f.replace(/\.spec\.ts$/, '');
      if (smartSrc.includes(`'${base}'`)) continue;
      const body = read(`e2e/${f}`) ?? '';
      const titles = [...body.matchAll(/\btest(?:\.\w+)?\(\s*['"`]([^'"`]*)/g)].map((m) => m[1]);
      const excluded = titles.length > 0 && titles.every((t) => /@perf|@quarantine/.test(t));
      if (!excluded) orphans.push(`e2e/${f}`);
    }
  }
  console.log('\nE2E specs: %d total, %d orphaned (not in smart-test RULES).', specFiles.length, orphans.length);
  if (orphans.length) errors.push(`unmapped e2e spec(s) — reachable from no smart-test RULES entry: ${orphans.join(', ')}. Add the base name to a bucket in scripts/smart-test.mjs, or tag @perf/@quarantine.`);

  // Anti-regrowth ratchet: waits are the #1 flake source.
  const E2E_WAIT_BASELINE = 0;
  let waitCount = 0;
  for (const f of specFiles) {
    const body = read(`e2e/${f}`) ?? '';
    if (body.includes('@perf')) continue;
    waitCount += (body.match(/waitForTimeout\(/g) || []).length;
  }
  console.log('Non-@perf waitForTimeout calls: %d / baseline %d.', waitCount, E2E_WAIT_BASELINE);
  if (waitCount > E2E_WAIT_BASELINE) {
    errors.push(`non-@perf waitForTimeout calls rose to ${waitCount} (baseline ${E2E_WAIT_BASELINE}) — prefer expect/expect.poll/waitForFunction. If a wait is genuine drag/canvas pacing, lower another or raise the baseline consciously.`);
  }

  // Selector drift: flag fragile locators (non-blocking).
  const FRAGILE = [
    { re: /locator\((['"`])[^'"`]*\[style\*=[^\])]*/g, why: 'inline-style selector' },
    { re: /locator\((['"`])div\.[a-zA-Z]/g, why: 'utility-class selector' },
    { re: /locator\((['"`])\.\./g, why: 'parent (..) selector' },
    { re: /locator\((['"`])[^'"`]*\[class\*=/g, why: '[class*=] selector' },
  ];
  let fragileTotal = 0;
  const fragileFiles = [];
  for (const f of specFiles) {
    const body = read(`e2e/${f}`) ?? '';
    const n = FRAGILE.reduce((sum, { re }) => sum + (body.match(re)?.length || 0), 0);
    if (n) { fragileTotal += n; fragileFiles.push(f); }
  }
  if (fragileTotal) warnings.push(`${fragileTotal} fragile locator(s) across ${fragileFiles.length} spec(s) — prefer role/getByTestId/data-*; files: ${fragileFiles.slice(0, 4).join(', ')}.`);

  // Suite-size ratchet: deliberate growth only.
  const E2E_SPEC_CAP = 12;
  const E2E_TEST_CAP = 40;
  const e2eTestCount = specFiles.reduce((n, f) => n + ((read(`e2e/${f}`) ?? '').match(/^\s*test\(/gm) || []).length, 0);
  console.log('E2E suite: %d specs / %d tests (caps %d / %d).', specFiles.length, e2eTestCount, E2E_SPEC_CAP, E2E_TEST_CAP);
  if (specFiles.length > E2E_SPEC_CAP || e2eTestCount > E2E_TEST_CAP) {
    errors.push(`e2e suite grew past its cap (${specFiles.length}/${E2E_SPEC_CAP} specs, ${e2eTestCount}/${E2E_TEST_CAP} tests) — merge into an existing spec, move pure logic to a unit test, or raise the cap consciously (docs/TESTING.md).`);
  }
} else {
  console.log('\nNo e2e/ directory — skipping e2e hygiene (run the scaffold with --tests).');
}

if (warnings.length) {
  console.log('\nWarnings (non-blocking):');
  for (const w of warnings) console.log(`  - ${w}`);
}
if (errors.length) {
  console.log('\nFAIL: doc/roadmap hygiene.\n');
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\nDoc budget + roadmap + e2e hygiene OK.');
