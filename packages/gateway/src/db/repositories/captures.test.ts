/**
 * Captures Repository Tests
 *
 * Unit tests for CapturesRepository CRUD, process/unprocess,
 * listing with filters, inbox, stats, type detection, tag extraction,
 * and URL extraction.
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

import { CapturesRepository } from './captures.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeCaptureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cap_1',
    user_id: 'user-1',
    content: 'An interesting thought',
    type: 'thought',
    tags: '[]',
    source: null,
    url: null,
    processed: false,
    processed_as_type: null,
    processed_as_id: null,
    created_at: NOW,
    processed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CapturesRepository', () => {
  let repo: CapturesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CapturesRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a capture and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());

      const result = await repo.create({ content: 'An interesting thought' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.content).toBe('An interesting thought');
      expect(result.type).toBe('thought');
      expect(result.processed).toBe(false);
      expect(result.tags).toEqual([]);
    });

    it('should auto-detect type as "link" for URLs', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({
          content: 'Check this out https://example.com',
          type: 'link',
          url: 'https://example.com',
        })
      );

      await repo.create({ content: 'Check this out https://example.com' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // type should be 'link'
      expect(params[3]).toBe('link');
      // url should be extracted
      expect(params[6]).toBe('https://example.com');
    });

    it('should auto-detect type as "question" for question marks', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ content: 'Why is the sky blue?', type: 'question' })
      );

      await repo.create({ content: 'Why is the sky blue?' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('question');
    });

    it('should auto-detect type as "todo"', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ content: 'todo: fix the bug', type: 'todo' })
      );

      await repo.create({ content: 'todo: fix the bug' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('todo');
    });

    it('should auto-detect type as "snippet" for code', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ content: 'const x = 42', type: 'snippet' })
      );

      await repo.create({ content: 'const x = 42' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('snippet');
    });

    it('should auto-detect type as "idea"', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ content: 'idea: build a time machine', type: 'idea' })
      );

      await repo.create({ content: 'idea: build a time machine' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('idea');
    });

    it('should auto-detect type as "quote"', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ content: '"To be or not to be"', type: 'quote' })
      );

      await repo.create({ content: '"To be or not to be"' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('quote');
    });

    it('should use provided type instead of auto-detecting', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ content: 'Some content', type: 'other' })
      );

      await repo.create({ content: 'Some content', type: 'other' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('other');
    });

    it('should extract hashtags as tags', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ tags: '["typescript","testing"]' })
      );

      await repo.create({ content: 'Learning #typescript and #testing' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const tags = JSON.parse(params[4] as string);
      expect(tags).toContain('typescript');
      expect(tags).toContain('testing');
    });

    it('should extract mentions as person tags', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ tags: '["person:john"]' }));

      await repo.create({ content: 'Talk to @john about this' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const tags = JSON.parse(params[4] as string);
      expect(tags).toContain('person:john');
    });

    it('should merge auto-extracted and manual tags', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ tags: '["auto","manual"]' }));

      await repo.create({
        content: 'Test #auto content',
        tags: ['manual'],
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const tags = JSON.parse(params[4] as string);
      expect(tags).toContain('auto');
      expect(tags).toContain('manual');
    });

    it('should deduplicate tags', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ tags: '["test"]' }));

      await repo.create({
        content: 'Hello #test world',
        tags: ['test'],
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const tags = JSON.parse(params[4] as string) as string[];
      const uniqueTags = [...new Set(tags)];
      expect(tags.length).toBe(uniqueTags.length);
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ content: 'Test' })).rejects.toThrow('Failed to create capture');
    });

    it('should store source when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ source: 'telegram' }));

      await repo.create({ content: 'Test', source: 'telegram' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('telegram');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return capture when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());

      const result = await repo.get('cap_1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('cap_1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());

      const result = await repo.get('cap_1');

      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should parse processedAt when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ processed: true, processed_at: NOW })
      );

      const result = await repo.get('cap_1');

      expect(result!.processedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());

      const result = await repo.get('cap_1');

      expect(result!.source).toBeUndefined();
      expect(result!.url).toBeUndefined();
      // processedAsType uses `as` cast so null stays null (not converted by ??)
      expect(result!.processedAsType).toBeNull();
      expect(result!.processedAsId).toBeUndefined();
      expect(result!.processedAt).toBeUndefined();
    });

    it('should parse tags JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ tags: '["a","b","c"]' }));

      const result = await repo.get('cap_1');

      expect(result!.tags).toEqual(['a', 'b', 'c']);
    });

    it('should handle empty tags JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ tags: '[]' }));

      const result = await repo.get('cap_1');

      expect(result!.tags).toEqual([]);
    });

    it('should handle tags as empty string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ tags: '' }));

      const result = await repo.get('cap_1');

      expect(result!.tags).toEqual([]);
    });
  });

  // =========================================================================
  // process
  // =========================================================================

  describe('process', () => {
    it('should mark capture as processed', async () => {
      // get existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get refreshed
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({
          processed: true,
          processed_as_type: 'note',
          processed_as_id: 'note-1',
          processed_at: NOW,
        })
      );

      const result = await repo.process('cap_1', {
        processedAsType: 'note',
        processedAsId: 'note-1',
      });

      expect(result).not.toBeNull();
      expect(result!.processed).toBe(true);
      expect(result!.processedAsType).toBe('note');
      expect(result!.processedAsId).toBe('note-1');
    });

    it('should return null when capture not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.process('missing', { processedAsType: 'note' })).toBeNull();
    });

    it('should handle processing without processedAsId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({ processed: true, processed_as_type: 'discarded' })
      );

      await repo.process('cap_1', { processedAsType: 'discarded' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBeNull(); // processedAsId
    });
  });

  // =========================================================================
  // unprocess
  // =========================================================================

  describe('unprocess', () => {
    it('should clear processed fields', async () => {
      // get existing (processed)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCaptureRow({
          processed: true,
          processed_as_type: 'note',
          processed_as_id: 'note-1',
          processed_at: NOW,
        })
      );
      // execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get refreshed
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());

      const result = await repo.unprocess('cap_1');

      expect(result!.processed).toBe(false);
      // processedAsType uses `as` cast so null stays null (not converted by ??)
      expect(result!.processedAsType).toBeNull();
      expect(result!.processedAsId).toBeUndefined();
      expect(result!.processedAt).toBeUndefined();
    });

    it('should return null when capture not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.unprocess('missing')).toBeNull();
    });

    it('should set processed fields to NULL/FALSE in SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow({ processed: true }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCaptureRow());

      await repo.unprocess('cap_1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('processed = FALSE');
      expect(sql).toContain('processed_as_type = NULL');
      expect(sql).toContain('processed_as_id = NULL');
      expect(sql).toContain('processed_at = NULL');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('cap_1')).toBe(true);
    });

    it('should return false when capture not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('cap_1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['cap_1', 'user-1']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no captures', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped captures', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeCaptureRow(),
        makeCaptureRow({ id: 'cap_2', content: 'Second' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
    });

    it('should filter by type', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ type: 'idea' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('idea');
    });

    it('should filter by tag', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ tag: 'typescript' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('tags::text LIKE');
    });

    it('should filter by processed status', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ processed: false });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('processed = $');
    });

    it('should filter by search text', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'hello' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('content ILIKE');
    });

    it('should apply limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
    });

    it('should apply offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('OFFSET');
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({
        type: 'idea',
        processed: false,
        search: 'project',
        limit: 5,
        offset: 10,
      });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type = $');
      expect(sql).toContain('processed = $');
      expect(sql).toContain('content ILIKE');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: '50%_off' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%50\\%\\_off%');
    });

    it('should escape LIKE wildcards in tag filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ tag: 'special%tag' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      // The tag should be escaped and wrapped in quotes
      expect(params).toContain('%"special\\%tag"%');
    });
  });

  // =========================================================================
  // getInbox
  // =========================================================================

  describe('getInbox', () => {
    it('should return unprocessed captures with default limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCaptureRow()]);

      const result = await repo.getInbox();

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('processed = $');
      expect(sql).toContain('LIMIT');
    });

    it('should accept custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getInbox(5);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(5);
    });
  });

  // =========================================================================
  // getInboxCount
  // =========================================================================

  describe('getInboxCount', () => {
    it('should return count of unprocessed captures', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });

      const result = await repo.getInboxCount();

      expect(result).toBe(7);
    });

    it('should return 0 when no unprocessed captures', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.getInboxCount()).toBe(0);
    });

    it('should return 0 when query returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getInboxCount()).toBe(0);
    });

    it('should filter by user_id and processed = FALSE', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.getInboxCount();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('processed = FALSE');
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('should return aggregated stats', async () => {
      // typeRows (Promise.all first query)
      mockAdapter.query
        .mockResolvedValueOnce([
          { type: 'thought', processed: false, count: '5' },
          { type: 'idea', processed: true, count: '3' },
          { type: 'todo', processed: false, count: '2' },
        ])
        // processedAsRows
        .mockResolvedValueOnce([
          { processed_as_type: 'note', count: '2' },
          { processed_as_type: 'task', count: '1' },
        ])
        // tagRows
        .mockResolvedValueOnce([
          { tag: 'work', count: '5' },
          { tag: 'personal', count: '3' },
        ]);

      const result = await repo.getStats();

      expect(result.total).toBe(10);
      expect(result.processed).toBe(3);
      expect(result.unprocessed).toBe(7);
      expect(result.byType.thought).toBe(5);
      expect(result.byType.idea).toBe(3);
      expect(result.byType.todo).toBe(2);
      expect(result.processedAs.note).toBe(2);
      expect(result.processedAs.task).toBe(1);
      expect(result.topTags).toHaveLength(2);
      expect(result.topTags[0]!.tag).toBe('work');
      expect(result.topTags[0]!.count).toBe(5);
    });

    it('should return zeros when no captures', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([]) // typeRows
        .mockResolvedValueOnce([]) // processedAsRows
        .mockResolvedValueOnce([]); // tagRows

      const result = await repo.getStats();

      expect(result.total).toBe(0);
      expect(result.processed).toBe(0);
      expect(result.unprocessed).toBe(0);
      expect(result.topTags).toEqual([]);
    });

    it('should accumulate same type counts across processed/unprocessed', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          { type: 'thought', processed: false, count: '3' },
          { type: 'thought', processed: true, count: '2' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await repo.getStats();

      expect(result.byType.thought).toBe(5);
      expect(result.total).toBe(5);
      expect(result.processed).toBe(2);
    });
  });

  // =========================================================================
  // getRecentByType
  // =========================================================================

  describe('getRecentByType', () => {
    it('should return captures grouped by all types', async () => {
      // 8 types: idea, thought, todo, link, quote, snippet, question, other
      for (let i = 0; i < 8; i++) {
        mockAdapter.query.mockResolvedValueOnce([]);
      }

      const result = await repo.getRecentByType();

      expect(Object.keys(result)).toHaveLength(8);
      expect(result.idea).toEqual([]);
      expect(result.thought).toEqual([]);
      expect(result.todo).toEqual([]);
      expect(result.link).toEqual([]);
      expect(result.quote).toEqual([]);
      expect(result.snippet).toEqual([]);
      expect(result.question).toEqual([]);
      expect(result.other).toEqual([]);
    });

    it('should call list with limit 5 for each type', async () => {
      for (let i = 0; i < 8; i++) {
        mockAdapter.query.mockResolvedValueOnce([]);
      }

      await repo.getRecentByType();

      // Each list call should have limit=5
      for (let i = 0; i < 8; i++) {
        const params = mockAdapter.query.mock.calls[i]![1] as unknown[];
        expect(params).toContain(5);
      }
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createCapturesRepository', () => {
    it('should be importable and create an instance', async () => {
      const { createCapturesRepository } = await import('./captures.js');
      const r = createCapturesRepository('u1');
      expect(r).toBeInstanceOf(CapturesRepository);
    });

    it('should default userId to "default"', async () => {
      const { createCapturesRepository } = await import('./captures.js');
      const r = createCapturesRepository();
      expect(r).toBeInstanceOf(CapturesRepository);
    });
  });
});
