/**
 * Telegram Webhook Handler (singleton)
 *
 * Holds the Grammy webhookCallback and secret for the active webhook.
 * Registered by TelegramChannelAPI.connect() in webhook mode,
 * consumed by the /webhooks/telegram/:secret route.
 */

import { webhookCallback, type Bot } from 'grammy';

export interface WebhookHandler {
  secret: string;
  callback: (req: Request) => Promise<Response>;
}

let handler: WebhookHandler | null = null;

/**
 * Register a webhook handler for the Telegram bot.
 * Overwrites any existing handler.
 */
export function registerWebhookHandler(bot: Bot, secret: string): void {
  handler = {
    secret,
    callback: webhookCallback(bot, 'std/http'),
  };
}

/**
 * Unregister the active webhook handler (cleanup on disconnect/shutdown).
 */
export function unregisterWebhookHandler(): void {
  handler = null;
}

/**
 * Get the active webhook handler, or null if not in webhook mode.
 */
export function getWebhookHandler(): WebhookHandler | null {
  return handler;
}
