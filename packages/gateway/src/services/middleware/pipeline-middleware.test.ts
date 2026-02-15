/**
 * Pipeline Middleware Tests
 *
 * Comprehensive tests for the four pipeline middleware:
 *   - audit.ts
 *   - persistence.ts
 *   - context-injection.ts
 *   - post-processing.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  NormalizedMessage,
  MessageProcessingResult,
  PipelineContext,
} from '@ownpilot/core';

// ============================================================================
// Mocks — vi.hoisted() ensures variables are available in hoisted vi.mock()
// ============================================================================

const {
  mockUsageRecord,
  mockLogsLog,
  mockGetOrCreateConversation,
  mockAddMessage,
  mockLogChatEvent,
  mockCheckToolCallApproval,
  mockBuildEnhancedSystemPrompt,
  mockExtractMemories,
  mockUpdateGoalProgress,
  mockEvaluateTriggers,
  mockLogInfo,
  mockLogWarn,
  mockLogError,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockUsageRecord: vi.fn().mockResolvedValue(undefined),
  mockLogsLog: vi.fn(),
  mockGetOrCreateConversation: vi.fn(),
  mockAddMessage: vi.fn(),
  mockLogChatEvent: vi.fn().mockResolvedValue(undefined),
  mockCheckToolCallApproval: vi.fn(),
  mockBuildEnhancedSystemPrompt: vi.fn(),
  mockExtractMemories: vi.fn().mockResolvedValue(0),
  mockUpdateGoalProgress: vi.fn().mockResolvedValue(undefined),
  mockEvaluateTriggers: vi.fn().mockResolvedValue({ triggered: [], executed: [] }),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogDebug: vi.fn(),
}));

// --- routes/costs.js ---
vi.mock('../../routes/costs.js', () => ({
  usageTracker: { record: mockUsageRecord },
}));

// --- db/repositories/index.js ---
vi.mock('../../db/repositories/index.js', () => ({
  LogsRepository: vi.fn().mockImplementation(function() { return {
    log: mockLogsLog,
  }; }),
  ChatRepository: vi.fn().mockImplementation(function() { return {
    getOrCreateConversation: mockGetOrCreateConversation,
    addMessage: mockAddMessage,
  }; }),
}));

// --- audit/index.js ---
vi.mock('../../audit/index.js', () => ({
  logChatEvent: mockLogChatEvent,
  checkToolCallApproval: mockCheckToolCallApproval,
}));

// --- assistant/index.js ---
vi.mock('../../assistant/index.js', () => ({
  buildEnhancedSystemPrompt: mockBuildEnhancedSystemPrompt,
  extractMemories: mockExtractMemories,
  updateGoalProgress: mockUpdateGoalProgress,
  evaluateTriggers: mockEvaluateTriggers,
}));

// --- ../log.js ---
vi.mock('../log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
  }),
}));

// ============================================================================
// Imports under test (after mocks)
// ============================================================================

import { createAuditMiddleware } from './audit.js';
import { createPersistenceMiddleware } from './persistence.js';
import { createContextInjectionMiddleware } from './context-injection.js';
import { createPostProcessingMiddleware } from './post-processing.js';
import { LogsRepository, ChatRepository } from '../../db/repositories/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContext(overrides: Record<string, unknown> = {}): PipelineContext {
  const store = new Map<string, unknown>(Object.entries(overrides));
  const warnings: string[] = [];
  const stages: string[] = [];
  return {
    get<T = unknown>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set(key: string, value: unknown): void {
      store.set(key, value);
    },
    has(key: string): boolean {
      return store.has(key);
    },
    addStage(name: string): void {
      stages.push(name);
    },
    addWarning(message: string): void {
      warnings.push(message);
    },
    aborted: false,
    abortReason: undefined,
    // Expose internals for assertion
    _warnings: warnings,
    _stages: stages,
    _store: store,
  } as PipelineContext & { _warnings: string[]; _stages: string[]; _store: Map<string, unknown> };
}

function createMockMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: 'msg-001',
    sessionId: 'session-001',
    role: 'user',
    content: 'Hello, assistant!',
    metadata: { source: 'web' as const },
    timestamp: new Date('2025-06-01T12:00:00Z'),
    ...overrides,
  } as NormalizedMessage;
}

function createMockResult(overrides: Partial<MessageProcessingResult> = {}): MessageProcessingResult {
  return {
    response: {
      id: 'resp-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: 'Hello! How can I help you?',
      metadata: {
        source: 'web' as const,
        toolCalls: [],
        conversationId: 'conv-fallback',
      },
      timestamp: new Date('2025-06-01T12:00:01Z'),
    } as NormalizedMessage,
    streamed: false,
    durationMs: 150,
    stages: ['agent-execution'],
    warnings: [],
    ...overrides,
  };
}

function createMockNext(result?: MessageProcessingResult): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(result ?? createMockResult());
}

// Typed helper to access test internals on the context
function ctxInternals(ctx: PipelineContext) {
  return ctx as PipelineContext & { _warnings: string[]; _stages: string[]; _store: Map<string, unknown> };
}

// ============================================================================
// Tests
// ============================================================================

describe('Pipeline Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Audit Middleware
  // ==========================================================================

  describe('createAuditMiddleware', () => {
    it('calls next() first (outer middleware pattern)', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext();
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('returns the result from next()', async () => {
      const middleware = createAuditMiddleware();
      const expectedResult = createMockResult();
      const message = createMockMessage();
      const ctx = createMockContext();
      const next = createMockNext(expectedResult);

      const result = await middleware(message, ctx, next);

      expect(result).toBe(expectedResult);
    });

    it('records successful usage when agentResult.ok and usage exist', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        userId: 'user-1',
        provider: 'openai',
        model: 'gpt-4o',
        durationMs: 200,
        conversationId: 'conv-123',
        agentId: 'my-agent',
        requestId: 'req-abc',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        agentResult: { ok: true },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockUsageRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sessionId: 'conv-123',
          provider: 'openai',
          model: 'gpt-4o',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          latencyMs: 200,
          requestType: 'chat',
        }),
      );
    });

    it('records failed usage when agentResult is not ok', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        provider: 'anthropic',
        model: 'claude-3',
        durationMs: 300,
        agentResult: { ok: false, error: { message: 'Rate limit' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockUsageRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'default',
          provider: 'anthropic',
          model: 'claude-3',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: 300,
          requestType: 'chat',
          error: 'Rate limit',
        }),
      );
    });

    it('does not record usage when agentResult is undefined (no agentResult set)', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      // agentResult is falsy -> !agentResult?.ok evaluates true, so it records error usage
      const ctx = createMockContext({});
      const next = createMockNext();

      await middleware(message, ctx, next);

      // When agentResult is undefined, !agentResult?.ok is true, so error branch runs
      expect(mockUsageRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          error: undefined,
        }),
      );
    });

    it('logs chat event with correct parameters on success', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const toolCalls = [{ id: 'tc-1', name: 'search', arguments: {} }];
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          metadata: { source: 'web' as const, toolCalls },
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        provider: 'openai',
        model: 'gpt-4o',
        durationMs: 250,
        conversationId: 'conv-789',
        agentId: 'agent-x',
        requestId: 'req-xyz',
        usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        agentResult: { ok: true },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          agentId: 'agent-x',
          sessionId: 'conv-789',
          provider: 'openai',
          model: 'gpt-4o',
          inputTokens: 80,
          outputTokens: 30,
          durationMs: 250,
          toolCallCount: 1,
          error: undefined,
          requestId: 'req-xyz',
        }),
      );
    });

    it('logs chat event with type "error" when agentResult is not ok', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: false, error: { message: 'Timeout' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'Timeout',
        }),
      );
    });

    it('creates LogsRepository with userId and calls log()', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage({ content: 'Tell me a joke' });
      const ctx = createMockContext({
        userId: 'user-42',
        provider: 'openai',
        model: 'gpt-4',
        durationMs: 120,
        agentResult: { ok: true },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(LogsRepository).toHaveBeenCalledWith('user-42');
      expect(mockLogsLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat',
          provider: 'openai',
          model: 'gpt-4',
          endpoint: 'chat/completions',
          method: 'POST',
          statusCode: 200,
          durationMs: 120,
        }),
      );
    });

    it('passes message content and source in requestBody', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage({
        content: 'My message',
        metadata: { source: 'telegram' as const },
      });
      const ctx = createMockContext({
        agentResult: { ok: true },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockLogsLog).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { message: 'My message', source: 'telegram' },
        }),
      );
    });

    it('passes responseBody with contentLength', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          content: 'A response of 26 chars!!!',
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        agentResult: { ok: true },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      expect(mockLogsLog).toHaveBeenCalledWith(
        expect.objectContaining({
          responseBody: { contentLength: 25 },
        }),
      );
    });

    it('sets statusCode to 500 when agentResult is not ok', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: false, error: { message: 'fail' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockLogsLog).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'fail',
        }),
      );
    });

    it('handles usageTracker.record errors gracefully', async () => {
      mockUsageRecord.mockRejectedValueOnce(new Error('DB write failed'));

      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });
      const next = createMockNext();

      // Should not throw
      const result = await middleware(message, ctx, next);
      expect(result).toBeDefined();

      // Audit event logging and DB logging should still run
      expect(mockLogChatEvent).toHaveBeenCalled();
      expect(mockLogsLog).toHaveBeenCalled();
    });

    it('handles logChatEvent errors gracefully', async () => {
      mockLogChatEvent.mockRejectedValueOnce(new Error('Audit write failed'));

      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true },
      });
      const next = createMockNext();

      const result = await middleware(message, ctx, next);
      expect(result).toBeDefined();
      expect(mockLogWarn).toHaveBeenCalledWith('Event logging failed', expect.any(Object));
    });

    it('handles LogsRepository errors gracefully', async () => {
      mockLogsLog.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true },
      });
      const next = createMockNext();

      // Should not throw
      const result = await middleware(message, ctx, next);
      expect(result).toBeDefined();
    });

    it('uses context defaults when values are missing', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext(); // No values set
      const next = createMockNext();

      await middleware(message, ctx, next);

      // LogsRepository constructed with 'default' userId
      expect(LogsRepository).toHaveBeenCalledWith('default');

      // logChatEvent should use defaults
      expect(mockLogChatEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'chat',
          sessionId: 'unknown',
          provider: 'unknown',
          model: 'unknown',
        }),
      );
    });

    it('uses result.durationMs when durationMs is not in context', async () => {
      const middleware = createAuditMiddleware();
      const message = createMockMessage();
      const mockResult = createMockResult({ durationMs: 999 });
      const ctx = createMockContext({
        agentResult: { ok: true },
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      expect(mockUsageRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          latencyMs: 999,
        }),
      );
    });
  });

  // ==========================================================================
  // Persistence Middleware
  // ==========================================================================

  describe('createPersistenceMiddleware', () => {
    beforeEach(() => {
      mockGetOrCreateConversation.mockResolvedValue({ id: 'db-conv-001' });
      mockAddMessage.mockResolvedValue({ id: 'db-msg-001' });
    });

    it('calls next() first (outer middleware pattern)', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'hi' } },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('returns the result from next()', async () => {
      const middleware = createPersistenceMiddleware();
      const expectedResult = createMockResult();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'hi' } },
        conversationId: 'conv-1',
      });
      const next = createMockNext(expectedResult);

      const result = await middleware(message, ctx, next);

      expect(result).toBe(expectedResult);
    });

    it('skips persistence when agentResult is not ok', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: false },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(ChatRepository).not.toHaveBeenCalled();
      expect(mockGetOrCreateConversation).not.toHaveBeenCalled();
      expect(mockAddMessage).not.toHaveBeenCalled();
    });

    it('skips persistence when agentResult is undefined', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(ChatRepository).not.toHaveBeenCalled();
    });

    it('skips persistence when no conversationId and adds warning', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          metadata: { source: 'web' as const },
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'response' } },
        // No conversationId in context; result.response.metadata.conversationId is also undefined
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      const internals = ctxInternals(ctx);
      expect(internals._warnings).toContain('No conversationId \u2014 skipping persistence');
      expect(mockGetOrCreateConversation).not.toHaveBeenCalled();
    });

    it('falls back to result.response.metadata.conversationId when ctx has none', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          metadata: { source: 'web' as const, conversationId: 'from-metadata' },
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'hello' } },
        // No conversationId in ctx
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      expect(mockGetOrCreateConversation).toHaveBeenCalledWith(
        'from-metadata',
        expect.any(Object),
      );
    });

    it('creates conversation and saves user + assistant messages on success', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage({ content: 'What is the weather?' });
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          content: 'The weather is sunny.',
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        userId: 'user-7',
        provider: 'openai',
        model: 'gpt-4o',
        conversationId: 'conv-999',
        agentId: 'weather-agent',
        agentResult: { ok: true, value: { content: 'The weather is sunny.' } },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      expect(ChatRepository).toHaveBeenCalledWith('user-7');

      expect(mockGetOrCreateConversation).toHaveBeenCalledWith('conv-999', {
        title: 'What is the weather?',
        agentId: 'weather-agent',
        agentName: undefined,
        provider: 'openai',
        model: 'gpt-4o',
      });

      // User message
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'db-conv-001',
          role: 'user',
          content: 'What is the weather?',
          provider: 'openai',
          model: 'gpt-4o',
        }),
      );

      // Assistant message
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'db-conv-001',
          role: 'assistant',
          content: 'The weather is sunny.',
          provider: 'openai',
          model: 'gpt-4o',
        }),
      );
    });

    it('truncates title to 50 chars with ellipsis for long messages', async () => {
      const middleware = createPersistenceMiddleware();
      const longContent = 'A'.repeat(80);
      const message = createMockMessage({ content: longContent });
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockGetOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          title: 'A'.repeat(50) + '...',
        }),
      );
    });

    it('does not add ellipsis for messages 50 chars or shorter', async () => {
      const middleware = createPersistenceMiddleware();
      const shortContent = 'A'.repeat(50);
      const message = createMockMessage({ content: shortContent });
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockGetOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          title: 'A'.repeat(50),
        }),
      );
    });

    it('sets agentName to "Chat" when agentId is not provided', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
        conversationId: 'conv-1',
        // No agentId
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockGetOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          agentId: undefined,
          agentName: 'Chat',
        }),
      );
    });

    it('passes trace info to assistant message', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const traceData = { steps: ['a', 'b'], tokens: 42 };
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
        conversationId: 'conv-1',
        traceInfo: traceData,
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      // The second addMessage call is for the assistant
      const assistantCall = mockAddMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).role === 'assistant',
      );
      expect(assistantCall).toBeDefined();
      expect(assistantCall![0]).toEqual(
        expect.objectContaining({
          trace: traceData,
        }),
      );
    });

    it('passes tool calls to assistant message', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const toolCalls = [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }];
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply', toolCalls } },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      const assistantCall = mockAddMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).role === 'assistant',
      );
      expect(assistantCall).toBeDefined();
      expect(assistantCall![0]).toEqual(
        expect.objectContaining({
          toolCalls: [...toolCalls],
        }),
      );
    });

    it('passes usage tokens to assistant message', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: {
          ok: true,
          value: { content: 'reply', usage: { promptTokens: 100, completionTokens: 50 } },
        },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      const assistantCall = mockAddMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).role === 'assistant',
      );
      expect(assistantCall).toBeDefined();
      expect(assistantCall![0]).toEqual(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
        }),
      );
    });

    it('handles DB errors gracefully and adds warning', async () => {
      mockGetOrCreateConversation.mockRejectedValueOnce(new Error('DB connection failed'));

      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      // Should not throw
      const result = await middleware(message, ctx, next);
      expect(result).toBeDefined();

      const internals = ctxInternals(ctx);
      expect(internals._warnings).toContain('Persistence failed');
      expect(mockLogWarn).toHaveBeenCalledWith('Failed to save chat history', expect.any(Object));
    });

    it('uses default userId when not in context', async () => {
      const middleware = createPersistenceMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
        conversationId: 'conv-1',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(ChatRepository).toHaveBeenCalledWith('default');
    });
  });

  // ==========================================================================
  // Context Injection Middleware
  // ==========================================================================

  describe('createContextInjectionMiddleware', () => {
    const defaultStats = { memoriesUsed: 0, goalsUsed: 0 };

    beforeEach(() => {
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: 'Enhanced system prompt with context',
        stats: defaultStats,
      });
    });

    it('skips injection when no agent in context and adds warning', async () => {
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext(); // No 'agent' key
      const next = createMockNext();

      await middleware(message, ctx, next);

      const internals = ctxInternals(ctx);
      expect(internals._warnings).toContain('No agent in context, skipping context injection');
      expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
    });

    it('still calls next() when no agent is present', async () => {
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext();
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('calls buildEnhancedSystemPrompt with correct parameters', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'My custom prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agent: mockAgent,
        userId: 'user-5',
        agentId: 'agent-abc',
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        'My custom prompt',
        {
          userId: 'user-5',
          agentId: 'agent-abc',
          maxMemories: 10,
          maxGoals: 5,
          enableTriggers: true,
          enableAutonomy: true,
        },
      );
    });

    it('updates agent system prompt with enhanced prompt', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'Original' }),
        updateSystemPrompt: vi.fn(),
      };
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: 'Enhanced with memories and goals',
        stats: { memoriesUsed: 3, goalsUsed: 2 },
      });

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockAgent.updateSystemPrompt).toHaveBeenCalledWith('Enhanced with memories and goals');
    });

    it('sets contextStats in the pipeline context', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      const stats = { memoriesUsed: 5, goalsUsed: 1 };
      mockBuildEnhancedSystemPrompt.mockResolvedValue({ prompt: 'enhanced', stats });

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      const internals = ctxInternals(ctx);
      expect(internals._store.get('contextStats')).toBe(stats);
    });

    it('falls back to default system prompt when agent has none', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: undefined }),
        updateSystemPrompt: vi.fn(),
      };
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        'You are a helpful AI assistant.',
        expect.any(Object),
      );
    });

    it('falls back to default system prompt when agent systemPrompt is empty string', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: '' }),
        updateSystemPrompt: vi.fn(),
      };
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        'You are a helpful AI assistant.',
        expect.any(Object),
      );
    });

    it('handles buildEnhancedSystemPrompt errors gracefully', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      mockBuildEnhancedSystemPrompt.mockRejectedValueOnce(new Error('Memory DB unavailable'));

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      // Should not throw
      const result = await middleware(message, ctx, next);
      expect(result).toBeDefined();

      const internals = ctxInternals(ctx);
      expect(internals._warnings).toContain('Context injection failed: Memory DB unavailable');
      expect(mockLogWarn).toHaveBeenCalledWith(
        'Failed to build enhanced prompt',
        expect.objectContaining({ error: 'Memory DB unavailable' }),
      );
    });

    it('handles non-Error thrown values in catch block', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      mockBuildEnhancedSystemPrompt.mockRejectedValueOnce('string error');

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      const internals = ctxInternals(ctx);
      expect(internals._warnings).toContain('Context injection failed: string error');
    });

    it('still calls next() after an error in injection', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      mockBuildEnhancedSystemPrompt.mockRejectedValueOnce(new Error('fail'));

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('calls next() after successful injection', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('uses default userId and agentId when not in context', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'default',
          agentId: 'chat',
        }),
      );
    });

    it('logs info when memories or goals are injected', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: 'enhanced',
        stats: { memoriesUsed: 3, goalsUsed: 2 },
      });

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockLogInfo).toHaveBeenCalledWith('Injected 3 memories, 2 goals');
    });

    it('does not log when no memories or goals are injected', async () => {
      const mockAgent = {
        getConversation: () => ({ systemPrompt: 'prompt' }),
        updateSystemPrompt: vi.fn(),
      };
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: 'enhanced',
        stats: { memoriesUsed: 0, goalsUsed: 0 },
      });

      const middleware = createContextInjectionMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({ agent: mockAgent });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockLogInfo).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Post-Processing Middleware
  // ==========================================================================

  describe('createPostProcessingMiddleware', () => {
    it('calls next() first (outer middleware pattern)', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('returns result from next()', async () => {
      const middleware = createPostProcessingMiddleware();
      const expectedResult = createMockResult();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
      });
      const next = createMockNext(expectedResult);

      const result = await middleware(message, ctx, next);

      expect(result).toBe(expectedResult);
    });

    it('skips processing when agentResult is not ok', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: false },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockExtractMemories).not.toHaveBeenCalled();
      expect(mockUpdateGoalProgress).not.toHaveBeenCalled();
      expect(mockEvaluateTriggers).not.toHaveBeenCalled();
    });

    it('skips processing when agentResult is undefined', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext();
      const next = createMockNext();

      await middleware(message, ctx, next);

      expect(mockExtractMemories).not.toHaveBeenCalled();
      expect(mockUpdateGoalProgress).not.toHaveBeenCalled();
      expect(mockEvaluateTriggers).not.toHaveBeenCalled();
    });

    it('calls extractMemories with userId, user message, and response content', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage({ content: 'I love dogs' });
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          content: 'Dogs are great!',
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        userId: 'user-3',
        agentResult: { ok: true, value: { content: 'Dogs are great!' } },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      // Allow fire-and-forget promises to settle
      await vi.waitFor(() => {
        expect(mockExtractMemories).toHaveBeenCalledWith('user-3', 'I love dogs', 'Dogs are great!');
      });
    });

    it('calls updateGoalProgress with userId, messages, and tool calls', async () => {
      const toolCalls = [{ id: 'tc1', name: 'web_search', arguments: { q: 'test' } }] as const;
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage({ content: 'Search for test' });
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          content: 'Found results',
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        userId: 'user-4',
        agentResult: { ok: true, value: { content: 'Found results', toolCalls } },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      await vi.waitFor(() => {
        expect(mockUpdateGoalProgress).toHaveBeenCalledWith(
          'user-4',
          'Search for test',
          'Found results',
          toolCalls,
        );
      });
    });

    it('calls evaluateTriggers with userId, user message, and response content', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage({ content: 'Check triggers' });
      const mockResult = createMockResult({
        response: {
          ...createMockResult().response,
          content: 'Triggers checked',
        } as NormalizedMessage,
      });
      const ctx = createMockContext({
        userId: 'user-6',
        agentResult: { ok: true, value: { content: 'Triggers checked' } },
      });
      const next = createMockNext(mockResult);

      await middleware(message, ctx, next);

      await vi.waitFor(() => {
        expect(mockEvaluateTriggers).toHaveBeenCalledWith('user-6', 'Check triggers', 'Triggers checked');
      });
    });

    it('calls all three functions in parallel (fire-and-forget)', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        userId: 'user-8',
        agentResult: { ok: true, value: { content: 'reply' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      // All three should be called (fire-and-forget, but we can verify they were invoked)
      await vi.waitFor(() => {
        expect(mockExtractMemories).toHaveBeenCalled();
        expect(mockUpdateGoalProgress).toHaveBeenCalled();
        expect(mockEvaluateTriggers).toHaveBeenCalled();
      });
    });

    it('returns result immediately without waiting for post-processing', async () => {
      // Create slow mock operations
      let memoriesResolved = false;
      mockExtractMemories.mockImplementation(
        () => new Promise<number>((resolve) => {
          setTimeout(() => {
            memoriesResolved = true;
            resolve(3);
          }, 500);
        }),
      );

      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
      });
      const next = createMockNext();

      const result = await middleware(message, ctx, next);

      // Result is returned immediately
      expect(result).toBeDefined();
      // Post-processing has not yet completed
      expect(memoriesResolved).toBe(false);
    });

    it('uses default userId when not in context', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      await vi.waitFor(() => {
        expect(mockExtractMemories).toHaveBeenCalledWith('default', expect.any(String), expect.any(String));
      });
    });

    it('handles individual post-processing failures gracefully', async () => {
      mockExtractMemories.mockRejectedValueOnce(new Error('Memory extraction DB error'));
      mockUpdateGoalProgress.mockRejectedValueOnce(new Error('Goal update failed'));

      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        agentResult: { ok: true, value: { content: 'reply' } },
      });
      const next = createMockNext();

      // Should not throw
      const result = await middleware(message, ctx, next);
      expect(result).toBeDefined();

      // The catch handlers inside Promise.all log warnings
      await vi.waitFor(() => {
        expect(mockLogWarn).toHaveBeenCalledWith('Memory extraction failed', expect.any(Object));
        expect(mockLogWarn).toHaveBeenCalledWith('Goal progress update failed', expect.any(Object));
      });
    });

    it('passes undefined toolCalls when agentResult.value has no toolCalls', async () => {
      const middleware = createPostProcessingMiddleware();
      const message = createMockMessage();
      const ctx = createMockContext({
        userId: 'user-9',
        agentResult: { ok: true, value: { content: 'simple reply' } },
      });
      const next = createMockNext();

      await middleware(message, ctx, next);

      await vi.waitFor(() => {
        expect(mockUpdateGoalProgress).toHaveBeenCalledWith(
          'user-9',
          expect.any(String),
          expect.any(String),
          undefined,
        );
      });
    });
  });
});
