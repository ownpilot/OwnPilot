/**
 * Settings Repository Tests
 *
 * Unit tests for SettingsRepository key-value operations, caching,
 * prefix filtering, and JSON serialization/deserialization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { SettingsRepository } from './settings.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeSettingRow(overrides: Record<string, unknown> = {}) {
  return {
    key: 'app.theme',
    value: '"dark"',
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsRepository', () => {
  let repo: SettingsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new SettingsRepository();
  });

  // =========================================================================
  // initialize
  // =========================================================================

  describe('initialize', () => {
    it('should call ensureTable and load cache', async () => {
      // ensureTable calls getAdapter internally -> queryOne for table check
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      // loadCache calls query to get all settings
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.theme', value: '"dark"' }),
        makeSettingRow({ key: 'app.lang', value: '"en"' }),
      ]);

      await repo.initialize();

      // After initialize, sync get should work
      expect(repo.get('app.theme')).toBe('dark');
      expect(repo.get('app.lang')).toBe('en');
    });

    it('should handle empty settings table', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.initialize();

      expect(repo.get('any.key')).toBeNull();
    });
  });

  // =========================================================================
  // get (sync, cache-based)
  // =========================================================================

  describe('get', () => {
    it('should return cached value after initialization', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'ui.mode', value: '"compact"' }),
      ]);

      await repo.initialize();

      expect(repo.get('ui.mode')).toBe('compact');
    });

    it('should return null for non-existent key (after cache is loaded)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.initialize();

      expect(repo.get('nonexistent')).toBeNull();
    });

    it('should handle complex object values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.config', value: '{"theme":"dark","fontSize":14}' }),
      ]);

      await repo.initialize();

      const result = repo.get<{ theme: string; fontSize: number }>('app.config');
      expect(result).toEqual({ theme: 'dark', fontSize: 14 });
    });

    it('should handle array values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.tags', value: '["a","b","c"]' }),
      ]);

      await repo.initialize();

      expect(repo.get<string[]>('app.tags')).toEqual(['a', 'b', 'c']);
    });

    it('should handle numeric values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.port', value: '3000' }),
      ]);

      await repo.initialize();

      expect(repo.get<number>('app.port')).toBe(3000);
    });

    it('should handle boolean values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.debug', value: 'true' }),
      ]);

      await repo.initialize();

      expect(repo.get<boolean>('app.debug')).toBe(true);
    });
  });

  // =========================================================================
  // getAsync
  // =========================================================================

  describe('getAsync', () => {
    it('should return value from database', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingRow({ value: '"dark"' }));

      const result = await repo.getAsync('app.theme');

      expect(result).toBe('dark');
    });

    it('should return null when key not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getAsync('missing')).toBeNull();
    });

    it('should parse complex JSON values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSettingRow({ value: '{"nested":{"key":"value"}}' }),
      );

      const result = await repo.getAsync<{ nested: { key: string } }>('complex');

      expect(result).toEqual({ nested: { key: 'value' } });
    });

    it('should query with WHERE key = $1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getAsync('some.key');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE key = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['some.key']);
    });

    it('should return raw string for corrupt JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSettingRow({ value: '{not valid json' }),
      );

      const result = await repo.getAsync('corrupt');

      expect(result).toBe('{not valid json');
    });
  });

  // =========================================================================
  // set
  // =========================================================================

  describe('set', () => {
    it('should insert/upsert setting value', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('app.theme', 'dark');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO settings');
      expect(sql).toContain('ON CONFLICT');
    });

    it('should serialize value as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('app.config', { theme: 'dark', fontSize: 14 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('app.config');
      expect(params[1]).toBe('{"theme":"dark","fontSize":14}');
    });

    it('should serialize string values as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('app.name', 'OwnPilot');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('"OwnPilot"');
    });

    it('should serialize numeric values as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('app.port', 3000);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('3000');
    });

    it('should serialize array values as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('app.tags', ['a', 'b']);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('["a","b"]');
    });

    it('should update the in-memory cache', async () => {
      // Initialize cache first
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('new.key', 'new-value');

      // Sync get should return the cached value
      expect(repo.get('new.key')).toBe('new-value');
    });

    it('should handle null value', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.set('nullable', null);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('null');
    });
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('should return all settings mapped correctly', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.theme', value: '"dark"' }),
        makeSettingRow({ key: 'app.lang', value: '"en"' }),
      ]);

      const result = await repo.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]!.key).toBe('app.theme');
      expect(result[0]!.value).toBe('dark');
      expect(result[1]!.key).toBe('app.lang');
      expect(result[1]!.value).toBe('en');
    });

    it('should parse updatedAt as Date', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeSettingRow()]);

      const result = await repo.getAll();

      expect(result[0]!.updatedAt).toBeInstanceOf(Date);
    });

    it('should return empty array when no settings', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getAll()).toEqual([]);
    });

    it('should order by key ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY key ASC');
    });
  });

  // =========================================================================
  // getByPrefix
  // =========================================================================

  describe('getByPrefix', () => {
    it('should return settings matching the prefix', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.theme', value: '"dark"' }),
        makeSettingRow({ key: 'app.lang', value: '"en"' }),
      ]);

      const result = await repo.getByPrefix('app.');

      expect(result).toHaveLength(2);
    });

    it('should use LIKE with prefix%', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByPrefix('notifications.');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE key LIKE $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['notifications.%']);
    });

    it('should order by key ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByPrefix('app.');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY key ASC');
    });

    it('should return empty array for non-matching prefix', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getByPrefix('unknown.')).toEqual([]);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('app.theme')).toBe(true);
    });

    it('should return false when key not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should remove key from cache', async () => {
      // Initialize cache with a key
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'to.delete', value: '"x"' }),
      ]);
      await repo.initialize();

      expect(repo.get('to.delete')).toBe('x');

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      await repo.delete('to.delete');

      expect(repo.get('to.delete')).toBeNull();
    });

    it('should query with WHERE key = $1', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('app.theme');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM settings WHERE key = $1');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['app.theme']);
    });
  });

  // =========================================================================
  // deleteByPrefix
  // =========================================================================

  describe('deleteByPrefix', () => {
    it('should return count of deleted rows', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      expect(await repo.deleteByPrefix('app.')).toBe(3);
    });

    it('should return 0 when no matching keys', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.deleteByPrefix('unknown.')).toBe(0);
    });

    it('should remove matching keys from cache', async () => {
      // Initialize cache
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });
      mockAdapter.query.mockResolvedValueOnce([
        makeSettingRow({ key: 'app.theme', value: '"dark"' }),
        makeSettingRow({ key: 'app.lang', value: '"en"' }),
        makeSettingRow({ key: 'other.key', value: '"val"' }),
      ]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });
      await repo.deleteByPrefix('app.');

      expect(repo.get('app.theme')).toBeNull();
      expect(repo.get('app.lang')).toBeNull();
      expect(repo.get('other.key')).toBe('val');
    });

    it('should use LIKE with prefix%', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.deleteByPrefix('notifications.');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM settings WHERE key LIKE $1');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['notifications.%']);
    });
  });

  // =========================================================================
  // has
  // =========================================================================

  describe('has', () => {
    it('should return true when key exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });

      expect(await repo.has('app.theme')).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.has('missing')).toBe(false);
    });

    it('should return false when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.has('missing')).toBe(false);
    });

    it('should query with WHERE key = $1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.has('app.theme');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('WHERE key = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['app.theme']);
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '15' });

      expect(await repo.count()).toBe(15);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should return 0 for empty table', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.count()).toBe(0);
    });

    it('should query COUNT(*) from settings', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('settings');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createSettingsRepository', () => {
    it('should be importable and return a SettingsRepository instance', async () => {
      const { createSettingsRepository } = await import('./settings.js');
      const r = createSettingsRepository();
      expect(r).toBeInstanceOf(SettingsRepository);
    });
  });

  describe('settingsRepo', () => {
    it('should export a singleton instance', async () => {
      const { settingsRepo } = await import('./settings.js');
      expect(settingsRepo).toBeInstanceOf(SettingsRepository);
    });
  });
});
