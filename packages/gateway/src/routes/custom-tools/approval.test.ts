/**
 * Custom Tools Approval Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    get: vi.fn(async () => null),
    approve: vi.fn(async () => null),
    reject: vi.fn(async () => null),
  },
}));

vi.mock('../../db/repositories/custom-tools.js', () => ({
  createCustomToolsRepo: vi.fn(() => mockRepo),
}));

vi.mock('../agents.js', () => ({
  invalidateAgentCache: vi.fn(),
}));

vi.mock('../../services/custom-tool-registry.js', () => ({
  syncToolToRegistry: vi.fn(),
}));

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

const { approvalRoutes } = await import('./approval.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/custom-tools', approvalRoutes);
  app.onError(errorHandler);
  return app;
}

const pendingTool = {
  id: 'tool-1',
  name: 'my_tool',
  status: 'pending_approval',
  code: 'async function run() {}',
};

const activeTool = {
  id: 'tool-2',
  name: 'active_tool',
  status: 'active',
  code: 'async function run() {}',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tools Approval Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // POST /:id/approve
  // ========================================================================

  describe('POST /custom-tools/:id/approve', () => {
    it('approves a pending tool', async () => {
      const approved = { ...pendingTool, status: 'active' };
      mockRepo.get.mockResolvedValueOnce(pendingTool);
      mockRepo.approve.mockResolvedValueOnce(approved);

      const res = await app.request('/custom-tools/tool-1/approve', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('active');
    });

    it('returns 404 when tool not found', async () => {
      mockRepo.get.mockResolvedValueOnce(null);

      const res = await app.request('/custom-tools/nonexistent/approve', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when tool is not pending_approval', async () => {
      mockRepo.get.mockResolvedValueOnce(activeTool);

      const res = await app.request('/custom-tools/tool-2/approve', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not pending approval');
    });

    it('returns 400 when tool has rejected status', async () => {
      mockRepo.get.mockResolvedValueOnce({ ...pendingTool, status: 'rejected' });

      const res = await app.request('/custom-tools/tool-1/approve', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('still returns 200 when approve returns null (edge case)', async () => {
      mockRepo.get.mockResolvedValueOnce(pendingTool);
      mockRepo.approve.mockResolvedValueOnce(null);

      const res = await app.request('/custom-tools/tool-1/approve', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // POST /:id/reject
  // ========================================================================

  describe('POST /custom-tools/:id/reject', () => {
    it('rejects a pending tool', async () => {
      const rejected = { ...pendingTool, status: 'rejected' };
      mockRepo.get.mockResolvedValueOnce(pendingTool);
      mockRepo.reject.mockResolvedValueOnce(rejected);

      const res = await app.request('/custom-tools/tool-1/reject', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('rejected');
    });

    it('returns 404 when tool not found', async () => {
      mockRepo.get.mockResolvedValueOnce(null);

      const res = await app.request('/custom-tools/nonexistent/reject', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when tool is not pending_approval', async () => {
      mockRepo.get.mockResolvedValueOnce(activeTool);

      const res = await app.request('/custom-tools/tool-2/reject', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not pending approval');
    });

    it('broadcasts data:changed event after reject', async () => {
      const { wsGateway } = await import('../../ws/server.js');
      mockRepo.get.mockResolvedValueOnce(pendingTool);
      mockRepo.reject.mockResolvedValueOnce({ ...pendingTool, status: 'rejected' });

      await app.request('/custom-tools/tool-1/reject', { method: 'POST' });
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ action: 'updated' })
      );
    });
  });
});
