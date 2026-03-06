import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrewTemplate } from './templates/types.js';

// ---------------------------------------------------------------------------
// Mock templates before importing CrewManager
// ---------------------------------------------------------------------------

vi.mock('./templates/index.js', () => ({
  getCrewTemplate: vi.fn(),
}));

const { CrewManager } = await import('./crew-manager.js');
const { getCrewTemplate } = await import('./templates/index.js');
const getCrewTemplateMock = vi.mocked(getCrewTemplate);

// ---------------------------------------------------------------------------
// Fake template
// ---------------------------------------------------------------------------

const FAKE_TEMPLATE: CrewTemplate = {
  id: 'test-crew',
  name: 'Test Crew',
  description: 'A simple test crew',
  emoji: '🧪',
  coordinationPattern: 'peer_to_peer',
  tags: [],
  agents: [
    {
      identity: {
        name: 'BotA',
        emoji: '🤖',
        role: 'Tester',
        personality: 'methodical',
        voice: { tone: 'neutral', language: 'en' },
        boundaries: [],
      },
      purpose: {
        mission: 'Run tests',
        goals: [],
        expertise: [],
        toolPreferences: [],
      },
      heartbeat: {
        enabled: true,
        interval: '*/30 * * * *',
        checklist: [],
        selfHealingEnabled: false,
        maxDurationMs: 120_000,
      },
      relationships: { delegates: [], peers: [], channels: [] },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeCrewRepo() {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'crew-1',
      name: 'Test Crew',
      status: 'active',
      coordinationPattern: 'peer_to_peer',
      createdAt: new Date(),
    }),
    getById: vi.fn().mockResolvedValue({
      id: 'crew-1',
      name: 'Test Crew',
      status: 'active',
      coordinationPattern: 'peer_to_peer',
      createdAt: new Date(),
    }),
    list: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    addMember: vi.fn().mockResolvedValue(undefined),
    getMembers: vi
      .fn()
      .mockResolvedValue([
        { crewId: 'crew-1', agentId: 'agent-1', role: 'member', joinedAt: new Date() },
      ]),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSoulRepo() {
  return {
    getByAgentId: vi.fn().mockResolvedValue({
      identity: { name: 'BotA', emoji: '🤖', role: 'Tester' },
      heartbeat: { enabled: true },
      evolution: { version: 1 },
      relationships: { delegates: [], peers: [], channels: [] },
    }),
    update: vi.fn().mockResolvedValue(undefined),
    createVersion: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEnabled: vi.fn().mockResolvedValue(undefined),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    updateHeartbeatChecklist: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAgentRepo() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'agent-1' }),
    deactivate: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTriggerRepo() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    disableByAgent: vi.fn().mockResolvedValue(undefined),
    enableByAgent: vi.fn().mockResolvedValue(undefined),
    deleteByAgent: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBus() {
  return {
    send: vi.fn().mockResolvedValue('msg-1'),
    readInbox: vi.fn().mockResolvedValue([]),
    broadcast: vi.fn().mockResolvedValue({ delivered: [], failed: [] }),
    getConversation: vi.fn().mockResolvedValue([]),
    getThread: vi.fn().mockResolvedValue([]),
    getUnreadCount: vi.fn().mockResolvedValue(0),
  };
}

function makeBudgetTracker() {
  return {
    checkBudget: vi.fn().mockResolvedValue(true),
    recordSpend: vi.fn().mockResolvedValue(undefined),
    getDailySpend: vi.fn().mockResolvedValue(0),
    getMonthlySpend: vi.fn().mockResolvedValue(0),
  };
}

function makeLogRepo(lastEntry: object | null = null) {
  return {
    getRecent: vi.fn().mockResolvedValue([]),
    getLatest: vi.fn().mockResolvedValue(lastEntry),
    create: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMessageRepo() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    findForAgent: vi.fn().mockResolvedValue([]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    getCrewMembers: vi.fn().mockResolvedValue([]),
    findConversation: vi.fn().mockResolvedValue([]),
    findByThread: vi.fn().mockResolvedValue([]),
    countUnread: vi.fn().mockResolvedValue(0),
    countToday: vi.fn().mockResolvedValue(5),
  };
}

function makeManager(
  overrides: {
    crewRepo?: ReturnType<typeof makeCrewRepo>;
    soulRepo?: ReturnType<typeof makeSoulRepo>;
    agentRepo?: ReturnType<typeof makeAgentRepo>;
    triggerRepo?: ReturnType<typeof makeTriggerRepo>;
  } = {}
) {
  return new CrewManager(
    overrides.crewRepo ?? makeCrewRepo(),
    overrides.soulRepo ?? makeSoulRepo(),
    overrides.agentRepo ?? makeAgentRepo(),
    overrides.triggerRepo ?? makeTriggerRepo(),
    makeBus(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeBudgetTracker() as any,
    makeLogRepo(),
    makeMessageRepo()
  );
}

// ---------------------------------------------------------------------------
// deployCrew()
// ---------------------------------------------------------------------------

describe('CrewManager.deployCrew()', () => {
  beforeEach(() => {
    getCrewTemplateMock.mockReturnValue(FAKE_TEMPLATE);
  });

  it('returns error when template is not found', async () => {
    getCrewTemplateMock.mockReturnValue(null);
    const manager = makeManager();
    const result = await manager.deployCrew('unknown-template');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Template not found');
  });

  it('creates crew record with template name and pattern', async () => {
    const crewRepo = makeCrewRepo();
    const manager = makeManager({ crewRepo });
    await manager.deployCrew('test-crew');
    expect(crewRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Crew', coordinationPattern: 'peer_to_peer' })
    );
  });

  it('creates an agent for each agent in the template', async () => {
    const agentRepo = makeAgentRepo();
    const manager = makeManager({ agentRepo });
    await manager.deployCrew('test-crew');
    expect(agentRepo.create).toHaveBeenCalledTimes(1);
    expect(agentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'BotA' }));
  });

  it('creates soul and registers agent as crew member', async () => {
    const soulRepo = makeSoulRepo();
    const crewRepo = makeCrewRepo();
    const manager = makeManager({ soulRepo, crewRepo });
    await manager.deployCrew('test-crew');
    expect(soulRepo.update).toHaveBeenCalled();
    expect(crewRepo.addMember).toHaveBeenCalledWith('crew-1', 'agent-1', 'member');
  });

  it('creates heartbeat trigger when heartbeat.enabled=true', async () => {
    const triggerRepo = makeTriggerRepo();
    const manager = makeManager({ triggerRepo });
    await manager.deployCrew('test-crew');
    expect(triggerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cron', enabled: true })
    );
  });

  it('skips trigger creation when heartbeat.enabled=false', async () => {
    const disabledTemplate: CrewTemplate = {
      ...FAKE_TEMPLATE,
      agents: [
        {
          ...FAKE_TEMPLATE.agents[0]!,
          heartbeat: { ...FAKE_TEMPLATE.agents[0]!.heartbeat, enabled: false },
        },
      ],
    };
    getCrewTemplateMock.mockReturnValue(disabledTemplate);
    const triggerRepo = makeTriggerRepo();
    const manager = makeManager({ triggerRepo });
    await manager.deployCrew('test-crew');
    expect(triggerRepo.create).not.toHaveBeenCalled();
  });

  it('returns crewId and agent list on success', async () => {
    const manager = makeManager();
    const result = await manager.deployCrew('test-crew');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.crewId).toBe('crew-1');
      expect(result.value.agents).toHaveLength(1);
      expect(result.value.agents[0]).toBe('agent-1');
    }
  });
});

