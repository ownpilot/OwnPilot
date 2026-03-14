/**
 * SMS Webhook Handler (Twilio)
 *
 * Receives inbound SMS messages from Twilio via POST webhook.
 * Validates the X-Twilio-Signature header using HMAC-SHA1,
 * converts the payload to a ChannelIncomingMessage, and routes
 * it through the channel service pipeline.
 *
 * Twilio expects a quick TwiML response — actual reply goes
 * outbound via SmsChannelAPI.sendMessage(), not inline TwiML.
 */

import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ChannelIncomingMessage } from '@ownpilot/core';
import { getChannelService } from '@ownpilot/core';
import { getChannelServiceImpl } from '../../service-impl.js';
import type { SmsChannelAPI } from './sms-api.js';
import { getLog } from '../../../services/log.js';

const log = getLog('SMS-Webhook');

/** Empty TwiML response (we reply outbound, not inline). */
const EMPTY_TWIML = '<Response/>';

/**
 * Validate Twilio request signature (HMAC-SHA1).
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Build data string: URL + sorted param keys with their values concatenated
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  return expected === signature;
}

/**
 * Create a Hono sub-app for the SMS webhook endpoint.
 *
 * Mount this at `/webhooks/sms` in the main route tree, e.g.:
 * ```ts
 * app.route('/webhooks/sms', createSmsWebhookRoute());
 * ```
 */
export function createSmsWebhookRoute(): Hono {
  const app = new Hono();

  // Twilio sends POST with application/x-www-form-urlencoded body
  app.post('/', async (c) => {
    try {
      const channelService = getChannelService();
      const api = channelService.getChannel('channel.sms') as SmsChannelAPI | undefined;

      if (!api || api.getStatus() !== 'connected') {
        log.warn('SMS webhook received but channel not connected');
        c.header('Content-Type', 'text/xml');
        return c.body(EMPTY_TWIML, 200);
      }

      // Parse form-encoded body
      const formData = await c.req.parseBody();
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(formData)) {
        if (typeof value === 'string') {
          params[key] = value;
        }
      }

      // Validate Twilio signature (if auth token is available)
      const { authToken } = api.getAuthInfo();
      const twilioSignature = c.req.header('X-Twilio-Signature');

      if (authToken && twilioSignature) {
        // Reconstruct the full webhook URL for validation
        const protocol = c.req.header('X-Forwarded-Proto') ?? 'https';
        const host = c.req.header('X-Forwarded-Host') ?? c.req.header('Host') ?? '';
        const path = c.req.path;
        const webhookUrl = `${protocol}://${host}${path}`;

        if (!validateTwilioSignature(authToken, twilioSignature, webhookUrl, params)) {
          log.warn('Invalid Twilio signature', { url: webhookUrl });
          return c.text('Forbidden', 403);
        }
      }

      // Extract message data from Twilio webhook payload
      const from = params.From ?? '';
      const body = params.Body ?? '';
      const messageSid = params.MessageSid ?? randomUUID();
      const numMedia = parseInt(params.NumMedia ?? '0', 10);

      if (!body.trim() && numMedia === 0) {
        log.debug('Empty SMS ignored', { from });
        c.header('Content-Type', 'text/xml');
        return c.body(EMPTY_TWIML, 200);
      }

      const incomingMessage: ChannelIncomingMessage = {
        id: `channel.sms:${messageSid}`,
        channelPluginId: 'channel.sms',
        platform: 'sms',
        platformChatId: from, // phone number is the chat identifier
        sender: {
          platformUserId: from,
          platform: 'sms',
          displayName: from, // phone numbers don't have display names
        },
        text: body.trim(),
        timestamp: new Date(),
        metadata: {
          messageSid,
          to: params.To,
          fromCity: params.FromCity,
          fromState: params.FromState,
          fromCountry: params.FromCountry,
          numMedia,
        },
      };

      // Process through channel service pipeline
      const serviceImpl = getChannelServiceImpl();
      if (serviceImpl) {
        // Fire and forget — Twilio expects a quick response
        serviceImpl.processIncomingMessage(incomingMessage).catch((error) => {
          log.error('Failed to process SMS', { error: String(error), from });
        });
      } else {
        log.error('ChannelServiceImpl not available');
      }

      // Return empty TwiML (response goes outbound via sendMessage)
      c.header('Content-Type', 'text/xml');
      return c.body(EMPTY_TWIML, 200);
    } catch (error) {
      log.error('SMS webhook error', { error: String(error) });
      c.header('Content-Type', 'text/xml');
      return c.body(EMPTY_TWIML, 500);
    }
  });

  return app;
}
