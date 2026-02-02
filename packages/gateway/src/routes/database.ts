/**
 * Database Admin Routes
 *
 * API endpoints for PostgreSQL database management, backup, restore, and maintenance
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { apiResponse, apiError } from './helpers.js'
import { ERROR_CODES } from './helpers.js';
import { getDatabaseConfig } from '../db/adapters/types.js';
import { getAdapterSync } from '../db/adapters/index.js';
import { getDatabasePath, getDataPaths } from '../paths/index.js';
import { getLog } from '../services/log.js';

const log = getLog('Database');


// Tables to export (in dependency order) — also serves as whitelist for SQL operations
const EXPORT_TABLES = [
  'settings',
  'agents',
  'conversations',
  'messages',
  'request_logs',
  'channels',
  'channel_messages',
  'costs',
  'bookmarks',
  'notes',
  'projects',
  'tasks',
  'calendar_events',
  'contacts',
  'reminders',
  'captures',
  'pomodoro_settings',
  'pomodoro_sessions',
  'pomodoro_daily_stats',
  'habits',
  'habit_logs',
  'memories',
  'goals',
  'goal_steps',
  'triggers',
  'trigger_history',
  'plans',
  'plan_steps',
  'plan_history',
  'oauth_integrations',
  'media_provider_settings',
  'user_workspaces',
  'user_containers',
  'code_executions',
  'workspace_audit',
  'user_model_configs',
  'custom_providers',
  'user_provider_configs',
  'custom_data',
  'custom_tools',
  'custom_table_schemas',
  'custom_data_records',
];

// --- SQL Injection Protection ---
const SAFE_IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;

function validateTableName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!SAFE_IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(`Invalid table name: ${trimmed}`);
  }
  if (!EXPORT_TABLES.includes(trimmed)) {
    throw new Error(`Table not in whitelist: ${trimmed}`);
  }
  return trimmed;
}

function validateColumnName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!SAFE_IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(`Invalid column name: ${trimmed}`);
  }
  return trimmed;
}

function quoteIdentifier(name: string): string {
  // Double-quote PostgreSQL identifier (escape any embedded quotes)
  return `"${name.replace(/"/g, '""')}"`;
}

export const databaseRoutes = new Hono();

// --- Database Admin Guard ---
// Requires ADMIN_API_KEY env var to be set. All database admin operations
// require this key via X-Admin-Key header, regardless of global auth config.
// GET /status and /stats are exempt (read-only info).
const ADMIN_EXEMPT_PATHS = ['/status', '/stats', '/operation/status'];

const requireDatabaseAdmin = createMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/.*\/database/, '');
  if (ADMIN_EXEMPT_PATHS.some(p => path === p || path.startsWith(p))) {
    await next();
    return;
  }

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    // If ADMIN_API_KEY is not configured, block all admin operations
    throw new HTTPException(503, {
      message: 'Database admin operations require ADMIN_API_KEY to be configured',
    });
  }

  const providedKey = c.req.header('X-Admin-Key');
  if (!providedKey || providedKey !== adminKey) {
    throw new HTTPException(403, {
      message: 'Valid X-Admin-Key header required for database admin operations',
    });
  }

  await next();
});

databaseRoutes.use('*', requireDatabaseAdmin);

// Backup directory
const getBackupDir = () => {
  const dataPaths = getDataPaths();
  const dir = join(dataPaths.root, 'backups');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

interface OperationStatus {
  isRunning: boolean;
  operation?: 'backup' | 'restore' | 'migrate' | 'maintenance';
  lastRun?: string;
  lastResult?: 'success' | 'failure';
  lastError?: string;
  output?: string[];
}

// In-memory operation status
let operationStatus: OperationStatus = {
  isRunning: false,
};

/**
 * Get database status and configuration
 */
