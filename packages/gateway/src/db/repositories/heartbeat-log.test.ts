/**
 * Heartbeat Log Repository Tests
 *
 * Unit tests for HeartbeatLogRepository: create, getRecent, getLatest,
 * list, listByAgent, count, getStats, getLatestByAgentIds, and edge cases.
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

// ---------------------------------------------------------------------------
// Dynamic import after mocks
// ---------------------------------------------------------------------------

const { HeartbeatLogRepository, getHeartbeatLogRepository } = await import('./heartbeat-log.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeartbeatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hb-log-1',
    agent_id: 'agent-1',
    soul_version: 3,
    tasks_run: '[{"id":"t1","name":"reflect"}]',
    tasks_skipped: '[{"id":"t2","reason":"not due"}]',
    tasks_failed: '[]',
    duration_ms: 1200,
    token_usage: '{"input":100,"output":200}',
    cost: '0.05',
    created_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeartbeatLogRepository', () => {
  let repo: InstanceType<typeof HeartbeatLogRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new HeartbeatLogRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should execute INSERT with all serialized fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.create({
        agentId: 'agent-1',
        soulVersion: 3,
        tasksRun: [{ id: 't1', name: 'reflect' }],
        tasksSkipped: [{ id: 't2', reason: 'not due' }],
        tasksFailed: [],
        durationMs: 1200,
        tokenUsage: { input: 100, output: 200 },
        cost: 0.05,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO heartbeat_log');
      expect(sql).toContain('agent_id');
      expect(sql).toContain('soul_version');
      expect(sql).toContain('tasks_run');
      expect(sql).toContain('tasks_skipped');
      expect(sql).toContain('tasks_failed');
      expect(sql).toContain('duration_ms');
      expect(sql).toContain('token_usage');
      expect(sql).toContain('cost');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('agent-1'); // agent_id
      expect(params[1]).toBe(3); // soul_version
      expect(params[2]).toBe('[{"id":"t1","name":"reflect"}]'); // tasks_run JSON
      expect(params[3]).toBe('[{"id":"t2","reason":"not due"}]'); // tasks_skipped JSON
      expect(params[4]).toBe('[]'); // tasks_failed JSON
      expect(params[5]).toBe(1200); // duration_ms
      expect(params[6]).toBe('{"input":100,"output":200}'); // token_usage JSON
      expect(params[7]).toBe(0.05); // cost
    });

    it('should serialize empty arrays correctly', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.create({
        agentId: 'agent-2',
        soulVersion: 1,
        tasksRun: [],
        tasksSkipped: [],
        tasksFailed: [],
        durationMs: 500,
        tokenUsage: { input: 50, output: 80 },
        cost: 0,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe('[]');
      expect(params[3]).toBe('[]');
      expect(params[4]).toBe('[]');
    });

    it('should not return a value (void)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.create({
        agentId: 'agent-3',
        soulVersion: 0,
        tasksRun: [],
        tasksSkipped: [],
        tasksFailed: [],
        durationMs: 0,
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
      });

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // getRecent
  // =========================================================================

  describe('getRecent', () => {
    it('should return mapped entries ordered by created_at DESC', async () => {
      const rows = [
        makeHeartbeatRow({ id: 'hb-log-3', created_at: '2024-06-03T12:00:00Z' }),
        makeHeartbeatRow({ id: 'hb-log-2', created_at: '2024-06-02T12:00:00Z' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getRecent('agent-1', 5);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('hb-log-3');
      expect(result[1]!.id).toBe('hb-log-2');
    });

    it('should query with correct SQL, agentId and limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getRecent('agent-42', 10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM heartbeat_log WHERE agent_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $2');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['agent-42', 10]);
    });

    it('should return empty array when no recent entries', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getRecent('agent-empty', 5);

      expect(result).toEqual([]);
    });

    it('should map all row fields correctly', async () => {
      const row = makeHeartbeatRow({
        tasks_run: '[{"id":"t1","name":"goal_check"}]',
        tasks_failed: '[{"id":"t2","error":"timeout"}]',
        token_usage: '{"input":300,"output":150}',
        cost: '0.12',
        soul_version: 5,
        duration_ms: 3500,
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.getRecent('agent-1', 1);

      expect(result[0]!.tasksRun).toEqual([{ id: 't1', name: 'goal_check' }]);
      expect(result[0]!.tasksFailed).toEqual([{ id: 't2', error: 'timeout' }]);
      expect(result[0]!.tokenUsage).toEqual({ input: 300, output: 150 });
      expect(result[0]!.cost).toBeCloseTo(0.12);
      expect(result[0]!.soulVersion).toBe(5);
      expect(result[0]!.durationMs).toBe(3500);
      expect(result[0]!.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // getLatest
  // =========================================================================

  describe('getLatest', () => {
    it('should return the most recent entry for an agent', async () => {
      const row = makeHeartbeatRow({ id: 'hb-log-latest', created_at: '2024-06-15T10:00:00Z' });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.getLatest('agent-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('hb-log-latest');
      expect(result!.agentId).toBe('agent-1');
    });

    it('should query with correct SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getLatest('agent-99');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM heartbeat_log WHERE agent_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT 1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['agent-99']);
    });

    it('should return null when no entry exists for agent', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getLatest('agent-nonexistent');

      expect(result).toBeNull();
    });

    it('should handle null soul_version by defaulting to 0', async () => {
      const row = makeHeartbeatRow({ soul_version: null });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.getLatest('agent-1');

      expect(result!.soulVersion).toBe(0);
    });

    it('should handle null duration_ms by defaulting to 0', async () => {
      const row = makeHeartbeatRow({ duration_ms: null });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.getLatest('agent-1');

      expect(result!.durationMs).toBe(0);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return all entries with pagination', async () => {
      const rows = [
        makeHeartbeatRow({ id: 'hb-log-1', agent_id: 'agent-1' }),
        makeHeartbeatRow({ id: 'hb-log-2', agent_id: 'agent-2' }),
        makeHeartbeatRow({ id: 'hb-log-3', agent_id: 'agent-1' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.list(50, 0);

      expect(result).toHaveLength(3);
      expect(result[0]!.id).toBe('hb-log-1');
      expect(result[2]!.agentId).toBe('agent-1');
    });

    it('should query with correct SQL, LIMIT and OFFSET', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list(25, 50);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM heartbeat_log');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $1 OFFSET $2');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([25, 50]);
    });

    it('should return empty array when no entries exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list(10, 0);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // listByAgent
  // =========================================================================

  describe('listByAgent', () => {
    it('should return entries for a specific agent with pagination', async () => {
      const rows = [
        makeHeartbeatRow({ id: 'hb-log-1', agent_id: 'agent-5' }),
        makeHeartbeatRow({ id: 'hb-log-2', agent_id: 'agent-5' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.listByAgent('agent-5', 10, 0);

      expect(result).toHaveLength(2);
      expect(result[0]!.agentId).toBe('agent-5');
    });

    it('should query with correct SQL including agent filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByAgent('agent-77', 5, 10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM heartbeat_log WHERE agent_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['agent-77', 5, 10]);
    });

    it('should return empty array when agent has no log entries', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByAgent('agent-empty', 20, 0);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return total count of all heartbeat log entries', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '150' });

      const result = await repo.count();

      expect(result).toBe(150);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT COUNT(*) AS count FROM heartbeat_log');
    });

    it('should return 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });

    it('should return 0 when count is 0', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      const result = await repo.count();

      expect(result).toBe(0);
    });

    it('should return integer not string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '99' });

      const result = await repo.count();

      expect(typeof result).toBe('number');
      expect(result).toBe(99);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('should return aggregate stats without agentId filter', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_cycles: '20',
        total_cost: '1.50',
        avg_duration: '800',
        failure_count: '4',
      });

      const result = await repo.getStats();

      expect(result.totalCycles).toBe(20);
      expect(result.totalCost).toBeCloseTo(1.5);
      expect(result.avgDurationMs).toBeCloseTo(800);
      expect(result.failureRate).toBeCloseTo(4 / 20);
    });

    it('should return stats filtered by agentId when provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_cycles: '5',
        total_cost: '0.25',
        avg_duration: '600',
        failure_count: '1',
      });

      const result = await repo.getStats('agent-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE agent_id = $1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['agent-1']);

      expect(result.totalCycles).toBe(5);
      expect(result.failureRate).toBeCloseTo(1 / 5);
    });

    it('should not include WHERE clause when agentId is not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_cycles: '10',
        total_cost: '0.5',
        avg_duration: '700',
        failure_count: '0',
      });

      await repo.getStats();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).not.toContain('WHERE agent_id');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual([]);
    });

    it('should return failureRate of 0 when totalCycles is 0', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_cycles: '0',
        total_cost: '0',
        avg_duration: '0',
        failure_count: '0',
      });

      const result = await repo.getStats();

      expect(result.totalCycles).toBe(0);
      expect(result.failureRate).toBe(0);
    });

    it('should handle null queryOne result with zero defaults', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getStats();

      expect(result.totalCycles).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.avgDurationMs).toBe(0);
      expect(result.failureRate).toBe(0);
    });
  });

  // =========================================================================
  // getLatestByAgentIds
  // =========================================================================

  describe('getLatestByAgentIds', () => {
    it('should return an empty Map when agentIds is empty', async () => {
      const result = await repo.getLatestByAgentIds([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should return a Map keyed by agent_id', async () => {
      const rows = [
        makeHeartbeatRow({ id: 'hb-1', agent_id: 'agent-A' }),
        makeHeartbeatRow({ id: 'hb-2', agent_id: 'agent-B' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getLatestByAgentIds(['agent-A', 'agent-B']);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.has('agent-A')).toBe(true);
      expect(result.has('agent-B')).toBe(true);
      expect(result.get('agent-A')!.id).toBe('hb-1');
      expect(result.get('agent-B')!.id).toBe('hb-2');
    });

    it('should query with DISTINCT ON and IN clause using positional placeholders', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLatestByAgentIds(['agent-X', 'agent-Y', 'agent-Z']);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('DISTINCT ON (agent_id)');
      expect(sql).toContain('FROM heartbeat_log');
      expect(sql).toContain('WHERE agent_id IN ($1, $2, $3)');
      expect(sql).toContain('ORDER BY agent_id, created_at DESC');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['agent-X', 'agent-Y', 'agent-Z']);
    });

    it('should return empty Map when no rows match', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getLatestByAgentIds(['agent-ghost']);

      expect(result.size).toBe(0);
    });

    it('should handle single agentId correctly', async () => {
      const row = makeHeartbeatRow({ agent_id: 'agent-solo' });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.getLatestByAgentIds(['agent-solo']);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE agent_id IN ($1)');
      expect(result.get('agent-solo')).toBeDefined();
    });

    it('should correctly map all entry fields', async () => {
      const row = makeHeartbeatRow({
        agent_id: 'agent-full',
        soul_version: 7,
        tasks_run: '[{"id":"r1","name":"evolve"}]',
        tasks_skipped: '[{"id":"s1"}]',
        tasks_failed: '[{"id":"f1","error":"crash"}]',
        duration_ms: 2500,
        token_usage: '{"input":400,"output":600}',
        cost: '0.25',
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.getLatestByAgentIds(['agent-full']);
      const entry = result.get('agent-full')!;

      expect(entry.soulVersion).toBe(7);
      expect(entry.tasksRun).toEqual([{ id: 'r1', name: 'evolve' }]);
      expect(entry.tasksSkipped).toEqual([{ id: 's1' }]);
      expect(entry.tasksFailed).toEqual([{ id: 'f1', error: 'crash' }]);
      expect(entry.durationMs).toBe(2500);
      expect(entry.tokenUsage).toEqual({ input: 400, output: 600 });
      expect(entry.cost).toBeCloseTo(0.25);
      expect(entry.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // Row mapper edge cases
  // =========================================================================

  describe('row mapper edge cases', () => {
    it('should default soulVersion to 0 when null', async () => {
      const row = makeHeartbeatRow({ soul_version: null });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.list(10, 0);

      expect(result[0]!.soulVersion).toBe(0);
    });

    it('should default durationMs to 0 when null', async () => {
      const row = makeHeartbeatRow({ duration_ms: null });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.list(10, 0);

      expect(result[0]!.durationMs).toBe(0);
    });

    it('should parse cost as float from string', async () => {
      const row = makeHeartbeatRow({ cost: '3.14159' });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.list(10, 0);

      expect(result[0]!.cost).toBeCloseTo(3.14159);
    });

    it('should default cost to 0 when cost field is null or empty', async () => {
      const row = makeHeartbeatRow({ cost: null });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.list(10, 0);

      // parseFloat(null ?? '0') -> parseFloat('0') -> 0
      expect(result[0]!.cost).toBe(0);
    });

    it('should fall back to empty arrays for invalid JSON fields', async () => {
      const row = makeHeartbeatRow({
        tasks_run: 'not-json',
        tasks_skipped: '',
        tasks_failed: 'bad',
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.list(10, 0);

      expect(result[0]!.tasksRun).toEqual([]);
      expect(result[0]!.tasksSkipped).toEqual([]);
      expect(result[0]!.tasksFailed).toEqual([]);
    });

    it('should fall back to default tokenUsage for invalid JSON', async () => {
      const row = makeHeartbeatRow({ token_usage: 'invalid' });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.list(10, 0);

      expect(result[0]!.tokenUsage).toEqual({ input: 0, output: 0 });
    });
  });

  // =========================================================================
  // getHeartbeatLogRepository singleton
  // =========================================================================

  describe('getHeartbeatLogRepository', () => {
    it('should return a HeartbeatLogRepository instance', () => {
      const instance = getHeartbeatLogRepository();
      expect(instance).toBeInstanceOf(HeartbeatLogRepository);
    });

    it('should return the same instance on repeated calls', () => {
      const a = getHeartbeatLogRepository();
      const b = getHeartbeatLogRepository();
      expect(a).toBe(b);
    });
  });
});
