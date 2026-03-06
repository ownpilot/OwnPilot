/**
 * Agent Command Center Routes — Comprehensive Tests
 *
 * Tests for all endpoints:
 *  POST /command         — broadcast command to multiple agents
 *  POST /deploy-fleet    — deploy agents with a shared mission
 *  GET  /status          — get status of all agents
 *  POST /mission         — assign mission to agents / crews
 *  GET  /activity        — recent activity from all agents
 *  POST /execute         — execute agents immediately
 *  GET  /analytics       — fleet-wide analytics
 *  POST /tools/batch-update — update tools for multiple agents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// =============================================================================
// Hoisted mock objects — referenced inside vi.mock() factories to avoid TDZ
// =============================================================================

const {
  mockSoulsRepo,
  mockCrewsRepo,
  mockHbLogRepo,
  mockAgentsRepo,
  mockBgService,
  mockAgentMsgsRepo,
  mockSettingsRepo,
  mockRunAgentHeartbeat,
} = vi.hoisted(() => {
  const mockSoulsRepo = {
    list: vi.fn(),
    getByAgentId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setHeartbeatEnabled: vi.fn(),
  };

  const mockCrewsRepo = {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    getMembers: vi.fn(),
    addMember: vi.fn(),
  };

  const mockHbLogRepo = {
    getLatest: vi.fn(),
    getRecent: vi.fn(),
    getStats: vi.fn(),
  };

  const mockAgentsRepo = {
    create: vi.fn(),
  };

  const mockBgService = {
    getAgent: vi.fn(),
    listAgents: vi.fn(),
    listSessions: vi.fn(),
    startAgent: vi.fn(),
    pauseAgent: vi.fn(),
    resumeAgent: vi.fn(),
    stopAgent: vi.fn(),
    executeNow: vi.fn(),
  };

  const mockAgentMsgsRepo = {
    listByAgent: vi.fn(),
  };

  const mockSettingsRepo = {
    get: vi.fn(),
  };

  const mockRunAgentHeartbeat = vi.fn();

  return {
    mockSoulsRepo,
    mockCrewsRepo,
    mockHbLogRepo,
    mockAgentsRepo,
    mockBgService,
    mockAgentMsgsRepo,
    mockSettingsRepo,
    mockRunAgentHeartbeat,
  };
});

// =============================================================================
// Module mocks
// =============================================================================

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: vi.fn(() => mockSoulsRepo),
}));

vi.mock('../db/repositories/crews.js', () => ({
  getCrewsRepository: vi.fn(() => mockCrewsRepo),
}));

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: vi.fn(() => mockHbLogRepo),
}));

vi.mock('../db/repositories/agents.js', () => ({
  agentsRepo: mockAgentsRepo,
}));

vi.mock('../services/background-agent-service.js', () => ({
  getBackgroundAgentService: vi.fn(() => mockBgService),
}));

vi.mock('../db/repositories/agent-messages.js', () => ({
  getAgentMessagesRepository: vi.fn(() => mockAgentMsgsRepo),
}));

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: mockSettingsRepo,
}));

vi.mock('../services/soul-heartbeat-service.js', () => ({
  runAgentHeartbeat: mockRunAgentHeartbeat,
}));

// =============================================================================
// Imports after mocks
// =============================================================================

import { agentCommandCenterRoutes } from './agent-command-center.js';
import { errorHandler } from '../middleware/error-handler.js';

// =============================================================================
// App factory
// =============================================================================

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/acc', agentCommandCenterRoutes);
  app.onError(errorHandler);
  return app;
}

// =============================================================================
// Test data helpers
// =============================================================================

function makeSoul(agentId = 'agent-1', overrides: Record<string, unknown> = {}) {
  return {
    id: `soul-${agentId}`,
    agentId,
    identity: {
      name: 'Test Soul',
      emoji: '🤖',
      role: 'Worker',
      personality: 'helpful',
      voice: { tone: 'neutral', language: 'en' },
      boundaries: [],
    },
    purpose: { mission: 'Be helpful', goals: ['help users'], expertise: [], toolPreferences: [] },
    autonomy: {
      level: 3,
      allowedActions: ['search_web', 'create_note'],
      blockedActions: ['delete_data'],
      requiresApproval: [],
      maxCostPerCycle: 0.5,
      maxCostPerDay: 5.0,
      maxCostPerMonth: 100.0,
      pauseOnConsecutiveErrors: 5,
      pauseOnBudgetExceeded: true,
      notifyUserOnPause: true,
    },
    heartbeat: {
      enabled: true,
      interval: '0 */6 * * *',
      checklist: [],
      selfHealingEnabled: false,
      maxDurationMs: 120000,
    },
    relationships: { peers: [], delegates: [], channels: [], crewId: undefined },
    evolution: {
      version: 1,
      evolutionMode: 'manual',
      coreTraits: [],
      mutableTraits: [],
      learnings: [],
      feedbackLog: [],
    },
    bootSequence: { onStart: [], onHeartbeat: [], onMessage: [] },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

