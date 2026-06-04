/**
 * Triggers Routes
 *
 * API for managing proactive triggers.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { type CreateTriggerInput, type UpdateTriggerInput } from '../db/repositories/triggers.js';
import { getTriggerEngine } from '../triggers/index.js';
import { validateCronExpression, getTriggerService } from '@ownpilot/core';
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
import { pagination } from '../middleware/pagination.js';

export const triggersRoutes = new Hono();

// ============================================================================
// Trigger Routes
// ============================================================================

/**
 * GET /triggers - List triggers
 */
triggersRoutes.get('/', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const type = validateQueryEnum(c.req.query('type'), [
    'schedule',
    'event',
    'condition',
    'webhook',
  ] as const);
  const enabled = c.req.query('enabled');
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  const service = getTriggerService();
  const triggers = await service.listTriggers(userId, {
    type,
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    limit,
  });

  return apiResponse(c, {
    triggers,
    total: triggers.length,
  });
});

/**
 * POST /triggers - Create a new trigger
 */
triggersRoutes.post('/', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const rawBody = await parseJsonBody(c);
  const { validateBody, createTriggerSchema } = await import('../middleware/validation.js');
  const body = validateBody(createTriggerSchema, rawBody) as unknown as CreateTriggerInput;

  // Validate cron expression for schedule triggers before saving
  if (body.type === 'schedule') {
    const cron = (body.config as Record<string, unknown>).cron;
    if (typeof cron !== 'string' || !cron) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_CRON,
          message: 'Schedule triggers require a cron expression string in config.cron',
        },
        400
      );
    }
    const validation = validateCronExpression(cron);
    if (!validation.valid) {
      return apiError(c, { code: ERROR_CODES.INVALID_CRON, message: validation.error! }, 400);
    }
  }

  const service = getTriggerService();

  let trigger;
  try {
    trigger = await service.createTrigger(userId, body);
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to create trigger');
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message }, 400);
  }

  wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'created', id: trigger.id });

  return apiResponse(
    c,
    {
      trigger,
      message: 'Trigger created successfully.',
    },
    201
  );
});

/**
 * GET /triggers/stats - Get trigger statistics
 */
triggersRoutes.get('/stats', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const service = getTriggerService();
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /triggers/history - Get recent trigger history
 */
triggersRoutes.get('/history', pagination({ defaultLimit: 25, maxLimit: 200 }), async (c) => {
  const userId = LOCAL_OWNER_ID;
  const { limit, offset } = c.get('pagination')!;
  const status = validateQueryEnum(c.req.query('status'), [
    'success',
    'failure',
    'skipped',
  ] as const);
  const triggerId = c.req.query('triggerId') || undefined;
  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;

  const service = getTriggerService();
  const { history, total } = await service.getRecentHistory(userId, {
    status,
    triggerId,
    from,
    to,
    limit,
    offset,
  });

  return apiResponse(c, {
    history,
    total,
    limit,
    offset,
  });
});

/**
 * GET /triggers/due - Get triggers that are due to fire
 */
triggersRoutes.get('/due', async (c) => {
  const userId = LOCAL_OWNER_ID;

  const service = getTriggerService();
  const triggers = await service.getDueTriggers(userId);

  return apiResponse(c, {
    triggers,
    count: triggers.length,
  });
});

/**
 * GET /triggers/:id - Get a specific trigger
 */
triggersRoutes.get('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getTriggerService();
  const trigger = await service.getTrigger(userId, id);

  if (!trigger) {
    return notFoundError(c, 'Trigger', id);
  }

  // Get recent history for this trigger
  const { history } = await service.getHistoryForTrigger(userId, id, { limit: 10 });

  return apiResponse(c, {
    ...trigger,
    recentHistory: history,
  });
});

/**
 * PATCH /triggers/:id - Update a trigger
 */
triggersRoutes.patch('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');
  const body = await parseJsonBody<UpdateTriggerInput>(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const service = getTriggerService();

  // Validate cron expression if config is being updated on a schedule trigger
  if (body.config && typeof body.config === 'object') {
    const existing = await service.getTrigger(userId, id);
    if (existing?.type === 'schedule') {
      const cron = (body.config as Record<string, unknown>).cron;
      if (cron !== undefined) {
        if (typeof cron !== 'string' || !cron) {
          return apiError(
            c,
            { code: ERROR_CODES.INVALID_CRON, message: 'config.cron must be a non-empty string' },
            400
          );
        }
        const validation = validateCronExpression(cron);
        if (!validation.valid) {
          return apiError(c, { code: ERROR_CODES.INVALID_CRON, message: validation.error! }, 400);
        }
      }
    }
  }

  const updated = await service.updateTrigger(userId, id, body);

  if (!updated) {
    return notFoundError(c, 'Trigger', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'updated', id });

  return apiResponse(c, updated);
});

