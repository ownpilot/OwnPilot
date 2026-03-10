import { describe, it, expect, afterEach } from 'vitest';
import { recordFirstChunk, resetMetrics, getMetrics } from '../src/metrics.ts';

afterEach(() => {
  resetMetrics();
});

describe('avgFirstChunkMs metric', () => {
  it('returns 0 when no samples recorded', () => {
    const m = getMetrics(0, 0);
    expect(m.avgFirstChunkMs).toBe(0);
  });

  it('equals the single sample value', () => {
    recordFirstChunk(350);
    const m = getMetrics(0, 0);
    expect(m.avgFirstChunkMs).toBe(350);
  });

  it('averages multiple samples', () => {
    recordFirstChunk(200);
    recordFirstChunk(400);
    const m = getMetrics(0, 0);
    expect(m.avgFirstChunkMs).toBe(300);
  });

  it('resets to 0 after resetMetrics', () => {
    recordFirstChunk(500);
    resetMetrics();
    const m = getMetrics(0, 0);
    expect(m.avgFirstChunkMs).toBe(0);
  });
});
