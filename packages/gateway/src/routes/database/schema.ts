/**
 * Database Schema Migration Routes
 *
 * POST /migrate-schema - Force run schema migrations
 * POST /migrate - Migrate legacy SQLite data to PostgreSQL
 */

import { Hono } from 'hono';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from '../helpers.js';
import { getAdapterSync } from '../../db/adapters/index.js';
import { getDatabasePath } from '../../paths/index.js';
import { getLog } from '../../services/log.js';
import { operationStatus, setOperationStatus } from './shared.js';

const log = getLog('Database');

export const schemaRoutes = new Hono();

/**
 * Force run schema migrations
 * Useful when schema has been updated but database already exists
 */
schemaRoutes.post('/migrate-schema', async (c) => {
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

  try {
    const adapter = getAdapterSync();

    if (!adapter.isConnected()) {
      throw new Error('Not connected');
    }

    setOperationStatus({
      isRunning: true,
      operation: 'migrate',
      lastRun: new Date().toISOString(),
      output: [],
    });

    // Import schema and run migrations
    const { initializeSchema } = await import('../../db/schema.js');

    operationStatus.output?.push('Running schema initialization and migrations...');

    await initializeSchema(async (sql: string) => adapter.exec(sql));

    operationStatus.output?.push('Schema migrations completed successfully');
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'success';

    return apiResponse(c, {
      message: 'Schema migrations completed successfully',
      output: operationStatus.output,
    });
  } catch (err) {
    operationStatus.isRunning = false;
    operationStatus.lastResult = 'failure';
    operationStatus.lastError = getErrorMessage(err, 'Migration failed');
    operationStatus.output?.push(`Migration failed: ${operationStatus.lastError}`);

    return apiError(
      c,
      {
        code: ERROR_CODES.MIGRATION_FAILED,
        message: getErrorMessage(err, 'Schema migration failed'),
      },
      500
    );
  }
});

/**
 * Migrate legacy SQLite data to PostgreSQL
 */
schemaRoutes.post('/migrate', async (c) => {
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
    return apiError(
      c,
      {
        code: ERROR_CODES.POSTGRES_NOT_CONNECTED,
        message: 'PostgreSQL is not connected. Check your database configuration.',
      },
      400
    );
  }

  // Check SQLite database exists
  const sqlitePath = getDatabasePath();
  if (!existsSync(sqlitePath)) {
    return apiError(
      c,
      { code: ERROR_CODES.NO_LEGACY_DATA, message: 'No legacy SQLite data found to migrate.' },
      400
    );
  }

  setOperationStatus({
    isRunning: true,
    operation: 'migrate',
    lastRun: new Date().toISOString(),
    output: [],
  });

  // Build migration command args -- uses spawn (not exec) for safety
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

  return apiResponse(
    c,
    {
      message: body.dryRun ? 'Migration dry-run started' : 'Migration started',
      status: 'running',
      options: {
        dryRun: body.dryRun ?? false,
        truncate: body.truncate ?? false,
        skipSchema: body.skipSchema ?? false,
      },
    },
    202
  );
});
