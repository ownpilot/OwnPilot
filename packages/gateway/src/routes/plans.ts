/**
 * Plans Routes
 *
 * API for managing and executing autonomous plans.
 */

import { Hono } from 'hono';
import {
  type PlanStatus,
  type CreatePlanInput,
  type UpdatePlanInput,
  type CreateStepInput,
} from '../db/repositories/plans.js';
import { getPlanService } from '../services/plan-service.js';
import { getPlanExecutor } from '../plans/index.js';
import { getUserId, apiResponse, apiError, getIntParam } from './helpers.js'
import { ERROR_CODES } from './helpers.js';
import { getLog } from '../services/log.js';

const log = getLog('Plans');
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
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const offset = getIntParam(c, 'offset', 0, 0);

  const service = getPlanService();
  const plans = await service.listPlans(userId, { status, goalId, triggerId, limit, offset });

  return apiResponse(c, {
      plans,
      total: plans.length,
      limit,
      offset,
    });
});

/**
 * POST /plans - Create a new plan
 */
plansRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<CreatePlanInput>();

  if (!body.name || !body.goal) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'name and goal are required' }, 400);
  }

  const service = getPlanService();
  const plan = await service.createPlan(userId, body);

  return apiResponse(c, {
      plan,
      message: 'Plan created successfully.',
    }, 201);
});

/**
 * GET /plans/stats - Get plan statistics
 */
plansRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const service = getPlanService();
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /plans/active - Get active plans
 */
plansRoutes.get('/active', async (c) => {
  const userId = getUserId(c);
  const service = getPlanService();
  const plans = await service.getActive(userId);

  return apiResponse(c, {
      plans,
      count: plans.length,
    });
});

/**
 * GET /plans/pending - Get pending plans
 */
plansRoutes.get('/pending', async (c) => {
  const userId = getUserId(c);
  const service = getPlanService();
  const plans = await service.getPending(userId);

  return apiResponse(c, {
      plans,
      count: plans.length,
    });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  // Get steps and history
  const steps = await service.getSteps(userId, id);
  const history = await service.getHistory(userId, id, 20);

  return apiResponse(c, {
      ...plan,
      steps,
      recentHistory: history,
    });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  return apiResponse(c, updated);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  return apiResponse(c, {
      message: 'Plan deleted successfully.',
    });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  if (plan.status === 'running') {
    return apiError(c, { code: ERROR_CODES.ALREADY_RUNNING, message: 'Plan is already running' }, 400);
  }

  try {
    log.info('Plan execution started', { userId, planId: id, name: plan.name });
    const executor = getPlanExecutor({ userId });
    const result = await executor.execute(id);

    log.info('Plan execution completed', { userId, planId: id, status: result.status, completedSteps: result.completedSteps });
    return c.json({
      success: result.status === 'completed',
      data: {
        result,
        message: result.status === 'completed'
          ? 'Plan executed successfully.'
          : `Plan execution ended with status: ${result.status}`,
      },
      error: result.error
        ? {
            code: ERROR_CODES.EXECUTION_ERROR,
            message: result.error,
          }
        : undefined,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, result.status === 'completed' ? 200 : 500);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: errorMessage }, 500);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  const executor = getPlanExecutor({ userId });
  const paused = await executor.pause(id);

  return c.json({
    success: paused,
    data: {
      paused,
      message: paused ? 'Plan paused.' : 'Plan was not running.',
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  if (plan.status !== 'paused') {
    return apiError(c, { code: ERROR_CODES.NOT_PAUSED, message: 'Plan is not paused' }, 400);
  }

  try {
    const executor = getPlanExecutor({ userId });
    const result = await executor.resume(id);

    return c.json({
      success: result.status === 'completed',
      data: {
        result,
        message: 'Plan resumed.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return apiError(c, { code: ERROR_CODES.RESUME_ERROR, message: errorMessage }, 500);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  const executor = getPlanExecutor({ userId });
  const aborted = await executor.abort(id);

  return apiResponse(c, {
      aborted,
      message: aborted ? 'Plan aborted.' : 'Plan was not running.',
    });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  const executor = getPlanExecutor({ userId });
  executor.checkpoint(id, body.data);

  return apiResponse(c, {
      message: 'Checkpoint created.',
    });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  if (plan.status === 'running') {
    return apiError(c, { code: ERROR_CODES.ALREADY_RUNNING, message: 'Plan is already running' }, 400);
  }

  try {
    log.info('Plan execution started', { userId, planId: id, name: plan.name });
    const executor = getPlanExecutor({ userId });
    const result = await executor.execute(id);

    log.info('Plan execution completed', { userId, planId: id, status: result.status, completedSteps: result.completedSteps });
    return c.json({
      success: result.status === 'completed',
      data: {
        result,
        message: result.status === 'completed'
          ? 'Plan executed successfully.'
          : `Plan execution ended with status: ${result.status}`,
      },
      error: result.error
        ? {
            code: ERROR_CODES.EXECUTION_ERROR,
            message: result.error,
          }
        : undefined,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, result.status === 'completed' ? 200 : 500);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: errorMessage }, 500);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  if (!plan.checkpoint) {
    return apiError(c, { code: ERROR_CODES.NO_CHECKPOINT, message: 'No checkpoint available for rollback' }, 400);
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

    return apiResponse(c, {
        message: 'Plan rolled back to last checkpoint.',
        checkpoint: checkpointData,
      });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return apiError(c, { code: ERROR_CODES.ROLLBACK_ERROR, message: errorMessage }, 500);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  const steps = await service.getSteps(userId, id);

  return apiResponse(c, {
      planId: id,
      steps,
      count: steps.length,
    });
});

/**
 * POST /plans/:id/steps - Add a step to a plan
 */
plansRoutes.post('/:id/steps', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<CreateStepInput>();

  if (!body.type || !body.name || body.orderNum === undefined) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'type, name, and orderNum are required' }, 400);
  }

  try {
    const service = getPlanService();
    const step = await service.addStep(userId, id, body);

    return apiResponse(c, {
        step,
        message: 'Step added successfully.',
      }, 201);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return apiError(c, { code: ERROR_CODES.ADD_STEP_ERROR, message: errorMessage }, 500);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Step not found: ${stepId}` }, 404);
  }

  return apiResponse(c, step);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Step not found: ${stepId}` }, 404);
  }

  return apiResponse(c, updated);
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
  const limit = getIntParam(c, 'limit', 50, 1, 200);

  const service = getPlanService();
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Plan not found: ${id}` }, 404);
  }

  const history = await service.getHistory(userId, id, limit);

  return apiResponse(c, {
      planId: id,
      history,
      count: history.length,
    });
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

  return apiResponse(c, {
      runningPlans: executor.getRunningPlans(),
    });
});
