/**
 * Goals Routes
 *
 * API for managing goals and goal steps.
 * Also provides tool executors for AI to manage goals.
 *
 * All business logic is delegated to GoalService.
 */

import { Hono } from 'hono';
import type {
  GoalStatus,
  StepStatus,
  CreateGoalInput,
  UpdateGoalInput,
  CreateStepInput,
} from '../db/repositories/goals.js';
import { GoalServiceError } from '../services/goal-service.js';
import { getServiceRegistry, Services } from '@ownpilot/core';
import {
  getUserId,
  apiResponse,
  apiError,
  getIntParam,
  ERROR_CODES,
  sanitizeId,
  notFoundError,
  getErrorMessage,
  validateQueryEnum,
} from './helpers.js';
import { MAX_DAYS_LOOKBACK } from '../config/defaults.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';
import { createCrudRoutes } from './crud-factory.js';

const log = getLog('Goals');

export const goalsRoutes = new Hono();

// ============================================================================
// Goal Routes
// ============================================================================

/**
 * GET /goals - List goals
 */
goalsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const status = validateQueryEnum(c.req.query('status'), [
    'active',
    'paused',
    'completed',
    'abandoned',
  ] as const);
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const parentId = c.req.query('parentId');

  const service = getServiceRegistry().get(Services.Goal);
  const goals = await service.listGoals(userId, {
    status,
    limit,
    parentId: parentId === 'null' ? null : parentId,
    orderBy: 'priority',
  });

  return apiResponse(c, {
    goals,
    total: goals.length,
  });
});

/**
 * POST /goals - Create a new goal
 */
goalsRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createGoalSchema } = await import('../middleware/validation.js');
  const body = validateBody(createGoalSchema, rawBody) as unknown as CreateGoalInput;

  try {
    const service = getServiceRegistry().get(Services.Goal);
    const goal = await service.createGoal(userId, body);

    log.info('Goal created', {
      userId,
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
    });
    wsGateway.broadcast('data:changed', { entity: 'goal', action: 'created', id: goal.id });
    return apiResponse(
      c,
      {
        goal,
        message: 'Goal created successfully.',
      },
      201
    );
  } catch (err) {
    if (err instanceof GoalServiceError && err.code === 'VALIDATION_ERROR') {
      log.warn('Goal validation error', { userId, error: err.message });
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: err.message }, 400);
    }
    log.error('Goal creation error', { userId, error: getErrorMessage(err) });
    throw err;
  }
});

/**
 * GET /goals/stats - Get goal statistics
 */
goalsRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const service = getServiceRegistry().get(Services.Goal);
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /goals/next-actions - Get next actionable steps
 */
goalsRoutes.get('/next-actions', async (c) => {
  const userId = getUserId(c);
  const limit = getIntParam(c, 'limit', 5, 1, 20);

  const service = getServiceRegistry().get(Services.Goal);
  const actions = await service.getNextActions(userId, limit);

  return apiResponse(c, {
    actions,
    count: actions.length,
  });
});

/**
 * GET /goals/upcoming - Get goals with upcoming due dates
 */
goalsRoutes.get('/upcoming', async (c) => {
  const userId = getUserId(c);
  const days = getIntParam(c, 'days', 7, 1, MAX_DAYS_LOOKBACK);

  const service = getServiceRegistry().get(Services.Goal);
  const goals = await service.getUpcoming(userId, days);

  return apiResponse(c, {
    goals,
    count: goals.length,
  });
});

/**
 * GET /goals/:id - Get a specific goal with steps
 */
goalsRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Goal);
  const goalWithSteps = await service.getGoalWithSteps(userId, id);

  if (!goalWithSteps) {
    return notFoundError(c, 'Goal', id);
  }

  return apiResponse(c, goalWithSteps);
});

/**
 * PATCH /goals/:id - Update a goal
 */
goalsRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updateGoalSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateGoalSchema, rawBody) as unknown as UpdateGoalInput;

  const service = getServiceRegistry().get(Services.Goal);
  const updated = await service.updateGoal(userId, id, body);

  if (!updated) {
    return notFoundError(c, 'Goal', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'goal', action: 'updated', id });
  return apiResponse(c, updated);
});

// Factory-generated DELETE /:id route
const goalCrudRoutes = createCrudRoutes({
  entity: 'goal',
  serviceToken: Services.Goal,
  methods: ['delete'],
  serviceMethods: { delete: 'deleteGoal' },
});
goalsRoutes.route('/', goalCrudRoutes);

// ============================================================================
// Step Routes
// ============================================================================

/**
 * POST /goals/:id/steps - Add steps to a goal
 */
