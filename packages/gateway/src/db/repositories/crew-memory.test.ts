/**
 * CrewMemoryRepository Tests
 *
 * Unit tests for crew_shared_memory CRUD — create (RETURNING *), paginated
 * list with optional category filter, ILIKE search, getById, delete, row
 * mapping (including JSON-string vs already-parsed metadata), and the
 * module singleton.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { CrewMemoryRepository, getCrewMemoryRepository } = await import('./crew-memory.js');

const NOW = '2026-01-01T00:00:00Z';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    crew_id: 'crew-1',
    agent_id: 'agent-1',
    category: 'lesson',
    title: 'Observed pattern',
    content: 'Notes about X',
    metadata: '{"source":"meeting"}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('CrewMemoryRepository', () => {
  let repo: InstanceType<typeof CrewMemoryRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CrewMemoryRepository();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('inserts with RETURNING * and maps the returned row', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      const entry = await repo.create(
        'crew-1',
        'agent-1',
        'lesson',
        'Observed pattern',
        'Notes about X',
        { source: 'meeting' }
      );

      expect(entry.id).toBe('mem-1');
      expect(entry.crewId).toBe('crew-1');
      expect(entry.agentId).toBe('agent-1');
      expect(entry.metadata).toEqual({ source: 'meeting' });
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.updatedAt).toBeInstanceOf(Date);

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO crew_shared_memory');
      expect(sql).toContain('RETURNING *');
      expect(params).toEqual([
        'crew-1',
        'agent-1',
        'lesson',
        'Observed pattern',
        'Notes about X',
        JSON.stringify({ source: 'meeting' }),
      ]);
    });

    it('defaults metadata to "{}" when omitted', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow({ metadata: '{}' })]);

      await repo.create('crew-1', 'agent-1', 'lesson', 'T', 'C');

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[5]).toBe('{}');
    });
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe('list', () => {
    it('returns entries and total with no category filter using default limit/offset', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });
      mockAdapter.query.mockResolvedValueOnce([makeRow(), makeRow({ id: 'mem-2' })]);

      const result = await repo.list('crew-1');

      expect(result.total).toBe(3);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.id).toBe('mem-1');

      const [countSql, countParams] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('WHERE crew_id = $1');
      expect(countSql).not.toContain('category');
      expect(countParams).toEqual(['crew-1']);

      const [dataSql, dataParams] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(dataSql).toContain('ORDER BY created_at DESC');
      expect(dataSql).toContain('LIMIT $2 OFFSET $3');
      expect(dataParams).toEqual(['crew-1', 20, 0]);
    });

    it('adds category filter and uses supplied limit/offset', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list('crew-1', 'lesson', 50, 10);

      const [countSql, countParams] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('WHERE crew_id = $1 AND category = $2');
      expect(countParams).toEqual(['crew-1', 'lesson']);

      const [dataSql, dataParams] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(dataSql).toContain('LIMIT $3 OFFSET $4');
      expect(dataParams).toEqual(['crew-1', 'lesson', 50, 10]);
    });

    it('returns total 0 when no count row comes back', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list('crew-1');

      expect(result.total).toBe(0);
      expect(result.entries).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------

  describe('search', () => {
    it('runs ILIKE across title and content with a %pattern%', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      const results = await repo.search('crew-1', 'pattern');

      expect(results).toHaveLength(1);

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('title ILIKE $2 OR content ILIKE $2');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $3');
      expect(params).toEqual(['crew-1', '%pattern%', 10]);
    });

    it('honors a custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('crew-1', 'x', 25);

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe(25);
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------

  describe('getById', () => {
    it('returns a mapped entry when the row exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const entry = await repo.getById('mem-1');

      expect(entry?.id).toBe('mem-1');
      expect(entry?.metadata).toEqual({ source: 'meeting' });

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SELECT * FROM crew_shared_memory WHERE id = $1');
      expect(params).toEqual(['mem-1']);
    });

    it('returns null when no row is found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      expect(await repo.getById('missing')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  describe('delete', () => {
    it('returns true when a row was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const ok = await repo.delete('mem-1');

      expect(ok).toBe(true);
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM crew_shared_memory WHERE id = $1');
      expect(params).toEqual(['mem-1']);
    });

    it('returns false when no row matched', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      expect(await repo.delete('missing')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata parsing
  // ---------------------------------------------------------------------------

  describe('metadata mapping', () => {
    it('parses metadata when stored as a JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ metadata: '{"tier":"A"}' }));

      const entry = await repo.getById('mem-1');
      expect(entry?.metadata).toEqual({ tier: 'A' });
    });

    it('uses metadata as-is when the adapter returns an object (pg driver)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeRow({ metadata: { already: 'parsed' } as unknown as string })
      );

      const entry = await repo.getById('mem-1');
      expect(entry?.metadata).toEqual({ already: 'parsed' });
    });

    it('falls back to empty object when metadata is missing', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ metadata: null as unknown as string }));

      const entry = await repo.getById('mem-1');
      expect(entry?.metadata).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  describe('getCrewMemoryRepository', () => {
    it('returns the same instance across calls', () => {
      const a = getCrewMemoryRepository();
      const b = getCrewMemoryRepository();
      expect(a).toBe(b);
      expect(a).toBeInstanceOf(CrewMemoryRepository);
    });
  });
});
