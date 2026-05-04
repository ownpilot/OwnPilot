/**
 * Claws Repository Tests
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
    generateId: vi.fn().mockReturnValue('ch-generated-id'),
  };
});

const { ClawsRepository } = await import('./claws.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeClawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claw-1',
    user_id: 'user-1',
    name: 'Research Claw',
    mission: 'Research market trends',
    mode: 'continuous',
    allowed_tools: '[]',
    limits: JSON.stringify({
      maxTurnsPerCycle: 20,
      maxToolCallsPerCycle: 100,
      maxCyclesPerHour: 30,
      cycleTimeoutMs: 300000,
    }),
    interval_ms: 300000,
    auto_start: false,
    stop_condition: null,
    provider: null,
    model: null,
    workspace_id: null,
    soul_id: null,
    parent_claw_id: null,
    depth: 0,
    sandbox: 'auto',
    coding_agent_provider: null,
    skills: '[]',
    preset: null,
    mission_contract: '{}',
    autonomy_policy: '{}',
    created_by: 'user',
    created_at: '2026-03-18T00:00:00Z',
    updated_at: '2026-03-18T00:00:00Z',
    ...overrides,
  };
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    claw_id: 'claw-1',
    state: 'running',
    cycles_completed: 5,
    total_tool_calls: 42,
    total_cost_usd: '0.1200',
    last_cycle_at: '2026-03-18T01:00:00Z',
    last_cycle_duration_ms: 5000,
    last_cycle_error: null,
    started_at: '2026-03-18T00:00:00Z',
    stopped_at: null,
    persistent_context: '{"key":"value"}',
    inbox: '["hello"]',
    artifacts: '["art-1"]',
    pending_escalation: null,
    ...overrides,
  };
}

function makeHistoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hist-1',
    claw_id: 'claw-1',
    cycle_number: 1,
    entry_type: 'cycle',
    success: true,
    tool_calls: '[]',
    output_message: 'Done',
    tokens_used: JSON.stringify({ prompt: 100, completion: 50 }),
    cost_usd: '0.0010',
    duration_ms: 2000,
    error: null,
    executed_at: '2026-03-18T01:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClawsRepository', () => {
  let repo: InstanceType<typeof ClawsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ClawsRepository();
  });

  // ---- CRUD ----

  describe('create', () => {
    it('should insert a claw and return config', async () => {
      const row = makeClawRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const config = await repo.create({
        id: 'claw-1',
        userId: 'user-1',
        name: 'Research Claw',
        mission: 'Research market trends',
        mode: 'continuous',
        allowedTools: [],
        limits: {
          maxTurnsPerCycle: 20,
          maxToolCallsPerCycle: 100,
          maxCyclesPerHour: 30,
          cycleTimeoutMs: 300000,
        },
        intervalMs: 300000,
        autoStart: false,
        depth: 0,
        sandbox: 'auto',
        createdBy: 'user',
      });

      expect(config.id).toBe('claw-1');
      expect(config.name).toBe('Research Claw');
      expect(config.mode).toBe('continuous');
      expect(config.depth).toBe(0);
      expect(config.sandbox).toBe('auto');

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO claws');
    });
  });

  describe('getById', () => {
    it('should return config when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeClawRow());
      const config = await repo.getById('claw-1', 'user-1');
      expect(config).not.toBeNull();
      expect(config!.id).toBe('claw-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const config = await repo.getById('claw-99', 'user-1');
      expect(config).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return all claws for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeClawRow(), makeClawRow({ id: 'claw-2' })]);
      const configs = await repo.getAll('user-1');
      expect(configs).toHaveLength(2);
    });
  });

  describe('getAutoStartClaws', () => {
    it('should return claws with auto_start=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeClawRow({ auto_start: true })]);
      const configs = await repo.getAutoStartClaws();
      expect(configs).toHaveLength(1);
      expect(configs[0].autoStart).toBe(true);
    });
  });

  describe('getChildClaws', () => {
    it('should return child claws', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeClawRow({ id: 'claw-child', parent_claw_id: 'claw-1', depth: 1 }),
      ]);
      const children = await repo.getChildClaws('claw-1');
      expect(children).toHaveLength(1);
      expect(children[0].parentClawId).toBe('claw-1');
      expect(children[0].depth).toBe(1);
    });
  });

  describe('update', () => {
    it('should update specified fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeClawRow({ name: 'Updated' }));

      const config = await repo.update('claw-1', 'user-1', { name: 'Updated' });
      expect(config).not.toBeNull();

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE claws SET');
      expect(sql).toContain('name =');
      expect(sql).toContain('updated_at = NOW()');
    });

    it('should return existing config when no updates provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeClawRow());
      const config = await repo.update('claw-1', 'user-1', {});
      expect(config).not.toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should handle multiple field updates', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeClawRow());

      await repo.update('claw-1', 'user-1', {
        name: 'New Name',
        mission: 'New mission',
        sandbox: 'docker',
        codingAgentProvider: 'claude-code',
      });

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('name =');
      expect(sql).toContain('mission =');
      expect(sql).toContain('sandbox =');
      expect(sql).toContain('coding_agent_provider =');
    });
  });

  describe('delete', () => {
    it('should return true on successful delete', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.delete('claw-1', 'user-1');
      expect(result).toBe(true);
    });

    it('should return false when claw not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      const result = await repo.delete('claw-99', 'user-1');
      expect(result).toBe(false);
    });
  });

  // ---- Session ----

  describe('saveSession', () => {
    it('should upsert session data', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.saveSession('claw-1', {
        state: 'running',
        cyclesCompleted: 5,
        totalToolCalls: 42,
        totalCostUsd: 0.12,
        lastCycleAt: new Date('2026-03-18T01:00:00Z'),
        lastCycleDurationMs: 5000,
        lastCycleError: null,
        startedAt: new Date('2026-03-18T00:00:00Z'),
        stoppedAt: null,
        persistentContext: { key: 'value' },
        inbox: ['hello'],
        artifacts: ['art-1'],
        pendingEscalation: null,
      });

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO claw_sessions');
      expect(sql).toContain('ON CONFLICT (claw_id) DO UPDATE');
    });

    it('should persist pending escalation when present', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.saveSession('claw-1', {
        state: 'escalation_pending',
        cyclesCompleted: 3,
        totalToolCalls: 10,
        totalCostUsd: 0.05,
        lastCycleAt: null,
        lastCycleDurationMs: null,
        lastCycleError: null,
        startedAt: new Date('2026-03-18T00:00:00Z'),
        stoppedAt: null,
        persistentContext: {},
        inbox: [],
        artifacts: [],
        pendingEscalation: {
          id: 'esc-1',
          type: 'sandbox_upgrade',
          reason: 'Need Docker',
          requestedAt: new Date('2026-03-18T02:00:00Z'),
        },
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      const escalationParam = params[params.length - 1] as string;
      expect(escalationParam).toContain('sandbox_upgrade');
    });
  });

  describe('loadSession', () => {
    it('should load and map session data', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const session = await repo.loadSession('claw-1');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('running');
      expect(session!.cyclesCompleted).toBe(5);
      expect(session!.totalCostUsd).toBeCloseTo(0.12);
      expect(session!.persistentContext).toEqual({ key: 'value' });
      expect(session!.inbox).toEqual(['hello']);
      expect(session!.artifacts).toEqual(['art-1']);
      expect(session!.pendingEscalation).toBeNull();
    });

    it('should return null when no session', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const session = await repo.loadSession('claw-99');
      expect(session).toBeNull();
    });

    it('should parse pending escalation', async () => {
      const escalation = {
        id: 'esc-1',
        type: 'budget_increase',
        reason: 'Over budget',
        requestedAt: '2026-03-18T02:00:00Z',
      };
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ pending_escalation: JSON.stringify(escalation) })
      );

      const session = await repo.loadSession('claw-1');
      expect(session!.pendingEscalation).not.toBeNull();
      expect(session!.pendingEscalation!.type).toBe('budget_increase');
    });
  });

  describe('getInterruptedSessions', () => {
    it('should return running/waiting sessions with configs', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ ...makeClawRow(), session_state: 'running' }]);

      const interrupted = await repo.getInterruptedSessions();
      expect(interrupted).toHaveLength(1);
      expect(interrupted[0].clawId).toBe('claw-1');
      expect(interrupted[0].state).toBe('running');
      expect(interrupted[0].config.name).toBe('Research Claw');
    });
  });

  describe('appendToInbox', () => {
    it('should append message to inbox JSONB array', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.appendToInbox('claw-1', 'New task for you');

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('inbox = inbox || $2::jsonb');
      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('["New task for you"]');
    });
  });

  // ---- History ----

  describe('saveHistory', () => {
    it('should insert a history entry', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.saveHistory('claw-1', 3, {
        success: true,
        output: 'All done',
        toolCalls: [
          { tool: 'search_web', args: { q: 'test' }, result: 'ok', success: true, durationMs: 100 },
        ],
        outputMessage: 'All done',
        tokensUsed: { prompt: 200, completion: 80 },
        costUsd: 0.003,
        durationMs: 4500,
        turns: 3,
      });

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO claw_history');

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('claw-1');
      expect(params[2]).toBe(3);
    });
  });

  describe('saveEscalationHistory', () => {
    it('should insert an escalation history entry', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.saveEscalationHistory('claw-1', 5, {
        id: 'esc-1',
        type: 'network_access',
        reason: 'Need to fetch external API',
        requestedAt: new Date(),
      });

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO claw_history');
      expect(sql).toContain("'escalation'");
    });
  });

  describe('getHistory', () => {
    it('should return paginated history with total', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '15' });
      mockAdapter.query.mockResolvedValueOnce([makeHistoryRow(), makeHistoryRow({ id: 'hist-2' })]);

      const { entries, total } = await repo.getHistory('claw-1', 10, 0);
      expect(total).toBe(15);
      expect(entries).toHaveLength(2);
      expect(entries[0].clawId).toBe('claw-1');
      expect(entries[0].entryType).toBe('cycle');
      expect(entries[0].success).toBe(true);
      expect(entries[0].tokensUsed).toEqual({ prompt: 100, completion: 50 });
      expect(entries[0].costUsd).toBeCloseTo(0.001);
    });
  });

  describe('cleanupOldHistory', () => {
    it('should delete old entries and return count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 42 });
      const deleted = await repo.cleanupOldHistory(30);
      expect(deleted).toBe(42);

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM claw_history');
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('should handle null optional fields', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeClawRow({
          provider: null,
          model: null,
          workspace_id: null,
          soul_id: null,
          parent_claw_id: null,
          coding_agent_provider: null,
          stop_condition: null,
          interval_ms: null,
          skills: null,
        })
      );

      const config = await repo.getById('claw-1', 'user-1');
      expect(config!.provider).toBeUndefined();
      expect(config!.model).toBeUndefined();
      expect(config!.workspaceId).toBeUndefined();
      expect(config!.soulId).toBeUndefined();
      expect(config!.parentClawId).toBeUndefined();
      expect(config!.codingAgentProvider).toBeUndefined();
      expect(config!.stopCondition).toBeUndefined();
      expect(config!.intervalMs).toBeUndefined();
      expect(config!.skills).toEqual([]);
    });

    it('should parse soul_id and coding_agent_provider when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeClawRow({
          soul_id: 'soul-abc',
          coding_agent_provider: 'claude-code',
          parent_claw_id: 'claw-parent',
          depth: 1,
        })
      );

      const config = await repo.getById('claw-1', 'user-1');
      expect(config!.soulId).toBe('soul-abc');
      expect(config!.codingAgentProvider).toBe('claude-code');
      expect(config!.parentClawId).toBe('claw-parent');
      expect(config!.depth).toBe(1);
    });
  });
});
