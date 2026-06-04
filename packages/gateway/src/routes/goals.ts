/**
 * Goals Routes
 *
 * API for managing goals and goal steps.
 * Also provides tool executors for AI to manage goals.
 *
 * All business logic is delegated to GoalService.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import type {
  StepStatus,
  CreateGoalInput,
  UpdateGoalInput,
  CreateStepInput,
} from '../db/repositories/goals.js';
import { GoalServiceError } from '../services/goal-service.js';
import { getGoalService, Services } from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  getIntParam,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  validateQueryEnum,
  parseJsonBody,
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
  const userId = LOCAL_OWNER_ID;
  const status = validateQueryEnum(c.req.query('status'), [
    'active',
    'paused',
    'completed',
    'abandoned',
  ] as const);
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const parentId = c.req.query('parentId');

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const rawBody = await parseJsonBody(c);
  const { validateBody, createGoalSchema } = await import('../middleware/validation.js');
  const body = validateBody(createGoalSchema, rawBody) as unknown as CreateGoalInput;

  try {
    const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const service = getGoalService();
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /goals/next-actions - Get next actionable steps
 */
goalsRoutes.get('/next-actions', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const limit = getIntParam(c, 'limit', 5, 1, 20);

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const days = getIntParam(c, 'days', 7, 1, MAX_DAYS_LOOKBACK);

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');
  const rawBody = await parseJsonBody(c);
  const { validateBody, updateGoalSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateGoalSchema, rawBody) as unknown as UpdateGoalInput;

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const goalId = c.req.param('id');
  const rawBody = await parseJsonBody(c);
  const { validateBody, createGoalStepsSchema } = await import('../middleware/validation.js');
  const body = validateBody(createGoalStepsSchema, rawBody) as
    | { steps: CreateStepInput[] }
    | CreateStepInput;

  try {
    const service = getGoalService();

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
  const userId = LOCAL_OWNER_ID;
  const goalId = c.req.param('id');

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const stepId = c.req.param('stepId');
  const rawBody = await parseJsonBody(c);
  const { validateBody, updateGoalStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateGoalStepSchema, rawBody) as {
    title?: string;
    description?: string;
    status?: StepStatus;
    result?: string;
  };

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const stepId = c.req.param('stepId');
  const rawBody = (await parseJsonBody(c)) ?? {};
  const { validateBody, completeGoalStepSchema } = await import('../middleware/validation.js');
  const body = validateBody(completeGoalStepSchema, rawBody) as { result?: string };

  const service = getGoalService();
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
  const userId = LOCAL_OWNER_ID;
  const stepId = c.req.param('stepId');

  const service = getGoalService();
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
// Moved to tools/goal-tools.ts. Re-exported here for legacy callers.
export { executeGoalTool } from '../tools/goal-tools.js';
