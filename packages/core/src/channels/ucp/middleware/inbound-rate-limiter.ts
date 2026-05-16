/**
 * UCP Inbound Rate Limiter Middleware
 *
 * Per-sender inbound rate limiting using a sliding window counter.
 * When a single user (identified by sender.id on a given channel) exceeds
 * the threshold, subsequent messages are rejected by throwing — the caller
 * (service-impl.processIncomingMessage) catches the error so neither the
 * agent pipeline nor the reply path runs (no flood amplification).
 *
 * Outbound messages pass through untouched; pair this with the existing
 * outbound rateLimiter for full coverage.
 */

export class InboundRateLimitError extends Error {
  readonly code = 'INBOUND_RATE_LIMIT_EXCEEDED';
  constructor(
    public readonly channelInstanceId: string,
    public readonly platformUserId: string,
    public readonly limit: number,
    public readonly windowMs: number
  ) {
    super(
      `Inbound rate limit exceeded for ${platformUserId} on ${channelInstanceId}: ` +
        `${limit} messages per ${windowMs}ms`
    );
    this.name = 'InboundRateLimitError';
  }
}

import type { UCPMiddleware } from './types.js';

interface MinimalLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

export interface InboundRateLimiterConfig {
  /** Maximum messages per window per sender. Default: 20. */
  maxMessages?: number;
  /** Window duration in milliseconds. Default: 60000 (1 min). */
  windowMs?: number;
  /** Optional logger for drop notices. */
  logger?: MinimalLogger;
  /** Hard cap on tracked sender entries (LRU eviction). Default: 10000. */
  maxTrackedSenders?: number;
}

interface WindowEntry {
  timestamps: number[];
}

/**
 * Create an inbound rate limiter middleware.
 *
 * Keys windows by `${channelInstanceId}::${platformUserId}` so the same user
 * messaging across two of your channel accounts is counted separately.
 *
 * Behavior on flood: drops silently (no next() call, no reply). The first
 * over-limit hit is logged as a warning, subsequent drops in the same window
 * are silent to avoid log spam.
 */
export function inboundRateLimiter(config: InboundRateLimiterConfig = {}): UCPMiddleware {
  const maxMessages = config.maxMessages ?? 20;
  const windowMs = config.windowMs ?? 60_000;
  const maxTrackedSenders = config.maxTrackedSenders ?? 10_000;
  const log = config.logger;
  const windows = new Map<string, WindowEntry>();
  const recentlyWarned = new Set<string>();

  return async (msg, next) => {
    if (msg.direction !== 'inbound') {
      return next();
    }

    const senderId = msg.sender?.id;
    if (!senderId) {
      // Cannot identify sender — let it through (don't penalize unknown shapes).
      return next();
    }

    const key = `${msg.channelInstanceId}::${senderId}`;
    const now = Date.now();

    let entry = windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      windows.set(key, entry);
      if (windows.size > maxTrackedSenders) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined && oldest !== key) windows.delete(oldest);
      }
    }

    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxMessages) {
      if (!recentlyWarned.has(key)) {
        log?.warn?.('Inbound message rejected: sender exceeded rate limit', {
          channelInstanceId: msg.channelInstanceId,
          platformUserId: senderId,
          limit: maxMessages,
          windowMs,
        });
        recentlyWarned.add(key);
        const timer = setTimeout(() => recentlyWarned.delete(key), windowMs);
        timer.unref?.();
      }
      throw new InboundRateLimitError(msg.channelInstanceId, senderId, maxMessages, windowMs);
    }

    entry.timestamps.push(now);
    return next();
  };
}
