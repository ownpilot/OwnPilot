/**
 * Tests for safe-value.ts
 *
 * Covers all exported functions:
 * - safeCost: various number inputs (valid, NaN, Infinity, negative, non-number)
 * - safeDuration: similar to safeCost with Math.floor
 * - calculateBackoffDelay: delay calculation with multiplier, max, jitter
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const { safeCost, safeDuration, calculateBackoffDelay } = await import('./safe-value.js');

// ============================================================================
// safeCost
// ============================================================================

describe('safeCost', () => {
  it('returns the number when given a valid positive number', () => {
    expect(safeCost(0.005)).toBe(0.005);
  });

  it('returns 0 when given 0', () => {
    expect(safeCost(0)).toBe(0);
  });

  it('returns 0 when given a negative number', () => {
    expect(safeCost(-1)).toBe(0);
  });

  it('returns 0 when given NaN', () => {
    expect(safeCost(NaN)).toBe(0);
  });

  it('returns 0 when given Infinity', () => {
    expect(safeCost(Infinity)).toBe(0);
  });

  it('returns 0 when given -Infinity', () => {
    expect(safeCost(-Infinity)).toBe(0);
  });

  it('returns 0 when given a string', () => {
    expect(safeCost('0.05')).toBe(0);
  });

  it('returns 0 when given null', () => {
    expect(safeCost(null)).toBe(0);
  });

  it('returns 0 when given undefined', () => {
    expect(safeCost(undefined)).toBe(0);
  });

  it('returns 0 when given an object', () => {
    expect(safeCost({})).toBe(0);
  });

  it('handles very large valid numbers', () => {
    expect(safeCost(999999.99)).toBe(999999.99);
  });
});

// ============================================================================
// safeDuration
// ============================================================================

describe('safeDuration', () => {
  it('returns floored value for valid positive number', () => {
    expect(safeDuration(100.7)).toBe(100);
  });

  it('returns 0 when given 0', () => {
    expect(safeDuration(0)).toBe(0);
  });

  it('returns 0 when given a negative number', () => {
    expect(safeDuration(-100)).toBe(0);
  });

  it('returns 0 when given NaN', () => {
    expect(safeDuration(NaN)).toBe(0);
  });

  it('returns 0 when given Infinity', () => {
    expect(safeDuration(Infinity)).toBe(0);
  });

  it('returns 0 when given -Infinity', () => {
    expect(safeDuration(-Infinity)).toBe(0);
  });

  it('returns 0 when given a string', () => {
    expect(safeDuration('500')).toBe(0);
  });

  it('returns 0 when given null', () => {
    expect(safeDuration(null)).toBe(0);
  });

  it('returns integer value for whole number input', () => {
    expect(safeDuration(500)).toBe(500);
  });

  it('floors fractional milliseconds', () => {
    expect(safeDuration(0.999)).toBe(0);
    expect(safeDuration(1.001)).toBe(1);
    expect(safeDuration(42.999)).toBe(42);
  });
});

// ============================================================================
// calculateBackoffDelay
// ============================================================================

describe('calculateBackoffDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns base delay for attempt 0', () => {
    // With jitter 0, we can predict the exact value
    const delay = calculateBackoffDelay(0, { jitterFactor: 0 });
    expect(delay).toBe(1000); // baseDelayMs = 1000
  });

  it('returns base * multiplier^1 for attempt 1', () => {
    const delay = calculateBackoffDelay(1, { jitterFactor: 0 });
    // attemptIdx = Math.max(0, Math.floor(1)) = 1 → 1000 * 2^1 = 2000
    expect(delay).toBe(2000);
  });

  it('doubles on each attempt (jitter disabled)', () => {
    const delays = [0, 1, 2, 3].map((a) => calculateBackoffDelay(a, { jitterFactor: 0 }));
    // attempt 0: 1000 * 2^0 = 1000
    // attempt 1: 1000 * 2^1 = 2000 (wait, Math.max(0, Math.floor(attempt)) = 1 for attempt=1)
    // Actually let me re-read:
    // const attemptIdx = Math.max(0, Math.floor(attempt));
    // const exponentialDelay = cfg.baseDelayMs * Math.pow(cfg.multiplier, attemptIdx);
    // For attempt=0: Math.max(0, 0) = 0 → 1000 * 2^0 = 1000
    // For attempt=1: Math.max(0, 1) = 1 → 1000 * 2^1 = 2000
    // For attempt=2: Math.max(0, 2) = 2 → 1000 * 2^2 = 4000
    // For attempt=3: Math.max(0, 3) = 3 → 1000 * 2^3 = 8000
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('respects maxDelayMs cap', () => {
    const delay = calculateBackoffDelay(10, { maxDelayMs: 5000, jitterFactor: 0 });
    expect(delay).toBeLessThanOrEqual(5000);
    expect(delay).toBe(5000);
  });

  it('applies jitter within expected range', () => {
    // With jitterFactor 0.5, the jitter can be up to ±50% of the delay
    // Run multiple times to ensure jitter varies
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(calculateBackoffDelay(1, { jitterFactor: 0.5, baseDelayMs: 1000 }));
    }
    // With jitter, we should see more than 1 unique value
    expect(delays.size).toBeGreaterThan(1);
    // All values should be within ±50% of 2000 (base * 2^1)
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(1000); // 2000 - 50% = 1000
      expect(d).toBeLessThanOrEqual(3000); // 2000 + 50% = 3000
    }
  });

  it('handles negative attempt by treating as 0', () => {
    const delayNeg = calculateBackoffDelay(-5, { jitterFactor: 0 });
    const delayZero = calculateBackoffDelay(0, { jitterFactor: 0 });
    expect(delayNeg).toBe(delayZero);
  });

  it('handles fractional attempt by flooring', () => {
    const delayFloor = calculateBackoffDelay(1.9, { jitterFactor: 0 });
    const delayInt = calculateBackoffDelay(1, { jitterFactor: 0 });
    expect(delayFloor).toBe(delayInt);
  });

  it('uses custom baseDelayMs', () => {
    const delay = calculateBackoffDelay(0, { baseDelayMs: 5000, jitterFactor: 0 });
    expect(delay).toBe(5000);
  });

  it('uses custom multiplier', () => {
    const delays = [0, 1, 2].map((a) =>
      calculateBackoffDelay(a, { multiplier: 3, jitterFactor: 0 })
    );
    // attempt 0: 1000 * 3^0 = 1000
    // attempt 1: 1000 * 3^1 = 3000
    // attempt 2: 1000 * 3^2 = 9000
    expect(delays).toEqual([1000, 3000, 9000]);
  });

  it('never returns negative delay', () => {
    // Even with extreme jitter, the result should be >= 0
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffDelay(5, { jitterFactor: 1.0 });
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns integer (rounded) value', () => {
    const delay = calculateBackoffDelay(1, { jitterFactor: 0.5 });
    expect(Number.isInteger(delay)).toBe(true);
  });
});
