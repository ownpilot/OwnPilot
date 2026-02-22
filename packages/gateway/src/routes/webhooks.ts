/**
 * Webhook Routes
 *
 * External webhook endpoints for channel integrations.
 * Mounted OUTSIDE the /api/v1 auth middleware since external
 * services (e.g. Telegram) cannot send API keys.
 */

import { Hono } from 'hono';
import { getLog } from '../services/log.js';
import { safeKeyCompare, apiError, ERROR_CODES } from './helpers.js';

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