databaseRoutes.get('/status', async (c) => {
  const config = getDatabaseConfig();

  let connected = false;
  let stats: Record<string, unknown> | null = null;

  try {
    const adapter = getAdapterSync();
    connected = adapter.isConnected();

    // Get basic database stats
    if (connected) {
      const sizeResult = await adapter.queryOne<{ size: string }>(
        `SELECT pg_size_pretty(pg_database_size(current_database())) as size`
      );
      const tableCountResult = await adapter.queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`
      );
      stats = {
        databaseSize: sizeResult?.size || 'unknown',
        tableCount: parseInt(tableCountResult?.count || '0', 10),
      };
    }
  } catch {
    // Adapter not initialized
  }

  // Check if legacy SQLite data exists (for migration)
  const sqlitePath = getDatabasePath();
  const hasLegacyData = existsSync(sqlitePath);

  // List available backups
  const backupDir = getBackupDir();
  let backups: { name: string; size: number; created: string }[] = [];
  try {
    const files = readdirSync(backupDir).filter(f => f.endsWith('.sql') || f.endsWith('.dump'));
    backups = files.map(f => {
      const filePath = join(backupDir, f);
      const stat = statSync(filePath);
      return {
        name: f,
        size: stat.size,
        created: stat.mtime.toISOString(),
      };
    }).sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
  } catch {
    // Backup directory doesn't exist or can't be read
  }

  return apiResponse(c, {
    type: 'postgres',
    connected,
    host: config.postgresHost,
    port: config.postgresPort,
    database: config.postgresDatabase,
    stats,
    backups,
    legacyData: hasLegacyData ? {
      path: sqlitePath,
      migratable: true,
    } : null,
    operation: operationStatus,
  });
});

/**
 * Create a database backup using pg_dump
 */
databaseRoutes.post('/backup', async (c) => {
  if (operationStatus.isRunning) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.OPERATION_IN_PROGRESS,
        message: `A ${operationStatus.operation} operation is already in progress`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 409);
  }

  const config = getDatabaseConfig();

  // Check PostgreSQL is connected
  let connected = false;
  try {
    const adapter = getAdapterSync();
    connected = adapter.isConnected();
  } catch {
    // Adapter not initialized
  }

  if (!connected) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.POSTGRES_NOT_CONNECTED,
        message: 'PostgreSQL is not connected.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 400);
  }

  const body: { format?: 'sql' | 'custom' } = await c.req.json().catch(() => ({}));
  const format = body.format || 'sql';
  const ext = format === 'custom' ? 'dump' : 'sql';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.${ext}`;
  const backupPath = join(getBackupDir(), filename);

  operationStatus = {
    isRunning: true,
    operation: 'backup',
    lastRun: new Date().toISOString(),
    output: [],
  };

  // Build pg_dump command
  const args = [
    '-h', config.postgresHost || 'localhost',
    '-p', String(config.postgresPort || 5432),
    '-U', config.postgresUser || 'ownpilot',
    '-d', config.postgresDatabase || 'ownpilot',
    '-f', backupPath,
  ];

  if (format === 'custom') {
    args.push('-Fc'); // Custom format (compressed, can use pg_restore)
  } else {
    args.push('-Fp'); // Plain SQL format
  }

  const env = {
    ...process.env,
    PGPASSWORD: config.postgresPassword || '',
  };

  const backup = spawn('pg_dump', args, { env });

  backup.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      operationStatus.output?.push(line);
      log.info(`${line}`);
    }
  });

  backup.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      operationStatus.output?.push(line);
      log.info(`${line}`);
    }
  });

  backup.on('close', (code) => {
    operationStatus.isRunning = false;
    operationStatus.lastResult = code === 0 ? 'success' : 'failure';
    if (code !== 0) {
      operationStatus.lastError = `Backup exited with code ${code}`;
    } else {
      operationStatus.output?.push(`Backup saved to: ${filename}`);
    }
    log.info(`Completed with code ${code}`);
  });

  backup.on('error', (err) => {
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'failure';
    operationStatus.lastError = err.message;
    log.error(`Error: ${err.message}`);
  });

  return c.json({
    success: true,
    data: {
      message: 'Backup started',
      filename,
      format,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  }, 202);
});

/**
 * Restore database from a backup
 */
