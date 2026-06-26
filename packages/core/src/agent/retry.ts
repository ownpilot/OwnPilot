/**
 * Retry Utility for AI Provider Calls
 *
 * Provides automatic retry with exponential backoff for transient failures.
 */

import { randomInt } from 'node:crypto';
import type { Result } from '../types/result.js';
import { err } from '../types/result.js';
import { InternalError, TimeoutError } from '../types/errors.js';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';

const log = getLog('Retry');
const RANDOM_UNIT_SCALE = 1_000_000_000;

function randomUnit(): number {
  return randomInt(RANDOM_UNIT_SCALE) / RANDOM_UNIT_SCALE;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 10000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Whether to add jitter to delays (default: true) */
  addJitter?: boolean;
  /** Errors to retry on (default: timeout, network errors, 5xx) */
  retryableErrors?: (error: unknown) => boolean;
  /** Callback for each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  addJitter: true,
  retryableErrors: isRetryableError,
  onRetry: () => {},
};

/**
 * Check if an error is retryable
 */
/**
 * Extract an HTTP status code from a provider error message, but only when it
 * appears in a status-bearing context (e.g. "API error: 500", "HTTP 429",
 * "status code 503"). Returns the first such match, or null.
 *
 * Anchoring to the keyword context is the whole point: it ignores status-like
 * numbers that merely appear in the error *body* (e.g. a 400 saying "reduce to
 * 500 tokens"), so we don't retry — and re-bill — a non-idempotent LLM call on
 * a permanent 4xx. Providers format errors as "<name> API error: <status> - …"
 * / "<name> stream error: <status>…", so the status sits right after the
 * keyword and wins over any later number in the body.
 */
function extractHttpStatus(message: string): number | null {
  const match = message.match(
    /(?:api error|stream error|http|status(?:\s*code)?)\s*:?\s*(\d{3})\b/
  );
  return match ? Number(match[1]) : null;
}

export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Timeout errors are retryable
  if (error instanceof TimeoutError) return true;

  // Check error message for common transient issues
  const message = getErrorMessage(error).toLowerCase();

  // Unambiguous transient phrases — retryable regardless of any status code.
  if (
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('internal server error') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout')
  ) {
    return true;
  }

  // HTTP status: gate on the status the provider embedded, not a bare number
  // anywhere in the message. Only request-timeout / rate-limit / 5xx are safe
  // to retry; other 4xx are permanent and must NOT be retried (non-idempotent).
  const status = extractHttpStatus(message);
  if (status !== null) {
    return status === 408 || status === 429 || status >= 500;
  }

  // Google-specific transient signal without an explicit status code.
  if (message.includes('google request') && message.includes('failed')) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  addJitter: boolean
): number {
  // Exponential backoff: initialDelay * multiplier^attempt
  let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs);

  // Add jitter (±25%)
  if (addJitter) {
    const jitter = delay * 0.25 * (randomUnit() * 2 - 1);
    delay = Math.max(0, delay + jitter);
  }

  return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry on failure
 */
export async function withRetry<T>(
  operation: () => Promise<Result<T, Error>>,
  config?: RetryConfig
): Promise<Result<T, Error>> {
  const {
    maxRetries,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier,
    addJitter,
    retryableErrors,
    onRetry,
  } = { ...DEFAULT_CONFIG, ...config };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      // Check if result is an error that should be retried
      if (!result.ok && attempt < maxRetries && retryableErrors(result.error)) {
        lastError = result.error;
        const delayMs = calculateDelay(
          attempt,
          initialDelayMs,
          maxDelayMs,
          backoffMultiplier,
          addJitter
        );

        onRetry(attempt + 1, result.error, delayMs);
        log.info(`Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delayMs}ms...`);
        log.info(`Error: ${getErrorMessage(result.error)}`);

        await sleep(delayMs);
        continue;
      }

      // Return result (success or non-retryable error)
      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt < maxRetries && retryableErrors(error)) {
        const delayMs = calculateDelay(
          attempt,
          initialDelayMs,
          maxDelayMs,
          backoffMultiplier,
          addJitter
        );

        onRetry(attempt + 1, error, delayMs);
        log.info(
          `Attempt ${attempt + 1}/${maxRetries} threw exception, retrying in ${delayMs}ms...`
        );
        log.info(`Error: ${getErrorMessage(error)}`);

        await sleep(delayMs);
        continue;
      }

      // Non-retryable error or max retries exceeded
      throw error;
    }
  }

  // Max retries exceeded
  const errorMessage = getErrorMessage(lastError);
  return err(
    new InternalError(`Max retries (${maxRetries}) exceeded. Last error: ${errorMessage}`)
  );
}
