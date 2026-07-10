#!/usr/bin/env tsx
/**
 * Generate a squashed 001_initial_schema.sql from the TypeScript schema modules.
 *
 * The TypeScript modules in src/db/schema/ are the SOURCE OF TRUTH for the
 * database schema. The 41 individual SQL files in src/db/migrations/postgres/
 * are stale copies used only for Docker first-time init.
 *
 * This script reads the canonical schema from the TypeScript modules and
 * writes a single, correct 001_initial_schema.sql that replaces all 41 files.
 *
 * Usage: tsx scripts/generate-squashed-migration.ts
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(
  __dirname,
  '..',
  'src',
  'db',
  'migrations',
  'postgres',
  '001_initial_schema.sql'
);

// Import all schema modules
const { CORE_TABLES_SQL, CORE_MIGRATIONS_SQL, CORE_INDEXES_SQL } =
  await import('../src/db/schema/core.js');

const { PERSONAL_DATA_TABLES_SQL, PERSONAL_DATA_MIGRATIONS_SQL, PERSONAL_DATA_INDEXES_SQL } =
  await import('../src/db/schema/personal-data.js');

const { PRODUCTIVITY_TABLES_SQL, PRODUCTIVITY_MIGRATIONS_SQL, PRODUCTIVITY_INDEXES_SQL } =
  await import('../src/db/schema/productivity.js');

const { AUTONOMOUS_TABLES_SQL, AUTONOMOUS_MIGRATIONS_SQL, AUTONOMOUS_INDEXES_SQL } =
  await import('../src/db/schema/autonomous.js');

const { WORKSPACES_TABLES_SQL, WORKSPACES_MIGRATIONS_SQL, WORKSPACES_INDEXES_SQL } =
  await import('../src/db/schema/workspaces.js');

const { MODELS_TABLES_SQL, MODELS_MIGRATIONS_SQL, MODELS_INDEXES_SQL } =
  await import('../src/db/schema/models.js');

const { WORKFLOWS_TABLES_SQL, WORKFLOWS_MIGRATIONS_SQL, WORKFLOWS_INDEXES_SQL } =
  await import('../src/db/schema/workflows.js');

const { CODING_AGENTS_TABLES_SQL, CODING_AGENTS_MIGRATIONS_SQL, CODING_AGENTS_INDEXES_SQL } =
  await import('../src/db/schema/coding-agents.js');

const { SOULS_TABLES_SQL, SOULS_MIGRATIONS_SQL, SOULS_INDEXES_SQL } =
  await import('../src/db/schema/souls.js');

const { CHANNELS_TABLES_SQL, CHANNELS_MIGRATIONS_SQL, CHANNELS_INDEXES_SQL } =
  await import('../src/db/schema/channels.js');

const { CLAW_TABLES_SQL, CLAW_MIGRATIONS_SQL, CLAW_INDEXES_SQL } =
  await import('../src/db/schema/claw.js');

const { UI_SESSIONS_TABLES_SQL, UI_SESSIONS_MIGRATIONS_SQL, UI_SESSIONS_INDEXES_SQL } =
  await import('../src/db/schema/ui-sessions.js');

// Build the squashed SQL file
// Order: TABLES (CREATE TABLE IF NOT EXISTS) → MIGRATIONS (ALTER TABLE) → INDEXES (CREATE INDEX)
const header = `-- OwnPilot PostgreSQL Schema
-- Squashed migration: single file for Docker first-time init.
-- Generated from TypeScript schema modules (source of truth).
-- Generated: ${new Date().toISOString()}
-- Do not edit manually — regenerate via: tsx scripts/generate-squashed-migration.ts

`;

const body = [
  '-- =====================================================',
  '-- TABLES',
  '-- =====================================================',
  '',
  CORE_TABLES_SQL.trim(),
  '',
  PERSONAL_DATA_TABLES_SQL.trim(),
  '',
  PRODUCTIVITY_TABLES_SQL.trim(),
  '',
  AUTONOMOUS_TABLES_SQL.trim(),
  '',
  WORKSPACES_TABLES_SQL.trim(),
  '',
  MODELS_TABLES_SQL.trim(),
  '',
  WORKFLOWS_TABLES_SQL.trim(),
  '',
  CODING_AGENTS_TABLES_SQL.trim(),
  '',
  SOULS_TABLES_SQL.trim(),
  '',
  CHANNELS_TABLES_SQL.trim(),
  '',
  CLAW_TABLES_SQL.trim(),
  '',
  UI_SESSIONS_TABLES_SQL.trim(),
  '',
  '-- =====================================================',
  '-- MIGRATIONS (ALTER TABLE / idempotent schema changes)',
  '-- =====================================================',
  '',
  CORE_MIGRATIONS_SQL.trim(),
  '',
  PERSONAL_DATA_MIGRATIONS_SQL.trim(),
  '',
  PRODUCTIVITY_MIGRATIONS_SQL.trim(),
  '',
  AUTONOMOUS_MIGRATIONS_SQL.trim(),
  '',
  WORKSPACES_MIGRATIONS_SQL.trim(),
  '',
  MODELS_MIGRATIONS_SQL.trim(),
  '',
  WORKFLOWS_MIGRATIONS_SQL.trim(),
  '',
  CODING_AGENTS_MIGRATIONS_SQL.trim(),
  '',
  SOULS_MIGRATIONS_SQL.trim(),
  '',
  CHANNELS_MIGRATIONS_SQL.trim(),
  '',
  CLAW_MIGRATIONS_SQL.trim(),
  '',
  UI_SESSIONS_MIGRATIONS_SQL.trim(),
  '',
  '-- =====================================================',
  '-- INDEXES',
  '-- =====================================================',
  '',
  CORE_INDEXES_SQL.trim(),
  '',
  PERSONAL_DATA_INDEXES_SQL.trim(),
  '',
  PRODUCTIVITY_INDEXES_SQL.trim(),
  '',
  AUTONOMOUS_INDEXES_SQL.trim(),
  '',
  WORKSPACES_INDEXES_SQL.trim(),
  '',
  MODELS_INDEXES_SQL.trim(),
  '',
  WORKFLOWS_INDEXES_SQL.trim(),
  '',
  CODING_AGENTS_INDEXES_SQL.trim(),
  '',
  SOULS_INDEXES_SQL.trim(),
  '',
  CHANNELS_INDEXES_SQL.trim(),
  '',
  CLAW_INDEXES_SQL.trim(),
  '',
  UI_SESSIONS_INDEXES_SQL.trim(),
].join('\n');

const sql = header + body + '\n';

writeFileSync(outputPath, sql, 'utf-8');
console.log(`Wrote ${outputPath}`);
console.log(`Size: ${sql.length} bytes, ${sql.split('\\n').length} lines`);
