/**
 * Plans Routes Tests
 *
 * Integration tests for the plans API endpoints.
 * Mocks PlanService and PlanExecutor to test route logic and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPlanService = {
  listPlans: vi.fn(async () => []),
  countPlans: vi.fn(async () => 0),
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  getStats: vi.fn(async () => ({ total: 5, active: 2, completed: 3 })),
  getActive: vi.fn(async () => []),
  getPending: vi.fn(async () => []),
  getSteps: vi.fn(async () => []),
  getStep: vi.fn(),
  addStep: vi.fn(),
  updateStep: vi.fn(),
  getHistory: vi.fn(async () => []),
  recalculateProgress: vi.fn(),
  logEvent: vi.fn(),
};

const mockPlanExecutor = {
  execute: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  abort: vi.fn(),
  checkpoint: vi.fn(),
  restoreFromCheckpoint: vi.fn(),
  getRunningPlans: vi.fn(() => []),
};

vi.mock('../services/plan-service.js', () => ({
  getPlanService: () => mockPlanService,
}));

vi.mock('../plans/index.js', () => ({
  getPlanExecutor: () => mockPlanExecutor,
}));

vi.mock('../middleware/validation.js', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = { plan: mockPlanService };
        return services[token.name];
      }),
    })),
  };
});

// Import after mocks
const { plansRoutes } = await import('./plans.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  // Simulate authenticated user
  app.use('*', async (c, next) => {
    c.set('userId', 'u1');
    await next();
  });
  app.route('/plans', plansRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plans Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /plans
  // ========================================================================

  describe('GET /plans', () => {
    it('returns plans list with total count', async () => {
      mockPlanService.countPlans.mockResolvedValue(3);
      mockPlanService.listPlans.mockResolvedValue([
        { id: 'p1', name: 'Deploy App', status: 'pending' },
      ]);

      const res = await app.request('/plans');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.plans).toHaveLength(1);
      expect(json.data.total).toBe(3);
      expect(json.data.hasMore).toBe(false);
    });

    it('passes query params to service', async () => {
      mockPlanService.countPlans.mockResolvedValue(0);
      mockPlanService.listPlans.mockResolvedValue([]);

      await app.request('/plans?status=running&goalId=g1&limit=5&offset=10');

      expect(mockPlanService.countPlans).toHaveBeenCalledWith('u1', {
        status: 'running',
        goalId: 'g1',
        triggerId: undefined,
      });
      expect(mockPlanService.listPlans).toHaveBeenCalledWith('u1', {
        status: 'running',
        goalId: 'g1',
        triggerId: undefined,
        limit: 5,
        offset: 10,
      });
    });
  });

  // ========================================================================
  // POST /plans
  // ========================================================================

  describe('POST /plans', () => {
    it('creates a plan', async () => {
      mockPlanService.createPlan.mockResolvedValue({
        id: 'p1',
        name: 'Deploy App',
        goal: 'Deploy to production',
        status: 'pending',
      });

      const res = await app.request('/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Deploy App',
          goal: 'Deploy to production',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.plan.id).toBe('p1');
    });

    it('returns 400 when name or goal is missing', async () => {
      const res = await app.request('/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Goal' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Validation failed');
    });
  });

  // ========================================================================
  // GET /plans/stats
  // ========================================================================

  describe('GET /plans/stats', () => {
    it('returns plan statistics', async () => {
      const res = await app.request('/plans/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(5);
    });
  });

  // ========================================================================
  // GET /plans/active & /plans/pending
  // ========================================================================

  describe('GET /plans/active', () => {
    it('returns active plans', async () => {
      mockPlanService.getActive.mockResolvedValue([{ id: 'p1', status: 'running' }]);

      const res = await app.request('/plans/active');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.plans).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });
  });

  describe('GET /plans/pending', () => {
    it('returns pending plans', async () => {
      mockPlanService.getPending.mockResolvedValue([{ id: 'p1', status: 'pending' }]);

      const res = await app.request('/plans/pending');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.plans).toHaveLength(1);
    });
  });

  // ========================================================================
  // GET /plans/:id
  // ========================================================================

  describe('GET /plans/:id', () => {
    it('returns plan with steps and history', async () => {
      mockPlanService.getPlan.mockResolvedValue({
        id: 'p1',
        name: 'Deploy',
        status: 'running',
      });
      mockPlanService.getSteps.mockResolvedValue([
        { id: 'st1', name: 'Step 1', status: 'completed' },
      ]);
      mockPlanService.getHistory.mockResolvedValue([{ id: 'h1', event: 'started' }]);

      const res = await app.request('/plans/p1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('p1');
      expect(json.data.steps).toHaveLength(1);
      expect(json.data.recentHistory).toHaveLength(1);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /plans/:id
  // ========================================================================

  describe('PATCH /plans/:id', () => {
    it('updates a plan', async () => {
      mockPlanService.updatePlan.mockResolvedValue({
        id: 'p1',
        name: 'Updated Plan',
      });

      const res = await app.request('/plans/p1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Plan' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('Updated Plan');
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.updatePlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /plans/:id
  // ========================================================================

  describe('DELETE /plans/:id', () => {
    it('deletes a plan', async () => {
      mockPlanService.deletePlan.mockResolvedValue(true);

      const res = await app.request('/plans/p1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.deletePlan.mockResolvedValue(false);

      const res = await app.request('/plans/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plans/:id/execute
  // ========================================================================

  describe('POST /plans/:id/execute', () => {
    it('executes a plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'pending' });
      mockPlanExecutor.execute.mockResolvedValue({ status: 'completed' });

      const res = await app.request('/plans/p1/execute', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/execute', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 400 when plan already running', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'running' });

      const res = await app.request('/plans/p1/execute', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('ALREADY_RUNNING');
    });

    it('returns 500 when execution fails', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'pending' });
      mockPlanExecutor.execute.mockResolvedValue({ status: 'failed', error: 'Step failed' });

      const res = await app.request('/plans/p1/execute', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /plans/:id/pause
  // ========================================================================

  describe('POST /plans/:id/pause', () => {
    it('pauses a running plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'running' });
      mockPlanExecutor.pause.mockResolvedValue(true);

      const res = await app.request('/plans/p1/pause', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.paused).toBe(true);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/pause', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plans/:id/resume
  // ========================================================================

  describe('POST /plans/:id/resume', () => {
    it('resumes a paused plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'paused' });
      mockPlanExecutor.resume.mockResolvedValue({ status: 'completed' });

      const res = await app.request('/plans/p1/resume', { method: 'POST' });

      expect(res.status).toBe(200);
    });

    it('returns 400 when plan is not paused', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'running' });

      const res = await app.request('/plans/p1/resume', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_PAUSED');
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/resume', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plans/:id/abort
  // ========================================================================

  describe('POST /plans/:id/abort', () => {
    it('aborts a running plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'running' });
      mockPlanExecutor.abort.mockResolvedValue(true);

      const res = await app.request('/plans/p1/abort', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.aborted).toBe(true);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/abort', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plans/:id/checkpoint
  // ========================================================================

  describe('POST /plans/:id/checkpoint', () => {
    it('creates a checkpoint', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'running' });

      const res = await app.request('/plans/p1/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { step: 3 } }),
      });

      expect(res.status).toBe(200);
      expect(mockPlanExecutor.checkpoint).toHaveBeenCalledWith('p1', { step: 3 });
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plans/:id/rollback
  // ========================================================================

  describe('POST /plans/:id/rollback', () => {
    it('rolls back to last checkpoint', async () => {
      mockPlanService.getPlan.mockResolvedValue({
        id: 'p1',
        status: 'failed',
        checkpoint: { step: 2 },
      });
      mockPlanExecutor.restoreFromCheckpoint.mockResolvedValue({ step: 2 });
      mockPlanService.getSteps.mockResolvedValue([
        { id: 'st1', status: 'completed' },
        { id: 'st2', status: 'failed' },
      ]);
      mockPlanService.updateStep.mockResolvedValue({});
      mockPlanService.updatePlan.mockResolvedValue({});
      mockPlanService.recalculateProgress.mockResolvedValue(undefined);
      mockPlanService.logEvent.mockResolvedValue(undefined);

      const res = await app.request('/plans/p1/rollback', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.checkpoint).toEqual({ step: 2 });
    });

    it('returns 400 when no checkpoint exists', async () => {
      mockPlanService.getPlan.mockResolvedValue({
        id: 'p1',
        status: 'failed',
        checkpoint: null,
      });

      const res = await app.request('/plans/p1/rollback', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('NO_CHECKPOINT');
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/rollback', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /plans/:id/steps
  // ========================================================================

  describe('GET /plans/:id/steps', () => {
    it('returns steps for a plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1' });
      mockPlanService.getSteps.mockResolvedValue([
        { id: 'st1', name: 'Step 1', status: 'completed' },
        { id: 'st2', name: 'Step 2', status: 'pending' },
      ]);

      const res = await app.request('/plans/p1/steps');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.planId).toBe('p1');
      expect(json.data.steps).toHaveLength(2);
      expect(json.data.count).toBe(2);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/steps');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plans/:id/steps
  // ========================================================================

  describe('POST /plans/:id/steps', () => {
    it('adds a step to a plan', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 'st1',
        type: 'tool_call',
        name: 'Check Status',
        orderNum: 1,
      });

      const res = await app.request('/plans/p1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool_call',
          name: 'Check Status',
          orderNum: 1,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.step.id).toBe('st1');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.request('/plans/p1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Type' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /plans/:id/steps/:stepId
  // ========================================================================

  describe('GET /plans/:id/steps/:stepId', () => {
    it('returns step by id', async () => {
      mockPlanService.getStep.mockResolvedValue({
        id: 'st1',
        name: 'Step 1',
        status: 'completed',
      });

      const res = await app.request('/plans/p1/steps/st1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('st1');
    });

    it('returns 404 when step not found', async () => {
      mockPlanService.getStep.mockResolvedValue(null);

      const res = await app.request('/plans/p1/steps/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /plans/:id/steps/:stepId
  // ========================================================================

  describe('PATCH /plans/:id/steps/:stepId', () => {
    it('updates a step', async () => {
      mockPlanService.updateStep.mockResolvedValue({
        id: 'st1',
        status: 'completed',
      });

      const res = await app.request('/plans/p1/steps/st1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('completed');
    });

    it('returns 404 when step not found', async () => {
      mockPlanService.updateStep.mockResolvedValue(null);

      const res = await app.request('/plans/p1/steps/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /plans/:id/history
  // ========================================================================

  describe('GET /plans/:id/history', () => {
    it('returns plan history', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1' });
      mockPlanService.getHistory.mockResolvedValue([{ id: 'h1', event: 'started' }]);

      const res = await app.request('/plans/p1/history');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.planId).toBe('p1');
      expect(json.data.history).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('returns 404 when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const res = await app.request('/plans/nonexistent/history');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /plans/executor/status
  // ========================================================================

  describe('GET /plans/executor/status', () => {
    it('returns executor status', async () => {
      mockPlanExecutor.getRunningPlans.mockReturnValue(['p1', 'p2']);

      const res = await app.request('/plans/executor/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.runningPlans).toEqual(['p1', 'p2']);
    });
  });
});
