/**
 * Orchestra Repository Tests
 *
 * Unit tests for OrchestraRepository: saveExecution, getHistory,
 * getById, cleanupOld, JSON serialization, and null-field edge cases.
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

import { OrchestraRepository } from './orchestra.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW_ISO = '2026-03-05T10:00:00.000Z';
const COMPLETED_ISO = '2026-03-05T10:05:00.000Z';

const SAMPLE_PLAN = {
  description: 'Run a two-agent research pipeline',
  tasks: [
    {
      id: 'task-1',
      agentName: 'Research Assistant',
      input: 'Search for recent AI papers',
      dependsOn: [],
    },
    {
      id: 'task-2',
      agentName: 'Summarizer',
      input: 'Summarize the papers',
      dependsOn: ['task-1'],
    },
  ],
  strategy: 'sequential' as const,
};

const SAMPLE_TASK_RESULTS = [
  {
    taskId: 'task-1',
    agentName: 'Research Assistant',
    subagentId: 'sub-abc',
    output: 'Found 5 papers',
    toolsUsed: ['search'],
    tokenUsage: { prompt: 100, completion: 200 },
    durationMs: 1500,
    success: true,
  },
  {
    taskId: 'task-2',
    agentName: 'Summarizer',
    subagentId: 'sub-def',
    output: 'Summary of the papers',
    toolsUsed: [],
    tokenUsage: { prompt: 200, completion: 300 },
    durationMs: 800,
    success: true,
  },
];

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    parentId: 'conv-1',
    userId: 'user-1',
    plan: SAMPLE_PLAN,
    state: 'completed' as const,
    taskResults: SAMPLE_TASK_RESULTS,
    totalDurationMs: 2300,
    startedAt: new Date(NOW_ISO),
    completedAt: new Date(COMPLETED_ISO),
    error: undefined,
    ...overrides,
  };
}

function makeExecutionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    parent_id: 'conv-1',
    user_id: 'user-1',
    description: 'Run a two-agent research pipeline',
    strategy: 'sequential',
    state: 'completed',
    plan: JSON.stringify(SAMPLE_PLAN),
    task_results: JSON.stringify(SAMPLE_TASK_RESULTS),
    total_duration_ms: 2300,
    error: null,
    started_at: NOW_ISO,
    completed_at: COMPLETED_ISO,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestraRepository', () => {
  let repo: OrchestraRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new OrchestraRepository();
  });

  // =========================================================================
  // saveExecution
  // =========================================================================

  describe('saveExecution', () => {
    it('should call query with INSERT SQL', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution());

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO orchestra_executions');
    });

    it('should include all column names in INSERT', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution());

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('id');
      expect(sql).toContain('parent_id');
      expect(sql).toContain('user_id');
      expect(sql).toContain('description');
      expect(sql).toContain('strategy');
      expect(sql).toContain('state');
      expect(sql).toContain('plan');
      expect(sql).toContain('task_results');
      expect(sql).toContain('total_duration_ms');
      expect(sql).toContain('error');
      expect(sql).toContain('started_at');
      expect(sql).toContain('completed_at');
    });

    it('should pass all params in the correct order', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const execution = makeExecution();
      await repo.saveExecution(execution);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('exec-1'); // id
      expect(params[1]).toBe('conv-1'); // parent_id
      expect(params[2]).toBe('user-1'); // user_id
      expect(params[3]).toBe(SAMPLE_PLAN.description); // description
      expect(params[4]).toBe(SAMPLE_PLAN.strategy); // strategy
      expect(params[5]).toBe('completed'); // state
      expect(params[6]).toBe(JSON.stringify(SAMPLE_PLAN)); // plan JSON
      expect(params[7]).toBe(JSON.stringify(SAMPLE_TASK_RESULTS)); // task_results JSON
      expect(params[8]).toBe(2300); // total_duration_ms
      expect(params[9]).toBeNull(); // error (undefined -> null)
      expect(params[10]).toBe(NOW_ISO); // started_at ISO
      expect(params[11]).toBe(COMPLETED_ISO); // completed_at ISO
    });

    it('should set completedAt to null when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const execution = makeExecution({ completedAt: null });
      await repo.saveExecution(execution);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[11]).toBeNull();
    });

    it('should set error to null when undefined', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution({ error: undefined }));

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[9]).toBeNull();
    });

    it('should pass error string when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution({ error: 'Task timed out' }));

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[9]).toBe('Task timed out');
    });

    it('should serialize plan as JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution());

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(typeof params[6]).toBe('string');
      expect(JSON.parse(params[6] as string)).toEqual(SAMPLE_PLAN);
    });

    it('should serialize taskResults as JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution());

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(typeof params[7]).toBe('string');
      expect(JSON.parse(params[7] as string)).toEqual(SAMPLE_TASK_RESULTS);
    });

    it('should serialize empty taskResults as empty array JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.saveExecution(makeExecution({ taskResults: [] }));

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[7]).toBe('[]');
    });
  });

  // =========================================================================
  // getHistory
  // =========================================================================

  describe('getHistory', () => {
    it('should issue COUNT query first, then SELECT query', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([makeExecutionRow()]);

      await repo.getHistory('user-1');

      expect(mockAdapter.query).toHaveBeenCalledTimes(2);
      const countSql = mockAdapter.query.mock.calls[0]![0] as string;
      const selectSql = mockAdapter.query.mock.calls[1]![0] as string;
      expect(countSql).toContain('COUNT(*)');
      expect(selectSql).toContain('SELECT *');
    });

    it('should return correct total from COUNT result', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '7' }]).mockResolvedValueOnce([]);

      const result = await repo.getHistory('user-1');

      expect(result.total).toBe(7);
    });

    it('should return total 0 when COUNT returns no rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await repo.getHistory('user-1');

      expect(result.total).toBe(0);
    });

    it('should return mapped entries array', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeExecutionRow()]);

      const result = await repo.getHistory('user-1');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.id).toBe('exec-1');
    });

    it('should return empty entries when no rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      const result = await repo.getHistory('user-1');

      expect(result.entries).toEqual([]);
    });

    it('should scope both queries to userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.getHistory('user-42');

      const countParams = mockAdapter.query.mock.calls[0]![1] as unknown[];
      const selectParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(countParams[0]).toBe('user-42');
      expect(selectParams[0]).toBe('user-42');
    });

    it('should pass limit and offset to SELECT query', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '100' }]).mockResolvedValueOnce([]);

      await repo.getHistory('user-1', 10, 30);

      const selectParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(selectParams).toContain(10);
      expect(selectParams).toContain(30);
    });

    it('should use default limit=20 and offset=0', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '5' }]).mockResolvedValueOnce([]);

      await repo.getHistory('user-1');

      const selectParams = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(selectParams).toContain(20);
      expect(selectParams).toContain(0);
    });

    it('should order by started_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.getHistory('user-1');

      const selectSql = mockAdapter.query.mock.calls[1]![0] as string;
      expect(selectSql).toContain('ORDER BY started_at DESC');
    });

    it('should correctly map multiple entries', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '2' }])
        .mockResolvedValueOnce([
          makeExecutionRow({ id: 'exec-1', state: 'completed' }),
          makeExecutionRow({ id: 'exec-2', state: 'failed' }),
        ]);

      const result = await repo.getHistory('user-1');

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.id).toBe('exec-1');
      expect(result.entries[1]!.id).toBe('exec-2');
      expect(result.entries[1]!.state).toBe('failed');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return mapped execution when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.getById('exec-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('exec-1');
      expect(result!.parentId).toBe('conv-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.state).toBe('completed');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('should query by id with correct SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getById('exec-xyz');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(sql).toContain('WHERE id = $1');
      expect(params[0]).toBe('exec-xyz');
    });

    it('should parse startedAt as Date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.getById('exec-1');

      expect(result!.startedAt).toBeInstanceOf(Date);
      expect(result!.startedAt.toISOString()).toBe(NOW_ISO);
    });

    it('should parse completedAt as Date when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.getById('exec-1');

      expect(result!.completedAt).toBeInstanceOf(Date);
      expect(result!.completedAt!.toISOString()).toBe(COMPLETED_ISO);
    });

    it('should set completedAt to null when row field is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow({ completed_at: null }));

      const result = await repo.getById('exec-1');

      expect(result!.completedAt).toBeNull();
    });

    it('should parse plan JSON from string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.getById('exec-1');

      expect(result!.plan).toEqual(SAMPLE_PLAN);
      expect(result!.plan.description).toBe(SAMPLE_PLAN.description);
      expect(result!.plan.strategy).toBe('sequential');
    });

    it('should parse taskResults JSON from string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.getById('exec-1');

      expect(result!.taskResults).toEqual(SAMPLE_TASK_RESULTS);
      expect(result!.taskResults).toHaveLength(2);
    });

    it('should return error as undefined when row error is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow({ error: null }));

      const result = await repo.getById('exec-1');

      expect(result!.error).toBeUndefined();
    });

    it('should return error string when row has error', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow({ error: 'Task failed' }));

      const result = await repo.getById('exec-1');

      expect(result!.error).toBe('Task failed');
    });

    it('should default totalDurationMs to 0 when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow({ total_duration_ms: null }));

      const result = await repo.getById('exec-1');

      expect(result!.totalDurationMs).toBe(0);
    });

    it('should use fallback for invalid plan JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow({ plan: 'not-valid-json{{{' }));

      const result = await repo.getById('exec-1');

      expect(result!.plan).toEqual({ description: '', tasks: [], strategy: 'sequential' });
    });

    it('should use empty array fallback for invalid taskResults JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeExecutionRow({ task_results: 'not-valid-json{{{' })
      );

      const result = await repo.getById('exec-1');

      expect(result!.taskResults).toEqual([]);
    });

    it('should pass through already-parsed plan object (line 56 parseJson non-string branch)', async () => {
      // PostgreSQL adapters may return JSON columns as already-parsed objects
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeExecutionRow({ plan: SAMPLE_PLAN }) // object, not string
      );

      const result = await repo.getById('exec-1');

      expect(result!.plan).toEqual(SAMPLE_PLAN);
    });

    it('should pass through already-parsed taskResults array (line 56 parseJson non-string branch)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeExecutionRow({ task_results: SAMPLE_TASK_RESULTS }) // array, not string
      );

      const result = await repo.getById('exec-1');

      expect(result!.taskResults).toEqual(SAMPLE_TASK_RESULTS);
    });
  });

  // =========================================================================
  // cleanupOld
  // =========================================================================

  describe('cleanupOld', () => {
    it('should issue DELETE with RETURNING id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.cleanupOld(30);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM orchestra_executions');
      expect(sql).toContain('RETURNING id');
    });

    it('should use started_at age filter in WHERE clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.cleanupOld(30);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('started_at');
      expect(sql).toContain('$1');
    });

    it('should pass retentionDays as query param', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.cleanupOld(14);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(14);
    });

    it('should return count of deleted rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { id: 'exec-old-1' },
        { id: 'exec-old-2' },
        { id: 'exec-old-3' },
      ]);

      const count = await repo.cleanupOld(30);

      expect(count).toBe(3);
    });

    it('should return 0 when no rows deleted', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const count = await repo.cleanupOld(30);

      expect(count).toBe(0);
    });

    it('should use default retentionDays of 30', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.cleanupOld();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(30);
    });

    it('should return 1 when single row deleted', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ id: 'exec-stale' }]);

      const count = await repo.cleanupOld(7);

      expect(count).toBe(1);
    });
  });
});
