/**
 * Phase 1 Migration: Fix single sub-path vi.mock('@ownpilot/core') calls.
 *
 * For each file where the source imports from exactly ONE sub-path:
 *   1. Changes vi.mock('@ownpilot/core', ...) → vi.mock('@ownpilot/core/<sub>', ...)
 *   2. If the mock doesn't use importOriginal, adds it so unmocked exports survive
 *
 * Run: node scripts/migrate-phase1.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const report = execSync('node scripts/detect-mock-mismatch.mjs', {
  encoding: 'utf-8',
  cwd: process.cwd(),
});

// Parse single sub-path files from BROKEN section
const singleFiles = [];
let inBroken = false;
for (const line of report.split('\n')) {
  if (line.includes('BROKEN')) {
    inBroken = true;
    continue;
  }
  if (line.includes('AT-RISK')) break;
  if (!inBroken) continue;
  const m = line.match(/^\s+(\S+\.test\.ts)\s+→\s+\[(\w+)\]\s*$/);
  if (m) singleFiles.push({ file: m[1], subPath: m[2] });
}

console.log(`Found ${singleFiles.length} single sub-path files to migrate\n`);

const base = 'packages/gateway/src/';
let fixed = 0,
  skipped = 0;

for (const { file, subPath } of singleFiles) {
  const fullPath = base + file;
  let content;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch {
    console.log(`  SKIP ${file} (not found)`);
    skipped++;
    continue;
  }

  if (!/vi\.mock\((['"])@ownpilot\/core['"],/.test(content)) {
    console.log(`  SKIP ${file} (already fixed)`);
    skipped++;
    continue;
  }

  const newPath = `@ownpilot/core/${subPath}`;

  // Case 1: Already has importOriginal — just change the path
  if (/vi\.mock\((['"])@ownpilot\/core['"],\s*async\s*\(\s*importOriginal/.test(content)) {
    content = content.replace(/vi\.mock\((['"])@ownpilot\/core['"],/, `vi.mock('${newPath}',`);
  }
  // Case 2: Simple factory `() => ({` — add importOriginal wrapper
  else if (/vi\.mock\((['"])@ownpilot\/core['"],\s*\(\)\s*=>\s*\(\{/.test(content)) {
    content = content.replace(
      /vi\.mock\((['"])@ownpilot\/core['"],\s*\(\)\s*=>\s*\(\{/,
      `vi.mock('${newPath}', async (importOriginal) => ({\n  ...(await importOriginal<Record<string, unknown>>()),`
    );
  }
  // Case 3: Block factory `() => {` — add importOriginal + spread
  else if (/vi\.mock\((['"])@ownpilot\/core['"],\s*\(\)\s*=>\s*\{/.test(content)) {
    content = content.replace(
      /vi\.mock\((['"])@ownpilot\/core['"],\s*\(\)\s*=>\s*\{/,
      `vi.mock('${newPath}', async (importOriginal) => {\n  const actual = await importOriginal<Record<string, unknown>>();\n  return {\n    ...actual,`
    );
    // The original return statement needs closing brace adjustment
    // Find `}));` or `});` that closes the mock and ensure proper nesting
    // Actually this is tricky — just change path for block factories and
    // let tests reveal if importOriginal is needed
    content = readFileSync(fullPath, 'utf-8');
    content = content.replace(/vi\.mock\((['"])@ownpilot\/core['"],/, `vi.mock('${newPath}',`);
    console.log(`  WARN ${file} uses block factory — path changed, manual review may be needed`);
  }
  // Case 4: Any other pattern — just change path
  else {
    content = content.replace(/vi\.mock\((['"])@ownpilot\/core['"],/, `vi.mock('${newPath}',`);
  }

  writeFileSync(fullPath, content, 'utf-8');
  console.log(`  FIX  ${file}  →  ${newPath}`);
  fixed++;
}

console.log(`\nDone: ${fixed} fixed, ${skipped} skipped`);
