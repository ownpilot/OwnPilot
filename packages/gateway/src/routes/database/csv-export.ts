/**
 * Database CSV Export/Import Routes
 *
 * GET /database/export/csv/:table  - Export single table as CSV
 * GET /database/export/csv       - Export all user-facing tables
 * POST /database/import/csv/:table - Import CSV data
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from '../helpers.js';
import { getAdapter } from '../../db/adapters/index.js';
import { quoteIdentifier, validateColumnName, getUserFilter } from './shared.js';

export const csvExportRoutes = new Hono();

// Tables that support CSV export with their column mappings
const CSV_TABLES: Record<string, string[]> = {
  expenses: [
    'id',
    'date',
    'amount',
    'currency',
    'category',
    'description',
    'payment_method',
    'tags',
    'notes',
    'source',
    'created_at',
  ],
  habits: [
    'id',
    'user_id',
    'name',
    'description',
    'frequency',
    'target_days',
    'target_count',
    'category',
    'color',
    'icon',
    'streak_current',
    'streak_longest',
    'total_completions',
    'is_archived',
    'created_at',
  ],
  bookmarks: [
    'id',
    'user_id',
    'url',
    'title',
    'description',
    'favicon',
    'category',
    'tags',
    'is_favorite',
    'visit_count',
    'created_at',
  ],
  notes: [
    'id',
    'user_id',
    'title',
    'content',
    'category',
    'tags',
    'is_pinned',
    'is_archived',
    'color',
    'created_at',
    'updated_at',
  ],
  tasks: [
    'id',
    'user_id',
    'title',
    'description',
    'status',
    'priority',
    'due_date',
    'category',
    'tags',
    'created_at',
    'updated_at',
  ],
  contacts: [
    'id',
    'user_id',
    'name',
    'nickname',
    'email',
    'phone',
    'company',
    'job_title',
    'birthday',
    'address',
    'notes',
    'relationship',
    'tags',
    'is_favorite',
    'created_at',
  ],
  calendar_events: [
    'id',
    'user_id',
    'title',
    'description',
    'location',
    'start_time',
    'end_time',
    'all_day',
    'timezone',
    'recurrence',
    'category',
    'tags',
    'color',
    'created_at',
  ],
  captures: [
    'id',
    'user_id',
    'content',
    'type',
    'tags',
    'source',
    'processed',
    'processed_as_type',
    'created_at',
  ],
};

// Tables that accept CSV import
const IMPORTABLE_TABLES = [
  'expenses',
  'habits',
  'bookmarks',
  'notes',
  'tasks',
  'contacts',
  'calendar_events',
  'captures',
];

/**
 * Escape a value for CSV: wrap in quotes if contains comma, newline, or quote
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Handle JSON arrays/objects - serialize them for CSV readability
  if (typeof value === 'object') {
    str = JSON.stringify(value);
  }
  // Escape quotes by doubling them
  str = str.replace(/"/g, '""');
  // Wrap in quotes if contains special chars
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    return `"${str}"`;
  }
  return str;
}

/**
 * Serialize a row for CSV line
 */
function rowToCsvLine(values: unknown[]): string {
  return values.map(escapeCsvValue).join(',');
}

/**
 * Get column indices for a table's columns from raw row keys
 */
function getColumnValues(row: Record<string, unknown>, columns: string[]): unknown[] {
  return columns.map((col) => {
    const val = row[col];
    // Serialize JSON arrays as semicolon-separated for CSV
    if (Array.isArray(val)) {
      return val.join(';');
    }
    // Serialize objects as JSON
    if (val !== null && typeof val === 'object') {
      return JSON.stringify(val);
    }
    return val ?? '';
  });
}

/**
 * CSV single table export
 */
csvExportRoutes.get('/export/csv/:table', async (c) => {
  const tableName = c.req.param('table');

  if (!CSV_TABLES[tableName]) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_TABLES,
        message: `Table '${tableName}' does not support CSV export. Available: ${Object.keys(CSV_TABLES).join(', ')}`,
      },
      400
    );
  }

  try {
    const adapter = await getAdapter();
    if (!adapter.isConnected()) {
      throw new Error('Database not connected');
    }

    const columns = CSV_TABLES[tableName];
    const quotedCols = columns.map(quoteIdentifier).join(', ');

    // Plan 11 Step 3 (CSV-002): reuse the shared user filter so the
    // hardcoded list of "8 per-user tables" stops drifting from the
    // real allowlist. getUserFilter handles per-user, child, and
    // system scopes; for CSV export we always pass a userId from
    // auth context (falls back to undefined → no filter for system
    // tables, but the CSV_TABLES list is curated to user-owned ones).
    const userId = c.get('userId') as string | undefined;
    const { where, params } = getUserFilter(tableName, userId);

    let query = `SELECT ${quotedCols} FROM ${quoteIdentifier(tableName)}${where}`;
    query += ` ORDER BY created_at DESC`;

    const rows = await adapter.query<Record<string, unknown>>(query, params);

    // Build CSV
    const csvLines: string[] = [columns.join(',')];
    for (const row of rows) {
      const values = getColumnValues(row, columns);
      csvLines.push(rowToCsvLine(values));
    }

    const csvContent = csvLines.join('\n');
    const filename = `ownpilot-${tableName}-${new Date().toISOString().split('T')[0]}.csv`;

    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);

    return c.body(csvContent);
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.EXPORT_FAILED, message: getErrorMessage(err, 'CSV export failed') },
      500
    );
  }
});

