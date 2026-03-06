/**
 * Database Schema Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { EventEmitter } from 'events';

// Mocks
const mockExistsSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, existsSync: (...args: unknown[]) => mockExistsSync(...args) };
});

vi.mock('../../paths/index.js', () => ({
  getDatabasePath: vi.fn(() => '/tmp/ownpilot.db'),
}));

const mockIsConnected = vi.fn();
const mockExec = vi.fn();
const mockGetAdapterSync = vi.fn();

vi.mock('../../db/adapters/index.js', () => ({
  getAdapterSync: () => mockGetAdapterSync(),
}));

const mockInitializeSchema = vi.fn();
vi.mock('../../db/schema.js', () => ({
  initializeSchema: (...args: unknown[]) => mockInitializeSchema(...args),
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

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
}));

import { schemaRoutes } from './schema.js';

function createApp() {
  const app = new Hono();
  app.route('/db', schemaRoutes);
  return app;
}

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('Schema Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    testOperationStatus = { isRunning: false };

    mockGetAdapterSync.mockReturnValue({
      isConnected: mockIsConnected,
      exec: mockExec,
    });
    mockIsConnected.mockReturnValue(true);
    mockExec.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockInitializeSchema.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  // POST /db/migrate-schema
  // ---------------------------------------------------------------------------
  describe('POST /db/migrate-schema', () => {
    it('returns 409 when an operation is already running', async () => {
      testOperationStatus = { isRunning: true, operation: 'backup' };

      const res = await app.request('/db/migrate-schema', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('OPERATION_IN_PROGRESS');
      expect(json.error.message).toContain('backup');
    });

    it('returns 400 when database adapter is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await app.request('/db/migrate-schema', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('MIGRATION_FAILED');
    });

    it('returns 500 when adapter throws on getAdapterSync', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('Adapter not initialized');
      });

      const res = await app.request('/db/migrate-schema', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('MIGRATION_FAILED');
    });

    it('runs schema migration successfully and returns output', async () => {
      mockInitializeSchema.mockResolvedValue(undefined);

      const res = await app.request('/db/migrate-schema', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Schema migrations completed successfully');
      expect(json.data.output).toContain('Schema migrations completed successfully');
      expect(mockSetOperationStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isRunning: true, operation: 'migrate' })
      );
    });

    it('calls initializeSchema with an exec function', async () => {
      await app.request('/db/migrate-schema', { method: 'POST' });

      expect(mockInitializeSchema).toHaveBeenCalledWith(expect.any(Function));
    });

    it('returns 500 and updates operation status on schema migration failure', async () => {
      mockInitializeSchema.mockRejectedValue(new Error('Schema error'));

      const res = await app.request('/db/migrate-schema', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('MIGRATION_FAILED');
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError).toContain('Schema error');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /db/migrate
  // ---------------------------------------------------------------------------
  describe('POST /db/migrate', () => {
    it('returns 409 when an operation is already running', async () => {
      testOperationStatus = { isRunning: true, operation: 'maintenance' };

      const res = await app.request('/db/migrate', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('OPERATION_IN_PROGRESS');
    });

    it('returns 400 when PostgreSQL is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await app.request('/db/migrate', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('returns 400 when adapter throws (not connected)', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('Not initialized');
      });

      const res = await app.request('/db/migrate', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('POSTGRES_NOT_CONNECTED');
    });

    it('returns 400 when SQLite database file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const res = await app.request('/db/migrate', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('NO_LEGACY_DATA');
    });

    it('starts migration and returns 202 with running status', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const res = await app.request('/db/migrate', { method: 'POST' });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.message).toBe('Migration started');
      expect(json.data.status).toBe('running');
      expect(json.data.options.dryRun).toBe(false);
      expect(json.data.options.truncate).toBe(false);
      expect(json.data.options.skipSchema).toBe(false);
    });

    it('starts migration dry-run and returns 202 with dry-run message', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const res = await app.request('/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.message).toBe('Migration dry-run started');
      expect(json.data.options.dryRun).toBe(true);
    });

    it('passes truncate and skipSchema flags to the migration process args', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      await app.request('/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truncate: true, skipSchema: true }),
      });

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--truncate');
      expect(spawnArgs).toContain('--skip-schema');
    });

    it('handles stdout data from migration process', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/migrate', { method: 'POST' });

      proc.stdout.emit('data', Buffer.from('Migrating table messages...'));
      expect(testOperationStatus.output).toContain('Migrating table messages...');
    });

    it('handles stderr data from migration process', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/migrate', { method: 'POST' });

      proc.stderr.emit('data', Buffer.from('Warning: deprecated column'));
      expect(
        (testOperationStatus.output as string[]).some((l) => l.includes('deprecated column'))
      ).toBe(true);
    });

    it('sets lastResult success on close with code 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/migrate', { method: 'POST' });

      proc.emit('close', 0);
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('success');
    });

    it('sets lastResult failure on close with non-zero code', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/migrate', { method: 'POST' });

      proc.emit('close', 1);
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError as string).toContain('code 1');
    });

    it('sets lastResult failure on process error event', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      await app.request('/db/migrate', { method: 'POST' });

      proc.emit('error', new Error('ENOENT: npx not found'));
      expect(testOperationStatus.isRunning).toBe(false);
      expect(testOperationStatus.lastResult).toBe('failure');
      expect(testOperationStatus.lastError as string).toContain('npx not found');
    });
  });
});
