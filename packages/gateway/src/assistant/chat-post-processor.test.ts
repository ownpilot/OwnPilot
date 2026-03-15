import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockExtractMemories = vi.fn(async () => 2);
const mockUpdateGoalProgress = vi.fn(async () => undefined);
const mockEvaluateTriggers = vi.fn(async () => ({
  triggered: ['t1'],
  pending: [],
  executed: ['t1'],
}));

vi.mock('./index.js', () => ({
  extractMemories: (...args: unknown[]) => mockExtractMemories(...args),
  updateGoalProgress: (...args: unknown[]) => mockUpdateGoalProgress(...args),
  evaluateTriggers: (...args: unknown[]) => mockEvaluateTriggers(...args),
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { runPostChatProcessing, waitForPendingProcessing } = await import(
  './chat-post-processor.js'
);

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPostChatProcessing', () => {
  it('calls extractMemories, updateGoalProgress, and evaluateTriggers', async () => {
    runPostChatProcessing('user-1', 'hello', 'hi there');
    await waitForPendingProcessing();

    expect(mockExtractMemories).toHaveBeenCalledWith('user-1', 'hello', 'hi there');
    expect(mockUpdateGoalProgress).toHaveBeenCalledWith('user-1', 'hello', 'hi there', undefined);
    expect(mockEvaluateTriggers).toHaveBeenCalledWith('user-1', 'hello', 'hi there');
  });

  it('passes toolCalls to updateGoalProgress', async () => {
    const toolCalls = [{ name: 'test', arguments: '{}' }] as never;
    runPostChatProcessing('user-1', 'msg', 'response', toolCalls);
    await waitForPendingProcessing();

    expect(mockUpdateGoalProgress).toHaveBeenCalledWith('user-1', 'msg', 'response', toolCalls);
  });

  it('does not throw when extractMemories fails', async () => {
    mockExtractMemories.mockRejectedValueOnce(new Error('memory fail'));

    runPostChatProcessing('user-1', 'msg', 'resp');
    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
  });

  it('does not throw when evaluateTriggers fails', async () => {
    mockEvaluateTriggers.mockRejectedValueOnce(new Error('trigger fail'));

    runPostChatProcessing('user-1', 'msg', 'resp');
    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
  });

  it('does not throw when updateGoalProgress fails', async () => {
    mockUpdateGoalProgress.mockRejectedValueOnce(new Error('goal fail'));

    runPostChatProcessing('user-1', 'msg', 'resp');
    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
  });
});

describe('waitForPendingProcessing', () => {
  it('resolves when no pending tasks', async () => {
    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
  });

  it('waits for all in-flight tasks', async () => {
    let completed = false;
    mockExtractMemories.mockImplementation(
      () => new Promise((r) => setTimeout(() => { completed = true; r(0); }, 10))
    );

    runPostChatProcessing('user-1', 'msg', 'resp');
    expect(completed).toBe(false);

    await waitForPendingProcessing();
    expect(completed).toBe(true);
  });
});
