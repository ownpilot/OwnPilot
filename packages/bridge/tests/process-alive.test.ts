import { describe, it, expect } from 'vitest';
import { isProcessAlive } from '../src/process-alive.ts';

describe('isProcessAlive', () => {
  it('returns true for the current process PID', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a non-existent PID', () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isProcessAlive(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isProcessAlive(undefined)).toBe(false);
  });
});
