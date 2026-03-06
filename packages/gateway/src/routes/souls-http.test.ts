/**
 * Soul Routes — HTTP-level tests
 *
 * Uses hoisted singletons for all mocks so that route handlers
 * and tests access the SAME vi.fn() objects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted singletons — shared between vi.mock factories and test code
// ---------------------------------------------------------------------------

const {
  mockSoulsRepo,
  mockHbRepo,
  mockToolRegistry,
  mockRunAgentHeartbeat,
  mockGetSharedToolRegistry,
  mockMemorySvc,
  mockGoalSvc,
} = vi.hoisted(() => ({
  mockSoulsRepo: {
    list: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    getByAgentId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getVersions: vi.fn(),
    getVersion: vi.fn(),
    createVersion: vi.fn(),
    setHeartbeatEnabled: vi.fn(),
  },
  mockHbRepo: {
    listByAgent: vi.fn(),
    getStats: vi.fn(),
  },
  mockToolRegistry: {
    getAllTools: vi.fn(),
  },
  mockRunAgentHeartbeat: vi.fn(),
  mockGetSharedToolRegistry: vi.fn(),
  mockMemorySvc: { listMemories: vi.fn() },
  mockGoalSvc: { listGoals: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: () => mockSoulsRepo,
}));

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: () => mockHbRepo,
}));

vi.mock('../services/tool-executor.js', () => ({
  getSharedToolRegistry: mockGetSharedToolRegistry,
}));

vi.mock('../services/soul-heartbeat-service.js', () => ({
  runAgentHeartbeat: mockRunAgentHeartbeat,
}));

vi.mock('../db/repositories/agents.js', () => ({
  agentsRepo: { create: vi.fn(), delete: vi.fn() },
}));

vi.mock('../db/repositories/triggers.js', () => ({
  createTriggersRepository: () => ({ create: vi.fn() }),
}));

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: { get: vi.fn() },
}));

vi.mock('../db/adapters/index.js', () => ({
  getAdapterSync: () => ({
    transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  }),
}));

vi.mock('@ownpilot/core', () => ({
  getServiceRegistry: () => ({
    get: (token: unknown) => {
      if (token === 'Memory') return mockMemorySvc;
      if (token === 'Goal') return mockGoalSvc;
      return null;
    },
  }),
  Services: { Memory: 'Memory', Goal: 'Goal' },
}));

import { soulRoutes } from './souls.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const AGENT_ID = 'agent-abc';

const mockSoul = {
  id: 'soul-1',
  agentId: AGENT_ID,
  identity: {
    name: 'Test Agent',
    emoji: '🤖',
    role: 'Assistant',
    personality: 'Helpful',
    voice: { tone: 'neutral', language: 'en', quirks: [] },
    boundaries: [],
  },
  purpose: {
    mission: 'Help users',
    goals: ['Be helpful'],
    expertise: [],
    toolPreferences: [],
  },
  autonomy: {
    level: 3,
    allowedActions: ['search_web'],
    blockedActions: [],
    requiresApproval: [],
    maxCostPerCycle: 0.5,
    maxCostPerDay: 5,
    maxCostPerMonth: 100,
    pauseOnConsecutiveErrors: 5,
    pauseOnBudgetExceeded: true,
    notifyUserOnPause: true,
  },
  heartbeat: {
    enabled: true,
    interval: '0 */6 * * *',
    checklist: ['check_inbox'],
    selfHealingEnabled: false,
    maxDurationMs: 120000,
  },
  relationships: { delegates: [], peers: [], channels: [] },
  evolution: {
    version: 1,
    evolutionMode: 'supervised',
    coreTraits: [],
    mutableTraits: [],
    learnings: [],
    feedbackLog: [],
  },
  bootSequence: {
    onStart: [],
    onHeartbeat: ['read_inbox'],
    onMessage: [],
  },
  provider: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

