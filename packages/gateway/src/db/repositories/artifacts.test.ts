/**
 * ArtifactsRepository Tests
 *
 * Unit tests for ArtifactsRepository CRUD, version history,
 * pinning, data bindings, listing with filters, and pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateId: vi.fn(() => 'art-test-id') };
});

const { ArtifactsRepository, createArtifactsRepository } = await import('./artifacts.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-01T00:00:00Z';

function makeArtifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'art-1',
    conversation_id: 'conv-1',
    user_id: 'default',
    type: 'html',
    title: 'My Chart',
    content: '<h1>Hello</h1>',
    data_bindings: '[]',
    pinned: false,
    dashboard_position: null,
    dashboard_size: 'medium',
    version: 1,
    tags: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'artv-1',
    artifact_id: 'art-1',
    version: 1,
    content: '<h1>Hello</h1>',
    data_bindings: '[]',
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtifactsRepository', () => {
  let repo: InstanceType<typeof ArtifactsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ArtifactsRepository('default');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should execute INSERT INTO artifacts and return the created artifact', async () => {
      // INSERT via query()
      mockAdapter.query.mockResolvedValueOnce([]);
      // getById via queryOne()
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      const result = await repo.create({
        type: 'html',
        title: 'My Chart',
        content: '<h1>Hello</h1>',
      });

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO artifacts');
      expect(params).toContain('html');
      expect(params).toContain('My Chart');
      expect(params).toContain('<h1>Hello</h1>');
      expect(params).toContain('default'); // user_id

      expect(result.id).toBe('art-1');
      expect(result.type).toBe('html');
      expect(result.title).toBe('My Chart');
    });

    it('should include conversationId when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ conversation_id: 'conv-42' }));

      await repo.create({
        type: 'svg',
        title: 'Diagram',
        content: '<svg/>',
        conversationId: 'conv-42',
      });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('conv-42');
    });

    it('should default conversationId to null when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ conversation_id: null }));

      await repo.create({ type: 'html', title: 'T', content: 'C' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBeNull(); // conversationId
    });

    it('should serialize dataBindings as JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.create({
        type: 'html',
        title: 'T',
        content: 'C',
        dataBindings: [{ field: 'name', value: 'Alice' } as never],
      });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      const bindingsParam = params.find(
        (p) => typeof p === 'string' && p.startsWith('[')
      ) as string;
      const parsed = JSON.parse(bindingsParam);
      expect(parsed).toEqual([{ field: 'name', value: 'Alice' }]);
    });

    it('should default pinToDashboard to false and dashboardSize to medium', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.create({ type: 'html', title: 'T', content: 'C' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(false); // pinToDashboard
      expect(params).toContain('medium'); // dashboardSize
    });

    it('should accept custom dashboardSize', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ dashboard_size: 'large' }));

      await repo.create({ type: 'html', title: 'T', content: 'C', dashboardSize: 'large' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('large');
    });

    it('should accept tags array', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ tags: ['chart', 'data'] }));

      await repo.create({ type: 'html', title: 'T', content: 'C', tags: ['chart', 'data'] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContainEqual(['chart', 'data']);
    });

    it('should call getById after insert (queryOne returns artifact)', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      const result = await repo.create({ type: 'html', title: 'T', content: 'C' });

      expect(mockAdapter.queryOne).toHaveBeenCalledOnce();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should use the generated id from generateId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ id: 'art-test-id' }));

      const result = await repo.create({ type: 'html', title: 'T', content: 'C' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('art-test-id'); // generated id
      expect(result.id).toBe('art-test-id');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return null when artifact not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('should return artifact with camelCase fields when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      const result = await repo.getById('art-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('art-1');
      expect(result!.conversationId).toBe('conv-1');
      expect(result!.userId).toBe('default');
      expect(result!.type).toBe('html');
      expect(result!.title).toBe('My Chart');
      expect(result!.content).toBe('<h1>Hello</h1>');
      expect(result!.dataBindings).toEqual([]);
      expect(result!.pinned).toBe(false);
      expect(result!.dashboardPosition).toBeNull();
      expect(result!.dashboardSize).toBe('medium');
      expect(result!.version).toBe(1);
      expect(result!.tags).toEqual([]);
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should filter by userId in SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.getById('art-1');

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('user_id = $2');
      expect(params).toEqual(['art-1', 'default']);
    });

    it('should parse JSON data_bindings string', async () => {
      const binding = { field: 'x', value: 'y' };
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeArtifactRow({ data_bindings: JSON.stringify([binding]) })
      );

      const result = await repo.getById('art-1');

      expect(result!.dataBindings).toEqual([binding]);
    });

    it('should handle null conversationId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ conversation_id: null }));

      const result = await repo.getById('art-1');

      expect(result!.conversationId).toBeNull();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should return null when artifact not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('nonexistent', { title: 'New' });

      expect(result).toBeNull();
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should update title and return refreshed artifact', async () => {
      // getById (existing)
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());
      // UPDATE query
      mockAdapter.query.mockResolvedValueOnce([]);
      // getById (refreshed)
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ title: 'Updated Title' }));

      const result = await repo.update('art-1', { title: 'Updated Title' });

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Updated Title');
    });

    it('should save version snapshot when content changes', async () => {
      const existing = makeArtifactRow({ content: '<h1>Old</h1>', version: 1 });
      // getById (existing check)
      mockAdapter.queryOne.mockResolvedValueOnce(existing);
      // saveVersion INSERT
      mockAdapter.query.mockResolvedValueOnce([]);
      // UPDATE artifacts
      mockAdapter.query.mockResolvedValueOnce([]);
      // getById (refreshed)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeArtifactRow({ content: '<h1>New</h1>', version: 2 })
      );

      const result = await repo.update('art-1', { content: '<h1>New</h1>' });

      // Two query() calls: one for saveVersion INSERT, one for UPDATE artifacts
      expect(mockAdapter.query).toHaveBeenCalledTimes(2);
      const versionInsertSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(versionInsertSql).toContain('INSERT INTO artifact_versions');
      expect(result!.version).toBe(2);
    });

    it('should not save version when content is unchanged', async () => {
      const existing = makeArtifactRow({ content: '<h1>Hello</h1>' });
      // getById (existing check)
      mockAdapter.queryOne.mockResolvedValueOnce(existing);
      // UPDATE artifacts (no saveVersion)
      mockAdapter.query.mockResolvedValueOnce([]);
      // getById (refreshed)
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.update('art-1', { content: '<h1>Hello</h1>' });

      // Only one query() call — the UPDATE, no saveVersion INSERT
      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
      const updateSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(updateSql).toContain('UPDATE artifacts');
    });

    it('should not save version when content is undefined (no content change)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());
      // UPDATE artifacts (title only, no version snapshot)
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ title: 'X' }));

      await repo.update('art-1', { title: 'X' });

      const firstSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(firstSql).toContain('UPDATE artifacts');
      expect(firstSql).not.toContain('artifact_versions');
    });

    it('should return existing artifact when no updatable fields are provided (buildUpdateStatement returns null)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      // Pass an empty update — all fields undefined, rawClauses still has updated_at=NOW()
      // So buildUpdateStatement actually returns a stmt. Pass truly no-op fields only.
      // To trigger the null path, we must pass an input where no fields are defined
      // AND content is undefined (no rawClauses for version bump either).
      // Note: update() always adds updated_at = NOW() as rawClause, so stmt is never null.
      // The null path is only triggered if there are zero fields AND zero raw clauses.
      // Since updated_at is always added, stmt is always non-null → this path is unreachable.
      // Instead test the real behavior: empty {} still executes UPDATE (with updated_at only).
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      const result = await repo.update('art-1', {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe('art-1');
    });

    it('should bump version in SQL when content changes', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ content: '<h1>Old</h1>' }));
      mockAdapter.query.mockResolvedValueOnce([]); // saveVersion
      mockAdapter.query.mockResolvedValueOnce([]); // UPDATE
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.update('art-1', { content: '<h1>New</h1>' });

      const updateSql = mockAdapter.query.mock.calls[1]![0] as string;
      expect(updateSql).toContain('version = version + 1');
    });

    it('should not bump version when content does not change', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.update('art-1', { title: 'New Title' });

      const updateSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(updateSql).not.toContain('version = version + 1');
    });

    it('should serialize dataBindings as JSON string in update', async () => {
      const binding = { field: 'x', value: 'y' };
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.update('art-1', { dataBindings: [binding] as never[] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(JSON.stringify([binding]));
    });

    it('should scope UPDATE to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.update('art-1', { title: 'New' });

      const updateSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(updateSql).toContain('user_id');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('default');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when artifact is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('art-1');

      expect(result).toBe(true);
    });

    it('should return false when artifact not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should scope DELETE to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('art-1');

      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM artifacts');
      expect(sql).toContain('user_id = $2');
      expect(params).toEqual(['art-1', 'default']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return artifacts and total when no filters provided', async () => {
      // count query
      mockAdapter.query.mockResolvedValueOnce([{ count: '3' }]);
      // data query
      mockAdapter.query.mockResolvedValueOnce([
        makeArtifactRow({ id: 'art-1' }),
        makeArtifactRow({ id: 'art-2' }),
        makeArtifactRow({ id: 'art-3' }),
      ]);

      const result = await repo.list();

      expect(result.artifacts).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should include user_id filter in base query', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('user_id = $1');
    });

    it('should filter by type', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow({ type: 'svg' })]);

      await repo.list({ type: 'svg' });

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('AND type = $');
      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toContain('svg');
    });

    it('should filter by pinned=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '2' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow({ pinned: true })]);

      await repo.list({ pinned: true });

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('AND pinned = $');
      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toContain(true);
    });

    it('should filter by pinned=false', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow()]);

      await repo.list({ pinned: false });

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('AND pinned = $');
      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toContain(false);
    });

    it('should filter by conversationId', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow()]);

      await repo.list({ conversationId: 'conv-1' });

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('AND conversation_id = $');
      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toContain('conv-1');
    });

    it('should add ILIKE filter for search', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow()]);

      await repo.list({ search: 'chart' });

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('ILIKE');
      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toContain('%chart%');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: '50%_off' });

      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toContain('%50\\%\\_off%');
    });

    it('should apply ORDER BY created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const dataSql = mockAdapter.query.mock.calls[1]![0] as string;
      expect(dataSql).toContain('ORDER BY created_at DESC');
    });

    it('should apply LIMIT and OFFSET for pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '10' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 5, offset: 10 });

      const dataSql = mockAdapter.query.mock.calls[1]![0] as string;
      expect(dataSql).toContain('LIMIT');
      expect(dataSql).toContain('OFFSET');
      const dataParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(dataParams).toContain(5);
      expect(dataParams).toContain(10);
    });

    it('should default limit to 50 and offset to 0', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const dataParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(dataParams).toContain(50);
      expect(dataParams).toContain(0);
    });

    it('should parse total from count row', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '42' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list();

      expect(result.total).toBe(42);
    });

    it('should return total 0 when count row is missing', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list();

      expect(result.total).toBe(0);
    });

    it('should map rows to Artifact objects', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow()]);

      const result = await repo.list();

      expect(result.artifacts[0]!.conversationId).toBe('conv-1');
      expect(result.artifacts[0]!.dataBindings).toEqual([]);
      expect(result.artifacts[0]!.createdAt).toBeInstanceOf(Date);
    });

    it('should combine multiple filters correctly', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow()]);

      await repo.list({ type: 'html', pinned: true, conversationId: 'conv-1', search: 'test' });

      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(countSql).toContain('AND type = $');
      expect(countSql).toContain('AND pinned = $');
      expect(countSql).toContain('AND conversation_id = $');
      expect(countSql).toContain('ILIKE');
    });
  });

  // =========================================================================
  // getPinned
  // =========================================================================

  describe('getPinned', () => {
    it('should query with pinned=true filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeArtifactRow({ pinned: true })]);

      const result = await repo.getPinned();

      expect(result).toHaveLength(1);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('pinned = true');
      expect(params).toEqual(['default']);
    });

    it('should return empty array when no pinned artifacts', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getPinned();

      expect(result).toEqual([]);
    });

    it('should order by dashboard_position ASC NULLS LAST', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getPinned();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('dashboard_position ASC NULLS LAST');
    });

    it('should map returned rows to Artifact objects', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeArtifactRow({ pinned: true, id: 'art-pin-1' }),
        makeArtifactRow({ pinned: true, id: 'art-pin-2' }),
      ]);

      const result = await repo.getPinned();

      expect(result).toHaveLength(2);
      expect(result[0]!.pinned).toBe(true);
      expect(result[1]!.pinned).toBe(true);
    });
  });

  // =========================================================================
  // togglePin
  // =========================================================================

  describe('togglePin', () => {
    it('should toggle pinned from false to true and return updated artifact', async () => {
      // getById (existing — pinned: false)
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ pinned: false }));
      // UPDATE query
      mockAdapter.query.mockResolvedValueOnce([]);
      // getById (refreshed — pinned: true)
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ pinned: true }));

      const result = await repo.togglePin('art-1');

      expect(result).not.toBeNull();
      expect(result!.pinned).toBe(true);
    });

    it('should toggle pinned from true to false', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ pinned: true }));
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ pinned: false }));

      const result = await repo.togglePin('art-1');

      expect(result!.pinned).toBe(false);
    });

    it('should return null when artifact not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.togglePin('nonexistent');

      expect(result).toBeNull();
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should pass the toggled value in UPDATE params', async () => {
      // existing: pinned=false → new: pinned=true
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ pinned: false }));
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow({ pinned: true }));

      await repo.togglePin('art-1');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(true); // new pinned value
    });

    it('should scope UPDATE to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeArtifactRow());

      await repo.togglePin('art-1');

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('user_id = $4');
      expect(params).toContain('default');
    });
  });

  // =========================================================================
  // updateBindings
  // =========================================================================

  describe('updateBindings', () => {
    it('should execute UPDATE with JSON-serialized bindings', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const bindings = [{ field: 'x', value: 'y' }] as never[];
      await repo.updateBindings('art-1', bindings);

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE artifacts');
      expect(sql).toContain('data_bindings = $1');
      expect(params[0]).toBe(JSON.stringify(bindings));
    });

    it('should scope UPDATE to artifact id and user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateBindings('art-1', []);

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('id = $2');
      expect(sql).toContain('user_id = $3');
      expect(params[1]).toBe('art-1');
      expect(params[2]).toBe('default');
    });

    it('should serialize empty bindings as empty JSON array', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateBindings('art-1', []);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('[]');
    });

    it('should update updated_at timestamp', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateBindings('art-1', []);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });
  });

  // =========================================================================
  // getVersions
  // =========================================================================

  describe('getVersions', () => {
    it('should return empty array when artifact does not exist (ownership check)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getVersions('nonexistent');

      expect(result).toEqual([]);
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should return mapped versions when artifact exists', async () => {
      // ownership queryOne
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'art-1' });
      // versions query
      mockAdapter.query.mockResolvedValueOnce([
        makeVersionRow({ id: 'artv-1', version: 2 }),
        makeVersionRow({ id: 'artv-2', version: 1 }),
      ]);

      const result = await repo.getVersions('art-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('artv-1');
      expect(result[0]!.version).toBe(2);
      expect(result[0]!.artifactId).toBe('art-1');
      expect(result[0]!.content).toBe('<h1>Hello</h1>');
      expect(result[0]!.createdAt).toBeInstanceOf(Date);
    });

    it('should return empty array when artifact has no versions', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'art-1' });
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getVersions('art-1');

      expect(result).toEqual([]);
    });

    it('should query versions ordered by version DESC', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'art-1' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getVersions('art-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY version DESC');
    });

    it('should scope ownership check to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getVersions('art-1');

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('user_id = $2');
      expect(params).toContain('default');
    });

    it('should parse null data_bindings in version as null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'art-1' });
      mockAdapter.query.mockResolvedValueOnce([makeVersionRow({ data_bindings: null })]);

      const result = await repo.getVersions('art-1');

      expect(result[0]!.dataBindings).toBeNull();
    });

    it('should parse JSON data_bindings in version when present', async () => {
      const binding = { field: 'z', value: '99' };
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'art-1' });
      mockAdapter.query.mockResolvedValueOnce([
        makeVersionRow({ data_bindings: JSON.stringify([binding]) }),
      ]);

      const result = await repo.getVersions('art-1');

      expect(result[0]!.dataBindings).toEqual([binding]);
    });
  });

  // =========================================================================
  // createArtifactsRepository factory
  // =========================================================================

  describe('createArtifactsRepository', () => {
    it('should return an ArtifactsRepository instance', () => {
      const r = createArtifactsRepository();
      expect(r).toBeInstanceOf(ArtifactsRepository);
    });

    it('should use custom userId when provided', async () => {
      const r = createArtifactsRepository('user-42');
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await r.getById('art-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toContain('user-42');
    });

    it('should default userId to "default"', async () => {
      const r = createArtifactsRepository();
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await r.getById('art-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toContain('default');
    });
  });
});
