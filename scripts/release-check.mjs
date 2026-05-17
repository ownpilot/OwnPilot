#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function fail(message) {
  console.error(`x ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`+ ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspacePackageFiles() {
  const files = ['package.json'];
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) {
    return files;
  }

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json'))) {
      files.push(join('packages', entry.name, 'package.json'));
    }
  }

  return files.sort();
}

const rootPkg = readJson(join(root, 'package.json'));
const version = rootPkg.version;
const expectedTag = `v${version}`;
let failed = false;

for (const file of workspacePackageFiles()) {
  const pkg = readJson(join(root, file));
  if (pkg.version !== version) {
    fail(`${file} is ${pkg.version}; expected ${version}`);
    failed = true;
  }
}
if (!failed) {
  ok(`workspace package versions are aligned at ${version}`);
}

const changelogPath = join(root, 'CHANGELOG.md');
if (!existsSync(changelogPath)) {
  fail('CHANGELOG.md is missing');
  failed = true;
} else {
  const changelog = readFileSync(changelogPath, 'utf8');
  if (!changelog.includes(`## [${version}]`)) {
    fail(`CHANGELOG.md does not contain a ${version} entry`);
    failed = true;
  } else {
    ok(`CHANGELOG.md contains ${version}`);
  }
}

if (existsSync(join(root, '.github', 'workflows', 'release.yml'))) {
  ok('release workflow exists');
} else {
  fail('.github/workflows/release.yml is missing');
  failed = true;
}

if (failed || process.exitCode) {
  process.exit(process.exitCode ?? 1);
}

console.log('');
console.log(`Release preflight passed for ${expectedTag}.`);
console.log('Next gates: pnpm release:verify, pnpm release:tag, pnpm release:publish.');
