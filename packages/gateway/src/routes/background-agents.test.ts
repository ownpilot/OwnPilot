/**
 * Background Agents Routes Tests
 *
 * Comprehensive test suite for background agent management endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mocks — safe to reference inside vi.mock() factories ─────────────

const { mockService } = vi.hoisted(() => {
  const mockService = {
    listAgents: vi.fn(),
    listSessions: vi.fn(),
    createAgent: vi.fn(),
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    startAgent: vi.fn(),
    pauseAgent: vi.fn(),
    resumeAgent: vi.fn(),
    stopAgent: vi.fn(),
    sendMessage: vi.fn(),
    getHistory: vi.fn(),
    getSession: vi.fn(),
    executeNow: vi.fn(),
  };
  return { mockService };
});

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../services/background-agent-service.js', () => ({
  getBackgroundAgentService: vi.fn(() => mockService),
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { backgroundAgentsRoutes } from './background-agents.js';
import { errorHandler } from '../middleware/error-handler.js';

// ─── Test data ────────────────────────────────────────────────────────────────

const sampleConfig = {
  id: 'agent-1',
  userId: 'user-1',
  name: 'My Agent',
  mission: 'Monitor prices',
  mode: 'interval',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleSession = {
  config: { id: 'agent-1' },
  state: 'running',
  cyclesCompleted: 5,
  totalToolCalls: 20,
  totalCostUsd: 0.05,
  lastCycleAt: '2026-01-01T01:00:00Z',
  lastCycleDurationMs: 1200,
  lastCycleError: null,
  startedAt: '2026-01-01T00:00:00Z',
  stoppedAt: null,
  persistentContext: {},
  inbox: [],
};

const sampleHistoryEntry = {
  executedAt: new Date('2026-01-01T00:00:00Z'),
  success: true,
  durationMs: 500,
  toolCalls: [{ name: 'search_web', args: {} }],
  error: null,
};

// ─── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.onError(errorHandler);
  app.route('/background-agents', backgroundAgentsRoutes);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Background Agents Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // ─── GET / — list agents ─────────────────────────────────────────────────

  describe('GET /background-agents - List agents with sessions', () => {
    it('should return agents merged with their active sessions', async () => {
      mockService.listAgents.mockResolvedValue([sampleConfig]);
      mockService.listSessions.mockReturnValue([sampleSession]);

      const res = await app.request('/background-agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('agent-1');
      expect(data.data[0].session).not.toBeNull();
      expect(data.data[0].session.state).toBe('running');
      expect(data.data[0].session.cyclesCompleted).toBe(5);
    });

    it('should return agents with null session when no session is active', async () => {
      mockService.listAgents.mockResolvedValue([sampleConfig]);
      mockService.listSessions.mockReturnValue([]);

      const res = await app.request('/background-agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data[0].session).toBeNull();
    });

    it('should return empty array when no agents exist', async () => {
      mockService.listAgents.mockResolvedValue([]);
      mockService.listSessions.mockReturnValue([]);

      const res = await app.request('/background-agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });

    it('should return 500 on service error', async () => {
      mockService.listAgents.mockRejectedValue(new Error('DB connection failed'));

      const res = await app.request('/background-agents');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
      expect(data.error.message).toContain('DB connection failed');
    });

    it('should only include relevant session fields in the list response', async () => {
      mockService.listAgents.mockResolvedValue([sampleConfig]);
      mockService.listSessions.mockReturnValue([sampleSession]);

      const res = await app.request('/background-agents');
      const data = await res.json();
      const session = data.data[0].session;

      // Fields that should be present in list response
      expect(session).toHaveProperty('state');
      expect(session).toHaveProperty('cyclesCompleted');
      expect(session).toHaveProperty('totalToolCalls');
      expect(session).toHaveProperty('totalCostUsd');
      expect(session).toHaveProperty('lastCycleAt');
      expect(session).toHaveProperty('lastCycleDurationMs');
      expect(session).toHaveProperty('lastCycleError');
      expect(session).toHaveProperty('startedAt');
      expect(session).toHaveProperty('stoppedAt');
      // Fields present on detail but NOT in list
      expect(session).not.toHaveProperty('persistentContext');
      expect(session).not.toHaveProperty('inbox');
    });
  });

  // ─── POST / — create agent ───────────────────────────────────────────────

  describe('POST /background-agents - Create agent', () => {
    it('should create an agent with valid input', async () => {
      mockService.createAgent.mockResolvedValue(sampleConfig);

      const res = await app.request('/background-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Agent', mission: 'Monitor prices', mode: 'interval' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('agent-1');
      expect(mockService.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          name: 'My Agent',
          mission: 'Monitor prices',
          mode: 'interval',
        })
      );
    });

    it('should create agent with default interval mode when mode is omitted', async () => {
      mockService.createAgent.mockResolvedValue(sampleConfig);

      await app.request('/background-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Agent', mission: 'Monitor prices' }),
      });

      expect(mockService.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'interval' })
      );
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/background-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'Monitor prices' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('name is required');
    });

    it('should return 400 when mission is missing', async () => {
      const res = await app.request('/background-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Agent' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('mission is required');
    });

    it('should return 400 when mode is invalid', async () => {
      const res = await app.request('/background-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Agent', mission: 'Do stuff', mode: 'badmode' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('mode must be one of');
      expect(data.error.message).toContain('continuous');
      expect(data.error.message).toContain('interval');
      expect(data.error.message).toContain('event');
    });

    it('should accept all valid modes', async () => {
      mockService.createAgent.mockResolvedValue(sampleConfig);

      for (const mode of ['continuous', 'interval', 'event']) {
        vi.clearAllMocks();
        mockService.createAgent.mockResolvedValue({ ...sampleConfig, mode });

        const res = await app.request('/background-agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Agent', mission: 'Do stuff', mode }),
        });

        expect(res.status).toBe(201);
      }
    });

    it('should return 500 on service error', async () => {
      mockService.createAgent.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/background-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Agent', mission: 'Monitor prices' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ─── GET /:id — get agent details ────────────────────────────────────────

  describe('GET /background-agents/:id - Get agent details', () => {
    it('should return agent with session when both exist', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getSession.mockReturnValue(sampleSession);

      const res = await app.request('/background-agents/agent-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('agent-1');
      expect(data.data.session).not.toBeNull();
      expect(data.data.session.state).toBe('running');
      expect(data.data.session.persistentContext).toEqual({});
      expect(data.data.session.inbox).toEqual([]);
    });

    it('should return agent with null session when no session exists', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getSession.mockReturnValue(null);

      const res = await app.request('/background-agents/agent-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.session).toBeNull();
    });

    it('should return 404 when agent does not exist', async () => {
      mockService.getAgent.mockResolvedValue(null);

      const res = await app.request('/background-agents/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return 500 on service error', async () => {
      mockService.getAgent.mockRejectedValue(new Error('DB timeout'));

      const res = await app.request('/background-agents/agent-1');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ─── PATCH /:id — update agent ───────────────────────────────────────────

  describe('PATCH /background-agents/:id - Update agent', () => {
    it('should update agent with valid fields', async () => {
      const updated = { ...sampleConfig, name: 'Renamed Agent' };
      mockService.updateAgent.mockResolvedValue(updated);

      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Agent' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('Renamed Agent');
      expect(mockService.updateAgent).toHaveBeenCalledWith(
        'agent-1',
        'user-1',
        expect.objectContaining({ name: 'Renamed Agent' })
      );
    });

    it('should return 404 when agent is not found', async () => {
      mockService.updateAgent.mockResolvedValue(null);

      const res = await app.request('/background-agents/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return 400 when mode is invalid', async () => {
      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'scheduled' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('mode must be one of');
    });

    it('should return 400 when limits contain non-positive numbers', async () => {
      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: { maxTurns: -1 } }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('limits.maxTurns must be a positive finite number');
    });

    it('should return 400 when limits contain non-numeric values', async () => {
      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: { maxTurns: 'many' } }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('limits.maxTurns must be a positive finite number');
    });

    it('should return 400 when limits exceed maximum allowed', async () => {
      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: { maxTurns: 999999 } }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('limits.maxTurns exceeds maximum allowed value');
    });

    it('should accept valid limits within bounds', async () => {
      const updated = { ...sampleConfig, limits: { maxTurns: 100 } };
      mockService.updateAgent.mockResolvedValue(updated);

      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: { maxTurns: 100 } }),
      });

      expect(res.status).toBe(200);
    });

    it('should return 500 on service error', async () => {
      mockService.updateAgent.mockRejectedValue(new Error('Write failed'));

      const res = await app.request('/background-agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ─── DELETE /:id — delete agent ──────────────────────────────────────────

  describe('DELETE /background-agents/:id - Delete agent', () => {
    it('should delete agent and return success', async () => {
      mockService.deleteAgent.mockResolvedValue(true);

      const res = await app.request('/background-agents/agent-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.deleted).toBe(true);
      expect(mockService.deleteAgent).toHaveBeenCalledWith('agent-1', 'user-1');
    });

    it('should return 404 when agent is not found', async () => {
      mockService.deleteAgent.mockResolvedValue(false);

      const res = await app.request('/background-agents/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return 500 on service error', async () => {
      mockService.deleteAgent.mockRejectedValue(new Error('Delete failed'));

      const res = await app.request('/background-agents/agent-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /:id/history — cycle history ────────────────────────────────────

  describe('GET /background-agents/:id/history - Get cycle history', () => {
    it('should return history with pagination metadata', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getHistory.mockResolvedValue({
        entries: [sampleHistoryEntry],
        total: 1,
      });

      const res = await app.request('/background-agents/agent-1/history');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.entries).toHaveLength(1);
      expect(data.data.total).toBe(1);
      expect(data.data.limit).toBe(20);
      expect(data.data.offset).toBe(0);
    });

    it('should pass custom pagination params to service', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getHistory.mockResolvedValue({ entries: [], total: 0 });

      await app.request('/background-agents/agent-1/history?limit=10&offset=20');

      expect(mockService.getHistory).toHaveBeenCalledWith('agent-1', 'user-1', 10, 20);
    });

    it('should return 404 when agent does not exist', async () => {
      mockService.getAgent.mockResolvedValue(null);

      const res = await app.request('/background-agents/agent-1/history');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return 500 on service error', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getHistory.mockRejectedValue(new Error('History unavailable'));

      const res = await app.request('/background-agents/agent-1/history');

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/message — send message to inbox ───────────────────────────

  describe('POST /background-agents/:id/message - Send message to inbox', () => {
    it('should send message and return success', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.sendMessage.mockResolvedValue(undefined);

      const res = await app.request('/background-agents/agent-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello agent' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.sent).toBe(true);
      expect(mockService.sendMessage).toHaveBeenCalledWith('agent-1', 'user-1', 'Hello agent');
    });

    it('should return 400 when message field is missing', async () => {
      const res = await app.request('/background-agents/agent-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('message is required');
    });

    it('should return 404 when agent does not exist', async () => {
      mockService.getAgent.mockResolvedValue(null);

      const res = await app.request('/background-agents/nonexistent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return 400 when agent is not running', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.sendMessage.mockRejectedValue(new Error('Agent is not running'));

      const res = await app.request('/background-agents/agent-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 on unexpected service error', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.sendMessage.mockRejectedValue(new Error('Internal queue failure'));

      const res = await app.request('/background-agents/agent-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/start — start agent ───────────────────────────────────────

  describe('POST /background-agents/:id/start - Start agent', () => {
    it('should start agent and return session info', async () => {
      mockService.startAgent.mockResolvedValue(sampleSession);

      const res = await app.request('/background-agents/agent-1/start', { method: 'POST' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.state).toBe('running');
      expect(data.data.cyclesCompleted).toBe(5);
      expect(data.data.startedAt).toBe('2026-01-01T00:00:00Z');
      expect(mockService.startAgent).toHaveBeenCalledWith('agent-1', 'user-1');
    });

    it('should return 404 when agent is not found', async () => {
      mockService.startAgent.mockRejectedValue(new Error('Agent not found'));

      const res = await app.request('/background-agents/nonexistent/start', { method: 'POST' });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 409 when agent is already running', async () => {
      mockService.startAgent.mockRejectedValue(new Error('Agent is already running'));

      const res = await app.request('/background-agents/agent-1/start', { method: 'POST' });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 on unexpected error', async () => {
      mockService.startAgent.mockRejectedValue(new Error('Resource allocation failed'));

      const res = await app.request('/background-agents/agent-1/start', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/pause — pause agent ───────────────────────────────────────

  describe('POST /background-agents/:id/pause - Pause agent', () => {
    it('should pause a running agent', async () => {
      mockService.pauseAgent.mockResolvedValue(true);

      const res = await app.request('/background-agents/agent-1/pause', { method: 'POST' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.state).toBe('paused');
      expect(mockService.pauseAgent).toHaveBeenCalledWith('agent-1', 'user-1');
    });

    it('should return 400 when agent is not running', async () => {
      mockService.pauseAgent.mockResolvedValue(false);

      const res = await app.request('/background-agents/agent-1/pause', { method: 'POST' });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Agent is not running');
    });

    it('should return 500 on service error', async () => {
      mockService.pauseAgent.mockRejectedValue(new Error('Pause signal failed'));

      const res = await app.request('/background-agents/agent-1/pause', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/resume — resume agent ─────────────────────────────────────

  describe('POST /background-agents/:id/resume - Resume agent', () => {
    it('should resume a paused agent', async () => {
      mockService.resumeAgent.mockResolvedValue(true);

      const res = await app.request('/background-agents/agent-1/resume', { method: 'POST' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.state).toBe('running');
      expect(mockService.resumeAgent).toHaveBeenCalledWith('agent-1', 'user-1');
    });

    it('should return 400 when agent is not paused', async () => {
      mockService.resumeAgent.mockResolvedValue(false);

      const res = await app.request('/background-agents/agent-1/resume', { method: 'POST' });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Agent is not paused');
    });

    it('should return 500 on service error', async () => {
      mockService.resumeAgent.mockRejectedValue(new Error('Resume failed'));

      const res = await app.request('/background-agents/agent-1/resume', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/stop — stop agent ─────────────────────────────────────────

  describe('POST /background-agents/:id/stop - Stop agent', () => {
    it('should stop a running agent', async () => {
      mockService.stopAgent.mockResolvedValue(true);

      const res = await app.request('/background-agents/agent-1/stop', { method: 'POST' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.state).toBe('stopped');
      expect(mockService.stopAgent).toHaveBeenCalledWith('agent-1', 'user-1');
    });

    it('should return 400 when agent is not running', async () => {
      mockService.stopAgent.mockResolvedValue(false);

      const res = await app.request('/background-agents/agent-1/stop', { method: 'POST' });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Agent is not running');
    });

    it('should return 500 on service error', async () => {
      mockService.stopAgent.mockRejectedValue(new Error('Stop signal failed'));

      const res = await app.request('/background-agents/agent-1/stop', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /:id/logs — agent execution logs ────────────────────────────────

  describe('GET /background-agents/:id/logs - Get agent logs', () => {
    it('should return logs with current state from session', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getSession.mockReturnValue(sampleSession);
      mockService.getHistory.mockResolvedValue({
        entries: [sampleHistoryEntry],
        total: 1,
      });

      const res = await app.request('/background-agents/agent-1/logs');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.agentId).toBe('agent-1');
      expect(data.data.state).toBe('running');
      expect(data.data.cyclesCompleted).toBe(5);
      expect(Array.isArray(data.data.logs)).toBe(true);
      expect(data.data.logs).toHaveLength(1);
    });

    it('should map history entries to log format', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getSession.mockReturnValue(null);
      mockService.getHistory.mockResolvedValue({
        entries: [sampleHistoryEntry],
        total: 1,
      });

      const res = await app.request('/background-agents/agent-1/logs');
      const data = await res.json();
      const log = data.data.logs[0];

      expect(log.timestamp).toBe('2026-01-01T00:00:00.000Z');
      expect(log.success).toBe(true);
      expect(log.durationMs).toBe(500);
      expect(log.toolCalls).toBe(1);
      expect(log.error).toBeNull();
    });

    it('should return stopped state and zero cycles when no session exists', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getSession.mockReturnValue(null);
      mockService.getHistory.mockResolvedValue({ entries: [], total: 0 });

      const res = await app.request('/background-agents/agent-1/logs');
      const data = await res.json();

      expect(data.data.state).toBe('stopped');
      expect(data.data.cyclesCompleted).toBe(0);
    });

    it('should return 404 when agent does not exist', async () => {
      mockService.getAgent.mockResolvedValue(null);

      const res = await app.request('/background-agents/nonexistent/logs');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 500 on service error', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.getHistory.mockRejectedValue(new Error('History fetch failed'));

      const res = await app.request('/background-agents/agent-1/logs');

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/execute — trigger immediate execution ─────────────────────

  describe('POST /background-agents/:id/execute - Execute now', () => {
    it('should trigger execution and return success info', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.executeNow.mockResolvedValue(true);

      const res = await app.request('/background-agents/agent-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'Check prices now' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.executed).toBe(true);
      expect(data.data.agentId).toBe('agent-1');
      expect(data.data.task).toBe('Check prices now');
      expect(data.data.startedAt).toBeDefined();
      expect(mockService.executeNow).toHaveBeenCalledWith('agent-1', 'user-1', 'Check prices now');
    });

    it('should use "default cycle" task label when task is omitted', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.executeNow.mockResolvedValue(true);

      const res = await app.request('/background-agents/agent-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      expect(data.data.task).toBe('default cycle');
      expect(mockService.executeNow).toHaveBeenCalledWith('agent-1', 'user-1', undefined);
    });

    it('should return 404 when agent does not exist', async () => {
      mockService.getAgent.mockResolvedValue(null);

      const res = await app.request('/background-agents/nonexistent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when agent is not running', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.executeNow.mockResolvedValue(false);

      const res = await app.request('/background-agents/agent-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Agent is not running');
    });

    it('should return 500 on service error', async () => {
      mockService.getAgent.mockResolvedValue(sampleConfig);
      mockService.executeNow.mockRejectedValue(new Error('Execution crashed'));

      const res = await app.request('/background-agents/agent-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
    });
  });
});
