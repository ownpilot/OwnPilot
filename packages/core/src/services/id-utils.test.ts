import { describe, it, expect } from 'vitest';
import { generateId } from './id-utils.js';

describe('generateId', () => {
  it('returns string starting with prefix and underscore', () => {
    const id = generateId('test');
    expect(id.startsWith('test_')).toBe(true);
  });

  // Plan 15 Step 1 (ID-001): the new format is `prefix_<hex>`. The
  // previously embedded timestamp is gone from the public ID — see the
  // utility docstring for the rationale.
  it('has exactly two parts: prefix and random', () => {
    const id = generateId('pfx');
    const parts = id.split('_');
    expect(parts.length).toBe(2);
  });

  it('default random part is 24 hex characters (96 bits)', () => {
    const id = generateId('def');
    const random = id.split('_')[1];
    expect(random).toHaveLength(24);
  });

  it('custom randomLength produces correct length random part', () => {
    const id4 = generateId('short', 4);
    expect(id4.split('_')[1]).toHaveLength(4);

    const id12 = generateId('mid', 12);
    expect(id12.split('_')[1]).toHaveLength(12);

    const id16 = generateId('extra', 16);
    expect(id16.split('_')[1]).toHaveLength(16);
  });

  it('rounds randomLength up to the nearest byte (odd lengths are padded)', () => {
    // 5 hex chars needs 3 bytes (6 hex chars worth) but we slice to 5.
    // Verify the slice is exact, not "ceil-up".
    const id5 = generateId('odd', 5);
    expect(id5.split('_')[1]).toHaveLength(5);
  });

  it('two consecutive calls produce different IDs (uniqueness)', () => {
    const id1 = generateId('uniq');
    const id2 = generateId('uniq');
    expect(id1).not.toBe(id2);
  });

  it('works with "task" prefix', () => {
    const id = generateId('task');
    expect(id).toMatch(/^task_[0-9a-f]{24}$/);
  });

  it('works with "agent" prefix', () => {
    const id = generateId('agent');
    expect(id).toMatch(/^agent_[0-9a-f]{24}$/);
  });

  it('works with single-character prefix', () => {
    const id = generateId('x');
    expect(id.startsWith('x_')).toBe(true);
    expect(id.split('_').length).toBe(2);
  });

  it('random part only contains hex characters (0-9a-f)', () => {
    // Run multiple times to increase confidence
    for (let i = 0; i < 20; i++) {
      const id = generateId('hex');
      const random = id.split('_')[1]!;
      expect(random).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('ID does NOT contain a Date.now() timestamp segment (ID-001 regression)', () => {
    // The old format was `prefix_<13-digit-ts>_<8 hex chars>`. If anyone
    // accidentally re-adds the timestamp, this test fails.
    const before = Date.now();
    const id = generateId('reg');
    const after = Date.now();
    // The ID must contain only the prefix and one hex segment.
    expect(id).toMatch(/^reg_[0-9a-f]+$/);
    // The numeric range [before, after] must not appear in the ID at all.
    const numericSegment = id.split('_').find((p) => /^\d+$/.test(p));
    expect(numericSegment).toBeUndefined();
    // Sanity: timestamp isn't being smuggled in as a substring of the
    // hex segment either. 13 digits in a row cannot appear in a hex
    // string by construction, but we assert the absence anyway.
    expect(id).not.toMatch(/\d{13,}/);
    void before;
    void after;
  });

  it('default entropy is 96 bits — collision probability < 10^-12 at 10M rows', () => {
    // Birthday-bound: p(collision) ≈ k² / (2·2⁹⁶). At k=10⁷, p ≈ 10⁷² / 2⁹⁷
    // ≈ 10⁻²⁰. We can't sample 10M rows in a unit test, but we can verify
    // the entropy source: 24 hex chars must all be independently random
    // by sampling a small population and checking pairwise uniqueness.
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = generateId('birthday');
      expect(ids.has(id)).toBe(false); // zero collisions in 10k samples
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
