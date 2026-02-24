/**
 * Tests for the secureCompare fallback path when timingSafeEqual is unavailable.
 *
 * This is in a separate test file because it needs to mock 'node:crypto'
 * to simulate an environment where timingSafeEqual is not available,
 * while derive.test.ts uses real crypto for all other tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto so that require('node:crypto').timingSafeEqual throws
vi.mock('node:crypto', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Override timingSafeEqual to throw, simulating an environment without it
    timingSafeEqual: () => {
      throw new Error('timingSafeEqual not available');
    },
  };
});

// Import secureCompare AFTER the mock is set up
import { secureCompare } from './derive.js';

describe('secureCompare — fallback path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for equal arrays via fallback comparison', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(secureCompare(a, b)).toBe(true);
  });

  it('returns false when content differs via fallback comparison', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns false when lengths differ via fallback comparison', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns true for two empty arrays via fallback comparison', () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    expect(secureCompare(a, b)).toBe(true);
  });

  it('returns false when one is empty and the other is not via fallback', () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([1]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns false when only the first byte differs via fallback', () => {
    const a = new Uint8Array([0, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns false when only the last byte differs via fallback', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('handles single-byte arrays via fallback', () => {
    expect(secureCompare(new Uint8Array([42]), new Uint8Array([42]))).toBe(true);
    expect(secureCompare(new Uint8Array([42]), new Uint8Array([43]))).toBe(false);
  });
});
