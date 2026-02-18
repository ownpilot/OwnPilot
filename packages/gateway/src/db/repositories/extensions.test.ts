/**
 * ExtensionsRepository Tests
 *
 * Tests initialize/refreshCache, getById (sync), getAll (sync),
 * getEnabled (sync), upsert, updateStatus, updateSettings, delete,
 * and JSONB parsing edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { ExtensionsRepository, initializeExtensionsRepo } = await import('./extensions.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00.000Z';

const sampleManifest = {
  id: 'test-ext',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension',
  tools: [
    {
      name: 'test_tool',
      description: 'Test tool',
      parameters: { type: 'object', properties: {}, required: [] },
      code: 'return { content: {} };',
    },
  ],
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-ext',
    user_id: 'default',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension',
    category: 'utilities',
    icon: null,
    author_name: null,
    manifest: JSON.stringify(sampleManifest),
    status: 'enabled',
    source_path: null,
    settings: '{}',
    error_message: null,
    tool_count: 1,
    trigger_count: 0,
    installed_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtensionsRepository', () => {
  let repo: InstanceType<typeof ExtensionsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ExtensionsRepository();
  });

  // ========================================================================
  // Initialization
  // ========================================================================

  describe('initialize / refreshCache', () => {
    it('loads all rows into cache', async () => {
      const row1 = makeRow({ id: 'ext-a' });
      const row2 = makeRow({ id: 'ext-b', status: 'disabled' });
      mockAdapter.query.mockResolvedValue([row1, row2]);

      await repo.initialize();

      expect(repo.getAll()).toHaveLength(2);
      expect(repo.getById('ext-a')).toBeTruthy();
      expect(repo.getById('ext-b')).toBeTruthy();
    });

    it('clears cache on re-initialize', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();
      expect(repo.getAll()).toHaveLength(1);

      mockAdapter.query.mockResolvedValue([]);
      await repo.initialize();
      expect(repo.getAll()).toHaveLength(0);
    });
  });

  // ========================================================================
  // Sync accessors
  // ========================================================================

  describe('getById', () => {
    it('returns record from cache', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();

      const record = repo.getById('test-ext');
      expect(record).not.toBeNull();
      expect(record!.id).toBe('test-ext');
      expect(record!.name).toBe('Test Extension');
      expect(record!.status).toBe('enabled');
    });

    it('returns null for unknown id', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();

      expect(repo.getById('unknown')).toBeNull();
    });

    // Note: "cache not initialized" case can't be tested because
    // the module-level cache persists across test instances.
  });

  describe('getAll', () => {
    it('returns all records', async () => {
      mockAdapter.query.mockResolvedValue([
        makeRow({ id: 'a' }),
        makeRow({ id: 'b' }),
        makeRow({ id: 'c' }),
      ]);
      await repo.initialize();

      expect(repo.getAll()).toHaveLength(3);
    });

    // Note: "cache not initialized" case can't be tested because
    // the module-level cache persists across test instances.
  });

  describe('getEnabled', () => {
    it('returns only enabled packages', async () => {
      mockAdapter.query.mockResolvedValue([
        makeRow({ id: 'a', status: 'enabled' }),
        makeRow({ id: 'b', status: 'disabled' }),
        makeRow({ id: 'c', status: 'enabled' }),
        makeRow({ id: 'd', status: 'error' }),
      ]);
      await repo.initialize();

      const enabled = repo.getEnabled();
      expect(enabled).toHaveLength(2);
      expect(enabled.map(p => p.id).sort()).toEqual(['a', 'c']);
    });
  });

  // ========================================================================
  // CRUD operations
  // ========================================================================

  describe('upsert', () => {
    it('inserts a new record and refreshes cache', async () => {
      const row = makeRow();
      mockAdapter.query.mockResolvedValue([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(row);

      const result = await repo.upsert({
        id: 'test-ext',
        userId: 'default',
        name: 'Test Extension',
        version: '1.0.0',
        description: 'A test extension',
        category: 'utilities',
        manifest: sampleManifest as never,
        toolCount: 1,
        triggerCount: 0,
      });

      expect(result.id).toBe('test-ext');
      expect(mockAdapter.execute).toHaveBeenCalled();
      expect(repo.getById('test-ext')).not.toBeNull();
    });

    it('uses defaults for optional fields', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(makeRow());

      await repo.upsert({
        id: 'test-ext',
        name: 'Test Extension',
        version: '1.0.0',
        manifest: sampleManifest as never,
      });

      // Check that execute was called with default userId ('default'), category ('other'), etc.
      const args = mockAdapter.execute.mock.calls[0][1];
      expect(args[1]).toBe('default'); // userId
      expect(args[5]).toBe('other');   // category (default)
    });
  });

  describe('updateStatus', () => {
    it('updates status and refreshes cache', async () => {
      mockAdapter.query.mockResolvedValue([makeRow({ status: 'enabled' })]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(makeRow({ status: 'disabled' }));

      const result = await repo.updateStatus('test-ext', 'disabled');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('disabled');
    });

    it('updates with error message', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(makeRow({ status: 'error', error_message: 'Something broke' }));

      const result = await repo.updateStatus('test-ext', 'error', 'Something broke');
      expect(result!.status).toBe('error');
      expect(result!.errorMessage).toBe('Something broke');
    });

    it('returns null for unknown id', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.initialize();

      const result = await repo.updateStatus('unknown', 'disabled');
      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('updates settings JSON', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(makeRow({ settings: '{"key":"value"}' }));

      const result = await repo.updateSettings('test-ext', { key: 'value' });
      expect(result).not.toBeNull();
      expect(result!.settings).toEqual({ key: 'value' });
    });

    it('returns null for unknown id', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.initialize();

      const result = await repo.updateSettings('unknown', { key: 'value' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes from DB and cache', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();
      expect(repo.getById('test-ext')).not.toBeNull();

      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const deleted = await repo.delete('test-ext');
      expect(deleted).toBe(true);
      expect(repo.getById('test-ext')).toBeNull();
    });

    it('returns false when record does not exist', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const deleted = await repo.delete('unknown');
      expect(deleted).toBe(false);
    });
  });

  // ========================================================================
  // JSONB parsing edge cases
  // ========================================================================

  describe('JSONB parsing', () => {
    it('handles manifest as string', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await repo.initialize();

      const record = repo.getById('test-ext');
      expect(record!.manifest.id).toBe('test-ext');
      expect(record!.manifest.tools).toHaveLength(1);
    });

    it('handles manifest as parsed object (PostgreSQL)', async () => {
      mockAdapter.query.mockResolvedValue([
        makeRow({ manifest: sampleManifest }),
      ]);
      await repo.initialize();

      const record = repo.getById('test-ext');
      expect(record!.manifest.id).toBe('test-ext');
    });

    it('handles null optional fields', async () => {
      mockAdapter.query.mockResolvedValue([makeRow({
        description: null,
        icon: null,
        author_name: null,
        source_path: null,
        error_message: null,
      })]);
      await repo.initialize();

      const record = repo.getById('test-ext');
      expect(record!.description).toBeUndefined();
      expect(record!.icon).toBeUndefined();
      expect(record!.authorName).toBeUndefined();
      expect(record!.sourcePath).toBeUndefined();
      expect(record!.errorMessage).toBeUndefined();
    });

    it('handles invalid manifest JSON gracefully', async () => {
      mockAdapter.query.mockResolvedValue([
        makeRow({ manifest: 'not json' }),
      ]);
      await repo.initialize();

      const record = repo.getById('test-ext');
      // Falls back to default empty manifest
      expect(record!.manifest.id).toBe('');
      expect(record!.manifest.tools).toHaveLength(0);
    });

    it('handles settings as parsed object', async () => {
      mockAdapter.query.mockResolvedValue([
        makeRow({ settings: { foo: 'bar' } }),
      ]);
      await repo.initialize();

      const record = repo.getById('test-ext');
      expect(record!.settings).toEqual({ foo: 'bar' });
    });
  });

  // ========================================================================
  // initializeExtensionsRepo
  // ========================================================================

  describe('initializeExtensionsRepo', () => {
    it('initializes the singleton repo', async () => {
      mockAdapter.query.mockResolvedValue([makeRow()]);
      await initializeExtensionsRepo();
      // No error = success (singleton is already initialized)
    });
  });
});
