/**
 * Agent Execution Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  NormalizedMessage,
  MessageProcessingResult,
  PipelineContext,
  StreamCallbacks,
} from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { FIXED_UUID, mockCheckToolCallApproval, mockLog } = vi.hoisted(() => ({
  FIXED_UUID: '00000000-0000-0000-0000-000000000001',
  mockCheckToolCallApproval: vi.fn(),
  mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => FIXED_UUID,
}));

vi.mock('../../assistant/index.js', () => ({
  checkToolCallApproval: (...args: unknown[]) => mockCheckToolCallApproval(...args),
}));

vi.mock('../log.js', () => ({
  getLog: () => mockLog,
}));

// Import after mocks are set up
import { createAgentExecutionMiddleware } from './agent-execution.js';

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

interface ChatAgent {
  chat: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  setAdditionalTools?: ReturnType<typeof vi.fn>;
  clearAdditionalTools?: ReturnType<typeof vi.fn>;
}

function createAgent(overrides?: Partial<ChatAgent>): ChatAgent {
  return {
    chat: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: 'resp-1',
        content: 'Hello user',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
    }),
    getConversation: vi.fn().mockReturnValue({ id: 'conv-1' }),
    setAdditionalTools: vi.fn(),
    clearAdditionalTools: vi.fn(),
    ...overrides,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAgentExecutionMiddleware', () => {
  let middleware: ReturnType<typeof createAgentExecutionMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = createAgentExecutionMiddleware();
  });

  // =========================================================================
  // No agent in context
  // =========================================================================

  describe('when no agent is in context', () => {
    it('should add warning, abort, and call next', async () => {
      const ctx = createContext();
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(ctx.addWarning).toHaveBeenCalledWith('No agent in context');
      expect(ctx.aborted).toBe(true);
      expect(ctx.abortReason).toBe('No agent available to process message');
      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });
  });

  // =========================================================================
  // Successful agent.chat()
  // =========================================================================

  describe('when agent.chat() succeeds', () => {
    it('should set agentResult and durationMs in context', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(ctx.set).toHaveBeenCalledWith('agentResult', expect.objectContaining({ ok: true }));
      expect(ctx.set).toHaveBeenCalledWith('durationMs', expect.any(Number));
    });

    it('should build a response message with correct fields', async () => {
      const agent = createAgent();
      const ctx = createContext({
        store: { agent, provider: 'openai', model: 'gpt-4' },
      });
      const msg = createMessage({ sessionId: 'sess-42', metadata: { source: 'telegram' } });
      const next = vi.fn().mockImplementation(async () => {
        // Return the pipelineResult that was set in context so we can inspect it
        const pipelineResult = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pipelineResult;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.id).toBe('resp-1');
      expect(result.response.sessionId).toBe('sess-42');
      expect(result.response.role).toBe('assistant');
      expect(result.response.content).toBe('Hello user');
      expect(result.response.metadata).toMatchObject({
        source: 'telegram',
        provider: 'openai',
        model: 'gpt-4',
        conversationId: 'conv-1',
      });
    });

    it('should set pipelineResult in context and return it directly', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);

      expect(ctx.set).toHaveBeenCalledWith(
        'pipelineResult',
        expect.objectContaining({
          streamed: false,
          stages: ['agent-execution'],
        })
      );
      // Agent-execution is the innermost middleware; it returns its own result
      // instead of calling next() (which would return empty content)
      expect(next).not.toHaveBeenCalled();
      expect(result.response.content).toBe('Hello user');
    });

    it('should use randomUUID when result.value has no id', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: undefined, content: 'no-id response' },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.id).toBe(FIXED_UUID);
    });

    it('should set streamed to true when stream callbacks are present', async () => {
      const agent = createAgent();
      const stream: StreamCallbacks = { onChunk: vi.fn() };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.streamed).toBe(true);
    });
  });

  // =========================================================================
  // Failed agent.chat() (result.ok = false)
  // =========================================================================

  describe('when agent.chat() returns result.ok = false', () => {
    it('should return error response without calling next', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: false,
        error: { message: 'Rate limit exceeded' },
      });
      const ctx = createContext({ store: { agent, provider: 'openai', model: 'gpt-4' } });
      const msg = createMessage({ sessionId: 'sess-err' });
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(result.response.role).toBe('assistant');
      expect(result.response.content).toBe('Error: Rate limit exceeded');
      expect(result.response.sessionId).toBe('sess-err');
      expect(result.response.metadata).toMatchObject({
        provider: 'openai',
        model: 'gpt-4',
        error: 'Rate limit exceeded',
      });
      expect(result.stages).toEqual(['agent-execution']);
      expect(result.warnings).toEqual(['Agent error: Rate limit exceeded']);
    });

    it('should set error in context', async () => {
      const errObj = { message: 'Server error', stack: 'stack...' };
      const agent = createAgent();
      agent.chat.mockResolvedValue({ ok: false, error: errObj });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(ctx.set).toHaveBeenCalledWith('error', errObj);
    });

    it('should handle missing error message with "Unknown error"', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({ ok: false });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);

      expect(result.response.content).toBe('Error: Unknown error');
    });

    it('should set streamed flag based on stream presence', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({ ok: false, error: { message: 'fail' } });
      const stream: StreamCallbacks = { onChunk: vi.fn() };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);

      expect(result.streamed).toBe(true);
    });
  });

  // =========================================================================
  // Agent.chat() throws
  // =========================================================================

  describe('when agent.chat() throws', () => {
    it('should return error response with the thrown error message', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue(new Error('Network timeout'));
      const ctx = createContext({ store: { agent } });
      const msg = createMessage({ sessionId: 'sess-throw' });
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(result.response.content).toBe('Error: Network timeout');
      expect(result.response.sessionId).toBe('sess-throw');
      expect(result.stages).toEqual(['agent-execution']);
      expect(result.warnings).toEqual(['Agent execution error: Network timeout']);
    });

    it('should log the error', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue(new Error('Connection lost'));
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLog.error).toHaveBeenCalledWith(
        'Agent execution failed',
        expect.objectContaining({ error: 'Connection lost' })
      );
    });

    it('should wrap non-Error thrown values in Error', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue('string error');
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      const result = await middleware(msg, ctx, next);

      expect(result.response.content).toBe('Error: string error');
      expect(result.warnings).toEqual(['Agent execution error: string error']);
    });
  });

  // =========================================================================
  // Usage tracking
  // =========================================================================

  describe('usage tracking', () => {
    it('should set usage in context when available', async () => {
      const usage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: 'r1', content: 'hi', usage },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(ctx.set).toHaveBeenCalledWith('usage', usage);
    });

    it('should not set usage when not provided', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: 'r1', content: 'hi' },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const usageCalls = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[0] === 'usage'
      );
      expect(usageCalls).toHaveLength(0);
    });

    it('should include token counts in response metadata', async () => {
      const usage = { promptTokens: 50, completionTokens: 150, totalTokens: 200 };
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: 'r1', content: 'tokens', usage },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.metadata).toMatchObject({
        tokens: { input: 50, output: 150 },
      });
    });
  });

  // =========================================================================
  // Context values / defaults
  // =========================================================================

  describe('context values and defaults', () => {
    it('should use defaults for userId, agentId, provider, model', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.metadata).toMatchObject({
        provider: 'unknown',
        model: 'unknown',
      });
    });

    it('should read custom values from context', async () => {
      const agent = createAgent();
      const ctx = createContext({
        store: {
          agent,
          userId: 'user-42',
          agentId: 'assistant-v2',
          provider: 'anthropic',
          model: 'claude-3',
          conversationId: 'conv-99',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.metadata).toMatchObject({
        provider: 'anthropic',
        model: 'claude-3',
      });
    });
  });

  // =========================================================================
  // Direct tools
  // =========================================================================

  describe('direct tools', () => {
    it('should call setAdditionalTools before chat and clearAdditionalTools after', async () => {
      const agent = createAgent();
      const tools = ['tool-a', 'tool-b'];
      const ctx = createContext({ store: { agent, directTools: tools } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      const callOrder: string[] = [];
      agent.setAdditionalTools!.mockImplementation(() => {
        callOrder.push('set');
      });
      agent.chat.mockImplementation(async () => {
        callOrder.push('chat');
        return { ok: true, value: { id: 'r', content: 'ok' } };
      });
      agent.clearAdditionalTools!.mockImplementation(() => {
        callOrder.push('clear');
      });

      await middleware(msg, ctx, next);

      expect(agent.setAdditionalTools).toHaveBeenCalledWith(tools);
      expect(agent.clearAdditionalTools).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['set', 'chat', 'clear']);
    });

    it('should not call setAdditionalTools when directTools is empty', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent, directTools: [] } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.setAdditionalTools).not.toHaveBeenCalled();
    });

    it('should not call setAdditionalTools when directTools is undefined', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.setAdditionalTools).not.toHaveBeenCalled();
    });

    it('should skip setAdditionalTools when agent does not support it', async () => {
      const agent = createAgent();
      delete agent.setAdditionalTools;
      delete agent.clearAdditionalTools;
      const ctx = createContext({ store: { agent, directTools: ['tool-x'] } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      // Should not throw
      await middleware(msg, ctx, next);

      expect(agent.chat).toHaveBeenCalledOnce();
    });

    it('should clear direct tools on error', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue(new Error('boom'));
      const ctx = createContext({ store: { agent, directTools: ['tool-a'] } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.clearAdditionalTools).toHaveBeenCalledOnce();
    });

    it('should not call clearAdditionalTools on error when agent lacks it', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue(new Error('boom'));
      delete agent.clearAdditionalTools;
      const ctx = createContext({ store: { agent, directTools: ['tool-a'] } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      // Should not throw
      await expect(middleware(msg, ctx, next)).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Stream callbacks
  // =========================================================================

  describe('stream callbacks', () => {
    it('should pass onChunk, onToolStart, onToolEnd, onProgress to chat options', async () => {
      const agent = createAgent();
      const onChunk = vi.fn();
      const onToolStart = vi.fn();
      const onToolEnd = vi.fn();
      const onProgress = vi.fn();
      const stream: StreamCallbacks = { onChunk, onToolStart, onToolEnd, onProgress };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const chatOptions = agent.chat.mock.calls[0][1] as Record<string, unknown>;
      expect(chatOptions.stream).toBe(true);
      expect(chatOptions.onChunk).toBe(onChunk);
      expect(chatOptions.onToolStart).toBe(onToolStart);
      expect(chatOptions.onToolEnd).toBe(onToolEnd);
      expect(chatOptions.onProgress).toBe(onProgress);
    });

    it('should use stream onBeforeToolCall if provided', async () => {
      const agent = createAgent();
      const onBeforeToolCall = vi.fn().mockResolvedValue({ approved: true });
      const stream: StreamCallbacks = { onBeforeToolCall };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const chatOptions = agent.chat.mock.calls[0][1] as Record<string, unknown>;
      expect(chatOptions.onBeforeToolCall).toBe(onBeforeToolCall);
      expect(mockCheckToolCallApproval).not.toHaveBeenCalled();
    });

    it('should call stream.onDone with pipelineResult', async () => {
      const agent = createAgent();
      const onDone = vi.fn();
      const stream: StreamCallbacks = { onDone };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(onDone).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            content: 'Hello user',
            role: 'assistant',
          }),
        })
      );
    });

    it('should call stream.onError when agent throws', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue(new Error('stream fail'));
      const onError = vi.fn();
      const stream: StreamCallbacks = { onError };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(onError).toHaveBeenCalledOnce();
      const passedError = onError.mock.calls[0][0] as Error;
      expect(passedError).toBeInstanceOf(Error);
      expect(passedError.message).toBe('stream fail');
    });

    it('should not fail when stream has no onDone callback', async () => {
      const agent = createAgent();
      const stream: StreamCallbacks = { onChunk: vi.fn() };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await expect(middleware(msg, ctx, next)).resolves.toBeDefined();
    });

    it('should not fail when stream has no onError callback', async () => {
      const agent = createAgent();
      agent.chat.mockRejectedValue(new Error('no handler'));
      const stream: StreamCallbacks = { onChunk: vi.fn() };
      const ctx = createContext({ store: { agent, stream } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await expect(middleware(msg, ctx, next)).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Default onBeforeToolCall (checkToolCallApproval)
  // =========================================================================

  describe('default onBeforeToolCall', () => {
    it('should use checkToolCallApproval when stream has no onBeforeToolCall', async () => {
      mockCheckToolCallApproval.mockResolvedValue({ approved: true, requiresApproval: false });
      const agent = createAgent();
      const ctx = createContext({
        store: {
          agent,
          userId: 'user-1',
          agentId: 'agent-1',
          provider: 'openai',
          model: 'gpt-4',
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      // Extract the onBeforeToolCall from the chat options and invoke it
      const chatOptions = agent.chat.mock.calls[0][1] as Record<string, unknown>;
      const onBeforeToolCall = chatOptions.onBeforeToolCall as (tc: {
        id: string;
        name: string;
        arguments: string;
      }) => Promise<{ approved: boolean; reason?: string }>;

      const toolCall = { id: 'tc-1', name: 'search', arguments: '{}' };
      const result = await onBeforeToolCall(toolCall);

      expect(mockCheckToolCallApproval).toHaveBeenCalledWith('user-1', toolCall, {
        agentId: 'agent-1',
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4',
      });
      expect(result).toEqual({ approved: true, reason: undefined });
    });

    it('should log blocked tool calls', async () => {
      mockCheckToolCallApproval.mockResolvedValue({
        approved: false,
        requiresApproval: true,
        reason: 'Dangerous operation',
      });
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const chatOptions = agent.chat.mock.calls[0][1] as Record<string, unknown>;
      const onBeforeToolCall = chatOptions.onBeforeToolCall as (tc: {
        id: string;
        name: string;
        arguments: string;
      }) => Promise<{ approved: boolean; reason?: string }>;

      const result = await onBeforeToolCall({ id: 'tc-2', name: 'delete_file', arguments: '{}' });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('Dangerous operation');
      expect(mockLog.info).toHaveBeenCalledWith(
        'Tool call blocked: delete_file - Dangerous operation'
      );
    });

    it('should use fallback reason text when none is provided', async () => {
      mockCheckToolCallApproval.mockResolvedValue({
        approved: false,
        requiresApproval: true,
      });
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const chatOptions = agent.chat.mock.calls[0][1] as Record<string, unknown>;
      const onBeforeToolCall = chatOptions.onBeforeToolCall as (tc: {
        id: string;
        name: string;
        arguments: string;
      }) => Promise<{ approved: boolean; reason?: string }>;

      await onBeforeToolCall({ id: 'tc-3', name: 'rm_rf', arguments: '{}' });

      expect(mockLog.info).toHaveBeenCalledWith('Tool call blocked: rm_rf - Requires approval');
    });

    it('should wire up default onBeforeToolCall even without stream', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const chatOptions = agent.chat.mock.calls[0][1] as Record<string, unknown>;
      expect(chatOptions.onBeforeToolCall).toBeDefined();
      expect(typeof chatOptions.onBeforeToolCall).toBe('function');
    });
  });

  // =========================================================================
  // Tool calls in response
  // =========================================================================

  describe('tool calls in response', () => {
    it('should parse tool call arguments with JSON.parse', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: {
          id: 'r1',
          content: 'Ran tools',
          toolCalls: [
            { id: 'tc-1', name: 'search', arguments: '{"query":"test"}' },
            { id: 'tc-2', name: 'read', arguments: '{"path":"/tmp"}' },
          ],
        },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      const toolCalls = result.response.metadata.toolCalls as Array<{
        id: string;
        name: string;
        arguments: unknown;
      }>;
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]).toEqual({ id: 'tc-1', name: 'search', arguments: { query: 'test' } });
      expect(toolCalls[1]).toEqual({ id: 'tc-2', name: 'read', arguments: { path: '/tmp' } });
    });

    it('should use empty object for empty arguments string', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: {
          id: 'r1',
          content: 'ok',
          toolCalls: [{ id: 'tc-1', name: 'noop', arguments: '' }],
        },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      const toolCalls = result.response.metadata.toolCalls as Array<{
        id: string;
        name: string;
        arguments: unknown;
      }>;
      expect(toolCalls[0].arguments).toEqual({});
    });

    it('should not include toolCalls when there are none', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: 'r1', content: 'no tools' },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.metadata.toolCalls).toBeUndefined();
    });
  });

  // =========================================================================
  // Message content passed to agent
  // =========================================================================

  describe('message content forwarding', () => {
    it('should pass message.content to agent.chat', async () => {
      const agent = createAgent();
      const ctx = createContext({ store: { agent } });
      const msg = createMessage({ content: 'What is the weather?' });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(agent.chat).toHaveBeenCalledWith('What is the weather?', expect.any(Object));
    });
  });

  // =========================================================================
  // Response metadata tokens
  // =========================================================================

  describe('response metadata tokens', () => {
    it('should omit tokens when usage is not provided', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: 'r1', content: 'no usage' },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.metadata.tokens).toBeUndefined();
    });
  });

  // =========================================================================
  // Response content fallback
  // =========================================================================

  describe('response content fallback', () => {
    it('should default to empty string when result.value.content is undefined', async () => {
      const agent = createAgent();
      agent.chat.mockResolvedValue({
        ok: true,
        value: { id: 'r1' },
      });
      const ctx = createContext({ store: { agent } });
      const msg = createMessage();
      const next = vi.fn().mockImplementation(async () => {
        const pr = (ctx.set as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) => c[0] === 'pipelineResult'
        )?.[1] as MessageProcessingResult;
        return pr;
      });

      const result = await middleware(msg, ctx, next);

      expect(result.response.content).toBe('');
    });
  });
});
