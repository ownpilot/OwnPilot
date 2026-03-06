/**
 * Orchestra Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockEngine, mockRepo } = vi.hoisted(() => ({
  mockEngine: {
    listByParent: vi.fn(() => []),
    getExecution: vi.fn(() => null),
    cancel: vi.fn(),
  },
  mockRepo: {
    getHistory: vi.fn(async () => ({ executions: [], total: 0 })),
    getById: vi.fn(async () => null),
  },
}));

vi.mock('../services/orchestra-engine.js', () => ({
  getOrchestraEngine: vi.fn(() => mockEngine),
}));

vi.mock('../db/repositories/orchestra.js', () => ({
  OrchestraRepository: vi.fn(function () {
    return mockRepo;
  }),
}));

const { orchestraRoutes } = await import('./orchestra.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/orchestra', orchestraRoutes);
  app.onError(errorHandler);
  return app;
}

const sampleExecution = {
  id: 'exec-1',
  parentId: 'conv-1',
  status: 'completed',
  plan: { steps: [] },
  createdAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestra Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine.listByParent.mockReturnValue([sampleExecution]);
    mockEngine.getExecution.mockReturnValue(null);
    mockRepo.getHistory.mockResolvedValue({ executions: [sampleExecution], total: 1 });
    mockRepo.getById.mockResolvedValue(sampleExecution);
    app = createApp();
  });

  // ========================================================================
  // GET /orchestra
  // ========================================================================

  describe('GET /orchestra', () => {
    it('returns executions for parentId', async () => {
      const res = await app.request('/orchestra?parentId=conv-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(mockEngine.listByParent).toHaveBeenCalledWith('conv-1');
    });

    it('returns 400 when parentId is missing', async () => {
      const res = await app.request('/orchestra');
      expect(res.status).toBe(400);
    });

    it('returns 500 when engine throws', async () => {
      mockEngine.listByParent.mockImplementation(() => {
        throw new Error('Engine error');
      });
      const res = await app.request('/orchestra?parentId=conv-1');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /orchestra/history
  // ========================================================================

  describe('GET /orchestra/history', () => {
    it('returns execution history for user', async () => {
      const res = await app.request('/orchestra/history');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(1);
      expect(json.data.executions).toHaveLength(1);
    });

    it('passes limit and offset to repo', async () => {
      await app.request('/orchestra/history?limit=10&offset=5');
      expect(mockRepo.getHistory).toHaveBeenCalledWith('user-1', 10, 5);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.getHistory.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/orchestra/history');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /orchestra/:id
  // ========================================================================

  describe('GET /orchestra/:id', () => {
    it('returns live execution from engine when available', async () => {
      mockEngine.getExecution.mockReturnValue(sampleExecution);
      const res = await app.request('/orchestra/exec-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('exec-1');
      expect(mockRepo.getById).not.toHaveBeenCalled();
    });

    it('falls back to DB when execution not in engine', async () => {
      mockEngine.getExecution.mockReturnValue(null);
      mockRepo.getById.mockResolvedValue(sampleExecution);
      const res = await app.request('/orchestra/exec-1');
      expect(res.status).toBe(200);
      expect(mockRepo.getById).toHaveBeenCalledWith('exec-1');
    });

    it('returns 404 when execution not found in engine or DB', async () => {
      mockEngine.getExecution.mockReturnValue(null);
      mockRepo.getById.mockResolvedValue(null);
      const res = await app.request('/orchestra/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockEngine.getExecution.mockReturnValue(null);
      mockRepo.getById.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/orchestra/exec-1');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // DELETE /orchestra/:id
  // ========================================================================

  describe('DELETE /orchestra/:id', () => {
    it('cancels a running execution and returns cancelled: true', async () => {
      mockEngine.getExecution.mockReturnValue({ ...sampleExecution, state: 'running' });

      const res = await app.request('/orchestra/exec-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.cancelled).toBe(true);
      expect(mockEngine.cancel).toHaveBeenCalledWith('exec-1');
    });

    it('returns 404 when execution not found in engine', async () => {
      mockEngine.getExecution.mockReturnValue(null);

      const res = await app.request('/orchestra/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when execution is not in running state', async () => {
      mockEngine.getExecution.mockReturnValue({ ...sampleExecution, state: 'completed' });

      const res = await app.request('/orchestra/exec-1', { method: 'DELETE' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('not running');
    });

    it('returns 500 when engine.cancel throws', async () => {
      mockEngine.getExecution.mockReturnValue({ ...sampleExecution, state: 'running' });
      mockEngine.cancel.mockImplementation(() => {
        throw new Error('Cancel failed');
      });

      const res = await app.request('/orchestra/exec-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
