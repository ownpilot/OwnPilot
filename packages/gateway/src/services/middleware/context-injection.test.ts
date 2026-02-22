/**
 * Context Injection Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedMessage, MessageProcessingResult, PipelineContext } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockBuildEnhancedSystemPrompt, mockGetErrorMessage, mockLog } = vi.hoisted(() => ({
  mockBuildEnhancedSystemPrompt: vi.fn(),
  mockGetErrorMessage: vi.fn((err: unknown, fallback?: string) =>
    err instanceof Error ? err.message : (fallback ?? String(err))
  ),
  mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../assistant/index.js', () => ({
  buildEnhancedSystemPrompt: (...args: unknown[]) => mockBuildEnhancedSystemPrompt(...args),
}));

vi.mock('../../routes/helpers.js', () => ({
  getErrorMessage: (...args: unknown[]) => mockGetErrorMessage(...args),
}));

vi.mock('../log.js', () => ({
  getLog: () => mockLog,
}));

// Import after mocks are set up
import { createContextInjectionMiddleware, clearInjectionCache } from './context-injection.js';

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
    stages: ['context-injection', 'agent-execution'],
    ...overrides,
  };
}

interface MockAgent {
  getConversation: ReturnType<typeof vi.fn>;
  updateSystemPrompt: ReturnType<typeof vi.fn>;
}

function createAgent(overrides?: Partial<MockAgent>): MockAgent {
  return {
    getConversation: vi.fn().mockReturnValue({ systemPrompt: 'You are a helpful assistant.' }),
    updateSystemPrompt: vi.fn(),
    ...overrides,
  };
}

/** Standard enhanced prompt returned by buildEnhancedSystemPrompt */
const BASE_PROMPT = 'You are a helpful assistant.';
const INJECTED_SUFFIX =
  '\n---\n## User Context (from memory)\n- Memory 1\n---\n## Active Goals\n- Goal 1';
const ENHANCED_PROMPT = BASE_PROMPT + INJECTED_SUFFIX;
const DEFAULT_STATS = { memoriesUsed: 1, goalsUsed: 1 };

