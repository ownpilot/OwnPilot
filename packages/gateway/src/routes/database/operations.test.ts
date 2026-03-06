/**
 * Database Operations Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mocks — must be defined before vi.mock() factories
const mockExistsSync = vi.fn();
const mockReaddir = vi.fn(async () => [] as string[]);
const mockStat = vi.fn(async () => ({ size: 1024, mtime: new Date('2026-01-01') }));

const mockIsConnected = vi.fn();
const mockQueryOne = vi.fn();
const mockQuery = vi.fn();
const mockExec = vi.fn();
const mockGetAdapterSync = vi.fn();

vi.mock('../../db/adapters/index.js', () => ({
  getAdapterSync: () => mockGetAdapterSync(),
}));

const mockGetDatabaseConfig = vi.fn();
vi.mock('../../db/adapters/types.js', () => ({
  getDatabaseConfig: () => mockGetDatabaseConfig(),
}));

vi.mock('../../paths/index.js', () => ({
  getDatabasePath: vi.fn(() => '/tmp/ownpilot.db'),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, existsSync: (...args: unknown[]) => mockExistsSync(...args) };
});

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...(args as [])),
  stat: (...args: unknown[]) => mockStat(...(args as [])),
}));

let testOperationStatus = { isRunning: false } as Record<string, unknown>;
const mockSetOperationStatus = vi.fn((status: Record<string, unknown>) => {
  Object.assign(testOperationStatus, status);
});
const mockGetBackupDir = vi.fn(() => '/tmp/backups');

vi.mock('./shared.js', () => ({
  get operationStatus() {
    return testOperationStatus;
  },
  setOperationStatus: (...args: unknown[]) =>
    mockSetOperationStatus(...(args as [Record<string, unknown>])),
  getBackupDir: () => mockGetBackupDir(),
}));

import { operationRoutes } from './operations.js';

function createApp() {
  const app = new Hono();
  app.route('/db', operationRoutes);
  return app;
}

describe('Operation Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    testOperationStatus = { isRunning: false };

    mockGetDatabaseConfig.mockReturnValue({
      postgresHost: 'localhost',
      postgresPort: 5432,
      postgresDatabase: 'ownpilot',
    });

    mockGetAdapterSync.mockReturnValue({
      isConnected: mockIsConnected,
      queryOne: mockQueryOne,
      query: mockQuery,
      exec: mockExec,
    });

    mockIsConnected.mockReturnValue(true);
    mockQueryOne.mockResolvedValue({ size: '8 MB', count: '42', raw_size: '8388608' });
    mockQuery.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(false);
    mockReaddir.mockResolvedValue([]);
    mockStat.mockResolvedValue({ size: 1024, mtime: new Date('2026-01-01') });
    mockGetBackupDir.mockReturnValue('/tmp/backups');
  });

  // ---------------------------------------------------------------------------
  // GET /db/status
  // ---------------------------------------------------------------------------
  describe('GET /db/status', () => {
    it('returns 200 with connected status and stats when database is connected', async () => {
      mockIsConnected.mockReturnValue(true);
      mockQueryOne.mockResolvedValueOnce({ size: '8 MB' }).mockResolvedValueOnce({ count: '15' });

      const res = await app.request('/db/status');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.connected).toBe(true);
      expect(json.data.type).toBe('postgres');
      expect(json.data.host).toBe('localhost');
      expect(json.data.port).toBe(5432);
      expect(json.data.database).toBe('ownpilot');
      expect(json.data.stats).toMatchObject({
        databaseSize: '8 MB',
        tableCount: 15,
      });
    });

    it('returns connected: false and null stats when database is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await app.request('/db/status');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.connected).toBe(false);
      expect(json.data.stats).toBeNull();
    });

    it('returns connected: false and null stats when adapter throws', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('Adapter not initialized');
      });

      const res = await app.request('/db/status');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.connected).toBe(false);
      expect(json.data.stats).toBeNull();
    });

    it('returns legacyData: null when SQLite file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const res = await app.request('/db/status');
      const json = await res.json();
      expect(json.data.legacyData).toBeNull();
    });

    it('returns legacyData object when legacy SQLite file exists', async () => {
      mockExistsSync.mockReturnValue(true);

      const res = await app.request('/db/status');
      const json = await res.json();
      expect(json.data.legacyData).toMatchObject({
        path: '/tmp/ownpilot.db',
        migratable: true,
      });
    });

    it('lists backup files from the backup directory', async () => {
      mockReaddir.mockResolvedValue([
        'backup-2026-01-01.sql',
        'backup-2026-01-02.dump',
        'other.txt',
      ]);
      mockStat.mockResolvedValue({ size: 2048, mtime: new Date('2026-01-02') });

      const res = await app.request('/db/status');
      const json = await res.json();

      // 'other.txt' is filtered out — only .sql and .dump
      expect(json.data.backups).toHaveLength(2);
      expect(json.data.backups[0]).toMatchObject({
        size: 2048,
        created: new Date('2026-01-02').toISOString(),
      });
    });

    it('returns empty backups array when readdir fails', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const res = await app.request('/db/status');
      const json = await res.json();
      expect(json.data.backups).toEqual([]);
    });

    it('includes the current operation status in the response', async () => {
      testOperationStatus = { isRunning: true, operation: 'backup' };

      const res = await app.request('/db/status');
      const json = await res.json();
      expect(json.data.operation.isRunning).toBe(true);
      expect(json.data.operation.operation).toBe('backup');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /db/maintenance
  // ---------------------------------------------------------------------------
  describe('POST /db/maintenance', () => {
    it('returns 409 when an operation is already running', async () => {
      testOperationStatus = { isRunning: true, operation: 'backup' };

      const res = await app.request('/db/maintenance', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('OPERATION_IN_PROGRESS');
      expect(json.error.message).toContain('backup');
    });

    it('returns 400 for an invalid maintenance type', async () => {
      const res = await app.request('/db/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reindex' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toContain('reindex');
    });

    it('returns 400 when adapter is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await app.request('/db/maintenance', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('returns 400 when adapter throws on getAdapterSync', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('Not initialized');
      });

      const res = await app.request('/db/maintenance', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('starts vacuum maintenance and returns 202 with correct message', async () => {
      mockExec.mockResolvedValue(undefined);

      const res = await app.request('/db/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'vacuum' }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.message).toBe('Maintenance started: vacuum');
      expect(json.data.type).toBe('vacuum');
      expect(mockSetOperationStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isRunning: true, operation: 'maintenance' })
      );
    });

    it('defaults to vacuum type when no type is provided in body', async () => {
      mockExec.mockResolvedValue(undefined);

      const res = await app.request('/db/maintenance', { method: 'POST' });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.type).toBe('vacuum');
    });

    it('starts analyze maintenance and returns 202', async () => {
      mockExec.mockResolvedValue(undefined);

      const res = await app.request('/db/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analyze' }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.type).toBe('analyze');
    });

    it('starts full maintenance and returns 202', async () => {
      mockExec.mockResolvedValue(undefined);

      const res = await app.request('/db/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'full' }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.type).toBe('full');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /db/stats
  // ---------------------------------------------------------------------------
  describe('GET /db/stats', () => {
    it('returns detailed stats when connected', async () => {
      mockIsConnected.mockReturnValue(true);
      mockQueryOne
        .mockResolvedValueOnce({ size: '16 MB', raw_size: '16777216' })
        .mockResolvedValueOnce({ active_connections: '5', max_connections: '100' })
        .mockResolvedValueOnce({ version: 'PostgreSQL 15.0' });
      mockQuery.mockResolvedValue([{ table_name: 'messages', row_count: '200', size: '4 MB' }]);

      const res = await app.request('/db/stats');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.database.size).toBe('16 MB');
      expect(json.data.database.sizeBytes).toBe(16777216);
      expect(json.data.connections.active).toBe(5);
      expect(json.data.connections.max).toBe(100);
      expect(json.data.version).toBe('PostgreSQL 15.0');
      expect(json.data.tables).toHaveLength(1);
      expect(json.data.tables[0]).toMatchObject({
        name: 'messages',
        rowCount: 200,
        size: '4 MB',
      });
    });

    it('returns 500 when adapter is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await app.request('/db/stats');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('STATS_FAILED');
    });

    it('returns 500 when adapter throws on getAdapterSync', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('No adapter');
      });

      const res = await app.request('/db/stats');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('STATS_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /db/operation/status
  // ---------------------------------------------------------------------------
  describe('GET /db/operation/status', () => {
    it('returns the current operation status', async () => {
      testOperationStatus = {
        isRunning: false,
        lastResult: 'success',
        lastRun: '2026-01-01T00:00:00.000Z',
      };

      const res = await app.request('/db/operation/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isRunning).toBe(false);
      expect(json.data.lastResult).toBe('success');
    });

    it('reflects a running operation in the status', async () => {
      testOperationStatus = { isRunning: true, operation: 'maintenance' };

      const res = await app.request('/db/operation/status');
      const json = await res.json();
      expect(json.data.isRunning).toBe(true);
      expect(json.data.operation).toBe('maintenance');
    });
  });
});