goalsRoutes.post('/:id/steps', async (c) => {
  const userId = getUserId(c);
  const goalId = c.req.param('id');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createGoalStepsSchema } = await import('../middleware/validation.js');
  const body = validateBody(createGoalStepsSchema, rawBody) as
    | { steps: CreateStepInput[] }
    | CreateStepInput;

  try {
    const service = getServiceRegistry().get(Services.Goal);

    // Handle single step or array of steps
    const stepsToAdd = 'steps' in body ? body.steps : [body];
    const validSteps = stepsToAdd.filter((s) => s.title);

    // Use decomposeGoal which validates goal exists and recalculates progress
    const createdSteps = await service.decomposeGoal(userId, goalId, validSteps);

    wsGateway.broadcast('data:changed', { entity: 'goal', action: 'updated', id: goalId });
    return apiResponse(
      c,
      {
        steps: createdSteps,
        count: createdSteps.length,
        message: `Added ${createdSteps.length} step(s) to goal.`,
      },
      201
    );
  } catch (err) {
    if (err instanceof GoalServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return apiError(c, { code: err.code, message: err.message }, status);
    }
    throw err;
  }
});

/**
 * GET /goals/:id/steps - Get all steps for a goal
 */
goalsRoutes.get('/:id/steps', async (c) => {
  const userId = getUserId(c);
  const goalId = c.req.param('id');

  const service = getServiceRegistry().get(Services.Goal);
  const steps = await service.getSteps(userId, goalId);

  return apiResponse(c, {
    steps,
    count: steps.length,
  });
});

/**
 * PATCH /goals/:goalId/steps/:stepId - Update a step
 * Progress is recalculated automatically when status changes.
 */
goalsRoutes.patch('/:goalId/steps/:stepId', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updateGoalStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateGoalStepSchema, rawBody) as {
    title?: string;
    description?: string;
    status?: StepStatus;
    result?: string;
  };

  const service = getServiceRegistry().get(Services.Goal);
  const updated = await service.updateStep(userId, stepId, body);

  if (!updated) {
    return notFoundError(c, 'Step', stepId);
  }

  wsGateway.broadcast('data:changed', {
    entity: 'goal',
    action: 'updated',
    id: c.req.param('goalId'),
  });
  return apiResponse(c, updated);
});

/**
 * POST /goals/:goalId/steps/:stepId/complete - Mark step as completed
 * Progress is recalculated automatically.
 */
goalsRoutes.post('/:goalId/steps/:stepId/complete', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');
  const rawBody = await c.req.json().catch(() => ({}));
  const { validateBody, completeGoalStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(completeGoalStepSchema, rawBody) as { result?: string };

  const service = getServiceRegistry().get(Services.Goal);
  const updated = await service.completeStep(userId, stepId, body.result);

  if (!updated) {
    return notFoundError(c, 'Step', stepId);
  }

  wsGateway.broadcast('data:changed', {
    entity: 'goal',
    action: 'updated',
    id: c.req.param('goalId'),
  });
  return apiResponse(c, {
    step: updated,
    message: 'Step completed successfully.',
  });
});

/**
 * DELETE /goals/:goalId/steps/:stepId - Delete a step
 * Progress is recalculated automatically.
 */
goalsRoutes.delete('/:goalId/steps/:stepId', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');

  const service = getServiceRegistry().get(Services.Goal);
  const deleted = await service.deleteStep(userId, stepId);

  if (!deleted) {
    return notFoundError(c, 'Step', stepId);
  }

  wsGateway.broadcast('data:changed', {
    entity: 'goal',
    action: 'updated',
    id: c.req.param('goalId'),
  });
  return apiResponse(c, {
    message: 'Step deleted successfully.',
  });
});

// ============================================================================
// Tool Executor
// ============================================================================

import type { ToolExecutionResult } from '../services/tool-executor.js';

/**
 * Execute goal tool - delegates to GoalService
 */
