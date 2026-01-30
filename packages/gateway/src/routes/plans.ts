/**
 * Plans Routes
 *
 * API for managing and executing autonomous plans.
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import {
  PlansRepository,
  type PlanStatus,
  type CreatePlanInput,
  type UpdatePlanInput,
  type CreateStepInput,
} from '../db/repositories/plans.js';
import { getPlanExecutor } from '../plans/index.js';

export const plansRoutes = new Hono();

// Get repository instance
function getRepo(userId = 'default'): PlansRepository {
  return new PlansRepository(userId);
}

// ============================================================================
// Plan Routes
// ============================================================================

/**
 * GET /plans - List plans
 */
plansRoutes.get('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const status = c.req.query('status') as PlanStatus | undefined;
  const goalId = c.req.query('goalId');
  const triggerId = c.req.query('triggerId');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const repo = getRepo(userId);
  const plans = await repo.list({ status, goalId, triggerId, limit, offset });

  const response: ApiResponse = {
    success: true,
    data: {
      plans,
      total: plans.length,
      limit,
      offset,
    },
  };

  return c.json(response);
});

/**
 * POST /plans - Create a new plan
 */
plansRoutes.post('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreatePlanInput>();

  if (!body.name || !body.goal) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'name and goal are required',
        },
      },
      400
    );
  }

  const repo = getRepo(userId);
  const plan = await repo.create(body);

  const response: ApiResponse = {
    success: true,
    data: {
      plan,
      message: 'Plan created successfully.',
    },
  };

  return c.json(response, 201);
});

/**
 * GET /plans/stats - Get plan statistics
 */
plansRoutes.get('/stats', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const stats = await repo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * GET /plans/active - Get active plans
 */
plansRoutes.get('/active', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const plans = await repo.getActive();

  const response: ApiResponse = {
    success: true,
    data: {
      plans,
      count: plans.length,
    },
  };

  return c.json(response);
});

/**
 * GET /plans/pending - Get pending plans
 */
plansRoutes.get('/pending', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const plans = await repo.getPending();

  const response: ApiResponse = {
    success: true,
    data: {
      plans,
      count: plans.length,
    },
  };

  return c.json(response);
});

/**
 * GET /plans/:id - Get a specific plan
 */
plansRoutes.get('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  // Get steps and history
  const steps = await repo.getSteps(id);
  const history = await repo.getHistory(id, 20);

  const response: ApiResponse = {
    success: true,
    data: {
      ...plan,
      steps,
      recentHistory: history,
    },
  };

  return c.json(response);
});

/**
 * PATCH /plans/:id - Update a plan
 */
plansRoutes.patch('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<UpdatePlanInput>();

  const repo = getRepo(userId);
  const updated = await repo.update(id, body);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
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
 * DELETE /plans/:id - Delete a plan
 */
plansRoutes.delete('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const deleted = await repo.delete(id);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Plan deleted successfully.',
    },
  };

  return c.json(response);
});

// ============================================================================
// Plan Execution Routes
// ============================================================================

/**
 * POST /plans/:id/execute - Execute a plan
 */
plansRoutes.post('/:id/execute', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  if (plan.status === 'running') {
    return c.json(
      {
        success: false,
        error: {
          code: 'ALREADY_RUNNING',
          message: 'Plan is already running',
        },
      },
      400
    );
  }

  try {
    const executor = getPlanExecutor({ userId });
    const result = await executor.execute(id);

    const response: ApiResponse = {
      success: result.status === 'completed',
      data: {
        result,
        message: result.status === 'completed'
          ? 'Plan executed successfully.'
          : `Plan execution ended with status: ${result.status}`,
      },
      error: result.error
        ? {
            code: 'EXECUTION_ERROR',
            message: result.error,
          }
        : undefined,
    };

    return c.json(response, result.status === 'completed' ? 200 : 500);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: errorMessage,
        },
      },
      500
    );
  }
});

/**
 * POST /plans/:id/pause - Pause a running plan
 */
plansRoutes.post('/:id/pause', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  const executor = getPlanExecutor({ userId });
  const paused = await executor.pause(id);

  const response: ApiResponse = {
    success: paused,
    data: {
      paused,
      message: paused ? 'Plan paused.' : 'Plan was not running.',
    },
  };

  return c.json(response);
});

/**
 * POST /plans/:id/resume - Resume a paused plan
 */
plansRoutes.post('/:id/resume', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  if (plan.status !== 'paused') {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_PAUSED',
          message: 'Plan is not paused',
        },
      },
      400
    );
  }

  try {
    const executor = getPlanExecutor({ userId });
    const result = await executor.resume(id);

    const response: ApiResponse = {
      success: result.status === 'completed',
      data: {
        result,
        message: 'Plan resumed.',
      },
    };

    return c.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        success: false,
        error: {
          code: 'RESUME_ERROR',
          message: errorMessage,
        },
      },
      500
    );
  }
});

/**
 * POST /plans/:id/abort - Abort a running plan
 */
plansRoutes.post('/:id/abort', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  const executor = getPlanExecutor({ userId });
  const aborted = await executor.abort(id);

  const response: ApiResponse = {
    success: true,
    data: {
      aborted,
      message: aborted ? 'Plan aborted.' : 'Plan was not running.',
    },
  };

  return c.json(response);
});

