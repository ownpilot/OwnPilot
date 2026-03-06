/**
 * BrowserWorkflowsRepository Tests
 *
 * Unit tests for BrowserWorkflowsRepository CRUD: create, getById,
 * listByUser, update (dynamic SET builder), and delete.
 * Covers JSON serialization, defaults, pagination, and edge cases.
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

// Mock generateId to return predictable IDs
vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateId: vi.fn(() => 'bwf-test-id') };
});

const { BrowserWorkflowsRepository } = await import('./browser-workflows.js');

// ---------------------------------------------------------------------------
// Sample row factory
// ---------------------------------------------------------------------------

function makeWorkflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bwf-1',
    user_id: 'user-1',
    name: 'Test Workflow',
    description: 'desc',
    steps: '[]',
    parameters: '[]',
    trigger_id: null,
    last_executed_at: null,
    execution_count: 0,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowserWorkflowsRepository', () => {
  let repo: InstanceType<typeof BrowserWorkflowsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new BrowserWorkflowsRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert with a generated ID and return the mapped workflow', async () => {
      const row = makeWorkflowRow({ id: 'bwf-test-id' });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.create('user-1', {
        name: 'Test Workflow',
        steps: [],
      });

      expect(result.id).toBe('bwf-test-id');
      expect(result.name).toBe('Test Workflow');
      expect(result.userId).toBe('user-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO browser_workflows');
      expect(sql).toContain('RETURNING *');
    });

    it('should pass generated ID as first param', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ id: 'bwf-test-id' })]);

      await repo.create('user-1', { name: 'My Workflow', steps: [] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('bwf-test-id');
    });

    it('should pass userId as second param', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.create('user-42', { name: 'WF', steps: [] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('user-42');
    });

    it('should serialize steps as JSON string', async () => {
      const steps = [{ type: 'navigate', url: 'https://example.com' }];
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ steps: JSON.stringify(steps) })]);

      await repo.create('user-1', { name: 'WF', steps });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBe(JSON.stringify(steps));
    });

    it('should serialize parameters as JSON string', async () => {
      const parameters = [{ name: 'url', type: 'string', description: 'Target URL' }];
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkflowRow({ parameters: JSON.stringify(parameters) }),
      ]);

      await repo.create('user-1', { name: 'WF', steps: [], parameters });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(JSON.stringify(parameters));
    });

    it('should default description to empty string when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ description: '' })]);

      await repo.create('user-1', { name: 'WF', steps: [] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('');
    });

    it('should use the provided description when given', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ description: 'My desc' })]);

      await repo.create('user-1', { name: 'WF', steps: [], description: 'My desc' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('My desc');
    });

    it('should default parameters to [] when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.create('user-1', { name: 'WF', steps: [] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('[]');
    });

    it('should default triggerId to null when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.create('user-1', { name: 'WF', steps: [] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBeNull();
    });

    it('should pass triggerId when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ trigger_id: 'trigger-abc' })]);

      await repo.create('user-1', { name: 'WF', steps: [], triggerId: 'trigger-abc' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe('trigger-abc');
    });

    it('should map the returned row correctly', async () => {
      const stepsJson = JSON.stringify([{ type: 'click', selector: '#btn' }]);
      const parametersJson = JSON.stringify([{ name: 'p1', type: 'string', description: 'desc' }]);
      const row = makeWorkflowRow({
        id: 'bwf-test-id',
        description: 'A workflow',
        steps: stepsJson,
        parameters: parametersJson,
        trigger_id: 'trig-1',
        last_executed_at: '2025-06-01T10:00:00Z',
        execution_count: 3,
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.create('user-1', { name: 'WF', steps: [] });

      expect(result.id).toBe('bwf-test-id');
      expect(result.description).toBe('A workflow');
      expect(result.steps).toEqual([{ type: 'click', selector: '#btn' }]);
      expect(result.parameters).toEqual([{ name: 'p1', type: 'string', description: 'desc' }]);
      expect(result.triggerId).toBe('trig-1');
      expect(result.lastExecutedAt).toBeInstanceOf(Date);
      expect(result.executionCount).toBe(3);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should set lastExecutedAt to null when last_executed_at is null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ last_executed_at: null })]);

      const result = await repo.create('user-1', { name: 'WF', steps: [] });

      expect(result.lastExecutedAt).toBeNull();
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return null when no rows returned', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result).toBeNull();
    });

    it('should return the mapped workflow when found', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('bwf-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.name).toBe('Test Workflow');
    });

    it('should scope the query to the given userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getById('bwf-99', 'user-xyz');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('browser_workflows');
      expect(sql).toContain('user_id = $2');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['bwf-99', 'user-xyz']);
    });

    it('should include id in the WHERE clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getById('bwf-42', 'user-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('id = $1');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('bwf-42');
    });

    it('should parse JSON fields in the returned workflow', async () => {
      const stepsJson = JSON.stringify([{ type: 'navigate', url: 'https://test.com' }]);
      const parametersJson = JSON.stringify([{ name: 'x', type: 'number', description: 'num' }]);
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkflowRow({ steps: stepsJson, parameters: parametersJson }),
      ]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.steps).toEqual([{ type: 'navigate', url: 'https://test.com' }]);
      expect(result!.parameters).toEqual([{ name: 'x', type: 'number', description: 'num' }]);
    });

    it('should default description to empty string when description is null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ description: null })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.description).toBe('');
    });

    it('should map dates from ISO strings', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkflowRow({ last_executed_at: '2025-03-15T08:30:00Z' }),
      ]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
      expect(result!.lastExecutedAt).toBeInstanceOf(Date);
      expect(result!.lastExecutedAt!.toISOString()).toBe('2025-03-15T08:30:00.000Z');
    });
  });

  // =========================================================================
  // listByUser
  // =========================================================================

  describe('listByUser', () => {
    it('should make two queries: COUNT then SELECT', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([makeWorkflowRow(), makeWorkflowRow({ id: 'bwf-2' })]);

      await repo.listByUser('user-1');

      expect(mockAdapter.query).toHaveBeenCalledTimes(2);
    });

    it('should return { workflows, total }', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '5' }])
        .mockResolvedValueOnce([makeWorkflowRow(), makeWorkflowRow({ id: 'bwf-2' })]);

      const result = await repo.listByUser('user-1');

      expect(result.total).toBe(5);
      expect(result.workflows).toHaveLength(2);
    });

    it('should pass userId to COUNT query', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.listByUser('user-special');

      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(countParams).toEqual(['user-special']);
    });

    it('should pass userId, limit, and offset to SELECT query', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.listByUser('user-1', 10, 20);

      const selectParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(selectParams).toEqual(['user-1', 10, 20]);
    });

    it('should use default limit=20 and offset=0 when not specified', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.listByUser('user-1');

      const selectParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(selectParams).toEqual(['user-1', 20, 0]);
    });

    it('should include ORDER BY, LIMIT, and OFFSET in SELECT query', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.listByUser('user-1', 5, 10);

      const selectSql = mockAdapter.query.mock.calls[1]![0] as string;
      expect(selectSql).toContain('ORDER BY');
      expect(selectSql).toContain('LIMIT');
      expect(selectSql).toContain('OFFSET');
    });

    it('should return empty workflows array and total=0 when no records', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      const result = await repo.listByUser('user-empty');

      expect(result.workflows).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should parse total as integer from string count', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '42' }]).mockResolvedValueOnce([]);

      const result = await repo.listByUser('user-1');

      expect(result.total).toBe(42);
      expect(typeof result.total).toBe('number');
    });

    it('should treat missing count row as total=0', async () => {
      // count query returns no rows at all
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await repo.listByUser('user-1');

      expect(result.total).toBe(0);
    });

    it('should map all returned rows to BrowserWorkflow objects', async () => {
      const rows = [
        makeWorkflowRow({ id: 'bwf-1', name: 'First' }),
        makeWorkflowRow({ id: 'bwf-2', name: 'Second' }),
        makeWorkflowRow({ id: 'bwf-3', name: 'Third' }),
      ];
      mockAdapter.query.mockResolvedValueOnce([{ count: '3' }]).mockResolvedValueOnce(rows);

      const result = await repo.listByUser('user-1');

      expect(result.workflows).toHaveLength(3);
      expect(result.workflows[0]!.id).toBe('bwf-1');
      expect(result.workflows[1]!.id).toBe('bwf-2');
      expect(result.workflows[2]!.id).toBe('bwf-3');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should call getById and return its result when no fields are set', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      const result = await repo.update('bwf-1', 'user-1', {});

      // The getById query (SELECT) runs once, no UPDATE query
      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('bwf-1');
    });

    it('should return null from getById when workflow not found (no fields)', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.update('bwf-missing', 'user-1', {});

      expect(result).toBeNull();
      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
    });

    it('should include only name in SET when only name is provided', async () => {
      const updatedRow = makeWorkflowRow({ name: 'New Name' });
      mockAdapter.query.mockResolvedValueOnce([updatedRow]);

      await repo.update('bwf-1', 'user-1', { name: 'New Name' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('name = $1');
      expect(sql).not.toContain('description');
      expect(sql).not.toContain('steps');
      expect(sql).not.toContain('parameters');
      expect(sql).not.toContain('trigger_id');
    });

    it('should include name param correctly', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ name: 'Updated' })]);

      await repo.update('bwf-1', 'user-1', { name: 'Updated' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('Updated');
    });

    it('should serialize steps as JSON in SET clause', async () => {
      const steps = [{ type: 'click', selector: '.btn' }];
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ steps: JSON.stringify(steps) })]);

      await repo.update('bwf-1', 'user-1', { steps });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(JSON.stringify(steps));
    });

    it('should serialize parameters as JSON in SET clause', async () => {
      const parameters = [{ name: 'p', type: 'string', description: 'a param' }];
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.update('bwf-1', 'user-1', { parameters });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(JSON.stringify(parameters));
    });

    it('should include description in SET when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ description: 'Updated desc' })]);

      await repo.update('bwf-1', 'user-1', { description: 'Updated desc' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('description = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('Updated desc');
    });

    it('should include trigger_id in SET when triggerId is provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ trigger_id: 'trig-99' })]);

      await repo.update('bwf-1', 'user-1', { triggerId: 'trig-99' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('trigger_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('trig-99');
    });

    it('should allow setting triggerId to null explicitly', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ trigger_id: null })]);

      await repo.update('bwf-1', 'user-1', { triggerId: null });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('trigger_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBeNull();
    });

    it('should include updated_at = NOW() in SET clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.update('bwf-1', 'user-1', { name: 'New' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });

    it('should build WHERE clause with id and userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.update('bwf-77', 'user-42', { name: 'WF' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('user_id = $');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      // name = $1, then id and userId are appended at the end
      expect(params).toContain('bwf-77');
      expect(params).toContain('user-42');
    });

    it('should include RETURNING * in UPDATE query', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.update('bwf-1', 'user-1', { name: 'WF' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('RETURNING *');
    });

    it('should return null when UPDATE returns no rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.update('bwf-missing', 'user-1', { name: 'WF' });

      expect(result).toBeNull();
    });

    it('should build SET for multiple fields simultaneously', async () => {
      const steps = [{ type: 'navigate', url: 'https://test.com' }];
      const parameters = [{ name: 'q', type: 'string', description: 'query' }];
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow()]);

      await repo.update('bwf-1', 'user-1', {
        name: 'Multi Update',
        description: 'Updated desc',
        steps,
        parameters,
        triggerId: 'trig-1',
      });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('name = $1');
      expect(sql).toContain('description = $2');
      expect(sql).toContain('steps = $3');
      expect(sql).toContain('parameters = $4');
      expect(sql).toContain('trigger_id = $5');
      expect(sql).toContain('updated_at = NOW()');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('Multi Update');
      expect(params[1]).toBe('Updated desc');
      expect(params[2]).toBe(JSON.stringify(steps));
      expect(params[3]).toBe(JSON.stringify(parameters));
      expect(params[4]).toBe('trig-1');
      // id and userId come last
      expect(params[5]).toBe('bwf-1');
      expect(params[6]).toBe('user-1');
    });

    it('should return the mapped workflow from the returned row', async () => {
      const steps = [{ type: 'type', selector: '#input', value: 'hello' }];
      const updatedRow = makeWorkflowRow({
        name: 'Updated WF',
        description: 'New desc',
        steps: JSON.stringify(steps),
        execution_count: 5,
      });
      mockAdapter.query.mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('bwf-1', 'user-1', { name: 'Updated WF' });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated WF');
      expect(result!.description).toBe('New desc');
      expect(result!.steps).toEqual(steps);
      expect(result!.executionCount).toBe(5);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when rows are returned (deletion succeeded)', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ id: 'bwf-1' }]);

      const result = await repo.delete('bwf-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should return false when no rows are returned (not found)', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.delete('bwf-missing', 'user-1');

      expect(result).toBe(false);
    });

    it('should use DELETE ... RETURNING id query', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ id: 'bwf-1' }]);

      await repo.delete('bwf-1', 'user-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM browser_workflows');
      expect(sql).toContain('RETURNING id');
    });

    it('should scope DELETE to both id and userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ id: 'bwf-5' }]);

      await repo.delete('bwf-5', 'user-99');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['bwf-5', 'user-99']);
    });

    it('should include id = $1 in WHERE clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.delete('bwf-1', 'user-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('id = $1');
    });

    it('should include user_id = $2 in WHERE clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.delete('bwf-1', 'user-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
    });

    it('should not delete a workflow belonging to a different user', async () => {
      // Returns empty — different user scenario
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.delete('bwf-1', 'other-user');

      expect(result).toBe(false);
      // Verify it still passes the correct userId
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('other-user');
    });
  });

  // =========================================================================
  // Row mapping (rowToWorkflow)
  // =========================================================================

  describe('row mapping', () => {
    it('should parse steps from JSON string', async () => {
      const steps = [{ type: 'click', selector: '#submit' }];
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ steps: JSON.stringify(steps) })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.steps).toEqual(steps);
    });

    it('should parse parameters from JSON string', async () => {
      const parameters = [{ name: 'target', type: 'string', description: 'The target element' }];
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkflowRow({ parameters: JSON.stringify(parameters) }),
      ]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.parameters).toEqual(parameters);
    });

    it('should default steps to [] when steps field is empty string', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ steps: '' })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.steps).toEqual([]);
    });

    it('should default parameters to [] when parameters field is empty string', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ parameters: '' })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.parameters).toEqual([]);
    });

    it('should map trigger_id to triggerId', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ trigger_id: 'trig-xyz' })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.triggerId).toBe('trig-xyz');
    });

    it('should keep triggerId null when trigger_id is null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ trigger_id: null })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.triggerId).toBeNull();
    });

    it('should map execution_count to executionCount', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ execution_count: 7 })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.executionCount).toBe(7);
    });

    it('should default executionCount to 0 when execution_count is null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ execution_count: null })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.executionCount).toBe(0);
    });

    it('should parse last_executed_at as a Date', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkflowRow({ last_executed_at: '2025-05-10T15:00:00Z' }),
      ]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.lastExecutedAt).toBeInstanceOf(Date);
      expect(result!.lastExecutedAt!.toISOString()).toBe('2025-05-10T15:00:00.000Z');
    });

    it('should keep lastExecutedAt null when last_executed_at is null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkflowRow({ last_executed_at: null })]);

      const result = await repo.getById('bwf-1', 'user-1');

      expect(result!.lastExecutedAt).toBeNull();
    });
  });
});
