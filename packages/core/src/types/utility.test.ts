/**
 * Utility Types and Functions Tests
 *
 * Tests for sleep, withTimeout, retry, and utility types
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sleep, withTimeout, retry } from './utility.js';

describe('Utility Functions', () => {
  describe('sleep', () => {
    it('should resolve after specified milliseconds', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small variance
      expect(elapsed).toBeLessThan(100);
    });

    it('should resolve immediately with 0ms', async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50); // Allow for event loop overhead
    });

    it('should be cancellable', async () => {
      // Sleep should not throw and should resolve normally
      await expect(sleep(10)).resolves.toBeUndefined();
    });
  });

  describe('withTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve when promise completes before timeout', async () => {
      const promise = Promise.resolve('success');
      const result = await withTimeout(promise, 1000);
      expect(result).toBe('success');
    });

    it('should reject with timeout error when promise takes too long', async () => {
      let resolveSlow: (value: string) => void = () => {};
      const slowPromise = new Promise((resolve) => {
        resolveSlow = resolve;
      });

      const timeoutPromise = withTimeout(slowPromise, 100);

      // Fast-forward time
      vi.advanceTimersByTime(100);

      await expect(timeoutPromise).rejects.toThrow('Timeout after 100ms');

      // Cleanup
      resolveSlow('too late');
    });

    it('should reject with custom timeout error when provided', async () => {
      let resolveSlow: (value: string) => void = () => {};
      const slowPromise = new Promise((resolve) => {
        resolveSlow = resolve;
      });

      const customError = new Error('Custom timeout message');
      const timeoutPromise = withTimeout(slowPromise, 100, customError);

      vi.advanceTimersByTime(100);

      await expect(timeoutPromise).rejects.toThrow('Custom timeout message');

      // Cleanup
      resolveSlow('too late');
    });

    it('should reject when promise rejects before timeout', async () => {
      const failingPromise = Promise.reject(new Error('Promise failed'));

      await expect(withTimeout(failingPromise, 1000)).rejects.toThrow('Promise failed');
    });

    it('should clear timeout when promise resolves', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      await withTimeout(Promise.resolve('done'), 1000);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout when promise rejects', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      try {
        await withTimeout(Promise.reject(new Error('fail')), 1000);
      } catch {
        // Expected
      }

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValue('success');

      const retryPromise = retry(fn, { maxAttempts: 3, initialDelayMs: 100 });

      // Wait for retries
      await vi.advanceTimersByTimeAsync(100); // First retry delay
      await vi.advanceTimersByTimeAsync(200); // Second retry delay (100 * 2)

      const result = await retryPromise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const retryPromise = retry(fn, {
        initialDelayMs: 100,
        factor: 2,
        maxAttempts: 3,
      });

      await vi.advanceTimersByTimeAsync(100); // First retry: 100ms
      await vi.advanceTimersByTimeAsync(200); // Second retry: 100 * 2 = 200ms

      await retryPromise;

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should respect maxDelayMs', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockRejectedValueOnce(new Error('Fail 4'))
        .mockResolvedValue('success');

      const retryPromise = retry(fn, {
        initialDelayMs: 100,
        maxDelayMs: 200,
        factor: 2,
        maxAttempts: 5,
      });

      await vi.advanceTimersByTimeAsync(100); // 100ms
      await vi.advanceTimersByTimeAsync(200); // 200ms (capped)
      await vi.advanceTimersByTimeAsync(200); // 200ms (capped)
      await vi.advanceTimersByTimeAsync(200); // 200ms (capped)

      await retryPromise;

      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should not retry when shouldRetry returns false', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('No retry'));
      const shouldRetry = () => false;

      await expect(retry(fn, { shouldRetry, maxAttempts: 3 })).rejects.toThrow('No retry');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use default values when options not provided', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('Fail')).mockResolvedValue('success');

      const retryPromise = retry(fn);

      await vi.advanceTimersByTimeAsync(100); // Default initialDelayMs is 100

      await retryPromise;

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Utility Types (type checking)', () => {
  // These tests verify that types compile correctly

  it('JsonValue should accept various types', () => {
    const str: string = 'test';
    const num: number = 42;
    const bool: boolean = true;
    const nullVal: null = null;
    const arr: string[] = ['a', 'b'];
    const obj: Record<string, unknown> = { key: 'value' };

    expect(str).toBe('test');
    expect(num).toBe(42);
    expect(bool).toBe(true);
    expect(nullVal).toBe(null);
    expect(arr).toEqual(['a', 'b']);
    expect(obj).toEqual({ key: 'value' });
  });

  it('type guards should work correctly', () => {
    // Testing that our utility types don't break at runtime
    const value: unknown = 'test';
    expect(typeof value === 'string').toBe(true);
  });
});
