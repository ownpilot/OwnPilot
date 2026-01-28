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
plansRoutes.get('/', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const status = c.req.query('status') as PlanStatus | undefined;
  const goalId = c.req.query('goalId');
  const triggerId = c.req.query('triggerId');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const repo = getRepo(userId);
  const plans = repo.list({ status, goalId, triggerId, limit, offset });

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
  const plan = repo.create(body);

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
plansRoutes.get('/stats', (c) => {
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
 * GET /plans/active - Get active plans
 */
plansRoutes.get('/active', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const plans = repo.getActive();

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
plansRoutes.get('/pending', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const plans = repo.getPending();

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
plansRoutes.get('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = repo.get(id);

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
  const steps = repo.getSteps(id);
  const history = repo.getHistory(id, 20);

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
  const updated = repo.update(id, body);

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
plansRoutes.delete('/:id', (c) => {
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
  const plan = repo.get(id);

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
plansRoutes.post('/:id/pause', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = repo.get(id);

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
  const paused = executor.pause(id);

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
  const plan = repo.get(id);

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
plansRoutes.post('/:id/abort', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = repo.get(id);

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
  const aborted = executor.abort(id);

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
  const plan = repo.get(id);

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

// ============================================================================
// Step Routes
// ============================================================================

/**
 * GET /plans/:id/steps - Get all steps for a plan
 */
plansRoutes.get('/:id/steps', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const plan = repo.get(id);

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

  const steps = repo.getSteps(id);

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
  const plan = repo.get(id);

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
    const step = repo.addStep(id, body);

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
plansRoutes.get('/:id/steps/:stepId', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const stepId = c.req.param('stepId');

  const repo = getRepo(userId);
  const step = repo.getStep(stepId);

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
  const body = await c.req.json();

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

// ============================================================================
// History Routes
// ============================================================================

/**
 * GET /plans/:id/history - Get history for a plan
 */
plansRoutes.get('/:id/history', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const repo = getRepo(userId);
  const plan = repo.get(id);

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

  const history = repo.getHistory(id, limit);

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
