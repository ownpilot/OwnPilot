/**
 * Goals Routes
 *
 * API for managing goals and goal steps.
 * Also provides tool executors for AI to manage goals.
 *
 * All business logic is delegated to GoalService.
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import type {
  GoalStatus,
  StepStatus,
  CreateGoalInput,
  UpdateGoalInput,
  CreateStepInput,
} from '../db/repositories/goals.js';
import { getGoalService, GoalServiceError } from '../services/goal-service.js';
import { getUserId } from './helpers.js';

export const goalsRoutes = new Hono();

// ============================================================================
// Goal Routes
// ============================================================================

/**
 * GET /goals - List goals
 */
goalsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const status = c.req.query('status') as GoalStatus | undefined;
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const parentId = c.req.query('parentId');

  const service = getGoalService();
  const goals = await service.listGoals(userId, {
    status,
    limit,
    parentId: parentId === 'null' ? null : parentId,
    orderBy: 'priority',
  });

  const response: ApiResponse = {
    success: true,
    data: {
      goals,
      total: goals.length,
    },
  };

  return c.json(response);
});

/**
 * POST /goals - Create a new goal
 */
goalsRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<CreateGoalInput>();

  try {
    const service = getGoalService();
    const goal = await service.createGoal(userId, body);

    const response: ApiResponse = {
      success: true,
      data: {
        goal,
        message: 'Goal created successfully.',
      },
    };

    return c.json(response, 201);
  } catch (err) {
    if (err instanceof GoalServiceError && err.code === 'VALIDATION_ERROR') {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: err.message,
          },
        },
        400
      );
    }
    throw err;
  }
});

/**
 * GET /goals/stats - Get goal statistics
 */
goalsRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const service = getGoalService();
  const stats = await service.getStats(userId);

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * GET /goals/next-actions - Get next actionable steps
 */
goalsRoutes.get('/next-actions', async (c) => {
  const userId = getUserId(c);
  const limit = parseInt(c.req.query('limit') ?? '5', 10);

  const service = getGoalService();
  const actions = await service.getNextActions(userId, limit);

  const response: ApiResponse = {
    success: true,
    data: {
      actions,
      count: actions.length,
    },
  };

  return c.json(response);
});

/**
 * GET /goals/upcoming - Get goals with upcoming due dates
 */
goalsRoutes.get('/upcoming', async (c) => {
  const userId = getUserId(c);
  const days = parseInt(c.req.query('days') ?? '7', 10);

  const service = getGoalService();
  const goals = await service.getUpcoming(userId, days);

  const response: ApiResponse = {
    success: true,
    data: {
      goals,
      count: goals.length,
    },
  };

  return c.json(response);
});

/**
 * GET /goals/:id - Get a specific goal with steps
 */
goalsRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getGoalService();
  const goalWithSteps = await service.getGoalWithSteps(userId, id);

  if (!goalWithSteps) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Goal not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: goalWithSteps,
  };

  return c.json(response);
});

/**
 * PATCH /goals/:id - Update a goal
 */
goalsRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<UpdateGoalInput>();

  const service = getGoalService();
  const updated = await service.updateGoal(userId, id, body);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Goal not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: updated,
  };

  return c.json(response);
});

/**
 * DELETE /goals/:id - Delete a goal
 */
goalsRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getGoalService();
  const deleted = await service.deleteGoal(userId, id);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Goal not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Goal deleted successfully.',
    },
  };

  return c.json(response);
});

// ============================================================================
// Step Routes
// ============================================================================

/**
 * POST /goals/:id/steps - Add steps to a goal
 */
goalsRoutes.post('/:id/steps', async (c) => {
  const userId = getUserId(c);
  const goalId = c.req.param('id');
  const body = await c.req.json<{ steps: CreateStepInput[] } | CreateStepInput>();

  try {
    const service = getGoalService();

    // Handle single step or array of steps
    const stepsToAdd = 'steps' in body ? body.steps : [body];
    const validSteps = stepsToAdd.filter((s) => s.title);

    // Use decomposeGoal which validates goal exists and recalculates progress
    const createdSteps = await service.decomposeGoal(userId, goalId, validSteps);

    const response: ApiResponse = {
      success: true,
      data: {
        steps: createdSteps,
        count: createdSteps.length,
        message: `Added ${createdSteps.length} step(s) to goal.`,
      },
    };

    return c.json(response, 201);
  } catch (err) {
    if (err instanceof GoalServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return c.json(
        {
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        },
        status
      );
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

  const service = getGoalService();
  const steps = await service.getSteps(userId, goalId);

  const response: ApiResponse = {
    success: true,
    data: {
      steps,
      count: steps.length,
    },
  };

  return c.json(response);
});

/**
 * PATCH /goals/:goalId/steps/:stepId - Update a step
 * Progress is recalculated automatically when status changes.
 */
goalsRoutes.patch('/:goalId/steps/:stepId', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');
  const body = await c.req.json<{
    title?: string;
    description?: string;
    status?: StepStatus;
    result?: string;
  }>();

  const service = getGoalService();
  const updated = await service.updateStep(userId, stepId, body);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Step not found: ${stepId}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: updated,
  };

  return c.json(response);
});

/**
 * POST /goals/:goalId/steps/:stepId/complete - Mark step as completed
 * Progress is recalculated automatically.
 */
goalsRoutes.post('/:goalId/steps/:stepId/complete', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');
  const body = await c.req.json<{ result?: string }>().catch((): { result?: string } => ({}));

  const service = getGoalService();
  const updated = await service.completeStep(userId, stepId, body.result);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Step not found: ${stepId}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      step: updated,
      message: 'Step completed successfully.',
    },
  };

  return c.json(response);
});

/**
 * DELETE /goals/:goalId/steps/:stepId - Delete a step
 * Progress is recalculated automatically.
 */
goalsRoutes.delete('/:goalId/steps/:stepId', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');

  const service = getGoalService();
  const deleted = await service.deleteStep(userId, stepId);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Step not found: ${stepId}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Step deleted successfully.',
    },
  };

  return c.json(response);
});

// ============================================================================
// Tool Executor
// ============================================================================

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute goal tool - delegates to GoalService
 */
export async function executeGoalTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const service = getGoalService();

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
          return { success: false, error: `Goal not found: ${goalId}` };
        }

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
          steps.filter((s) => s.title),
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
          return { success: false, error: `Step not found: ${stepId}` };
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
          return { success: false, error: `Goal not found: ${goalId}` };
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

      case 'goal_stats': {
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
        return { success: false, error: `Unknown tool: ${toolId}` };
    }
  } catch (err) {
    if (err instanceof GoalServiceError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
