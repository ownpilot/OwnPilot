/**
 * Webhook Routes
 *
 * External webhook endpoints for channel integrations and workflow triggers.
 * Mounted OUTSIDE the /api/v1 auth middleware since external
 * services (e.g. Telegram) cannot send API keys.
 */

import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { getServiceRegistry, Services } from '@ownpilot/core';
import { getLog } from '../services/log.js';
import { safeKeyCompare, apiError, apiResponse, ERROR_CODES, getErrorMessage } from './helpers.js';
import { TriggersRepository, type WebhookConfig } from '../db/repositories/triggers.js';

const log = getLog('Webhooks');

export const webhookRoutes = new Hono();

/**
 * POST /webhooks/telegram/:secret
 *
 * Receives Telegram updates via webhook.
 * The :secret path segment provides authentication (timing-safe compare).
 */
webhookRoutes.post('/telegram/:secret', async (c) => {
  const secret = c.req.param('secret');

  // Dynamic import to avoid circular dependencies
  const { getWebhookHandler } = await import('../channels/plugins/telegram/webhook.js');
  const handler = getWebhookHandler();

  if (!handler) {
    return apiError(
      c,
      { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'Webhook not configured' },
      503
    );
  }

  // Timing-safe secret validation
  if (!safeKeyCompare(secret, handler.secret)) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid webhook secret' }, 403);
  }

  try {
    return await handler.callback(c.req.raw);
  } catch (error) {
    log.error('Telegram webhook callback error:', error);
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: 'Webhook processing failed' },
      500
    );
  }
});

/**
 * POST /webhooks/trigger/:triggerId
 *
 * Receives external webhook calls and fires the associated workflow trigger.
 * Validates HMAC-SHA256 signature via X-Webhook-Signature header if a secret is configured.
 * Payload is injected as workflow variables.
 */
webhookRoutes.post('/trigger/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');

  // Look up the trigger globally (cross-user: webhook triggers must be accessible without auth)
  const repo = new TriggersRepository();
  const trigger = await repo.getByIdGlobal(triggerId);

  if (!trigger || trigger.type !== 'webhook' || !trigger.enabled) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'Webhook trigger not found or disabled' },
      404
    );
  }

  // HMAC-SHA256 signature validation if secret is configured
  const config = trigger.config as WebhookConfig;
  if (config.secret) {
    const signature = c.req.header('x-webhook-signature');
    if (!signature) {
      return apiError(
        c,
        { code: ERROR_CODES.ACCESS_DENIED, message: 'Missing X-Webhook-Signature header' },
        403
      );
    }

    const rawBody = await c.req.text();
    const expected = createHmac('sha256', config.secret).update(rawBody).digest('hex');

    if (!safeKeyCompare(signature, expected)) {
      return apiError(
        c,
        { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid webhook signature' },
        403
      );
    }
  }

  // Extract payload from body
  let payload: Record<string, unknown> = {};
  try {
    payload = await c.req.json();
  } catch {
    // Non-JSON body is OK — just pass empty payload
  }

  // Fire the workflow via the trigger's action
  if (trigger.action?.type === 'workflow' && trigger.action.payload?.workflowId) {
    const workflowId = trigger.action.payload.workflowId as string;
    try {
      const service = getServiceRegistry().get(Services.Workflow);
      // Fire-and-forget: execute in background, don't block the webhook response
      service
        .executeWorkflow(workflowId, trigger.userId ?? 'default')
        .catch((err: Error) => log.error(`Webhook workflow execution failed: ${err.message}`));
    } catch (error) {
      log.error(`Webhook trigger fire failed: ${getErrorMessage(error)}`);
    }
  }

  return apiResponse(c, { message: 'Webhook received', triggerId });
});