function setupDefaultMock(): void {
  mockBuildEnhancedSystemPrompt.mockResolvedValue({
    prompt: ENHANCED_PROMPT,
    stats: DEFAULT_STATS,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createContextInjectionMiddleware', () => {
  let middleware: ReturnType<typeof createContextInjectionMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearInjectionCache();
    middleware = createContextInjectionMiddleware();
    setupDefaultMock();
  });

  // =========================================================================
  // No agent in context
  // =========================================================================

  describe('when no agent is in context', () => {
    it('should add warning and call next', async () => {
      const ctx = createContext();
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(ctx.addWarning).toHaveBeenCalledWith(
        'No agent in context, skipping context injection'
      );
      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });

    it('should not call buildEnhancedSystemPrompt', async () => {
      const ctx = createContext();
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Cache miss — first call
  // =========================================================================

  describe('when cache is empty (first call)', () => {
    it('should call buildEnhancedSystemPrompt with correct arguments', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith('You are a helpful assistant.', {
        userId: 'user-1',
        agentId: 'agent-1',
        maxMemories: 10,
        maxGoals: 5,
        enableTriggers: true,
        enableAutonomy: true,
      });
    });

    it('should update the agent system prompt when enhanced prompt differs', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.updateSystemPrompt).toHaveBeenCalledWith(ENHANCED_PROMPT);
    });

    it('should not update system prompt when enhanced prompt is the same', async () => {
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: BASE_PROMPT,
        stats: { memoriesUsed: 0, goalsUsed: 0 },
      });
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.updateSystemPrompt).not.toHaveBeenCalled();
    });

    it('should set contextStats in context', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(ctx.set).toHaveBeenCalledWith('contextStats', DEFAULT_STATS);
    });

    it('should log when memories or goals are injected', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLog.info).toHaveBeenCalledWith('Injected 1 memories, 1 goals');
    });

    it('should not log when no memories or goals are injected', async () => {
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: BASE_PROMPT + '\n---\n## Available Data Resources\n- something',
        stats: { memoriesUsed: 0, goalsUsed: 0 },
      });
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLog.info).not.toHaveBeenCalled();
    });

    it('should call next after injection', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });

    it('should use defaults for userId and agentId when not in context', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'default',
          agentId: 'chat',
        })
      );
    });

    it('should use default system prompt when agent has none', async () => {
      const agent = createAgent({
        getConversation: vi.fn().mockReturnValue({ systemPrompt: undefined }),
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        'You are a helpful AI assistant.',
        expect.any(Object)
      );
    });

    it('should use default system prompt when agent system prompt is empty string', async () => {
      const agent = createAgent({
        getConversation: vi.fn().mockReturnValue({ systemPrompt: '' }),
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        'You are a helpful AI assistant.',
        expect.any(Object)
      );
    });
  });

  // =========================================================================
  // Cache hit — second call within TTL
  // =========================================================================

  describe('when cache is populated (second call within TTL)', () => {
    it('should not call buildEnhancedSystemPrompt on cache hit', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      mockBuildEnhancedSystemPrompt.mockClear();

      // Second call with same userId+agentId
      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next2 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx2, next2);

      expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
    });

    it('should re-apply cached suffix to agent prompt', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      agent.updateSystemPrompt.mockClear();

      // Second call — agent's prompt is the base prompt (suffix stripped)
      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next2 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx2, next2);

      expect(agent.updateSystemPrompt).toHaveBeenCalledWith(ENHANCED_PROMPT);
    });

    it('should not re-apply suffix if already present in prompt', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      agent.updateSystemPrompt.mockClear();

      // Agent prompt already includes the suffix
      agent.getConversation.mockReturnValue({ systemPrompt: ENHANCED_PROMPT });

      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next2 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx2, next2);

      expect(agent.updateSystemPrompt).not.toHaveBeenCalled();
    });

    it('should set contextStats from cache', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next2 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx2, next2);

      expect(ctx2.set).toHaveBeenCalledWith('contextStats', DEFAULT_STATS);
    });

    it('should call next on cache hit', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      const nextResult = createNextResult();
      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next2 = vi.fn().mockResolvedValue(nextResult);
      await middleware(createMessage(), ctx2, next2);

      expect(next2).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Cache miss — different userId or agentId
  // =========================================================================

  describe('cache miss with different userId or agentId', () => {
    it('should call buildEnhancedSystemPrompt when userId differs', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      mockBuildEnhancedSystemPrompt.mockClear();

      // Different userId
      const ctx2 = createContext({ store: { agent, userId: 'user-2', agentId: 'agent-1' } });
      const next2 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx2, next2);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userId: 'user-2' })
      );
    });

    it('should call buildEnhancedSystemPrompt when agentId differs', async () => {
      const agent = createAgent();
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      const next1 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx1, next1);

      mockBuildEnhancedSystemPrompt.mockClear();

      // Different agentId
      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-2' } });
      const next2 = vi.fn().mockResolvedValue(createNextResult());
      await middleware(createMessage(), ctx2, next2);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ agentId: 'agent-2' })
      );
    });
  });

  // =========================================================================
  // Cache TTL expiry
  // =========================================================================

  describe('cache TTL expiry', () => {
    it('should rebuild when cache entry has expired', async () => {
      vi.useFakeTimers();

      try {
        const agent = createAgent();
        const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
        const next1 = vi.fn().mockResolvedValue(createNextResult());
        await middleware(createMessage(), ctx1, next1);

        expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
        mockBuildEnhancedSystemPrompt.mockClear();

        // Advance past TTL (2 minutes)
        vi.advanceTimersByTime(2 * 60 * 1000 + 1);

        const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
        const next2 = vi.fn().mockResolvedValue(createNextResult());
        await middleware(createMessage(), ctx2, next2);

        expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should use cache when not yet expired', async () => {
      vi.useFakeTimers();

      try {
        const agent = createAgent();
        const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
        const next1 = vi.fn().mockResolvedValue(createNextResult());
        await middleware(createMessage(), ctx1, next1);

        mockBuildEnhancedSystemPrompt.mockClear();

        // Advance just under TTL (1 minute 59 seconds)
        vi.advanceTimersByTime(2 * 60 * 1000 - 1000);

        const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
        const next2 = vi.fn().mockResolvedValue(createNextResult());
        await middleware(createMessage(), ctx2, next2);

        expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // clearInjectionCache()
  // =========================================================================

  describe('clearInjectionCache()', () => {
    it('should clear all cache entries when called without userId', async () => {
      const agent = createAgent();

      // Populate cache for two different users
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      const ctx2 = createContext({ store: { agent, userId: 'user-2', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      mockBuildEnhancedSystemPrompt.mockClear();

      // Clear all
      clearInjectionCache();

      // Both should miss cache now
      const ctx3 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx3, vi.fn().mockResolvedValue(createNextResult()));

      const ctx4 = createContext({ store: { agent, userId: 'user-2', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx4, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledTimes(2);
    });

    it('should clear only entries for the specified userId', async () => {
      const agent = createAgent();

      // Populate cache for two different users
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      const ctx2 = createContext({ store: { agent, userId: 'user-2', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      mockBuildEnhancedSystemPrompt.mockClear();

      // Clear only user-1
      clearInjectionCache('user-1');

      // user-1 should miss cache
      const ctx3 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx3, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      mockBuildEnhancedSystemPrompt.mockClear();

      // user-2 should still hit cache
      const ctx4 = createContext({ store: { agent, userId: 'user-2', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx4, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
    });

    it('should clear multiple entries for the same userId with different agentIds', async () => {
      const agent = createAgent();

      // Populate cache for same user with two different agents
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-a' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-b' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      mockBuildEnhancedSystemPrompt.mockClear();

      // Clear user-1
      clearInjectionCache('user-1');

      // Both should miss cache
      const ctx3 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-a' } });
      await middleware(createMessage(), ctx3, vi.fn().mockResolvedValue(createNextResult()));

      const ctx4 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-b' } });
      await middleware(createMessage(), ctx4, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('when buildEnhancedSystemPrompt throws', () => {
    it('should still call next', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue(new Error('DB connection failed'));
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });

    it('should log warning with error message', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue(new Error('DB connection failed'));
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLog.warn).toHaveBeenCalledWith('Failed to build enhanced prompt', {
        error: 'DB connection failed',
      });
    });

    it('should add warning to context', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue(new Error('DB connection failed'));
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(ctx.addWarning).toHaveBeenCalledWith('Context injection failed: DB connection failed');
    });

    it('should not update agent system prompt on error', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue(new Error('Oops'));
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.updateSystemPrompt).not.toHaveBeenCalled();
    });

    it('should not set contextStats on error', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue(new Error('Oops'));
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const statsCalls = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[0] === 'contextStats'
      );
      expect(statsCalls).toHaveLength(0);
    });

    it('should handle non-Error thrown values', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue('string error');
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockGetErrorMessage).toHaveBeenCalledWith('string error', 'string error');
      expect(next).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Cache cap at 50 entries
  // =========================================================================

  describe('cache cap at 50 entries', () => {
    it('should evict oldest entry when cache reaches 50', async () => {
      const agent = createAgent();

      // Fill cache with 50 entries (user-0 through user-49)
      for (let i = 0; i < 50; i++) {
        mockBuildEnhancedSystemPrompt.mockResolvedValueOnce({
          prompt: BASE_PROMPT + `\n---\n## User Context (from memory)\n- Memory ${i}`,
          stats: { memoriesUsed: 1, goalsUsed: 0 },
        });
        const ctx = createContext({ store: { agent, userId: `user-${i}`, agentId: 'agent-1' } });
        await middleware(createMessage(), ctx, vi.fn().mockResolvedValue(createNextResult()));
      }

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledTimes(50);
      mockBuildEnhancedSystemPrompt.mockClear();
      setupDefaultMock();

      // 51st entry (user-50) should evict user-0 (the oldest)
      const ctx51 = createContext({ store: { agent, userId: 'user-50', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx51, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      mockBuildEnhancedSystemPrompt.mockClear();
      setupDefaultMock();

      // user-0 should be evicted — cache miss
      const ctxEvicted = createContext({ store: { agent, userId: 'user-0', agentId: 'agent-1' } });
      await middleware(createMessage(), ctxEvicted, vi.fn().mockResolvedValue(createNextResult()));

      // user-0 was evicted, so buildEnhancedSystemPrompt should be called
      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      mockBuildEnhancedSystemPrompt.mockClear();

      // user-2 should still be cached — cache hit
      // (user-1 was evicted when user-0 was re-inserted as the 51st entry after user-50 evicted user-0)
      // Actually: after user-50 insertion, cache has user-1..user-50 (50 entries).
      // Then user-0 insertion evicts user-1 (oldest). Cache: user-2..user-50, user-0.
      // So user-2 should still be cached.
      const ctxCached = createContext({ store: { agent, userId: 'user-2', agentId: 'agent-1' } });
      await middleware(createMessage(), ctxCached, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
    });

    it('should evict the oldest entry specifically (user-1 after two evictions)', async () => {
      const agent = createAgent();

      // Fill cache with 50 entries (user-0 through user-49)
      for (let i = 0; i < 50; i++) {
        mockBuildEnhancedSystemPrompt.mockResolvedValueOnce({
          prompt: BASE_PROMPT + `\n---\n## User Context (from memory)\n- Memory ${i}`,
          stats: { memoriesUsed: 1, goalsUsed: 0 },
        });
        const ctx = createContext({ store: { agent, userId: `user-${i}`, agentId: 'agent-1' } });
        await middleware(createMessage(), ctx, vi.fn().mockResolvedValue(createNextResult()));
      }

      mockBuildEnhancedSystemPrompt.mockClear();
      setupDefaultMock();

      // Insert user-50 → evicts user-0. Cache: user-1..user-50
      const ctx50 = createContext({ store: { agent, userId: 'user-50', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx50, vi.fn().mockResolvedValue(createNextResult()));

      // Insert user-51 → evicts user-1. Cache: user-2..user-51
      mockBuildEnhancedSystemPrompt.mockClear();
      setupDefaultMock();
      const ctx51 = createContext({ store: { agent, userId: 'user-51', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx51, vi.fn().mockResolvedValue(createNextResult()));

      mockBuildEnhancedSystemPrompt.mockClear();
      setupDefaultMock();

      // user-1 was evicted — should be a cache miss
      const ctxEvicted = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctxEvicted, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // stripInjectedSections
  // =========================================================================

  describe('stripInjectedSections behavior', () => {
    it('should strip User Context section from prompt on cache re-apply', async () => {
      const agent = createAgent();

      // First call populates cache
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      agent.updateSystemPrompt.mockClear();

      // Agent prompt already has old injected sections
      const oldPrompt = BASE_PROMPT + '\n---\n## User Context (from memory)\n- Old memory';
      agent.getConversation.mockReturnValue({ systemPrompt: oldPrompt });

      // Second call should strip old, apply cached
      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      expect(agent.updateSystemPrompt).toHaveBeenCalledWith(ENHANCED_PROMPT);
    });

    it('should strip Active Goals section', async () => {
      const goalsOnlyPrompt = BASE_PROMPT + '\n---\n## Active Goals\n- Some goal';
      const agent = createAgent({
        getConversation: vi.fn().mockReturnValue({ systemPrompt: goalsOnlyPrompt }),
      });

      // The enhanced prompt will be based on the base prompt (after stripping)
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: BASE_PROMPT + INJECTED_SUFFIX,
        stats: DEFAULT_STATS,
      });

      const ctx = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx, vi.fn().mockResolvedValue(createNextResult()));

      // buildEnhancedSystemPrompt should receive prompt with goals stripped out
      // The middleware strips before passing to buildEnhancedSystemPrompt? No.
      // Actually: middleware passes currentSystemPrompt AS-IS to buildEnhancedSystemPrompt.
      // The stripping happens only for extracting the injectedSuffix and cache re-apply.
      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        goalsOnlyPrompt,
        expect.any(Object)
      );
    });

    it('should strip Available Data Resources section', async () => {
      const dataPrompt = BASE_PROMPT + '\n---\n## Available Data Resources\n- Resource 1';
      const agent = createAgent({
        getConversation: vi.fn().mockReturnValue({ systemPrompt: dataPrompt }),
      });

      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: dataPrompt,
        stats: { memoriesUsed: 0, goalsUsed: 0 },
      });

      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      // On second call with cache, the suffix is computed by stripping base from enhanced
      // stripInjectedSections(dataPrompt) → BASE_PROMPT (strips at Available Data Resources marker)
      // injectedSuffix = dataPrompt.slice(BASE_PROMPT.length) = '\n---\n## Available Data Resources\n- Resource 1'
      // (because the enhanced prompt equals the original — no memories/goals added)

      // Reset for cache test
      agent.updateSystemPrompt.mockClear();
      agent.getConversation.mockReturnValue({ systemPrompt: dataPrompt });

      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      // Prompt already includes the suffix — no update needed
      expect(agent.updateSystemPrompt).not.toHaveBeenCalled();
    });

    it('should strip Autonomy Level section', async () => {
      const agent = createAgent();

      // Enhanced prompt includes autonomy section
      const autonomySuffix =
        '\n---\n## Autonomy Level: balanced\nYou can act with moderate autonomy.';
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: BASE_PROMPT + autonomySuffix,
        stats: { memoriesUsed: 0, goalsUsed: 0 },
      });

      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      agent.updateSystemPrompt.mockClear();

      // On cache re-apply, old autonomy section in prompt should be stripped
      agent.getConversation.mockReturnValue({
        systemPrompt: BASE_PROMPT + '\n---\n## Autonomy Level: passive\nOld autonomy level.',
      });

      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      expect(agent.updateSystemPrompt).toHaveBeenCalledWith(BASE_PROMPT + autonomySuffix);
    });

    it('should strip from earliest marker when multiple sections present', async () => {
      const agent = createAgent();

      const multiSuffix =
        '\n---\n## User Context (from memory)\n- Mem 1' +
        '\n---\n## Active Goals\n- Goal 1' +
        '\n---\n## Autonomy Level: balanced\nAuto level';
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: BASE_PROMPT + multiSuffix,
        stats: { memoriesUsed: 1, goalsUsed: 1 },
      });

      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      agent.updateSystemPrompt.mockClear();

      // On re-apply with a different old suffix
      agent.getConversation.mockReturnValue({
        systemPrompt:
          BASE_PROMPT +
          '\n---\n## Active Goals\n- Old goal\n---\n## User Context (from memory)\n- Old mem',
      });

      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      expect(agent.updateSystemPrompt).toHaveBeenCalledWith(BASE_PROMPT + multiSuffix);
    });

    it('should preserve prompt when no markers are present', async () => {
      const agent = createAgent();

      // Enhanced prompt only adds a simple suffix (no markers)
      const simpleEnhanced = BASE_PROMPT + '\nSome extra context';
      mockBuildEnhancedSystemPrompt.mockResolvedValue({
        prompt: simpleEnhanced,
        stats: { memoriesUsed: 0, goalsUsed: 0 },
      });

      const ctx = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await middleware(createMessage(), ctx, vi.fn().mockResolvedValue(createNextResult()));

      // stripInjectedSections(BASE_PROMPT) finds no markers → returns full prompt
      // injectedSuffix = simpleEnhanced.slice(BASE_PROMPT.length) = '\nSome extra context'
      // Enhanced prompt differs from current → updateSystemPrompt called
      expect(agent.updateSystemPrompt).toHaveBeenCalledWith(simpleEnhanced);
    });
  });

  // =========================================================================
  // Return value
  // =========================================================================

  describe('return value', () => {
    it('should return the result of next()', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const nextResult = createNextResult({ durationMs: 123 });
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(result).toBe(nextResult);
    });

    it('should return next result even when error occurs', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValue(new Error('fail'));
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const nextResult = createNextResult({ durationMs: 456 });
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(result).toBe(nextResult);
    });
  });

  // =========================================================================
  // Multiple middleware instances
  // =========================================================================

  describe('multiple middleware instances share cache', () => {
    it('should share cache between different middleware instances', async () => {
      const mw1 = createContextInjectionMiddleware();
      const mw2 = createContextInjectionMiddleware();

      const agent = createAgent();

      // First call with mw1
      const ctx1 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await mw1(createMessage(), ctx1, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledOnce();
      mockBuildEnhancedSystemPrompt.mockClear();

      // Second call with mw2 — same userId+agentId should hit cache
      const ctx2 = createContext({ store: { agent, userId: 'user-1', agentId: 'agent-1' } });
      await mw2(createMessage(), ctx2, vi.fn().mockResolvedValue(createNextResult()));

      expect(mockBuildEnhancedSystemPrompt).not.toHaveBeenCalled();
    });
  });
});
