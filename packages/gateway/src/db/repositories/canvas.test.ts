/**
 * CanvasRepository Tests
 *
 * Unit tests for CanvasRepository CRUD scoped by userId + canvasId.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateId: vi.fn(() => 'canv-test-id') };
});

const { CanvasRepository, createCanvasRepository } = await import('./canvas.js');

const NOW = '2025-01-01T00:00:00Z';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canv-1',
    user_id: 'default',
    canvas_id: 'main',
    type: 'note',
    content: 'hello',
    x: 10,
    y: 20,
    w: 200,
    h: 120,
    z: 0,
    style: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('CanvasRepository', () => {
  let repo: InstanceType<typeof CanvasRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CanvasRepository('default');
  });

  describe('list', () => {
    it('queries by user_id and canvas_id ordered by z', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow(), makeRow({ id: 'canv-2', z: 1 })]);

      const result = await repo.list('main');

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('FROM canvas_elements');
      expect(sql).toContain('ORDER BY z ASC');
      expect(params).toEqual(['default', 'main']);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('canv-1');
      expect(result[0].x).toBe(10);
    });

    it('defaults canvasId to main', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.list();
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 'main']);
    });
  });

  describe('add', () => {
    it('inserts with generated id and returns the element', async () => {
      mockAdapter.query.mockResolvedValueOnce([]); // INSERT
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ id: 'canv-test-id' })); // getById

      const result = await repo.add({ type: 'note', content: 'hello', x: 10, y: 20 });

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO canvas_elements');
      expect(params).toContain('canv-test-id');
      expect(params).toContain('note');
      expect(params).toContain('default');
      expect(result.id).toBe('canv-test-id');
    });

    it('applies defaults for omitted fields', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      await repo.add({ type: 'shape' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      // canvas_id default main, content default '', x/y default 0, w 200, h 120, z 0
      expect(params).toContain('main');
      expect(params).toContain(200);
      expect(params).toContain(120);
    });

    it('serializes style as JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      await repo.add({ type: 'note', style: { background: '#fff' } });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      const styleParam = params.find((p) => typeof p === 'string' && p.startsWith('{')) as string;
      expect(JSON.parse(styleParam)).toEqual({ background: '#fff' });
    });
  });

  describe('update', () => {
    it('returns null when element not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getById -> null

      const result = await repo.update('missing', { content: 'x' });
      expect(result).toBeNull();
    });

    it('merges provided fields over existing and issues UPDATE', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow()); // getById (existing)
      mockAdapter.query.mockResolvedValueOnce([]); // UPDATE
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ content: 'updated' })); // getById (return)

      const result = await repo.update('canv-1', { content: 'updated' });

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE canvas_elements');
      expect(params).toContain('updated');
      expect(params).toContain('canv-1');
      expect(result?.content).toBe('updated');
    });
  });

  describe('move', () => {
    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.move('missing', 1, 2);
      expect(result).toBeNull();
    });

    it('updates x and y', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow()); // getById existing
      mockAdapter.query.mockResolvedValueOnce([]); // UPDATE
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ x: 99, y: 88 })); // getById return

      const result = await repo.move('canv-1', 99, 88);

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET x = $1, y = $2');
      expect(params).toEqual([99, 88, 'canv-1', 'default']);
      expect(result?.x).toBe(99);
    });
  });

  describe('remove', () => {
    it('returns true when a row was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.remove('canv-1');
      expect(result).toBe(true);
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM canvas_elements');
      expect(params).toEqual(['canv-1', 'default']);
    });

    it('returns false when nothing deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      expect(await repo.remove('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('deletes all elements for a canvas and returns the count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      const result = await repo.clear('main');

      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM canvas_elements');
      expect(params).toEqual(['default', 'main']);
      expect(result).toBe(3);
    });
  });

  describe('factory', () => {
    it('createCanvasRepository returns an instance', () => {
      expect(createCanvasRepository('u1')).toBeInstanceOf(CanvasRepository);
    });
  });
});