/**
 * POST /triggers/:id/enable - Enable a trigger
 */
triggersRoutes.post('/:id/enable', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getTriggerService();
  const updated = await service.updateTrigger(userId, id, { enabled: true });

  if (!updated) {
    return notFoundError(c, 'Trigger', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'updated', id });

  return apiResponse(c, {
    trigger: updated,
    message: 'Trigger enabled.',
  });
});

/**
 * POST /triggers/:id/disable - Disable a trigger
 */
triggersRoutes.post('/:id/disable', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getTriggerService();
  const updated = await service.updateTrigger(userId, id, { enabled: false });

  if (!updated) {
    return notFoundError(c, 'Trigger', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'updated', id });

  return apiResponse(c, {
    trigger: updated,
    message: 'Trigger disabled.',
  });
});

/**
 * POST /triggers/:id/fire - Manually fire a trigger
 */
triggersRoutes.post('/:id/fire', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getTriggerService();
  const trigger = await service.getTrigger(userId, id);

  if (!trigger) {
    return notFoundError(c, 'Trigger', id);
  }

  // Fire the trigger using the engine
  const engine = getTriggerEngine({ userId });

  let result;
  try {
    result = await engine.fireTrigger(id);
  } catch (error) {
    const message = getErrorMessage(error, 'Trigger execution failed unexpectedly.');
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message }, 500);
  }

  if (!result.success) {
    return apiError(
      c,
      { code: ERROR_CODES.EXECUTION_ERROR, message: result.error || 'Trigger execution failed.' },
      500
    );
  }

  wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'updated', id });

  return apiResponse(c, { result, message: 'Trigger fired successfully.' });
});

/**
 * DELETE /triggers/:id - Delete a trigger
 */
triggersRoutes.delete('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getTriggerService();
  const deleted = await service.deleteTrigger(userId, id);

  if (!deleted) {
    return notFoundError(c, 'Trigger', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'deleted', id });

  return apiResponse(c, {
    message: 'Trigger deleted successfully.',
  });
});

/**
 * GET /triggers/:id/history - Get history for a specific trigger
 */
triggersRoutes.get('/:id/history', pagination({ defaultLimit: 25, maxLimit: 200 }), async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');
  const { limit, offset } = c.get('pagination')!;
  const status = validateQueryEnum(c.req.query('status'), [
    'success',
    'failure',
    'skipped',
  ] as const);
  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;

  const service = getTriggerService();
  const trigger = await service.getTrigger(userId, id);

  if (!trigger) {
    return notFoundError(c, 'Trigger', id);
  }

  const { history, total } = await service.getHistoryForTrigger(userId, id, {
    status,
    from,
    to,
    limit,
    offset,
  });

  return apiResponse(c, {
    triggerId: id,
    triggerName: trigger.name,
    history,
    total,
    limit,
    offset,
  });
});

/**
 * POST /triggers/cleanup - Clean up old history
 */
triggersRoutes.post('/cleanup', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const body = await c.req
    .json<{ maxAgeDays?: number }>()
    .catch((): { maxAgeDays?: number } => ({}));

  const service = getTriggerService();
  let raw = body.maxAgeDays != null ? Number(body.maxAgeDays) : 30;
  if (!Number.isFinite(raw)) raw = 30;
  const maxAgeDays = Math.max(1, Math.min(MAX_DAYS_LOOKBACK, raw));
  const deleted = await service.cleanupHistory(userId, maxAgeDays);

  return apiResponse(c, {
    deletedCount: deleted,
    message: `Cleaned up ${deleted} old history entries.`,
  });
});

// ============================================================================
// Engine Control Routes
// ============================================================================

/**
 * GET /triggers/engine/status - Get engine status
 */
triggersRoutes.get('/engine/status', (c) => {
  const engine = getTriggerEngine();

  return apiResponse(c, {
    running: engine.isRunning(),
  });
});

/**
 * POST /triggers/engine/start - Start the trigger engine
 */
triggersRoutes.post('/engine/start', (c) => {
  const engine = getTriggerEngine();
  engine.start();

  return apiResponse(c, {
    running: engine.isRunning(),
    message: 'Trigger engine started.',
  });
});

/**
 * POST /triggers/engine/stop - Stop the trigger engine
 */
triggersRoutes.post('/engine/stop', (c) => {
  const engine = getTriggerEngine();
  engine.stop();

  return apiResponse(c, {
    running: engine.isRunning(),
    message: 'Trigger engine stopped.',
  });
});

// ============================================================================
// Natural Language Cron
// ============================================================================

/**
 * POST /triggers/from-natural-language - Create a schedule trigger from NL description
 */