databaseRoutes.post('/restore', async (c) => {
  if (operationStatus.isRunning) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.OPERATION_IN_PROGRESS,
        message: `A ${operationStatus.operation} operation is already in progress`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 409);
  }

  const body: { filename: string } = await c.req.json().catch(() => ({ filename: '' }));

  if (!body.filename) {
    return c.json({
      success: false,
      error: {
        code: 'MISSING_FILENAME',
        message: 'Backup filename is required',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 400);
  }

  const config = getDatabaseConfig();
  const backupPath = join(getBackupDir(), basename(body.filename)); // Sanitize path

  if (!existsSync(backupPath)) {
    return c.json({
      success: false,
      error: {
        code: 'BACKUP_NOT_FOUND',
        message: `Backup file not found: ${body.filename}`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 404);
  }

  operationStatus = {
    isRunning: true,
    operation: 'restore',
    lastRun: new Date().toISOString(),
    output: [],
  };

  const isCustomFormat = body.filename.endsWith('.dump');
  const command = isCustomFormat ? 'pg_restore' : 'psql';

  const args = isCustomFormat
    ? [
        '-h', config.postgresHost || 'localhost',
        '-p', String(config.postgresPort || 5432),
        '-U', config.postgresUser || 'ownpilot',
        '-d', config.postgresDatabase || 'ownpilot',
        '--clean', // Drop objects before recreating
        '--if-exists',
        backupPath,
      ]
    : [
        '-h', config.postgresHost || 'localhost',
        '-p', String(config.postgresPort || 5432),
        '-U', config.postgresUser || 'ownpilot',
        '-d', config.postgresDatabase || 'ownpilot',
        '-f', backupPath,
      ];

  const env = {
    ...process.env,
    PGPASSWORD: config.postgresPassword || '',
  };

  const restore = spawn(command, args, { env });

  restore.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      operationStatus.output?.push(line);
      log.info(`${line}`);
    }
  });

  restore.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      operationStatus.output?.push(line);
      log.info(`${line}`);
    }
  });

  restore.on('close', (code) => {
    operationStatus.isRunning = false;
    operationStatus.lastResult = code === 0 ? 'success' : 'failure';
    if (code !== 0) {
      operationStatus.lastError = `Restore exited with code ${code}`;
    }
    log.info(`Completed with code ${code}`);
  });

  restore.on('error', (err) => {
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'failure';
    operationStatus.lastError = err.message;
    log.error(`Error: ${err.message}`);
  });

  return c.json({
    success: true,
    data: {
      message: 'Restore started',
      filename: body.filename,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  }, 202);
});

/**
 * Delete a backup file
 */
