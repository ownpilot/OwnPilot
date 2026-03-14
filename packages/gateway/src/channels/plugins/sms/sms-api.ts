/**
 * SMS Channel API (Twilio)
 *
 * Implements ChannelPluginAPI using the Twilio REST API directly (fetch-based).
 * No twilio npm package dependency — lightweight HTTP calls only.
 * Supports outbound SMS via Twilio Messages API and inbound via webhooks.
 */

import type {
  ChannelPluginAPI,
  ChannelConnectionStatus,
  ChannelOutgoingMessage,
  ChannelPlatform,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';

const log = getLog('SMS');

/** Maximum SMS body length (Twilio concatenates longer messages). */
const SMS_MAX_BODY_LENGTH = 1600;

export class SmsChannelAPI implements ChannelPluginAPI {
  private status: ChannelConnectionStatus = 'disconnected';
  private accountSid = '';
  private authToken = '';
  private fromNumber = '';

  readonly pluginId: string;

  constructor(
    private readonly config: Record<string, unknown>,
    pluginId: string,
  ) {
    this.pluginId = pluginId;
  }

  async connect(): Promise<void> {
    // Load credentials from config (passed by plugin init from Config Center)
    this.accountSid = String(this.config.account_sid ?? '');
    this.authToken = String(this.config.auth_token ?? '');
    this.fromNumber = String(this.config.from_number ?? '');

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      this.status = 'error';
      log.warn('SMS channel missing credentials — configure Twilio in Config Center');
      return;
    }

    // Validate credentials by checking account info
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}.json`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        this.status = 'error';
        log.error('Twilio credential validation failed', { status: res.status });
        return;
      }

      this.status = 'connected';
      log.info('SMS channel connected via Twilio', { fromNumber: this.fromNumber });
    } catch (error) {
      this.status = 'error';
      log.error('Failed to validate Twilio credentials', { error: String(error) });
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    log.info('SMS channel disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (this.status !== 'connected') {
      throw new Error('SMS channel not connected');
    }

    const toNumber = message.platformChatId; // E.164 phone number
    const body = message.text.slice(0, SMS_MAX_BODY_LENGTH);

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: toNumber,
            From: this.fromNumber,
            Body: body,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Twilio API error ${res.status}: ${errBody}`);
      }

      const data = (await res.json()) as { sid: string };
      log.info('SMS sent', { to: toNumber, sid: data.sid });
      return data.sid;
    } catch (error) {
      log.error('Failed to send SMS', { error: String(error), to: toNumber });
      throw error;
    }
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'sms';
  }

  async sendTyping(_platformChatId: string): Promise<void> {
    // SMS doesn't support typing indicators — no-op
  }

  /** Get Twilio auth info for webhook signature validation. */
  getAuthInfo(): { accountSid: string; authToken: string } {
    return { accountSid: this.accountSid, authToken: this.authToken };
  }
}
