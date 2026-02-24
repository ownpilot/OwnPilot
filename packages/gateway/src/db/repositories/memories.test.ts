/**
 * MemoriesRepository Tests
 *
 * Unit tests for memory CRUD, decay logic, search, cleanup,
 * type filtering, access tracking, and statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockAdapter = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
  isConnected: vi.fn(() => true),
  close: vi.fn(),
  now: vi.fn(() => 'NOW()'),
  date: vi.fn((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn((i: number) => `$${i}`),
  boolean: vi.fn((v: boolean) => v),
  parseBoolean: vi.fn((v: unknown) => Boolean(v)),
  type: 'postgres' as const,
}));

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn(async () => mockAdapter),
  getAdapterSync: vi.fn(() => mockAdapter),
}));

const mockEmit = vi.hoisted(() => vi.fn());

vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn((type: string, category: string, source: string, data: unknown) => ({
    type,
    category,
    source,
    data,
    timestamp: new Date().toISOString(),
  })),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { MemoriesRepository } from './memories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_ISO = '2025-01-15T12:00:00.000Z';

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    user_id: 'user-1',
    type: 'fact',
    content: 'The sky is blue',
    embedding: null,
    source: null,
    source_id: null,
    importance: 0.8,
    tags: '["nature"]',
    accessed_count: 0,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    accessed_at: null,
    metadata: '{}',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoriesRepository', () => {
  let repo: MemoriesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockReset();
    mockAdapter.queryOne.mockReset();
    mockAdapter.execute.mockReset();
    mockEmit.mockReset();
    repo = new MemoriesRepository('user-1');
  });

  // ==========================================================================
  // Memory CRUD
  // ==========================================================================

  describe('create', () => {
    it('inserts a memory and returns it', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      // get() after create (with trackAccess=true which calls trackAccess)
      mockAdapter.queryOne.mockResolvedValue(memoryRow());
      // trackAccess execute
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const memory = await repo.create({
        type: 'fact',
        content: 'The sky is blue',
        importance: 0.8,
        tags: ['nature'],
      });

      expect(memory.id).toBe('mem-1');
      expect(memory.type).toBe('fact');
      expect(memory.content).toBe('The sky is blue');
      expect(memory.importance).toBe(0.8);
      expect(memory.tags).toEqual(['nature']);
      expect(memory.createdAt).toBeInstanceOf(Date);
    });

    it('applies default values for optional fields', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(memoryRow());

      await repo.create({ type: 'fact', content: 'Test' });

      const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // importance defaults to 0.5
      expect(insertParams[7]).toBe(0.5);
      // tags defaults to '[]'
      expect(insertParams[8]).toBe('[]');
      // metadata defaults to '{}'
      expect(insertParams[11]).toBe('{}');
    });

    it('serializes embedding as JSON when provided', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: [0.1, 0.2, 0.3] }));

      await repo.create({
        type: 'fact',
        content: 'Test',
        embedding: [0.1, 0.2, 0.3],
      });

      const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(insertParams[4]).toBe('[0.1,0.2,0.3]');
    });

    it('emits RESOURCE_CREATED event', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(memoryRow());

      await repo.create({ type: 'fact', content: 'Test' });

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    it('throws when memory not found after insert', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(null);

      await expect(repo.create({ type: 'fact', content: 'Test' })).rejects.toThrow(
        'Failed to create memory'
      );
    });
  });

  describe('get', () => {
    it('returns mapped memory and tracks access by default', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow());
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const memory = await repo.get('mem-1');

      expect(memory).not.toBeNull();
      expect(memory!.userId).toBe('user-1');
      // trackAccess should have been called
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('accessed_at');
      expect(sql).toContain('accessed_count');
    });

    it('skips access tracking when trackAccess is false', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow());

      const memory = await repo.get('mem-1', false);

      expect(memory).not.toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const memory = await repo.get('nonexistent');
      expect(memory).toBeNull();
    });

    it('parses JSON tags and metadata', async () => {
      mockAdapter.queryOne.mockResolvedValue(
        memoryRow({ tags: '["a","b"]', metadata: '{"key":"val"}' })
      );

      const memory = await repo.get('mem-1', false);

      expect(memory!.tags).toEqual(['a', 'b']);
      expect(memory!.metadata).toEqual({ key: 'val' });
    });

    it('handles already-parsed object metadata (PostgreSQL JSONB)', async () => {
      mockAdapter.queryOne.mockResolvedValue(
        memoryRow({ tags: ['a', 'b'], metadata: { key: 'val' } })
      );

      const memory = await repo.get('mem-1', false);

      expect(memory!.tags).toEqual(['a', 'b']);
      expect(memory!.metadata).toEqual({ key: 'val' });
    });

    it('parses array embedding', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: [0.1, 0.2] }));

      const memory = await repo.get('mem-1', false);
      expect(memory!.embedding).toEqual([0.1, 0.2]);
    });

    it('parses string embedding (pgvector format)', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: '[0.1,0.2]' }));

      const memory = await repo.get('mem-1', false);
      expect(memory!.embedding).toEqual([0.1, 0.2]);
    });

    it('returns undefined embedding for null', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: null }));

      const memory = await repo.get('mem-1', false);
      expect(memory!.embedding).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('delegates to get() without access tracking', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow());

      const memory = await repo.getById('mem-1');

      expect(memory).not.toBeNull();
      // trackAccess=false so no execute call
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('returns null when memory not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.update('no-mem', { content: 'New' });
      expect(result).toBeNull();
    });

    it('updates content and returns refreshed memory', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(memoryRow()) // existing (trackAccess=false)
        .mockResolvedValueOnce(memoryRow({ content: 'Updated' })); // refreshed
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.update('mem-1', { content: 'Updated' });

      expect(result!.content).toBe('Updated');
    });

    it('serializes tags as JSON', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(memoryRow())
        .mockResolvedValueOnce(memoryRow({ tags: '["tag1","tag2"]' }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('mem-1', { tags: ['tag1', 'tag2'] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain('["tag1","tag2"]');
    });

    it('emits RESOURCE_UPDATED event', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(memoryRow()).mockResolvedValueOnce(memoryRow());
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('mem-1', { content: 'New' });

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('returns true when deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.delete('mem-1');
      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const result = await repo.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('emits RESOURCE_DELETED event when deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.delete('mem-1');
      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    it('does not emit event when not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      await repo.delete('nonexistent');
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // List & Filtering
  // ==========================================================================

  describe('list', () => {
    it('returns all memories for user', async () => {
      mockAdapter.query.mockResolvedValue([memoryRow(), memoryRow({ id: 'mem-2' })]);

      const memories = await repo.list();
      expect(memories).toHaveLength(2);
    });

    it('filters by single type', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ type: 'preference' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
    });

    it('filters by multiple types', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ types: ['fact', 'preference'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type IN');
    });

    it('filters by minimum importance', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ minImportance: 0.7 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('importance >=');
    });

    it('filters by source', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ source: 'chat' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('source =');
    });

    it('filters by tags using ILIKE', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ tags: ['nature', 'science'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('tags ILIKE');
    });

    it('applies search filter on content', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ search: 'blue sky' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('content ILIKE');
    });

    it('orders by importance', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ orderBy: 'importance' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY importance DESC');
    });

    it('orders by accessed', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ orderBy: 'accessed' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY accessed_at DESC');
    });

    it('orders by relevance', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ orderBy: 'relevance' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY importance DESC');
    });

    it('defaults to ordering by created_at', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('applies limit and offset', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ limit: 5, offset: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });
  });

  // ==========================================================================
  // Search & Specialized Queries
  // ==========================================================================

  describe('search', () => {
    it('delegates to list with search and relevance ordering', async () => {
      mockAdapter.query.mockResolvedValue([memoryRow()]);

      const memories = await repo.search('blue');

      expect(memories).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('content ILIKE');
      expect(sql).toContain('ORDER BY importance DESC');
    });

    it('applies type filter', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.search('blue', { type: 'fact' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
    });

    it('defaults limit to 20', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.search('test');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(20);
    });
  });

  describe('getRecent', () => {
    it('returns recent memories ordered by created_at', async () => {
      mockAdapter.query.mockResolvedValue([memoryRow()]);

      const memories = await repo.getRecent(5);

      expect(memories).toHaveLength(1);
    });

    it('filters by type when provided', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.getRecent(5, 'preference');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
    });
  });

  describe('getImportant', () => {
    it('returns memories above importance threshold', async () => {
      mockAdapter.query.mockResolvedValue([memoryRow({ importance: 0.9 })]);

      const memories = await repo.getImportant(0.7);

      expect(memories).toHaveLength(1);
    });
  });

  describe('getFrequentlyAccessed', () => {
    it('returns memories ordered by accessed_count', async () => {
      mockAdapter.query.mockResolvedValue([
        memoryRow({ accessed_count: 10 }),
        memoryRow({ id: 'mem-2', accessed_count: 5 }),
      ]);

      const memories = await repo.getFrequentlyAccessed(10);

      expect(memories).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('accessed_count > 0');
      expect(sql).toContain('ORDER BY accessed_count DESC');
    });
  });

  describe('getBySource', () => {
    it('returns memories filtered by source', async () => {
      mockAdapter.query.mockResolvedValue([memoryRow({ source: 'chat' })]);

      const memories = await repo.getBySource('chat');

      expect(memories).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('source =');
    });

    it('additionally filters by sourceId when provided', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.getBySource('chat', 'conv-123');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('source_id');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('conv-123');
    });
  });

  // ==========================================================================
  // Decay & Cleanup
  // ==========================================================================

  describe('decay', () => {
    it('applies decay factor to old unaccessed memories', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 5 });

      const count = await repo.decay({ daysThreshold: 30, decayFactor: 0.9 });

      expect(count).toBe(5);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('importance = importance *');
      expect(sql).toContain('importance > 0.1');
    });

    it('uses default values', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      await repo.decay();

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // decayFactor default = 0.9
      expect(params[0]).toBe(0.9);
      // daysThreshold default = 30
      expect(params[2]).toBe(30);
      expect(params[3]).toBe(30);
    });

    it('returns 0 when no memories decayed', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const count = await repo.decay();
      expect(count).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('deletes low-importance old memories', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 3 });

      const count = await repo.cleanup({ maxAge: 90, minImportance: 0.1 });

      expect(count).toBe(3);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM memories');
      expect(sql).toContain('importance <');
    });

    it('uses default values', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      await repo.cleanup();

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // minImportance default = 0.1
      expect(params[1]).toBe(0.1);
      // maxAge default = 90
      expect(params[2]).toBe(90);
    });

    it('returns 0 when no memories cleaned up', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const count = await repo.cleanup();
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Boost
  // ==========================================================================

  describe('boost', () => {
    it('increases importance by amount', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(memoryRow({ importance: 0.5 })) // existing get (no tracking)
        .mockResolvedValueOnce(memoryRow({ importance: 0.5 })) // update -> get existing (no tracking)
        .mockResolvedValueOnce(memoryRow({ importance: 0.6 })); // refreshed after update (no tracking)
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const memory = await repo.boost('mem-1', 0.1);

      expect(memory).not.toBeNull();
    });

    it('caps importance at 1.0', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(memoryRow({ importance: 0.95 }))
        .mockResolvedValueOnce(memoryRow({ importance: 0.95 }))
        .mockResolvedValueOnce(memoryRow({ importance: 1.0 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.boost('mem-1', 0.1);

      // The update call should pass importance = 1.0 (min(1, 0.95+0.1))
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(1);
    });

    it('returns null when memory not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.boost('nonexistent');
      expect(result).toBeNull();
    });

    it('uses default boost amount of 0.1', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(memoryRow({ importance: 0.5 }))
        .mockResolvedValueOnce(memoryRow({ importance: 0.5 }))
        .mockResolvedValueOnce(memoryRow({ importance: 0.6 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.boost('mem-1');

      // importance should be 0.5 + 0.1 = 0.6
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(0.6);
    });
  });

  // ==========================================================================
  // Count
  // ==========================================================================

  describe('count', () => {
    it('returns total count', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: 42 });

      const count = await repo.count();
      expect(count).toBe(42);
    });

    it('filters by type', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: 10 });

      const count = await repo.count('fact');

      expect(count).toBe(10);
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
    });

    it('returns 0 when no memories', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const count = await repo.count();
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Statistics
  // ==========================================================================

  describe('getStats', () => {
    it('returns default values when empty', async () => {
      mockAdapter.query.mockResolvedValue([]); // typeRows
      mockAdapter.queryOne
        .mockResolvedValueOnce({ total: 0, avg_importance: 0 }) // statsRow
        .mockResolvedValueOnce({ count: 0 }); // recentRow

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.avgImportance).toBe(0);
      expect(stats.recentCount).toBe(0);
      expect(stats.byType.fact).toBe(0);
      expect(stats.byType.preference).toBe(0);
    });

    it('computes stats from data', async () => {
      mockAdapter.query.mockResolvedValue([
        { type: 'fact', count: 10 },
        { type: 'preference', count: 5 },
        { type: 'conversation', count: 3 },
      ]);
      mockAdapter.queryOne
        .mockResolvedValueOnce({ total: 18, avg_importance: 0.65 })
        .mockResolvedValueOnce({ count: 4 });

      const stats = await repo.getStats();

      expect(stats.total).toBe(18);
      expect(stats.byType.fact).toBe(10);
      expect(stats.byType.preference).toBe(5);
      expect(stats.byType.conversation).toBe(3);
      expect(stats.byType.event).toBe(0);
      expect(stats.byType.skill).toBe(0);
      expect(stats.avgImportance).toBe(0.65);
      expect(stats.recentCount).toBe(4);
    });
  });

  // ==========================================================================
  // Embedding Search
  // ==========================================================================

  describe('searchByEmbedding', () => {
    it('returns memories with similarity scores', async () => {
      mockAdapter.query.mockResolvedValue([
        { ...memoryRow({ embedding: [0.1, 0.2] }), similarity: 0.95 },
      ]);

      const results = await repo.searchByEmbedding([0.1, 0.2]);

      expect(results).toHaveLength(1);
      expect(results[0]!.similarity).toBe(0.95);
    });

    it('applies type filter', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.searchByEmbedding([0.1], { type: 'fact' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
    });

    it('applies minImportance filter', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.searchByEmbedding([0.1], { minImportance: 0.5 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('importance >=');
    });

    it('applies similarity threshold', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.searchByEmbedding([0.1], { threshold: 0.8 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('<=>');
    });

    it('defaults limit to 10', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.searchByEmbedding([0.1]);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
    });
  });

  // ==========================================================================
  // Find Similar (Deduplication)
  // ==========================================================================

  describe('findSimilar', () => {
    it('finds by embedding when provided', async () => {
      mockAdapter.query.mockResolvedValue([{ ...memoryRow(), similarity: 0.98 }]);

      const result = await repo.findSimilar('Test', 'fact', [0.1, 0.2], 0.95);

      expect(result).not.toBeNull();
    });

    it('falls back to exact text match when no embedding match', async () => {
      // embedding search returns empty
      mockAdapter.query.mockResolvedValue([]);
      // exact text match
      mockAdapter.queryOne.mockResolvedValue(memoryRow());

      const result = await repo.findSimilar('The sky is blue', 'fact', [0.1], 0.95);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('The sky is blue');
    });

    it('uses text match when no embedding provided', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow());

      const result = await repo.findSimilar('The sky is blue');

      expect(result).not.toBeNull();
    });

    it('returns null when no match found', async () => {
      mockAdapter.query.mockResolvedValue([]);
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.findSimilar('unique text', 'fact', [0.1]);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Update Embedding
  // ==========================================================================

  describe('updateEmbedding', () => {
    it('updates embedding and returns true', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.updateEmbedding('mem-1', [0.1, 0.2, 0.3]);

      expect(result).toBe(true);
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('[0.1,0.2,0.3]');
    });

    it('returns false when memory not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const result = await repo.updateEmbedding('nonexistent', [0.1]);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // searchByFTS (Full-text search)
  // ==========================================================================

  describe('searchByFTS', () => {
    it('returns memories with FTS rank scores', async () => {
      mockAdapter.query.mockResolvedValue([
        { ...memoryRow(), fts_rank: 0.85 },
        { ...memoryRow({ id: 'mem-2' }), fts_rank: 0.6 },
      ]);
      const results = await repo.searchByFTS('blue sky');
      expect(results).toHaveLength(2);
      expect(results[0]!.ftsRank).toBe(0.85);
      expect(results[1]!.ftsRank).toBe(0.6);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ts_rank_cd');
      expect(sql).toContain('websearch_to_tsquery');
      expect(sql).toContain('search_vector');
    });

    it('applies type filter', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.searchByFTS('test', { type: 'fact' });
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
    });

    it('applies minImportance', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.searchByFTS('test', { minImportance: 0.7 });
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('importance >=');
    });

    it('defaults limit to 20', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.searchByFTS('test');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(20);
    });

    it('applies custom limit', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.searchByFTS('test', { limit: 5 });
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(5);
    });
  });

  describe('hybridSearch', () => {
    it('falls back to FTS when no embedding', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ ...memoryRow(), fts_rank: 0.9 }]);
      const results = await repo.hybridSearch('test query');
      expect(results).toHaveLength(1);
      expect(results[0]!.matchType).toBe('fts');
      expect(results[0]!.score).toBe(0.9);
    });

    it('falls back to keyword when FTS empty', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([memoryRow()]);
      const results = await repo.hybridSearch('test query');
      expect(results).toHaveLength(1);
      expect(results[0]!.matchType).toBe('keyword');
    });

    it('returns empty when both FTS and keyword empty', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.hybridSearch('x')).toEqual([]);
    });

    it('uses RRF when embedding provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { ...memoryRow(), rrf_score: 0.5, match_type: 'hybrid' },
      ]);
      const results = await repo.hybridSearch('test', { embedding: [0.1, 0.2] });
      expect(results[0]!.matchType).toBe('hybrid');
      expect(results[0]!.score).toBe(0.5);
    });

    it('applies type filter in RRF', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.hybridSearch('test', { embedding: [0.1], type: 'fact' });
      expect(mockAdapter.query.mock.calls[0]![0] as string).toContain('type =');
    });

    it('applies minImportance in RRF', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.hybridSearch('test', { embedding: [0.1], minImportance: 0.5 });
      expect(mockAdapter.query.mock.calls[0]![0] as string).toContain('importance >=');
    });

    it('applies limit in RRF', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.hybridSearch('test', { embedding: [0.1], limit: 5 });
      expect(mockAdapter.query.mock.calls[0]![1] as unknown[]).toContain(5);
    });

    it('empty embedding falls back to FTS', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ ...memoryRow(), fts_rank: 0.7 }]);
      const r = await repo.hybridSearch('test', { embedding: [] });
      expect(r[0]!.matchType).toBe('fts');
    });

    it('RRF SQL has vector+FTS CTEs', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.hybridSearch('test', { embedding: [0.1] });
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('vector_results');
      expect(sql).toContain('fts_results');
      expect(sql).toContain('FULL OUTER JOIN');
    });

    it('keyword fallback decreasing scores', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([
        memoryRow({ id: 'm1' }),
        memoryRow({ id: 'm2' }),
        memoryRow({ id: 'm3' }),
      ]);
      const r = await repo.hybridSearch('test');
      expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
      expect(r[1]!.score).toBeGreaterThan(r[2]!.score);
    });

    it('type+minImportance in RRF', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.hybridSearch('t', { embedding: [0.1], type: 'preference', minImportance: 0.3 });
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
      expect(sql).toContain('importance >=');
    });
  });

  describe('getWithoutEmbeddings', () => {
    it('returns memories without embeddings', async () => {
      mockAdapter.query.mockResolvedValue([memoryRow({ embedding: null })]);
      const r = await repo.getWithoutEmbeddings();
      expect(r).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('embedding IS NULL');
      expect(sql).toContain('ORDER BY importance DESC');
    });
    it('defaults limit to 100', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.getWithoutEmbeddings();
      expect(mockAdapter.query.mock.calls[0]![1] as unknown[]).toContain(100);
    });
    it('applies custom limit', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.getWithoutEmbeddings(50);
      expect(mockAdapter.query.mock.calls[0]![1] as unknown[]).toContain(50);
    });
  });

  describe('parseEmbedding edge cases', () => {
    it('undefined for invalid JSON', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: 'not-json' }));
      expect((await repo.get('mem-1', false))!.embedding).toBeUndefined();
    });
    it('undefined for JSON object string', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: '{"a":1}' }));
      expect((await repo.get('mem-1', false))!.embedding).toBeUndefined();
    });
    it('undefined for numeric', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ embedding: 42 }));
      expect((await repo.get('mem-1', false))!.embedding).toBeUndefined();
    });
  });

  describe('getStats null edge', () => {
    it('handles null statsRow/recentRow', async () => {
      mockAdapter.query.mockResolvedValue([]);
      mockAdapter.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const s = await repo.getStats();
      expect(s.total).toBe(0);
      expect(s.avgImportance).toBe(0);
      expect(s.recentCount).toBe(0);
    });
  });

  describe('findSimilar edge cases', () => {
    it('includes type in text fallback', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow());
      await repo.findSimilar('content', 'preference');
      expect(mockAdapter.queryOne.mock.calls[0]![0] as string).toContain('type =');
    });
    it('omits type when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);
      await repo.findSimilar('content');
      expect(mockAdapter.queryOne.mock.calls[0]![0] as string).not.toContain('type =');
    });
    it('skips vector for empty embedding', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow());
      await repo.findSimilar('content', 'fact', []);
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });
  });

  describe('searchByEmbedding combined', () => {
    it('all filters together', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.searchByEmbedding([0.1], {
        type: 'fact',
        limit: 5,
        threshold: 0.5,
        minImportance: 0.3,
      });
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type =');
      expect(sql).toContain('importance >=');
    });
  });

  describe('factory', () => {
    it('creates with userId', async () => {
      const { createMemoriesRepository } = await import('./memories.js');
      expect(createMemoriesRepository('u42')).toBeInstanceOf(MemoriesRepository);
    });
    it('defaults userId', async () => {
      const { createMemoriesRepository } = await import('./memories.js');
      expect(createMemoriesRepository()).toBeInstanceOf(MemoriesRepository);
    });
  });

  describe('update no-emit when refresh null', () => {
    it('no emit when get returns null after update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(memoryRow());
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      expect(await repo.update('mem-1', { content: 'New' })).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
    it('serializes metadata JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(memoryRow()).mockResolvedValueOnce(memoryRow());
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      await repo.update('mem-1', { metadata: { foo: 'bar' } });
      expect(mockAdapter.execute.mock.calls[0]![1] as unknown[]).toContain('{"foo":"bar"}');
    });
  });

  describe('create source fields', () => {
    it('passes source and sourceId', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(memoryRow());
      await repo.create({ type: 'conversation', content: 'S', source: 'chat', sourceId: 'c1' });
      const p = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(p[5]).toBe('chat');
      expect(p[6]).toBe('c1');
    });
    it('defaults source/sourceId to null', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(memoryRow());
      await repo.create({ type: 'fact', content: 'T' });
      const p = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(p[5]).toBeNull();
      expect(p[6]).toBeNull();
    });
  });

  describe('row mapping: lastAccessedAt', () => {
    it('Date when present', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ accessed_at: NOW_ISO }));
      expect((await repo.get('mem-1', false))!.lastAccessedAt).toBeInstanceOf(Date);
    });
    it('undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValue(memoryRow({ accessed_at: null }));
      expect((await repo.get('mem-1', false))!.lastAccessedAt).toBeUndefined();
    });
  });
});