databaseRoutes.delete('/backup/:filename', (c) => {
  const filename = c.req.param('filename');
  const backupPath = join(getBackupDir(), basename(filename)); // Sanitize path

  if (!existsSync(backupPath)) {
    return c.json({
      success: false,
      error: {
        code: 'BACKUP_NOT_FOUND',
        message: `Backup file not found: ${filename}`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 404);
  }

  try {
    unlinkSync(backupPath);
    return c.json({
      success: true,
      data: { message: `Deleted backup: ${filename}` },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return c.json({
      success: false,
      error: {
        code: 'DELETE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to delete backup',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Run database maintenance (VACUUM, ANALYZE)
 */
databaseRoutes.post('/maintenance', async (c) => {
  if (operationStatus.isRunning) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.OPERATION_IN_PROGRESS,
        message: `A ${operationStatus.operation} operation is already in progress`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 409);
  }

  const body: { type?: 'vacuum' | 'analyze' | 'full' } = await c.req.json().catch(() => ({}));
  const maintenanceType = body.type || 'vacuum';

  let connected = false;
  try {
    const adapter = getAdapterSync();
    connected = adapter.isConnected();

    if (!connected) {
      throw new Error('Not connected');
    }

    operationStatus = {
      isRunning: true,
      operation: 'maintenance',
      lastRun: new Date().toISOString(),
      output: [],
    };

    // Run maintenance asynchronously
    (async () => {
      try {
        const adapter = getAdapterSync();

        switch (maintenanceType) {
          case 'vacuum':
            operationStatus.output?.push('Running VACUUM...');
            await adapter.exec('VACUUM');
            operationStatus.output?.push('VACUUM completed');
            break;

          case 'analyze':
            operationStatus.output?.push('Running ANALYZE...');
            await adapter.exec('ANALYZE');
            operationStatus.output?.push('ANALYZE completed');
            break;

          case 'full':
            operationStatus.output?.push('Running VACUUM FULL (this may take a while)...');
            await adapter.exec('VACUUM FULL');
            operationStatus.output?.push('VACUUM FULL completed');
            operationStatus.output?.push('Running ANALYZE...');
            await adapter.exec('ANALYZE');
            operationStatus.output?.push('ANALYZE completed');
            break;
        }

        operationStatus.isRunning = false;
        operationStatus.lastResult = 'success';
      } catch (err) {
        operationStatus.isRunning = false;
        operationStatus.lastResult = 'failure';
        operationStatus.lastError = err instanceof Error ? err.message : 'Maintenance failed';
        operationStatus.output?.push(`Error: ${operationStatus.lastError}`);
      }
    })();

    return c.json({
      success: true,
      data: {
        message: `Maintenance started: ${maintenanceType}`,
        type: maintenanceType,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 202);

  } catch {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.POSTGRES_NOT_CONNECTED,
        message: 'PostgreSQL is not connected.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 400);
  }
});

/**
 * Get detailed database statistics
 */
databaseRoutes.get('/stats', async (c) => {
  try {
    const adapter = getAdapterSync();

    if (!adapter.isConnected()) {
      throw new Error('Not connected');
    }

    // Get database size
    const sizeResult = await adapter.queryOne<{ size: string; raw_size: string }>(
      `SELECT
        pg_size_pretty(pg_database_size(current_database())) as size,
        pg_database_size(current_database())::text as raw_size`
    );

    // Get table statistics
    const tableStats = await adapter.query<{
      table_name: string;
      row_count: string;
      size: string;
    }>(`
      SELECT
        relname as table_name,
        n_live_tup::text as row_count,
        pg_size_pretty(pg_total_relation_size(relid)) as size
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 20
    `);

    // Get connection info
    const connInfo = await adapter.queryOne<{
      active_connections: string;
      max_connections: string;
    }>(`
      SELECT
        (SELECT count(*) FROM pg_stat_activity)::text as active_connections,
        current_setting('max_connections') as max_connections
    `);

    // Get PostgreSQL version
    const versionResult = await adapter.queryOne<{ version: string }>(
      'SELECT version()'
    );

    return c.json({
      success: true,
      data: {
        database: {
          size: sizeResult?.size || 'unknown',
          sizeBytes: parseInt(sizeResult?.raw_size || '0', 10),
        },
        tables: tableStats.map(t => ({
          name: t.table_name,
          rowCount: parseInt(t.row_count, 10),
          size: t.size,
        })),
        connections: {
          active: parseInt(connInfo?.active_connections || '0', 10),
          max: parseInt(connInfo?.max_connections || '100', 10),
        },
        version: versionResult?.version || 'unknown',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    });

  } catch {
    return c.json({
      success: false,
      error: {
        code: 'STATS_FAILED',
        message: 'Failed to get database statistics. Is PostgreSQL connected?',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Get operation status
 */
databaseRoutes.get('/operation/status', (c) => {
  return c.json({
    success: true,
    data: operationStatus,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  });
});

// ============================================================================
// JSON Export/Import (No pg_dump required)
// ============================================================================

// EXPORT_TABLES moved above databaseRoutes for use in validation functions

/**
 * Export all data as JSON (no pg_dump required)
 */
databaseRoutes.get('/export', async (c) => {
  try {
    const adapter = getAdapterSync();

    if (!adapter.isConnected()) {
      throw new Error('Not connected');
    }

    const requestedTables = c.req.query('tables')?.split(',') || EXPORT_TABLES;
    // Validate all table names against whitelist
    const tables: string[] = [];
    const skippedTables: string[] = [];
    for (const t of requestedTables) {
      try {
        tables.push(validateTableName(t));
      } catch {
        skippedTables.push(t.trim());
      }
    }
    if (tables.length === 0) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_TABLES',
          message: `No valid tables specified. Skipped: ${skippedTables.join(', ')}`,
        },
        meta: {
          requestId: c.get('requestId') ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      }, 400);
    }

    const exportData: Record<string, unknown[]> = {};
    const errors: string[] = [];
    if (skippedTables.length > 0) {
      errors.push(`Skipped invalid tables: ${skippedTables.join(', ')}`);
    }

    for (const table of tables) {
      try {
        // Check if table exists (table already validated above)
        const exists = await adapter.queryOne<{ exists: boolean }>(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          ) as exists`,
          [table]
        );

        if (exists?.exists) {
          const rows = await adapter.query(`SELECT * FROM ${quoteIdentifier(table)}`);
          exportData[table] = rows;
        }
      } catch (err) {
        errors.push(`${table}: ${err instanceof Error ? err.message : 'Failed'}`);
      }
    }

    // Get database version info
    const versionResult = await adapter.queryOne<{ version: string }>('SELECT version()');

    const exportPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      database: {
        type: 'postgres',
        version: versionResult?.version || 'unknown',
      },
      tables: exportData,
      tableCount: Object.keys(exportData).length,
      totalRows: Object.values(exportData).reduce((sum, rows) => sum + rows.length, 0),
      errors: errors.length > 0 ? errors : undefined,
    };

    // Return as downloadable JSON
    const filename = `ownpilot-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);

    return c.body(JSON.stringify(exportPayload, null, 2));

  } catch (err) {
    return c.json({
      success: false,
      error: {
        code: 'EXPORT_FAILED',
        message: err instanceof Error ? err.message : 'Export failed',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Import data from JSON export
 */
databaseRoutes.post('/import', async (c) => {
  if (operationStatus.isRunning) {
    return apiError(c, { code: ERROR_CODES.OPERATION_IN_PROGRESS, message: `A ${operationStatus.operation} operation is already in progress` }, 409);
  }

  try {
    const adapter = getAdapterSync();

    if (!adapter.isConnected()) {
      throw new Error('Not connected');
    }

    const body = await c.req.json<{
      data: {
        version: string;
        tables: Record<string, Record<string, unknown>[]>;
      };
      options?: {
        truncate?: boolean;
        skipExisting?: boolean;
        tables?: string[];
      };
    }>();

    if (!body.data?.tables) {
      return apiError(c, { code: 'INVALID_IMPORT_DATA', message: 'Import data must contain a "tables" object' }, 400);
    }

    const options = body.options || {};
    const requestedTables = options.tables || Object.keys(body.data.tables);

    // Validate all table names against whitelist
    const tablesToImport: string[] = [];
    const skippedImportTables: string[] = [];
    for (const t of requestedTables) {
      try {
        tablesToImport.push(validateTableName(t));
      } catch {
        skippedImportTables.push(typeof t === 'string' ? t.trim() : String(t));
      }
    }

    if (tablesToImport.length === 0) {
      return apiError(c, { code: 'INVALID_TABLES', message: `No valid tables to import. Skipped: ${skippedImportTables.join(', ')}` }, 400);
    }

    operationStatus = {
      isRunning: true,
      operation: 'restore',
      lastRun: new Date().toISOString(),
      output: [],
    };

    if (skippedImportTables.length > 0) {
      operationStatus.output?.push(`Skipped invalid tables: ${skippedImportTables.join(', ')}`);
    }

    // Run import in background
    (async () => {
      const results: Record<string, { imported: number; errors: number }> = {};
      let totalImported = 0;
      let totalErrors = 0;

      try {
        for (const table of tablesToImport) {
          const rows = body.data.tables[table];
          if (!rows || !Array.isArray(rows) || rows.length === 0) {
            continue;
          }

          operationStatus.output?.push(`Importing ${table}...`);
          results[table] = { imported: 0, errors: 0 };

          // Check if table exists (table already validated against whitelist)
          const exists = await adapter.queryOne<{ exists: boolean }>(
            `SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = $1
            ) as exists`,
            [table]
          );

          if (!exists?.exists) {
            operationStatus.output?.push(`  Skipping ${table} (table does not exist)`);
            continue;
          }

          // Truncate if requested
          if (options.truncate) {
            await adapter.exec(`TRUNCATE TABLE ${quoteIdentifier(table)} CASCADE`);
            operationStatus.output?.push(`  Truncated ${table}`);
          }

          // Import rows
          for (const row of rows) {
            try {
              // Validate and quote all column names
              const rawColumns = Object.keys(row);
              const validColumns: string[] = [];
              const validValues: unknown[] = [];
              const rawValues = Object.values(row);
              for (let i = 0; i < rawColumns.length; i++) {
                const col = rawColumns[i];
                if (!col) continue;
                try {
                  validColumns.push(validateColumnName(col));
                  validValues.push(rawValues[i]);
                } catch {
                  // Skip invalid column names silently
                }
              }
              if (validColumns.length === 0) continue;

              const quotedColumns = validColumns.map(quoteIdentifier);
              const placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ');
              const quotedTable = quoteIdentifier(table);

              let sql: string;
              if (options.skipExisting) {
                sql = `INSERT INTO ${quotedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
              } else {
                // Use EXCLUDED to reference the proposed row values
                const updateSet = validColumns
                  .filter(col => col !== 'id')
                  .map(col => `${quoteIdentifier(col)} = EXCLUDED.${quoteIdentifier(col)}`)
                  .join(', ');
                // If all columns are 'id', just do nothing
                sql = updateSet
                  ? `INSERT INTO ${quotedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT ("id") DO UPDATE SET ${updateSet}`
                  : `INSERT INTO ${quotedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
              }

              await adapter.execute(sql, validValues);
              results[table].imported++;
              totalImported++;
            } catch (err) {
              results[table].errors++;
              totalErrors++;
              // Log but continue
              if (results[table].errors <= 3) {
                operationStatus.output?.push(`  Error in ${table}: ${err instanceof Error ? err.message : 'Unknown'}`);
              }
            }
          }

          operationStatus.output?.push(`  ${table}: ${results[table].imported} imported, ${results[table].errors} errors`);
        }

        operationStatus.output?.push(`Import completed: ${totalImported} rows imported, ${totalErrors} errors`);
        operationStatus.isRunning = false;
        operationStatus.lastResult = totalErrors === 0 ? 'success' : 'failure';

      } catch (err) {
        operationStatus.isRunning = false;
        operationStatus.lastResult = 'failure';
        operationStatus.lastError = err instanceof Error ? err.message : 'Import failed';
        operationStatus.output?.push(`Import failed: ${operationStatus.lastError}`);
      }
    })();

    return c.json({
      success: true,
      data: {
        message: 'Import started',
        tables: tablesToImport,
        options,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 202);

  } catch (err) {
    return c.json({
      success: false,
      error: {
        code: 'IMPORT_FAILED',
        message: err instanceof Error ? err.message : 'Import failed',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Download export as file (saves to backup directory)
 */
databaseRoutes.post('/export/save', async (c) => {
  try {
    const adapter = getAdapterSync();

    if (!adapter.isConnected()) {
      throw new Error('Not connected');
    }

    const tables = EXPORT_TABLES;
    const exportData: Record<string, unknown[]> = {};

    for (const table of tables) {
      try {
        const exists = await adapter.queryOne<{ exists: boolean }>(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          ) as exists`,
          [table]
        );

        if (exists?.exists) {
          const rows = await adapter.query(`SELECT * FROM ${quoteIdentifier(table)}`);
          exportData[table] = rows;
        }
      } catch {
        // Skip tables that fail
      }
    }

    const versionResult = await adapter.queryOne<{ version: string }>('SELECT version()');

    const exportPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      database: {
        type: 'postgres',
        version: versionResult?.version || 'unknown',
      },
      tables: exportData,
      tableCount: Object.keys(exportData).length,
      totalRows: Object.values(exportData).reduce((sum, rows) => sum + rows.length, 0),
    };

    // Save to backup directory
    const { writeFileSync } = await import('fs');
    const filename = `export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filepath = join(getBackupDir(), filename);

    writeFileSync(filepath, JSON.stringify(exportPayload, null, 2), 'utf-8');

    return c.json({
      success: true,
      data: {
        message: 'Export saved successfully',
        filename,
        path: filepath,
        tableCount: exportPayload.tableCount,
        totalRows: exportPayload.totalRows,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    });

  } catch (err) {
    return c.json({
      success: false,
      error: {
        code: 'EXPORT_SAVE_FAILED',
        message: err instanceof Error ? err.message : 'Export save failed',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Force run schema migrations
 * Useful when schema has been updated but database already exists
 */
databaseRoutes.post('/migrate-schema', async (c) => {
  if (operationStatus.isRunning) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.OPERATION_IN_PROGRESS,
        message: `A ${operationStatus.operation} operation is already in progress`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 409);
  }

  try {
    const adapter = getAdapterSync();

    if (!adapter.isConnected()) {
      throw new Error('Not connected');
    }

    operationStatus = {
      isRunning: true,
      operation: 'migrate',
      lastRun: new Date().toISOString(),
      output: [],
    };

    // Import schema and run migrations
    const { initializeSchema } = await import('../db/schema.js');

    operationStatus.output?.push('Running schema initialization and migrations...');

    await initializeSchema(async (sql: string) => adapter.exec(sql));

    operationStatus.output?.push('Schema migrations completed successfully');
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'success';

    return c.json({
      success: true,
      data: {
        message: 'Schema migrations completed successfully',
        output: operationStatus.output,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    });

  } catch (err) {
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'failure';
    operationStatus.lastError = err instanceof Error ? err.message : 'Migration failed';
    operationStatus.output?.push(`Migration failed: ${operationStatus.lastError}`);

    return c.json({
      success: false,
      error: {
        code: 'MIGRATION_FAILED',
        message: err instanceof Error ? err.message : 'Schema migration failed',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Migrate legacy SQLite data to PostgreSQL
 */
databaseRoutes.post('/migrate', async (c) => {
  if (operationStatus.isRunning) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.OPERATION_IN_PROGRESS,
        message: `A ${operationStatus.operation} operation is already in progress`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 409);
  }

  const body: {
    dryRun?: boolean;
    truncate?: boolean;
    skipSchema?: boolean;
  } = await c.req.json().catch(() => ({}));

  // Check PostgreSQL is connected
  let connected = false;
  try {
    const adapter = getAdapterSync();
    connected = adapter.isConnected();
  } catch {
    // Adapter not initialized
  }

  if (!connected) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.POSTGRES_NOT_CONNECTED,
        message: 'PostgreSQL is not connected. Check your database configuration.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 400);
  }

  // Check SQLite database exists
  const sqlitePath = getDatabasePath();
  if (!existsSync(sqlitePath)) {
    return c.json({
      success: false,
      error: {
        code: 'NO_LEGACY_DATA',
        message: 'No legacy SQLite data found to migrate.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 400);
  }

  operationStatus = {
    isRunning: true,
    operation: 'migrate',
    lastRun: new Date().toISOString(),
    output: [],
  };

  // Build migration command args
  const args = ['tsx', 'scripts/migrate-to-postgres.ts'];
  if (body.dryRun) args.push('--dry-run');
  if (body.truncate) args.push('--truncate');
  if (body.skipSchema) args.push('--skip-schema');

  // Run migration script in background
  const cwd = join(process.cwd(), 'packages', 'gateway');
  // shell: true needed on Windows for npx.cmd resolution
  const migration = spawn('npx', args, {
    cwd,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      SQLITE_PATH: sqlitePath,
    },
  });

  migration.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      operationStatus.output?.push(line);
      log.info(`${line}`);
    }
  });

  migration.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      operationStatus.output?.push(`[ERROR] ${line}`);
      log.error(`[Migration ERROR] ${line}`);
    }
  });

  migration.on('close', (code) => {
    operationStatus.isRunning = false;
    operationStatus.lastResult = code === 0 ? 'success' : 'failure';
    if (code !== 0) {
      operationStatus.lastError = `Migration exited with code ${code}`;
    }
    log.info(`Completed with code ${code}`);
  });

  migration.on('error', (err) => {
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'failure';
    operationStatus.lastError = err.message;
    log.error(`Error: ${err.message}`);
  });

  return c.json({
    success: true,
    data: {
      message: body.dryRun
        ? 'Migration dry-run started'
        : 'Migration started',
      status: 'running',
      options: {
        dryRun: body.dryRun ?? false,
        truncate: body.truncate ?? false,
        skipSchema: body.skipSchema ?? false,
      },
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  }, 202);
});
