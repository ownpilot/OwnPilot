/**
 * Phase 3 Migration: Auto-split multi-sub-path vi.mock() calls.
 *
 * For each broken file:
 * 1. Read source to get { symbol → subPath } from imports
 * 2. Parse test mock block with brace-depth tracking (top-level keys only)
 * 3. Group keys by sub-path
 * 4. Generate and apply split mock code
 *
 * Run: node scripts/migrate-phase3-apply.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run');
const base = 'packages/gateway/src/';

// Step 1: Get broken files
const report = execSync('node scripts/detect-mock-mismatch.mjs', {
  encoding: 'utf-8',
  cwd: process.cwd(),
});
const brokenFiles = [];
for (const line of report.split('\n')) {
  const m = line.match(/^\s+(\S+\.test\.ts)\s+→\s+\[([\w,\s]+)\]$/);
  if (m) brokenFiles.push({ file: m[1], subPaths: m[2].split(',').map((s) => s.trim()) });
}

console.log(`Files to process: ${brokenFiles.length}\n`);

// Step 2: Build global symbol→subPath map from @ownpilot/core exports
const coreFiles = [
  ['agent', 'packages/core/src/agent/index.ts'],
  ['services', 'packages/core/src/services/index.ts'],
  ['events', 'packages/core/src/events/index.ts'],
  ['channels', 'packages/core/src/channels/index.ts'],
  ['plugins', 'packages/core/src/plugins/index.ts'],
  ['costs', 'packages/core/src/costs/index.ts'],
  ['sandbox', 'packages/core/src/sandbox/index.ts'],
  ['privacy', 'packages/core/src/privacy/index.ts'],
  ['scheduler', 'packages/core/src/scheduler/index.ts'],
  ['types', 'packages/core/src/types/index.ts'],
  ['memory', 'packages/core/src/memory/index.ts'],
  ['workspace', 'packages/core/src/workspace/index.ts'],
  ['edge', 'packages/core/src/edge/index.ts'],
  ['audit', 'packages/core/src/audit/index.ts'],
  ['version', 'packages/core/src/version.ts'],
];
const globalSymbolMap = new Map();
for (const [sp, file] of coreFiles) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }
  // Match export { foo, bar as baz } and export const foo = ...
  const reExport = /export\s*\{([^}]+)\}/g;
  const directExport = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  let m;
  while ((m = reExport.exec(content)) !== null) {
    for (const name of m[1].split(',')) {
      const parts = name.trim().split(/\s+as\s+/);
      const final = parts[parts.length - 1].trim();
      if (final && final !== 'default' && !globalSymbolMap.has(final))
        globalSymbolMap.set(final, sp);
    }
  }
  while ((m = directExport.exec(content)) !== null) {
    if (!globalSymbolMap.has(m[1])) globalSymbolMap.set(m[1], sp);
  }
}

/** Get symbol→subPath from source file imports */
function getSourceImportMap(srcFile) {
  let content;
  try {
    content = readFileSync(srcFile, 'utf-8');
  } catch {
    return null;
  }
  const map = new Map();
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]@ownpilot\/core\/(\w+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const sp = m[2];
    for (const name of m[1].split(',')) {
      const parts = name.trim().split(/\s+as\s+/);
      const local = parts[parts.length - 1].trim();
      const orig = parts[0].trim();
      if (local && local !== 'type') {
        map.set(local, sp);
        map.set(orig, sp);
      }
    }
  }
  return map;
}

/** Extract top-level keys from mock block (brace-depth tracking across lines) */
function extractTopLevelKeys(mockLines) {
  const keys = [];
  let braceDepth = 0;
  for (const line of mockLines) {
    // Find key at current depth BEFORE processing this line's braces
    // A top-level key in the returned object is at braceDepth >= 1
    // But we need to be in the INNERMOST object, not a nested one
    // The returned object typically starts at braceDepth 1 (for () => ({})
    // or braceDepth 2 (for () => { return { } })

    // Match: `  keyName: value` where keyName is a word at the start
    const keyMatch = line.match(/^\s+(\w+):\s/);
    if (keyMatch) {
      // Check: is this key at the right depth?
      // We want keys that are direct children of the returned object.
      // For `() => ({ key: value })` — the returned object is at depth 1
      // For `() => { const x = ...; return { key: value }; }` — returned object is at depth 2
      // Heuristic: if braceDepth >= 1 and the key is NOT inside a nested object
      // (i.e., no `{` on this line before the key that would increase depth)
      const beforeKey = line.substring(0, line.indexOf(keyMatch[1]));
      let localDepth = 0;
      for (const ch of beforeKey) {
        if (ch === '{') localDepth++;
        if (ch === '}') localDepth--;
      }
      // The key is top-level if: total depth (braceDepth + localDepth) is the
      // depth of the returned object. We detect this by checking if there's
      // no `{` opening a nested object before the key on this line.
      if (localDepth === 0 && braceDepth >= 1) {
        keys.push(keyMatch[1]);
      }
    }
    // Update brace depth for subsequent lines
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
  }
  return keys;
}

let fixed = 0,
  skipped = 0;

