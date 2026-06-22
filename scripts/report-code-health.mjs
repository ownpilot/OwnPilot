#!/usr/bin/env node
/**
 * Code Health Reporter
 *
 * Generates read-only structural metrics for refactor planning.
 * Run: node scripts/report-code-health.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const sourceRoots = [
  'packages/core/src',
  'packages/gateway/src',
  'packages/cli/src',
  'packages/ui/src',
];

const ignoreDirs = new Set(['node_modules', 'dist', 'coverage', '.turbo']);
const sourceExtRe = /\.(ts|tsx)$/;
const testRe = /(?:^|[.\-\/])(?:test|spec)\.(ts|tsx)$|\.test\.(ts|tsx)$|\.spec\.(ts|tsx)$/;

const patterns = [
  { key: 'asAny', label: '`as any`', re: /\bas any\b/g },
  { key: 'asUnknownAs', label: '`as unknown as`', re: /as unknown as/g },
  { key: 'todoFixme', label: '`TODO|FIXME|HACK|XXX`', re: /\bTODO\b|\bFIXME\b|HACK|XXX/g },
  {
    key: 'innerHtml',
    label: '`dangerouslySetInnerHTML|innerHTML =`',
    re: /dangerouslySetInnerHTML|innerHTML\s*=/g,
  },
  { key: 'evalLike', label: '`eval|new Function`', re: /new Function|\beval\s*\(/g },
  {
    key: 'childProcess',
    label: '`child_process|spawn|exec`',
    re: /child_process|exec\(|execFile\(|spawn\(/g,
  },
  { key: 'mathRandom', label: '`Math.random()`', re: /Math\.random\s*\(/g },
  { key: 'eslintDisable', label: '`eslint-disable`', re: /eslint-disable/g },
  { key: 'tsExpectError', label: '`@ts-expect-error`', re: /@ts-expect-error/g },
  { key: 'console', label: '`console.*`', re: /console\.(log|error|warn|debug)\(/g },
  { key: 'jsonParse', label: '`JSON.parse()`', re: /JSON\.parse\(/g },
];

function toPosix(path) {
  return path.split(sep).join('/');
}

function packageName(relPath) {
  const parts = toPosix(relPath).split('/');
  return parts[1] ?? 'root';
}

function isTestFile(relPath) {
  return testRe.test(toPosix(relPath));
}

function collectFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, acc);
    } else if (sourceExtRe.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function emptyPatternCounts() {
  return Object.fromEntries(patterns.map((p) => [p.key, 0]));
}

function countMatches(content, re) {
  return (content.match(re) ?? []).length;
}

const allFiles = sourceRoots.flatMap((src) => collectFiles(join(root, src)));
const totals = {
  all: emptyPatternCounts(),
  production: emptyPatternCounts(),
  test: emptyPatternCounts(),
};
const packageStats = new Map();
const topFiles = [];
const largeProductionFiles = [];

for (const fullPath of allFiles) {
  const relPath = toPosix(relative(root, fullPath));
  const content = readFileSync(fullPath, 'utf8');
  const lines = content.split(/\r?\n/).length;
  const isTest = isTestFile(relPath);
  const pkg = packageName(relPath);

  if (!packageStats.has(pkg)) {
    packageStats.set(pkg, {
      files: 0,
      productionFiles: 0,
      testFiles: 0,
      loc: 0,
      productionLoc: 0,
      testLoc: 0,
    });
  }
  const stat = packageStats.get(pkg);
  stat.files += 1;
  stat.loc += lines;
  if (isTest) {
    stat.testFiles += 1;
    stat.testLoc += lines;
  } else {
    stat.productionFiles += 1;
    stat.productionLoc += lines;
  }

  topFiles.push({ lines, path: relPath, test: isTest });
  if (!isTest && lines > 500) largeProductionFiles.push({ lines, path: relPath });

  for (const pattern of patterns) {
    const count = countMatches(content, pattern.re);
    totals.all[pattern.key] += count;
    totals[isTest ? 'test' : 'production'][pattern.key] += count;
  }
}

topFiles.sort((a, b) => b.lines - a.lines);
largeProductionFiles.sort((a, b) => b.lines - a.lines);

function sourceForTestCandidate(relPath) {
  return relPath.replace(/\.test\.(ts|tsx)$/, '.$1').replace(/\.spec\.(ts|tsx)$/, '.$1');
}

function hasNearbyTest(relPath, testSet) {
  if (testSet.has(relPath.replace(/\.(ts|tsx)$/, '.test.$1'))) return true;
  if (testSet.has(relPath.replace(/\.(ts|tsx)$/, '.spec.$1'))) return true;
  return false;
}

const relFiles = allFiles.map((f) => toPosix(relative(root, f)));
const testSources = new Set(relFiles.filter(isTestFile).map(sourceForTestCandidate));
const testFiles = new Set(relFiles.filter(isTestFile));
const untestedGatewayServices = relFiles
  .filter((f) => f.startsWith('packages/gateway/src/services/'))
  .filter((f) => !isTestFile(f))
  .filter((f) => !f.endsWith('/types.ts') && !f.endsWith('-types.ts') && !f.endsWith('/index.ts'))
  .filter((f) => !testSources.has(f) && !hasNearbyTest(f, testFiles))
  .sort();

function printTable(rows) {
  for (const row of rows) console.log(row.join(' | '));
}

console.log('# Code Health Report');
console.log('');
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Files scanned: ${allFiles.length}`);
console.log('');

console.log('## Package summary');
console.log('');
printTable([
  ['Package', 'Files', 'Prod files', 'Test files', 'LOC', 'Prod LOC', 'Test LOC'],
  ['---', '---:', '---:', '---:', '---:', '---:', '---:'],
  ...[...packageStats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, s]) => [
      pkg,
      String(s.files),
      String(s.productionFiles),
      String(s.testFiles),
      String(s.loc),
      String(s.productionLoc),
      String(s.testLoc),
    ]),
]);
console.log('');

console.log('## Risk signal counts');
console.log('');
printTable([
  ['Pattern', 'Production', 'Tests', 'All'],
  ['---', '---:', '---:', '---:'],
  ...patterns.map((p) => [
    p.label,
    String(totals.production[p.key]),
    String(totals.test[p.key]),
    String(totals.all[p.key]),
  ]),
]);
console.log('');

console.log('## Largest production files');
console.log('');
printTable([
  ['LOC', 'File'],
  ['---:', '---'],
  ...largeProductionFiles.slice(0, 25).map((f) => [String(f.lines), f.path]),
]);
console.log('');

console.log('## Production files over thresholds');
console.log('');
console.log(`> 500 LOC: ${largeProductionFiles.filter((f) => f.lines > 500).length}`);
console.log(`> 800 LOC: ${largeProductionFiles.filter((f) => f.lines > 800).length}`);
console.log(`> 1000 LOC: ${largeProductionFiles.filter((f) => f.lines > 1000).length}`);
console.log('');

console.log('## Gateway services without direct colocated tests');
console.log('');
console.log(`Count: ${untestedGatewayServices.length}`);
for (const file of untestedGatewayServices.slice(0, 80)) console.log(`- ${file}`);
if (untestedGatewayServices.length > 80) {
  console.log(`- ... ${untestedGatewayServices.length - 80} more`);
}
