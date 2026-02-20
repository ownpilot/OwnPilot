/**
 * Audit Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  NormalizedMessage,
  MessageProcessingResult,
  PipelineContext,
} from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockUsageTracker, mockLogChatEvent, mockLogsRepoLog, mockLog } = vi.hoisted(() => ({
  mockUsageTracker: { record: vi.fn() },
  mockLogChatEvent: vi.fn(),
  mockLogsRepoLog: vi.fn(),
  mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../routes/costs.js', () => ({
  usageTracker: mockUsageTracker,
}));

vi.mock('../../db/repositories/index.js', () => {
  const MockLogsRepository = vi.fn(function (this: { log: typeof mockLogsRepoLog }) {
    this.log = mockLogsRepoLog;
  });
  return { LogsRepository: MockLogsRepository };
});

vi.mock('../../audit/index.js', () => ({
  logChatEvent: (...args: unknown[]) => mockLogChatEvent(...args),
}));

vi.mock('../log.js', () => ({
  getLog: () => mockLog,
}));

// Import after mocks are set up
import { createAuditMiddleware } from './audit.js';
import { LogsRepository } from '../../db/repositories/index.js';

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
    set: vi.fn((key: string, value: unknown) => { store.set(key, value); }),
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
      metadata: { source: 'web', toolCalls: [] },
      timestamp: new Date(),
    },
    streamed: false,
    durationMs: 50,
    stages: ['agent-execution', 'post-processing'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAuditMiddleware', () => {
  let middleware: ReturnType<typeof createAuditMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = createAuditMiddleware();
  });

  // =========================================================================
  // Always calls next() first and returns its result
  // =========================================================================

  describe('next() delegation', () => {
    it('should always call next() and return its result', async () => {
      const ctx = createContext();
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });

    it('should call next() before recording any usage', async () => {
      const callOrder: string[] = [];
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockImplementation(async () => {
        callOrder.push('next');
        return nextResult;
      });
      mockUsageTracker.record.mockImplementation(async () => {
        callOrder.push('record');
      });

      await middleware(msg, ctx, next);

      expect(callOrder[0]).toBe('next');
    });
  });

  // =========================================================================
  // Usage recording — success case
  // =========================================================================

  describe('usage recording on success', () => {
    it('should record usage when agentResult.ok and usage present', async () => {
      const usage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      const ctx = createContext({
        store: {
          userId: 'user-1',
          provider: 'openai',
          model: 'gpt-4',
          conversationId: 'conv-1',
          agentResult: { ok: true },
          usage,
          durationMs: 1234,
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(mockUsageTracker.record).toHaveBeenCalledOnce();
      expect(mockUsageTracker.record).toHaveBeenCalledWith({
        userId: 'user-1',
        sessionId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        latencyMs: 1234,
        requestType: 'chat',
      });
    });

    it('should use result.durationMs as fallback when durationMs not in context', async () => {
      const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          usage,
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult({ durationMs: 789 });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({ latencyMs: 789 }),
      );
    });
  });

  // =========================================================================
  // Usage recording — error case
  // =========================================================================

  describe('usage recording on error', () => {
    it('should record error usage when agentResult.ok is false', async () => {
      const ctx = createContext({
        store: {
          userId: 'user-2',
          provider: 'anthropic',
          model: 'claude-3',
          agentResult: { ok: false, error: { message: 'Rate limit' } },
          durationMs: 500,
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(mockUsageTracker.record).toHaveBeenCalledOnce();
      expect(mockUsageTracker.record).toHaveBeenCalledWith({
        userId: 'user-2',
        provider: 'anthropic',
        model: 'claude-3',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: 500,
        requestType: 'chat',
        error: 'Rate limit',
      });
    });

    it('should record error usage with undefined error message when error object is missing', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: false },
          durationMs: 100,
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({ error: undefined }),
      );
    });
  });

  // =========================================================================
  // No agentResult in context
  // =========================================================================

  describe('no agentResult in context', () => {
    it('should record error usage when agentResult is absent (undefined?.ok is falsy)', async () => {
      const ctx = createContext({
        store: {
          userId: 'user-1',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      // !agentResult?.ok → !undefined → true, so the else-if branch fires
      expect(mockUsageTracker.record).toHaveBeenCalledOnce();
      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          error: undefined,
        }),
      );
    });

    it('should NOT record success usage when agentResult is absent (no usage branch)', async () => {
      const ctx = createContext({
        store: {
          userId: 'user-1',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      // It should NOT have been called with inputTokens > 0 (the success path)
      expect(mockUsageTracker.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: 10 }),
      );
    });
  });

  // =========================================================================
  // logChatEvent
  // =========================================================================

  describe('logChatEvent', () => {
    it('should call logChatEvent with correct params on success', async () => {
      const usage = { promptTokens: 50, completionTokens: 150, totalTokens: 200 };
      const toolCalls = [{ id: 'tc-1', name: 'search' }, { id: 'tc-2', name: 'read' }];
      const ctx = createContext({
        store: {
          agentId: 'agent-42',
          conversationId: 'conv-99',
          provider: 'openai',
          model: 'gpt-4',
          agentResult: { ok: true },
          usage,
          durationMs: 2000,
          requestId: 'req-abc',
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'ok',
          metadata: { source: 'web', toolCalls },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(mockLogChatEvent).toHaveBeenCalledOnce();
      expect(mockLogChatEvent).toHaveBeenCalledWith({
        type: 'complete',
        agentId: 'agent-42',
        sessionId: 'conv-99',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 50,
        outputTokens: 150,
        durationMs: 2000,
        toolCallCount: 2,
        error: undefined,
        requestId: 'req-abc',
      });
    });

    it('should call logChatEvent with type "error" when agentResult.ok is false', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: false, error: { message: 'Server error' } },
          durationMs: 100,
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'Server error',
        }),
      );
    });

    it('should use default values for missing context fields', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'chat',
          sessionId: 'unknown',
          provider: 'unknown',
          model: 'unknown',
          inputTokens: undefined,
          outputTokens: undefined,
          requestId: undefined,
        }),
      );
    });

    it('should set toolCallCount to 0 when no toolCalls in response metadata', async () => {
      const ctx = createContext({
        store: { agentResult: { ok: true }, durationMs: 10 },
      });
      const msg = createMessage();
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'ok',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallCount: 0 }),
      );
    });
  });

  // =========================================================================
  // LogsRepository.log
  // =========================================================================

  describe('LogsRepository.log', () => {
    it('should create LogsRepository with userId and call log with correct params', async () => {
      const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
      const ctx = createContext({
        store: {
          userId: 'user-5',
          provider: 'anthropic',
          model: 'claude-3',
          conversationId: 'conv-7',
          agentResult: { ok: true },
          usage,
          durationMs: 300,
        },
      });
      const msg = createMessage({ content: 'What is AI?', metadata: { source: 'channel' } });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'AI is artificial intelligence.',
          metadata: { source: 'web', toolCalls: [] },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(LogsRepository).toHaveBeenCalledWith('user-5');
      expect(mockLogsRepoLog).toHaveBeenCalledOnce();
      expect(mockLogsRepoLog).toHaveBeenCalledWith({
        conversationId: 'conv-7',
        type: 'chat',
        provider: 'anthropic',
        model: 'claude-3',
        endpoint: 'chat/completions',
        method: 'POST',
        requestBody: { message: 'What is AI?', source: 'channel' },
        responseBody: { contentLength: 'AI is artificial intelligence.'.length },
        statusCode: 200,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        durationMs: 300,
        error: undefined,
      });
    });

    it('should log with statusCode 500 and error message on failure', async () => {
      const ctx = createContext({
        store: {
          userId: 'user-err',
          agentResult: { ok: false, error: { message: 'Timeout' } },
          durationMs: 999,
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLogsRepoLog).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Timeout',
        }),
      );
    });

    it('should use "default" userId when not in context', async () => {
      const ctx = createContext({
        store: { agentResult: { ok: true } },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(LogsRepository).toHaveBeenCalledWith('default');
    });
  });

  // =========================================================================
  // Error handling — usageTracker
  // =========================================================================

  describe('error handling in usageTracker', () => {
    it('should swallow usageTracker.record errors silently', async () => {
      mockUsageTracker.record.mockRejectedValue(new Error('DB connection lost'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          durationMs: 10,
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      // Should not throw and should still return result
      expect(result).toBe(nextResult);
      // logChatEvent and LogsRepository.log should still be called
      expect(mockLogChatEvent).toHaveBeenCalled();
      expect(mockLogsRepoLog).toHaveBeenCalled();
    });

    it('should not log a warning when usageTracker fails', async () => {
      mockUsageTracker.record.mockRejectedValue(new Error('Tracking error'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          durationMs: 10,
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      // The catch block is empty — no log.warn for usageTracker
      expect(mockLog.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('tracking'),
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // Error handling — logChatEvent
  // =========================================================================

  describe('error handling in logChatEvent', () => {
    it('should log warning when logChatEvent throws', async () => {
      const chatEventError = new Error('Audit service down');
      mockLogChatEvent.mockRejectedValue(chatEventError);
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          durationMs: 10,
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(result).toBe(nextResult);
      expect(mockLog.warn).toHaveBeenCalledWith('Event logging failed', { error: chatEventError });
    });

    it('should still call LogsRepository.log even when logChatEvent fails', async () => {
      mockLogChatEvent.mockRejectedValue(new Error('Audit fail'));
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          durationMs: 10,
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLogsRepoLog).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Error handling — LogsRepository
  // =========================================================================

  describe('error handling in LogsRepository', () => {
    it('should swallow LogsRepository.log errors silently', async () => {
      mockLogsRepoLog.mockImplementation(() => { throw new Error('DB write failed'); });
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          durationMs: 10,
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(result).toBe(nextResult);
    });
  });

  // =========================================================================
  // Context defaults
  // =========================================================================

  describe('context defaults', () => {
    it('should use defaults for all optional context values', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult({ durationMs: 42 });
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      // userId defaults to 'default'
      expect(LogsRepository).toHaveBeenCalledWith('default');

      // provider/model default to 'unknown'
      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'default',
          provider: 'unknown',
          model: 'unknown',
        }),
      );

      // durationMs falls back to result.durationMs
      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({ latencyMs: 42 }),
      );

      // agentId defaults to 'chat'
      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'chat' }),
      );

      // conversationId defaults to undefined for usage, 'unknown' for logChatEvent
      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: undefined }),
      );
      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'unknown' }),
      );
    });

    it('should round durationMs to integer', async () => {
      const ctx = createContext({
        store: {
          agentResult: { ok: true },
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          durationMs: 123.789,
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockUsageTracker.record).toHaveBeenCalledWith(
        expect.objectContaining({ latencyMs: 124 }),
      );
      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: 124 }),
      );
    });
  });
});