export async function executeGoalTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const service = getServiceRegistry().get(Services.Goal);

  try {
    switch (toolId) {
      case 'create_goal': {
        const { title, description, priority, dueDate, parentId } = params as {
          title: string;
          description?: string;
          priority?: number;
          dueDate?: string;
          parentId?: string;
        };

        const goal = await service.createGoal(userId, {
          title,
          description,
          priority,
          dueDate,
          parentId,
        });

        wsGateway.broadcast('data:changed', { entity: 'goal', action: 'created', id: goal.id });
        return {
          success: true,
          result: {
            message: `Created goal: "${goal.title}"`,
            goal: {
              id: goal.id,
              title: goal.title,
              priority: goal.priority,
              dueDate: goal.dueDate,
            },
          },
        };
      }

      case 'list_goals': {
        const { status, limit = 10 } = params as {
          status?: GoalStatus;
          limit?: number;
        };

        const goals = await service.listGoals(userId, {
          status: status ?? 'active',
          limit,
          orderBy: 'priority',
        });

        if (goals.length === 0) {
          return {
            success: true,
            result: {
              message: `No ${status ?? 'active'} goals found.`,
              goals: [],
            },
          };
        }

        return {
          success: true,
          result: {
            message: `Found ${goals.length} ${status ?? 'active'} goal(s).`,
            goals: goals.map((g) => ({
              id: g.id,
              title: g.title,
              status: g.status,
              priority: g.priority,
              progress: g.progress,
              dueDate: g.dueDate,
            })),
          },
        };
      }

      case 'update_goal': {
        const { goalId, status, progress, title, description, priority, dueDate } = params as {
          goalId: string;
          status?: GoalStatus;
          progress?: number;
          title?: string;
          description?: string;
          priority?: number;
          dueDate?: string;
        };

        if (!goalId) {
          return { success: false, error: 'goalId is required' };
        }

        const updated = await service.updateGoal(userId, goalId, {
          status,
          progress,
          title,
          description,
          priority,
          dueDate,
        });

        if (!updated) {
          return { success: false, error: `Goal not found: ${sanitizeId(goalId)}` };
        }

        wsGateway.broadcast('data:changed', { entity: 'goal', action: 'updated', id: goalId });
        return {
          success: true,
          result: {
            message: `Updated goal: "${updated.title}"`,
            goal: {
              id: updated.id,
              title: updated.title,
              status: updated.status,
              progress: updated.progress,
            },
          },
        };
      }

      case 'decompose_goal': {
        const { goalId, steps } = params as {
          goalId: string;
          steps: Array<{ title: string; description?: string }>;
        };

        if (!goalId) {
          return { success: false, error: 'goalId is required' };
        }
        if (!steps || !Array.isArray(steps) || steps.length === 0) {
          return { success: false, error: 'steps array is required' };
        }

        // decomposeGoal validates goal exists and recalculates progress
        const createdSteps = await service.decomposeGoal(
          userId,
          goalId,
          steps.filter((s) => s.title)
        );

        // Get goal title for message
        const goal = await service.getGoal(userId, goalId);

        return {
          success: true,
          result: {
            message: `Added ${createdSteps.length} steps to "${goal?.title ?? goalId}"`,
            steps: createdSteps.map((s) => ({
              id: s.id,
              title: s.title,
              orderNum: s.orderNum,
            })),
          },
        };
      }

      case 'get_next_actions': {
        const { limit = 5 } = params as { limit?: number };

        const actions = await service.getNextActions(userId, limit);

        if (actions.length === 0) {
          return {
            success: true,
            result: {
              message: 'No actionable steps found. All caught up!',
              actions: [],
            },
          };
        }

        return {
          success: true,
          result: {
            message: `Found ${actions.length} actionable step(s).`,
            actions: actions.map((a) => ({
              stepId: a.id,
              stepTitle: a.title,
              goalTitle: a.goalTitle,
              status: a.status,
            })),
          },
        };
      }

      case 'complete_step': {
        const { stepId, result } = params as {
          stepId: string;
          result?: string;
        };

        if (!stepId) {
          return { success: false, error: 'stepId is required' };
        }

        // completeStep recalculates goal progress automatically
        const updated = await service.completeStep(userId, stepId, result);

        if (!updated) {
          return { success: false, error: `Step not found: ${sanitizeId(stepId)}` };
        }

        return {
          success: true,
          result: {
            message: `Completed step: "${updated.title}"`,
            step: {
              id: updated.id,
              title: updated.title,
              status: updated.status,
            },
          },
        };
      }

      case 'get_goal_details': {
        const { goalId } = params as { goalId: string };

        if (!goalId) {
          return { success: false, error: 'goalId is required' };
        }

        const goalWithSteps = await service.getGoalWithSteps(userId, goalId);
        if (!goalWithSteps) {
          return { success: false, error: `Goal not found: ${sanitizeId(goalId)}` };
        }

        const { steps, ...goal } = goalWithSteps;

        return {
          success: true,
          result: {
            goal: {
              id: goal.id,
              title: goal.title,
              description: goal.description,
              status: goal.status,
              priority: goal.priority,
              progress: goal.progress,
              dueDate: goal.dueDate,
              createdAt: goal.createdAt,
            },
            steps: steps.map((s) => ({
              id: s.id,
              title: s.title,
              status: s.status,
              orderNum: s.orderNum,
            })),
            stepCount: steps.length,
            completedSteps: steps.filter((s) => s.status === 'completed').length,
          },
        };
      }

      case 'get_goal_stats': {
        const stats = await service.getStats(userId);

        return {
          success: true,
          result: {
            message: `You have ${stats.total} goals total, ${stats.byStatus.active} active.`,
            stats,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${sanitizeId(toolId)}` };
    }
  } catch (err) {
    if (err instanceof GoalServiceError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
}
