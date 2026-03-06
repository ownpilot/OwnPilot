/**
 * Heartbeat Log Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    listByAgent: vi.fn(async () => []),
    getStats: vi.fn(async () => ({})),
  },
}));

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: vi.fn(() => mockRepo),
}));

const { heartbeatLogRoutes } = await import('./heartbeat-logs.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/heartbeat-logs', heartbeatLogRoutes);
  app.onError(errorHandler);
  return app;
}

const sampleLog = {
  id: 'log-1',
  agentId: 'agent-1',
  status: 'ok',
  createdAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Heartbeat Log Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.list.mockResolvedValue([sampleLog]);
    mockRepo.count.mockResolvedValue(1);
    mockRepo.listByAgent.mockResolvedValue([sampleLog]);
    mockRepo.getStats.mockResolvedValue({ total: 10, ok: 8, error: 2 });
    app = createApp();
  });

  // ========================================================================
  // GET /
  // ========================================================================

  describe('GET /heartbeat-logs', () => {
    it('returns paginated list of logs', async () => {
      const res = await app.request('/heartbeat-logs');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.items).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('passes limit and offset to repo', async () => {
      await app.request('/heartbeat-logs?limit=5&offset=10');
      expect(mockRepo.list).toHaveBeenCalledWith(5, 10);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.list.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/heartbeat-logs');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /agent/:id
  // ========================================================================

  describe('GET /heartbeat-logs/agent/:id', () => {
    it('returns logs for specific agent', async () => {
      const res = await app.request('/heartbeat-logs/agent/agent-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(mockRepo.listByAgent).toHaveBeenCalledWith(
        'agent-1',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('passes pagination params to listByAgent', async () => {
      await app.request('/heartbeat-logs/agent/agent-1?limit=20&offset=0');
      expect(mockRepo.listByAgent).toHaveBeenCalledWith('agent-1', 20, 0);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.listByAgent.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/heartbeat-logs/agent/agent-1');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /stats
  // ========================================================================

  describe('GET /heartbeat-logs/stats', () => {
    it('returns stats without agentId filter', async () => {
      const res = await app.request('/heartbeat-logs/stats');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(10);
      expect(mockRepo.getStats).toHaveBeenCalledWith(undefined);
    });

    it('passes agentId to getStats when provided', async () => {
      await app.request('/heartbeat-logs/stats?agentId=agent-42');
      expect(mockRepo.getStats).toHaveBeenCalledWith('agent-42');
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.getStats.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/heartbeat-logs/stats');
      expect(res.status).toBe(500);
    });
  });
});