// ---------------------------------------------------------------------------
// pauseCrew()
// ---------------------------------------------------------------------------

describe('CrewManager.pauseCrew()', () => {
  it('disables heartbeat for all members', async () => {
    const soulRepo = makeSoulRepo();
    const manager = makeManager({ soulRepo });
    await manager.pauseCrew('crew-1');
    expect(soulRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', false);
  });

  it('disables triggers for all members', async () => {
    const triggerRepo = makeTriggerRepo();
    const manager = makeManager({ triggerRepo });
    await manager.pauseCrew('crew-1');
    expect(triggerRepo.disableByAgent).toHaveBeenCalledWith('agent-1');
  });

  it('updates crew status to "paused"', async () => {
    const crewRepo = makeCrewRepo();
    const manager = makeManager({ crewRepo });
    await manager.pauseCrew('crew-1');
    expect(crewRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'paused');
  });
});

// ---------------------------------------------------------------------------
// resumeCrew()
// ---------------------------------------------------------------------------

describe('CrewManager.resumeCrew()', () => {
  it('enables heartbeat for all members', async () => {
    const soulRepo = makeSoulRepo();
    const manager = makeManager({ soulRepo });
    await manager.resumeCrew('crew-1');
    expect(soulRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', true);
  });

  it('enables triggers for all members', async () => {
    const triggerRepo = makeTriggerRepo();
    const manager = makeManager({ triggerRepo });
    await manager.resumeCrew('crew-1');
    expect(triggerRepo.enableByAgent).toHaveBeenCalledWith('agent-1');
  });

  it('updates crew status to "active"', async () => {
    const crewRepo = makeCrewRepo();
    const manager = makeManager({ crewRepo });
    await manager.resumeCrew('crew-1');
    expect(crewRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'active');
  });
});

// ---------------------------------------------------------------------------
// disbandCrew()
// ---------------------------------------------------------------------------

describe('CrewManager.disbandCrew()', () => {
  it('deletes triggers for all members', async () => {
    const triggerRepo = makeTriggerRepo();
    const manager = makeManager({ triggerRepo });
    await manager.disbandCrew('crew-1');
    expect(triggerRepo.deleteByAgent).toHaveBeenCalledWith('agent-1');
  });

  it('deactivates agents', async () => {
    const agentRepo = makeAgentRepo();
    const manager = makeManager({ agentRepo });
    await manager.disbandCrew('crew-1');
    expect(agentRepo.deactivate).toHaveBeenCalledWith('agent-1');
  });

  it('updates crew status to "disbanded"', async () => {
    const crewRepo = makeCrewRepo();
    const manager = makeManager({ crewRepo });
    await manager.disbandCrew('crew-1');
    expect(crewRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'disbanded');
  });
});

// ---------------------------------------------------------------------------
// getCrewStatus()
// ---------------------------------------------------------------------------

describe('CrewManager.getCrewStatus()', () => {
  it('throws when crew not found', async () => {
    const crewRepo = makeCrewRepo();
    crewRepo.getById.mockResolvedValue(null);
    const manager = makeManager({ crewRepo });
    await expect(manager.getCrewStatus('missing')).rejects.toThrow('Crew not found');
  });

  it('returns correct crew metadata', async () => {
    const manager = makeManager();
    const report = await manager.getCrewStatus('crew-1');
    expect(report.crew.id).toBe('crew-1');
    expect(report.crew.name).toBe('Test Crew');
  });

  it('includes per-agent status with identity fields', async () => {
    const manager = makeManager();
    const report = await manager.getCrewStatus('crew-1');
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0]!.name).toBe('BotA');
    expect(report.agents[0]!.emoji).toBe('🤖');
  });

  it('marks agent as "active" when heartbeat is enabled', async () => {
    const manager = makeManager();
    const report = await manager.getCrewStatus('crew-1');
    expect(report.agents[0]!.status).toBe('active');
  });

  it('marks agent as "paused" when heartbeat is disabled', async () => {
    const soulRepo = makeSoulRepo();
    soulRepo.getByAgentId.mockResolvedValue({
      identity: { name: 'BotA', emoji: '🤖', role: 'Tester' },
      heartbeat: { enabled: false },
      evolution: { version: 1 },
      relationships: { delegates: [], peers: [], channels: [] },
    });
    const manager = makeManager({ soulRepo });
    const report = await manager.getCrewStatus('crew-1');
    expect(report.agents[0]!.status).toBe('paused');
  });

  it('marks agent as "never_run" when no heartbeat log exists', async () => {
    const manager = new CrewManager(
      makeCrewRepo(),
      makeSoulRepo(),
      makeAgentRepo(),
      makeTriggerRepo(),
      makeBus(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeBudgetTracker() as any,
      makeLogRepo(null), // no last entry
      makeMessageRepo()
    );
    const report = await manager.getCrewStatus('crew-1');
    expect(report.agents[0]!.lastHeartbeatStatus).toBe('never_run');
    expect(report.agents[0]!.lastHeartbeat).toBeNull();
  });

  it('marks agent as "has_errors" when last log has failed tasks', async () => {
    const logEntry = {
      id: 'log-1',
      agentId: 'agent-1',
      soulVersion: 1,
      tasksRun: [],
      tasksSkipped: [],
      tasksFailed: [{ id: 'task-1', error: 'timeout' }],
      durationMs: 5000,
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
      createdAt: new Date(),
    };
    const manager = new CrewManager(
      makeCrewRepo(),
      makeSoulRepo(),
      makeAgentRepo(),
      makeTriggerRepo(),
      makeBus(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeBudgetTracker() as any,
      makeLogRepo(logEntry),
      makeMessageRepo()
    );
    const report = await manager.getCrewStatus('crew-1');
    expect(report.agents[0]!.lastHeartbeatStatus).toBe('has_errors');
    expect(report.agents[0]!.errorCount).toBe(1);
  });

  it('marks agent as "healthy" when last log has no failed tasks', async () => {
    const logEntry = {
      id: 'log-1',
      agentId: 'agent-1',
      soulVersion: 1,
      tasksRun: [{ id: 'task-1', name: 'T1' }],
      tasksSkipped: [],
      tasksFailed: [],
      durationMs: 1000,
      tokenUsage: { input: 10, output: 20 },
      cost: 0.001,
      createdAt: new Date(),
    };
    const manager = new CrewManager(
      makeCrewRepo(),
      makeSoulRepo(),
      makeAgentRepo(),
      makeTriggerRepo(),
      makeBus(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeBudgetTracker() as any,
      makeLogRepo(logEntry),
      makeMessageRepo()
    );
    const report = await manager.getCrewStatus('crew-1');
    expect(report.agents[0]!.lastHeartbeatStatus).toBe('healthy');
    expect(report.agents[0]!.errorCount).toBe(0);
  });

  it('includes messagesToday from messageRepo', async () => {
    const messageRepo = makeMessageRepo();
    messageRepo.countToday.mockResolvedValue(12);
    const manager = new CrewManager(
      makeCrewRepo(),
      makeSoulRepo(),
      makeAgentRepo(),
      makeTriggerRepo(),
      makeBus(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeBudgetTracker() as any,
      makeLogRepo(),
      messageRepo
    );
    const report = await manager.getCrewStatus('crew-1');
    expect(report.messagesToday).toBe(12);
  });

  it('aggregates totalCostToday across all members', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const budget = makeBudgetTracker() as any;
    budget.getDailySpend.mockResolvedValue(2.5);
    const manager = new CrewManager(
      makeCrewRepo(),
      makeSoulRepo(),
      makeAgentRepo(),
      makeTriggerRepo(),
      makeBus(),
      budget,
      makeLogRepo(),
      makeMessageRepo()
    );
    const report = await manager.getCrewStatus('crew-1');
    expect(report.totalCostToday).toBeCloseTo(2.5);
  });
});
