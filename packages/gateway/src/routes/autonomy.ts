/**
 * Autonomy Routes
 *
 * API for managing autonomy levels, risk assessment, and approvals.
 */

import { Hono } from 'hono';
import {
  getApprovalManager,
  assessRisk,
  AutonomyLevel,
  AUTONOMY_LEVEL_NAMES,
  AUTONOMY_LEVEL_DESCRIPTIONS,
  type ActionCategory,
  type ApprovalDecision,
} from '../autonomy/index.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, sanitizeId } from './helpers.js';

export const autonomyRoutes = new Hono();

// ============================================================================
// Configuration Routes
// ============================================================================

/**
 * GET /autonomy/config - Get autonomy configuration
 */
autonomyRoutes.get('/config', (c) => {
  const userId = getUserId(c);
  const manager = getApprovalManager();
  const config = manager.getUserConfig(userId);

  return apiResponse(c, {
    config,
    levels: Object.entries(AUTONOMY_LEVEL_NAMES).map(([level, name]) => ({
      level: parseInt(level, 10),
      name,
      description: AUTONOMY_LEVEL_DESCRIPTIONS[parseInt(level, 10) as AutonomyLevel],
    })),
  });
});

/**
 * PATCH /autonomy/config - Update autonomy configuration
 */
autonomyRoutes.patch('/config', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);

  // Validate config update body
  const { validateBody, autonomyConfigSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyConfigSchema, rawBody);

  const manager = getApprovalManager();
  manager.setUserConfig(userId, body);
  const config = manager.getUserConfig(userId);

  return apiResponse(c, {
    config,
    message: 'Autonomy configuration updated.',
  });
});

/**
 * POST /autonomy/config/reset - Reset to default configuration
 */
autonomyRoutes.post('/config/reset', (c) => {
  const userId = getUserId(c);
  const manager = getApprovalManager();

  // Reset by setting empty config (will use defaults)
  manager.setUserConfig(userId, {});
  const config = manager.getUserConfig(userId);

  return apiResponse(c, {
    config,
    message: 'Autonomy configuration reset to defaults.',
  });
});

// ============================================================================
// Autonomy Level Routes
// ============================================================================

/**
 * GET /autonomy/levels - Get all autonomy levels
 */
autonomyRoutes.get('/levels', (c) => {
  const levels = Object.entries(AUTONOMY_LEVEL_NAMES).map(([level, name]) => ({
    level: parseInt(level, 10),
    name,
    description: AUTONOMY_LEVEL_DESCRIPTIONS[parseInt(level, 10) as AutonomyLevel],
  }));

  return apiResponse(c, { levels });
});

/**
 * POST /autonomy/level - Set autonomy level
 */
autonomyRoutes.post('/level', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, autonomyLevelSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyLevelSchema, rawBody);

  if (body.level === undefined || body.level < 0 || body.level > 4) {
    return apiError(c, { code: ERROR_CODES.INVALID_LEVEL, message: 'Level must be between 0 and 4' }, 400);
  }

  const manager = getApprovalManager();
  manager.setUserConfig(userId, { level: body.level });
  const config = manager.getUserConfig(userId);

  return apiResponse(c, {
    level: config.level,
    levelName: AUTONOMY_LEVEL_NAMES[config.level],
    message: `Autonomy level set to ${AUTONOMY_LEVEL_NAMES[config.level]}.`,
  });
});

// ============================================================================
// Risk Assessment Routes
// ============================================================================

/**
 * POST /autonomy/assess - Assess risk for an action
 */
autonomyRoutes.post('/assess', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, autonomyAssessSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyAssessSchema, rawBody) as {
    category: ActionCategory;
    actionType: string;
    params?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  if (!body.category || !body.actionType) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'category and actionType are required' }, 400);
  }

  const manager = getApprovalManager();
  const config = manager.getUserConfig(userId);
  const risk = assessRisk(
    body.category,
    body.actionType,
    body.params ?? {},
    body.context ?? {},
    config
  );

  return apiResponse(c, {
    risk,
    autonomyLevel: config.level,
    autonomyLevelName: AUTONOMY_LEVEL_NAMES[config.level],
  });
});

// ============================================================================
// Approval Routes
// ============================================================================

/**
 * GET /autonomy/approvals - Get pending approvals
 */
autonomyRoutes.get('/approvals', (c) => {
  const userId = getUserId(c);
  const manager = getApprovalManager();
  const pending = manager.getPendingActions(userId);

  return apiResponse(c, {
    pending,
    count: pending.length,
  });
});