for (const { file } of brokenFiles) {
  const testPath = base + file;
  const srcPath = testPath.replace('.test.ts', '.ts');

  let content;
  try {
    content = readFileSync(testPath, 'utf-8');
  } catch {
    continue;
  }

  const lines = content.split('\n');

  // Find mock block start
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/vi\.mock\((['"])@ownpilot\/core['"],/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    skipped++;
    continue;
  }

  // Find mock block end (track depth)
  let depth = 0,
    end = start;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if ('({'.includes(ch)) depth++;
      if (')}'.includes(ch)) depth--;
    }
    if (i > start && depth <= 0) {
      end = i;
      break;
    }
  }

  const mockLines = lines.slice(start, end + 1);
  const mockBlock = mockLines.join('\n');

  // Get source import map
  const importMap = getSourceImportMap(srcPath);
  if (!importMap) {
    console.log(`  SKIP ${file} (no source)`);
    skipped++;
    continue;
  }

  // Extract top-level keys
  const keys = extractTopLevelKeys(mockLines);
  if (keys.length === 0) {
    console.log(`  SKIP ${file} (no keys found)`);
    skipped++;
    continue;
  }

  // Group keys by sub-path
  const groups = {}; // { subPath: Set<keys> }
  const unmapped = [];

  for (const key of keys) {
    const sp = importMap.get(key) || globalSymbolMap.get(key);
    if (sp) {
      if (!groups[sp]) groups[sp] = [];
      groups[sp].push(key);
    } else {
      unmapped.push(key);
    }
  }

  // Check if we have a usable grouping
  const subPathsUsed = Object.keys(groups);
  if (subPathsUsed.length === 0) {
    console.log(`  SKIP ${file} (no mapped symbols among: ${keys.join(', ')})`);
    skipped++;
    continue;
  }

  // For unmapped keys, add them to all groups (safe with importOriginal)
  if (unmapped.length > 0) {
    for (const sp of subPathsUsed) {
      groups[sp].push(...unmapped);
    }
  }

  // Check: if only one sub-path, just change the path
  if (subPathsUsed.length === 1) {
    const newPath = `@ownpilot/core/${subPathsUsed[0]}`;
    // Just replace the path in the mock line
    lines[start] = lines[start].replace(
      /vi\.mock\((['"])@ownpilot\/core['"],/,
      `vi.mock('${newPath}',`
    );
    if (!dryRun) writeFileSync(testPath, lines.join('\n'), 'utf-8');
    console.log(`  FIX  ${file} → ${newPath} (single sub-path)`);
    fixed++;
    continue;
  }

  // Multiple sub-paths: need to check if the mock block can be cleanly split
  // For safety, if the mock has complex syntax (classes, nested functions),
  // we can't auto-split — skip for manual review
  const hasComplex = mockBlock.includes('class ') || /\bfunction\b/.test(mockBlock);
  if (hasComplex) {
    console.log(`  SKIP ${file} (complex syntax, needs manual split: ${subPathsUsed.join(', ')})`);
    skipped++;
    continue;
  }

  // Auto-split: generate separate vi.mock() calls for each sub-path
  // Each mock gets importOriginal + the keys belonging to that sub-path
  // Strategy: keep the original mock block content, just duplicate it for
  // each sub-path with only the relevant keys.

  // Actually, the safest auto-split is:
  // 1. Keep ALL keys in EACH mock (with importOriginal spread)
  // This works because importOriginal brings in the real exports,
  // and each mock only overrides what it knows about. Extra keys in
  // the wrong sub-path mock are just unused properties on the module.
  //
  // But this is wasteful. A better approach: only put each key in its
  // correct sub-path mock.
  //
  // For simple key:value mocks, we can do this. For mocks with
  // complex structures (multi-line values), it's risky.

  // Check if all keys have simple single-line values
  const isSimple = mockLines.every((line, i) => {
    if (i === 0 || i === mockLines.length - 1) return true; // skip vi.mock line and closing
    // Simple = either a comment, blank, or `  key: value,` on one line
    return (
      line.trim() === '' ||
      line.trim().startsWith('//') ||
      line.match(/^\s+\w+:\s+.+[,]?\s*$/) !== null
    );
  });

  if (!isSimple) {
    console.log(
      `  SKIP ${file} (multi-line values, needs manual split: ${subPathsUsed.join(', ')})`
    );
    skipped++;
    continue;
  }

  // Auto-split simple mocks
  // Extract key→value pairs
  const pairs = {};
  for (const line of mockLines) {
    const m = line.match(/^\s+(\w+):\s+(.+)[,]?\s*$/);
    if (m && keys.includes(m[1])) {
      pairs[m[1]] = m[2].replace(/[,]?\s*$/, '');
    }
  }

  // Determine if mock uses importOriginal
  const usesImportOriginal = /importOriginal/.test(mockBlock);
  const usesImportActual = /vi\.importActual/.test(mockBlock);

  // Generate split mocks
  const newMocks = [];
  for (const sp of subPathsUsed) {
    const path = `@ownpilot/core/${sp}`;
    const spKeys = groups[sp];
    const entries = spKeys.map((k) => `    ${k}: ${pairs[k] || 'undefined'},`).join('\n');

    if (usesImportOriginal || usesImportActual) {
      if (usesImportActual) {
        newMocks.push(`vi.mock('${path}', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ownpilot/core');
  return {
    ...actual,
${entries}
  };
});`);
      } else {
        newMocks.push(`vi.mock('${path}', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
${entries}
  };
});`);
      }
    } else {
      newMocks.push(`vi.mock('${path}', () => ({
${entries}
}));`);
    }
  }

  const replacement = newMocks.join('\n\n');

  if (dryRun) {
    console.log(
      `  DRY  ${file} → split into ${subPathsUsed.length} mocks (${subPathsUsed.join(', ')})`
    );
  } else {
    // Replace lines start..end with the new mocks
    const newLines = [
      ...lines.slice(0, start),
      ...replacement.split('\n'),
      ...lines.slice(end + 1),
    ];
    writeFileSync(testPath, newLines.join('\n'), 'utf-8');
    console.log(
      `  FIX  ${file} → split into ${subPathsUsed.length} mocks (${subPathsUsed.join(', ')})`
    );
  }
  fixed++;
}

console.log(`\nDone: ${fixed} fixed, ${skipped} skipped (need manual review)`);
