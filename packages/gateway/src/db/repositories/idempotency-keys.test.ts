/**
 * IdempotencyKeysRepository Tests
 *
 * Pins the user-scoping behavior — two users sending the same
 * `Idempotency-Key: foo` header must not see each other's cached responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { IdempotencyKeysRepository } = await import('./idempotency-keys.js');

describe('IdempotencyKeysRepository', () => {
  let repo: InstanceType<typeof IdempotencyKeysRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new IdempotencyKeysRepository();
  });

  describe('getRecord', () => {
    it('queries with userId-namespaced key', async () => {
      await repo.getRecord('alice', 'req-123');
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.stringContaining('idempotency_keys'), [
        'alice:req-123',
      ]);
    });

    it('returns the row when present', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          key: 'alice:req-123',
          result: { hello: 'world' },
          created_at: new Date('2026-01-01'),
          expires_at: new Date('2026-01-02'),
        },
      ]);
      const rec = await repo.getRecord('alice', 'req-123');
      expect(rec?.result).toEqual({ hello: 'world' });
    });

    it('returns null when the key does not exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.getRecord('alice', 'missing')).toBeNull();
    });
  });

  describe('setRecord', () => {
    it('writes with userId-namespaced key, stringified payload, and parameterised TTL', async () => {
      // CRIT-4 fix: TTL is now passed as $3 (parameterised) instead of
      // interpolated into the SQL string. The third param is the rounded ms.
      await repo.setRecord('alice', 'req-123', { foo: 1 });
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('idempotency_keys'),
        ['alice:req-123', JSON.stringify({ foo: 1 }), expect.any(Number)]
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it('alice and bob sending the same key get separate DB lookups', async () => {
      await repo.getRecord('alice', 'shared-key');
      await repo.getRecord('bob', 'shared-key');
      expect(mockAdapter.query.mock.calls[0]?.[1]).toEqual(['alice:shared-key']);
      expect(mockAdapter.query.mock.calls[1]?.[1]).toEqual(['bob:shared-key']);
    });

    it('alice cannot read bobs stored result by sending the same key', async () => {
      // Bob stored a value under his namespace
      await repo.setRecord('bob', 'shared-key', { secret: 'bob-data' });
      const bobsWriteKey = mockAdapter.execute.mock.calls[0]?.[1]?.[0];
      expect(bobsWriteKey).toBe('bob:shared-key');

      // When alice looks up the same plain key, she queries her namespace
      await repo.getRecord('alice', 'shared-key');
      const alicesReadKey = mockAdapter.query.mock.calls[0]?.[1]?.[0];
      expect(alicesReadKey).toBe('alice:shared-key');
      // The two namespaces don't collide.
      expect(alicesReadKey).not.toBe(bobsWriteKey);
    });
  });

  describe('deleteKey', () => {
    it('deletes with userId-namespaced key', async () => {
      await repo.deleteKey('alice', 'req-123');
      expect(mockAdapter.execute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'), [
        'alice:req-123',
      ]);
    });
  });
});
