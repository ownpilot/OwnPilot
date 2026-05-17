#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const heading = `## [${version}]`;
const start = changelog.indexOf(heading);

if (start === -1) {
  console.error(`x CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}

const rest = changelog.slice(start);
const next = rest.indexOf('\n## [', heading.length);
const section = (next === -1 ? rest : rest.slice(0, next)).trim();

console.log(section);
