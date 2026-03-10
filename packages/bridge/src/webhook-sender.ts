/**
 * Webhook Delivery Engine
 *
 * Sends HTTP POST to registered webhook URLs when blocking patterns are detected.
 * Features:
 *   - HMAC-SHA256 payload signing (X-Bridge-Signature header)
 *   - Retry with exponential backoff (3 attempts: 1s, 4s, 16s)
 *   - 5s timeout per attempt
 *   - Deduplication: max 1 webhook per session per blocking event
 *   - Fire-and-forget: failures are logged, never block the session
 */

import { createHmac } from 'node:crypto';
import { logger } from './utils/logger.ts';
import { webhookStore, type WebhookConfig } from './webhook-store.ts';
import type { PendingApproval } from './types.ts';

export interface WebhookPayload {
  event: string;                  // e.g. 'session.blocking'
  conversationId: string;
  sessionId: string;
  pattern: string;                // 'QUESTION' | 'TASK_BLOCKED'
  text: string;                   // extracted question/blocker text
  timestamp: string;              // ISO 8601
  respondUrl: string;             // POST here to inject response
}

// Retry config (exported for test override)
export const RETRY_CONFIG = {
  maxRetries: 3,
  delaysMs: [1000, 4000, 16000], // exponential backoff
  timeoutMs: 5000,
};

// Deduplication: track recently fired webhooks to avoid duplicates
// Key: `${webhookId}:${sessionId}`, Value: timestamp
const recentFires = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000; // 1 minute dedup window

/** Cleanup interval period for the recentFires map (P1-2). */
export const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup: prevent unbounded growth of recentFires map (P1-2)
const _dedupCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentFires) {
    if (now - ts > DEDUP_WINDOW_MS) recentFires.delete(key);
  }
}, DEDUP_CLEANUP_INTERVAL_MS);
if (_dedupCleanupInterval.unref) _dedupCleanupInterval.unref();

/**
 * Generate HMAC-SHA256 signature for a webhook payload.
 */
export function signPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Send a single webhook with retry logic.
 * Returns true if delivered successfully, false if all retries failed.
 */
export async function deliverWebhook(
  config: WebhookConfig,
  payload: WebhookPayload,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const log = logger.child({ webhookId: config.id, url: config.url });
  const { maxRetries, delaysMs, timeoutMs } = RETRY_CONFIG;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = delaysMs[attempt - 1];
      log.info({ attempt: attempt + 1, delayMs: delay }, 'Retrying webhook delivery');
      await sleep(delay);
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenClaw-Bridge/1.0',
        'X-Bridge-Event': payload.event,
      };

      // HMAC signing if secret is configured
      if (config.secret) {
        headers['X-Bridge-Signature'] = signPayload(body, config.secret);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        log.info({ attempt: attempt + 1, status: response.status }, 'Webhook delivered successfully');
        return true;
      }

      log.warn(
        { attempt: attempt + 1, status: response.status, statusText: response.statusText },
        'Webhook delivery failed (non-2xx)',
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn({ attempt: attempt + 1, error: errMsg }, 'Webhook delivery error');
    }
  }

  log.error({ maxRetries }, 'Webhook delivery failed after all retries');
  return false;
}

/**
 * Fire webhooks for a blocking event. Called when pendingApproval is set.
 *
 * - Finds all webhooks subscribed to 'blocking' event
 * - Deduplicates: skips if same webhook+session was fired within DEDUP_WINDOW_MS
 * - Fires all matching webhooks concurrently (fire-and-forget)
 */
export function fireBlockingWebhooks(
  conversationId: string,
  sessionId: string,
  approval: PendingApproval,
  bridgeBaseUrl: string,
): void {
  const matchingWebhooks = webhookStore.getByEvent('blocking');
  if (matchingWebhooks.length === 0) return;

  const now = Date.now();

  // Clean up stale dedup entries
  for (const [key, ts] of recentFires) {
    if (now - ts > DEDUP_WINDOW_MS) recentFires.delete(key);
  }

  const payload: WebhookPayload = {
    event: 'session.blocking',
    conversationId,
    sessionId,
    pattern: approval.pattern,
    text: approval.text,
    timestamp: new Date(approval.detectedAt).toISOString(),
    respondUrl: `${bridgeBaseUrl}/v1/sessions/${sessionId}/respond`,
  };

  for (const webhook of matchingWebhooks) {
    const dedupKey = `${webhook.id}:${sessionId}`;
    if (recentFires.has(dedupKey)) {
      logger.debug({ webhookId: webhook.id, sessionId }, 'Skipping duplicate webhook fire');
      continue;
    }

    recentFires.set(dedupKey, now);

    // Fire-and-forget: don't await, don't block
    deliverWebhook(webhook, payload).catch((err) => {
      logger.error({ webhookId: webhook.id, err: String(err) }, 'Unhandled webhook delivery error');
    });
  }

  logger.info(
    { webhookCount: matchingWebhooks.length, conversationId, pattern: approval.pattern },
    'Blocking webhooks fired',
  );
}

/**
 * Clear dedup cache (for testing).
 */
export function clearDedup(): void {
  recentFires.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
