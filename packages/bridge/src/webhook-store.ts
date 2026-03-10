/**
 * Webhook Registration Store (In-Memory)
 *
 * Manages webhook configurations for push notifications.
 * Webhooks fire when blocking patterns (QUESTION, TASK_BLOCKED) are detected.
 *
 * Storage: in-memory Map — lost on bridge restart.
 * Production: consider persistent store (SQLite, Redis).
 */

import { randomUUID } from 'node:crypto';
import { logger } from './utils/logger.ts';

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string | null;       // HMAC-SHA256 signing key (null = no signing)
  events: string[];             // e.g. ['blocking'] — future: ['blocking', 'complete', 'error']
  createdAt: string;            // ISO 8601
}

export interface WebhookCreateInput {
  url: string;
  secret?: string;
  events?: string[];
}

const VALID_EVENTS = ['blocking'];
const MAX_WEBHOOKS = 20;        // Safety cap

class WebhookStore {
  private webhooks = new Map<string, WebhookConfig>();

  /**
   * Register a new webhook. Returns the created config with generated ID.
   */
  register(input: WebhookCreateInput): WebhookConfig {
    if (this.webhooks.size >= MAX_WEBHOOKS) {
      throw new Error(`Maximum webhook limit reached (${MAX_WEBHOOKS})`);
    }

    // Validate URL
    try {
      new URL(input.url);
    } catch {
      throw new Error(`Invalid webhook URL: ${input.url}`);
    }

    // Validate events
    const events = input.events ?? ['blocking'];
    for (const event of events) {
      if (!VALID_EVENTS.includes(event)) {
        throw new Error(`Invalid event type: ${event}. Valid: ${VALID_EVENTS.join(', ')}`);
      }
    }

    // Check for duplicate URL
    for (const existing of this.webhooks.values()) {
      if (existing.url === input.url) {
        throw new Error(`Webhook already registered for URL: ${input.url}`);
      }
    }

    const config: WebhookConfig = {
      id: randomUUID(),
      url: input.url,
      secret: input.secret ?? null,
      events,
      createdAt: new Date().toISOString(),
    };

    this.webhooks.set(config.id, config);
    logger.info({ webhookId: config.id, url: config.url, events }, 'Webhook registered');
    return config;
  }

  /**
   * List all registered webhooks.
   */
  list(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Get a specific webhook by ID.
   */
  get(id: string): WebhookConfig | null {
    return this.webhooks.get(id) ?? null;
  }

  /**
   * Delete a webhook by ID. Returns true if found and deleted.
   */
  delete(id: string): boolean {
    const existed = this.webhooks.has(id);
    if (existed) {
      this.webhooks.delete(id);
      logger.info({ webhookId: id }, 'Webhook deleted');
    }
    return existed;
  }

  /**
   * Get all webhooks subscribed to a specific event.
   */
  getByEvent(event: string): WebhookConfig[] {
    return Array.from(this.webhooks.values()).filter(
      (w) => w.events.includes(event),
    );
  }

  /**
   * Clear all webhooks (for testing).
   */
  clear(): void {
    this.webhooks.clear();
  }

  /**
   * Current count of registered webhooks.
   */
  get size(): number {
    return this.webhooks.size;
  }
}

// Singleton
export const webhookStore = new WebhookStore();
