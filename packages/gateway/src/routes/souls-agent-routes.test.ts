/**
 * Soul Agent Routes Tests
 *
 * Tests the agent sub-routes:
 * - GET /:agentId/logs - Get agent execution logs
 * - GET /:agentId/memories - Get agent memories
 * - GET /:agentId/goals - Get agent goals
 * - POST /:agentId/goals - Add a goal
 * - GET /:agentId/tasks - Get agent tasks
 * - POST /:agentId/mission - Assign mission
 * - POST /:agentId/test - Run test heartbeat
 * - GET /:agentId/tools - Get tools with permissions
 * - PUT /:agentId/tools - Update tool permissions
 * - POST /:agentId/command - Send command
 * - GET /:agentId/stats - Get statistics
 * - GET /:agentId/versions - Get version history
 * - GET /:agentId/versions/:v - Get specific version
 * - POST /:agentId/feedback - Apply feedback
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock crypto.randomUUID
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: vi.fn().mockReturnValue('test-uuid-123'),
  },
});

// Mock repositories
const mockGetByAgentId = vi.fn();
const mockUpdate = vi.fn();
const mockSetHeartbeatEnabled = vi.fn();
const mockGetVersions = vi.fn();
const mockGetVersion = vi.fn();
const mockCreateVersion = vi.fn();

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: vi.fn().mockReturnValue({
    getByAgentId: mockGetByAgentId,
    update: mockUpdate,
    setHeartbeatEnabled: mockSetHeartbeatEnabled,
    getVersions: mockGetVersions,
    getVersion: mockGetVersion,
    createVersion: mockCreateVersion,
  }),
}));

const mockListByAgent = vi.fn();
const mockGetStats = vi.fn();

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: vi.fn().mockReturnValue({
    listByAgent: mockListByAgent,
    getStats: mockGetStats,
  }),
}));

// Mock tool executor
const mockGetAllTools = vi.fn();

vi.mock('../services/tool-executor.js', () => ({
  getSharedToolRegistry: vi.fn().mockReturnValue({
    getAllTools: mockGetAllTools,
  }),
}));

// Mock soul heartbeat service
const mockRunAgentHeartbeat = vi.fn();

vi.mock('../services/soul-heartbeat-service.js', () => ({
  runAgentHeartbeat: mockRunAgentHeartbeat,
}));

// Mock @ownpilot/core
const mockListMemories = vi.fn();
const mockListGoals = vi.fn();

// Define the mock Services symbols
const MockMemorySymbol = Symbol.for('ownpilot.memory');
const MockGoalSymbol = Symbol.for('ownpilot.goal');

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    getServiceRegistry: vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((service: symbol) => {
        if (service === MockMemorySymbol) {
          return { listMemories: mockListMemories };
        }
        if (service === MockGoalSymbol) {
          return { listGoals: mockListGoals };
        }
        return null;
      }),
    }),
    Services: {
      Memory: MockMemorySymbol,
      Goal: MockGoalSymbol,
    },
  };
});

// Import after mocks
const { soulAgentRoutes } = await import('./souls-agent-routes.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/', soulAgentRoutes);
  app.onError(errorHandler);
  return app;
}

const mockSoul = {
  id: 'soul-123',
  agentId: 'agent-test',
  identity: {
    name: 'Test Agent',
    emoji: '🤖',
    boundaries: [],
  },
  purpose: {
    mission: 'Test mission',
    goals: ['Goal 1', 'Goal 2'],
  },
  evolution: {
    version: 5,
    learnings: ['Learning 1', 'Learning 2'],
    mutableTraits: [],
    feedbackLog: [],
  },
  heartbeat: {
    enabled: true,
    interval: 300,
    checklist: ['task1', 'task2'],
  },
  bootSequence: {
    onHeartbeat: ['boot-task1'],
  },
  autonomy: {
    allowedActions: ['search_tools', 'use_tool'],
    blockedActions: ['dangerous_tool'],
    maxCostPerDay: 10,
    maxCostPerMonth: 100,
  },
  relationships: {},
  updatedAt: new Date(),
};

describe('soulAgentRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByAgentId.mockResolvedValue(mockSoul);
  });

  describe('Reserved keyword validation', () => {
    it('returns 404 for reserved keywords', async () => {
      const app = createApp();
      const keywords = ['test', 'tools', 'stats', 'command', 'deploy', 'logs', 'memories', 'goals', 'tasks'];

      for (const keyword of keywords) {
        const res = await app.request(`/${keyword}/logs`);
        expect(res.status).toBe(404);
      }
    });
  });

  describe('GET /:agentId/logs', () => {
    it('returns agent logs with stats', async () => {
      mockListByAgent.mockResolvedValue([
        {
          id: 'log-1',
          createdAt: new Date('2026-03-10T10:00:00Z'),
          durationMs: 1000,
          cost: 0.5,
          tasksRun: ['task1', 'task2'],
          tasksFailed: [],
        },
      ]);
      mockGetStats.mockResolvedValue({
        totalCycles: 10,
        failureRate: 0.1,
        totalCost: 5.0,
        avgDurationMs: 2000,
      });

      const app = createApp();
      const res = await app.request('/agent-test/logs');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.agentId).toBe('agent-test');
      expect(body.data.logs).toHaveLength(1);
      expect(body.data.logs[0]).toMatchObject({
        id: 'log-1',
        tasksRun: 2,
        tasksFailed: 0,
      });
      expect(body.data.stats).toMatchObject({
        totalCycles: 10,
        successRate: 0.9,
        avgCost: 0.5,
      });
    });

    it('returns 404 when soul not found', async () => {
      mockGetByAgentId.mockResolvedValue(null);

      const app = createApp();
      const res = await app.request('/unknown/logs');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:agentId/memories', () => {
    it('returns memories and learnings', async () => {
      mockListMemories.mockResolvedValue([
        { id: 'mem-1', content: 'Memory 1', source: 'chat', createdAt: new Date() },
        { id: 'mem-2', content: 'Memory 2', source: 'task', createdAt: new Date() },
      ]);

      const app = createApp();
      const res = await app.request('/agent-test/memories');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.agentId).toBe('agent-test');
      expect(body.data.memories).toHaveLength(2);
      expect(body.data.learnings).toEqual(['Learning 1', 'Learning 2']);
    });

    it('returns 404 when soul not found', async () => {
      mockGetByAgentId.mockResolvedValue(null);

      const app = createApp();
      const res = await app.request('/unknown/memories');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:agentId/goals', () => {
    it('returns goals and mission', async () => {
      mockListGoals.mockResolvedValue([
        { id: 'goal-1', title: 'System Goal 1', status: 'active', progress: 50 },
      ]);

      const app = createApp();
      const res = await app.request('/agent-test/goals');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.mission).toBe('Test mission');
      expect(body.data.goals).toEqual(['Goal 1', 'Goal 2']);
      expect(body.data.systemGoals).toHaveLength(1);
    });
  });

  describe('POST /:agentId/goals', () => {
    it('adds a new goal', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'New Goal' }),
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.data.goals).toContain('New Goal');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns 400 when goal is missing', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /:agentId/tasks', () => {
    it('returns boot tasks and checklist', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/tasks');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.bootTasks).toEqual(['boot-task1']);
      expect(body.data.checklist).toEqual(['task1', 'task2']);
      expect(body.data.isRunning).toBe(true);
    });
  });

  describe('POST /:agentId/mission', () => {
    it('assigns a new mission', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission: 'New mission statement',
          priority: 'high',
          autoPlan: true,
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.mission).toBe('New mission statement');
      expect(body.data.priority).toBe('high');
      expect(body.data.status).toBe('accepted');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns 400 when mission is missing', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /:agentId/test', () => {
    it('runs test heartbeat successfully', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: true });

      const app = createApp();
      const res = await app.request('/agent-test/test', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.agentId).toBe('agent-test');
    });

    it('returns 400 when agent is paused', async () => {
      mockGetByAgentId.mockResolvedValue({
        ...mockSoul,
        heartbeat: { ...mockSoul.heartbeat, enabled: false },
      });

      const app = createApp();
      const res = await app.request('/agent-test/test', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('returns 500 when test fails', async () => {
      mockRunAgentHeartbeat.mockResolvedValue({ success: false, error: 'Test failed' });

      const app = createApp();
      const res = await app.request('/agent-test/test', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /:agentId/tools', () => {
    it('returns tools with permission status', async () => {
      mockGetAllTools.mockReturnValue([
        { definition: { name: 'search_tools', description: 'Search tools' } },
        { definition: { name: 'mcp.tool1', description: 'MCP tool' } },
        { definition: { name: 'custom.tool1', description: 'Custom tool' } },
        { definition: { name: 'dangerous_tool', description: 'Dangerous' } },
      ]);

      const app = createApp();
      const res = await app.request('/agent-test/tools');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.tools).toHaveLength(4);
      expect(body.data.summary.total).toBe(4);

      const searchTool = body.data.tools.find((t: { name: string }) => t.name === 'search_tools');
      expect(searchTool?.status).toBe('allowed');

      const blockedTool = body.data.tools.find((t: { name: string }) => t.name === 'dangerous_tool');
      expect(blockedTool?.status).toBe('blocked');
    });
  });

  describe('PUT /:agentId/tools', () => {
    it('updates tool permissions', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/tools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowed: ['tool1', 'tool2'],
          blocked: ['tool3'],
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.allowed).toEqual(['tool1', 'tool2']);
      expect(body.data.blocked).toEqual(['tool3']);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe('POST /:agentId/command', () => {
    it('handles pause command', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'pause' }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.result.message).toBe('Agent paused');
      expect(mockSetHeartbeatEnabled).toHaveBeenCalledWith('agent-test', false);
    });

    it('handles resume command', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'resume' }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.result.message).toBe('Agent resumed');
      expect(mockSetHeartbeatEnabled).toHaveBeenCalledWith('agent-test', true);
    });

    it('handles run_heartbeat command', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'run_heartbeat' }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.result.message).toBe('Heartbeat triggered');
    });

    it('handles unknown commands', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'unknown_command' }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.result.message).toContain('Unknown command');
    });

    it('returns 400 when command is missing', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /:agentId/stats', () => {
    it('returns agent statistics', async () => {
      mockGetStats.mockResolvedValue({
        totalCycles: 50,
        totalCost: 25.5,
        avgDurationMs: 3000,
        failureRate: 0.05,
      });
      mockListByAgent.mockResolvedValue([
        { createdAt: new Date('2026-03-10T12:00:00Z') },
      ]);

      const app = createApp();
      const res = await app.request('/agent-test/stats');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.agentId).toBe('agent-test');
      expect(body.data.soulVersion).toBe(5);
      expect(body.data.heartbeat.enabled).toBe(true);
      expect(body.data.stats.totalCycles).toBe(50);
      expect(body.data.budget.maxCostPerDay).toBe(10);
    });
  });

  describe('GET /:agentId/versions', () => {
    it('returns version history', async () => {
      mockGetVersions.mockResolvedValue([
        { version: 5, createdAt: new Date(), reason: 'Update' },
        { version: 4, createdAt: new Date(), reason: 'Fix' },
      ]);

      const app = createApp();
      const res = await app.request('/agent-test/versions');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /:agentId/versions/:v', () => {
    it('returns specific version', async () => {
      mockGetVersion.mockResolvedValue({
        version: 3,
        snapshot: { identity: { name: 'Test' } },
        createdAt: new Date(),
      });

      const app = createApp();
      const res = await app.request('/agent-test/versions/3');
      expect(res.status).toBe(200);
    });

    it('returns 404 when version not found', async () => {
      mockGetVersion.mockResolvedValue(null);

      const app = createApp();
      const res = await app.request('/agent-test/versions/999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:agentId/feedback', () => {
    it('applies praise feedback', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'praise',
          content: 'Great job!',
        }),
      });
      expect(res.status).toBe(200);

      expect(mockCreateVersion).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('applies correction feedback', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'correction',
          content: 'Do not do that',
          source: 'user',
        }),
      });
      expect(res.status).toBe(200);

      const updatedSoul = mockUpdate.mock.calls[0][0];
      expect(updatedSoul.identity.boundaries).toContain('Do not do that');
    });

    it('applies directive feedback', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'directive',
          content: 'New directive goal',
        }),
      });
      expect(res.status).toBe(200);

      const updatedSoul = mockUpdate.mock.calls[0][0];
      expect(updatedSoul.purpose.goals).toContain('New directive goal');
    });

    it('returns 400 when required fields missing', async () => {
      const app = createApp();
      const res = await app.request('/agent-test/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
