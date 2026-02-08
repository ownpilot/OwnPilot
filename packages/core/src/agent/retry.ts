/**
 * Retry Utility for AI Provider Calls
 *
 * Provides automatic retry with exponential backoff for transient failures.
 */

import type { Result } from '../types/result.js';
import { err } from '../types/result.js';
import { InternalError, TimeoutError } from '../types/errors.js';
import { getLog } from '../services/get-log.js';

const log = getLog('Retry');

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
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Timeout errors are retryable
  if (error instanceof TimeoutError) return true;

  // Check error message for common transient issues
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Network errors
  if (message.includes('network') || message.includes('econnreset') || message.includes('econnrefused')) {
    return true;
  }

  // Timeout patterns
  if (message.includes('timeout') || message.includes('timed out') || message.includes('operation timed out')) {
    return true;
  }

  // Rate limiting (should retry with backoff)
  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('429')) {
    return true;
  }

  // Server errors (5xx)
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true;
  }

  // Google specific errors
  if (message.includes('google request') && message.includes('failed')) {
    return true;
  }

  // Generic transient errors
  if (message.includes('temporarily unavailable') || message.includes('service unavailable')) {
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
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);
  }

  return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
        const delayMs = calculateDelay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier, addJitter);

        onRetry(attempt + 1, result.error, delayMs);
        log.info(`Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delayMs}ms...`);
        log.info(`Error: ${result.error instanceof Error ? result.error.message : String(result.error)}`);

        await sleep(delayMs);
        continue;
      }

      // Return result (success or non-retryable error)
      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt < maxRetries && retryableErrors(error)) {
        const delayMs = calculateDelay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier, addJitter);

        onRetry(attempt + 1, error, delayMs);
        log.info(`Attempt ${attempt + 1}/${maxRetries} threw exception, retrying in ${delayMs}ms...`);
        log.info(`Error: ${error instanceof Error ? error.message : String(error)}`);

        await sleep(delayMs);
        continue;
      }

      // Non-retryable error or max retries exceeded
      throw error;
    }
  }

  // Max retries exceeded
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  return err(new InternalError(`Max retries (${maxRetries}) exceeded. Last error: ${errorMessage}`));
}

/**
 * Create a retry wrapper for a provider method
 */
export function createRetryWrapper(config?: RetryConfig) {
  return <T, E extends Error>(operation: () => Promise<Result<T, E>>) => withRetry(operation, config);
}
