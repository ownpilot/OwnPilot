/**
 * Database Export/Import Routes
 *
 * GET /export - Export all data as JSON
 * POST /import - Import data from JSON export
 * POST /export/save - Save export to backup directory
 */

import { Hono } from 'hono';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from '../helpers.js';
import { getAdapterSync } from '../../db/adapters/index.js';
import {
  EXPORT_TABLES,
  validateTableName,
  validateColumnName,
  quoteIdentifier,
  operationStatus,
  setOperationStatus,
  getBackupDir,
} from './shared.js';

export const transferRoutes = new Hono();

/**
 * Export all data as JSON (no pg_dump required)
 */
transferRoutes.get('/export', async (c) => {
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
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_TABLES,
          message: `No valid tables specified. Skipped: ${skippedTables.join(', ')}`,
        },
        400
      );
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
        errors.push(`${table}: ${getErrorMessage(err, 'Failed')}`);
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
    return apiError(
      c,
      { code: ERROR_CODES.EXPORT_FAILED, message: getErrorMessage(err, 'Export failed') },
      500
    );
  }
});

/**
 * Import data from JSON export
 */
transferRoutes.post('/import', async (c) => {
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
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_IMPORT_DATA,
          message: 'Import data must contain a "tables" object',
        },
        400
      );
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
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_TABLES,
          message: `No valid tables to import. Skipped: ${skippedImportTables.join(', ')}`,
        },
        400
      );
    }

    setOperationStatus({
      isRunning: true,
      operation: 'restore',
      lastRun: new Date().toISOString(),
      output: [],
    });

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
                  .filter((col) => col !== 'id')
                  .map((col) => `${quoteIdentifier(col)} = EXCLUDED.${quoteIdentifier(col)}`)
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
                operationStatus.output?.push(
                  `  Error in ${table}: ${getErrorMessage(err, 'Unknown')}`
                );
              }
            }
          }

          operationStatus.output?.push(
            `  ${table}: ${results[table].imported} imported, ${results[table].errors} errors`
          );
        }

        operationStatus.output?.push(
          `Import completed: ${totalImported} rows imported, ${totalErrors} errors`
        );
        operationStatus.isRunning = false;
        operationStatus.lastResult = totalErrors === 0 ? 'success' : 'failure';
      } catch (err) {
        operationStatus.isRunning = false;
        operationStatus.lastResult = 'failure';
        operationStatus.lastError = getErrorMessage(err, 'Import failed');
        operationStatus.output?.push(`Import failed: ${operationStatus.lastError}`);
      }
    })();

    return apiResponse(
      c,
      {
        message: 'Import started',
        tables: tablesToImport,
        options,
      },
      202
    );
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.IMPORT_FAILED, message: getErrorMessage(err, 'Import failed') },
      500
    );
  }
});

/**
 * Download export as file (saves to backup directory)
 */
transferRoutes.post('/export/save', async (c) => {
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
    const filename = `export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filepath = join(getBackupDir(), filename);

    await writeFile(filepath, JSON.stringify(exportPayload, null, 2), 'utf-8');

    return apiResponse(c, {
      message: 'Export saved successfully',
      filename,
      path: filepath,
      tableCount: exportPayload.tableCount,
      totalRows: exportPayload.totalRows,
    });
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.EXPORT_SAVE_FAILED, message: getErrorMessage(err, 'Export save failed') },
      500
    );
  }
});
