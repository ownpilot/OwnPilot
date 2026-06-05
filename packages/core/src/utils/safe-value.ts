/**
 * Safe Value Utilities
 *
 * Guards against NaN, Infinity, negative values in cost/duration calculations.
 */

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

export function safeCost(cost: unknown): number {
  return safeNumber(cost, 0);
}

export function safeDuration(durationMs: unknown): number {
  return Math.floor(safeNumber(durationMs, 0));
}

interface BackoffOptions {
  baseDelayMs?: number;
  multiplier?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
}

const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  baseDelayMs: 1_000,
  multiplier: 2.0,
  maxDelayMs: 120_000,
  jitterFactor: 0.1,
};

export function calculateBackoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const cfg = { ...DEFAULT_BACKOFF, ...opts };
  const attemptIdx = Math.max(0, Math.floor(attempt));

  const exponentialDelay = cfg.baseDelayMs * Math.pow(cfg.multiplier, attemptIdx);
  const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);

  const jitterRange = cappedDelay * cfg.jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(Math.max(0, cappedDelay + jitter));
}
