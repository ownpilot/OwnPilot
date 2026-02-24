/**
 * Database Operations Routes
 *
 * GET /status - Database status and configuration
 * GET /stats - Detailed database statistics
 * POST /maintenance - Run VACUUM/ANALYZE
 * GET /operation/status - Current operation status
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from '../helpers.js';
import { getDatabaseConfig } from '../../db/adapters/types.js';
import { getAdapterSync } from '../../db/adapters/index.js';
import { getDatabasePath } from '../../paths/index.js';
import { operationStatus, setOperationStatus, getBackupDir } from './shared.js';

export const operationRoutes = new Hono();

/**
 * Get database status and configuration
 */
operationRoutes.get('/status', async (c) => {
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
    const files = (await readdir(backupDir)).filter(
      (f) => f.endsWith('.sql') || f.endsWith('.dump')
    );
    backups = await Promise.all(
      files.map(async (f) => {
        const filePath = join(backupDir, f);
        const fileStat = await stat(filePath);
        return {
          name: f,
          size: fileStat.size,
          created: fileStat.mtime.toISOString(),
        };
      })
    );
    backups.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
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
    legacyData: hasLegacyData
      ? {
          path: sqlitePath,
          migratable: true,
        }
      : null,
    operation: operationStatus,
  });
});

/**
 * Run database maintenance (VACUUM, ANALYZE)
 */
operationRoutes.post('/maintenance', async (c) => {
  if (operationStatus.isRunning) {
    return apiError(
      c,
      {
        code: ERROR_CODES.OPERATION_IN_PROGRESS,
        message: `A ${operationStatus.operation} operation is already in progress`,
      },
      409
    );
  }

  const body: { type?: 'vacuum' | 'analyze' | 'full' } = await c.req.json().catch(() => ({}));
  const ALLOWED_MAINTENANCE_TYPES = ['vacuum', 'analyze', 'full'] as const;
  const rawType = body.type || 'vacuum';
  if (!ALLOWED_MAINTENANCE_TYPES.includes(rawType as (typeof ALLOWED_MAINTENANCE_TYPES)[number])) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Invalid maintenance type: "${rawType}". Allowed: ${ALLOWED_MAINTENANCE_TYPES.join(', ')}`,
      },
      400
    );
  }
  const maintenanceType = rawType as (typeof ALLOWED_MAINTENANCE_TYPES)[number];

  let connected = false;
  try {
    const adapter = getAdapterSync();
    connected = adapter.isConnected();

    if (!connected) {
      throw new Error('Not connected');
    }

    setOperationStatus({
      isRunning: true,
      operation: 'maintenance',
      lastRun: new Date().toISOString(),
      output: [],
    });

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
        operationStatus.lastError = getErrorMessage(err, 'Maintenance failed');
        operationStatus.output?.push(`Error: ${operationStatus.lastError}`);
      }
    })();

    return apiResponse(
      c,
      {
        message: `Maintenance started: ${maintenanceType}`,
        type: maintenanceType,
      },
      202
    );
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.POSTGRES_NOT_CONNECTED, message: 'PostgreSQL is not connected.' },
      400
    );
  }
});

/**
 * Get detailed database statistics
 */
operationRoutes.get('/stats', async (c) => {
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
    const versionResult = await adapter.queryOne<{ version: string }>('SELECT version()');

    return apiResponse(c, {
      database: {
        size: sizeResult?.size || 'unknown',
        sizeBytes: parseInt(sizeResult?.raw_size || '0', 10),
      },
      tables: tableStats.map((t) => ({
        name: t.table_name,
        rowCount: parseInt(t.row_count, 10),
        size: t.size,
      })),
      connections: {
        active: parseInt(connInfo?.active_connections || '0', 10),
        max: parseInt(connInfo?.max_connections || '100', 10),
      },
      version: versionResult?.version || 'unknown',
    });
  } catch {
    return apiError(
      c,
      {
        code: ERROR_CODES.STATS_FAILED,
        message: 'Failed to get database statistics. Is PostgreSQL connected?',
      },
      500
    );
  }
});

/**
 * Get operation status
 */
operationRoutes.get('/operation/status', (c) => {
  return apiResponse(c, operationStatus);
});
