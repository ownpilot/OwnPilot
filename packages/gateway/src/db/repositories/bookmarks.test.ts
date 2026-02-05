/**
 * Bookmarks Repository Tests
 *
 * Unit tests for BookmarksRepository CRUD, search, filtering, and pagination.
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

import { BookmarksRepository } from './bookmarks.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeBookmarkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    user_id: 'user-1',
    url: 'https://example.com',
    title: 'Example',
    description: null,
    favicon: null,
    category: null,
    tags: '[]',
    is_favorite: false,
    visit_count: 0,
    last_visited_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BookmarksRepository', () => {
  let repo: BookmarksRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new BookmarksRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a bookmark and return it', async () => {
      const row = makeBookmarkRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({ url: 'https://example.com', title: 'Example' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.url).toBe('https://example.com');
      expect(result.title).toBe('Example');
      expect(result.tags).toEqual([]);
      expect(result.isFavorite).toBe(false);
    });

    it('should store tags as JSON', async () => {
      const row = makeBookmarkRow({ tags: '["typescript","vitest"]' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        url: 'https://example.com',
        title: 'Example',
        tags: ['typescript', 'vitest'],
      });

      expect(result.tags).toEqual(['typescript', 'vitest']);
      // Verify the execute call passed serialized tags
      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[7]).toBe('["typescript","vitest"]');
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ url: 'https://example.com', title: 'Example' }))
        .rejects.toThrow('Failed to create bookmark');
    });

    it('should pass optional fields correctly', async () => {
      const row = makeBookmarkRow({
        description: 'A description',
        favicon: 'https://example.com/fav.ico',
        category: 'tech',
        is_favorite: true,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        url: 'https://example.com',
        title: 'Example',
        description: 'A description',
        favicon: 'https://example.com/fav.ico',
        category: 'tech',
        isFavorite: true,
      });

      expect(result.description).toBe('A description');
      expect(result.favicon).toBe('https://example.com/fav.ico');
      expect(result.category).toBe('tech');
      expect(result.isFavorite).toBe(true);
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a bookmark when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow());

      const result = await repo.get('bk-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('bk-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should parse dates correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeBookmarkRow({ last_visited_at: '2025-01-10T08:00:00.000Z' }),
      );

      const result = await repo.get('bk-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
      expect(result!.lastVisitedAt).toBeInstanceOf(Date);
    });

    it('should leave lastVisitedAt undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow());

      const result = await repo.get('bk-1');

      expect(result!.lastVisitedAt).toBeUndefined();
    });
  });

  // =========================================================================
  // getByUrl
  // =========================================================================

  describe('getByUrl', () => {
    it('should query by url and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow());

      const result = await repo.getByUrl('https://example.com');

      expect(result).not.toBeNull();
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('url = $1');
      expect(sql).toContain('user_id = $2');
    });

    it('should return null for unknown url', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getByUrl('https://unknown.com')).toBeNull();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated bookmark', async () => {
      const original = makeBookmarkRow();
      const updated = makeBookmarkRow({ title: 'Updated Title' });

      // First call: get existing (inside update)
      mockAdapter.queryOne.mockResolvedValueOnce(original);
      // Second call: execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // Third call: get updated (return value)
      mockAdapter.queryOne.mockResolvedValueOnce(updated);

      const result = await repo.update('bk-1', { title: 'Updated Title' });

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Updated Title');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null when bookmark does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('nonexistent', { title: 'New' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing when no fields to update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow());

      const result = await repo.update('bk-1', {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe('bk-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should serialize tags as JSON on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeBookmarkRow({ tags: '["a","b"]' }),
      );

      await repo.update('bk-1', { tags: ['a', 'b'] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('["a","b"]');
    });

    it('should handle updating multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeBookmarkRow({ title: 'New', url: 'https://new.com', category: 'dev' }),
      );

      const result = await repo.update('bk-1', {
        title: 'New',
        url: 'https://new.com',
        category: 'dev',
      });

      expect(result!.title).toBe('New');
      expect(result!.url).toBe('https://new.com');
      expect(result!.category).toBe('dev');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('bk-1')).toBe(true);
    });

    it('should return false when bookmark not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('nonexistent')).toBe(false);
    });

    it('should include user_id in the WHERE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('bk-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['bk-1', 'user-1']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no bookmarks', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list();

      expect(result).toEqual([]);
    });

    it('should return mapped bookmarks', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeBookmarkRow({ id: 'bk-1' }),
        makeBookmarkRow({ id: 'bk-2', title: 'Second' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('bk-1');
      expect(result[1]!.id).toBe('bk-2');
    });

    it('should filter by category', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'tech' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('tech');
    });

    it('should filter by isFavorite', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ isFavorite: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_favorite = $2');
    });

    it('should filter by tags', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ tags: ['typescript', 'testing'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("tags::text LIKE");
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%"typescript"%');
      expect(params).toContain('%"testing"%');
    });

    it('should apply search across title, description, and url', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'vitest' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('title ILIKE');
      expect(sql).toContain('description ILIKE');
      expect(sql).toContain('url ILIKE');
    });

    it('should apply LIMIT and OFFSET for pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should order by is_favorite DESC, updated_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY is_favorite DESC, updated_at DESC');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: '100%_test' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      // The percent and underscore in the search term should be escaped
      expect(params).toContain('%100\\%\\_test%');
    });
  });

  // =========================================================================
  // recordVisit
  // =========================================================================

  describe('recordVisit', () => {
    it('should increment visit_count and set last_visited_at', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeBookmarkRow({ visit_count: 5, last_visited_at: NOW }),
      );

      const result = await repo.recordVisit('bk-1');

      expect(result).not.toBeNull();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('visit_count = visit_count + 1');
      expect(sql).toContain('last_visited_at = NOW()');
    });
  });

  // =========================================================================
  // toggleFavorite
  // =========================================================================

  describe('toggleFavorite', () => {
    it('should toggle from false to true', async () => {
      // get existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow({ is_favorite: false }));
      // get existing (inside update)
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow({ is_favorite: false }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeBookmarkRow({ is_favorite: true }));

      const result = await repo.toggleFavorite('bk-1');

      expect(result).not.toBeNull();
    });

    it('should return null for nonexistent bookmark', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.toggleFavorite('nonexistent')).toBeNull();
    });
  });

  // =========================================================================
  // Convenience methods
  // =========================================================================

  describe('getFavorites', () => {
    it('should delegate to list with isFavorite=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getFavorites();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_favorite = $2');
    });
  });

  describe('getRecent', () => {
    it('should delegate to list with a limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getRecent(5);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(5);
    });
  });

  describe('getMostVisited', () => {
    it('should order by visit_count DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getMostVisited(10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY visit_count DESC');
    });
  });

  describe('getCategories', () => {
    it('should return distinct categories', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { category: 'dev' },
        { category: 'news' },
      ]);

      const result = await repo.getCategories();

      expect(result).toEqual(['dev', 'news']);
    });
  });

  describe('getTags', () => {
    it('should aggregate unique tags from all bookmarks', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { tags: '["a","b"]' },
        { tags: '["b","c"]' },
      ]);

      const result = await repo.getTags();

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should return empty array when no bookmarks', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getTags()).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return the count of bookmarks', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      expect(await repo.count()).toBe(42);
    });

    it('should return 0 when no rows', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('should delegate to list with search and limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('test', 15);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ILIKE');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%test%');
      expect(params).toContain(15);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createBookmarksRepository', () => {
    it('should be importable', async () => {
      const { createBookmarksRepository } = await import('./bookmarks.js');
      const r = createBookmarksRepository('u1');
      expect(r).toBeInstanceOf(BookmarksRepository);
    });
  });
});
