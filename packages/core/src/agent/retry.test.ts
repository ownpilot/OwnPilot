import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { isRetryableError, withRetry, createRetryWrapper } = await import('./retry.js');
const { TimeoutError, InternalError: _InternalError, ValidationError: _ValidationError } = await import('../types/errors.js');
const { ok, err } = await import('../types/result.js');

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {
  it('returns false for null', () => {
    expect(isRetryableError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('returns false for non-matching Error', () => {
    expect(isRetryableError(new Error('some random error'))).toBe(false);
  });

  it('returns true for TimeoutError instance', () => {
    expect(isRetryableError(new TimeoutError('request timed out'))).toBe(true);
  });

  it('returns true for Error with "network"', () => {
    expect(isRetryableError(new Error('network error occurred'))).toBe(true);
  });

  it('returns true for Error with "ECONNRESET"', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
  });

  it('returns true for Error with "ECONNREFUSED"', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('returns true for Error with "timeout"', () => {
    expect(isRetryableError(new Error('connection timeout'))).toBe(true);
  });

  it('returns true for Error with "timed out"', () => {
    expect(isRetryableError(new Error('operation timed out'))).toBe(true);
  });

  it('returns true for Error with "rate limit"', () => {
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('returns true for Error with "too many requests"', () => {
    expect(isRetryableError(new Error('too many requests'))).toBe(true);
  });

  it('returns true for Error with "429"', () => {
    expect(isRetryableError(new Error('HTTP 429'))).toBe(true);
  });

  it('returns true for Error with "500"', () => {
    expect(isRetryableError(new Error('HTTP 500 Internal Server Error'))).toBe(true);
  });

  it('returns true for Error with "502", "503", "504"', () => {
    expect(isRetryableError(new Error('HTTP 502 Bad Gateway'))).toBe(true);
    expect(isRetryableError(new Error('HTTP 503 Service Unavailable'))).toBe(true);
    expect(isRetryableError(new Error('HTTP 504 Gateway Timeout'))).toBe(true);
  });

  it('returns true for Error with "temporarily unavailable"', () => {
    expect(isRetryableError(new Error('service temporarily unavailable'))).toBe(true);
  });

  it('returns true for Error with "service unavailable"', () => {
    expect(isRetryableError(new Error('service unavailable'))).toBe(true);
  });

  it('returns true for Error with "Google request failed"', () => {
    expect(isRetryableError(new Error('Google request failed with status 500'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful first attempt', () => {
    it('returns ok result immediately without retrying', async () => {
      const operation = vi.fn().mockResolvedValue(ok('success'));

      const promise = withRetry(operation, { addJitter: false });
      const result = await promise;

      expect(result).toEqual(ok('success'));
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('does not call onRetry when first attempt succeeds', async () => {
      const onRetry = vi.fn();
      const operation = vi.fn().mockResolvedValue(ok('success'));

      const promise = withRetry(operation, { addJitter: false, onRetry });
      const result = await promise;

      expect(result).toEqual(ok('success'));
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('retries on retryable Result error', () => {
    it('retries and then succeeds', async () => {
      const retryableError = new Error('network error');
      const operation = vi
        .fn()
        .mockResolvedValueOnce(err(retryableError))
        .mockResolvedValueOnce(ok('recovered'));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        addJitter: false,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toEqual(ok('recovered'));
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('calls onRetry with attempt, error, and delay', async () => {
      const onRetry = vi.fn();
      const retryableError = new Error('timeout');
      const operation = vi
        .fn()
        .mockResolvedValueOnce(err(retryableError))
        .mockResolvedValueOnce(ok('recovered'));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        addJitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toEqual(ok('recovered'));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, retryableError, 100);
    });

    it('respects maxRetries and returns last error when exceeded', async () => {
      const retryableError = new Error('network error');
      const operation = vi.fn().mockResolvedValue(err(retryableError));

      const promise = withRetry(operation, {
        maxRetries: 2,
        initialDelayMs: 100,
        addJitter: false,
      });

      await vi.advanceTimersByTimeAsync(100); // first retry delay
      await vi.advanceTimersByTimeAsync(200); // second retry delay (100 * 2)
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('network error');
      }
      // 1 initial + 2 retries = 3
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('uses exponential backoff for retry delays', async () => {
      const onRetry = vi.fn();
      const retryableError = new Error('rate limit');
      const operation = vi
        .fn()
        .mockResolvedValueOnce(err(retryableError))
        .mockResolvedValueOnce(err(retryableError))
        .mockResolvedValueOnce(ok('recovered'));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        addJitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(100); // first retry: 100ms
      await vi.advanceTimersByTimeAsync(200); // second retry: 200ms
      const result = await promise;

      expect(result).toEqual(ok('recovered'));
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, retryableError, 100);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, retryableError, 200);
    });
  });

  describe('retries on thrown retryable error', () => {
    it('retries when operation throws retryable error, then succeeds', async () => {
      const retryableError = new Error('ECONNRESET');
      const operation = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce(ok('recovered'));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        addJitter: false,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toEqual(ok('recovered'));
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('throws non-retryable error immediately without retrying', async () => {
      const nonRetryableError = new Error('authentication failed');
      const operation = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(
        withRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 100,
          addJitter: false,
        }),
      ).rejects.toThrow(nonRetryableError);

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('re-throws after max retries for thrown retryable exceptions', async () => {
      const retryableError = new Error('ECONNRESET');
      const operation = vi.fn().mockRejectedValue(retryableError);

      let caughtError: unknown;
      const promise = withRetry(operation, {
        maxRetries: 1,
        initialDelayMs: 100,
        addJitter: false,
      }).catch((e: unknown) => {
        caughtError = e;
      });

      await vi.advanceTimersByTimeAsync(200);
      await promise;

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe('ECONNRESET');
      // 1 initial + 1 retry = 2 calls
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('max retries exceeded', () => {
    it('returns error result after max retries exceeded', async () => {
      const retryableError = new Error('502 Bad Gateway');
      const operation = vi.fn().mockResolvedValue(err(retryableError));

      const promise = withRetry(operation, {
        maxRetries: 1,
        initialDelayMs: 100,
        addJitter: false,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('502 Bad Gateway');
      }
      // 1 initial + 1 retry = 2 calls
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('error message includes last error details', async () => {
      const retryableError = new Error('service unavailable');
      const operation = vi.fn().mockResolvedValue(err(retryableError));

      const promise = withRetry(operation, {
        maxRetries: 2,
        initialDelayMs: 100,
        addJitter: false,
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('service unavailable');
      }
    });
  });

  describe('non-retryable errors', () => {
    it('returns non-retryable Result error immediately', async () => {
      const nonRetryableError = new Error('invalid input');
      const operation = vi.fn().mockResolvedValue(err(nonRetryableError));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        addJitter: false,
      });
      const result = await promise;

      expect(result).toEqual(err(nonRetryableError));
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('propagates thrown non-retryable error immediately', async () => {
      const nonRetryableError = new Error('some unknown error that is not retryable');
      const operation = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(
        withRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 100,
          addJitter: false,
        }),
      ).rejects.toThrow(nonRetryableError);

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom config', () => {
    it('uses custom retryableErrors function', async () => {
      const customError = new Error('custom-retryable');
      const operation = vi
        .fn()
        .mockResolvedValueOnce(err(customError))
        .mockResolvedValueOnce(ok('recovered'));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        addJitter: false,
        retryableErrors: (error) => error instanceof Error && error.message === 'custom-retryable',
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toEqual(ok('recovered'));
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('respects custom maxRetries', async () => {
      const retryableError = new Error('timeout');
      const operation = vi.fn().mockResolvedValue(err(retryableError));

      const promise = withRetry(operation, {
        maxRetries: 1,
        initialDelayMs: 100,
        addJitter: false,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.ok).toBe(false);
      // 1 initial + 1 retry = 2
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('does not retry when custom retryableErrors returns false', async () => {
      const error = new Error('timeout'); // normally retryable
      const operation = vi.fn().mockResolvedValue(err(error));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        addJitter: false,
        retryableErrors: () => false, // never retry
      });
      const result = await promise;

      expect(result).toEqual(err(error));
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('respects maxDelayMs cap on backoff', async () => {
      const onRetry = vi.fn();
      const retryableError = new Error('503');
      const operation = vi.fn().mockResolvedValue(err(retryableError));

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 600,
        backoffMultiplier: 2,
        addJitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(100_000);
      await promise;

      // attempt 1: 500*2^0 = 500 (under cap)
      // attempt 2: 500*2^1 = 1000 -> capped to 600
      // attempt 3: 500*2^2 = 2000 -> capped to 600
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 500);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 600);
      expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 600);
    });
  });

  describe('default config', () => {
    it('uses default config when none provided', async () => {
      const operation = vi.fn().mockResolvedValue(ok('done'));

      const result = await withRetry(operation);
      expect(result).toEqual(ok('done'));
    });
  });
});

// ---------------------------------------------------------------------------
// createRetryWrapper
// ---------------------------------------------------------------------------

describe('createRetryWrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a function that wraps operations with retry', async () => {
    const retryFn = createRetryWrapper({
      maxRetries: 2,
      initialDelayMs: 100,
      addJitter: false,
    });

    expect(typeof retryFn).toBe('function');

    const operation = vi.fn().mockResolvedValue(ok('success'));
    const result = await retryFn(operation);

    expect(result).toEqual(ok('success'));
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('passes config through to withRetry', async () => {
    const onRetry = vi.fn();
    const retryFn = createRetryWrapper({
      maxRetries: 1,
      initialDelayMs: 100,
      addJitter: false,
      onRetry,
    });

    const retryableError = new Error('network error');
    const operation = vi.fn().mockResolvedValue(err(retryableError));

    const promise = retryFn(operation);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
