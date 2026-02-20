import { describe, it, expect } from 'vitest';
import { generateId } from './id-utils.js';

describe('generateId', () => {
  it('returns string starting with prefix and underscore', () => {
    const id = generateId('test');
    expect(id.startsWith('test_')).toBe(true);
  });

  it('contains timestamp between prefix and random', () => {
    const before = Date.now();
    const id = generateId('pfx');
    const after = Date.now();
    const parts = id.split('_');
    // parts: [prefix, timestamp, random]
    expect(parts.length).toBe(3);
    const ts = Number(parts[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('timestamp is a valid number (parseable)', () => {
    const id = generateId('item');
    const parts = id.split('_');
    const ts = Number(parts[1]);
    expect(Number.isNaN(ts)).toBe(false);
    expect(Number.isFinite(ts)).toBe(true);
  });

  it('default random part is 8 hex characters', () => {
    const id = generateId('def');
    const parts = id.split('_');
    const random = parts[2];
    expect(random).toHaveLength(8);
  });

  it('custom randomLength produces correct length random part', () => {
    const id4 = generateId('short', 4);
    expect(id4.split('_')[2]).toHaveLength(4);

    const id12 = generateId('long', 12);
    expect(id12.split('_')[2]).toHaveLength(12);

    const id16 = generateId('extra', 16);
    expect(id16.split('_')[2]).toHaveLength(16);
  });

  it('two consecutive calls produce different IDs (uniqueness)', () => {
    const id1 = generateId('uniq');
    const id2 = generateId('uniq');
    expect(id1).not.toBe(id2);
  });

  it('works with "task" prefix', () => {
    const id = generateId('task');
    expect(id).toMatch(/^task_\d+_[0-9a-f]+$/);
  });

  it('works with "agent" prefix', () => {
    const id = generateId('agent');
    expect(id).toMatch(/^agent_\d+_[0-9a-f]+$/);
  });

  it('works with single-character prefix', () => {
    const id = generateId('x');
    expect(id.startsWith('x_')).toBe(true);
    expect(id.split('_').length).toBe(3);
  });

  it('random part only contains hex characters (0-9a-f)', () => {
    // Run multiple times to increase confidence
    for (let i = 0; i < 20; i++) {
      const id = generateId('hex');
      const random = id.split('_')[2];
      expect(random).toMatch(/^[0-9a-f]+$/);
    }
  });
});