/**
 * POST /plans/:id/checkpoint - Create a checkpoint
 */
plansRoutes.post('/:id/checkpoint', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<{ data?: unknown }>().catch((): { data?: unknown } => ({}));

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  const executor = getPlanExecutor({ userId });
  executor.checkpoint(id, body.data);

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Checkpoint created.',
    },
  };

  return c.json(response);
});

/**
 * POST /plans/:id/start - Start a plan (alias for /execute)
 */
plansRoutes.post('/:id/start', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  if (plan.status === 'running') {
    return c.json(
      {
        success: false,
        error: {
          code: 'ALREADY_RUNNING',
          message: 'Plan is already running',
        },
      },
      400
    );
  }

  try {
    const executor = getPlanExecutor({ userId });
    const result = await executor.execute(id);

    const response: ApiResponse = {
      success: result.status === 'completed',
      data: {
        result,
        message: result.status === 'completed'
          ? 'Plan executed successfully.'
          : `Plan execution ended with status: ${result.status}`,
      },
      error: result.error
        ? {
            code: 'EXECUTION_ERROR',
            message: result.error,
          }
        : undefined,
    };

    return c.json(response, result.status === 'completed' ? 200 : 500);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: errorMessage,
        },
      },
      500
    );
  }
});

/**
 * POST /plans/:id/rollback - Rollback plan to last checkpoint
 */
plansRoutes.post('/:id/rollback', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  if (!plan.checkpoint) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NO_CHECKPOINT',
          message: 'No checkpoint available for rollback',
        },
      },
      400
    );
  }

  try {
    const executor = getPlanExecutor({ userId });
    const checkpointData = await executor.restoreFromCheckpoint(id);

    // Reset failed/completed steps back to pending
    const steps = await repo.getSteps(id);
    for (const step of steps) {
      if (step.status === 'failed' || step.status === 'completed') {
        await repo.updateStep(step.id, { status: 'pending', error: undefined, result: undefined });
      }
    }

    // Reset plan status to pending so it can be re-executed
    await repo.update(id, { status: 'pending' });
    await repo.recalculateProgress(id);
    await repo.logEvent(id, 'rollback', undefined, { checkpoint: checkpointData });

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Plan rolled back to last checkpoint.',
        checkpoint: checkpointData,
      },
    };

    return c.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        success: false,
        error: {
          code: 'ROLLBACK_ERROR',
          message: errorMessage,
        },
      },
      500
    );
  }
});

// ============================================================================
// Step Routes
// ============================================================================

/**
 * GET /plans/:id/steps - Get all steps for a plan
 */
plansRoutes.get('/:id/steps', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  const steps = await repo.getSteps(id);

  const response: ApiResponse = {
    success: true,
    data: {
      planId: id,
      steps,
      count: steps.length,
    },
  };

  return c.json(response);
});

/**
 * POST /plans/:id/steps - Add a step to a plan
 */
plansRoutes.post('/:id/steps', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<CreateStepInput>();

  if (!body.type || !body.name || body.orderNum === undefined) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'type, name, and orderNum are required',
        },
      },
      400
    );
  }

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  try {
    const step = await repo.addStep(id, body);

    const response: ApiResponse = {
      success: true,
      data: {
        step,
        message: 'Step added successfully.',
      },
    };

    return c.json(response, 201);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        success: false,
        error: {
          code: 'ADD_STEP_ERROR',
          message: errorMessage,
        },
      },
      500
    );
  }
});

/**
 * GET /plans/:id/steps/:stepId - Get a specific step
 */
plansRoutes.get('/:id/steps/:stepId', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const stepId = c.req.param('stepId');

  const repo = getRepo(userId);
  const step = await repo.getStep(stepId);

  if (!step) {
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
    data: step,
  };

  return c.json(response);
});

/**
 * PATCH /plans/:id/steps/:stepId - Update a step
 */
plansRoutes.patch('/:id/steps/:stepId', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const stepId = c.req.param('stepId');
  const rawBody = await c.req.json();

  // Validate step update body
  const { validateBody, updatePlanStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(updatePlanStepSchema, rawBody);

  const repo = getRepo(userId);
  const updated = await repo.updateStep(stepId, body);

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

// ============================================================================
// History Routes
// ============================================================================

/**
 * GET /plans/:id/history - Get history for a plan
 */
plansRoutes.get('/:id/history', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const repo = getRepo(userId);
  const plan = await repo.get(id);

  if (!plan) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan not found: ${id}`,
        },
      },
      404
    );
  }

  const history = await repo.getHistory(id, limit);

  const response: ApiResponse = {
    success: true,
    data: {
      planId: id,
      history,
      count: history.length,
    },
  };

  return c.json(response);
});

// ============================================================================
// Executor Status Routes
// ============================================================================

/**
 * GET /plans/executor/status - Get executor status
 */
plansRoutes.get('/executor/status', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const executor = getPlanExecutor({ userId });

  const response: ApiResponse = {
    success: true,
    data: {
      runningPlans: executor.getRunningPlans(),
    },
  };

  return c.json(response);
});
