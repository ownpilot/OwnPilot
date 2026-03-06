/**
 * Database Transfer Routes Tests
 *
 * Tests for GET /export, POST /import, and POST /export/save
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sep } from 'path';

// ---------------------------------------------------------------------------
// Hoisted mock values — must be defined before any vi.mock() calls
// ---------------------------------------------------------------------------
const { mockAdapter, mockWriteFile, mockOperationStatus } = vi.hoisted(() => {
  const mockAdapter = {
    isConnected: vi.fn(() => true),
    queryOne: vi.fn(async () => ({ exists: true })),
    query: vi.fn(async () => [{ id: 1, name: 'row1' }]),
    exec: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
  };
  const mockWriteFile = vi.fn(async () => {});
  const mockOperationStatus = {
    isRunning: false,
    operation: null,
    output: [],
    lastRun: null,
  } as Record<string, unknown>;
  return { mockAdapter, mockWriteFile, mockOperationStatus };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../db/adapters/index.js', () => ({
  getAdapterSync: () => mockAdapter,
}));

vi.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...(args as [])),
}));

const mockSetOperationStatus = vi.fn((update: Record<string, unknown>) => {
  Object.assign(mockOperationStatus, update);
});
const mockValidateTableName = vi.fn((t: string) => t.trim());
const mockValidateColumnName = vi.fn((col: string) => col.trim());
const mockQuoteIdentifier = vi.fn((n: string) => `"${n}"`);
const mockGetBackupDir = vi.fn(() => '/tmp/backups');

vi.mock('./shared.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get operationStatus() {
      return mockOperationStatus;
    },
    setOperationStatus: (...args: unknown[]) =>
      mockSetOperationStatus(...(args as [Record<string, unknown>])),
    validateTableName: (...args: unknown[]) => mockValidateTableName(...(args as [string])),
    validateColumnName: (...args: unknown[]) => mockValidateColumnName(...(args as [string])),
    quoteIdentifier: (...args: unknown[]) => mockQuoteIdentifier(...(args as [string])),
    getBackupDir: () => mockGetBackupDir(),
    EXPORT_TABLES: ['users', 'conversations'],
  };
});

import { transferRoutes } from './transfer.js';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function createApp() {
  const app = new Hono();
  app.route('/database', transferRoutes);
  app.onError((err, c) => {
    return c.json({ success: false, error: { code: 'INTERNAL', message: err.message } }, 500);
  });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonPost(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Transfer Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    // Reset shared operation status
    Object.assign(mockOperationStatus, {
      isRunning: false,
      operation: null,
      output: [],
      lastRun: null,
    });

    // Default adapter behaviour
    mockAdapter.isConnected.mockReturnValue(true);
    mockAdapter.queryOne.mockResolvedValue({ exists: true });
    mockAdapter.query.mockResolvedValue([{ id: 1, name: 'row1' }]);
    mockAdapter.exec.mockResolvedValue(undefined);
    mockAdapter.execute.mockResolvedValue(undefined);

    // Default shared helpers
    mockValidateTableName.mockImplementation((t: string) => t.trim());
    mockValidateColumnName.mockImplementation((col: string) => col.trim());
    mockQuoteIdentifier.mockImplementation((n: string) => `"${n}"`);
    mockGetBackupDir.mockReturnValue('/tmp/backups');
    mockWriteFile.mockResolvedValue(undefined);
    mockSetOperationStatus.mockImplementation((update: Record<string, unknown>) => {
      Object.assign(mockOperationStatus, update);
    });
  });

  // =========================================================================
  // GET /database/export
  // =========================================================================
  describe('GET /database/export', () => {
    it('returns 200 with JSON payload when adapter is connected', async () => {
      // queryOne: EXISTS check → true, then SELECT version()
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });

      const res = await app.request('/database/export');
      expect(res.status).toBe(200);

      const json = JSON.parse(await res.text());
      expect(json.version).toBe('1.0');
      expect(json.database.type).toBe('postgres');
      expect(json.exportedAt).toBeDefined();
    });

    it('includes version info, tableCount and totalRows in response', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.5' });
      mockAdapter.query.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const res = await app.request('/database/export');
      const json = JSON.parse(await res.text());

      expect(json.database.version).toBe('PostgreSQL 15.5');
      expect(json.tableCount).toBeGreaterThanOrEqual(0);
      expect(typeof json.totalRows).toBe('number');
    });

    it('sets Content-Disposition attachment header', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });

      const res = await app.request('/database/export');
      expect(res.headers.get('Content-Disposition')).toMatch(
        /attachment; filename="ownpilot-export-/
      );
    });

    it('returns 500 when adapter.isConnected() returns false', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/export');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('EXPORT_FAILED');
    });

    it('returns 400 when all specified tables are invalid', async () => {
      mockValidateTableName.mockImplementation(() => {
        throw new Error('Invalid table name');
      });

      const res = await app.request('/database/export?tables=invalid1,invalid2');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_TABLES');
    });

    it('skips tables where EXISTS check returns false', async () => {
      // EXISTS → false for users, EXISTS → false for conversations, then version query
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });

      const res = await app.request('/database/export');
      const json = JSON.parse(await res.text());

      expect(json.tableCount).toBe(0);
      expect(json.totalRows).toBe(0);
    });

    it('skips tables where query throws and adds error to errors array', async () => {
      // users EXISTS → true, users query → throws; conversations EXISTS → true, query OK; version
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });
      mockAdapter.query
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce([{ id: 1 }]);

      const res = await app.request('/database/export');
      const json = JSON.parse(await res.text());

      expect(json.errors).toBeDefined();
      expect(json.errors.length).toBeGreaterThan(0);
      expect(json.errors[0]).toContain('Permission denied');
    });

    it('exports only the tables specified via ?tables= query param', async () => {
      // Override validateTableName so only 'users' succeeds
      mockValidateTableName.mockImplementation((t: string) => {
        const trimmed = t.trim();
        if (trimmed === 'users') return trimmed;
        throw new Error('Not in whitelist');
      });

      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });
      mockAdapter.query.mockResolvedValue([{ id: 1 }]);

      const res = await app.request('/database/export?tables=users,conversations');
      expect(res.status).toBe(200);
      const json = JSON.parse(await res.text());
      // Only 'users' is in the result (conversations was invalid)
      expect(json.tables).toHaveProperty('users');
      expect(json.tables).not.toHaveProperty('conversations');
    });

    it('includes tables data keyed by table name', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });
      mockAdapter.query
        .mockResolvedValueOnce([{ id: 1, name: 'Alice' }])
        .mockResolvedValueOnce([{ id: 2, name: 'Bob' }]);

      const res = await app.request('/database/export');
      const json = JSON.parse(await res.text());

      // EXPORT_TABLES mock = ['users', 'conversations']
      expect(json.tables).toHaveProperty('users');
      expect(json.tables).toHaveProperty('conversations');
      expect(Array.isArray(json.tables.users)).toBe(true);
    });

    it('uses "unknown" as database version when queryOne returns null for version', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce(null);

      const res = await app.request('/database/export');
      const json = JSON.parse(await res.text());
      expect(json.database.version).toBe('unknown');
    });

    it('does not include errors field when no errors occurred', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });

      const res = await app.request('/database/export');
      const json = JSON.parse(await res.text());
      expect(json.errors).toBeUndefined();
    });
  });

  // =========================================================================
  // POST /database/import
  // =========================================================================
  describe('POST /database/import', () => {
    const validImportBody = {
      data: {
        version: '1.0',
        tables: {
          users: [{ id: 1, name: 'Alice' }],
          conversations: [{ id: 2, title: 'Test' }],
        },
      },
      options: {},
    };

    it('returns 202 with "Import started" and tables list', async () => {
      const res = await jsonPost(app, '/database/import', validImportBody);
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.message).toBe('Import started');
      expect(Array.isArray(json.data.tables)).toBe(true);
      expect(json.data.tables).toContain('users');
      expect(json.data.tables).toContain('conversations');
    });

    it('returns 409 when operationStatus.isRunning is true', async () => {
      Object.assign(mockOperationStatus, { isRunning: true, operation: 'restore' });

      const res = await jsonPost(app, '/database/import', validImportBody);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('OPERATION_IN_PROGRESS');
      expect(json.error.message).toContain('restore');
    });

    it('returns 400 when body has no data.tables', async () => {
      const res = await jsonPost(app, '/database/import', { data: { version: '1.0' } });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_IMPORT_DATA');
    });

    it('returns 400 when all table names are invalid', async () => {
      mockValidateTableName.mockImplementation(() => {
        throw new Error('Not in whitelist');
      });

      const res = await jsonPost(app, '/database/import', validImportBody);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_TABLES');
    });

    it('returns 500 when adapter is not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await jsonPost(app, '/database/import', validImportBody);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('IMPORT_FAILED');
    });

    it('calls setOperationStatus with isRunning: true at start of import', async () => {
      const res = await jsonPost(app, '/database/import', validImportBody);
      expect(res.status).toBe(202);
      expect(mockSetOperationStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isRunning: true, operation: 'restore' })
      );
    });

    it('starts background import process without blocking the response', async () => {
      // The response should come back immediately as 202
      const start = Date.now();
      const res = await jsonPost(app, '/database/import', validImportBody);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(202);
      // Should respond quickly (background work not awaited)
      expect(elapsed).toBeLessThan(2000);
    });

    it('returns tables from options.tables when provided', async () => {
      const bodyWithOptions = {
        data: {
          version: '1.0',
          tables: {
            users: [{ id: 1 }],
            conversations: [{ id: 2 }],
          },
        },
        options: { tables: ['users'] },
      };

      const res = await jsonPost(app, '/database/import', bodyWithOptions);
      expect(res.status).toBe(202);
      const json = await res.json();
      // Only 'users' requested via options.tables
      expect(json.data.tables).toContain('users');
    });

    it('includes options in the response', async () => {
      const bodyWithOptions = {
        ...validImportBody,
        options: { truncate: true, skipExisting: false },
      };

      const res = await jsonPost(app, '/database/import', bodyWithOptions);
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.options).toMatchObject({ truncate: true, skipExisting: false });
    });

    it('returns 409 when import is already running with backup operation', async () => {
      Object.assign(mockOperationStatus, { isRunning: true, operation: 'backup' });

      const res = await jsonPost(app, '/database/import', validImportBody);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.message).toContain('backup');
    });
  });

  // =========================================================================
  // POST /database/export/save
  // =========================================================================
  describe('POST /database/export/save', () => {
    beforeEach(() => {
      // Default: both tables exist, each has one row, then version query
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });
      mockAdapter.query.mockResolvedValue([{ id: 1 }]);
    });

    it('returns 200 with filename, path, tableCount and totalRows', async () => {
      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Export saved successfully');
      expect(json.data.filename).toMatch(/^export-.*\.json$/);
      expect(typeof json.data.path).toBe('string');
      expect(typeof json.data.tableCount).toBe('number');
      expect(typeof json.data.totalRows).toBe('number');
    });

    it('calls writeFile with a path inside the backup directory', async () => {
      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockWriteFile).toHaveBeenCalledOnce();
      const [filepath] = mockWriteFile.mock.calls[0] as [string, ...unknown[]];
      // Normalize to forward slashes for cross-platform comparison
      const normalizedPath = (filepath as string).split(sep).join('/');
      expect(normalizedPath).toContain('/tmp/backups');
      expect(normalizedPath).toMatch(/\.json$/);
    });

    it('writes valid JSON content to the file', async () => {
      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(200);
      const [, content] = mockWriteFile.mock.calls[0] as [string, string, ...unknown[]];
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe('1.0');
      expect(parsed.database.type).toBe('postgres');
      expect(parsed.tables).toBeDefined();
    });

    it('returns 500 when adapter is not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('EXPORT_SAVE_FAILED');
    });

    it('returns 500 when writeFile throws', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('Disk full'));

      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('EXPORT_SAVE_FAILED');
      expect(json.error.message).toContain('Disk full');
    });

    it('uses getBackupDir() to determine the save location', async () => {
      mockGetBackupDir.mockReturnValue('/custom/backup/path');
      // Reset queryOne for this test
      mockAdapter.queryOne
        .mockReset()
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });

      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(200);
      const [filepath] = mockWriteFile.mock.calls[0] as [string, ...unknown[]];
      // Normalize separators for cross-platform comparison
      const normalizedPath = (filepath as string).split(sep).join('/');
      expect(normalizedPath).toContain('/custom/backup/path');
    });

    it('skips tables where EXISTS check returns false', async () => {
      // Override: both tables do not exist, then version
      mockAdapter.queryOne
        .mockReset()
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });

      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tableCount).toBe(0);
      expect(json.data.totalRows).toBe(0);
    });

    it('counts totalRows correctly from all exported tables', async () => {
      // users has 3 rows, conversations has 2 rows
      mockAdapter.queryOne
        .mockReset()
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });
      mockAdapter.query
        .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])
        .mockResolvedValueOnce([{ id: 4 }, { id: 5 }]);

      const res = await app.request('/database/export/save', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tableCount).toBe(2);
      expect(json.data.totalRows).toBe(5);
    });
  });
});
