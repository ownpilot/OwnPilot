/**
 * EmbeddingCacheRepository Tests
 *
 * Tests for content hashing, lookup, store, evict, getStats,
 * parseEmbedding, and the singleton export.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
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

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('../../services/log.js', () => ({
  getLog: () => mockLog,
}));

vi.mock('../../config/defaults.js', () => ({
  EMBEDDING_CACHE_EVICTION_DAYS: 30,
}));

const { EmbeddingCacheRepository, embeddingCacheRepo } = await import('./embedding-cache.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingCacheRepository', () => {
  let repo: InstanceType<typeof EmbeddingCacheRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EmbeddingCacheRepository();
  });

  // contentHash (static)
  describe('contentHash', () => {
    it('produces consistent hash for same content', () => {
      const hash1 = EmbeddingCacheRepository.contentHash('hello world');
      const hash2 = EmbeddingCacheRepository.contentHash('hello world');
      expect(hash1).toBe(hash2);
    });

    it('is case-insensitive', () => {
      const lower = EmbeddingCacheRepository.contentHash('Hello World');
      const upper = EmbeddingCacheRepository.contentHash('hello world');
      expect(lower).toBe(upper);
    });

    it('trims whitespace', () => {
      const trimmed = EmbeddingCacheRepository.contentHash('hello');
      const padded = EmbeddingCacheRepository.contentHash('  hello  ');
      expect(trimmed).toBe(padded);
    });

    it('produces different hashes for different content', () => {
      const hash1 = EmbeddingCacheRepository.contentHash('hello');
      const hash2 = EmbeddingCacheRepository.contentHash('world');
      expect(hash1).not.toBe(hash2);
    });

    it('produces a 64-char hex string (SHA-256)', () => {
      const hash = EmbeddingCacheRepository.contentHash('test');
      expect(hash).toMatch(/^[a-f0-9]{64}/);
    });
  });

  // lookup
  describe('lookup', () => {
    it('returns null on cache miss', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.lookup('hash123');
      expect(result).toBeNull();
      const [sql, params] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('SELECT * FROM embedding_cache');
      expect(sql).toContain('WHERE content_hash = $1 AND model_name = $2');
      expect(params).toEqual(['hash123', 'text-embedding-3-small']);
    });

    it('uses default model name when not specified', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      await repo.lookup('hash123');
      const params = mockAdapter.queryOne.mock.calls[0][1];
      expect(params[1]).toBe('text-embedding-3-small');
    });

    it('accepts a custom model name', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      await repo.lookup('hash123', 'text-embedding-ada-002');
      const params = mockAdapter.queryOne.mock.calls[0][1];
      expect(params[1]).toBe('text-embedding-ada-002');
    });

    it('returns parsed embedding array on cache hit (string)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: 'ec-1',
        content_hash: 'hash123',
        model_name: 'text-embedding-3-small',
        embedding: JSON.stringify([0.1, 0.2, 0.3]),
        created_at: '2025-01-01T00:00:00Z',
        last_used_at: '2025-01-01T00:00:00Z',
        use_count: 5,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.lookup('hash123');
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('returns embedding array directly when already parsed (array)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: 'ec-1',
        content_hash: 'hash123',
        model_name: 'text-embedding-3-small',
        embedding: [0.4, 0.5, 0.6],
        created_at: '2025-01-01T00:00:00Z',
        last_used_at: '2025-01-01T00:00:00Z',
        use_count: 3,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.lookup('hash123');
      expect(result).toEqual([0.4, 0.5, 0.6]);
    });

    it('fires touch UPDATE on cache hit (fire-and-forget)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: 'ec-1',
        content_hash: 'hash123',
        model_name: 'text-embedding-3-small',
        embedding: [1.0],
        created_at: '2025-01-01T00:00:00Z',
        last_used_at: '2025-01-01T00:00:00Z',
        use_count: 1,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      await repo.lookup('hash123');
      await new Promise((r) => setTimeout(r, 10));
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('UPDATE embedding_cache');
      expect(sql).toContain('SET last_used_at = NOW()');
      expect(sql).toContain('use_count = use_count + 1');
      expect(params).toEqual(['ec-1']);
    });

    it('does not throw if touch UPDATE fails (fire-and-forget catch)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: 'ec-1',
        content_hash: 'hash123',
        model_name: 'text-embedding-3-small',
        embedding: [1.0],
        created_at: '2025-01-01T00:00:00Z',
        last_used_at: '2025-01-01T00:00:00Z',
        use_count: 1,
      });
      mockAdapter.execute.mockRejectedValueOnce(new Error('DB error'));
      const result = await repo.lookup('hash123');
      expect(result).toEqual([1.0]);
      await new Promise((r) => setTimeout(r, 10));
    });

    it('returns null for invalid JSON embedding string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: 'ec-1',
        content_hash: 'hash123',
        model_name: 'text-embedding-3-small',
        embedding: 'not-valid-json{',
        created_at: '2025-01-01T00:00:00Z',
        last_used_at: '2025-01-01T00:00:00Z',
        use_count: 1,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.lookup('hash123');
      expect(result).toBeNull();
    });

    it('returns null for non-string non-array embedding value', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: 'ec-1',
        content_hash: 'hash123',
        model_name: 'text-embedding-3-small',
        embedding: 42,
        created_at: '2025-01-01T00:00:00Z',
        last_used_at: '2025-01-01T00:00:00Z',
        use_count: 1,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.lookup('hash123');
      expect(result).toBeNull();
    });
  });

  // store
  describe('store', () => {
    it('inserts a new embedding with ON CONFLICT upsert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      await repo.store('hash456', 'text-embedding-3-small', [0.1, 0.2, 0.3]);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO embedding_cache');
      expect(sql).toContain('::vector');
      expect(sql).toContain('ON CONFLICT (content_hash, model_name) DO UPDATE SET');
      expect(sql).toContain('last_used_at = NOW()');
      expect(sql).toContain('use_count = embedding_cache.use_count + 1');
      expect(params[1]).toBe('hash456');
      expect(params[2]).toBe('text-embedding-3-small');
      expect(JSON.parse(params[3] as string)).toEqual([0.1, 0.2, 0.3]);
    });

    it('generates a UUID for the id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      await repo.store('hash789', 'model-x', [1.0]);
      const params = mockAdapter.execute.mock.calls[0][1];
      expect(params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    });
  });

  // evict
  describe('evict', () => {
    it('deletes stale entries using default eviction days', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 });
      const evicted = await repo.evict();
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('DELETE FROM embedding_cache');
      expect(sql).toContain('last_used_at');
      expect(params).toEqual([30]);
      expect(evicted).toBe(5);
    });

    it('accepts custom daysUnused parameter', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });
      const evicted = await repo.evict(7);
      const params = mockAdapter.execute.mock.calls[0][1];
      expect(params).toEqual([7]);
      expect(evicted).toBe(3);
    });

    it('logs info when entries are evicted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 10 });
      await repo.evict();
      expect(mockLog.info).toHaveBeenCalledWith('Evicted 10 stale embedding cache entries');
    });

    it('does not log when nothing is evicted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      await repo.evict();
      expect(mockLog.info).not.toHaveBeenCalled();
    });

    it('returns 0 when nothing to evict', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      const evicted = await repo.evict(90);
      expect(evicted).toBe(0);
    });
  });

  // getStats
  describe('getStats', () => {
    it('returns total and totalHits from aggregate query', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total: '150',
        total_hits: '3200',
      });
      const stats = await repo.getStats();
      const [sql] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('SUM(use_count)');
      expect(sql).toContain('FROM embedding_cache');
      expect(stats).toEqual({ total: 150, totalHits: 3200 });
    });

    it('handles null queryOne result', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const stats = await repo.getStats();
      expect(stats).toEqual({ total: 0, totalHits: 0 });
    });

    it('handles zero values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: '0', total_hits: '0' });
      const stats = await repo.getStats();
      expect(stats).toEqual({ total: 0, totalHits: 0 });
    });
  });

  // Singleton export
  describe('embeddingCacheRepo singleton', () => {
    it('is an instance of EmbeddingCacheRepository', () => {
      expect(embeddingCacheRepo).toBeInstanceOf(EmbeddingCacheRepository);
    });
  });
});