/**
 * POST /autonomy/approvals/request - Request approval for an action
 */
autonomyRoutes.post('/approvals/request', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, autonomyApprovalRequestSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyApprovalRequestSchema, rawBody) as {
    category: ActionCategory;
    actionType: string;
    description: string;
    params?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  if (!body.category || !body.actionType || !body.description) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'category, actionType, and description are required' }, 400);
  }

  try {
    const manager = getApprovalManager();
    const request = await manager.requestApproval(
      userId,
      body.category,
      body.actionType,
      body.description,
      body.params ?? {},
      body.context ?? {}
    );

    if (!request) {
      // Auto-approved
      return apiResponse(c, {
        approved: true,
        autoApproved: true,
        message: 'Action automatically approved based on autonomy settings.',
      });
    }

    return apiResponse(c, {
      approved: false,
      request,
      message: 'Action requires approval.',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return apiError(c, { code: ERROR_CODES.APPROVAL_ERROR, message: errorMessage }, 500);
  }
});

/**
 * GET /autonomy/approvals/:id - Get a specific pending action
 */
autonomyRoutes.get('/approvals/:id', (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const manager = getApprovalManager();
  const action = manager.getPendingAction(id);

  if (!action) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Pending action not found: ${sanitizeId(id)}` }, 404);
  }

  if (action.userId !== userId) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Not authorized to view this action' }, 403);
  }

  return apiResponse(c, action);
});

/**
 * POST /autonomy/approvals/:id/decide - Make a decision on a pending action
 */
autonomyRoutes.post('/approvals/:id/decide', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, autonomyDecisionSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyDecisionSchema, rawBody) as Omit<ApprovalDecision, 'actionId'>;

  if (!body.decision || !['approve', 'reject', 'modify'].includes(body.decision)) {
    return apiError(c, { code: ERROR_CODES.INVALID_DECISION, message: 'decision must be "approve", "reject", or "modify"' }, 400);
  }

  const manager = getApprovalManager();
  const pending = manager.getPendingAction(id);
  if (!pending) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Pending action not found: ${sanitizeId(id)}` }, 404);
  }
  if (pending.userId !== userId) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Not authorized to decide this action' }, 403);
  }

  const action = manager.processDecision({
    actionId: id,
    ...body,
  });

  if (!action) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Pending action not found: ${sanitizeId(id)}` }, 404);
  }

  return apiResponse(c, {
    action,
    message: `Action ${body.decision}${body.decision === 'approve' ? 'd' : 'ed'}.`,
  });
});

/**
 * POST /autonomy/approvals/:id/approve - Approve a pending action (shorthand)
 */
autonomyRoutes.post('/approvals/:id/approve', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => ({}));
  const { validateBody, autonomyApproveRejectSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyApproveRejectSchema, rawBody) as { reason?: string; remember?: boolean };

  const manager = getApprovalManager();
  const pending = manager.getPendingAction(id);
  if (!pending) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Pending action not found: ${sanitizeId(id)}` }, 404);
  }
  if (pending.userId !== userId) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Not authorized to approve this action' }, 403);
  }

  const action = manager.processDecision({
    actionId: id,
    decision: 'approve',
    reason: body.reason,
    remember: body.remember,
  });

  return apiResponse(c, {
    action,
    message: 'Action approved.',
  });
});

/**
 * POST /autonomy/approvals/:id/reject - Reject a pending action (shorthand)
 */
autonomyRoutes.post('/approvals/:id/reject', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => ({}));
  const { validateBody, autonomyApproveRejectSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyApproveRejectSchema, rawBody) as { reason?: string; remember?: boolean };

  const manager = getApprovalManager();
  const pending = manager.getPendingAction(id);
  if (!pending) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Pending action not found: ${sanitizeId(id)}` }, 404);
  }
  if (pending.userId !== userId) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Not authorized to reject this action' }, 403);
  }

  const action = manager.processDecision({
    actionId: id,
    decision: 'reject',
    reason: body.reason,
    remember: body.remember,
  });

  return apiResponse(c, {
    action,
    message: 'Action rejected.',
  });
});

/**
 * DELETE /autonomy/approvals/:id - Cancel a pending action
 */
autonomyRoutes.delete('/approvals/:id', (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const manager = getApprovalManager();
  const pending = manager.getPendingAction(id);

  if (!pending) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Pending action not found or already processed: ${sanitizeId(id)}` }, 404);
  }
  if (pending.userId !== userId) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Not authorized to cancel this action' }, 403);
  }

  manager.cancelPending(id);
  return apiResponse(c, {
    message: 'Pending action cancelled.',
  });
});

