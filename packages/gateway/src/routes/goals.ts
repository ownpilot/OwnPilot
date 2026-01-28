/**
 * Goals Routes
 *
 * API for managing goals and goal steps.
 * Also provides tool executors for AI to manage goals.
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import {
  GoalsRepository,
  type GoalStatus,
  type StepStatus,
  type CreateGoalInput,
  type UpdateGoalInput,
  type CreateStepInput,
} from '../db/repositories/goals.js';

export const goalsRoutes = new Hono();

// Get repository instance
function getRepo(userId = 'default'): GoalsRepository {
  return new GoalsRepository(userId);
}

// ============================================================================
// Goal Routes
// ============================================================================

/**
 * GET /goals - List goals
 */
goalsRoutes.get('/', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const status = c.req.query('status') as GoalStatus | undefined;
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const parentId = c.req.query('parentId');

  const repo = getRepo(userId);
  const goals = repo.list({
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
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreateGoalInput>();

  if (!body.title) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'title is required',
        },
      },
      400
    );
  }

  const repo = getRepo(userId);
  const goal = repo.create(body);

  const response: ApiResponse = {
    success: true,
    data: {
      goal,
      message: 'Goal created successfully.',
    },
  };

  return c.json(response, 201);
});

/**
 * GET /goals/stats - Get goal statistics
 */
goalsRoutes.get('/stats', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const stats = repo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * GET /goals/next-actions - Get next actionable steps
 */
goalsRoutes.get('/next-actions', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const limit = parseInt(c.req.query('limit') ?? '5', 10);

  const repo = getRepo(userId);
  const actions = repo.getNextActions(limit);

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
goalsRoutes.get('/upcoming', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const days = parseInt(c.req.query('days') ?? '7', 10);

  const repo = getRepo(userId);
  const goals = repo.getUpcoming(days);

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
goalsRoutes.get('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const goal = repo.get(id);

  if (!goal) {
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

  const steps = repo.getSteps(id);

  const response: ApiResponse = {
    success: true,
    data: {
      ...goal,
      steps,
    },
  };

  return c.json(response);
});

/**
 * PATCH /goals/:id - Update a goal
 */
goalsRoutes.patch('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<UpdateGoalInput>();

  const repo = getRepo(userId);
  const updated = repo.update(id, body);

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
goalsRoutes.delete('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const deleted = repo.delete(id);

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
  const userId = c.req.query('userId') ?? 'default';
  const goalId = c.req.param('id');
  const body = await c.req.json<{ steps: CreateStepInput[] } | CreateStepInput>();

  const repo = getRepo(userId);

  // Check if goal exists
  const goal = repo.get(goalId);
  if (!goal) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Goal not found: ${goalId}`,
        },
      },
      404
    );
  }

  // Handle single step or array of steps
  const stepsToAdd = 'steps' in body ? body.steps : [body];
  const createdSteps = [];

  for (const stepInput of stepsToAdd) {
    if (!stepInput.title) continue;
    const step = repo.addStep(goalId, stepInput);
    if (step) createdSteps.push(step);
  }

  const response: ApiResponse = {
    success: true,
    data: {
      steps: createdSteps,
      count: createdSteps.length,
      message: `Added ${createdSteps.length} step(s) to goal.`,
    },
  };

  return c.json(response, 201);
});

/**
 * GET /goals/:id/steps - Get all steps for a goal
 */
goalsRoutes.get('/:id/steps', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const goalId = c.req.param('id');

  const repo = getRepo(userId);
  const steps = repo.getSteps(goalId);

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
 */
goalsRoutes.patch('/:goalId/steps/:stepId', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const stepId = c.req.param('stepId');
  const body = await c.req.json<{
    title?: string;
    description?: string;
    status?: StepStatus;
    result?: string;
  }>();

  const repo = getRepo(userId);
  const updated = repo.updateStep(stepId, body);

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
 */
goalsRoutes.post('/:goalId/steps/:stepId/complete', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const stepId = c.req.param('stepId');
  const body = await c.req.json<{ result?: string }>().catch((): { result?: string } => ({}));

  const repo = getRepo(userId);
  const updated = repo.updateStep(stepId, {
    status: 'completed',
    result: body.result,
  });

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
 */
goalsRoutes.delete('/:goalId/steps/:stepId', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const stepId = c.req.param('stepId');

  const repo = getRepo(userId);
  const deleted = repo.deleteStep(stepId);

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
 * Execute goal tool
 */
export function executeGoalTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): ToolExecutionResult {
  const repo = getRepo(userId);

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

        if (!title) {
          return { success: false, error: 'title is required' };
        }

        const goal = repo.create({
          title,
          description,
          priority,
          dueDate,
          parentId,
        });

        return {
          success: true,
          result: {
            message: `Created goal: "${title}"`,
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

        const goals = repo.list({
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

        const updated = repo.update(goalId, {
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

        const goal = repo.get(goalId);
        if (!goal) {
          return { success: false, error: `Goal not found: ${goalId}` };
        }

        const createdSteps = [];
        for (const stepInput of steps) {
          if (!stepInput.title) continue;
          const step = repo.addStep(goalId, stepInput);
          if (step) createdSteps.push(step);
        }

        return {
          success: true,
          result: {
            message: `Added ${createdSteps.length} steps to "${goal.title}"`,
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

        const actions = repo.getNextActions(limit);

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

        const updated = repo.updateStep(stepId, {
          status: 'completed',
          result,
        });

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

        const goal = repo.get(goalId);
        if (!goal) {
          return { success: false, error: `Goal not found: ${goalId}` };
        }

        const steps = repo.getSteps(goalId);

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
        const stats = repo.getStats();

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
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
