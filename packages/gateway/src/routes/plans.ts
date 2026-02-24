/**
 * Plans Routes
 *
 * API for managing and executing autonomous plans.
 */

import { Hono } from 'hono';
import {
  type CreatePlanInput,
  type UpdatePlanInput,
  type CreateStepInput,
} from '../db/repositories/plans.js';
import { getPlanExecutor } from '../plans/index.js';
import { getServiceRegistry, Services } from '@ownpilot/core';
import {
  getUserId,
  apiResponse,
  apiError,
  getIntParam,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  validateQueryEnum,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';
import { pagination } from '../middleware/pagination.js';
import { createCrudRoutes } from './crud-factory.js';

const log = getLog('Plans');
export const plansRoutes = new Hono();

// ============================================================================
// Plan Routes
// ============================================================================

/**
 * GET /plans - List plans
 */
plansRoutes.get('/', pagination(), async (c) => {
  const userId = getUserId(c);
  const status = validateQueryEnum(c.req.query('status'), [
    'pending',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled',
  ] as const);
  const goalId = c.req.query('goalId');
  const triggerId = c.req.query('triggerId');
  const { limit, offset } = c.get('pagination')!;

  const service = getServiceRegistry().get(Services.Plan);
  const [total, plans] = await Promise.all([
    service.countPlans(userId, { status, goalId, triggerId }),
    service.listPlans(userId, { status, goalId, triggerId, limit, offset }),
  ]);

  return apiResponse(c, {
    plans,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

/**
 * POST /plans - Create a new plan
 */
plansRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createPlanSchema } = await import('../middleware/validation.js');
  const body = validateBody(createPlanSchema, rawBody) as unknown as CreatePlanInput;

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.createPlan(userId, body);

  wsGateway.broadcast('data:changed', { entity: 'plan', action: 'created', id: plan.id });

  return apiResponse(
    c,
    {
      plan,
      message: 'Plan created successfully.',
    },
    201
  );
});

/**
 * GET /plans/stats - Get plan statistics
 */
plansRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const service = getServiceRegistry().get(Services.Plan);
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /plans/active - Get active plans
 */
plansRoutes.get('/active', async (c) => {
  const userId = getUserId(c);
  const service = getServiceRegistry().get(Services.Plan);
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
  const service = getServiceRegistry().get(Services.Plan);
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

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
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
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updatePlanSchema } = await import('../middleware/validation.js');
  const body = validateBody(updatePlanSchema, rawBody) as unknown as UpdatePlanInput;

  const service = getServiceRegistry().get(Services.Plan);
  const updated = await service.updatePlan(userId, id, body);

  if (!updated) {
    return notFoundError(c, 'Plan', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

  return apiResponse(c, updated);
});

// Factory-generated DELETE /:id route
const planCrudRoutes = createCrudRoutes({
  entity: 'plan',
  serviceToken: Services.Plan,
  methods: ['delete'],
  serviceMethods: { delete: 'deletePlan' },
});
plansRoutes.route('/', planCrudRoutes);

// ============================================================================
// Plan Execution Routes
// ============================================================================

/**
 * POST /plans/:id/execute - Execute a plan
 */
plansRoutes.post('/:id/execute', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  if (plan.status === 'running') {
    return apiError(
      c,
      { code: ERROR_CODES.ALREADY_RUNNING, message: 'Plan is already running' },
      400
    );
  }

  try {
    log.info('Plan execution started', { userId, planId: id, name: plan.name });
    const executor = getPlanExecutor({ userId });
    const result = await executor.execute(id);

    log.info('Plan execution completed', {
      userId,
      planId: id,
      status: result.status,
      completedSteps: result.completedSteps,
    });

    if (result.status !== 'completed') {
      wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: result.error ?? `Plan execution ended with status: ${result.status}`,
        },
        500
      );
    }

    wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    return apiResponse(c, {
      result,
      message: 'Plan executed successfully.',
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: errorMessage }, 500);
  }
});

/**
 * POST /plans/:id/pause - Pause a running plan
 */
plansRoutes.post('/:id/pause', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  try {
    const executor = getPlanExecutor({ userId });
    const paused = await executor.pause(id);

    if (paused) wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    return apiResponse(c, {
      paused,
      message: paused ? 'Plan paused.' : 'Plan was not running.',
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.PAUSE_ERROR, message: errorMessage }, 500);
  }
});

/**
 * POST /plans/:id/resume - Resume a paused plan
 */
plansRoutes.post('/:id/resume', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  if (plan.status !== 'paused') {
    return apiError(c, { code: ERROR_CODES.NOT_PAUSED, message: 'Plan is not paused' }, 400);
  }

  try {
    const executor = getPlanExecutor({ userId });
    const result = await executor.resume(id);

    wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    if (result.status !== 'completed') {
      return apiError(
        c,
        {
          code: ERROR_CODES.RESUME_ERROR,
          message: result.error ?? `Plan resume ended with status: ${result.status}`,
        },
        500
      );
    }

    return apiResponse(c, {
      result,
      message: 'Plan resumed.',
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.RESUME_ERROR, message: errorMessage }, 500);
  }
});