/**
 * CSV all tables export (returns JSON with all CSV data)
 */
csvExportRoutes.get('/export/csv', async (c) => {
  try {
    const adapter = await getAdapter();
    if (!adapter.isConnected()) {
      throw new Error('Database not connected');
    }

    const userId = c.get('userId') as string | undefined;
    const allCsvData: Record<string, { columns: string[]; rows: string[] }> = {};

    for (const [tableName, columns] of Object.entries(CSV_TABLES)) {
      try {
        const quotedCols = columns.map(quoteIdentifier).join(', ');
        let query = `SELECT ${quotedCols} FROM ${quoteIdentifier(tableName)}`;
        const params: unknown[] = [];

        if (
          userId &&
          [
            'expenses',
            'habits',
            'bookmarks',
            'notes',
            'tasks',
            'contacts',
            'calendar_events',
            'captures',
          ].includes(tableName)
        ) {
          query += ` WHERE user_id = $1`;
          params.push(userId);
        }

        query += ` ORDER BY created_at DESC`;

        const rows = await adapter.query<Record<string, unknown>>(query, params);

        const csvRows = rows.map((row) => rowToCsvLine(getColumnValues(row, columns)));
        allCsvData[tableName] = { columns, rows: csvRows };
      } catch {
        // Skip tables that fail
      }
    }

    return apiResponse(c, {
      exportedAt: new Date().toISOString(),
      tables: allCsvData,
      tableCount: Object.keys(allCsvData).length,
    });
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.EXPORT_FAILED, message: getErrorMessage(err, 'CSV export failed') },
      500
    );
  }
});

/**
 * CSV import for a specific table
 */
csvExportRoutes.post('/import/csv/:table', async (c) => {
  const tableName = c.req.param('table');

  if (!IMPORTABLE_TABLES.includes(tableName)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_TABLES,
        message: `Table '${tableName}' does not support CSV import. Available: ${IMPORTABLE_TABLES.join(', ')}`,
      },
      400
    );
  }

  try {
    const adapter = await getAdapter();
    if (!adapter.isConnected()) {
      throw new Error('Database not connected');
    }

    const csvContent = await c.req.text();
    const lines = csvContent.split('\n').filter((line) => line.trim());

    if (lines.length < 2) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_IMPORT_DATA,
          message: 'CSV must have header and at least one data row',
        },
        400
      );
    }

    // Parse header
    const headerLine = lines[0];
    const rawHeaders = parseCsvLine(headerLine ?? '');

    // Plan 11 CSV-001: validate every header against the SQL identifier
    // allowlist (^[a-z_][a-z0-9_]*$). quoteIdentifier below would otherwise
    // turn a malicious header into a quoted string that Postgres treats as
    // a literal column name — the column just doesn't exist and the INSERT
    // fails, but the cost of failing early with a clear 400 is much lower
    // than letting the request reach the database adapter.
    const headers: string[] = [];
    for (const h of rawHeaders) {
      try {
        headers.push(validateColumnName(h));
      } catch (err) {
        return apiError(
          c,
          {
            code: ERROR_CODES.INVALID_IMPORT_DATA,
            message: `Invalid CSV header: ${getErrorMessage(err, 'malformed')}`,
          },
          400
        );
      }
    }

    const tableColumns = CSV_TABLES[tableName];
    const columns = tableColumns ? tableColumns.filter((col) => headers.includes(col)) : headers;

    // Parse rows
    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i] ?? '');
      const row: Record<string, unknown> = {};
      for (let j = 0; j < columns.length && j < values.length; j++) {
        const col = columns[j];
        if (!col) continue;
        let val: unknown = values[j];
        // Try to parse JSON if looks like array/object
        if (typeof val === 'string') {
          if (val.startsWith('[') || val.startsWith('{')) {
            try {
              val = JSON.parse(val);
            } catch {
              // Keep as string
            }
          } else if (val.includes(';') && !val.includes(',') && !val.includes('{')) {
            // Semicolon-separated array
            val = val.split(';').filter(Boolean);
          }
        }
        row[col] = val;
      }
      rows.push(row);
    }

    // Insert rows
    let imported = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const rawColumns = Object.keys(row).filter(
          (k) => row[k] !== '' && row[k] !== null && row[k] !== undefined
        );
        if (rawColumns.length === 0) continue;

        const validColumns = rawColumns;
        const validValues = validColumns.map((col) => row[col]);

        const quotedColumns = validColumns.map(quoteIdentifier);
        const placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ');
        const quotedTable = quoteIdentifier(tableName);

        const sql = `INSERT INTO ${quotedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT ("id") DO UPDATE SET ${validColumns
          .filter((c) => c !== 'id')
          .map((col) => `${quoteIdentifier(col)} = EXCLUDED.${quoteIdentifier(col)}`)
          .join(', ')}`;

        await adapter.execute(sql, validValues);
        imported++;
      } catch {
        errors++;
      }
    }

    return apiResponse(c, {
      imported,
      errors,
      message: `Imported ${imported} rows${errors > 0 ? `, ${errors} errors` : ''}`,
    });
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.IMPORT_FAILED, message: getErrorMessage(err, 'CSV import failed') },
      500
    );
  }
});

/**
 * Parse a single CSV line handling quoted values
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}
