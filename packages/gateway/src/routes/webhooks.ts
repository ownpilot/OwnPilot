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

// WhatsApp webhook routes removed — Baileys uses direct WebSocket connection, no webhooks needed.

/**
 * POST /webhooks/sms
 *
 * Receives inbound SMS messages from Twilio.
 * Validates X-Twilio-Signature and routes through the channel service pipeline.
 */
webhookRoutes.post('/sms', async (c) => {
  const { createSmsWebhookRoute } = await import('../channels/plugins/sms/webhook.js');
  const smsApp = createSmsWebhookRoute();
  return smsApp.fetch(c.req.raw);
});

/**
 * POST /webhooks/email/inbound
 *
 * Receives inbound emails via webhook (SendGrid Inbound Parse, Mailgun, or generic JSON).
 */
webhookRoutes.post('/email/inbound', async (c) => {
  try {
    let from = '';
    let to = '';
    let subject = '';
    let text = '';
    let messageId = '';
    let inReplyTo = '';

    const contentType = c.req.header('Content-Type') ?? '';

    if (contentType.includes('application/json')) {
      const body = (await c.req.json()) as Record<string, unknown>;
      from = String(body.from ?? '');
      to = String(body.to ?? '');
      subject = String(body.subject ?? '');
      text = String(body.text ?? body.body ?? '');
      messageId = String(body.messageId ?? body.message_id ?? '');
      inReplyTo = String(body.inReplyTo ?? body.in_reply_to ?? '');
    } else {
      const formData = await c.req.parseBody();
      from = String(formData.from ?? formData.sender ?? '');
      to = String(formData.to ?? formData.recipient ?? '');
      subject = String(formData.subject ?? '');
      text = String(formData.text ?? formData['stripped-text'] ?? '');
      messageId = String(formData['Message-Id'] ?? formData.message_id ?? '');
      inReplyTo = String(formData['In-Reply-To'] ?? '');
    }

    if (!from || !text.trim()) {
      return apiResponse(c, { status: 'ignored', message: 'Missing sender or empty body' });
    }

    const { processInboundEmail } = await import('../channels/plugins/email/webhook.js');
    processInboundEmail({ from, to, subject, text, messageId, inReplyTo }).catch((error) => {
      log.error('Failed to process inbound email', { error: getErrorMessage(error), from });
    });

    return apiResponse(c, { status: 'ok' });
  } catch (error) {
    log.error('Email webhook error', { error: getErrorMessage(error) });
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: 'Email webhook processing failed' },
      500
    );
  }
});

/**
 * POST /webhooks/slack/events
 *
 * Receives Slack Events API messages.
 * Handles URL verification challenge and message events.
 * Validates request signature via X-Slack-Signature header.
 */
webhookRoutes.post('/slack/events', async (c) => {
  const { getSlackWebhookHandler } = await import('../channels/plugins/slack/slack-api.js');
  const handler = getSlackWebhookHandler();

  try {
    const body = await c.req.json();

    // URL verification challenge (Slack sends this when configuring the events URL)
    if (body.type === 'url_verification') {
      return c.json({ challenge: body.challenge });
    }

    if (!handler) {
      return apiError(
        c,
        { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'Slack webhook not configured' },
        503
      );
    }

    // Signature validation
    const timestamp = c.req.header('x-slack-request-timestamp');
    const signature = c.req.header('x-slack-signature');
    if (timestamp && signature) {
      const rawBody = JSON.stringify(body);
      const sigBaseString = `v0:${timestamp}:${rawBody}`;
      const expected =
        'v0=' + createHmac('sha256', handler.signingSecret).update(sigBaseString).digest('hex');
      if (!safeKeyCompare(signature, expected)) {
        return apiError(
          c,
          { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid Slack signature' },
          403
        );
      }
    }

    // Process event
    if (body.event && body.event.type === 'message' && !body.event.subtype) {
      await handler.callback(body.event);
    }

    return c.text('OK', 200);
  } catch (error) {
    log.error('Slack webhook error:', error);
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
