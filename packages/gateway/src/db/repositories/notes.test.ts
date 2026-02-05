/**
 * Notes Repository Tests
 *
 * Unit tests for NotesRepository CRUD, search, filtering, archiving, and pagination.
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

import { NotesRepository } from './notes.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeNoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    user_id: 'user-1',
    title: 'My Note',
    content: 'Hello world',
    content_type: 'markdown',
    category: null,
    tags: '[]',
    is_pinned: false,
    is_archived: false,
    color: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotesRepository', () => {
  let repo: NotesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new NotesRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a note and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());

      const result = await repo.create({ title: 'My Note', content: 'Hello world' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.title).toBe('My Note');
      expect(result.content).toBe('Hello world');
      expect(result.contentType).toBe('markdown');
      expect(result.tags).toEqual([]);
      expect(result.isPinned).toBe(false);
      expect(result.isArchived).toBe(false);
    });

    it('should default contentType to markdown', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());

      await repo.create({ title: 'Test', content: 'Content' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBe('markdown');
    });

    it('should accept custom contentType', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ content_type: 'html' }));

      const result = await repo.create({
        title: 'Test',
        content: '<p>Hi</p>',
        contentType: 'html',
      });

      expect(result.contentType).toBe('html');
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ title: 'Test', content: 'x' }))
        .rejects.toThrow('Failed to create note');
    });

    it('should store tags and optional fields', async () => {
      const row = makeNoteRow({
        tags: '["journal","daily"]',
        category: 'personal',
        is_pinned: true,
        color: '#ff0000',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        title: 'Test',
        content: 'body',
        tags: ['journal', 'daily'],
        category: 'personal',
        isPinned: true,
        color: '#ff0000',
      });

      expect(result.tags).toEqual(['journal', 'daily']);
      expect(result.category).toBe('personal');
      expect(result.isPinned).toBe(true);
      expect(result.color).toBe('#ff0000');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a note when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());

      const result = await repo.get('note-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('note-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());

      const result = await repo.get('note-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());

      const result = await repo.get('note-1');

      expect(result!.category).toBeUndefined();
      expect(result!.color).toBeUndefined();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated note', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ title: 'Updated' }));

      const result = await repo.update('note-1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null if note does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { title: 'x' })).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing note when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());

      const result = await repo.update('note-1', {});

      expect(result!.id).toBe('note-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeNoteRow({ title: 'New', content: 'New content', content_type: 'text' }),
      );

      const result = await repo.update('note-1', {
        title: 'New',
        content: 'New content',
        contentType: 'text',
      });

      expect(result!.title).toBe('New');
      expect(result!.content).toBe('New content');
      expect(result!.contentType).toBe('text');
    });

    it('should serialize tags on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ tags: '["x"]' }));

      await repo.update('note-1', { tags: ['x'] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('["x"]');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('note-1')).toBe(true);
    });

    it('should return false when note not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('note-1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['note-1', 'user-1']);
    });
  });

  // =========================================================================
  // archive / unarchive
  // =========================================================================

  describe('archive', () => {
    it('should set isArchived to true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ is_archived: true }));

      const result = await repo.archive('note-1');

      expect(result!.isArchived).toBe(true);
    });
  });

  describe('unarchive', () => {
    it('should set isArchived to false', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ is_archived: true }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ is_archived: false }));

      const result = await repo.unarchive('note-1');

      expect(result!.isArchived).toBe(false);
    });
  });

  // =========================================================================
  // togglePin
  // =========================================================================

  describe('togglePin', () => {
    it('should toggle from false to true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ is_pinned: false }));
      // update -> get existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ is_pinned: false }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeNoteRow({ is_pinned: true }));

      const result = await repo.togglePin('note-1');

      expect(result!.isPinned).toBe(true);
    });

    it('should return null for nonexistent note', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.togglePin('missing')).toBeNull();
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no notes', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should default to non-archived notes', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = FALSE');
    });

    it('should filter by isArchived when explicitly set', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ isArchived: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(true);
    });

    it('should filter by category', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'work' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $');
    });

    it('should filter by isPinned', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ isPinned: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_pinned = $');
    });

    it('should filter by tags', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ tags: ['journal'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("tags::text LIKE");
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%"journal"%');
    });

    it('should search by title and content', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'hello' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('title ILIKE');
      expect(sql).toContain('content ILIKE');
    });

    it('should apply pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 5, offset: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('should order by is_pinned DESC, updated_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY is_pinned DESC, updated_at DESC');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: '50%_off' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%50\\%\\_off%');
    });
  });

  // =========================================================================
  // Convenience methods
  // =========================================================================

  describe('getPinned', () => {
    it('should delegate to list with isPinned=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getPinned();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_pinned = $');
    });
  });

  describe('getArchived', () => {
    it('should delegate to list with isArchived=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getArchived();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = $');
    });
  });

  describe('getRecent', () => {
    it('should delegate to list with a limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getRecent(3);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(3);
    });
  });

  describe('getCategories', () => {
    it('should return distinct non-archived categories', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { category: 'personal' },
        { category: 'work' },
      ]);

      const result = await repo.getCategories();

      expect(result).toEqual(['personal', 'work']);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = FALSE');
    });
  });

  describe('getTags', () => {
    it('should aggregate unique tags from non-archived notes', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { tags: '["a","b"]' },
        { tags: '["b","c"]' },
      ]);

      const result = await repo.getTags();

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should return empty array when no notes', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getTags()).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return count excluding archived by default', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '10' });

      const result = await repo.count();

      expect(result).toBe(10);
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = FALSE');
    });

    it('should include archived when requested', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '15' });

      const result = await repo.count(true);

      expect(result).toBe(15);
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).not.toContain('is_archived');
    });

    it('should return 0 when no rows', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('should delegate to list with search and limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('query', 10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ILIKE');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createNotesRepository', () => {
    it('should be importable', async () => {
      const { createNotesRepository } = await import('./notes.js');
      const r = createNotesRepository('u1');
      expect(r).toBeInstanceOf(NotesRepository);
    });
  });
});
