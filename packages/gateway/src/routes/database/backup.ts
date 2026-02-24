/**
 * Database Backup Routes
 *
 * POST /backup - Create a database backup using pg_dump
 * POST /restore - Restore database from a backup
 * DELETE /backup/:filename - Delete a backup file
 */

import { Hono } from 'hono';
import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { apiResponse, apiError, ERROR_CODES, sanitizeId, getErrorMessage } from '../helpers.js';
import { getDatabaseConfig } from '../../db/adapters/types.js';
import { getAdapterSync } from '../../db/adapters/index.js';
import { getLog } from '../../services/log.js';
import { operationStatus, setOperationStatus, getBackupDir } from './shared.js';

const log = getLog('Database');

export const backupRoutes = new Hono();

/**
 * Create a database backup using pg_dump
 */
backupRoutes.post('/backup', async (c) => {
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

  // Set running flag immediately to prevent TOCTOU race
  setOperationStatus({
    isRunning: true,
    operation: 'backup',
    lastRun: new Date().toISOString(),
    output: [],
  });

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
    operationStatus.isRunning = false;
    return apiError(
      c,
      { code: ERROR_CODES.POSTGRES_NOT_CONNECTED, message: 'PostgreSQL is not connected.' },
      400
    );
  }

  const body: { format?: 'sql' | 'custom' } = await c.req.json().catch(() => ({}));
  const format = body.format || 'sql';
  const ext = format === 'custom' ? 'dump' : 'sql';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.${ext}`;
  const backupPath = join(getBackupDir(), filename);

  // Build pg_dump command
  const args = [
    '-h',
    config.postgresHost || 'localhost',
    '-p',
    String(config.postgresPort),
    '-U',
    config.postgresUser || 'ownpilot',
    '-d',
    config.postgresDatabase || 'ownpilot',
    '-f',
    backupPath,
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

  return apiResponse(
    c,
    {
      message: 'Backup started',
      filename,
      format,
    },
    202
  );
});

/**
 * Restore database from a backup
 */
backupRoutes.post('/restore', async (c) => {
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

  // Set running flag immediately to prevent TOCTOU race
  setOperationStatus({
    isRunning: true,
    operation: 'restore',
    lastRun: new Date().toISOString(),
    output: [],
  });

  const body: { filename: string } = await c.req.json().catch(() => ({ filename: '' }));

  if (!body.filename) {
    operationStatus.isRunning = false;
    return apiError(
      c,
      { code: ERROR_CODES.MISSING_FILENAME, message: 'Backup filename is required' },
      400
    );
  }

  const config = getDatabaseConfig();
  const backupPath = join(getBackupDir(), basename(body.filename)); // Sanitize path

  if (!existsSync(backupPath)) {
    operationStatus.isRunning = false;
    return apiError(
      c,
      {
        code: ERROR_CODES.BACKUP_NOT_FOUND,
        message: `Backup file not found: ${sanitizeId(basename(body.filename))}`,
      },
      404
    );
  }

  const isCustomFormat = body.filename.endsWith('.dump');
  const command = isCustomFormat ? 'pg_restore' : 'psql';

  const args = isCustomFormat
    ? [
        '-h',
        config.postgresHost || 'localhost',
        '-p',
        String(config.postgresPort),
        '-U',
        config.postgresUser || 'ownpilot',
        '-d',
        config.postgresDatabase || 'ownpilot',
        '--clean', // Drop objects before recreating
        '--if-exists',
        backupPath,
      ]
    : [
        '-h',
        config.postgresHost || 'localhost',
        '-p',
        String(config.postgresPort),
        '-U',
        config.postgresUser || 'ownpilot',
        '-d',
        config.postgresDatabase || 'ownpilot',
        '-f',
        backupPath,
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

  return apiResponse(
    c,
    {
      message: 'Restore started',
      filename: body.filename,
    },
    202
  );
});

/**
 * Delete a backup file
 */
backupRoutes.delete('/backup/:filename', (c) => {
  const filename = c.req.param('filename');
  const backupPath = join(getBackupDir(), basename(filename)); // Sanitize path

  if (!existsSync(backupPath)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.BACKUP_NOT_FOUND,
        message: `Backup file not found: ${sanitizeId(basename(filename))}`,
      },
      404
    );
  }

  try {
    unlinkSync(backupPath);
    return apiResponse(c, { message: `Deleted backup: ${sanitizeId(basename(filename))}` });
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.DELETE_FAILED, message: getErrorMessage(err, 'Failed to delete backup') },
      500
    );
  }
});
