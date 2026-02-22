/**
 * Goals Routes Tests
 *
 * Integration tests for the goals API endpoints.
 * Mocks the GoalService to test route logic, query parsing, and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGoalService = {
  listGoals: vi.fn(async () => []),
  createGoal: vi.fn(),
  getGoalWithSteps: vi.fn(),
  getGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  getNextActions: vi.fn(async () => []),
  getUpcoming: vi.fn(async () => []),
  getStats: vi.fn(async () => ({
    total: 5,
    byStatus: { active: 3, completed: 2 },
    averageProgress: 60,
  })),
  getSteps: vi.fn(async () => []),
  decomposeGoal: vi.fn(),
  updateStep: vi.fn(),
  completeStep: vi.fn(),
  deleteStep: vi.fn(),
};

vi.mock('../services/goal-service.js', () => ({
  getGoalService: () => mockGoalService,
  GoalServiceError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = { goal: mockGoalService };
        return services[token.name];
      }),
    })),
  };
});

// Import after mocks
const { goalsRoutes } = await import('./goals.js');

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
  app.route('/goals', goalsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Goals Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /goals
  // ========================================================================

  describe('GET /goals', () => {
    it('returns goals with default params', async () => {
      mockGoalService.listGoals.mockResolvedValue([
        { id: 'g1', title: 'Learn TypeScript', status: 'active', progress: 50 },
      ]);

      const res = await app.request('/goals');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.goals).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('passes query params to service', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      await app.request('/goals?status=active&limit=5');

      expect(mockGoalService.listGoals).toHaveBeenCalledWith('u1', {
        status: 'active',
        limit: 5,
        parentId: undefined,
        orderBy: 'priority',
      });
    });

    it('handles parentId=null for root goals', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      await app.request('/goals?parentId=null');

      expect(mockGoalService.listGoals).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          parentId: null,
        })
      );
    });
  });

  // ========================================================================
  // POST /goals
  // ========================================================================

  describe('POST /goals', () => {
    it('creates a goal', async () => {
      mockGoalService.createGoal.mockResolvedValue({
        id: 'g1',
        title: 'New Goal',
        status: 'active',
        progress: 0,
      });

      const res = await app.request('/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Goal',
          description: 'Description here',
          priority: 8,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.goal.id).toBe('g1');
      expect(json.data.message).toContain('created');
    });
  });

  // ========================================================================
  // GET /goals/:id
  // ========================================================================

  describe('GET /goals/:id', () => {
    it('returns goal with steps by id', async () => {
      mockGoalService.getGoalWithSteps.mockResolvedValue({
        id: 'g1',
        title: 'Test Goal',
        status: 'active',
        steps: [{ id: 's1', title: 'Step 1' }],
      });

      const res = await app.request('/goals/g1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('g1');
      expect(json.data.steps).toHaveLength(1);
    });

    it('returns 404 when goal not found', async () => {
      mockGoalService.getGoalWithSteps.mockResolvedValue(null);

      const res = await app.request('/goals/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // PATCH /goals/:id
  // ========================================================================

  describe('PATCH /goals/:id', () => {
    it('updates a goal', async () => {
      mockGoalService.updateGoal.mockResolvedValue({
        id: 'g1',
        title: 'Updated Goal',
        progress: 75,
      });

      const res = await app.request('/goals/g1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: 75 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.progress).toBe(75);
    });

    it('returns 404 when goal not found', async () => {
      mockGoalService.updateGoal.mockResolvedValue(null);

      const res = await app.request('/goals/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: 50 }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /goals/:id
  // ========================================================================

  describe('DELETE /goals/:id', () => {
    it('deletes a goal', async () => {
      mockGoalService.deleteGoal.mockResolvedValue(true);

      const res = await app.request('/goals/g1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when goal not found', async () => {
      mockGoalService.deleteGoal.mockResolvedValue(false);

      const res = await app.request('/goals/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /goals/stats
  // ========================================================================

  describe('GET /goals/stats', () => {
    it('returns goal statistics', async () => {
      const res = await app.request('/goals/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(5);
    });
  });

  // ========================================================================
  // GET /goals/next-actions
  // ========================================================================

  describe('GET /goals/next-actions', () => {
    it('returns next actions from active goals', async () => {
      mockGoalService.getNextActions.mockResolvedValue([
        { id: 's1', title: 'Write chapter 2', goalTitle: 'Finish book' },
      ]);

      const res = await app.request('/goals/next-actions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.actions).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });
  });

  // ========================================================================
  // GET /goals/upcoming
  // ========================================================================

  describe('GET /goals/upcoming', () => {
    it('returns goals with upcoming due dates', async () => {
      mockGoalService.getUpcoming.mockResolvedValue([
        { id: 'g1', title: 'Due soon', dueDate: '2026-02-05' },
      ]);

      const res = await app.request('/goals/upcoming?days=7');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.goals).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });
  });

  // ========================================================================
  // GET /goals/:id/steps
  // ========================================================================

  describe('GET /goals/:id/steps', () => {
    it('returns steps for a goal', async () => {
      mockGoalService.getSteps.mockResolvedValue([
        { id: 's1', title: 'Step 1', status: 'completed' },
        { id: 's2', title: 'Step 2', status: 'pending' },
      ]);

      const res = await app.request('/goals/g1/steps');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.steps).toHaveLength(2);
      expect(json.data.count).toBe(2);
    });
  });

  // ========================================================================
  // POST /goals/:id/steps
  // ========================================================================

  describe('POST /goals/:id/steps', () => {
    it('adds steps to a goal via decomposeGoal', async () => {
      mockGoalService.decomposeGoal.mockResolvedValue([
        { id: 's1', title: 'New step', status: 'pending', orderNum: 1 },
      ]);

      const res = await app.request('/goals/g1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New step' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.steps).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('handles batch steps via steps array', async () => {
      mockGoalService.decomposeGoal.mockResolvedValue([
        { id: 's1', title: 'Step A', orderNum: 1 },
        { id: 's2', title: 'Step B', orderNum: 2 },
      ]);

      const res = await app.request('/goals/g1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: [{ title: 'Step A' }, { title: 'Step B' }],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.steps).toHaveLength(2);
    });
  });

  // ========================================================================
  // PATCH /goals/:goalId/steps/:stepId
  // ========================================================================

  describe('PATCH /goals/:goalId/steps/:stepId', () => {
    it('updates a step', async () => {
      mockGoalService.updateStep.mockResolvedValue({
        id: 's1',
        title: 'Updated step',
        status: 'in_progress',
      });

      const res = await app.request('/goals/g1/steps/s1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('in_progress');
    });

    it('returns 404 when step not found', async () => {
      mockGoalService.updateStep.mockResolvedValue(null);

      const res = await app.request('/goals/g1/steps/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /goals/:goalId/steps/:stepId/complete
  // ========================================================================

  describe('POST /goals/:goalId/steps/:stepId/complete', () => {
    it('marks step as completed', async () => {
      mockGoalService.completeStep.mockResolvedValue({
        id: 's1',
        title: 'Done step',
        status: 'completed',
      });

      const res = await app.request('/goals/g1/steps/s1/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'Finished' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.step.status).toBe('completed');
    });

    it('returns 404 when step not found', async () => {
      mockGoalService.completeStep.mockResolvedValue(null);

      const res = await app.request('/goals/g1/steps/nonexistent/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /goals/:goalId/steps/:stepId
  // ========================================================================

  describe('DELETE /goals/:goalId/steps/:stepId', () => {
    it('deletes a step', async () => {
      mockGoalService.deleteStep.mockResolvedValue(true);

      const res = await app.request('/goals/g1/steps/s1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when step not found', async () => {
      mockGoalService.deleteStep.mockResolvedValue(false);

      const res = await app.request('/goals/g1/steps/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });
});
