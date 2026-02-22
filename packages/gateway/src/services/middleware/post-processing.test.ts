/**
 * Post-Processing Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedMessage, MessageProcessingResult, PipelineContext } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockExtractMemories, mockUpdateGoalProgress, mockEvaluateTriggers, mockLog } = vi.hoisted(
  () => ({
    mockExtractMemories: vi.fn(),
    mockUpdateGoalProgress: vi.fn(),
    mockEvaluateTriggers: vi.fn(),
    mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  })
);

vi.mock('../../assistant/index.js', () => ({
  extractMemories: (...args: unknown[]) => mockExtractMemories(...args),
  updateGoalProgress: (...args: unknown[]) => mockUpdateGoalProgress(...args),
  evaluateTriggers: (...args: unknown[]) => mockEvaluateTriggers(...args),
}));

vi.mock('../log.js', () => ({
  getLog: () => mockLog,
}));

// Import after mocks are set up
import { createPostProcessingMiddleware } from './post-processing.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMessage(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello agent',
    metadata: { source: 'web' },
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface MockContextOptions {
  store?: Record<string, unknown>;
}

function createContext(opts: MockContextOptions = {}): PipelineContext {
  const store = new Map<string, unknown>(Object.entries(opts.store ?? {}));
  return {
    get: vi.fn(<T = unknown>(key: string): T | undefined => store.get(key) as T | undefined),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
    }),
    has: vi.fn((key: string) => store.has(key)),
    addStage: vi.fn(),
    addWarning: vi.fn(),
    aborted: false,
    abortReason: undefined,
  };
}

function createNextResult(overrides?: Partial<MessageProcessingResult>): MessageProcessingResult {
  return {
    response: {
      id: 'final-resp',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Processed',
      metadata: { source: 'web' },
      timestamp: new Date(),
    },
    streamed: false,
    durationMs: 50,
    stages: ['agent-execution', 'post-processing'],
    ...overrides,
  };
}

/**
 * Flush all pending microtasks so fire-and-forget Promise.all().then() chains settle.
 */
