/**
 * Tests for pure utility helpers in `common.ts`. Focused on `stableStringify`
 * (Plan 11 IDEMP-001) — the other helpers are exercised by their consumers'
 * integration tests.
 */

import { describe, it, expect } from 'vitest';
import { stableStringify } from './common.js';

describe('stableStringify', () => {
  it('produces identical output for permuted object keys', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ a: 1, b: 2, c: 3 })).toBe(stableStringify({ c: 3, a: 1, b: 2 }));
  });

  it('produces identical output for deeply nested permuted keys', () => {
    const left = { outer: { a: 1, b: { c: 3, d: 4 } }, list: [1, 2, 3] };
    const right = { list: [1, 2, 3], outer: { b: { d: 4, c: 3 }, a: 1 } };
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it('preserves array order (semantic order matters)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it('handles primitives', () => {
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(true)).toBe('true');
  });

  it('handles nested arrays of objects with permuted keys', () => {
    const a = stableStringify([
      { x: 1, y: 2 },
      { y: 2, x: 1 },
    ]);
    const b = stableStringify([
      { y: 2, x: 1 },
      { x: 1, y: 2 },
    ]);
    expect(a).toBe(b);
  });

  it('differs when values differ', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: '1' }));
  });

  it('drops undefined-valued keys the same way JSON.stringify does', () => {
    // JSON.stringify omits undefined values in objects. stableStringify must
    // match so the cache key is compatible with old/legacy hashed values.
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('handles empty containers', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });
});
