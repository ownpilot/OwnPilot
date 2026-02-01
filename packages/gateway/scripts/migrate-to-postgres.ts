#!/usr/bin/env tsx
/**
 * SQLite to PostgreSQL Migration Tool
 *
 * Migrates all data from SQLite database to PostgreSQL
 *
 * Usage:
 *   # Set PostgreSQL connection info
 *   export DATABASE_URL=postgresql://ownpilot:ownpilot_secret@localhost:25432/ownpilot
 *
 *   # Run migration
 *   pnpm tsx scripts/migrate-to-postgres.ts
 *
 *   # Or with options
 *   pnpm tsx scripts/migrate-to-postgres.ts --dry-run       # Preview only
 *   pnpm tsx scripts/migrate-to-postgres.ts --truncate      # Clear PG tables first
 *   pnpm tsx scripts/migrate-to-postgres.ts --skip-schema   # Skip schema creation
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TRUNCATE = args.includes('--truncate');
const SKIP_SCHEMA = args.includes('--skip-schema');

// Configuration
const SQLITE_PATH = process.env.SQLITE_PATH || join(process.cwd(), 'data', 'ownpilot.db');
const PG_URL = process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'ownpilot'}:${process.env.POSTGRES_PASSWORD || 'ownpilot_secret'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '25432'}/${process.env.POSTGRES_DB || 'ownpilot'}`;

// Tables to migrate in order (respecting foreign key dependencies)
const TABLES_ORDER = [
  // Core tables (no dependencies)
  'settings',
  'agents',
  'channels',
  'projects',

  // Tables with simple dependencies
  'conversations',
  'bookmarks',
  'notes',
  'contacts',
  'reminders',
  'captures',
  'memories',
  'triggers',
  'custom_tools',

  // Tables with foreign keys to above
  'messages',
  'channel_messages',
  'costs',
  'request_logs',
  'tasks',
  'calendar_events',
  'goals',
  'trigger_history',
  'plans',

  // Tables with deeper dependencies
  'goal_steps',
  'plan_steps',
  'plan_history',

  // Productivity tables
  'pomodoro_settings',
  'pomodoro_sessions',
  'pomodoro_daily_stats',
  'habits',
  'habit_logs',

  // Workspace tables
  'user_workspaces',
  'user_containers',
  'code_executions',
  'workspace_audit',

  // OAuth & Settings
  'oauth_integrations',
  'media_provider_settings',
  'user_model_configs',
  'custom_providers',
  'user_provider_configs',
];

// Columns that need type conversion
const BOOLEAN_COLUMNS = [
  'is_archived',
  'is_error',
  'is_favorite',
  'is_pinned',
  'all_day',
  'processed',
  'enabled',
  'is_completed',
  'is_custom',
  'is_enabled',
  'requires_approval',
  'auto_start_breaks',
  'auto_start_work',
  'success',
];

const TIMESTAMP_COLUMNS = [
  'created_at',
  'updated_at',
  'accessed_at',
  'completed_at',
  'started_at',
  'connected_at',
  'last_activity_at',
  'last_visited_at',
  'last_contacted_at',
  'last_fired',
  'next_fire',
  'fired_at',
  'remind_at',
  'reminder_at',
  'processed_at',
  'logged_at',
  'interrupted_at',
  'stopped_at',
  'last_executed_at',
  'expires_at',
  'last_sync_at',
];

const JSON_COLUMNS = [
  'metadata',
  'tool_calls',
  'trace',
  'config',
  'attachments',
  'tags',
  'action',
  'dependencies',
  'result',
  'checkpoint',
  'on_success',
  'on_failure',
  'details',
  'social_links',
  'custom_fields',
  'attendees',
  'target_days',
  'parameters',
  'permissions',
  'scopes',
  'capabilities',
  'request_body',
  'response_body',
];

interface MigrationStats {
  table: string;
  rows: number;
  success: number;
  failed: number;
  errors: string[];
}

class Migrator {
  private sqlite: Database.Database;
  private pg: Pool;
  private stats: MigrationStats[] = [];

  constructor() {
    // Check SQLite file exists
    if (!existsSync(SQLITE_PATH)) {
      throw new Error(`SQLite database not found at: ${SQLITE_PATH}`);
    }

    console.log('🔌 Connecting to databases...');
    console.log(`   SQLite: ${SQLITE_PATH}`);
    console.log(`   PostgreSQL: ${PG_URL.replace(/:[^:@]+@/, ':***@')}`);

    this.sqlite = new Database(SQLITE_PATH, { readonly: true });
    this.pg = new Pool({ connectionString: PG_URL });
  }

  async run(): Promise<void> {
    console.log('\n📊 Migration Configuration:');
    console.log(`   Dry Run: ${DRY_RUN}`);
    console.log(`   Truncate: ${TRUNCATE}`);
    console.log(`   Skip Schema: ${SKIP_SCHEMA}`);

    try {
      // Test PostgreSQL connection
      await this.pg.query('SELECT 1');
      console.log('\n✅ PostgreSQL connection successful');

      // Create schema if needed
      if (!SKIP_SCHEMA) {
        await this.createSchema();
      }

      // Truncate tables if requested
      if (TRUNCATE && !DRY_RUN) {
        await this.truncateTables();
      }

      // Migrate each table
      console.log('\n📦 Starting data migration...\n');

      for (const table of TABLES_ORDER) {
        await this.migrateTable(table);
      }

      // Print summary
      this.printSummary();
    } finally {
      this.sqlite.close();
      await this.pg.end();
    }
  }

  private async createSchema(): Promise<void> {
    console.log('\n📝 Creating PostgreSQL schema...');

    const schemaPath = join(__dirname, '..', 'src', 'db', 'migrations', 'postgres', '001_initial_schema.sql');

    if (!existsSync(schemaPath)) {
      console.log('   ⚠️ Schema file not found, skipping schema creation');
      return;
    }

    const schema = readFileSync(schemaPath, 'utf-8');

    if (DRY_RUN) {
      console.log('   [DRY RUN] Would execute schema creation');
      return;
    }

    await this.pg.query(schema);
    console.log('   ✅ Schema created successfully');
  }

  private async truncateTables(): Promise<void> {
    console.log('\n🗑️ Truncating PostgreSQL tables...');

    // Reverse order to respect foreign keys
    const reversedTables = [...TABLES_ORDER].reverse();

    for (const table of reversedTables) {
      try {
        await this.pg.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(`   ✅ Truncated: ${table}`);
      } catch (error) {
        // Table might not exist
        console.log(`   ⚠️ Skipped: ${table} (might not exist)`);
      }
    }
  }

  private async migrateTable(table: string): Promise<void> {
    const stat: MigrationStats = {
      table,
      rows: 0,
      success: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Check if table exists in SQLite
      const tableExists = this.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);

      if (!tableExists) {
        console.log(`⏭️ Skipping ${table} (not in SQLite)`);
        return;
      }

      // Get all rows from SQLite
      const rows = this.sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      stat.rows = rows.length;

      if (rows.length === 0) {
        console.log(`⏭️ Skipping ${table} (empty)`);
        this.stats.push(stat);
        return;
      }

      console.log(`📤 Migrating ${table}: ${rows.length} rows...`);

      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would migrate ${rows.length} rows`);
        stat.success = rows.length;
        this.stats.push(stat);
        return;
      }

      // Get column names from first row
      const columns = Object.keys(rows[0]);

      // Process in batches
      const BATCH_SIZE = 100;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        for (const row of batch) {
          try {
            const convertedRow = this.convertRow(row, columns);
            await this.insertRow(table, columns, convertedRow);
            stat.success++;
          } catch (error) {
            stat.failed++;
            const errMsg = error instanceof Error ? error.message : String(error);
            if (stat.errors.length < 5) {
              stat.errors.push(errMsg);
            }
          }
        }

        // Progress indicator
        const progress = Math.min(i + BATCH_SIZE, rows.length);
        process.stdout.write(`\r   Progress: ${progress}/${rows.length}`);
      }

      console.log(`\n   ✅ Completed: ${stat.success}/${stat.rows} rows`);

      if (stat.failed > 0) {
        console.log(`   ⚠️ Failed: ${stat.failed} rows`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Error: ${errMsg}`);
      stat.errors.push(errMsg);
    }

    this.stats.push(stat);
  }

  private convertRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
    const converted: Record<string, unknown> = {};

    for (const col of columns) {
      let value = row[col];

      // Skip null values
      if (value === null || value === undefined) {
        converted[col] = null;
        continue;
      }

      // Convert INTEGER booleans to actual booleans
      if (BOOLEAN_COLUMNS.includes(col)) {
        converted[col] = value === 1 || value === true || value === '1';
        continue;
      }

      // Convert TEXT timestamps (keep as-is, PostgreSQL handles ISO 8601)
      if (TIMESTAMP_COLUMNS.includes(col)) {
        // Handle SQLite's datetime format
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
          converted[col] = value;
        } else {
          converted[col] = null;
        }
        continue;
      }

      // Parse JSON columns from TEXT
      if (JSON_COLUMNS.includes(col)) {
        if (typeof value === 'string') {
          try {
            converted[col] = JSON.parse(value);
          } catch {
            converted[col] = value; // Keep as string if not valid JSON
          }
        } else {
          converted[col] = value;
        }
        continue;
      }

      // Handle embedding: old BYTEA/BLOB data is not compatible with vector type
      // Set to null during migration; embeddings will be regenerated
      if (col === 'embedding') {
        converted[col] = null;
        continue;
      }

      // Default: keep as-is
      converted[col] = value;
    }

    return converted;
  }

  private async insertRow(
    table: string,
    columns: string[],
    row: Record<string, unknown>
  ): Promise<void> {
    const values = columns.map((col) => row[col]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    const sql = `
      INSERT INTO ${table} (${columnList})
      VALUES (${placeholders})
      ON CONFLICT DO NOTHING
    `;

    await this.pg.query(sql, values);
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));

    let totalRows = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    console.log('\n Table                          | Rows    | Success | Failed');
    console.log('-'.repeat(60));

    for (const stat of this.stats) {
      if (stat.rows > 0) {
        const tableName = stat.table.padEnd(30);
        const rows = stat.rows.toString().padStart(7);
        const success = stat.success.toString().padStart(7);
        const failed = stat.failed.toString().padStart(6);
        console.log(` ${tableName} | ${rows} | ${success} | ${failed}`);

        totalRows += stat.rows;
        totalSuccess += stat.success;
        totalFailed += stat.failed;
      }
    }

    console.log('-'.repeat(60));
    console.log(` ${'TOTAL'.padEnd(30)} | ${totalRows.toString().padStart(7)} | ${totalSuccess.toString().padStart(7)} | ${totalFailed.toString().padStart(6)}`);

    // Print errors
    const tablesWithErrors = this.stats.filter((s) => s.errors.length > 0);
    if (tablesWithErrors.length > 0) {
      console.log('\n⚠️ ERRORS:');
      for (const stat of tablesWithErrors) {
        console.log(`\n  ${stat.table}:`);
        for (const err of stat.errors) {
          console.log(`    - ${err.substring(0, 100)}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));

    if (DRY_RUN) {
      console.log('🔍 This was a DRY RUN - no data was actually migrated');
      console.log('   Run without --dry-run to perform actual migration');
    } else if (totalFailed === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log(`⚠️ Migration completed with ${totalFailed} errors`);
    }

    console.log('='.repeat(60) + '\n');
  }
}

// Main entry point
async function main(): Promise<void> {
  console.log('\n🚀 SQLite to PostgreSQL Migration Tool');
  console.log('='.repeat(60) + '\n');

  try {
    const migrator = new Migrator();
    await migrator.run();
  } catch (error) {
    console.error('\n❌ Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
