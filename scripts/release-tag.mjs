#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;
const message = `OwnPilot ${tag}`;
const args = ['tag', '-a', tag, '-m', message];
const result = spawnSync('git', args, { stdio: 'inherit' });

process.exit(result.status ?? 1);