/**
 * POST /plans/:id/abort - Abort a running plan
 */
plansRoutes.post('/:id/abort', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  try {
    const executor = getPlanExecutor({ userId });
    const aborted = await executor.abort(id);

    if (aborted) wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    return apiResponse(c, {
      aborted,
      message: aborted ? 'Plan aborted.' : 'Plan was not running.',
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.ABORT_ERROR, message: errorMessage }, 500);
  }
});

/**
 * POST /plans/:id/checkpoint - Create a checkpoint
 */
plansRoutes.post('/:id/checkpoint', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ data?: unknown }>().catch((): { data?: unknown } => ({}));

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  const dataStr = JSON.stringify(body.data ?? {});
  if (dataStr.length > 500000) {
    return apiError(
      c,
      {
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: 'Checkpoint data exceeds maximum size (500KB)',
      },
      400
    );
  }

  try {
    const executor = getPlanExecutor({ userId });
    executor.checkpoint(id, body.data);

    wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    return apiResponse(c, {
      message: 'Checkpoint created.',
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.CHECKPOINT_ERROR, message: errorMessage }, 500);
  }
});

/**
 * POST /plans/:id/start - Start a plan (alias for /execute)
 */
plansRoutes.post('/:id/start', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  if (plan.status === 'running') {
    return apiError(
      c,
      { code: ERROR_CODES.ALREADY_RUNNING, message: 'Plan is already running' },
      400
    );
  }

  try {
    log.info('Plan execution started', { userId, planId: id, name: plan.name });
    const executor = getPlanExecutor({ userId });
    const result = await executor.execute(id);

    log.info('Plan execution completed', {
      userId,
      planId: id,
      status: result.status,
      completedSteps: result.completedSteps,
    });

    wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    if (result.status !== 'completed') {
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: result.error ?? `Plan execution ended with status: ${result.status}`,
        },
        500
      );
    }

    return apiResponse(c, {
      result,
      message: 'Plan executed successfully.',
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: errorMessage }, 500);
  }
});

/**
 * POST /plans/:id/rollback - Rollback plan to last checkpoint
 */
plansRoutes.post('/:id/rollback', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
  }

  if (!plan.checkpoint) {
    return apiError(
      c,
      { code: ERROR_CODES.NO_CHECKPOINT, message: 'No checkpoint available for rollback' },
      400
    );
  }

  try {
    const executor = getPlanExecutor({ userId });
    const checkpointData = await executor.restoreFromCheckpoint(id);

    // Reset failed/completed steps back to pending
    const steps = await service.getSteps(userId, id);
    if (steps.length > 200) {
      return apiError(
        c,
        {
          code: ERROR_CODES.BATCH_LIMIT_EXCEEDED,
          message: 'Too many steps in batch update (max 200)',
        },
        400
      );
    }
    for (const step of steps) {
      if (step.status === 'failed' || step.status === 'completed') {
        await service.updateStep(userId, step.id, {
          status: 'pending',
          error: undefined,
          result: undefined,
        });
      }
    }

    // Reset plan status to pending so it can be re-executed
    await service.updatePlan(userId, id, { status: 'pending' });
    await service.recalculateProgress(userId, id);
    await service.logEvent(userId, id, 'rollback', undefined, { checkpoint: checkpointData });

    wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    return apiResponse(c, {
      message: 'Plan rolled back to last checkpoint.',
      checkpoint: checkpointData,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
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

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
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
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createPlanStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(createPlanStepSchema, rawBody) as unknown as CreateStepInput;

  try {
    const service = getServiceRegistry().get(Services.Plan);
    const step = await service.addStep(userId, id, body);

    wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id });

    return apiResponse(
      c,
      {
        step,
        message: 'Step added successfully.',
      },
      201
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return apiError(c, { code: ERROR_CODES.ADD_STEP_ERROR, message: errorMessage }, 500);
  }
});

/**
 * GET /plans/:id/steps/:stepId - Get a specific step
 */
plansRoutes.get('/:id/steps/:stepId', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');

  const service = getServiceRegistry().get(Services.Plan);
  const step = await service.getStep(userId, stepId);

  if (!step) {
    return notFoundError(c, 'Step', stepId);
  }

  return apiResponse(c, step);
});

/**
 * PATCH /plans/:id/steps/:stepId - Update a step
 */
plansRoutes.patch('/:id/steps/:stepId', async (c) => {
  const userId = getUserId(c);
  const stepId = c.req.param('stepId');
  const rawBody = await c.req.json().catch(() => null);

  // Validate step update body
  const { validateBody, updatePlanStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(updatePlanStepSchema, rawBody);

  const service = getServiceRegistry().get(Services.Plan);
  const updated = await service.updateStep(userId, stepId, body);

  if (!updated) {
    return notFoundError(c, 'Step', stepId);
  }

  wsGateway.broadcast('data:changed', { entity: 'plan', action: 'updated', id: c.req.param('id') });

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

  const service = getServiceRegistry().get(Services.Plan);
  const plan = await service.getPlan(userId, id);

  if (!plan) {
    return notFoundError(c, 'Plan', id);
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
