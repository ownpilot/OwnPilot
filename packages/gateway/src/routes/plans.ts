/**
 * Plans Routes
 *
 * API for managing and executing autonomous plans.
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import {
  type PlanStatus,
  type CreatePlanInput,
  type UpdatePlanInput,
  type CreateStepInput,
} from '../db/repositories/plans.js';
import { getPlanService } from '../services/plan-service.js';
import { getPlanExecutor } from '../plans/index.js';
import { getUserId } from './helpers.js';

export const plansRoutes = new Hono();

// ============================================================================
// Plan Routes
// ============================================================================

/**
 * GET /plans - List plans
 */
plansRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const status = c.req.query('status') as PlanStatus | undefined;
  const goalId = c.req.query('goalId');
  const triggerId = c.req.query('triggerId');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const service = getPlanService();
  const plans = await service.listPlans(userId, { status, goalId, triggerId, limit, offset });

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
  const userId = getUserId(c);
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

  const service = getPlanService();
  const plan = await service.createPlan(userId, body);

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
  const userId = getUserId(c);
  const service = getPlanService();
  const stats = await service.getStats(userId);

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
  const userId = getUserId(c);
  const service = getPlanService();
  const plans = await service.getActive(userId);

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
  const userId = getUserId(c);
  const service = getPlanService();
  const plans = await service.getPending(userId);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const steps = await service.getSteps(userId, id);
  const history = await service.getHistory(userId, id, 20);

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
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<UpdatePlanInput>();

  const service = getPlanService();
  const updated = await service.updatePlan(userId, id, body);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const deleted = await service.deletePlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ data?: unknown }>().catch((): { data?: unknown } => ({}));

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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
    const steps = await service.getSteps(userId, id);
    for (const step of steps) {
      if (step.status === 'failed' || step.status === 'completed') {
        await service.updateStep(userId, step.id, { status: 'pending', error: undefined, result: undefined });
      }
    }

    // Reset plan status to pending so it can be re-executed
    await service.updatePlan(userId, id, { status: 'pending' });
    await service.recalculateProgress(userId, id);
    await service.logEvent(userId, id, 'rollback', undefined, { checkpoint: checkpointData });

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
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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

  const steps = await service.getSteps(userId, id);

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
  const userId = getUserId(c);
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

  try {
    const service = getPlanService();
    const step = await service.addStep(userId, id, body);

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
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');

  const service = getPlanService();
  const step = await service.getStep(userId, stepId);

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
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');
  const rawBody = await c.req.json();

  // Validate step update body
  const { validateBody, updatePlanStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(updatePlanStepSchema, rawBody);

  const service = getPlanService();
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

// ============================================================================
// History Routes
// ============================================================================

/**
 * GET /plans/:id/history - Get history for a plan
 */
plansRoutes.get('/:id/history', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

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

  const history = await service.getHistory(userId, id, limit);

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
  const userId = getUserId(c);
  const executor = getPlanExecutor({ userId });

  const response: ApiResponse = {
    success: true,
    data: {
      runningPlans: executor.getRunningPlans(),
    },
  };

  return c.json(response);
});
