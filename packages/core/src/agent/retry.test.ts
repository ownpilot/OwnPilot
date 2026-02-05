/**
 * Tests for retry utility — isRetryableError, withRetry, createRetryWrapper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRetryableError, withRetry, createRetryWrapper } from './retry.js';
import { TimeoutError } from '../types/errors.js';
import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a quick Error with a given message */
const mkError = (msg: string) => new Error(msg);

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {
  // --- falsy / non-retryable ---
  it('should return false for null', () => {
    expect(isRetryableError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('should return false for empty string (falsy)', () => {
    expect(isRetryableError('')).toBe(false);
  });

  it('should return false for 0 (falsy)', () => {
    expect(isRetryableError(0)).toBe(false);
  });

  it('should return false for false (falsy)', () => {
    expect(isRetryableError(false)).toBe(false);
  });

  // --- TimeoutError ---
  it('should return true for TimeoutError instance', () => {
    expect(isRetryableError(new TimeoutError('op', 5000))).toBe(true);
  });

  // --- network errors ---
  it('should return true for "network error"', () => {
    expect(isRetryableError(mkError('network error'))).toBe(true);
  });

  it('should return true for ECONNRESET', () => {
    expect(isRetryableError(mkError('read ECONNRESET'))).toBe(true);
  });

  it('should return true for ECONNREFUSED', () => {
    expect(isRetryableError(mkError('connect ECONNREFUSED 127.0.0.1:3000'))).toBe(true);
  });

  // --- timeout patterns ---
  it('should return true for "timeout"', () => {
    expect(isRetryableError(mkError('Request timeout'))).toBe(true);
  });

  it('should return true for "timed out"', () => {
    expect(isRetryableError(mkError('Connection timed out'))).toBe(true);
  });

  it('should return true for "operation timed out"', () => {
    expect(isRetryableError(mkError('operation timed out after 30s'))).toBe(true);
  });

  // --- rate limiting ---
  it('should return true for "rate limit"', () => {
    expect(isRetryableError(mkError('rate limit exceeded'))).toBe(true);
  });

  it('should return true for "too many requests"', () => {
    expect(isRetryableError(mkError('Too Many Requests'))).toBe(true);
  });

  it('should return true for "429"', () => {
    expect(isRetryableError(mkError('HTTP 429'))).toBe(true);
  });

  // --- server errors ---
  it('should return true for "500"', () => {
    expect(isRetryableError(mkError('HTTP 500 Internal Server Error'))).toBe(true);
  });

  it('should return true for "502"', () => {
    expect(isRetryableError(mkError('502 Bad Gateway'))).toBe(true);
  });

  it('should return true for "503"', () => {
    expect(isRetryableError(mkError('503 Service Unavailable'))).toBe(true);
  });

  it('should return true for "504"', () => {
    expect(isRetryableError(mkError('504 Gateway Timeout'))).toBe(true);
  });

  // --- Google errors ---
  it('should return true for Google request failed', () => {
    expect(isRetryableError(mkError('Google request to generativeai failed'))).toBe(true);
  });

  // --- transient ---
  it('should return true for "temporarily unavailable"', () => {
    expect(isRetryableError(mkError('Service temporarily unavailable'))).toBe(true);
  });

  it('should return true for "service unavailable"', () => {
    expect(isRetryableError(mkError('service unavailable, try again later'))).toBe(true);
  });

  // --- non-retryable ---
  it('should return false for "invalid input"', () => {
    expect(isRetryableError(mkError('invalid input'))).toBe(false);
  });

  it('should return false for "not found"', () => {
    expect(isRetryableError(mkError('not found'))).toBe(false);
  });

  it('should return false for "authentication failed"', () => {
    expect(isRetryableError(mkError('authentication failed'))).toBe(false);
  });

  it('should return false for generic error without retryable pattern', () => {
    expect(isRetryableError(mkError('something weird happened'))).toBe(false);
  });

  // --- case insensitive ---
  it('should match case-insensitively (NETWORK ERROR)', () => {
    expect(isRetryableError(mkError('NETWORK ERROR'))).toBe(true);
  });

  it('should match case-insensitively (Rate Limit)', () => {
    expect(isRetryableError(mkError('Rate Limit Exceeded'))).toBe(true);
  });

  // --- string errors (not Error instances) ---
  it('should handle plain string as error value', () => {
    expect(isRetryableError('network error')).toBe(true);
  });

  it('should handle non-retryable plain string', () => {
    expect(isRetryableError('something else')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Deterministic jitter — remove randomness
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor = 0
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Advance all pending timers so sleep() resolves */
  async function flushTimers() {
    // Run all micro-tasks then advance timers
    await vi.advanceTimersByTimeAsync(100_000);
  }

  it('should return result on first success', async () => {
    const op = vi.fn().mockResolvedValue(ok('hello'));

    const result = await withRetry(op, { maxRetries: 3, addJitter: false, initialDelayMs: 10 });

    expect(result).toEqual(ok('hello'));
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable Result error and eventually succeed', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValueOnce(err(mkError('503 Service Unavailable')))
      .mockResolvedValueOnce(err(mkError('503 Service Unavailable')))
      .mockResolvedValueOnce(ok('recovered'));

    const promise = withRetry(op, { maxRetries: 3, initialDelayMs: 10, addJitter: false });

    // Flush timers repeatedly to let sleep() resolve between retries
    await flushTimers();

    const result = await promise;
    expect(result).toEqual(ok('recovered'));
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('should return the last error result after max retries exceeded for Result errors', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValue(err(mkError('503 unavailable')));

    const promise = withRetry(op, { maxRetries: 2, initialDelayMs: 10, addJitter: false });
    await flushTimers();

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // On the final attempt, the error is returned as-is (not wrapped in InternalError)
      // because the loop returns the result directly when attempt === maxRetries.
      expect(result.error.message).toBe('503 unavailable');
    }
    // 1 initial + 2 retries = 3 calls
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('should call onRetry with attempt number, error, and delay', async () => {
    const onRetry = vi.fn();
    const retryError = mkError('ECONNRESET');
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValueOnce(err(retryError))
      .mockResolvedValueOnce(ok('ok'));

    const promise = withRetry(op, {
      maxRetries: 3,
      initialDelayMs: 100,
      addJitter: false,
      onRetry,
    });

    await flushTimers();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, retryError, expect.any(Number));
  });

  it('should respect maxRetries config', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValue(err(mkError('timeout')));

    const promise = withRetry(op, { maxRetries: 1, initialDelayMs: 10, addJitter: false });
    await flushTimers();

    const result = await promise;
    expect(result.ok).toBe(false);
    // 1 initial + 1 retry = 2 calls total
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-retryable Result errors', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValue(err(mkError('invalid input')));

    const result = await withRetry(op, { maxRetries: 3, initialDelayMs: 10, addJitter: false });

    // Non-retryable error should be returned immediately
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('invalid input');
    }
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should handle thrown retryable exceptions', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockRejectedValueOnce(mkError('ECONNREFUSED'))
      .mockResolvedValueOnce(ok('recovered'));

    const promise = withRetry(op, { maxRetries: 3, initialDelayMs: 10, addJitter: false });
    await flushTimers();

    const result = await promise;
    expect(result).toEqual(ok('recovered'));
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('should re-throw non-retryable thrown exceptions', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockRejectedValue(mkError('authentication failed'));

    await expect(
      withRetry(op, { maxRetries: 3, initialDelayMs: 10, addJitter: false }),
    ).rejects.toThrow('authentication failed');

    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should re-throw after max retries for thrown retryable exceptions', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockRejectedValue(mkError('ECONNRESET'));

    let caughtError: unknown;
    const promise = withRetry(op, { maxRetries: 1, initialDelayMs: 10, addJitter: false })
      .catch((e: unknown) => { caughtError = e; });

    await flushTimers();
    await promise;

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('ECONNRESET');
    // 1 initial + 1 retry = 2 calls
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('should use exponential backoff delays', async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValue(err(mkError('503')));

    const promise = withRetry(op, {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 100_000,
      backoffMultiplier: 2,
      addJitter: false,
      onRetry,
    });

    await flushTimers();
    await promise;

    // Attempts 1, 2, 3 with delays 100*2^0=100, 100*2^1=200, 100*2^2=400
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 100);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 200);
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 400);
  });

  it('should respect maxDelayMs cap', async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValue(err(mkError('503')));

    const promise = withRetry(op, {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 600,
      backoffMultiplier: 2,
      addJitter: false,
      onRetry,
    });

    await flushTimers();
    await promise;

    // attempt 0: 500*2^0 = 500 (under cap)
    // attempt 1: 500*2^1 = 1000 -> capped to 600
    // attempt 2: 500*2^2 = 2000 -> capped to 600
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 500);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 600);
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 600);
  });

  it('should use default config when none provided', async () => {
    const op = vi.fn().mockResolvedValue(ok('done'));

    const result = await withRetry(op);
    expect(result).toEqual(ok('done'));
  });

  it('should allow custom retryableErrors predicate', async () => {
    const customRetryable = (e: unknown) =>
      e instanceof Error && e.message === 'custom-retry';

    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValueOnce(err(mkError('custom-retry')))
      .mockResolvedValueOnce(ok('done'));

    const promise = withRetry(op, {
      maxRetries: 3,
      initialDelayMs: 10,
      addJitter: false,
      retryableErrors: customRetryable,
    });

    await flushTimers();
    const result = await promise;
    expect(result).toEqual(ok('done'));
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('should log retry messages to console', async () => {
    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValueOnce(err(mkError('timeout')))
      .mockResolvedValueOnce(ok('done'));

    const promise = withRetry(op, { maxRetries: 2, initialDelayMs: 10, addJitter: false });
    await flushTimers();
    await promise;

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Retry]'));
  });
});

// ---------------------------------------------------------------------------
// createRetryWrapper
// ---------------------------------------------------------------------------

describe('createRetryWrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return a function', () => {
    const wrapper = createRetryWrapper();
    expect(typeof wrapper).toBe('function');
  });

  it('should wrap operations with retry using provided config', async () => {
    const onRetry = vi.fn();
    const wrapper = createRetryWrapper({
      maxRetries: 1,
      initialDelayMs: 10,
      addJitter: false,
      onRetry,
    });

    const op = vi
      .fn<() => Promise<Result<string, Error>>>()
      .mockResolvedValueOnce(err(mkError('503')))
      .mockResolvedValueOnce(ok('ok'));

    const promise = wrapper(op);
    await vi.advanceTimersByTimeAsync(100_000);
    const result = await promise;

    expect(result).toEqual(ok('ok'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should pass default config when none given', async () => {
    const wrapper = createRetryWrapper();
    const op = vi.fn().mockResolvedValue(ok('done'));
    const result = await wrapper(op);
    expect(result).toEqual(ok('done'));
  });
});
