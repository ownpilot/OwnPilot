/**
 * Workflows Repository Tests
 *
 * Unit tests for WorkflowsRepository CRUD (workflows + logs),
 * JSON field serialization, dynamic UPDATE builders, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@ownpilot/core', () => ({
  generateId: vi.fn().mockReturnValue('wf-generated-id'),
}));

// ---------------------------------------------------------------------------
// Dynamic import after mocks
// ---------------------------------------------------------------------------

const { WorkflowsRepository, createWorkflowsRepository } = await import('./workflows.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    user_id: 'default',
    name: 'Test Workflow',
    description: 'Test desc',
    nodes: '[]',
    edges: '[]',
    status: 'inactive',
    variables: '{}',
    last_run: null,
    run_count: 0,
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

function makeLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wflog-1',
    workflow_id: 'wf-1',
    workflow_name: 'Test Workflow',
    status: 'running',
    node_results: '{}',
    error: null,
    duration_ms: null,
    started_at: '2024-06-01T12:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowsRepository', () => {
  let repo: InstanceType<typeof WorkflowsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new WorkflowsRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a workflow and return it', async () => {
      const row = makeWorkflowRow({ id: 'wf-generated-id' });

      // First call: execute INSERT
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // Second call: queryOne in get() to return the created row
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        name: 'Test Workflow',
        description: 'Test desc',
        nodes: [],
        edges: [],
      });

      // Verify INSERT was called
      const executeSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(executeSql).toContain('INSERT INTO workflows');
      expect(executeSql).toContain('$1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('wf-generated-id'); // id
      expect(params[1]).toBe('default'); // user_id
      expect(params[2]).toBe('Test Workflow'); // name
      expect(params[3]).toBe('Test desc'); // description
      expect(params[4]).toBe('[]'); // nodes JSON
      expect(params[5]).toBe('[]'); // edges JSON
      expect(params[6]).toBe('inactive'); // default status
      expect(params[7]).toBe('{}'); // default variables

      expect(result.id).toBe('wf-generated-id');
      expect(result.name).toBe('Test Workflow');
    });

    it('should use provided status and variables', async () => {
      const row = makeWorkflowRow({
        id: 'wf-generated-id',
        status: 'active',
        variables: '{"key":"val"}',
      });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({
        name: 'Active Workflow',
        nodes: [],
        edges: [],
        status: 'active',
        variables: { key: 'val' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe('active');
      expect(params[7]).toBe('{"key":"val"}');
    });

    it('should throw when workflow not found after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({ name: 'Bad', nodes: [], edges: [] })
      ).rejects.toThrow('Failed to create workflow');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.get('wf-missing');

      expect(result).toBeNull();
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wf-missing', 'default']);
    });

    it('should map workflow row correctly', async () => {
      const nodesJson = JSON.stringify([
        { id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'test', toolArgs: {}, label: 'Test' } },
      ]);
      const edgesJson = JSON.stringify([
        { id: 'e1', source: 'n1', target: 'n2' },
      ]);
      const variablesJson = JSON.stringify({ apiKey: 'secret' });

      const row = makeWorkflowRow({
        nodes: nodesJson,
        edges: edgesJson,
        variables: variablesJson,
        last_run: '2024-06-15T08:00:00Z',
        run_count: 5,
      });

      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.get('wf-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('wf-1');
      expect(result!.userId).toBe('default');
      expect(result!.name).toBe('Test Workflow');
      expect(result!.description).toBe('Test desc');

      // JSON fields parsed
      expect(result!.nodes).toEqual([
        { id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'test', toolArgs: {}, label: 'Test' } },
      ]);
      expect(result!.edges).toEqual([{ id: 'e1', source: 'n1', target: 'n2' }]);
      expect(result!.variables).toEqual({ apiKey: 'secret' });

      // Date fields
      expect(result!.lastRun).toBeInstanceOf(Date);
      expect(result!.lastRun!.toISOString()).toBe('2024-06-15T08:00:00.000Z');
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);

      // Numeric field
      expect(result!.runCount).toBe(5);
    });

    it('should handle null last_run', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkflowRow({ last_run: null }));

      const result = await repo.get('wf-1');
      expect(result!.lastRun).toBeNull();
    });

    it('should query with correct SQL and userId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.get('wf-42');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflows WHERE id = $1 AND user_id = $2');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['wf-42', 'default']);
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should return null for missing workflow', async () => {
      // get() returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('wf-missing', { name: 'New Name' });

      expect(result).toBeNull();
      // execute should NOT be called
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should build dynamic SET clause correctly', async () => {
      const existingRow = makeWorkflowRow();
      // First queryOne: existing get()
      mockAdapter.queryOne.mockResolvedValueOnce(existingRow);
      // execute: the UPDATE statement
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // Second queryOne: re-get after update
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeWorkflowRow({ name: 'Updated', description: 'New desc', status: 'active' })
      );

      const result = await repo.update('wf-1', {
        name: 'Updated',
        description: 'New desc',
        status: 'active',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE workflows SET');
      expect(sql).toContain('updated_at = $1');
      expect(sql).toContain('name = $2');
      expect(sql).toContain('description = $3');
      expect(sql).toContain('status = $4');
      expect(sql).toContain('WHERE id = $5 AND user_id = $6');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // $1 = updated_at (ISO string)
      expect(typeof params[0]).toBe('string');
      // $2 = name
      expect(params[1]).toBe('Updated');
      // $3 = description
      expect(params[2]).toBe('New desc');
      // $4 = status
      expect(params[3]).toBe('active');
      // $5 = id
      expect(params[4]).toBe('wf-1');
      // $6 = userId
      expect(params[5]).toBe('default');

      expect(result!.name).toBe('Updated');
    });

    it('should JSON.stringify nodes, edges, and variables when provided', async () => {
      const existingRow = makeWorkflowRow();
      mockAdapter.queryOne.mockResolvedValueOnce(existingRow);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkflowRow());

      const nodes = [{ id: 'n1', type: 'tool', position: { x: 10, y: 20 }, data: { toolName: 't', toolArgs: {}, label: 'L' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      const variables = { envKey: 'envVal' };

      await repo.update('wf-1', { nodes, edges, variables });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // $1 = updated_at, $2 = nodes, $3 = edges, $4 = variables
      expect(params[1]).toBe(JSON.stringify(nodes));
      expect(params[2]).toBe(JSON.stringify(edges));
      expect(params[3]).toBe(JSON.stringify(variables));
    });

    it('should return existing workflow when no fields to update', async () => {
      const existingRow = makeWorkflowRow();
      // get() for existence check
      mockAdapter.queryOne.mockResolvedValueOnce(existingRow);
      // execute: still called because updated_at is always set
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // re-get after update
      mockAdapter.queryOne.mockResolvedValueOnce(existingRow);

      const result = await repo.update('wf-1', {});

      // Even with empty input, updated_at = $1 is always included
      expect(mockAdapter.execute).toHaveBeenCalled();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = $1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('wf-1');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should detach logs before deleting and return true', async () => {
      const row = makeWorkflowRow();
      // get() returns existing workflow
      mockAdapter.queryOne.mockResolvedValueOnce(row);
      // First execute: UPDATE workflow_logs (detach)
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });
      // Second execute: DELETE FROM workflows
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('wf-1');

      expect(result).toBe(true);

      // First execute call: detach logs
      const detachSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(detachSql).toContain('UPDATE workflow_logs');
      expect(detachSql).toContain('workflow_name = COALESCE(workflow_name, $1)');
      expect(detachSql).toContain('workflow_id = NULL');
      expect(detachSql).toContain('WHERE workflow_id = $2');
      const detachParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(detachParams).toEqual(['Test Workflow', 'wf-1']);

      // Second execute call: delete workflow
      const deleteSql = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(deleteSql).toContain('DELETE FROM workflows WHERE id = $1 AND user_id = $2');
      const deleteParams = mockAdapter.execute.mock.calls[1]![1] as unknown[];
      expect(deleteParams).toEqual(['wf-1', 'default']);
    });

    it('should return false when workflow not found (changes=0)', async () => {
      // get() returns null — workflow does not exist
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // DELETE still runs but finds nothing
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('wf-missing');

      expect(result).toBe(false);
      // Only one execute call (DELETE), no detach since workflow was null
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });

    it('should skip log detachment when workflow not found by get()', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.delete('wf-ghost');

      // Should NOT have the detach UPDATE call
      const firstSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(firstSql).toContain('DELETE FROM workflows');
      expect(firstSql).not.toContain('UPDATE workflow_logs');
    });
  });

  // =========================================================================
  // getPage
  // =========================================================================

  describe('getPage', () => {
    it('should query with correct ORDER BY, LIMIT, OFFSET', async () => {
      const rows = [makeWorkflowRow({ id: 'wf-1' }), makeWorkflowRow({ id: 'wf-2' })];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getPage(10, 20);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('wf-1');
      expect(result[1]!.id).toBe('wf-2');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflows WHERE user_id = $1');
      expect(sql).toContain('ORDER BY updated_at DESC');
      expect(sql).toContain('LIMIT $2 OFFSET $3');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 10, 20]);
    });

    it('should return empty array when no workflows', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getPage(10, 0);

      expect(result).toEqual([]);
    });

    it('should map all rows through mapWorkflow', async () => {
      const rows = [
        makeWorkflowRow({ id: 'wf-a', nodes: '[{"id":"n1"}]', variables: '{"x":1}' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getPage(5, 0);

      expect(result[0]!.nodes).toEqual([{ id: 'n1' }]);
      expect(result[0]!.variables).toEqual({ x: 1 });
      expect(result[0]!.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return parsed integer', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      const result = await repo.count();

      expect(result).toBe(42);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM workflows WHERE user_id = $1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['default']);
    });

    it('should return 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // markRun
  // =========================================================================

  describe('markRun', () => {
    it('should increment run_count and set last_run', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.markRun('wf-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE workflows SET last_run = $1');
      expect(sql).toContain('run_count = run_count + 1');
      expect(sql).toContain('updated_at = $1');
      expect(sql).toContain('WHERE id = $2 AND user_id = $3');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(typeof params[0]).toBe('string'); // ISO timestamp
      expect(params[1]).toBe('wf-1');
      expect(params[2]).toBe('default');
    });
  });

  // =========================================================================
  // createLog
  // =========================================================================

  describe('createLog', () => {
    it('should insert with running status and return mapped log', async () => {
      const logRow = makeLogRow({ id: 'wf-generated-id' });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(logRow);

      const result = await repo.createLog('wf-1', 'Test Workflow');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO workflow_logs');
      expect(sql).toContain('$1, $2, $3, $4, $5, $6');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('wf-generated-id'); // id
      expect(params[1]).toBe('wf-1'); // workflow_id
      expect(params[2]).toBe('Test Workflow'); // workflow_name
      expect(params[3]).toBe('running'); // status
      expect(params[4]).toBe('{}'); // node_results
      expect(typeof params[5]).toBe('string'); // started_at ISO

      expect(result.id).toBe('wf-generated-id');
      expect(result.status).toBe('running');
      expect(result.workflowId).toBe('wf-1');
      expect(result.workflowName).toBe('Test Workflow');
    });

    it('should throw when log not found after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.createLog('wf-1', 'Bad Workflow')
      ).rejects.toThrow('Failed to create workflow log');
    });
  });

  // =========================================================================
  // updateLog
  // =========================================================================

  describe('updateLog', () => {
    it('should build dynamic SET for all fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const nodeResults = { n1: { nodeId: 'n1', status: 'success' as const, output: 'ok' } };

      await repo.updateLog('wflog-1', {
        status: 'completed',
        nodeResults,
        error: 'some error',
        completedAt: '2024-06-01T13:00:00Z',
        durationMs: 5000,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE workflow_logs SET');
      expect(sql).toContain('status = $1');
      expect(sql).toContain('node_results = $2');
      expect(sql).toContain('error = $3');
      expect(sql).toContain('completed_at = $4');
      expect(sql).toContain('duration_ms = $5');
      expect(sql).toContain('WHERE id = $6');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('completed');
      expect(params[1]).toBe(JSON.stringify(nodeResults));
      expect(params[2]).toBe('some error');
      expect(params[3]).toBe('2024-06-01T13:00:00Z');
      expect(params[4]).toBe(5000);
      expect(params[5]).toBe('wflog-1');
    });

    it('should build SET with only partial fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLog('wflog-1', { status: 'failed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('status = $1');
      expect(sql).not.toContain('node_results');
      expect(sql).toContain('WHERE id = $2');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['failed', 'wflog-1']);
    });

    it('should skip when no fields provided', async () => {
      await repo.updateLog('wflog-1', {});

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getLog
  // =========================================================================

  describe('getLog', () => {
    it('should map log row correctly', async () => {
      const nodeResults = JSON.stringify({
        n1: { nodeId: 'n1', status: 'success', output: 'result' },
      });
      const row = makeLogRow({
        node_results: nodeResults,
        status: 'completed',
        error: 'err detail',
        duration_ms: 1234,
        completed_at: '2024-06-01T13:00:00Z',
      });

      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.getLog('wflog-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('wflog-1');
      expect(result!.workflowId).toBe('wf-1');
      expect(result!.workflowName).toBe('Test Workflow');
      expect(result!.status).toBe('completed');
      expect(result!.nodeResults).toEqual({
        n1: { nodeId: 'n1', status: 'success', output: 'result' },
      });
      expect(result!.error).toBe('err detail');
      expect(result!.durationMs).toBe(1234);
      expect(result!.startedAt).toBeInstanceOf(Date);
      expect(result!.completedAt).toBeInstanceOf(Date);
      expect(result!.completedAt!.toISOString()).toBe('2024-06-01T13:00:00.000Z');
    });

    it('should return null when log not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getLog('wflog-missing');

      expect(result).toBeNull();
    });

    it('should handle null completed_at', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow({ completed_at: null }));

      const result = await repo.getLog('wflog-1');

      expect(result!.completedAt).toBeNull();
    });

    it('should query with correct SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getLog('wflog-42');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_logs WHERE id = $1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['wflog-42']);
    });
  });

  // =========================================================================
  // getLogsForWorkflow
  // =========================================================================

  describe('getLogsForWorkflow', () => {
    it('should query with correct params and return mapped logs', async () => {
      const rows = [
        makeLogRow({ id: 'wflog-1' }),
        makeLogRow({ id: 'wflog-2', status: 'completed' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getLogsForWorkflow('wf-1', 10, 5);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('wflog-1');
      expect(result[1]!.id).toBe('wflog-2');
      expect(result[1]!.status).toBe('completed');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_logs WHERE workflow_id = $1');
      expect(sql).toContain('ORDER BY started_at DESC');
      expect(sql).toContain('LIMIT $2 OFFSET $3');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wf-1', 10, 5]);
    });

    it('should use default limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLogsForWorkflow('wf-1');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wf-1', 20, 0]);
    });

    it('should return empty array when no logs exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getLogsForWorkflow('wf-empty');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // countLogsForWorkflow
  // =========================================================================

  describe('countLogsForWorkflow', () => {
    it('should return count for specific workflow', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });

      const result = await repo.countLogsForWorkflow('wf-1');

      expect(result).toBe(7);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM workflow_logs WHERE workflow_id = $1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['wf-1']);
    });

    it('should return 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.countLogsForWorkflow('wf-empty');

      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // getRecentLogs
  // =========================================================================

  describe('getRecentLogs', () => {
    it('should return all recent logs ordered by started_at DESC', async () => {
      const rows = [
        makeLogRow({ id: 'wflog-3', workflow_id: 'wf-2' }),
        makeLogRow({ id: 'wflog-1', workflow_id: 'wf-1' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getRecentLogs(50, 10);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('wflog-3');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_logs ORDER BY started_at DESC');
      expect(sql).toContain('LIMIT $1 OFFSET $2');
      // No WHERE clause — all logs
      expect(sql).not.toContain('WHERE');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([50, 10]);
    });

    it('should use default limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getRecentLogs();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([20, 0]);
    });
  });

  // =========================================================================
  // countLogs
  // =========================================================================

  describe('countLogs', () => {
    it('should return total log count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '123' });

      const result = await repo.countLogs();

      expect(result).toBe(123);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM workflow_logs');
      // No WHERE clause, no params
      expect(sql).not.toContain('WHERE');
    });

    it('should return 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.countLogs();

      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // Custom userId
  // =========================================================================

  describe('custom userId', () => {
    it('should use provided userId in queries', async () => {
      const customRepo = new WorkflowsRepository('user-42');
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await customRepo.get('wf-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wf-1', 'user-42']);
    });

    it('should use provided userId in count', async () => {
      const customRepo = new WorkflowsRepository('user-42');
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });

      await customRepo.count();

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });

    it('should use provided userId in create', async () => {
      const customRepo = new WorkflowsRepository('user-99');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkflowRow({ user_id: 'user-99' }));

      await customRepo.create({ name: 'Usr Workflow', nodes: [], edges: [] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('user-99');
    });
  });

  // =========================================================================
  // createWorkflowsRepository factory
  // =========================================================================

  describe('createWorkflowsRepository', () => {
    it('should return a WorkflowsRepository instance', () => {
      const repo = createWorkflowsRepository();
      expect(repo).toBeInstanceOf(WorkflowsRepository);
    });

    it('should use default userId when none provided', async () => {
      const factoryRepo = createWorkflowsRepository();
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await factoryRepo.get('wf-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wf-1', 'default']);
    });

    it('should pass custom userId to repository', async () => {
      const factoryRepo = createWorkflowsRepository('custom-user');
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await factoryRepo.get('wf-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wf-1', 'custom-user']);
    });
  });
});
