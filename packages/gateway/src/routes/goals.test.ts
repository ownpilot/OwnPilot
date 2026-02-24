/**
 * Goals Routes Tests
 *
 * Integration tests for the goals API endpoints.
 * Mocks the GoalService to test route logic, query parsing, and response formatting.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createMockServiceRegistry } from '../test-helpers.js';

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
    getServiceRegistry: vi.fn(() => createMockServiceRegistry({ goal: mockGoalService })),
  };
});

vi.mock('../ws/server.js', () => ({
  wsGateway: {
    broadcast: vi.fn(),
  },
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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

  // ========================================================================
  // POST /goals - Validation Error
  // ========================================================================

  describe('POST /goals - GoalServiceError', () => {
    it('returns 400 for GoalServiceError with VALIDATION_ERROR code', async () => {
      const { GoalServiceError } = await import('../services/goal-service.js');
      mockGoalService.createGoal.mockRejectedValue(
        new GoalServiceError('Title too short', 'VALIDATION_ERROR')
      );

      const res = await app.request('/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'X', priority: 5 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Title too short');
    });

    it('re-throws non-GoalServiceError exceptions', async () => {
      mockGoalService.createGoal.mockRejectedValue(new Error('DB connection failed'));

      const res = await app.request('/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Some Goal', priority: 5 }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /goals/:id/steps - GoalServiceError
  // ========================================================================

  describe('POST /goals/:id/steps - GoalServiceError', () => {
    it('returns 404 for GoalServiceError with NOT_FOUND code', async () => {
      const { GoalServiceError } = await import('../services/goal-service.js');
      mockGoalService.decomposeGoal.mockRejectedValue(
        new GoalServiceError('Goal not found', 'NOT_FOUND')
      );

      const res = await app.request('/goals/g1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'A step' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Goal not found');
    });

    it('returns 400 for GoalServiceError with non-NOT_FOUND code', async () => {
      const { GoalServiceError } = await import('../services/goal-service.js');
      mockGoalService.decomposeGoal.mockRejectedValue(
        new GoalServiceError('Invalid step data', 'VALIDATION_ERROR')
      );

      const res = await app.request('/goals/g1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'A step' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('re-throws non-GoalServiceError in steps creation', async () => {
      mockGoalService.decomposeGoal.mockRejectedValue(new Error('Unexpected'));

      const res = await app.request('/goals/g1/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'A step' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /goals - invalid status ignored
  // ========================================================================

  describe('GET /goals - invalid query params', () => {
    it('ignores invalid status and passes undefined', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      await app.request('/goals?status=invalid_status');

      expect(mockGoalService.listGoals).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          status: undefined,
        })
      );
    });

    it('passes a specific parentId value when provided', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      await app.request('/goals?parentId=parent-123');

      expect(mockGoalService.listGoals).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          parentId: 'parent-123',
        })
      );
    });
  });

  // ========================================================================
  // GET /goals/next-actions - limit param
  // ========================================================================

  describe('GET /goals/next-actions - custom limit', () => {
    it('passes custom limit param', async () => {
      mockGoalService.getNextActions.mockResolvedValue([]);

      await app.request('/goals/next-actions?limit=10');

      expect(mockGoalService.getNextActions).toHaveBeenCalledWith('u1', 10);
    });

    it('returns empty actions list', async () => {
      mockGoalService.getNextActions.mockResolvedValue([]);

      const res = await app.request('/goals/next-actions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.actions).toEqual([]);
      expect(json.data.count).toBe(0);
    });
  });

  // ========================================================================
  // GET /goals/upcoming - default days
  // ========================================================================

  describe('GET /goals/upcoming - default days', () => {
    it('uses default days=7 when not specified', async () => {
      mockGoalService.getUpcoming.mockResolvedValue([]);

      await app.request('/goals/upcoming');

      expect(mockGoalService.getUpcoming).toHaveBeenCalledWith('u1', 7);
    });
  });
});

// ============================================================================
// executeGoalTool Tests
// ============================================================================

describe('executeGoalTool', () => {
  let executeGoalTool: (toolName: string, args: Record<string, unknown>, userId: string) => Promise<{ success: boolean; result?: unknown; error?: string }>;

  beforeAll(async () => {
    const mod = await import('./goals.js');
    executeGoalTool = mod.executeGoalTool;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── create_goal ──────────────────────────────────────────────

  describe('create_goal', () => {
    it('creates a goal and returns success', async () => {
      mockGoalService.createGoal.mockResolvedValue({
        id: 'g1',
        title: 'Learn Rust',
        priority: 8,
        dueDate: '2026-06-01',
      });

      const result = await executeGoalTool('create_goal', {
        title: 'Learn Rust',
        description: 'Systems programming',
        priority: 8,
        dueDate: '2026-06-01',
      }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Learn Rust');
      expect(result.result.goal.id).toBe('g1');
    });

    it('passes parentId to service', async () => {
      mockGoalService.createGoal.mockResolvedValue({
        id: 'g2',
        title: 'Sub-goal',
        priority: 5,
        dueDate: null,
      });

      await executeGoalTool('create_goal', {
        title: 'Sub-goal',
        parentId: 'g1',
      }, 'u1');

      expect(mockGoalService.createGoal).toHaveBeenCalledWith('u1', expect.objectContaining({
        parentId: 'g1',
      }));
    });
  });

  // ─── list_goals ──────────────────────────────────────────────

  describe('list_goals', () => {
    it('returns empty list message when no goals', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      const result = await executeGoalTool('list_goals', {}, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('No active goals found');
      expect(result.result.goals).toEqual([]);
    });

    it('returns goals with mapped fields', async () => {
      mockGoalService.listGoals.mockResolvedValue([
        { id: 'g1', title: 'Goal A', status: 'active', priority: 8, progress: 50, dueDate: '2026-06-01' },
        { id: 'g2', title: 'Goal B', status: 'active', priority: 5, progress: 0, dueDate: null },
      ]);

      const result = await executeGoalTool('list_goals', { status: 'active', limit: 5 }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.goals).toHaveLength(2);
      expect(result.result.goals[0].id).toBe('g1');
      expect(result.result.message).toContain('Found 2');
    });

    it('uses default status "active" and limit 10', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      await executeGoalTool('list_goals', {}, 'u1');

      expect(mockGoalService.listGoals).toHaveBeenCalledWith('u1', {
        status: 'active',
        limit: 10,
        orderBy: 'priority',
      });
    });
  });

  // ─── update_goal ──────────────────────────────────────────────

  describe('update_goal', () => {
    it('returns error when goalId missing', async () => {
      const result = await executeGoalTool('update_goal', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('goalId is required');
    });

    it('returns error when goal not found', async () => {
      mockGoalService.updateGoal.mockResolvedValue(null);

      const result = await executeGoalTool('update_goal', { goalId: 'g999' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Goal not found');
    });

    it('updates goal and returns success', async () => {
      mockGoalService.updateGoal.mockResolvedValue({
        id: 'g1',
        title: 'Updated',
        status: 'completed',
        progress: 100,
      });

      const result = await executeGoalTool('update_goal', {
        goalId: 'g1',
        status: 'completed',
        progress: 100,
      }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Updated');
      expect(result.result.goal.status).toBe('completed');
    });
  });

  // ─── decompose_goal ──────────────────────────────────────────

  describe('decompose_goal', () => {
    it('returns error when goalId missing', async () => {
      const result = await executeGoalTool('decompose_goal', {
        steps: [{ title: 'Step 1' }],
      }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('goalId is required');
    });

    it('returns error when steps missing', async () => {
      const result = await executeGoalTool('decompose_goal', { goalId: 'g1' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('steps array is required');
    });

    it('returns error when steps is empty array', async () => {
      const result = await executeGoalTool('decompose_goal', {
        goalId: 'g1',
        steps: [],
      }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('steps array is required');
    });

    it('decomposes goal into steps', async () => {
      mockGoalService.decomposeGoal.mockResolvedValue([
        { id: 's1', title: 'Step 1', orderNum: 1 },
        { id: 's2', title: 'Step 2', orderNum: 2 },
      ]);
      mockGoalService.getGoal.mockResolvedValue({ title: 'My Goal' });

      const result = await executeGoalTool('decompose_goal', {
        goalId: 'g1',
        steps: [{ title: 'Step 1' }, { title: 'Step 2' }],
      }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.steps).toHaveLength(2);
      expect(result.result.message).toContain('My Goal');
    });

    it('uses goalId in message when goal title not found', async () => {
      mockGoalService.decomposeGoal.mockResolvedValue([
        { id: 's1', title: 'Step 1', orderNum: 1 },
      ]);
      mockGoalService.getGoal.mockResolvedValue(null);

      const result = await executeGoalTool('decompose_goal', {
        goalId: 'g1',
        steps: [{ title: 'Step 1' }],
      }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('g1');
    });
  });

  // ─── get_next_actions ──────────────────────────────────────────

  describe('get_next_actions', () => {
    it('returns empty actions message', async () => {
      mockGoalService.getNextActions.mockResolvedValue([]);

      const result = await executeGoalTool('get_next_actions', {}, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('All caught up');
      expect(result.result.actions).toEqual([]);
    });

    it('returns actionable steps', async () => {
      mockGoalService.getNextActions.mockResolvedValue([
        { id: 's1', title: 'Write tests', goalTitle: 'Ship v1', status: 'pending' },
      ]);

      const result = await executeGoalTool('get_next_actions', { limit: 3 }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.actions).toHaveLength(1);
      expect(result.result.actions[0].stepTitle).toBe('Write tests');
      expect(result.result.actions[0].goalTitle).toBe('Ship v1');
    });
  });

  // ─── complete_step ──────────────────────────────────────────

  describe('complete_step', () => {
    it('returns error when stepId missing', async () => {
      const result = await executeGoalTool('complete_step', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('stepId is required');
    });

    it('returns error when step not found', async () => {
      mockGoalService.completeStep.mockResolvedValue(null);

      const result = await executeGoalTool('complete_step', { stepId: 's999' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Step not found');
    });

    it('completes step successfully', async () => {
      mockGoalService.completeStep.mockResolvedValue({
        id: 's1',
        title: 'Done step',
        status: 'completed',
      });

      const result = await executeGoalTool('complete_step', {
        stepId: 's1',
        result: 'All tests passed',
      }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.step.status).toBe('completed');
      expect(result.result.message).toContain('Done step');
    });
  });

  // ─── get_goal_details ──────────────────────────────────────────

  describe('get_goal_details', () => {
    it('returns error when goalId missing', async () => {
      const result = await executeGoalTool('get_goal_details', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('goalId is required');
    });

    it('returns error when goal not found', async () => {
      mockGoalService.getGoalWithSteps.mockResolvedValue(null);

      const result = await executeGoalTool('get_goal_details', { goalId: 'g999' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Goal not found');
    });

    it('returns goal details with steps', async () => {
      mockGoalService.getGoalWithSteps.mockResolvedValue({
        id: 'g1',
        title: 'Build app',
        description: 'A great app',
        status: 'active',
        priority: 8,
        progress: 33,
        dueDate: '2026-06-01',
        createdAt: '2026-01-01',
        steps: [
          { id: 's1', title: 'Design', status: 'completed', orderNum: 1 },
          { id: 's2', title: 'Implement', status: 'pending', orderNum: 2 },
          { id: 's3', title: 'Test', status: 'pending', orderNum: 3 },
        ],
      });

      const result = await executeGoalTool('get_goal_details', { goalId: 'g1' }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.goal.id).toBe('g1');
      expect(result.result.steps).toHaveLength(3);
      expect(result.result.stepCount).toBe(3);
      expect(result.result.completedSteps).toBe(1);
    });
  });

  // ─── get_goal_stats ──────────────────────────────────────────

  describe('get_goal_stats', () => {
    it('returns goal statistics', async () => {
      mockGoalService.getStats.mockResolvedValue({
        total: 10,
        byStatus: { active: 7, completed: 3 },
      });

      const result = await executeGoalTool('get_goal_stats', {}, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('10 goals total');
      expect(result.result.message).toContain('7 active');
      expect(result.result.stats.total).toBe(10);
    });
  });

  // ─── unknown tool ──────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns error for unknown tool', async () => {
      const result = await executeGoalTool('nonexistent_tool', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  // ─── default userId ──────────────────────────────────────────

  describe('default userId', () => {
    it('uses "default" userId when not provided', async () => {
      mockGoalService.listGoals.mockResolvedValue([]);

      await executeGoalTool('list_goals', {});

      expect(mockGoalService.listGoals).toHaveBeenCalledWith('default', expect.anything());
    });
  });

  // ─── error handling ──────────────────────────────────────────

  describe('error handling', () => {
    it('catches GoalServiceError and returns error message', async () => {
      const { GoalServiceError } = await import('../services/goal-service.js');
      mockGoalService.createGoal.mockRejectedValue(
        new GoalServiceError('Duplicate goal', 'VALIDATION_ERROR')
      );

      const result = await executeGoalTool('create_goal', { title: 'Dup' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Duplicate goal');
    });

    it('catches generic errors and returns error message', async () => {
      mockGoalService.createGoal.mockRejectedValue(new Error('Network timeout'));

      const result = await executeGoalTool('create_goal', { title: 'Goal' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });
  });
});
