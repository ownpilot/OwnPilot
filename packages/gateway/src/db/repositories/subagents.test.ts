/**
 * Subagents Repository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  execute: vi.fn().mockResolvedValue({ changes: 0, rowCount: 0 }),
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

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('sub-generated-id'),
  };
});

const { SubagentsRepository } = await import('./subagents.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeHistoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    parent_id: 'conv-1',
    parent_type: 'chat',
    user_id: 'user-1',
    name: 'Research pricing',
    task: 'Find competitor pricing data',
    state: 'completed',
    result: 'Found 3 competitors...',
    error: null,
    tool_calls: JSON.stringify([
      { tool: 'web_search', args: { q: 'pricing' }, result: 'ok', success: true, durationMs: 500 },
    ]),
    turns_used: 3,
    tool_calls_used: 1,
    tokens_used: JSON.stringify({ prompt: 100, completion: 200 }),
    duration_ms: 5000,
    provider: 'openai',
    model: 'gpt-4o-mini',
    spawned_at: '2026-03-01T10:00:00Z',
    completed_at: '2026-03-01T10:00:05Z',
    ...overrides,
  };
}

function makeSession() {
  return {
    id: 'sub-1',
    parentId: 'conv-1',
    parentType: 'chat' as const,
    userId: 'user-1',
    name: 'Research pricing',
    task: 'Find competitor pricing data',
    state: 'completed' as const,
    result: 'Found 3 competitors',
    error: null,
    toolCalls: [
      { tool: 'web_search', args: { q: 'pricing' }, result: 'ok', success: true, durationMs: 500 },
    ],
    turnsUsed: 3,
    toolCallsUsed: 1,
    tokensUsed: { prompt: 100, completion: 200 },
    durationMs: 5000,
    provider: 'openai',
    model: 'gpt-4o-mini',
    spawnedAt: new Date('2026-03-01T10:00:00Z'),
    startedAt: new Date('2026-03-01T10:00:00Z'),
    completedAt: new Date('2026-03-01T10:00:05Z'),
    limits: { maxTurns: 20, maxToolCalls: 100, timeoutMs: 120000, maxTokens: 8192 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubagentsRepository', () => {
  let repo: InstanceType<typeof SubagentsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new SubagentsRepository();
  });

  // -------------------------------------------------------------------------
  // saveExecution
  // -------------------------------------------------------------------------

  describe('saveExecution', () => {
    it('inserts a completed session into subagent_history', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const session = makeSession();

      await repo.saveExecution(session);

      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO subagent_history');
      expect(params[0]).toBe('sub-1');
      expect(params[1]).toBe('conv-1');
      expect(params[2]).toBe('chat');
      expect(params[3]).toBe('user-1');
      expect(params[4]).toBe('Research pricing');
      expect(params[6]).toBe('completed');
      expect(params[7]).toBe('Found 3 competitors');
      expect(params[8]).toBeNull(); // error
      expect(params[14]).toBe('openai');
      expect(params[15]).toBe('gpt-4o-mini');
    });

    it('handles null tokensUsed', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const session = makeSession();
      session.tokensUsed = null;

      await repo.saveExecution(session);

      const params = mockAdapter.query.mock.calls[0][1];
      expect(params[12]).toBeNull(); // tokens_used
    });

    it('serializes tool calls as JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const session = makeSession();

      await repo.saveExecution(session);

      const params = mockAdapter.query.mock.calls[0][1];
      const toolCalls = JSON.parse(params[9]);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe('web_search');
    });
  });

  // -------------------------------------------------------------------------
  // getHistory
  // -------------------------------------------------------------------------

  describe('getHistory', () => {
    it('returns paginated history for a parent', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '2' }])
        .mockResolvedValueOnce([
          makeHistoryRow(),
          makeHistoryRow({ id: 'sub-2', name: 'Analyze data' }),
        ]);

      const result = await repo.getHistory('conv-1', 20, 0);

      expect(result.total).toBe(2);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].parentId).toBe('conv-1');
      expect(result.entries[0].name).toBe('Research pricing');
      expect(result.entries[1].name).toBe('Analyze data');
    });

    it('uses correct SQL with pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.getHistory('conv-1', 10, 5);

      const [countSql, countParams] = mockAdapter.query.mock.calls[0];
      expect(countSql).toContain('COUNT(*)');
      expect(countParams).toEqual(['conv-1']);

      const [dataSql, dataParams] = mockAdapter.query.mock.calls[1];
      expect(dataSql).toContain('ORDER BY spawned_at DESC');
      expect(dataSql).toContain('LIMIT');
      expect(dataParams).toEqual(['conv-1', 10, 5]);
    });

    it('returns empty when no entries exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      const result = await repo.getHistory('conv-1');
      expect(result.total).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it('parses tool_calls JSON correctly', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeHistoryRow()]);

      const result = await repo.getHistory('conv-1');
      expect(result.entries[0].toolCalls).toHaveLength(1);
      expect(result.entries[0].toolCalls[0].tool).toBe('web_search');
      expect(result.entries[0].toolCalls[0].success).toBe(true);
    });

    it('parses tokens_used JSON correctly', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeHistoryRow()]);

      const result = await repo.getHistory('conv-1');
      expect(result.entries[0].tokensUsed).toEqual({ prompt: 100, completion: 200 });
    });

    it('handles null tokens_used', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeHistoryRow({ tokens_used: null })]);

      const result = await repo.getHistory('conv-1');
      expect(result.entries[0].tokensUsed).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getByUser
  // -------------------------------------------------------------------------

  describe('getByUser', () => {
    it('returns history for a specific user', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeHistoryRow()]);

      const result = await repo.getByUser('user-1', 20, 0);

      expect(result.total).toBe(1);
      expect(result.entries[0].userId).toBe('user-1');
    });

    it('uses user_id in WHERE clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await repo.getByUser('user-42');

      const [countSql, countParams] = mockAdapter.query.mock.calls[0];
      expect(countSql).toContain('user_id');
      expect(countParams).toEqual(['user-42']);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupOld
  // -------------------------------------------------------------------------

  describe('cleanupOld', () => {
    it('deletes old entries and returns count', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ id: 'sub-old-1' }, { id: 'sub-old-2' }]);

      const count = await repo.cleanupOld(30);

      expect(count).toBe(2);
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('DELETE FROM subagent_history');
      expect(sql).toContain('INTERVAL');
      expect(params).toEqual([30]);
    });

    it('defaults to 30 day retention', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.cleanupOld();

      const params = mockAdapter.query.mock.calls[0][1];
      expect(params).toEqual([30]);
    });

    it('returns 0 when nothing to clean', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const count = await repo.cleanupOld(7);
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Row mapping
  // -------------------------------------------------------------------------

  describe('row mapping', () => {
    it('maps spawned_at and completed_at to Date objects', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeHistoryRow()]);

      const result = await repo.getHistory('conv-1');
      const entry = result.entries[0];

      expect(entry.spawnedAt).toBeInstanceOf(Date);
      expect(entry.completedAt).toBeInstanceOf(Date);
    });

    it('handles null completed_at', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([makeHistoryRow({ completed_at: null })]);

      const result = await repo.getHistory('conv-1');
      expect(result.entries[0].completedAt).toBeNull();
    });
  });
});
