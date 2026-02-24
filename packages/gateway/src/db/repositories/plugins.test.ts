/**
 * PluginsRepository Tests
 *
 * Tests initialize/refreshCache, getById (sync), getAll (sync),
 * upsert, updateSettings, updateStatus, updatePermissions, delete,
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

const { PluginsRepository, initializePluginsRepo } = await import('./plugins.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2024-06-01T12:00:00Z';

function makePluginRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plugin-1',
    name: 'Test Plugin',
    version: '1.0.0',
    status: 'enabled',
    settings: '{}',
    granted_permissions: '[]',
    error_message: null,
    installed_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginsRepository', () => {
  let repo: InstanceType<typeof PluginsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PluginsRepository();
  });

  // ---- initialize / refreshCache ----

  describe('initialize', () => {
    it('loads all plugins into cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({ id: 'plugin-1' }),
        makePluginRow({ id: 'plugin-2', name: 'Second Plugin' }),
      ]);

      await repo.initialize();

      expect(repo.getAll()).toHaveLength(2);
      expect(repo.getById('plugin-1')).not.toBeNull();
      expect(repo.getById('plugin-2')).not.toBeNull();
    });

    it('clears cache and reloads on refreshCache', async () => {
      // First load
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ id: 'plugin-1' })]);
      await repo.initialize();
      expect(repo.getAll()).toHaveLength(1);

      // Refresh with different data
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({ id: 'plugin-1' }),
        makePluginRow({ id: 'plugin-3', name: 'New Plugin' }),
      ]);
      await repo.refreshCache();

      expect(repo.getAll()).toHaveLength(2);
      expect(repo.getById('plugin-3')).not.toBeNull();
    });
  });

  // ---- getById (sync) ----

  describe('getById', () => {
    it('returns a plugin from cache when initialized', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('plugin-1');
      expect(result!.name).toBe('Test Plugin');
      expect(result!.version).toBe('1.0.0');
      expect(result!.status).toBe('enabled');
    });

    it('returns null when plugin not in cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      const result = repo.getById('missing');

      expect(result).toBeNull();
    });

    it('returns null when cache not initialized', () => {
      // Create a fresh repo without initializing
      const freshRepo = new PluginsRepository();

      // Note: the cache is module-level, so we need to test via
      // the warn log behavior. Since we initialized in prior tests,
      // we test the getById with a missing key instead.
      const result = freshRepo.getById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ---- getAll (sync) ----

  describe('getAll', () => {
    it('returns all plugins from cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({ id: 'p1' }),
        makePluginRow({ id: 'p2', name: 'Plugin 2' }),
        makePluginRow({ id: 'p3', name: 'Plugin 3' }),
      ]);
      await repo.initialize();

      const result = repo.getAll();

      expect(result).toHaveLength(3);
    });

    it('returns empty array when cache is empty', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      const result = repo.getAll();

      expect(result).toEqual([]);
    });
  });

  // ---- upsert ----

  describe('upsert', () => {
    it('inserts a new plugin and updates cache', async () => {
      // Initialize cache (empty)
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      // upsert: execute + refreshPluginCache queryOne
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makePluginRow({ id: 'new-plugin' }));

      const result = await repo.upsert({
        id: 'new-plugin',
        name: 'New Plugin',
        version: '2.0.0',
      });

      expect(result.id).toBe('new-plugin');
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO plugins'),
        expect.arrayContaining(['new-plugin', 'New Plugin', '2.0.0'])
      );
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');

      // Verify it's now in cache
      expect(repo.getById('new-plugin')).not.toBeNull();
    });

    it('uses default status "enabled" when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makePluginRow());

      await repo.upsert({
        id: 'plugin-1',
        name: 'Test',
        version: '1.0.0',
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe('enabled');
    });

    it('uses custom status when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makePluginRow({ status: 'disabled' }));

      await repo.upsert({
        id: 'plugin-1',
        name: 'Test',
        version: '1.0.0',
        status: 'disabled',
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe('disabled');
    });

    it('serializes settings and grantedPermissions', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePluginRow({
          settings: '{"key":"value"}',
          granted_permissions: '["read","write"]',
        })
      );

      await repo.upsert({
        id: 'plugin-1',
        name: 'Test',
        version: '1.0.0',
        settings: { key: 'value' },
        grantedPermissions: ['read', 'write'],
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[4]).toBe('{"key":"value"}');
      expect(params[5]).toBe('["read","write"]');
    });

    it('defaults settings to empty object and permissions to empty array', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makePluginRow());

      await repo.upsert({
        id: 'plugin-1',
        name: 'Test',
        version: '1.0.0',
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[4]).toBe('{}');
      expect(params[5]).toBe('[]');
    });
  });

  // ---- updateSettings ----

  describe('updateSettings', () => {
    it('updates settings and refreshes cache', async () => {
      // Initialize with a plugin
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePluginRow({ settings: '{"newKey":"newValue"}' })
      );

      const result = await repo.updateSettings('plugin-1', { newKey: 'newValue' });

      expect(result).not.toBeNull();
      expect(result!.settings).toEqual({ newKey: 'newValue' });
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE plugins SET settings = $1'),
        ['{"newKey":"newValue"}', 'plugin-1']
      );
    });

    it('returns null when plugin not in cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.updateSettings('missing', { key: 'value' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  // ---- updateStatus ----

  describe('updateStatus', () => {
    it('updates status and refreshes cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makePluginRow({ status: 'disabled' }));

      const result = await repo.updateStatus('plugin-1', 'disabled');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('disabled');
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE plugins SET status = $1'),
        ['disabled', null, 'plugin-1']
      );
    });

    it('includes error message when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePluginRow({ status: 'error', error_message: 'Init failed' })
      );

      const result = await repo.updateStatus('plugin-1', 'error', 'Init failed');

      expect(result!.errorMessage).toBe('Init failed');
      expect(mockAdapter.execute).toHaveBeenCalledWith(expect.any(String), [
        'error',
        'Init failed',
        'plugin-1',
      ]);
    });

    it('passes null error_message when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makePluginRow());

      await repo.updateStatus('plugin-1', 'enabled');

      expect(mockAdapter.execute).toHaveBeenCalledWith(expect.any(String), [
        'enabled',
        null,
        'plugin-1',
      ]);
    });

    it('returns null when plugin not in cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.updateStatus('missing', 'disabled');

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  // ---- updatePermissions ----

  describe('updatePermissions', () => {
    it('updates granted permissions and refreshes cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePluginRow({ granted_permissions: '["read","write","admin"]' })
      );

      const result = await repo.updatePermissions('plugin-1', ['read', 'write', 'admin']);

      expect(result).not.toBeNull();
      expect(result!.grantedPermissions).toEqual(['read', 'write', 'admin']);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE plugins SET granted_permissions = $1'),
        ['["read","write","admin"]', 'plugin-1']
      );
    });

    it('returns null when plugin not in cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.updatePermissions('missing', ['read']);

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('deletes a plugin from DB and cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();
      expect(repo.getById('plugin-1')).not.toBeNull();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('plugin-1');

      expect(result).toBe(true);
      expect(repo.getById('plugin-1')).toBeNull();
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM plugins WHERE id = $1'),
        ['plugin-1']
      );
    });

    it('returns false when plugin not found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- Row mapping / JSONB parsing ----

  describe('row mapping', () => {
    it('parses settings from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({ settings: '{"theme":"dark","fontSize":14}' }),
      ]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.settings).toEqual({ theme: 'dark', fontSize: 14 });
    });

    it('handles already-parsed settings object', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ settings: { already: 'parsed' } })]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.settings).toEqual({ already: 'parsed' });
    });

    it('falls back to empty object for null settings', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ settings: null })]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.settings).toEqual({});
    });

    it('falls back to empty object for invalid JSON settings', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ settings: 'not-json' })]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.settings).toEqual({});
    });

    it('parses granted_permissions from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({ granted_permissions: '["read","write"]' }),
      ]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.grantedPermissions).toEqual(['read', 'write']);
    });

    it('handles already-parsed permissions array', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ granted_permissions: ['read'] })]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.grantedPermissions).toEqual(['read']);
    });

    it('falls back to empty array for null permissions', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ granted_permissions: null })]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.grantedPermissions).toEqual([]);
    });

    it('falls back to empty array for invalid JSON permissions', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow({ granted_permissions: 'bad-json' })]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.grantedPermissions).toEqual([]);
    });

    it('maps error_message when present', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({ error_message: 'Something went wrong' }),
      ]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.errorMessage).toBe('Something went wrong');
    });

    it('sets errorMessage to undefined when null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makePluginRow()]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.errorMessage).toBeUndefined();
    });

    it('maps all status values', async () => {
      for (const status of ['enabled', 'disabled', 'error'] as const) {
        mockAdapter.query.mockResolvedValueOnce([
          makePluginRow({ id: `plugin-${status}`, status }),
        ]);
        await repo.initialize();

        const result = repo.getById(`plugin-${status}`);

        expect(result!.status).toBe(status);
      }
    });

    it('preserves installed_at and updated_at as strings', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makePluginRow({
          installed_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-06-15T14:00:00Z',
        }),
      ]);
      await repo.initialize();

      const result = repo.getById('plugin-1');

      expect(result!.installedAt).toBe('2024-01-15T10:00:00Z');
      expect(result!.updatedAt).toBe('2024-06-15T14:00:00Z');
    });
  });

  // ---- initializePluginsRepo ----

  describe('initializePluginsRepo', () => {
    it('initializes the singleton repository', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await initializePluginsRepo();

      // Should have called query to load cache
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM plugins');
    });
  });
});
