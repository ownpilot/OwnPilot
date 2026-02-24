/**
 * Database Backup Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { EventEmitter } from 'events';

// Mocks
const mockSpawn = vi.fn();
const mockExistsSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  };
});

const mockGetDatabaseConfig = vi.fn();
vi.mock('../../db/adapters/types.js', () => ({
  getDatabaseConfig: () => mockGetDatabaseConfig(),
}));

const mockIsConnected = vi.fn();
const mockGetAdapterSync = vi.fn();
vi.mock('../../db/adapters/index.js', () => ({
  getAdapterSync: () => mockGetAdapterSync(),
}));

const mockGetBackupDir = vi.fn();
let testOperationStatus = { isRunning: false } as Record<string, unknown>;
const mockSetOperationStatus = vi.fn((status: Record<string, unknown>) => {
  Object.assign(testOperationStatus, status);
});

vi.mock('./shared.js', () => ({
  get operationStatus() {
    return testOperationStatus;
  },
  setOperationStatus: (...args: unknown[]) =>
    mockSetOperationStatus(...(args as [Record<string, unknown>])),
  getBackupDir: () => mockGetBackupDir(),
}));

import { backupRoutes } from './backup.js';

function createApp() {
  const app = new Hono();
  app.route('/db', backupRoutes);
  return app;
}

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('Backup Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    testOperationStatus = { isRunning: false };
    mockGetDatabaseConfig.mockReturnValue({
      postgresHost: 'localhost',
      postgresPort: 5432,
      postgresUser: 'testuser',
      postgresDatabase: 'testdb',
      postgresPassword: 'testpass',
    });
    mockGetAdapterSync.mockReturnValue({ isConnected: mockIsConnected });
    mockIsConnected.mockReturnValue(true);
    mockGetBackupDir.mockReturnValue('/tmp/backups');
  });

  describe('POST /db/backup', () => {
    it('returns 409 when operation is already running', async () => {
      testOperationStatus = { isRunning: true, operation: 'backup' };
      const res = await app.request('/db/backup', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('OPERATION_IN_PROGRESS');
    });

    it('returns 400 when postgres is not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const res = await app.request('/db/backup', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('returns 400 when adapter throws', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('No adapter');
      });
      const res = await app.request('/db/backup', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('starts backup with default sql format', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      const res = await app.request('/db/backup', { method: 'POST' });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.message).toBe('Backup started');
      expect(json.data.format).toBe('sql');
      expect(json.data.filename).toMatch(/backup-.*.sql/);
      expect(mockSpawn).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining(['-Fp']),
        expect.any(Object)
      );
    });

    it('starts backup with custom format', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      const res = await app.request('/db/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'custom' }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.format).toBe('custom');
      expect(json.data.filename).toMatch(/backup-.*.dump/);
      expect(mockSpawn).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining(['-Fc']),
        expect.any(Object)
      );
    });

    it('handles stdout data from backup process', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      proc.stdout.emit('data', Buffer.from('Processing tables...'));
      expect(testOperationStatus.output).toContain('Processing tables...');
    });

    it('handles stderr data from backup process', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      proc.stderr.emit('data', Buffer.from('Warning: something'));
      expect(testOperationStatus.output).toContain('Warning: something');
    });

    it('ignores empty stdout/stderr lines', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      proc.stdout.emit('data', Buffer.from('  '));
      proc.stderr.emit('data', Buffer.from('\n'));
      expect(testOperationStatus.output).toHaveLength(0);
    });

    it('handles close with success code 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      proc.emit('close', 0);
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('success');
    });

    it('handles close with failure code', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      proc.emit('close', 1);
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError).toContain('code 1');
    });

    it('handles process error event', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      proc.emit('error', new Error('ENOENT: pg_dump not found'));
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError).toContain('pg_dump not found');
    });
  });
});
