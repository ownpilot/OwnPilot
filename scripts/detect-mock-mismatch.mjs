/**
 * Mock Sub-Path Migration Detector
 *
 * Detects test files that use vi.mock('@ownpilot/core', ...) where the
 * corresponding source file imports from @ownpilot/core/* sub-paths.
 *
 * WHY: vi.mock() intercepts by module specifier. When source imports from
 * '@ownpilot/core/services' but the test mocks '@ownpilot/core', the mock
 * factory is never applied — real implementations run instead. Tests pass
 * but for the wrong reason (mocks silently ignored).
 *
 * Run: node scripts/detect-mock-mismatch.mjs
 *
 * Categories:
 *   BROKEN    — source already uses sub-paths, mock not applied (fix now)
 *   AT-RISK   — source still on main path, will break when source migrates
 *   NO-SOURCE — test has no 1:1 source file (integration test, etc.)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/** Scan a package src directory for .test.ts files */
function collectTests(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectTests(full, acc);
    else if (entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

const packages = [
  { name: 'gateway', dir: join(root, 'packages/gateway/src') },
  { name: 'cli', dir: join(root, 'packages/cli/src') },
  { name: 'ui', dir: join(root, 'packages/ui/src') },
];

let totalBroken = 0;
let totalAtRisk = 0;

for (const { name, dir } of packages) {
  let testFiles;
  try {
    testFiles = collectTests(dir);
  } catch {
    continue;
  }

  const broken = [];
  const atRisk = [];

  for (const testFile of testFiles) {
    const content = readFileSync(testFile, 'utf8');
    // Match vi.mock('@ownpilot/core', ... but NOT sub-path variants
    if (!/vi\.mock\((['"])@ownpilot\/core['"],/.test(content)) continue;

    const srcFile = testFile.replace('.test.ts', '.ts');
    const subPaths = [];
    try {
      const srcContent = readFileSync(srcFile, 'utf8');
      const importRe = /from\s+['"]@ownpilot\/core\/(\w+)['"]/g;
      let m;
      while ((m = importRe.exec(srcContent)) !== null) {
        if (!subPaths.includes(m[1])) subPaths.push(m[1]);
      }
    } catch {
      // No source file — skip
      continue;
    }

    const rel = testFile.replace(/\\/g, '/').replace(/.*packages\/[^/]+\/src\//, '');
    if (subPaths.length > 0) {
      broken.push({ file: rel, subPaths });
    } else {
      atRisk.push({ file: rel, subPaths: [] });
    }
  }

  if (broken.length === 0 && atRisk.length === 0) continue;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Package: ${name}`);
  console.log(`${'='.repeat(60)}`);

  if (broken.length > 0) {
    console.log(`\n🔴 BROKEN (${broken.length}) — mock not applied, fix now:`);
    for (const { file, subPaths } of broken.sort((a, b) => a.subPaths.length - b.subPaths.length)) {
      console.log(`   ${file}  →  [${subPaths.join(', ')}]`);
    }
  }

  if (atRisk.length > 0) {
    console.log(`\n🟡 AT-RISK (${atRisk.length}) — will break when source migrates:`);
    for (const { file } of atRisk) {
      console.log(`   ${file}`);
    }
  }

  totalBroken += broken.length;
  totalAtRisk += atRisk.length;
}

console.log(`\n${'='.repeat(60)}`);
console.log(`TOTALS: ${totalBroken} broken, ${totalAtRisk} at-risk`);
console.log(`${'='.repeat(60)}`);
