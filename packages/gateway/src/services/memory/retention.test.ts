/**
 * Memory retention scheduler tests — mocks the MemoryService and the logger,
 * uses fake timers to assert the boot pass vs. daily-tick cadence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockService } = vi.hoisted(() => {
  const mockService = {
    decayMemories: vi.fn(async () => 0),
    cleanupMemories: vi.fn(async () => 0),
  };
  return { mockService };
});

vi.mock('../memory-service.js', () => ({
  getMemoryService: () => mockService,
}));

vi.mock('../log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('@ownpilot/core', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { runMemoryRetentionCleanup, startMemoryRetention, stopMemoryRetention } =
  await import('./retention.js');

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  stopMemoryRetention();
  vi.useRealTimers();
});

describe('runMemoryRetentionCleanup', () => {
  it('runs decay then cleanup by default', async () => {
    await runMemoryRetentionCleanup('default');
    expect(mockService.decayMemories).toHaveBeenCalledWith('default');
    expect(mockService.cleanupMemories).toHaveBeenCalledWith('default');
  });

  it('skips decay when { decay: false }', async () => {
    await runMemoryRetentionCleanup('default', { decay: false });
    expect(mockService.decayMemories).not.toHaveBeenCalled();
    expect(mockService.cleanupMemories).toHaveBeenCalledTimes(1);
  });

  it('still runs cleanup when decay throws', async () => {
    mockService.decayMemories.mockRejectedValueOnce(new Error('boom'));
    await runMemoryRetentionCleanup('default');
    expect(mockService.cleanupMemories).toHaveBeenCalledTimes(1);
  });

  it('never throws when cleanup throws', async () => {
    mockService.cleanupMemories.mockRejectedValueOnce(new Error('boom'));
    await expect(runMemoryRetentionCleanup('default')).resolves.toBeUndefined();
  });
});

describe('startMemoryRetention', () => {
  it('runs a cleanup-only boot pass immediately (no decay)', async () => {
    vi.useFakeTimers();
    startMemoryRetention('default');
    // Flush the microtask from the fire-and-forget boot pass.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockService.cleanupMemories).toHaveBeenCalledTimes(1);
    expect(mockService.decayMemories).not.toHaveBeenCalled();
  });

  it('runs a full decay + cleanup pass on the daily tick', async () => {
    vi.useFakeTimers();
    startMemoryRetention('default');
    await vi.advanceTimersByTimeAsync(0); // boot pass
    expect(mockService.decayMemories).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(mockService.decayMemories).toHaveBeenCalledTimes(1);
    // boot cleanup + daily cleanup
    expect(mockService.cleanupMemories).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — a second start does not schedule a second timer', async () => {
    vi.useFakeTimers();
    startMemoryRetention('default');
    startMemoryRetention('default');
    await vi.advanceTimersByTimeAsync(0);
    // Only one boot pass despite two start calls.
    expect(mockService.cleanupMemories).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    // Only one daily decay despite two start calls.
    expect(mockService.decayMemories).toHaveBeenCalledTimes(1);
  });
});

describe('stopMemoryRetention', () => {
  it('stops the timer so no further passes run', async () => {
    vi.useFakeTimers();
    startMemoryRetention('default');
    await vi.advanceTimersByTimeAsync(0);
    stopMemoryRetention();

    await vi.advanceTimersByTimeAsync(DAY_MS * 3);
    expect(mockService.decayMemories).not.toHaveBeenCalled();
  });

  it('is idempotent', () => {
    expect(() => {
      stopMemoryRetention();
      stopMemoryRetention();
    }).not.toThrow();
  });
});