function createApp() {
  const app = new Hono();
  app.route('/souls', soulRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Soul Routes — HTTP-level', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    // Default soul present
    mockSoulsRepo.getByAgentId.mockResolvedValue({ ...mockSoul });
    mockSoulsRepo.update.mockResolvedValue(undefined);
    mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
    mockSoulsRepo.getVersions.mockResolvedValue([]);
    mockSoulsRepo.getVersion.mockResolvedValue(null);
    mockSoulsRepo.createVersion.mockResolvedValue(undefined);
    mockHbRepo.listByAgent.mockResolvedValue([]);
    mockHbRepo.getStats.mockResolvedValue(null);
    mockToolRegistry.getAllTools.mockReturnValue([]);
    mockRunAgentHeartbeat.mockResolvedValue({ success: true });
    mockGetSharedToolRegistry.mockReturnValue(mockToolRegistry);
    mockMemorySvc.listMemories.mockResolvedValue([]);
    mockGoalSvc.listGoals.mockResolvedValue([]);
  });

  // ── GET / ──

  describe('GET /', () => {
    it('returns souls list', async () => {
      mockSoulsRepo.list.mockResolvedValue([mockSoul]);
      mockSoulsRepo.count.mockResolvedValue(1);
      const res = await app.request('/souls');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.items).toHaveLength(1);
      expect(data.data.total).toBe(1);
    });
  });

  // ── GET /:agentId/logs ──

  describe('GET /:agentId/logs', () => {
    it('returns logs and stats when soul exists', async () => {
      mockHbRepo.listByAgent.mockResolvedValue([
        {
          id: 'log-1',
          createdAt: new Date(),
          durationMs: 1000,
          cost: 0.01,
          tasksRun: ['t1'],
          tasksFailed: [],
        },
      ]);
      mockHbRepo.getStats.mockResolvedValue({
        totalCycles: 10,
        failureRate: 0.1,
        totalCost: 0.5,
        avgDurationMs: 1200,
      });

      const res = await app.request(`/souls/${AGENT_ID}/logs`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.logs).toHaveLength(1);
      expect(data.data.stats.totalCycles).toBe(10);
      expect(data.data.stats.successRate).toBeCloseTo(0.9);
      expect(data.data.stats.avgCost).toBeCloseTo(0.05);
    });

    it('returns zero stats when no history', async () => {
      mockHbRepo.getStats.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/logs`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.stats.totalCycles).toBe(0);
      expect(data.data.stats.successRate).toBe(0);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/logs`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword agentId', async () => {
      const res = await app.request('/souls/logs/logs');
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/memories ──

  describe('GET /:agentId/memories', () => {
    it('returns memories and learnings when soul exists', async () => {
      mockMemorySvc.listMemories.mockResolvedValue([
        { id: 'm1', content: 'Test memory', source: 'chat', createdAt: new Date() },
      ]);

      const res = await app.request(`/souls/${AGENT_ID}/memories`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.memories).toHaveLength(1);
      expect(data.data).toHaveProperty('learnings');
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/memories`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword agentId', async () => {
      const res = await app.request('/souls/memories/memories');
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/goals ──

  describe('GET /:agentId/goals', () => {
    it('returns goals and system goals when soul exists', async () => {
      mockGoalSvc.listGoals.mockResolvedValue([
        { id: 'g1', title: 'Test Goal', status: 'active', progress: 0.5 },
      ]);

      const res = await app.request(`/souls/${AGENT_ID}/goals`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.systemGoals).toHaveLength(1);
      expect(data.data.mission).toBe(mockSoul.purpose.mission);
      expect(data.data.goals).toEqual(mockSoul.purpose.goals);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/goals`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/goals/goals');
      expect(res.status).toBe(404);
    });
  });

  // ── POST /:agentId/goals ──

  describe('POST /:agentId/goals', () => {
    it('adds goal and returns 201 with updated list', async () => {
      const soul = { ...mockSoul, purpose: { ...mockSoul.purpose, goals: ['existing'] } };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request(`/souls/${AGENT_ID}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'new goal' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.goals).toContain('new goal');
    });

    it('returns 400 when goal is missing', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'test' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/goals/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'test' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/tasks ──

  describe('GET /:agentId/tasks', () => {
    it('returns boot tasks and checklist', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/tasks`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.bootTasks).toEqual(['read_inbox']);
      expect(data.data.checklist).toEqual(['check_inbox']);
      expect(data.data.isRunning).toBe(true);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/tasks`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/tasks/tasks');
      expect(res.status).toBe(404);
    });
  });

  // ── POST /:agentId/mission ──

  describe('POST /:agentId/mission', () => {
    it('updates mission and returns accepted status', async () => {
      const soul = {
        ...mockSoul,
        purpose: { ...mockSoul.purpose },
        bootSequence: { ...mockSoul.bootSequence },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request(`/souls/${AGENT_ID}/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'New mission', priority: 'high' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe('accepted');
      expect(data.data.mission).toBe('New mission');
      expect(data.data.priority).toBe('high');
    });

    it('uses default priority "medium" when not specified', async () => {
      const soul = {
        ...mockSoul,
        purpose: { ...mockSoul.purpose },
        bootSequence: { ...mockSoul.bootSequence },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request(`/souls/${AGENT_ID}/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'Test mission' }),
      });
      const data = await res.json();
      expect(data.data.priority).toBe('medium');
    });

    it('sets autoPlan tasks when autoPlan is true', async () => {
      const soul = {
        ...mockSoul,
        purpose: { ...mockSoul.purpose },
        bootSequence: { ...mockSoul.bootSequence, onHeartbeat: [] },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      await app.request(`/souls/${AGENT_ID}/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'Plan mission', autoPlan: true }),
      });
      expect(mockSoulsRepo.update).toHaveBeenCalled();
    });

    it('returns 400 when mission is missing', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'test' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /:agentId/test ──

  describe('POST /:agentId/test', () => {
    it('runs heartbeat and returns success', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: true });

      const res = await app.request(`/souls/${AGENT_ID}/test`, { method: 'POST' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.success).toBe(true);
      expect(mockRunAgentHeartbeat).toHaveBeenCalledWith(AGENT_ID, true);
    });

    it('returns 400 when agent is paused', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue({
        ...mockSoul,
        heartbeat: { ...mockSoul.heartbeat, enabled: false },
      });

      const res = await app.request(`/souls/${AGENT_ID}/test`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('returns 500 when heartbeat run fails', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: false, error: 'Heartbeat error' });

      const res = await app.request(`/souls/${AGENT_ID}/test`, { method: 'POST' });
      expect(res.status).toBe(500);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/test`, { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword agentId', async () => {
      const res = await app.request('/souls/test/test', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/tools ──

  describe('GET /:agentId/tools', () => {
    it('returns tool list with status categorization', async () => {
      mockToolRegistry.getAllTools.mockReturnValue([
        { definition: { name: 'search_web', description: 'Search the web' } },
        { definition: { name: 'mcp.browser', description: 'Browser tool' } },
        { definition: { name: 'custom.my_tool', description: 'My tool' } },
        { definition: { name: 'skill.translator', description: 'Translator' } },
        { definition: { name: 'plugin.slack', description: 'Slack' } },
        { definition: { name: 'execute_shell', description: 'Shell', providerName: 'core' } },
      ]);
      const soul = {
        ...mockSoul,
        autonomy: {
          ...mockSoul.autonomy,
          allowedActions: ['search_web'],
          blockedActions: ['execute_shell'],
        },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request(`/souls/${AGENT_ID}/tools`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.tools).toHaveLength(6);

      const webTool = data.data.tools.find((t: any) => t.name === 'search_web');
      expect(webTool.status).toBe('allowed');

      const shellTool = data.data.tools.find((t: any) => t.name === 'execute_shell');
      expect(shellTool.status).toBe('blocked');

      const mcpTool = data.data.tools.find((t: any) => t.name === 'mcp.browser');
      expect(mcpTool.category).toBe('mcp');

      const pluginTool = data.data.tools.find((t: any) => t.name === 'plugin.slack');
      expect(pluginTool.category).toBe('mcp');

      const customTool = data.data.tools.find((t: any) => t.name === 'custom.my_tool');
      expect(customTool.category).toBe('custom');
    });

    it('assigns ext. prefix tools to custom category', async () => {
      mockToolRegistry.getAllTools.mockReturnValue([
        { definition: { name: 'ext.my_extension', description: 'Extension tool' } },
      ]);

      const res = await app.request(`/souls/${AGENT_ID}/tools`);
      expect(res.status).toBe(200);
      const data = await res.json();
      const extTool = data.data.tools.find((t: any) => t.name === 'ext.my_extension');
      expect(extTool.category).toBe('custom');
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/tools`);
      expect(res.status).toBe(404);
    });

    it('returns 500 when tool registry unavailable', async () => {
      mockGetSharedToolRegistry.mockReturnValueOnce(null);

      const res = await app.request(`/souls/${AGENT_ID}/tools`);
      expect(res.status).toBe(500);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/tools/tools');
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /:agentId/tools ──

  describe('PUT /:agentId/tools', () => {
    it('updates allowed and blocked tool lists', async () => {
      const soul = {
        ...mockSoul,
        autonomy: { ...mockSoul.autonomy, allowedActions: [], blockedActions: [] },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request(`/souls/${AGENT_ID}/tools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: ['search_web'], blocked: ['execute_shell'] }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.allowed).toContain('search_web');
      expect(data.data.blocked).toContain('execute_shell');
    });

    it('only updates allowed when blocked not provided', async () => {
      const soul = {
        ...mockSoul,
        autonomy: { ...mockSoul.autonomy, allowedActions: [], blockedActions: ['old'] },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);

      const res = await app.request(`/souls/${AGENT_ID}/tools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: ['new_tool'] }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.blocked).toContain('old');
      expect(data.data.allowed).toContain('new_tool');
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/tools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: [] }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/tools/tools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: [] }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /:agentId/command ──

  describe('POST /:agentId/command', () => {
    it('handles pause command', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'pause' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.result.message).toContain('paused');
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith(AGENT_ID, false);
    });

    it('handles resume command', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'resume' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.result.message).toContain('resumed');
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith(AGENT_ID, true);
    });

    it('handles run_heartbeat command', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'run_heartbeat' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.result.message).toContain('Heartbeat triggered');
    });

    it('handles reset_budget command', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'reset_budget' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.result.message).toContain('Budget');
    });

    it('handles unknown command gracefully', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'unknown_cmd', params: { key: 'val' } }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.result.message).toContain('Unknown command');
    });

    it('returns 400 when command is missing', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'pause' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/command/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'pause' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/stats ──

  describe('GET /:agentId/stats', () => {
    it('returns stats when soul exists', async () => {
      mockHbRepo.getStats.mockResolvedValue({
        totalCycles: 5,
        totalCost: 0.25,
        avgDurationMs: 2000,
        failureRate: 0.2,
      });
      mockHbRepo.listByAgent.mockResolvedValue([{ createdAt: new Date('2024-06-01') }]);

      const res = await app.request(`/souls/${AGENT_ID}/stats`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.stats.totalCycles).toBe(5);
      expect(data.data.stats.totalCost).toBe(0.25);
      expect(data.data.heartbeat.enabled).toBe(true);
      expect(data.data.heartbeat.lastRunAt).not.toBeNull();
    });

    it('returns zero stats when no history', async () => {
      mockHbRepo.getStats.mockResolvedValue(null);
      mockHbRepo.listByAgent.mockResolvedValue([]);

      const res = await app.request(`/souls/${AGENT_ID}/stats`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.stats.totalCycles).toBe(0);
      expect(data.data.heartbeat.lastRunAt).toBeNull();
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/stats`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for reserved keyword', async () => {
      const res = await app.request('/souls/stats/stats');
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/versions ──

  describe('GET /:agentId/versions', () => {
    it('returns version list', async () => {
      mockSoulsRepo.getVersions.mockResolvedValue([{ v: 1 }, { v: 2 }]);

      const res = await app.request(`/souls/${AGENT_ID}/versions`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(2);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/versions`);
      expect(res.status).toBe(404);
    });
  });

  // ── GET /:agentId/versions/:v ──

  describe('GET /:agentId/versions/:v', () => {
    it('returns specific version when found', async () => {
      mockSoulsRepo.getVersion.mockResolvedValue({ v: 1, snapshot: { id: 'soul-1' } });

      const res = await app.request(`/souls/${AGENT_ID}/versions/1`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.v).toBe(1);
    });

    it('returns 404 when version not found', async () => {
      mockSoulsRepo.getVersion.mockResolvedValue(null);

      const res = await app.request(`/souls/${AGENT_ID}/versions/99`);
      expect(res.status).toBe(404);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}/versions/1`);
      expect(res.status).toBe(404);
    });
  });

  // ── POST / (create soul) ──

  describe('POST /', () => {
    const validBody = {
      agentId: 'new-agent-id',
      identity: mockSoul.identity,
      purpose: mockSoul.purpose,
      autonomy: mockSoul.autonomy,
      heartbeat: mockSoul.heartbeat,
      evolution: mockSoul.evolution,
    };

    it('creates soul and returns 201', async () => {
      mockSoulsRepo.create.mockResolvedValue({ ...mockSoul, agentId: 'new-agent-id' });

      const res = await app.request('/souls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.agentId).toBeDefined();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.request('/souls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'x' }), // missing identity, purpose, etc.
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid autonomy.level (out-of-range)', async () => {
      const res = await app.request('/souls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          autonomy: { ...mockSoul.autonomy, level: 5 },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('autonomy.level');
    });

    it('returns 400 for fractional autonomy.level', async () => {
      const res = await app.request('/souls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          autonomy: { ...mockSoul.autonomy, level: 1.5 },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 on DB error', async () => {
      mockSoulsRepo.create.mockRejectedValue(new Error('DB write failed'));

      const res = await app.request('/souls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(500);
    });
  });

  // ── POST /deploy (additional coverage) ──

  describe('POST /deploy — additional HTTP coverage', () => {
    it('deploys agent and soul successfully (executes transaction callback)', async () => {
      // The adapter mock runs fn() directly, so this exercises lines inside the callback
      mockSoulsRepo.create.mockResolvedValue({ ...mockSoul });

      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: { name: 'New Deploy Agent' } }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.agentId).toBeDefined();
      expect(data.data.soul).toBeDefined();
    });

    it('returns 400 for invalid autonomy.level in deploy (line 159)', async () => {
      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: { name: 'Test' },
          autonomy: { level: 99 },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('autonomy.level');
    });

    it('returns 500 on JSON parse error (outer catch block)', async () => {
      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      });

      expect(res.status).toBe(500);
    });
  });

  // ── GET /:agentId ──

  describe('GET /:agentId', () => {
    it('returns soul when found', async () => {
      const res = await app.request(`/souls/${AGENT_ID}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.agentId).toBe(AGENT_ID);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      const res = await app.request(`/souls/${AGENT_ID}`);
      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB error'));
      const res = await app.request(`/souls/${AGENT_ID}`);
      expect(res.status).toBe(500);
    });
  });

  // ── PUT /:agentId — update soul + validateEvolutionChanges ──

  describe('PUT /:agentId', () => {
    it('updates soul identity and returns updated soul', async () => {
      const updatedSoul = { ...mockSoul, identity: { ...mockSoul.identity, name: 'Updated Name' } };
      mockSoulsRepo.getByAgentId
        .mockResolvedValueOnce({ ...mockSoul })
        .mockResolvedValueOnce(updatedSoul);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: { ...mockSoul.identity, name: 'Updated Name' } }),
      });

      expect(res.status).toBe(200);
      expect(mockSoulsRepo.update).toHaveBeenCalled();
    });

    it('allows update when no evolution changes (validateEvolutionChanges early return)', async () => {
      mockSoulsRepo.getByAgentId
        .mockResolvedValueOnce({ ...mockSoul })
        .mockResolvedValueOnce({ ...mockSoul });

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: { ...mockSoul.purpose, mission: 'New mission' } }),
      });

      expect(res.status).toBe(200);
    });

    it('allows coreTraits update when existing coreTraits are empty (can be set initially)', async () => {
      const soulNoTraits = {
        ...mockSoul,
        evolution: { ...mockSoul.evolution, coreTraits: [] },
      };
      mockSoulsRepo.getByAgentId
        .mockResolvedValueOnce(soulNoTraits)
        .mockResolvedValueOnce(soulNoTraits);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evolution: { ...mockSoul.evolution, coreTraits: ['honesty'] },
        }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 400 when coreTraits are modified after initial set (core trait protection — length diff)', async () => {
      const soulWithTraits = {
        ...mockSoul,
        evolution: {
          ...mockSoul.evolution,
          coreTraits: ['honesty', 'helpfulness'],
        },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soulWithTraits);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evolution: { ...mockSoul.evolution, coreTraits: ['honesty'] }, // different length
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Core traits');
    });

    it('returns 400 when coreTraits changed with same length (every() check)', async () => {
      const soulWithTraits = {
        ...mockSoul,
        evolution: {
          ...mockSoul.evolution,
          coreTraits: ['honesty', 'helpfulness'],
        },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soulWithTraits);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Same length (2) but different content → isSame=false → error
          evolution: { coreTraits: ['honesty', 'courage'] },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Core traits');
    });

    it('returns 400 when attempting manual → autonomous evolution mode transition', async () => {
      const soulManual = {
        ...mockSoul,
        evolution: { ...mockSoul.evolution, evolutionMode: 'manual', coreTraits: [] },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soulManual);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evolution: { evolutionMode: 'autonomous' },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('supervised');
    });

    it('allows valid evolution mode transition (supervised → autonomous)', async () => {
      const soulSupervised = {
        ...mockSoul,
        evolution: { ...mockSoul.evolution, evolutionMode: 'supervised', coreTraits: [] },
      };
      mockSoulsRepo.getByAgentId
        .mockResolvedValueOnce(soulSupervised)
        .mockResolvedValueOnce(soulSupervised);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evolution: { evolutionMode: 'autonomous' },
        }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: mockSoul.identity }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB error'));

      const res = await app.request(`/souls/${AGENT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: mockSoul.identity }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ── DELETE /:agentId ──

  describe('DELETE /:agentId', () => {
    it('deletes soul and returns deleted: true', async () => {
      mockSoulsRepo.delete.mockResolvedValue(true);

      const res = await app.request(`/souls/${AGENT_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(true);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.delete.mockResolvedValue(false);

      const res = await app.request(`/souls/${AGENT_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockSoulsRepo.delete.mockRejectedValue(new Error('DB error'));

      const res = await app.request(`/souls/${AGENT_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });

  // ── POST /:agentId/feedback ──

  describe('POST /:agentId/feedback', () => {
    it('applies praise feedback and increments version', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'praise', content: 'Great work!', source: 'user' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.evolution.learnings).toContain('Positive: Great work!');
      expect(data.data.evolution.version).toBe(2); // incremented from 1
      expect(mockSoulsRepo.createVersion).toHaveBeenCalled();
      expect(mockSoulsRepo.update).toHaveBeenCalled();
    });

    it('applies correction feedback and updates boundaries', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'correction', content: 'No spam emails' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.identity.boundaries).toContain('No spam emails');
      expect(data.data.evolution.learnings).toContain('Correction: No spam emails');
    });

    it('applies directive feedback and adds to goals', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'directive', content: 'Focus on research tasks' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.purpose.goals).toContain('Focus on research tasks');
    });

    it('applies personality_tweak feedback and adds to mutableTraits', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'personality_tweak', content: 'Be more concise' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.evolution.mutableTraits).toContain('Be more concise');
      expect(data.data.evolution.learnings).toContain('Personality: Be more concise');
    });

    it('trims learnings to 50 when over 50 entries', async () => {
      const soulWithManyLearnings = {
        ...mockSoul,
        evolution: {
          ...mockSoul.evolution,
          learnings: Array(51).fill('Old learning'),
          feedbackLog: [],
        },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soulWithManyLearnings);

      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'praise', content: 'New praise' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.evolution.learnings.length).toBeLessThanOrEqual(50);
    });

    it('trims feedbackLog to 100 when over 100 entries', async () => {
      const soulWithFullLog = {
        ...mockSoul,
        evolution: {
          ...mockSoul.evolution,
          learnings: [],
          feedbackLog: Array(101).fill({
            id: 'fb-x',
            type: 'praise',
            content: 'old',
            source: 'user',
            timestamp: new Date(),
            appliedToVersion: 1,
          }),
        },
      };
      mockSoulsRepo.getByAgentId.mockResolvedValue(soulWithFullLog);

      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'praise', content: 'Another' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.evolution.feedbackLog.length).toBeLessThanOrEqual(100);
    });

    it('returns 400 when type or content is missing', async () => {
      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'praise' }), // missing content
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when soul not found', async () => {
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);

      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'praise', content: 'Good' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB error'));

      const res = await app.request(`/souls/${AGENT_ID}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'praise', content: 'Good' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ── Error handler (catch block) coverage for existing routes ──

  describe('Error handler coverage (500 on thrown DB errors)', () => {
    it('GET /:agentId/logs returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/logs`);
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/memories returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/memories`);
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/goals returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/goals`);
      expect(res.status).toBe(500);
    });

    it('POST /:agentId/goals returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'test' }),
      });
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/tasks returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/tasks`);
      expect(res.status).toBe(500);
    });

    it('POST /:agentId/mission returns 404 for reserved keyword agentId', async () => {
      // 'deploy' is in RESERVED_KEYWORDS
      const res = await app.request('/souls/deploy/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'test' }),
      });
      expect(res.status).toBe(404);
    });

    it('POST /:agentId/mission returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'test' }),
      });
      expect(res.status).toBe(500);
    });

    it('POST /:agentId/test returns 500 when heartbeat throws (outer catch)', async () => {
      mockRunAgentHeartbeat.mockRejectedValue(new Error('heartbeat crashed'));
      const res = await app.request(`/souls/${AGENT_ID}/test`, { method: 'POST' });
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/tools returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/tools`);
      expect(res.status).toBe(500);
    });

    it('PUT /:agentId/tools returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/tools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: [] }),
      });
      expect(res.status).toBe(500);
    });

    it('POST /:agentId/command returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'pause' }),
      });
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/stats returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/stats`);
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/versions/:v returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/versions/1`);
      expect(res.status).toBe(500);
    });

    it('GET /:agentId/versions returns 500 on DB throw', async () => {
      mockSoulsRepo.getByAgentId.mockRejectedValue(new Error('DB down'));
      const res = await app.request(`/souls/${AGENT_ID}/versions`);
      expect(res.status).toBe(500);
    });

    it('GET / returns 500 on DB throw', async () => {
      mockSoulsRepo.list.mockRejectedValue(new Error('DB down'));
      const res = await app.request('/souls');
      expect(res.status).toBe(500);
    });
  });
});
