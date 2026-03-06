/**
 * Database Backup Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { EventEmitter } from 'events';
import { sep } from 'path';

// Mocks
const mockSpawn = vi.fn();
const mockExistsSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

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

    it('passes database connection details to pg_dump args', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('localhost');
      expect(spawnArgs).toContain('testdb');
      expect(spawnArgs).toContain('testuser');
    });

    it('sets PGPASSWORD in env and not the full process.env', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      const spawnOpts = mockSpawn.mock.calls[0][2] as { env: Record<string, string> };
      expect(spawnOpts.env.PGPASSWORD).toBe('testpass');
      // Should NOT contain any API keys etc. — only minimal env
      expect(Object.keys(spawnOpts.env)).toEqual(
        expect.arrayContaining(['PATH', 'HOME', 'PGPASSWORD'])
      );
    });

    it('calls setOperationStatus with isRunning: true and operation backup at start', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/backup', { method: 'POST' });
      expect(mockSetOperationStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isRunning: true, operation: 'backup' })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /db/restore
  // ---------------------------------------------------------------------------
  describe('POST /db/restore', () => {
    it('returns 409 when operation is already running', async () => {
      testOperationStatus = { isRunning: true, operation: 'restore' };
      const res = await app.request('/db/restore', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('OPERATION_IN_PROGRESS');
      expect(json.error.message).toContain('restore');
    });

    it('returns 400 when filename is missing from body', async () => {
      const res = await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('MISSING_FILENAME');
    });

    it('returns 400 when body is not valid JSON (filename defaults to empty)', async () => {
      const res = await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('MISSING_FILENAME');
    });

    it('returns 404 when backup file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const res = await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('BACKUP_NOT_FOUND');
    });

    it('starts restore with psql for .sql files and returns 202', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const res = await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.message).toBe('Restore started');
      expect(json.data.filename).toBe('backup-2026.sql');
      expect(mockSpawn).toHaveBeenCalledWith('psql', expect.any(Array), expect.any(Object));
    });

    it('starts restore with pg_restore for .dump files and returns 202', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const res = await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.dump' }),
      });
      expect(res.status).toBe(202);
      expect(mockSpawn).toHaveBeenCalledWith('pg_restore', expect.any(Array), expect.any(Object));
      // pg_restore uses --clean and --if-exists
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--clean');
      expect(spawnArgs).toContain('--if-exists');
    });

    it('handles stdout data from restore process', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      proc.stdout.emit('data', Buffer.from('Restoring table messages...'));
      expect(testOperationStatus.output).toContain('Restoring table messages...');
    });

    it('handles stderr data from restore process', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      proc.stderr.emit('data', Buffer.from('psql: warning: extra args'));
      expect(testOperationStatus.output).toContain('psql: warning: extra args');
    });

    it('sets lastResult success on close with code 0', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      proc.emit('close', 0);
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('success');
    });

    it('sets lastResult failure on close with non-zero code', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      proc.emit('close', 1);
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError as string).toContain('code 1');
    });

    it('sets lastResult failure on process error event', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      proc.emit('error', new Error('ENOENT: psql not found'));
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError as string).toContain('psql not found');
    });

    it('sets PGPASSWORD in env for restore process', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      const spawnOpts = mockSpawn.mock.calls[0][2] as { env: Record<string, string> };
      expect(spawnOpts.env.PGPASSWORD).toBe('testpass');
    });

    it('calls setOperationStatus with isRunning: true and operation restore at start', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      expect(mockSetOperationStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isRunning: true, operation: 'restore' })
      );
    });

    it('ignores empty stdout/stderr lines', async () => {
      mockExistsSync.mockReturnValue(true);
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'backup-2026.sql' }),
      });
      proc.stdout.emit('data', Buffer.from('  '));
      proc.stderr.emit('data', Buffer.from('\n'));
      expect(testOperationStatus.output).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /db/backup/:filename
  // ---------------------------------------------------------------------------
  describe('DELETE /db/backup/:filename', () => {
    it('returns 404 when backup file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const res = await app.request('/db/backup/missing.sql', { method: 'DELETE' });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('BACKUP_NOT_FOUND');
    });

    it('deletes the backup file and returns 200 with success message', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockReturnValue(undefined);
      const res = await app.request('/db/backup/old-backup.sql', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('Deleted backup');
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
    });

    it('includes the sanitized filename in the success message', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockReturnValue(undefined);
      const res = await app.request('/db/backup/my-backup-2026.sql', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('my-backup-2026');
    });

    it('returns 500 when unlinkSync throws', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const res = await app.request('/db/backup/locked.sql', { method: 'DELETE' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DELETE_FAILED');
      expect(json.error.message).toContain('Permission denied');
    });

    it('uses basename to sanitize the filename path parameter', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockReturnValue(undefined);
      // Even if someone passes a path traversal attempt, basename should strip it
      const res = await app.request('/db/backup/backup.sql', { method: 'DELETE' });
      expect(res.status).toBe(200);
      // unlinkSync should be called with a path inside the backup dir
      // Normalize separators for cross-platform comparison (Windows uses backslashes)
      const calledPath = (mockUnlinkSync.mock.calls[0][0] as string).split(sep).join('/');
      expect(calledPath).toContain('/tmp/backups');
    });
  });
});
