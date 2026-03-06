/**
 * SystemSettingsRepository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { getSystemSettingsRepository } = await import('./system-settings.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SystemSettingsRepository', () => {
  let repo: ReturnType<typeof getSystemSettingsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = getSystemSettingsRepository();
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('returns the value when key exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ key: 'pairing_key', value: 'abc123' });
      const result = await repo.get('pairing_key');
      expect(result).toBe('abc123');
    });

    it('returns null when key does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.get('missing_key');
      expect(result).toBeNull();
    });

    it('returns null when value is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ key: 'some_key', value: null });
      const result = await repo.get('some_key');
      expect(result).toBeNull();
    });

    it('queries with correct SQL and param', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ key: 'k', value: 'v' });
      await repo.get('my_key');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('system_settings');
      expect(sql).toContain('WHERE key = $1');
      expect(params).toEqual(['my_key']);
    });
  });

  // =========================================================================
  // set
  // =========================================================================

  describe('set', () => {
    it('inserts or updates the key-value pair', async () => {
      await repo.set('pairing_key', 'secret-token');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO system_settings');
      expect(sql).toContain('ON CONFLICT');
      expect(params).toContain('pairing_key');
      expect(params).toContain('secret-token');
    });

    it('stores different values for different keys', async () => {
      await repo.set('key1', 'val1');
      await repo.set('key2', 'val2');
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('deletes the key', async () => {
      await repo.delete('old_key');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM system_settings');
      expect(params).toContain('old_key');
    });
  });

  // =========================================================================
  // singleton
  // =========================================================================

  it('getSystemSettingsRepository returns same instance on repeated calls', () => {
    const r1 = getSystemSettingsRepository();
    const r2 = getSystemSettingsRepository();
    expect(r1).toBe(r2);
  });
});