// ============================================================================
// Tool/Category Management Routes
// ============================================================================

/**
 * POST /autonomy/tools/allow - Add tool to allowed list
 */
autonomyRoutes.post('/tools/allow', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, autonomyToolPermissionSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyToolPermissionSchema, rawBody) as { tool: string };

  if (!body.tool) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'tool is required' }, 400);
  }

  const manager = getApprovalManager();
  const config = manager.getUserConfig(userId);

  if (!config.allowedTools.includes(body.tool)) {
    config.allowedTools.push(body.tool);
  }
  // Remove from blocked if present
  config.blockedTools = config.blockedTools.filter((t) => t !== body.tool);

  manager.setUserConfig(userId, config);

  return apiResponse(c, {
    allowedTools: config.allowedTools,
    message: `Tool "${sanitizeId(body.tool)}" added to allowed list.`,
  });
});

/**
 * POST /autonomy/tools/block - Add tool to blocked list
 */
autonomyRoutes.post('/tools/block', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, autonomyToolPermissionSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyToolPermissionSchema, rawBody) as { tool: string };

  if (!body.tool) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'tool is required' }, 400);
  }

  const manager = getApprovalManager();
  const config = manager.getUserConfig(userId);

  if (!config.blockedTools.includes(body.tool)) {
    config.blockedTools.push(body.tool);
  }
  // Remove from allowed if present
  config.allowedTools = config.allowedTools.filter((t) => t !== body.tool);

  manager.setUserConfig(userId, config);

  return apiResponse(c, {
    blockedTools: config.blockedTools,
    message: `Tool "${sanitizeId(body.tool)}" added to blocked list.`,
  });
});

/**
 * DELETE /autonomy/tools/:tool - Remove tool from allowed/blocked lists
 */
autonomyRoutes.delete('/tools/:tool', (c) => {
  const userId = getUserId(c);
  const tool = c.req.param('tool');

  const manager = getApprovalManager();
  const config = manager.getUserConfig(userId);

  config.allowedTools = config.allowedTools.filter((t) => t !== tool);
  config.blockedTools = config.blockedTools.filter((t) => t !== tool);

  manager.setUserConfig(userId, config);

  return apiResponse(c, {
    message: `Tool "${sanitizeId(tool)}" removed from allowed/blocked lists.`,
  });
});

// ============================================================================
// Remembered Decisions Routes
// ============================================================================

/**
 * DELETE /autonomy/remembered - Clear remembered decisions
 */
autonomyRoutes.delete('/remembered', (c) => {
  const userId = getUserId(c);
  const manager = getApprovalManager();
  const cleared = manager.clearRememberedDecisions(userId);

  return apiResponse(c, {
    cleared,
    message: `Cleared ${cleared} remembered decisions.`,
  });
});

// ============================================================================
// Budget Routes
// ============================================================================

/**
 * GET /autonomy/budget - Get budget status
 */
autonomyRoutes.get('/budget', (c) => {
  const userId = getUserId(c);
  const manager = getApprovalManager();
  const config = manager.getUserConfig(userId);

  return apiResponse(c, {
    dailyBudget: config.dailyBudget,
    dailySpend: config.dailySpend,
    remaining: config.dailyBudget - config.dailySpend,
    resetAt: config.budgetResetAt,
    maxCostPerAction: config.maxCostPerAction,
  });
});

/**
 * PATCH /autonomy/budget - Update budget settings
 */
autonomyRoutes.patch('/budget', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);

  // Validate budget update body
  const { validateBody, autonomyBudgetSchema } = await import('../middleware/validation.js');
  const body = validateBody(autonomyBudgetSchema, rawBody);

  const manager = getApprovalManager();
  const updates: Record<string, unknown> = {};

  if (body.dailyBudget !== undefined) {
    updates.dailyBudget = body.dailyBudget;
  }
  if (body.maxCostPerAction !== undefined) {
    updates.maxCostPerAction = body.maxCostPerAction;
  }

  manager.setUserConfig(userId, updates);
  const config = manager.getUserConfig(userId);

  return apiResponse(c, {
    dailyBudget: config.dailyBudget,
    maxCostPerAction: config.maxCostPerAction,
    message: 'Budget settings updated.',
  });
});