async function flushPromises(): Promise<void> {
  // Multiple ticks needed: Promise.all resolution + .then() handler
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPostProcessingMiddleware', () => {
  let middleware: ReturnType<typeof createPostProcessingMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractMemories.mockResolvedValue(0);
    mockUpdateGoalProgress.mockResolvedValue(undefined);
    mockEvaluateTriggers.mockResolvedValue({ triggered: [], pending: [], executed: [] });
    middleware = createPostProcessingMiddleware();
  });

  // =========================================================================
  // Always calls next() first and returns its result
  // =========================================================================

  describe('next() delegation', () => {
    it('should always call next() and return its result', async () => {
      const ctx = createContext({
        store: { agentResult: { ok: true } },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });

    it('should return result from next() even when agentResult is missing', async () => {
      const ctx = createContext();
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });
  });

  // =========================================================================
  // extractMemories for channel messages only
  // =========================================================================

  describe('extractMemories for channel messages', () => {
    it('should run extractMemories for channel messages (source === "channel")', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'response', toolCalls: [] } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ content: 'User said hi', metadata: { source: 'channel' } });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Bot replied',
          metadata: { source: 'channel' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockExtractMemories).toHaveBeenCalledOnce();
      expect(mockExtractMemories).toHaveBeenCalledWith('user-1', 'User said hi', 'Bot replied');
    });

    it('should NOT run extractMemories for web messages (source === "web")', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'response' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockExtractMemories).not.toHaveBeenCalled();
    });

    it('should NOT run extractMemories for telegram messages (source === "telegram")', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'response' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'telegram' } });
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      // 'telegram' !== 'channel', so no extraction
      expect(mockExtractMemories).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateGoalProgress and evaluateTriggers for all successful messages
  // =========================================================================

  describe('updateGoalProgress and evaluateTriggers', () => {
    it('should run updateGoalProgress for web messages', async () => {
      const toolCalls = [{ id: 'tc-1', name: 'search', arguments: '{}' }];
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp', toolCalls } },
          userId: 'user-2',
        },
      });
      const msg = createMessage({ content: 'Do task', metadata: { source: 'web' } });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Done',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockUpdateGoalProgress).toHaveBeenCalledOnce();
      expect(mockUpdateGoalProgress).toHaveBeenCalledWith('user-2', 'Do task', 'Done', toolCalls);
    });

    it('should run evaluateTriggers for web messages', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-3',
        },
      });
      const msg = createMessage({ content: 'Check triggers', metadata: { source: 'web' } });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Checked',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockEvaluateTriggers).toHaveBeenCalledOnce();
      expect(mockEvaluateTriggers).toHaveBeenCalledWith('user-3', 'Check triggers', 'Checked');
    });

    it('should run both updateGoalProgress and evaluateTriggers for channel messages', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp', toolCalls: [] } },
          userId: 'user-4',
        },
      });
      const msg = createMessage({ content: 'Channel msg', metadata: { source: 'channel' } });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Channel reply',
          metadata: { source: 'channel' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockExtractMemories).toHaveBeenCalledOnce();
      expect(mockUpdateGoalProgress).toHaveBeenCalledOnce();
      expect(mockEvaluateTriggers).toHaveBeenCalledOnce();
    });

    it('should use "default" userId when not in context', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockUpdateGoalProgress).toHaveBeenCalledWith(
        'default',
        expect.any(String),
        expect.any(String),
        undefined
      );
      expect(mockEvaluateTriggers).toHaveBeenCalledWith(
        'default',
        expect.any(String),
        expect.any(String)
      );
    });
  });

  // =========================================================================
  // Skips post-processing when agentResult.ok is false
  // =========================================================================

  describe('skips post-processing on error', () => {
    it('should skip all post-processing when agentResult.ok is false', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: false, error: { message: 'Agent failed' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'channel' } });
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockExtractMemories).not.toHaveBeenCalled();
      expect(mockUpdateGoalProgress).not.toHaveBeenCalled();
      expect(mockEvaluateTriggers).not.toHaveBeenCalled();
      expect(result).toBe(nextResult);
    });

    it('should skip all post-processing when agentResult is missing', async () => {
      const ctx = createContext();
      const msg = createMessage({ metadata: { source: 'channel' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockExtractMemories).not.toHaveBeenCalled();
      expect(mockUpdateGoalProgress).not.toHaveBeenCalled();
      expect(mockEvaluateTriggers).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Post-processing errors are caught and logged
  // =========================================================================

  describe('error handling (fire-and-forget)', () => {
    it('should catch extractMemories error and log warning', async () => {
      mockExtractMemories.mockRejectedValue(new Error('Memory DB down'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'channel' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);
      await flushPromises();

      // Should not throw — errors are caught
      expect(result).toBeDefined();
      expect(mockLog.warn).toHaveBeenCalledWith('Memory extraction failed', {
        error: expect.any(Error),
      });
    });

    it('should catch updateGoalProgress error and log warning', async () => {
      mockUpdateGoalProgress.mockRejectedValue(new Error('Goal service down'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockLog.warn).toHaveBeenCalledWith('Goal progress update failed', {
        error: expect.any(Error),
      });
    });

    it('should catch evaluateTriggers error and log warning', async () => {
      mockEvaluateTriggers.mockRejectedValue(new Error('Trigger engine down'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockLog.warn).toHaveBeenCalledWith('Trigger evaluation failed', {
        error: expect.any(Error),
      });
    });

    it('should still succeed when all post-processing tasks fail', async () => {
      mockExtractMemories.mockRejectedValue(new Error('fail-1'));
      mockUpdateGoalProgress.mockRejectedValue(new Error('fail-2'));
      mockEvaluateTriggers.mockRejectedValue(new Error('fail-3'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'channel' } });
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);
      await flushPromises();

      expect(result).toBe(nextResult);
      // Each task's individual .catch logs a warning
      expect(mockLog.warn).toHaveBeenCalledWith('Memory extraction failed', expect.any(Object));
      expect(mockLog.warn).toHaveBeenCalledWith('Goal progress update failed', expect.any(Object));
      expect(mockLog.warn).toHaveBeenCalledWith('Trigger evaluation failed', expect.any(Object));
    });
  });

  // =========================================================================
  // Returns result immediately without waiting for post-processing
  // =========================================================================

  describe('returns immediately (fire-and-forget)', () => {
    it('should return result before post-processing tasks complete', async () => {
      let extractResolved = false;
      let goalResolved = false;
      let triggerResolved = false;

      mockExtractMemories.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              extractResolved = true;
              resolve(2);
            }, 100);
          })
      );
      mockUpdateGoalProgress.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              goalResolved = true;
              resolve(undefined);
            }, 100);
          })
      );
      mockEvaluateTriggers.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              triggerResolved = true;
              resolve({ triggered: [], pending: [], executed: [] });
            }, 100);
          })
      );

      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'channel' } });
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      // Result returned immediately
      expect(result).toBe(nextResult);

      // Post-processing has NOT completed yet (still in setTimeout)
      expect(extractResolved).toBe(false);
      expect(goalResolved).toBe(false);
      expect(triggerResolved).toBe(false);
    });
  });

  // =========================================================================
  // Logging for successful post-processing results
  // =========================================================================

  describe('post-processing result logging', () => {
    it('should log extracted memory count when > 0 for channel messages', async () => {
      mockExtractMemories.mockResolvedValue(3);
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'channel' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockLog.info).toHaveBeenCalledWith('Extracted 3 new memories');
    });

    it('should not log memory count when 0', async () => {
      mockExtractMemories.mockResolvedValue(0);
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'channel' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('memories'));
    });

    it('should log trigger counts when triggers are evaluated and executed', async () => {
      mockEvaluateTriggers.mockResolvedValue({
        triggered: ['t-1', 't-2'],
        pending: [],
        executed: ['t-1'],
      });
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockLog.info).toHaveBeenCalledWith('2 triggers evaluated');
      expect(mockLog.info).toHaveBeenCalledWith('1 triggers executed');
    });

    it('should not log trigger counts when none triggered', async () => {
      mockEvaluateTriggers.mockResolvedValue({
        triggered: [],
        pending: [],
        executed: [],
      });
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('triggers'));
    });
  });

  // =========================================================================
  // toolCalls from agentResult.value
  // =========================================================================

  describe('toolCalls forwarding', () => {
    it('should pass agentResult.value.toolCalls to updateGoalProgress', async () => {
      const toolCalls = [
        { id: 'tc-1', name: 'search', arguments: '{"q":"test"}' },
        { id: 'tc-2', name: 'read_file', arguments: '{"path":"/tmp"}' },
      ];
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp', toolCalls } },
          userId: 'user-5',
        },
      });
      const msg = createMessage({ content: 'Run tools', metadata: { source: 'web' } });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Tools run',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockUpdateGoalProgress).toHaveBeenCalledWith(
        'user-5',
        'Run tools',
        'Tools run',
        toolCalls
      );
    });

    it('should pass undefined toolCalls when agentResult.value has no toolCalls', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true, value: { content: 'resp' } },
          userId: 'user-6',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);
      await flushPromises();

      expect(mockUpdateGoalProgress).toHaveBeenCalledWith(
        'user-6',
        expect.any(String),
        expect.any(String),
        undefined
      );
    });
  });
});
