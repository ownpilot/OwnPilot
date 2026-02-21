/**
 * Database Admin Routes Tests
 *
 * Comprehensive test suite for database management endpoints including
 * status, backup, restore, maintenance, export/import, and migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Mock Adapter ───────────────────────────────────────────────

const mockAdapter = {
  isConnected: vi.fn(() => true),
  queryOne: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
  execute: vi.fn(),
};

// ─── Mock Dependencies ──────────────────────────────────────────

vi.mock('../db/adapters/index.js', () => ({
  getAdapterSync: vi.fn(() => mockAdapter),
}));

vi.mock('../db/adapters/types.js', () => ({
  getDatabaseConfig: vi.fn(() => ({
    postgresHost: 'localhost',
    postgresPort: 5432,
    postgresUser: 'ownpilot',
    postgresPassword: 'secret',
    postgresDatabase: 'ownpilot_test',
  })),
}));

vi.mock('../paths/index.js', () => ({
  getDatabasePath: vi.fn(() => '/data/ownpilot.sqlite'),
  getDataPaths: vi.fn(() => ({ root: '/data' })),
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock fs functions
const mockExistsSync = vi.fn(() => false);
const mockMkdirSync = vi.fn();
const mockReaddir = vi.fn(async () => [] as string[]);
const mockStat = vi.fn(async () => ({ size: 1024, mtime: new Date('2024-06-01') }));
const mockUnlinkSync = vi.fn();
const mockWriteFile = vi.fn(async () => undefined);

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Mock child_process.spawn
const mockSpawnEvents: Record<string, ((...args: unknown[]) => void)[]> = {};
const mockStdoutEvents: Record<string, ((...args: unknown[]) => void)[]> = {};
const mockStderrEvents: Record<string, ((...args: unknown[]) => void)[]> = {};

const mockChildProcess = {
  stdout: {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!mockStdoutEvents[event]) mockStdoutEvents[event] = [];
      mockStdoutEvents[event].push(cb);
    }),
  },
  stderr: {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!mockStderrEvents[event]) mockStderrEvents[event] = [];
      mockStderrEvents[event].push(cb);
    }),
  },
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (!mockSpawnEvents[event]) mockSpawnEvents[event] = [];
    mockSpawnEvents[event].push(cb);
  }),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChildProcess),
}));

// Mock db/schema.js for migrate-schema
vi.mock('../db/schema.js', () => ({
  initializeSchema: vi.fn(async (exec: (sql: string) => Promise<void>) => {
    await exec('CREATE TABLE IF NOT EXISTS test (id text)');
  }),
}));

// ─── Import route + error handler ───────────────────────────────

import { databaseRoutes } from './database.js';
import { errorHandler } from '../middleware/error-handler.js';

// ─── Helpers ────────────────────────────────────────────────────

const ADMIN_KEY = 'test-admin-key-123';

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Admin-Key': ADMIN_KEY, ...extra };
}

function jsonAdminHeaders(): Record<string, string> {
  return { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json' };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Database Routes', () => {
  let app: Hono;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Trigger any pending spawn close events from previous tests
    // to reset module-level operationStatus.isRunning back to false
    if (mockSpawnEvents['close']) {
      for (const cb of mockSpawnEvents['close']) {
        cb(0);
      }
    }
    // Flush microtask queue so async IIFEs (maintenance, import) complete
    await new Promise(r => setTimeout(r, 0));

    app = new Hono();
    app.onError(errorHandler);
    app.route('/database', databaseRoutes);
    vi.clearAllMocks();

    // Set admin key (read at request time by route middleware)
    process.env.ADMIN_KEY = ADMIN_KEY;

    // Default mock returns
    mockAdapter.isConnected.mockReturnValue(true);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.exec.mockResolvedValue(undefined);
    mockAdapter.execute.mockResolvedValue(undefined);

    // Default fs mocks
    mockExistsSync.mockReturnValue(false);
    mockReaddir.mockResolvedValue([]);

    // Reset spawn event maps
    Object.keys(mockSpawnEvents).forEach(k => delete mockSpawnEvents[k]);
    Object.keys(mockStdoutEvents).forEach(k => delete mockStdoutEvents[k]);
    Object.keys(mockStderrEvents).forEach(k => delete mockStderrEvents[k]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ─── No Admin Middleware ─────────────────────────────────────
  // Database routes rely on the global auth middleware configured in app.ts.
  // No separate admin key guard is applied.

  describe('Access without admin key', () => {
    it('should allow /status without X-Admin-Key header', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ size: '15 MB' })
        .mockResolvedValueOnce({ count: '30' });
      mockExistsSync.mockReturnValue(false);
      mockReaddir.mockResolvedValue([]);

      const res = await app.request('/database/status');

      expect(res.status).toBe(200);
    });

    it('should allow /stats without X-Admin-Key header', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ size: '50 MB', raw_size: '52428800' })
        .mockResolvedValueOnce({ active_connections: '3', max_connections: '100' })
        .mockResolvedValueOnce({ version: 'PostgreSQL 16.1' });
      mockAdapter.query.mockResolvedValue([]);

      const res = await app.request('/database/stats');

      expect(res.status).toBe(200);
    });
  });

  // ─── GET /status ─────────────────────────────────────────────

  describe('GET /database/status', () => {
    it('should return connected status with stats', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ size: '15 MB' })
        .mockResolvedValueOnce({ count: '30' });
      mockExistsSync.mockReturnValue(false); // No legacy data
      mockReaddir.mockResolvedValue([]);

      const res = await app.request('/database/status', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.type).toBe('postgres');
      expect(data.data.connected).toBe(true);
      expect(data.data.host).toBe('localhost');
      expect(data.data.database).toBe('ownpilot_test');
      expect(data.data.stats.databaseSize).toBe('15 MB');
      expect(data.data.stats.tableCount).toBe(30);
    });

    it('should return disconnected status', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/status', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.connected).toBe(false);
      expect(data.data.stats).toBeNull();
    });

    it('should include legacy data when SQLite exists', async () => {
      // First call: getBackupDir existsSync, second: SQLite path check
      mockExistsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.sqlite')) return true;
        return false;
      });

      const res = await app.request('/database/status', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.legacyData).not.toBeNull();
      expect(data.data.legacyData.migratable).toBe(true);
    });

    it('should list available backups', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue(['backup-2024.sql', 'backup-2024.dump', 'other.txt'] as never);
      mockStat.mockResolvedValue({ size: 2048, mtime: new Date('2024-06-15') });

      const res = await app.request('/database/status', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      // Only .sql and .dump files included
      expect(data.data.backups).toHaveLength(2);
      expect(data.data.backups[0].name).toBeDefined();
      expect(data.data.backups[0].size).toBe(2048);
    });
  });

  // ─── POST /backup ────────────────────────────────────────────

  describe('POST /database/backup', () => {
    it('should start backup and return 202', async () => {
      const res = await app.request('/database/backup', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({ format: 'sql' }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.message).toContain('Backup started');
      expect(data.data.format).toBe('sql');
      expect(data.data.filename).toContain('backup-');
      expect(data.data.filename).toContain('.sql');
    });

    it('should return 400 when PostgreSQL is not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/backup', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });
  });

  // ─── POST /restore ───────────────────────────────────────────

  describe('POST /database/restore', () => {
    it('should return 400 when filename is missing', async () => {
      const res = await app.request('/database/restore', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('MISSING_FILENAME');
    });

    it('should return 404 when backup file not found', async () => {
      mockExistsSync.mockReturnValue(false);

      const res = await app.request('/database/restore', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({ filename: 'missing.sql' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('BACKUP_NOT_FOUND');
    });

    it('should start restore and return 202', async () => {
      mockExistsSync.mockReturnValue(true);

      const res = await app.request('/database/restore', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({ filename: 'backup-2024.sql' }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toContain('Restore started');
      expect(data.data.filename).toBe('backup-2024.sql');
    });
  });

  // ─── DELETE /backup/:filename ────────────────────────────────

  describe('DELETE /database/backup/:filename', () => {
    it('should return 404 when backup file not found', async () => {
      mockExistsSync.mockReturnValue(false);

      const res = await app.request('/database/backup/missing.sql', {
        method: 'DELETE',
        headers: adminHeaders(),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('BACKUP_NOT_FOUND');
    });

    it('should delete backup file', async () => {
      mockExistsSync.mockReturnValue(true);

      const res = await app.request('/database/backup/old-backup.sql', {
        method: 'DELETE',
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.message).toContain('Deleted backup');
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should return 500 on delete failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const res = await app.request('/database/backup/locked.sql', {
        method: 'DELETE',
        headers: adminHeaders(),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('DELETE_FAILED');
      expect(data.error.message).toContain('Permission denied');
    });
  });

  // ─── POST /maintenance ──────────────────────────────────────

  describe('POST /database/maintenance', () => {
    it('should start vacuum maintenance and return 202', async () => {
      const res = await app.request('/database/maintenance', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({ type: 'vacuum' }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toContain('Maintenance started');
      expect(data.data.type).toBe('vacuum');
    });

    it('should default to vacuum when type not specified', async () => {
      const res = await app.request('/database/maintenance', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.type).toBe('vacuum');
    });

    it('should return 400 when not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/maintenance', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });
  });

  // ─── GET /stats ─────────────────────────────────────────────

  describe('GET /database/stats', () => {
    it('should return detailed database statistics', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ size: '50 MB', raw_size: '52428800' })
        .mockResolvedValueOnce({ active_connections: '3', max_connections: '100' })
        .mockResolvedValueOnce({ version: 'PostgreSQL 16.1' });
      mockAdapter.query.mockResolvedValue([
        { table_name: 'agents', row_count: '10', size: '64 kB' },
        { table_name: 'messages', row_count: '500', size: '2 MB' },
      ]);

      const res = await app.request('/database/stats', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.database.size).toBe('50 MB');
      expect(data.data.database.sizeBytes).toBe(52428800);
      expect(data.data.tables).toHaveLength(2);
      expect(data.data.tables[0].name).toBe('agents');
      expect(data.data.tables[0].rowCount).toBe(10);
      expect(data.data.connections.active).toBe(3);
      expect(data.data.connections.max).toBe(100);
      expect(data.data.version).toContain('PostgreSQL');
    });

    it('should return 500 when not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/stats', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('STATS_FAILED');
    });
  });

  // ─── GET /operation/status ──────────────────────────────────

  describe('GET /database/operation/status', () => {
    it('should return operation status', async () => {
      const res = await app.request('/database/operation/status', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  // ─── GET /export ────────────────────────────────────────────

  describe('GET /database/export', () => {
    it('should export data as JSON', async () => {
      // Table exists check
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })  // first table check
        .mockResolvedValueOnce({ version: 'PostgreSQL 16' }); // version query
      // Query returns rows for first table only (others won't exist)
      mockAdapter.query
        .mockResolvedValueOnce([{ id: '1', name: 'test' }]);

      const res = await app.request('/database/export?tables=settings', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const data = JSON.parse(text);
      expect(data.version).toBe('1.0');
      expect(data.tables).toBeDefined();
      expect(data.database.type).toBe('postgres');
    });

    it('should return 400 for invalid table names', async () => {
      const res = await app.request('/database/export?tables=invalid_table_xyz', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_TABLES');
    });

    it('should return 500 when not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/export', {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('EXPORT_FAILED');
    });
  });

  // ─── POST /import ───────────────────────────────────────────

  describe('POST /database/import', () => {
    it('should return 400 when data is missing tables', async () => {
      const res = await app.request('/database/import', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({ data: {} }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_IMPORT_DATA');
    });

    it('should return 400 when no valid tables in import', async () => {
      const res = await app.request('/database/import', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({
          data: { tables: { nonexistent_xyz: [{ id: '1' }] } },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_TABLES');
    });

    it('should start import and return 202', async () => {
      const res = await app.request('/database/import', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({
          data: {
            version: '1.0',
            tables: { settings: [{ id: '1', key: 'test', value: 'val' }] },
          },
          options: { truncate: true },
        }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toContain('Import started');
      expect(data.data.tables).toContain('settings');
    });

    it('should return 500 when not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/import', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({
          data: { tables: { settings: [] } },
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /export/save ──────────────────────────────────────

  describe('POST /database/export/save', () => {
    it('should save export to file', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ version: 'PostgreSQL 16' });
      mockAdapter.query.mockResolvedValue([]);

      const res = await app.request('/database/export/save', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.message).toContain('Export saved');
      expect(data.data.filename).toContain('export-');
    });

    it('should return 500 when not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/export/save', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('EXPORT_SAVE_FAILED');
    });
  });

  // ─── POST /migrate-schema ──────────────────────────────────

  describe('POST /database/migrate-schema', () => {
    it('should run schema migration successfully', async () => {
      const res = await app.request('/database/migrate-schema', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.message).toContain('Schema migrations completed');
    });

    it('should return 500 when not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/migrate-schema', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('MIGRATION_FAILED');
    });
  });

  // ─── POST /migrate ────────────────────────────────────────

  describe('POST /database/migrate', () => {
    it('should return 400 when PostgreSQL is not connected', async () => {
      mockAdapter.isConnected.mockReturnValue(false);

      const res = await app.request('/database/migrate', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('should return 400 when no legacy SQLite data found', async () => {
      mockExistsSync.mockReturnValue(false);

      const res = await app.request('/database/migrate', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('NO_LEGACY_DATA');
    });

    it('should start migration and return 202', async () => {
      mockExistsSync.mockReturnValue(true);

      const res = await app.request('/database/migrate', {
        method: 'POST',
        headers: jsonAdminHeaders(),
        body: JSON.stringify({ dryRun: true }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toContain('dry-run');
      expect(data.data.status).toBe('running');
      expect(data.data.options.dryRun).toBe(true);
    });
  });
});
