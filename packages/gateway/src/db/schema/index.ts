/**
 * PostgreSQL Schema Definition
 *
 * All table definitions for the OwnPilot database.
 * Split by domain — assembled here for execution order.
 */

import { getLog } from '../../services/log.js';

import { CORE_TABLES_SQL, CORE_MIGRATIONS_SQL, CORE_INDEXES_SQL } from './core.js';
import {
  PERSONAL_DATA_TABLES_SQL,
  PERSONAL_DATA_MIGRATIONS_SQL,
  PERSONAL_DATA_INDEXES_SQL,
} from './personal-data.js';
import {
  PRODUCTIVITY_TABLES_SQL,
  PRODUCTIVITY_MIGRATIONS_SQL,
  PRODUCTIVITY_INDEXES_SQL,
} from './productivity.js';
import {
  AUTONOMOUS_TABLES_SQL,
  AUTONOMOUS_MIGRATIONS_SQL,
  AUTONOMOUS_INDEXES_SQL,
} from './autonomous.js';
import {
  WORKSPACES_TABLES_SQL,
  WORKSPACES_MIGRATIONS_SQL,
  WORKSPACES_INDEXES_SQL,
} from './workspaces.js';
import { MODELS_TABLES_SQL, MODELS_MIGRATIONS_SQL, MODELS_INDEXES_SQL } from './models.js';
import {
  WORKFLOWS_TABLES_SQL,
  WORKFLOWS_MIGRATIONS_SQL,
  WORKFLOWS_INDEXES_SQL,
} from './workflows.js';
import {
  CODING_AGENTS_TABLES_SQL,
  CODING_AGENTS_MIGRATIONS_SQL,
  CODING_AGENTS_INDEXES_SQL,
} from './coding-agents.js';
import { SOULS_TABLES_SQL, SOULS_MIGRATIONS_SQL, SOULS_INDEXES_SQL } from './souls.js';
import {
  CHANNELS_TABLES_SQL,
  CHANNELS_MIGRATIONS_SQL,
  CHANNELS_INDEXES_SQL,
} from './channels.js';

const log = getLog('Schema');

/**
 * Full schema SQL — all CREATE TABLE statements.
 * Order matters: tables with FK references must come after their targets.
 */
export const SCHEMA_SQL = [
  CORE_TABLES_SQL,
  PERSONAL_DATA_TABLES_SQL,
  PRODUCTIVITY_TABLES_SQL,
  AUTONOMOUS_TABLES_SQL,
  WORKSPACES_TABLES_SQL,
  MODELS_TABLES_SQL,
  WORKFLOWS_TABLES_SQL,
  CODING_AGENTS_TABLES_SQL,
  SOULS_TABLES_SQL,
  CHANNELS_TABLES_SQL,
].join('\n');

/**
 * Full migration SQL — all ALTER TABLE / DO $$ blocks.
 * Safe to run multiple times (idempotent).
 */
export const MIGRATIONS_SQL = [
  CORE_MIGRATIONS_SQL,
  PERSONAL_DATA_MIGRATIONS_SQL,
  PRODUCTIVITY_MIGRATIONS_SQL,
  AUTONOMOUS_MIGRATIONS_SQL,
  WORKSPACES_MIGRATIONS_SQL,
  MODELS_MIGRATIONS_SQL,
  WORKFLOWS_MIGRATIONS_SQL,
  CODING_AGENTS_MIGRATIONS_SQL,
  SOULS_MIGRATIONS_SQL,
  CHANNELS_MIGRATIONS_SQL,
].join('\n');

/**
 * Full index SQL — all CREATE INDEX statements.
 */
export const INDEXES_SQL = [
  CORE_INDEXES_SQL,
  PERSONAL_DATA_INDEXES_SQL,
  PRODUCTIVITY_INDEXES_SQL,
  AUTONOMOUS_INDEXES_SQL,
  WORKSPACES_INDEXES_SQL,
  MODELS_INDEXES_SQL,
  WORKFLOWS_INDEXES_SQL,
  CODING_AGENTS_INDEXES_SQL,
  SOULS_INDEXES_SQL,
  CHANNELS_INDEXES_SQL,
].join('\n');

/**
 * Initialize PostgreSQL schema
 */
export async function initializeSchema(
  runSql: (sql: string) => Promise<void>,
): Promise<void> {
  log.info('[Schema] Initializing PostgreSQL schema...');

  // Create tables
  await runSql(SCHEMA_SQL);
  log.info('[Schema] Tables created');

  // Run migrations (add missing columns to existing tables)
  await runSql(MIGRATIONS_SQL);
  log.info('[Schema] Migrations applied');

  // Create indexes
  await runSql(INDEXES_SQL);
  log.info('[Schema] Indexes created');

  log.info('[Schema] PostgreSQL schema initialized successfully');
}
