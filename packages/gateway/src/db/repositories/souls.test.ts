import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock DB adapter
// ---------------------------------------------------------------------------

const mockAdapter: { [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn> } = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 1 }),
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

const { SoulsRepository, getSoulsRepository } = await import('./souls.js');

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

function makeSoulRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'soul-1',
    agent_id: 'agent-1',
    identity: JSON.stringify({
      name: 'Scout',
      emoji: '🔍',
      role: 'Researcher',
      personality: 'curious',
      voice: { tone: 'neutral', language: 'en' },
      boundaries: [],
    }),
    purpose: JSON.stringify({ mission: 'Test', goals: [], expertise: [], toolPreferences: [] }),
    autonomy: JSON.stringify({
      level: 2,
      allowedActions: [],
      blockedActions: [],
      requiresApproval: [],
      maxCostPerCycle: 1,
      maxCostPerDay: 10,
      maxCostPerMonth: 100,
      pauseOnConsecutiveErrors: 5,
      pauseOnBudgetExceeded: true,
      notifyUserOnPause: false,
    }),
    heartbeat: JSON.stringify({
      enabled: true,
      interval: '*/30 * * * *',
      checklist: [],
      selfHealingEnabled: false,
      maxDurationMs: 120_000,
    }),
    relationships: JSON.stringify({ delegates: [], peers: [], channels: [] }),
    evolution: JSON.stringify({
      version: 1,
      evolutionMode: 'supervised',
      coreTraits: [],
      mutableTraits: [],
      learnings: [],
      feedbackLog: [],
    }),
    boot_sequence: JSON.stringify({ onStart: [], onHeartbeat: [], onMessage: [] }),
    provider: null,
    skill_access: null,
    workspace_id: null,
    created_at: '2024-01-10T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
    ...overrides,
  };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-1',
    soul_id: 'soul-1',
    version: 3,
    snapshot: JSON.stringify(makeSoulRow()),
    change_reason: 'feedback',
    changed_by: 'user',
    created_at: '2024-01-10T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SoulsRepository', () => {
  let repo: InstanceType<typeof SoulsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new SoulsRepository();
  });

  // ── getById ────────────────────────────────────────────────

  describe('getById()', () => {
    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);
      expect(await repo.getById('soul-1')).toBeNull();
    });

    it('queries by id and maps row to soul', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeSoulRow());
      const soul = await repo.getById('soul-1');
      expect(soul).not.toBeNull();
      expect(soul?.id).toBe('soul-1');
      expect(soul?.agentId).toBe('agent-1');
    });

    it('passes id as query param', async () => {
      await repo.getById('my-soul');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('agent_souls');
      expect(params).toEqual(['my-soul']);
    });
  });

  // ── getByAgentId ───────────────────────────────────────────

  describe('getByAgentId()', () => {
    it('returns null when not found', async () => {
      expect(await repo.getByAgentId('agent-1')).toBeNull();
    });

    it('parses JSON fields from DB row', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeSoulRow());
      const soul = await repo.getByAgentId('agent-1');
      expect(soul?.identity.name).toBe('Scout');
      expect(soul?.heartbeat.enabled).toBe(true);
      expect(soul?.evolution.version).toBe(1);
    });

    it('parses optional provider field when present', async () => {
      mockAdapter.queryOne.mockResolvedValue(
        makeSoulRow({ provider: JSON.stringify({ providerId: 'anthropic', modelId: 'claude-3' }) })
      );
      const soul = await repo.getByAgentId('agent-1');
      expect(soul?.provider?.providerId).toBe('anthropic');
    });

    it('leaves provider undefined when DB column is null', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeSoulRow({ provider: null }));
      const soul = await repo.getByAgentId('agent-1');
      expect(soul?.provider).toBeUndefined();
    });

    it('passes agentId as query param', async () => {
      await repo.getByAgentId('my-agent');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('agent_id');
      expect(params).toEqual(['my-agent']);
    });
  });

  // ── create ─────────────────────────────────────────────────

  describe('create()', () => {
    it('inserts all JSON fields and returns the created soul', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeSoulRow()); // for the subsequent getByAgentId
      const data = {
        agentId: 'agent-1',
        identity: {
          name: 'Bot',
          emoji: '🤖',
          role: 'Tester',
          personality: 'x',
          voice: { tone: 'n', language: 'en' as const },
          boundaries: [],
        },
        purpose: { mission: 'M', goals: [], expertise: [], toolPreferences: [] },
        autonomy: {
          level: 2 as const,
          allowedActions: [],
          blockedActions: [],
          requiresApproval: [],
          maxCostPerCycle: 1,
          maxCostPerDay: 10,
          maxCostPerMonth: 100,
          pauseOnConsecutiveErrors: 5,
          pauseOnBudgetExceeded: true,
          notifyUserOnPause: false,
        },
        heartbeat: {
          enabled: true,
          interval: '*/30 * * * *',
          checklist: [],
          selfHealingEnabled: false,
          maxDurationMs: 120_000,
        },
        relationships: { delegates: [], peers: [], channels: [] },
        evolution: {
          version: 1,
          evolutionMode: 'supervised' as const,
          coreTraits: [],
          mutableTraits: [],
          learnings: [],
          feedbackLog: [],
        },
        bootSequence: { onStart: [], onHeartbeat: [], onMessage: [] },
      };
      const soul = await repo.create(data);
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO agent_souls');
      expect(params[0]).toBe('agent-1');
      // JSON fields are stringified
      expect(typeof params[1]).toBe('string'); // identity
      expect(soul?.agentId).toBe('agent-1');
    });

    it('throws when getByAgentId returns null after insert', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);
      await expect(
        repo.create({
          agentId: 'a',
          identity: {
            name: '',
            emoji: '',
            role: '',
            personality: '',
            voice: { tone: '', language: 'en' as const },
            boundaries: [],
          },
          purpose: { mission: '', goals: [], expertise: [], toolPreferences: [] },
          autonomy: {
            level: 0 as const,
            allowedActions: [],
            blockedActions: [],
            requiresApproval: [],
            maxCostPerCycle: 0,
            maxCostPerDay: 0,
            maxCostPerMonth: 0,
            pauseOnConsecutiveErrors: 5,
            pauseOnBudgetExceeded: true,
            notifyUserOnPause: false,
          },
          heartbeat: {
            enabled: false,
            interval: '',
            checklist: [],
            selfHealingEnabled: false,
            maxDurationMs: 120_000,
          },
          relationships: { delegates: [], peers: [], channels: [] },
          evolution: {
            version: 1,
            evolutionMode: 'manual' as const,
            coreTraits: [],
            mutableTraits: [],
            learnings: [],
            feedbackLog: [],
          },
          bootSequence: { onStart: [], onHeartbeat: [], onMessage: [] },
        })
      ).rejects.toThrow('Failed to create soul');
    });
  });

  // ── list ───────────────────────────────────────────────────

  describe('list()', () => {
    it('filters by workspace_id when userId is provided', async () => {
      await repo.list('user-1', 10, 0);
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('workspace_id');
      expect(params).toContain('user-1');
    });

    it('queries all when userId is null', async () => {
      await repo.list(null, 10, 0);
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).not.toContain('workspace_id');
      expect(params).toEqual([10, 0]);
    });

    it('returns mapped souls', async () => {
      mockAdapter.query.mockResolvedValue([
        makeSoulRow(),
        makeSoulRow({ id: 'soul-2', agent_id: 'agent-2' }),
      ]);
      const souls = await repo.list(null, 10, 0);
      expect(souls).toHaveLength(2);
    });
  });

  // ── listByAgentIds ─────────────────────────────────────────

  describe('listByAgentIds()', () => {
    it('returns empty array without querying DB when agentIds is empty', async () => {
      const result = await repo.listByAgentIds([]);
      expect(result).toHaveLength(0);
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('builds IN clause with correct placeholders', async () => {
      mockAdapter.query.mockResolvedValue([]);
      await repo.listByAgentIds(['a1', 'a2', 'a3']);
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('IN ($1,$2,$3)');
      expect(params).toEqual(['a1', 'a2', 'a3']);
    });
  });

  // ── count ──────────────────────────────────────────────────

  describe('count()', () => {
    it('returns 0 when DB row is null', async () => {
      expect(await repo.count(null)).toBe(0);
    });

    it('filters by workspace_id when userId is provided', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '5' });
      const n = await repo.count('user-1');
      expect(n).toBe(5);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('workspace_id');
      expect(params).toContain('user-1');
    });

    it('counts all when userId is null', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '42' });
      const n = await repo.count(null);
      expect(n).toBe(42);
    });
  });

  // ── update ─────────────────────────────────────────────────

  describe('update()', () => {
    it('updates with all JSON fields and agentId as WHERE param', async () => {
      const soul = {
        id: 'soul-1',
        agentId: 'agent-1',
        identity: {
          name: 'X',
          emoji: '',
          role: '',
          personality: '',
          voice: { tone: '', language: 'en' as const },
          boundaries: [],
        },
        purpose: { mission: '', goals: [], expertise: [], toolPreferences: [] },
        autonomy: {
          level: 0 as const,
          allowedActions: [],
          blockedActions: [],
          requiresApproval: [],
          maxCostPerCycle: 0,
          maxCostPerDay: 0,
          maxCostPerMonth: 0,
          pauseOnConsecutiveErrors: 5,
          pauseOnBudgetExceeded: true,
          notifyUserOnPause: false,
        },
        heartbeat: {
          enabled: true,
          interval: '',
          checklist: [],
          selfHealingEnabled: false,
          maxDurationMs: 120_000,
        },
        relationships: { delegates: [], peers: [], channels: [] },
        evolution: {
          version: 2,
          evolutionMode: 'supervised' as const,
          coreTraits: [],
          mutableTraits: [],
          learnings: [],
          feedbackLog: [],
        },
        bootSequence: { onStart: [], onHeartbeat: [], onMessage: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await repo.update(soul);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('UPDATE agent_souls');
      // Last param is agentId
      expect(params[params.length - 1]).toBe('agent-1');
    });
  });

  // ── delete ─────────────────────────────────────────────────

  describe('delete()', () => {
    it('returns true when a row was deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      expect(await repo.delete('agent-1')).toBe(true);
    });

    it('returns false when no row matched', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });
      expect(await repo.delete('agent-x')).toBe(false);
    });
  });

  // ── setHeartbeatEnabled ────────────────────────────────────

  describe('setHeartbeatEnabled()', () => {
    it('updates heartbeat.enabled via jsonb_set', async () => {
      await repo.setHeartbeatEnabled('agent-1', false);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('jsonb_set');
      expect(sql).toContain("'{enabled}'");
      expect(params).toContain('false'); // JSON.stringify(false)
      expect(params).toContain('agent-1');
    });
  });

  // ── updateHeartbeatChecklist ───────────────────────────────

  describe('updateHeartbeatChecklist()', () => {
    it('updates checklist via jsonb_set with serialized array', async () => {
      const checklist = [
        {
          id: 't1',
          name: 'Task',
          schedule: 'every' as const,
          description: '',
          tools: [],
          priority: 'medium' as const,
          stalenessHours: 0,
        },
      ];
      await repo.updateHeartbeatChecklist('agent-1', checklist);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('jsonb_set');
      expect(sql).toContain("'{checklist}'");
      expect(params[0]).toBe(JSON.stringify(checklist));
      expect(params[1]).toBe('agent-1');
    });
  });

  // ── createVersion ──────────────────────────────────────────

  describe('createVersion()', () => {
    it('inserts version with soul snapshot as JSON', async () => {
      const soul = { id: 'soul-1', evolution: { version: 5 } } as never;
      await repo.createVersion(soul, 'feedback applied', 'user');
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO agent_soul_versions');
      expect(params[0]).toBe('soul-1'); // soul_id
      expect(params[1]).toBe(5); // version
      expect(params[2]).toBe(JSON.stringify(soul)); // snapshot
      expect(params[3]).toBe('feedback applied');
      expect(params[4]).toBe('user');
    });
  });

  // ── getVersions ────────────────────────────────────────────

  describe('getVersions()', () => {
    it('queries with soulId, limit, offset', async () => {
      mockAdapter.query.mockResolvedValue([makeVersionRow()]);
      const versions = await repo.getVersions('soul-1', 5, 10);
      expect(versions).toHaveLength(1);
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('agent_soul_versions');
      expect(params).toEqual(['soul-1', 5, 10]);
    });
  });

  // ── getVersion ─────────────────────────────────────────────

  describe('getVersion()', () => {
    it('returns null when not found', async () => {
      expect(await repo.getVersion('soul-1', 3)).toBeNull();
    });

    it('returns mapped version when found', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeVersionRow());
      const ver = await repo.getVersion('soul-1', 3);
      expect(ver?.version).toBe(3);
      expect(ver?.changeReason).toBe('feedback');
    });
  });

  // ── updateTaskStatus ───────────────────────────────────────

  describe('updateTaskStatus()', () => {
    it('returns early without executing when soul is not found', async () => {
      // getByAgentId returns null
      mockAdapter.queryOne.mockResolvedValue(null);
      await repo.updateTaskStatus('agent-x', 'task-1', {
        lastRunAt: new Date(),
        lastResult: 'ok',
        consecutiveFailures: 0,
      });
      // execute should not be called (early return)
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('maps matching task in checklist and executes UPDATE', async () => {
      const soulRow = makeSoulRow({
        heartbeat: JSON.stringify({
          enabled: true,
          interval: '*/30 * * * *',
          selfHealingEnabled: false,
          maxDurationMs: 120_000,
          checklist: [
            {
              id: 'task-1',
              name: 'Check',
              schedule: 'daily',
              description: '',
              tools: [],
              priority: 'medium',
              stalenessHours: 0,
            },
            {
              id: 'task-2',
              name: 'Other',
              schedule: 'daily',
              description: '',
              tools: [],
              priority: 'low',
              stalenessHours: 0,
            },
          ],
        }),
      });
      // getByAgentId → queryOne returns the soul row
      mockAdapter.queryOne.mockResolvedValueOnce(soulRow);

      const lastRunAt = new Date('2025-01-01T00:00:00Z');
      await repo.updateTaskStatus('agent-1', 'task-1', {
        lastRunAt,
        lastResult: 'done',
        lastError: undefined,
        consecutiveFailures: 0,
      });

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('jsonb_set');
      expect(sql).toContain("'{checklist}'");
      const checklist = JSON.parse(params[0]);
      expect(checklist[0].id).toBe('task-1');
      expect(checklist[0].lastResult).toBe('done');
      // task-2 should be unchanged
      expect(checklist[1].id).toBe('task-2');
    });

    it('returns t unchanged for non-matching task', async () => {
      const soulRow = makeSoulRow({
        heartbeat: JSON.stringify({
          enabled: true,
          interval: '*/30 * * * *',
          selfHealingEnabled: false,
          maxDurationMs: 120_000,
          checklist: [
            {
              id: 'task-99',
              name: 'Other',
              schedule: 'daily',
              description: '',
              tools: [],
              priority: 'low',
              stalenessHours: 0,
            },
          ],
        }),
      });
      mockAdapter.queryOne.mockResolvedValueOnce(soulRow);

      await repo.updateTaskStatus('agent-1', 'no-such-task', {
        lastRunAt: new Date(),
        lastResult: 'ignored',
        consecutiveFailures: 0,
      });

      const [, params] = mockAdapter.execute.mock.calls[0];
      const checklist = JSON.parse(params[0]);
      // task-99 stays as-is (no lastResult added)
      expect(checklist[0].lastResult).toBeUndefined();
    });
  });

  // ── rowToSoulVersion — M6 fix (snapshot: null) ─────────────

  describe('rowToSoulVersion snapshot handling (M6 fix)', () => {
    it('returns snapshot: null when DB column is null', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeVersionRow({ snapshot: null }));
      const ver = await repo.getVersion('soul-1', 3);
      expect(ver?.snapshot).toBeNull();
    });

    it('returns snapshot: null when DB column is invalid JSON', async () => {
      mockAdapter.queryOne.mockResolvedValue(makeVersionRow({ snapshot: 'not-valid-json{' }));
      const ver = await repo.getVersion('soul-1', 3);
      expect(ver?.snapshot).toBeNull();
    });

    it('returns parsed snapshot when DB column is valid JSON', async () => {
      const soulData = { id: 'soul-1', agentId: 'agent-1' };
      mockAdapter.queryOne.mockResolvedValue(
        makeVersionRow({ snapshot: JSON.stringify(soulData) })
      );
      const ver = await repo.getVersion('soul-1', 3);
      expect(ver?.snapshot).not.toBeNull();
      expect((ver?.snapshot as Record<string, unknown>)?.id).toBe('soul-1');
    });
  });
});

// ── getSoulsRepository singleton ────────────────────────────

describe('getSoulsRepository()', () => {
  it('returns a SoulsRepository instance', () => {
    const repo1 = getSoulsRepository();
    expect(repo1).toBeInstanceOf(SoulsRepository);
  });

  it('returns the same singleton instance on repeated calls', () => {
    const repo1 = getSoulsRepository();
    const repo2 = getSoulsRepository();
    expect(repo1).toBe(repo2);
  });
});
