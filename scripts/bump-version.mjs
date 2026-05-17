#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const arg = process.argv[2];

function fail(message) {
  console.error(`x ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    fail(`Invalid semver: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function formatVersion(parts) {
  const base = `${parts.major}.${parts.minor}.${parts.patch}`;
  return parts.prerelease ? `${base}-${parts.prerelease}` : base;
}

function nextVersion(current, bump) {
  const version = parseVersion(current);
  if (bump === 'major') {
    return `${version.major + 1}.0.0`;
  }
  if (bump === 'minor') {
    return `${version.major}.${version.minor + 1}.0`;
  }
  if (bump === 'patch') {
    return `${version.major}.${version.minor}.${version.patch + 1}`;
  }
  if (bump === 'prerelease') {
    const label = version.prerelease ?? 'rc.0';
    const next = label.replace(/(\d+)$/, (value) => String(Number(value) + 1));
    return formatVersion({ ...version, prerelease: next === label ? `${label}.1` : next });
  }
  parseVersion(bump);
  return bump;
}

function workspacePackageFiles() {
  const files = ['package.json'];
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) {
    return files;
  }

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pkg = join('packages', entry.name, 'package.json');
    if (existsSync(join(root, pkg))) {
      files.push(pkg);
    }
  }

  return files.sort();
}

if (!arg) {
  fail('Usage: node scripts/bump-version.mjs <major|minor|patch|prerelease|x.y.z>');
}

const rootPkg = readJson(join(root, 'package.json'));
const currentVersion = rootPkg.version;
const newVersion = nextVersion(currentVersion, arg);

if (newVersion === currentVersion) {
  fail(`Version is already ${newVersion}`);
}

for (const file of workspacePackageFiles()) {
  const path = join(root, file);
  const pkg = readJson(path);
  if ('version' in pkg) {
    pkg.version = newVersion;
    writeJson(path, pkg);
    console.log(`+ ${file}`);
  }
}

const archPath = join(root, 'docs', 'ARCHITECTURE.md');
if (existsSync(archPath)) {
  const next = readFileSync(archPath, 'utf8').replace(
    /\*\*Version:\*\* .+/,
    `**Version:** ${newVersion}`
  );
  writeFileSync(archPath, next);
  console.log('+ docs/ARCHITECTURE.md');
}

for (const file of ['start.sh', 'start.ps1']) {
  const path = join(root, file);
  if (!existsSync(path)) {
    continue;
  }
  const next = readFileSync(path, 'utf8').replace(
    /Gateway v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    `Gateway v${newVersion}`
  );
  writeFileSync(path, next);
  console.log(`+ ${file}`);
}

console.log('');
console.log(`Version bumped: ${currentVersion} -> ${newVersion}`);
console.log(`Next: update CHANGELOG.md, run pnpm release:verify, tag v${newVersion}.`);
