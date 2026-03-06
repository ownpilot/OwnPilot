/**
 * Background Agents Repository Tests
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
    generateId: vi.fn().mockReturnValue('bg-generated-id'),
  };
});

const { BackgroundAgentsRepository } = await import('./background-agents.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bg-1',
    user_id: 'user-1',
    name: 'Test Agent',
    mission: 'Monitor goals',
    mode: 'interval',
    allowed_tools: '[]',
    limits: JSON.stringify({
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 120000,
    }),
    interval_ms: 300000,
    event_filters: null,
    auto_start: true,
    stop_condition: null,
    created_by: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: 'bg-1',
    state: 'running',
    cycles_completed: 5,
    total_tool_calls: 20,
    total_cost_usd: '0.0500',
    last_cycle_at: '2026-01-01T01:00:00Z',
    last_cycle_duration_ms: 3000,
    last_cycle_error: null,
    started_at: '2026-01-01T00:00:00Z',
    stopped_at: null,
    persistent_context: '{}',
    inbox: '[]',
    ...overrides,
  };
}

function makeHistoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hist-1',
    agent_id: 'bg-1',
    cycle_number: 1,
    success: true,
    tool_calls: '[]',
    output_message: 'Done',
    tokens_used: JSON.stringify({ prompt: 100, completion: 50 }),
    cost_usd: '0.0010',
    duration_ms: 2000,
    turns: 3,
    error: null,
    executed_at: '2026-01-01T00:01:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundAgentsRepository', () => {
  let repo: InstanceType<typeof BackgroundAgentsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new BackgroundAgentsRepository();
  });

  // ---- Agent CRUD ----

  describe('create', () => {
    it('inserts a new agent and returns the config', async () => {
      const row = makeAgentRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        id: 'bg-1',
        userId: 'user-1',
        name: 'Test Agent',
        mission: 'Monitor goals',
        mode: 'interval',
        allowedTools: [],
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
        },
        autoStart: true,
        createdBy: 'user',
      });

      expect(result.id).toBe('bg-1');
      expect(result.name).toBe('Test Agent');
      expect(result.mode).toBe('interval');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO background_agents');
    });

    it('throws when getById returns null after insert (line 177)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getById returns null

      await expect(
        repo.create({
          id: 'bg-fail',
          userId: 'user-1',
          name: 'Fail Agent',
          mission: 'Mission',
          mode: 'interval',
          allowedTools: [],
          limits: {
            maxTurnsPerCycle: 10,
            maxToolCallsPerCycle: 50,
            maxCyclesPerHour: 60,
            cycleTimeoutMs: 120000,
          },
          autoStart: false,
          createdBy: 'user',
        })
      ).rejects.toThrow('Failed to create background agent');
    });
  });

  describe('getById', () => {
    it('returns config when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      const result = await repo.getById('bg-1', 'user-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('bg-1');
      expect(result!.userId).toBe('user-1');
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.getById('bg-999', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    it('returns all agents for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeAgentRow(),
        makeAgentRow({ id: 'bg-2', name: 'Agent 2' }),
      ]);

      const results = await repo.getAll('user-1');
      expect(results).toHaveLength(2);
    });
  });

  describe('getAutoStartAgents', () => {
    it('returns agents with auto_start=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeAgentRow()]);
      const results = await repo.getAutoStartAgents();
      expect(results).toHaveLength(1);
      expect(results[0]!.autoStart).toBe(true);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('auto_start = true');
    });
  });

  describe('update', () => {
    it('updates specified fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ name: 'Updated' }));

      const result = await repo.update('bg-1', 'user-1', { name: 'Updated' });
      expect(result).not.toBeNull();

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE background_agents');
      expect(sql).toContain('name =');
    });

    it('returns current config when no updates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      const result = await repo.update('bg-1', 'user-1', {});
      expect(result).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true when agent is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });
      const result = await repo.delete('bg-1', 'user-1');
      expect(result).toBe(true);
    });

    it('returns false when agent not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0, rowCount: 0 });
      const result = await repo.delete('bg-999', 'user-1');
      expect(result).toBe(false);
    });
  });

  // ---- Sessions ----

  describe('saveSession', () => {
    it('upserts session data', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });

      await repo.saveSession('bg-1', {
        state: 'running',
        cyclesCompleted: 5,
        totalToolCalls: 20,
        totalCostUsd: 0.05,
        lastCycleAt: new Date('2026-01-01T01:00:00Z'),
        lastCycleDurationMs: 3000,
        lastCycleError: null,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        stoppedAt: null,
        persistentContext: {},
        inbox: [],
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO background_agent_sessions');
      expect(sql).toContain('ON CONFLICT');
    });
  });

  describe('loadSession', () => {
    it('returns parsed session when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.loadSession('bg-1');
      expect(result).not.toBeNull();
      expect(result!.state).toBe('running');
      expect(result!.cyclesCompleted).toBe(5);
      expect(result!.totalCostUsd).toBeCloseTo(0.05);
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.loadSession('bg-999');
      expect(result).toBeNull();
    });
  });

  describe('getInterruptedSessions', () => {
    it('returns agents with running/waiting sessions', async () => {
      const row = {
        ...makeAgentRow(),
        session_state: 'running',
      };
      mockAdapter.query.mockResolvedValueOnce([row]);

      const results = await repo.getInterruptedSessions();
      expect(results).toHaveLength(1);
      expect(results[0]!.state).toBe('running');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("IN ('running', 'waiting')");
    });
  });

  describe('appendToInbox', () => {
    it('appends message to inbox via JSON concat', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });

      await repo.appendToInbox('bg-1', 'Hello agent');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('inbox = inbox ||');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('bg-1');
      expect(params[1]).toBe('["Hello agent"]');
    });
  });

  // ---- History ----

  describe('saveHistory', () => {
    it('inserts a cycle history entry', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });

      await repo.saveHistory('bg-1', 1, {
        success: true,
        toolCalls: [],
        outputMessage: 'Done',
        tokensUsed: { prompt: 100, completion: 50 },
        durationMs: 2000,
        turns: 3,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO background_agent_history');
    });
  });

  describe('getHistory', () => {
    it('returns paginated history with total count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });
      mockAdapter.query.mockResolvedValueOnce([
        makeHistoryRow(),
        makeHistoryRow({ id: 'hist-2', cycle_number: 2 }),
      ]);

      const result = await repo.getHistory('bg-1', 10, 0);
      expect(result.total).toBe(3);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.success).toBe(true);
    });
  });

  describe('cleanupOldHistory', () => {
    it('deletes entries older than retention days', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5, rowCount: 5 });

      const count = await repo.cleanupOldHistory(30);
      expect(count).toBe(5);

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM background_agent_history');
    });

    it('returns 0 when no rows deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0, rowCount: 0 });
      const count = await repo.cleanupOldHistory(7);
      expect(count).toBe(0);
    });
  });

  describe('deleteSession', () => {
    it('deletes the session for an agent', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, rowCount: 1 });

      await repo.deleteSession('bg-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM background_agent_sessions WHERE agent_id = $1');
      expect(mockAdapter.execute.mock.calls[0]![1]).toEqual(['bg-1']);
    });
  });

  describe('clearInbox', () => {
    it('returns an empty array (inbox cleared via runner)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ inbox: '[]' });

      const result = await repo.clearInbox('bg-1');

      expect(result).toEqual([]);
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain("SET inbox = '[]'");
      expect(sql).toContain('RETURNING inbox');
    });
  });

  describe('update — additional fields', () => {
    it('updates mission field', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.update('bg-1', 'user-1', { mission: 'New mission' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('mission =');
    });

    it('updates mode field', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.update('bg-1', 'user-1', { mode: 'event' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('mode =');
    });

    it('updates allowedTools field', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.update('bg-1', 'user-1', { allowedTools: ['tool_a', 'tool_b'] });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('allowed_tools =');
    });

    it('updates limits, intervalMs, eventFilters', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.update('bg-1', 'user-1', {
        limits: {
          maxTurnsPerCycle: 5,
          maxToolCallsPerCycle: 20,
          maxCyclesPerHour: 10,
          cycleTimeoutMs: 60000,
        },
        intervalMs: 600000,
        eventFilters: ['goal.created'],
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('limits =');
      expect(sql).toContain('interval_ms =');
      expect(sql).toContain('event_filters =');
    });

    it('updates autoStart, stopCondition, provider, model, workspaceId, skills', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.update('bg-1', 'user-1', {
        autoStart: false,
        stopCondition: 'task_complete',
        provider: 'openai',
        model: 'gpt-4',
        workspaceId: 'ws-1',
        skills: ['skill-a'],
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('auto_start =');
      expect(sql).toContain('stop_condition =');
      expect(sql).toContain('provider =');
      expect(sql).toContain('model =');
      expect(sql).toContain('workspace_id =');
      expect(sql).toContain('skills =');
    });
  });

  describe('loadSession — edge cases', () => {
    it('returns null for lastCycleAt when row has null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ last_cycle_at: null }));
      const result = await repo.loadSession('bg-1');
      expect(result!.lastCycleAt).toBeNull();
    });

    it('returns null for stoppedAt when row has null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ stopped_at: null }));
      const result = await repo.loadSession('bg-1');
      expect(result!.stoppedAt).toBeNull();
    });
  });

  describe('getHistory — history row mapping', () => {
    it('maps null tokens_used and cost_usd to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });
      mockAdapter.query.mockResolvedValueOnce([
        makeHistoryRow({ tokens_used: null, cost_usd: null, error: 'timeout' }),
      ]);

      const result = await repo.getHistory('bg-1', 10, 0);
      expect(result.entries[0]!.tokensUsed).toBeUndefined();
      expect(result.entries[0]!.costUsd).toBeUndefined();
      expect(result.entries[0]!.error).toBe('timeout');
    });
  });

  describe('create — with optional fields', () => {
    it('passes intervalMs, eventFilters, stopCondition, provider, model, skills', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ interval_ms: 600000 }));

      await repo.create({
        id: 'bg-2',
        userId: 'user-1',
        name: 'Full Agent',
        mission: 'Be thorough',
        mode: 'event',
        allowedTools: ['tool_a'],
        limits: {
          maxTurnsPerCycle: 5,
          maxToolCallsPerCycle: 20,
          maxCyclesPerHour: 10,
          cycleTimeoutMs: 60000,
        },
        intervalMs: 600000,
        eventFilters: ['event.created'],
        autoStart: false,
        stopCondition: 'done',
        provider: 'anthropic',
        model: 'claude-3',
        skills: ['skill-1'],
        createdBy: 'system',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(600000); // intervalMs
      expect(params).toContain('["event.created"]'); // eventFilters
      expect(params).toContain('done'); // stopCondition
      expect(params).toContain('anthropic'); // provider
      expect(params).toContain('claude-3'); // model
    });
  });
});

const { getBackgroundAgentsRepository, createBackgroundAgentsRepository } =
  await import('./background-agents.js');

describe('BackgroundAgentsRepository factory functions', () => {
  it('getBackgroundAgentsRepository returns a singleton', () => {
    const r1 = getBackgroundAgentsRepository();
    const r2 = getBackgroundAgentsRepository();
    expect(r1).toBe(r2);
    expect(r1).toBeInstanceOf(BackgroundAgentsRepository);
  });

  it('createBackgroundAgentsRepository creates a new instance each time', () => {
    const r1 = createBackgroundAgentsRepository();
    const r2 = createBackgroundAgentsRepository();
    expect(r1).not.toBe(r2);
    expect(r1).toBeInstanceOf(BackgroundAgentsRepository);
  });
});