function makeCrew(id = 'crew-1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Test Crew',
    description: 'A test crew',
    templateId: 'fleet',
    coordinationPattern: 'hub_spoke',
    status: 'active',
    workspaceId: 'user-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

function makeCrewMember(agentId = 'agent-1', role = 'coordinator') {
  return { crewId: 'crew-1', agentId, role, joinedAt: new Date('2024-01-01') };
}

function makeBgAgent(id = 'bg-1') {
  return { id, name: 'BG Agent', mission: 'Run tasks', mode: 'interval', userId: 'user-1' };
}

function makeHbEntry(agentId = 'agent-1') {
  return {
    id: `hb-${agentId}`,
    agentId,
    tasksRun: ['task1'],
    tasksSkipped: [],
    tasksFailed: [],
    durationMs: 500,
    cost: 0.01,
    tokenUsage: { input: 100, output: 50 },
    soulVersion: 1,
    createdAt: new Date('2024-06-01T12:00:00Z'),
  };
}

function makeMessage(agentId = 'agent-1') {
  return {
    id: `msg-${agentId}`,
    from: 'user',
    to: agentId,
    type: 'task',
    subject: 'Do something',
    content: 'Please do something',
    attachments: [],
    priority: 'normal',
    requiresResponse: false,
    status: 'unread',
    createdAt: new Date('2024-06-01T11:00:00Z'),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Agent Command Center Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    // Sensible defaults for frequently-used mocks
    mockSoulsRepo.list.mockResolvedValue([]);
    mockSoulsRepo.getByAgentId.mockResolvedValue(null);
    mockCrewsRepo.list.mockResolvedValue([]);
    mockCrewsRepo.getMembers.mockResolvedValue([]);
    mockHbLogRepo.getLatest.mockResolvedValue(null);
    mockHbLogRepo.getRecent.mockResolvedValue([]);
    mockHbLogRepo.getStats.mockResolvedValue({
      totalCycles: 0,
      totalCost: 0,
      avgDurationMs: 0,
      failureRate: 0,
    });
    mockBgService.listAgents.mockResolvedValue([]);
    mockBgService.listSessions.mockReturnValue([]);
    mockAgentMsgsRepo.listByAgent.mockResolvedValue([]);
    mockSettingsRepo.get.mockResolvedValue(null);
  });

  // ===========================================================================
  // POST /acc/command
  // ===========================================================================

  describe('POST /acc/command', () => {
    it('returns 400 when targets array is missing', async () => {
      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'pause' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toMatch(/targets/i);
    });

    it('returns 400 when targets is empty array', async () => {
      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: [], command: 'pause' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns 400 when command is missing', async () => {
      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: [{ type: 'soul', id: 'agent-1' }] }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toMatch(/command/i);
    });

    it('succeeds: pause command on existing soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.command).toBe('pause');
      expect(json.data.total).toBe(1);
      expect(json.data.success).toBe(1);
      expect(json.data.failed).toBe(0);
      expect(json.data.results[0].success).toBe(true);
      expect(json.data.results[0].result.status).toBe('paused');
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', false);
    });

    it('succeeds: resume command on existing soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
          command: 'resume',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('resumed');
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', true);
    });

    it('succeeds: run_once command on existing soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockRunAgentHeartbeat.mockResolvedValue({ success: true });

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
          command: 'run_once',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('executed');
      expect(mockRunAgentHeartbeat).toHaveBeenCalledWith('agent-1');
    });

    it('records failure when soul is not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'missing-agent' }],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.success).toBe(0);
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Soul not found');
    });

    it('returns unknown_command result for unrecognized soul command', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
          command: 'teleport',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('unknown_command');
    });

    it('succeeds: start command on existing background agent', async () => {
      const bgAgent = makeBgAgent('bg-1');
      mockBgService.getAgent.mockResolvedValue(bgAgent);
      mockBgService.startAgent.mockResolvedValue({ state: 'running' });

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-1' }],
          command: 'start',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('started');
      expect(mockBgService.startAgent).toHaveBeenCalledWith('bg-1', 'user-1');
    });

    it('succeeds: pause command on existing background agent', async () => {
      const bgAgent = makeBgAgent('bg-1');
      mockBgService.getAgent.mockResolvedValue(bgAgent);
      mockBgService.pauseAgent.mockResolvedValue(true);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-1' }],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('paused');
    });

    it('succeeds: resume command on existing background agent', async () => {
      const bgAgent = makeBgAgent('bg-1');
      mockBgService.getAgent.mockResolvedValue(bgAgent);
      mockBgService.resumeAgent.mockResolvedValue(true);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-1' }],
          command: 'resume',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('resumed');
    });

    it('succeeds: stop command on existing background agent', async () => {
      const bgAgent = makeBgAgent('bg-1');
      mockBgService.getAgent.mockResolvedValue(bgAgent);
      mockBgService.stopAgent.mockResolvedValue(true);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-1' }],
          command: 'stop',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('stopped');
    });

    it('records failure when background agent is not found', async () => {
      mockBgService.getAgent.mockResolvedValue(null);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-missing' }],
          command: 'start',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Background agent not found');
    });

    it('succeeds: pause command on crew — pauses all member souls', async () => {
      const crew = makeCrew('crew-1');
      const members = [makeCrewMember('agent-1'), makeCrewMember('agent-2')];
      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
      mockCrewsRepo.updateStatus.mockResolvedValue(undefined);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'crew', id: 'crew-1' }],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('paused');
      expect(json.data.results[0].result.affectedAgents).toBe(2);
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledTimes(2);
      expect(mockCrewsRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'paused');
    });

    it('succeeds: resume command on crew — resumes all member souls', async () => {
      const crew = makeCrew('crew-1');
      const members = [makeCrewMember('agent-1')];
      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
      mockCrewsRepo.updateStatus.mockResolvedValue(undefined);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'crew', id: 'crew-1' }],
          command: 'resume',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results[0].result.status).toBe('resumed');
      expect(mockCrewsRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'active');
    });

    it('records failure when crew is not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'crew', id: 'missing-crew' }],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Crew not found');
    });

    it('handles multiple targets with mixed results', async () => {
      // Soul found, bg not found
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValueOnce(soul);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
      mockBgService.getAgent.mockResolvedValue(null);

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [
            { type: 'soul', id: 'agent-1' },
            { type: 'background', id: 'bg-missing' },
          ],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(2);
      expect(json.data.success).toBe(1);
      expect(json.data.failed).toBe(1);
    });

    it('records target-level error when soul operation throws', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.setHeartbeatEnabled.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
          command: 'pause',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('DB error');
    });

    it('returns 500 when body parsing throws', async () => {
      const res = await app.request('/acc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(500);
    });
  });

  // ===========================================================================
  // POST /acc/deploy-fleet
  // ===========================================================================

  describe('POST /acc/deploy-fleet', () => {
    it('returns 400 when name is missing', async () => {
      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'Do stuff', agentCount: 2 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toMatch(/name and mission/i);
    });

    it('returns 400 when mission is missing', async () => {
      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alpha Fleet', agentCount: 2 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('deploys a fleet with 201 status', async () => {
      const crew = makeCrew('crew-fleet-1', { name: 'Alpha Fleet' });
      mockCrewsRepo.create.mockResolvedValue(crew);
      mockAgentsRepo.create.mockResolvedValue({
        id: 'new-agent',
        name: 'Alpha Fleet Coordinator 1',
      });
      mockSoulsRepo.create.mockResolvedValue(makeSoul('new-agent'));
      mockCrewsRepo.addMember.mockResolvedValue(undefined);
      mockSoulsRepo.getByAgentId.mockResolvedValue(
        makeSoul('new-agent', { relationships: { peers: [], delegates: [], channels: [] } })
      );
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alpha Fleet',
          mission: 'Conquer search results',
          agentCount: 2,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Alpha Fleet');
      expect(json.data.mission).toBe('Conquer search results');
      expect(json.data.fleetId).toBe('crew-fleet-1');
      expect(Array.isArray(json.data.agents)).toBe(true);
    });

    it('caps agentCount at 10', async () => {
      const crew = makeCrew('crew-fleet-2', { name: 'Big Fleet' });
      mockCrewsRepo.create.mockResolvedValue(crew);
      mockAgentsRepo.create.mockResolvedValue({ id: 'a', name: 'A' });
      mockSoulsRepo.create.mockResolvedValue(makeSoul('a'));
      mockCrewsRepo.addMember.mockResolvedValue(undefined);
      mockSoulsRepo.getByAgentId.mockResolvedValue(
        makeSoul('a', { relationships: { peers: [], delegates: [], channels: [] } })
      );
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Big Fleet',
          mission: 'Take over',
          agentCount: 50,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      // Count should be capped: 10 agents created = addMember called 10 times
      expect(mockCrewsRepo.addMember).toHaveBeenCalledTimes(10);
      expect(json.data.agents).toHaveLength(10);
    });

    it('uses default hub_spoke pattern when not specified', async () => {
      const crew = makeCrew('crew-1');
      mockCrewsRepo.create.mockResolvedValue(crew);
      mockAgentsRepo.create.mockResolvedValue({ id: 'x', name: 'X' });
      mockSoulsRepo.create.mockResolvedValue(makeSoul('x'));
      mockCrewsRepo.addMember.mockResolvedValue(undefined);
      mockSoulsRepo.getByAgentId.mockResolvedValue(
        makeSoul('x', { relationships: { peers: [], delegates: [], channels: [] } })
      );
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Fleet X', mission: 'Do X', agentCount: 1 }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.coordinationPattern).toBe('hub_spoke');
    });

    it('uses provided coordination pattern', async () => {
      const crew = makeCrew('crew-2', { coordinationPattern: 'pipeline' });
      mockCrewsRepo.create.mockResolvedValue(crew);
      mockAgentsRepo.create.mockResolvedValue({ id: 'y', name: 'Y' });
      mockSoulsRepo.create.mockResolvedValue(makeSoul('y'));
      mockCrewsRepo.addMember.mockResolvedValue(undefined);
      mockSoulsRepo.getByAgentId.mockResolvedValue(
        makeSoul('y', { relationships: { peers: [], delegates: [], channels: [] } })
      );
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Pipeline Fleet',
          mission: 'Pipeline tasks',
          agentCount: 1,
          coordinationPattern: 'pipeline',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.coordinationPattern).toBe('pipeline');
    });

    it('returns 500 when crew creation fails', async () => {
      mockCrewsRepo.create.mockRejectedValue(new Error('DB failure'));

      const res = await app.request('/acc/deploy-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Fail Fleet', mission: 'Fail', agentCount: 1 }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ===========================================================================
  // GET /acc/status
  // ===========================================================================

  describe('GET /acc/status', () => {
    it('returns 200 with empty data when no agents exist', async () => {
      mockSoulsRepo.list.mockResolvedValue([]);
      mockBgService.listAgents.mockResolvedValue([]);
      mockBgService.listSessions.mockReturnValue([]);
      mockCrewsRepo.list.mockResolvedValue([]);

      const res = await app.request('/acc/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.souls).toHaveLength(0);
      expect(json.data.backgroundAgents).toHaveLength(0);
      expect(json.data.crews).toHaveLength(0);
      expect(json.data.summary.totalAgents).toBe(0);
      expect(json.data.summary.totalCrews).toBe(0);
    });

    it('includes soul status with lastActivity from heartbeat log', async () => {
      const soul = makeSoul('agent-1');
      const hbEntry = makeHbEntry('agent-1');
      mockSoulsRepo.list.mockResolvedValue([soul]);
      mockHbLogRepo.getLatest.mockResolvedValue(hbEntry);
      mockBgService.listAgents.mockResolvedValue([]);
      mockBgService.listSessions.mockReturnValue([]);
      mockCrewsRepo.list.mockResolvedValue([]);

      const res = await app.request('/acc/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.souls).toHaveLength(1);
      expect(json.data.souls[0].id).toBe('agent-1');
      expect(json.data.souls[0].status).toBe('running');
      expect(json.data.souls[0].lastActivity).not.toBeNull();
    });

    it('shows paused status for soul with disabled heartbeat', async () => {
      const soul = makeSoul('agent-1', {
        heartbeat: {
          enabled: false,
          interval: '0 */6 * * *',
          checklist: [],
          selfHealingEnabled: false,
          maxDurationMs: 120000,
        },
      });
      mockSoulsRepo.list.mockResolvedValue([soul]);
      mockHbLogRepo.getLatest.mockResolvedValue(null);
      mockBgService.listAgents.mockResolvedValue([]);
      mockBgService.listSessions.mockReturnValue([]);
      mockCrewsRepo.list.mockResolvedValue([]);

      const res = await app.request('/acc/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.souls[0].status).toBe('paused');
      expect(json.data.summary.paused).toBe(1);
    });

    it('includes background agent status with session info', async () => {
      const bgAgent = makeBgAgent('bg-1');
      const session = { config: { id: 'bg-1' }, state: 'running', lastCycleAt: new Date() };
      mockBgService.listAgents.mockResolvedValue([bgAgent]);
      mockBgService.listSessions.mockReturnValue([session]);
      mockSoulsRepo.list.mockResolvedValue([]);
      mockCrewsRepo.list.mockResolvedValue([]);

      const res = await app.request('/acc/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.backgroundAgents).toHaveLength(1);
      expect(json.data.backgroundAgents[0].status).toBe('running');
    });

    it('includes crew status info', async () => {
      const crew = makeCrew('crew-1');
      mockCrewsRepo.list.mockResolvedValue([crew]);
      mockSoulsRepo.list.mockResolvedValue([]);
      mockBgService.listAgents.mockResolvedValue([]);
      mockBgService.listSessions.mockReturnValue([]);

      const res = await app.request('/acc/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.crews).toHaveLength(1);
      expect(json.data.crews[0].id).toBe('crew-1');
      expect(json.data.crews[0].pattern).toBe('hub_spoke');
    });

    it('returns 500 when soulRepo.list throws', async () => {
      mockSoulsRepo.list.mockRejectedValue(new Error('DB down'));

      const res = await app.request('/acc/status');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ===========================================================================
  // POST /acc/mission
  // ===========================================================================

  describe('POST /acc/mission', () => {
    it('returns 400 when mission is missing', async () => {
      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: ['agent-1'] }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/mission/i);
    });

    it('returns 400 when neither agentIds nor crewIds provided', async () => {
      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'Do something' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/agentIds or crewIds/i);
    });

    it('assigns mission to individual agents', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1'],
          mission: 'Find the answer',
          priority: 'high',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.mission).toBe('Find the answer');
      expect(json.data.priority).toBe('high');
      expect(json.data.assigned).toBe(1);
      expect(json.data.failed).toBe(0);
      expect(mockSoulsRepo.update).toHaveBeenCalled();
    });

    it('records failure when agent soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);

      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['missing-agent'],
          mission: 'Find the answer',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.assigned).toBe(0);
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Not found');
    });

    it('assigns mission to crew members', async () => {
      const soul = makeSoul('member-1');
      const members = [makeCrewMember('member-1')];
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crewIds: ['crew-1'],
          mission: 'Fleet mission',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.assigned).toBe(1);
      expect(mockSoulsRepo.update).toHaveBeenCalledTimes(1);
    });

    it('appends deadline goal when deadline is provided', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1'],
          mission: 'Complete by deadline',
          deadline: '2025-12-31',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.assigned).toBe(1);
      // Soul update should contain deadline in goals
      const updatedSoul = mockSoulsRepo.update.mock.calls[0][0];
      expect(updatedSoul.purpose.goals).toContain('Deadline: 2025-12-31');
    });

    it('defaults priority to medium when not provided', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: ['agent-1'], mission: 'Default priority' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.priority).toBe('medium');
    });

    it('returns 500 when an unexpected error occurs', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('Fatal'));

      const res = await app.request('/acc/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: ['agent-1'], mission: 'crash test' }),
      });

      // Individual target errors are caught and recorded, not propagated as 500
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
    });
  });

  // ===========================================================================
  // GET /acc/activity
  // ===========================================================================

  describe('GET /acc/activity', () => {
    it('returns 200 with empty activities when no souls exist', async () => {
      mockSoulsRepo.list.mockResolvedValue([]);

      const res = await app.request('/acc/activity');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.activities).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });

    it('returns heartbeat activities for souls', async () => {
      const soul = makeSoul('agent-1');
      const hbEntry = makeHbEntry('agent-1');
      mockSoulsRepo.list.mockResolvedValue([soul]);
      mockHbLogRepo.getRecent.mockResolvedValue([hbEntry]);
      mockAgentMsgsRepo.listByAgent.mockResolvedValue([]);

      const res = await app.request('/acc/activity');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.activities.length).toBeGreaterThan(0);
      expect(json.data.activities[0].type).toBe('heartbeat');
      expect(json.data.activities[0].agentId).toBe('agent-1');
    });

    it('labels activities as error type when tasks failed', async () => {
      const soul = makeSoul('agent-1');
      const failedHb = { ...makeHbEntry('agent-1'), tasksFailed: ['task-x'] };
      mockSoulsRepo.list.mockResolvedValue([soul]);
      mockHbLogRepo.getRecent.mockResolvedValue([failedHb]);
      mockAgentMsgsRepo.listByAgent.mockResolvedValue([]);

      const res = await app.request('/acc/activity');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.activities[0].type).toBe('error');
    });

    it('includes message activities for souls', async () => {
      const soul = makeSoul('agent-1');
      const msg = makeMessage('agent-1');
      mockSoulsRepo.list.mockResolvedValue([soul]);
      mockHbLogRepo.getRecent.mockResolvedValue([]);
      mockAgentMsgsRepo.listByAgent.mockResolvedValue([msg]);

      const res = await app.request('/acc/activity');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.activities.length).toBeGreaterThan(0);
      expect(json.data.activities[0].type).toBe('message');
    });

    it('limits results by ?limit query param (max 100)', async () => {
      const soul = makeSoul('agent-1');
      const hbEntries = Array.from({ length: 5 }, (_, i) => ({
        ...makeHbEntry('agent-1'),
        id: `hb-${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));
      mockSoulsRepo.list.mockResolvedValue([soul]);
      mockHbLogRepo.getRecent.mockResolvedValue(hbEntries);
      mockAgentMsgsRepo.listByAgent.mockResolvedValue([]);

      const res = await app.request('/acc/activity?limit=2');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.activities).toHaveLength(2);
    });

    it('returns 500 when soulRepo.list throws', async () => {
      mockSoulsRepo.list.mockRejectedValue(new Error('DB failure'));

      const res = await app.request('/acc/activity');

      expect(res.status).toBe(500);
    });
  });

  // ===========================================================================
  // POST /acc/execute
  // ===========================================================================

  describe('POST /acc/execute', () => {
    it('returns 400 when targets is missing', async () => {
      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/targets/i);
    });

    it('returns 400 when targets is empty', async () => {
      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('executes soul target sequentially', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: true });

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executed).toBe(1);
      expect(json.data.failed).toBe(0);
      expect(json.data.parallel).toBe(false);
      expect(mockRunAgentHeartbeat).toHaveBeenCalledWith('agent-1');
    });

    it('executes background target sequentially', async () => {
      mockBgService.executeNow.mockResolvedValue(true);

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-1', task: 'run task' }],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executed).toBe(1);
      expect(mockBgService.executeNow).toHaveBeenCalledWith('bg-1', 'user-1', 'run task');
    });

    it('executes soul targets in parallel when parallel=true', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: true });

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [
            { type: 'soul', id: 'agent-1' },
            { type: 'soul', id: 'agent-2' },
          ],
          parallel: true,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executed).toBe(2);
      expect(json.data.parallel).toBe(true);
    });

    it('records failure when runAgentHeartbeat returns success=false', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: false, error: 'Heartbeat failed' });

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executed).toBe(0);
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Heartbeat failed');
    });

    it('records failure when executeNow returns false', async () => {
      mockBgService.executeNow.mockResolvedValue(false);

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'background', id: 'bg-1' }],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executed).toBe(0);
      expect(json.data.failed).toBe(1);
    });

    it('records individual target error when execution throws', async () => {
      mockRunAgentHeartbeat.mockRejectedValue(new Error('Execution error'));

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-err' }],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Execution error');
    });

    it('records individual target error in parallel mode', async () => {
      mockRunAgentHeartbeat.mockRejectedValue(new Error('Parallel error'));

      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ type: 'soul', id: 'agent-1' }],
          parallel: true,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Parallel error');
    });

    it('returns 500 on unexpected body parse error', async () => {
      const res = await app.request('/acc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      });
      expect(res.status).toBe(500);
    });
  });

  // ===========================================================================
  // GET /acc/analytics
  // ===========================================================================

  describe('GET /acc/analytics', () => {
    it('returns 200 with empty stats when no souls exist', async () => {
      mockSoulsRepo.list.mockResolvedValue([]);
      mockCrewsRepo.list.mockResolvedValue([]);

      const res = await app.request('/acc/analytics');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.summary.totalAgents).toBe(0);
      expect(json.data.summary.totalCrews).toBe(0);
      expect(json.data.summary.totalCycles).toBe(0);
      expect(json.data.topAgents).toHaveLength(0);
      expect(json.data.agentStats).toHaveLength(0);
    });

    it('aggregates stats across all souls', async () => {
      const souls = [
        makeSoul('agent-1'),
        makeSoul('agent-2', {
          heartbeat: {
            enabled: false,
            interval: '0 */6 * * *',
            checklist: [],
            selfHealingEnabled: false,
            maxDurationMs: 120000,
          },
        }),
      ];
      mockSoulsRepo.list.mockResolvedValue(souls);
      mockCrewsRepo.list.mockResolvedValue([]);
      mockHbLogRepo.getStats
        .mockResolvedValueOnce({
          totalCycles: 10,
          totalCost: 0.5,
          avgDurationMs: 300,
          failureRate: 0.1,
        })
        .mockResolvedValueOnce({
          totalCycles: 5,
          totalCost: 0.25,
          avgDurationMs: 200,
          failureRate: 0.0,
        });

      const res = await app.request('/acc/analytics');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.summary.totalAgents).toBe(2);
      expect(json.data.summary.totalCycles).toBe(15);
      expect(json.data.summary.activeAgents).toBe(1);
      expect(json.data.agentStats).toHaveLength(2);
    });

    it('sorts agentStats by cycles descending', async () => {
      const souls = [makeSoul('agent-a'), makeSoul('agent-b')];
      mockSoulsRepo.list.mockResolvedValue(souls);
      mockCrewsRepo.list.mockResolvedValue([]);
      mockHbLogRepo.getStats
        .mockResolvedValueOnce({
          totalCycles: 2,
          totalCost: 0.1,
          avgDurationMs: 100,
          failureRate: 0,
        })
        .mockResolvedValueOnce({
          totalCycles: 20,
          totalCost: 1.0,
          avgDurationMs: 200,
          failureRate: 0,
        });

      const res = await app.request('/acc/analytics');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.agentStats[0].cycles).toBe(20);
      expect(json.data.agentStats[1].cycles).toBe(2);
    });

    it('returns 500 when soulRepo.list throws', async () => {
      mockSoulsRepo.list.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/acc/analytics');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ===========================================================================
  // POST /acc/tools/batch-update
  // ===========================================================================

  describe('POST /acc/tools/batch-update', () => {
    it('returns 400 when agentIds is missing', async () => {
      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addAllowed: ['search_web'] }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/agentIds/i);
    });

    it('returns 400 when agentIds is empty array', async () => {
      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('adds allowed tools to soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1'],
          addAllowed: ['new_tool'],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toBe(1);
      expect(json.data.failed).toBe(0);
      const updatedSoul = mockSoulsRepo.update.mock.calls[0][0];
      expect(updatedSoul.autonomy.allowedActions).toContain('new_tool');
    });

    it('removes allowed tools from soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1'],
          removeAllowed: ['search_web'],
        }),
      });

      expect(res.status).toBe(200);
      const updatedSoul = mockSoulsRepo.update.mock.calls[0][0];
      expect(updatedSoul.autonomy.allowedActions).not.toContain('search_web');
    });

    it('adds blocked tools to soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1'],
          addBlocked: ['dangerous_tool'],
        }),
      });

      expect(res.status).toBe(200);
      const updatedSoul = mockSoulsRepo.update.mock.calls[0][0];
      expect(updatedSoul.autonomy.blockedActions).toContain('dangerous_tool');
    });

    it('removes blocked tools from soul', async () => {
      const soul = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1'],
          removeBlocked: ['delete_data'],
        }),
      });

      expect(res.status).toBe(200);
      const updatedSoul = mockSoulsRepo.update.mock.calls[0][0];
      expect(updatedSoul.autonomy.blockedActions).not.toContain('delete_data');
    });

    it('records failure when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['missing-agent'],
          addAllowed: ['tool_x'],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updated).toBe(0);
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Soul not found');
    });

    it('handles multiple agentIds with partial success', async () => {
      const soul1 = makeSoul('agent-1');
      mockSoulsRepo.getByAgentId.mockResolvedValueOnce(soul1).mockResolvedValueOnce(null);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-1', 'missing-agent'],
          addAllowed: ['tool_y'],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updated).toBe(1);
      expect(json.data.failed).toBe(1);
    });

    it('records individual error when soul update throws', async () => {
      const soul = makeSoul('agent-err');
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockRejectedValue(new Error('Update failed'));

      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: ['agent-err'],
          addAllowed: ['tool_z'],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.failed).toBe(1);
      expect(json.data.results[0].error).toBe('Update failed');
    });

    it('returns 500 on unexpected body error', async () => {
      const res = await app.request('/acc/tools/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json body',
      });
      expect(res.status).toBe(500);
    });
  });
});