triggersRoutes.post('/from-natural-language', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const rawBody = (await parseJsonBody<Record<string, unknown>>(c)) ?? {};

  if (
    !rawBody.description ||
    typeof rawBody.description !== 'string' ||
    rawBody.description.trim().length === 0
  ) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'description field is required' },
      400
    );
  }

  const { resolveDefaultProviderAndModel, getApiKey } = await import('../routes/settings.js');
  const { localProvidersRepo } = await import('../db/repositories/index.js');
  const { createProvider, getProviderConfig } = await import('@ownpilot/core');
  type AIProvider = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

  const NATIVE_PROVIDERS = new Set([
    'openai',
    'anthropic',
    'google',
    'deepseek',
    'groq',
    'mistral',
    'xai',
    'together',
    'fireworks',
    'perplexity',
  ]);

  const description = rawBody.description.trim();
  const actionType = rawBody.action_type ?? 'notification';
  const actionPayload = rawBody.action_payload ?? { message: `Trigger: ${description}` };
  const name = rawBody.name ?? description.substring(0, 50);
  const priority = rawBody.priority ?? 5;

  // Resolve provider
  const { provider, model } = await resolveDefaultProviderAndModel('default', 'default');
  if (!provider || !model) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'No AI provider configured' },
      400
    );
  }

  const localProv = await localProvidersRepo.getProvider(provider);
  const apiKey = localProv ? localProv.apiKey || 'local-no-key' : await getApiKey(provider);
  if (!apiKey) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: `API key not configured for: ${provider}` },
      400
    );
  }

  const providerConfig = getProviderConfig(provider);
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';
  const providerInstance = createProvider({
    id: provider,
    provider: providerType as AIProvider,
    apiKey,
    baseUrl: providerConfig?.baseUrl,
    headers: providerConfig?.headers,
  });

  const NL_CRON_PROMPT = `Convert this natural language schedule description into a valid cron expression.

Input: "${description}"

You MUST respond with ONLY a valid JSON object (no markdown, no explanation):
{"cron": "valid 5-field cron expression", "summary": "one sentence what this schedule does"}

Cron format: minute hour day month weekday
- minute: 0-59, hour: 0-23, day: 1-31, month: 1-12, weekday: 0-6 (0=Sunday)
- Use * for any, */n for every n, n-m for range, n,m for list
- Common patterns: "0 8 * * *" (daily 8AM), "0 9 * * 1-5" (weekdays 9AM), "*/15 * * * *" (every 15min), "0 20 * * *" (daily 8PM)

Examples:
- "every day at 9am" -> {"cron": "0 9 * * *", "summary": "Daily at 9am"}
- "weekday mornings" -> {"cron": "0 8 * * 1-5", "summary": "Weekday mornings at 8am"}
- "every hour" -> {"cron": "0 * * * *", "summary": "Hourly"}
- "every Monday at noon" -> {"cron": "0 12 * * 1", "summary": "Weekly on Monday at noon"}
- "every 30 minutes" -> {"cron": "*/30 * * * *", "summary": "Every 30 minutes"}`;

  try {
    const result = await providerInstance.complete({
      model: { model, maxTokens: 256, temperature: 0.3 },
      messages: [
        {
          role: 'system' as const,
          content: 'You are a cron expression expert. Respond with ONLY JSON.',
        },
        { role: 'user' as const, content: NL_CRON_PROMPT },
      ],
    });

    if (!result.ok || !result.value.content) {
      return apiError(
        c,
        { code: ERROR_CODES.EXECUTION_ERROR, message: 'AI failed to parse schedule' },
        500
      );
    }

    let responseText = result.value.content.trim();
    // Strip code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) responseText = jsonMatch[1]!;

    let parsed: { cron?: string; summary?: string };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return apiError(
        c,
        { code: ERROR_CODES.EXECUTION_ERROR, message: 'Invalid AI response format' },
        500
      );
    }

    if (!parsed.cron) {
      return apiError(
        c,
        { code: ERROR_CODES.EXECUTION_ERROR, message: 'AI did not return cron expression' },
        500
      );
    }

    const cronValidation = validateCronExpression(parsed.cron);
    if (!cronValidation.valid) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_CRON,
          message: `Invalid cron from AI: ${cronValidation.error}`,
        },
        400
      );
    }

    const { validateBody, createTriggerSchema } = await import('../middleware/validation.js');
    const triggerInput = validateBody(createTriggerSchema, {
      name,
      description: parsed.summary ?? description,
      type: 'schedule',
      config: { cron: parsed.cron },
      action_type: actionType,
      action_payload: actionPayload,
      enabled: true,
      priority,
    }) as unknown as CreateTriggerInput;

    const service = getTriggerService();
    const trigger = await service.createTrigger(userId, triggerInput);

    wsGateway.broadcast('data:changed', { entity: 'trigger', action: 'created', id: trigger.id });

    return apiResponse(c, {
      trigger,
      cron: parsed.cron,
      summary: parsed.summary,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to create trigger'),
      },
      500
    );
  }
});
