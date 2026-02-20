/**
 * Persistence Middleware Tests
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

const { mockChatRepo, mockTruncate, mockBroadcast, mockLog } = vi.hoisted(() => ({
  mockChatRepo: {
    getOrCreateConversation: vi.fn(),
    addMessage: vi.fn(),
  },
  mockTruncate: vi.fn((text: string) => text),
  mockBroadcast: vi.fn(),
  mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../db/repositories/index.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  ChatRepository: vi.fn(function () { return mockChatRepo; }),
}));

vi.mock('../../routes/helpers.js', () => ({
  truncate: (...args: unknown[]) => mockTruncate(...args),
}));

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: (...args: unknown[]) => mockBroadcast(...args) },
}));

vi.mock('../log.js', () => ({
  getLog: () => mockLog,
}));

// Import after mocks are set up
import { createPersistenceMiddleware } from './persistence.js';
import { ChatRepository } from '../../db/repositories/index.js';

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
      metadata: { source: 'web' },
      timestamp: new Date(),
    },
    streamed: false,
    durationMs: 50,
    stages: ['agent-execution', 'post-processing'],
    ...overrides,
  };
}

/** A successful agentResult to place in context */
function createAgentResult(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    value: {
      content: 'Hello user',
      toolCalls: undefined as unknown[] | undefined,
      usage: { promptTokens: 10, completionTokens: 20 },
    },
    ...overrides,
  };
}

/** A Conversation record as returned by ChatRepository */
function createDbConversation(overrides?: Record<string, unknown>) {
  return {
    id: 'conv-db-1',
    userId: 'user-1',
    title: 'Hello agent',
    agentId: null,
    agentName: 'Chat',
    provider: 'openai',
    model: 'gpt-4',
    systemPrompt: null,
    messageCount: 5,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPersistenceMiddleware', () => {
  let middleware: ReturnType<typeof createPersistenceMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = createPersistenceMiddleware();

    // Default mock implementations (re-set after clearAllMocks)
    mockTruncate.mockImplementation((text: string) => text);
    mockChatRepo.getOrCreateConversation.mockResolvedValue(createDbConversation());
    mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-db-1' });
  });

  // =========================================================================
  // Calls next() first
  // =========================================================================

  describe('pipeline ordering', () => {
    it('should call next() first and return its result', async () => {
      const ctx = createContext({
        store: { agentResult: createAgentResult(), conversationId: 'conv-1' },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(result).toBe(nextResult);
    });
  });

  // =========================================================================
  // agentResult.ok = false → skip persistence
  // =========================================================================

  describe('when agentResult.ok is false', () => {
    it('should return result unchanged without saving', async () => {
      const ctx = createContext({
        store: { agentResult: { ok: false, error: { message: 'Rate limit' } } },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(result).toBe(nextResult);
      expect(ChatRepository).not.toHaveBeenCalled();
      expect(mockChatRepo.getOrCreateConversation).not.toHaveBeenCalled();
      expect(mockChatRepo.addMessage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // agentResult is undefined → skip persistence
  // =========================================================================

  describe('when agentResult is undefined', () => {
    it('should return result unchanged without saving', async () => {
      const ctx = createContext(); // no agentResult in store
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(result).toBe(nextResult);
      expect(ChatRepository).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Missing conversationId → skip with warning
  // =========================================================================

  describe('when conversationId is missing', () => {
    it('should add warning and skip persistence', async () => {
      const ctx = createContext({
        store: { agentResult: createAgentResult() },
      });
      // No conversationId in context store, and result metadata also has no conversationId
      const nextResult = createNextResult({
        response: {
          id: 'r',
          sessionId: 's',
          role: 'assistant',
          content: 'ok',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);
      const msg = createMessage();

      const result = await middleware(msg, ctx, next);

      expect(ctx.addWarning).toHaveBeenCalledWith('No conversationId — skipping persistence');
      expect(result).toBe(nextResult);
      expect(ChatRepository).not.toHaveBeenCalled();
    });

    it('should use conversationId from result metadata as fallback', async () => {
      const ctx = createContext({
        store: { agentResult: createAgentResult() },
      });
      // conversationId not in context store, but present in result.response.metadata
      const nextResult = createNextResult({
        response: {
          id: 'r',
          sessionId: 's',
          role: 'assistant',
          content: 'ok',
          metadata: { source: 'web', conversationId: 'conv-from-metadata' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);
      const msg = createMessage();

      await middleware(msg, ctx, next);

      expect(ctx.addWarning).not.toHaveBeenCalledWith('No conversationId — skipping persistence');
      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
        'conv-from-metadata',
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // getOrCreateConversation called with correct params
  // =========================================================================

  describe('getOrCreateConversation', () => {
    it('should be called with conversationId and correct options', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-42',
          agentId: 'agent-7',
          provider: 'anthropic',
          model: 'claude-3',
        },
      });
      const msg = createMessage({ content: 'Tell me about TypeScript' });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith('conv-42', {
        title: 'Tell me about TypeScript',
        agentId: 'agent-7',
        agentName: undefined,
        provider: 'anthropic',
        model: 'claude-3',
      });
    });

    it('should use truncate() for the title', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({ content: 'A very long message content' });
      const next = vi.fn().mockResolvedValue(createNextResult());
      mockTruncate.mockReturnValue('A very long...');

      await middleware(msg, ctx, next);

      expect(mockTruncate).toHaveBeenCalledWith('A very long message content');
      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ title: 'A very long...' }),
      );
    });

    it('should set agentName to "Chat" when agentId is not present', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ agentName: 'Chat' }),
      );
    });

    it('should set agentName to undefined when agentId is present', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
          agentId: 'my-agent',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ agentName: undefined, agentId: 'my-agent' }),
      );
    });
  });

  // =========================================================================
  // addMessage — user + assistant
  // =========================================================================

  describe('addMessage calls', () => {
    it('should call addMessage twice (user + assistant)', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
          provider: 'openai',
          model: 'gpt-4',
        },
      });
      const msg = createMessage({ content: 'Hello' });
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      await middleware(msg, ctx, next);

      expect(mockChatRepo.addMessage).toHaveBeenCalledTimes(2);
    });

    it('should save user message with correct fields', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
          provider: 'openai',
          model: 'gpt-4',
        },
      });
      const dbConv = createDbConversation({ id: 'conv-db-99' });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);
      const msg = createMessage({ content: 'User says hello' });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall).toEqual({
        conversationId: 'conv-db-99',
        role: 'user',
        content: 'User says hello',
        provider: 'openai',
        model: 'gpt-4',
      });
    });

    it('should save assistant message with correct fields', async () => {
      const agentResult = createAgentResult({
        value: {
          content: 'Assistant response',
          usage: { promptTokens: 100, completionTokens: 200 },
        },
      });
      const ctx = createContext({
        store: {
          agentResult,
          conversationId: 'conv-1',
          provider: 'anthropic',
          model: 'claude-3',
        },
      });
      const dbConv = createDbConversation({ id: 'conv-db-77' });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Pipeline content',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall).toEqual({
        conversationId: 'conv-db-77',
        role: 'assistant',
        content: 'Pipeline content',
        provider: 'anthropic',
        model: 'claude-3',
        toolCalls: undefined,
        trace: undefined,
        inputTokens: 100,
        outputTokens: 200,
      });
    });

    it('should include toolCalls in assistant message when present', async () => {
      const toolCalls = [
        { id: 'tc-1', name: 'search', arguments: '{"q":"test"}' },
        { id: 'tc-2', name: 'read', arguments: '{"path":"/tmp"}' },
      ];
      const agentResult = createAgentResult({
        value: {
          content: 'Used tools',
          toolCalls,
          usage: { promptTokens: 50, completionTokens: 100 },
        },
      });
      const ctx = createContext({
        store: {
          agentResult,
          conversationId: 'conv-1',
        },
      });
      const next = vi.fn().mockResolvedValue(createNextResult());
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall.toolCalls).toEqual([...toolCalls]);
    });

    it('should include traceInfo in assistant message when present', async () => {
      const traceInfo = { steps: 3, duration: 1200 };
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
          traceInfo,
        },
      });
      const next = vi.fn().mockResolvedValue(createNextResult());
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall.trace).toEqual({ steps: 3, duration: 1200 });
    });

    it('should set trace to undefined when traceInfo is not in context', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const next = vi.fn().mockResolvedValue(createNextResult());
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall.trace).toBeUndefined();
    });

    it('should include token counts from agentResult usage', async () => {
      const agentResult = createAgentResult({
        value: {
          content: 'tokens',
          usage: { promptTokens: 500, completionTokens: 1500 },
        },
      });
      const ctx = createContext({
        store: {
          agentResult,
          conversationId: 'conv-1',
        },
      });
      const next = vi.fn().mockResolvedValue(createNextResult());
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall.inputTokens).toBe(500);
      expect(assistantMsgCall.outputTokens).toBe(1500);
    });

    it('should set token counts to undefined when usage is missing', async () => {
      const agentResult = createAgentResult({
        value: { content: 'no usage' },
      });
      const ctx = createContext({
        store: {
          agentResult,
          conversationId: 'conv-1',
        },
      });
      const next = vi.fn().mockResolvedValue(createNextResult());
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall.inputTokens).toBeUndefined();
      expect(assistantMsgCall.outputTokens).toBeUndefined();
    });
  });

  // =========================================================================
  // Attachments metadata (without data/base64)
  // =========================================================================

  describe('attachments metadata', () => {
    it('should include attachment metadata without data/base64 for image attachments', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({
        attachments: [
          {
            type: 'image',
            mimeType: 'image/png',
            filename: 'screenshot.png',
            size: 12345,
            data: 'base64encodeddata...',
            url: 'https://example.com/img.png',
          },
        ],
      });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall.attachments).toEqual([
        {
          type: 'image',
          mimeType: 'image/png',
          filename: 'screenshot.png',
          size: 12345,
        },
      ]);
    });

    it('should include attachment metadata without data/base64 for file attachments', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({
        attachments: [
          {
            type: 'file',
            mimeType: 'application/pdf',
            filename: 'report.pdf',
            size: 99999,
            data: 'huge-base64-blob',
          },
        ],
      });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall.attachments).toEqual([
        {
          type: 'file',
          mimeType: 'application/pdf',
          filename: 'report.pdf',
          size: 99999,
        },
      ]);
    });

    it('should filter out audio and video attachment types', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({
        attachments: [
          { type: 'audio', mimeType: 'audio/mp3', filename: 'song.mp3', size: 5000 },
          { type: 'video', mimeType: 'video/mp4', filename: 'clip.mp4', size: 9000 },
          { type: 'image', mimeType: 'image/jpeg', filename: 'photo.jpg', size: 2000 },
        ],
      });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall.attachments).toEqual([
        {
          type: 'image',
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
          size: 2000,
        },
      ]);
    });

    it('should not include attachments field when message has no attachments', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage(); // no attachments
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall.attachments).toBeUndefined();
    });

    it('should not include attachments field when attachments array is empty', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({ attachments: [] });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall.attachments).toBeUndefined();
    });

    it('should handle multiple image and file attachments', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({
        attachments: [
          { type: 'image', mimeType: 'image/png', filename: 'a.png', size: 100, data: 'blob1' },
          { type: 'file', mimeType: 'text/plain', filename: 'b.txt', size: 200, data: 'blob2' },
          { type: 'image', mimeType: 'image/gif', filename: 'c.gif', size: 300 },
        ],
      });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsgCall.attachments).toEqual([
        { type: 'image', mimeType: 'image/png', filename: 'a.png', size: 100 },
        { type: 'file', mimeType: 'text/plain', filename: 'b.txt', size: 200 },
        { type: 'image', mimeType: 'image/gif', filename: 'c.gif', size: 300 },
      ]);
    });
  });

  // =========================================================================
  // wsGateway.broadcast
  // =========================================================================

  describe('wsGateway.broadcast', () => {
    it('should broadcast chat:history:updated after successful save', async () => {
      const dbConv = createDbConversation({ id: 'conv-db-55', title: 'My Chat', messageCount: 10 });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBroadcast).toHaveBeenCalledWith('chat:history:updated', {
        conversationId: 'conv-db-55',
        title: 'My Chat',
        source: 'web',
        messageCount: 12, // messageCount + 2
      });
    });

    it('should use message source from metadata', async () => {
      const dbConv = createDbConversation({ messageCount: 3 });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({ metadata: { source: 'telegram' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBroadcast).toHaveBeenCalledWith(
        'chat:history:updated',
        expect.objectContaining({ source: 'telegram' }),
      );
    });

    it('should default source to "web" when metadata.source is undefined', async () => {
      const dbConv = createDbConversation({ messageCount: 0 });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage({ metadata: { source: undefined as unknown as 'web' } });
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBroadcast).toHaveBeenCalledWith(
        'chat:history:updated',
        expect.objectContaining({ source: 'web' }),
      );
    });

    it('should not broadcast when persistence is skipped (agentResult.ok=false)', async () => {
      const ctx = createContext({
        store: { agentResult: { ok: false } },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Error handling — ChatRepository throws
  // =========================================================================

  describe('when ChatRepository throws', () => {
    it('should log the error and add warning, but still return result', async () => {
      mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB connection lost'));
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(mockLog.warn).toHaveBeenCalledWith('Failed to save chat history', {
        error: expect.any(Error),
      });
      expect(ctx.addWarning).toHaveBeenCalledWith('Persistence failed');
      expect(result).toBe(nextResult);
    });

    it('should handle addMessage failure after getOrCreateConversation succeeds', async () => {
      mockChatRepo.addMessage.mockRejectedValue(new Error('Insert failed'));
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const nextResult = createNextResult();
      const next = vi.fn().mockResolvedValue(nextResult);

      const result = await middleware(msg, ctx, next);

      expect(mockLog.warn).toHaveBeenCalledWith('Failed to save chat history', {
        error: expect.any(Error),
      });
      expect(ctx.addWarning).toHaveBeenCalledWith('Persistence failed');
      expect(result).toBe(nextResult);
    });

    it('should not broadcast when persistence fails', async () => {
      mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB down'));
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // userId fallback to 'default'
  // =========================================================================

  describe('userId fallback', () => {
    it('should pass userId to ChatRepository constructor', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
          userId: 'user-42',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(ChatRepository).toHaveBeenCalledWith('user-42');
    });

    it('should fallback to "default" when userId is not in context', async () => {
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(ChatRepository).toHaveBeenCalledWith('default');
    });
  });

  // =========================================================================
  // Log on successful save
  // =========================================================================

  describe('logging', () => {
    it('should log info with conversation ID on successful save', async () => {
      const dbConv = createDbConversation({ id: 'conv-db-logged' });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);
      const ctx = createContext({
        store: {
          agentResult: createAgentResult(),
          conversationId: 'conv-1',
        },
      });
      const msg = createMessage();
      const next = vi.fn().mockResolvedValue(createNextResult());

      await middleware(msg, ctx, next);

      expect(mockLog.info).toHaveBeenCalledWith('Saved to history: conversation=conv-db-logged');
    });
  });

  // =========================================================================
  // Assistant message uses result.response.content (not agentResult.value.content)
  // =========================================================================

  describe('assistant message content source', () => {
    it('should use result.response.content for assistant message, not agentResult.value.content', async () => {
      const agentResult = createAgentResult({
        value: { content: 'agent raw content', usage: { promptTokens: 1, completionTokens: 2 } },
      });
      const ctx = createContext({
        store: {
          agentResult,
          conversationId: 'conv-1',
        },
      });
      const nextResult = createNextResult({
        response: {
          id: 'r1',
          sessionId: 's1',
          role: 'assistant',
          content: 'post-processed content',
          metadata: { source: 'web' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);
      const msg = createMessage();

      await middleware(msg, ctx, next);

      const assistantMsgCall = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsgCall.content).toBe('post-processed content');
    });
  });

  // =========================================================================
  // Full integration scenario
  // =========================================================================

  describe('full successful scenario', () => {
    it('should persist both messages and broadcast', async () => {
      const toolCalls = [{ id: 'tc-1', name: 'search', arguments: '{"q":"hi"}' }];
      const traceInfo = { timings: [100, 200] };
      const agentResult = createAgentResult({
        value: {
          content: 'AI says hi',
          toolCalls,
          usage: { promptTokens: 50, completionTokens: 150 },
        },
      });
      const dbConv = createDbConversation({ id: 'conv-full', title: 'Hello', messageCount: 4 });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(dbConv);

      const ctx = createContext({
        store: {
          agentResult,
          conversationId: 'conv-x',
          userId: 'user-99',
          provider: 'anthropic',
          model: 'claude-3-opus',
          agentId: 'my-agent',
          traceInfo,
        },
      });
      const nextResult = createNextResult({
        response: {
          id: 'r-full',
          sessionId: 's-full',
          role: 'assistant',
          content: 'Final processed output',
          metadata: { source: 'telegram' },
          timestamp: new Date(),
        },
      });
      const next = vi.fn().mockResolvedValue(nextResult);
      const msg = createMessage({
        content: 'Hi there',
        metadata: { source: 'telegram' },
        attachments: [
          { type: 'image', mimeType: 'image/png', filename: 'test.png', size: 500, data: 'blob' },
        ],
      });

      const result = await middleware(msg, ctx, next);

      // Verify ChatRepository constructed with correct userId
      expect(ChatRepository).toHaveBeenCalledWith('user-99');

      // Verify getOrCreateConversation
      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith('conv-x', {
        title: 'Hi there',
        agentId: 'my-agent',
        agentName: undefined,
        provider: 'anthropic',
        model: 'claude-3-opus',
      });

      // Verify user message
      const userMsg = mockChatRepo.addMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(userMsg).toEqual({
        conversationId: 'conv-full',
        role: 'user',
        content: 'Hi there',
        provider: 'anthropic',
        model: 'claude-3-opus',
        attachments: [{ type: 'image', mimeType: 'image/png', filename: 'test.png', size: 500 }],
      });

      // Verify assistant message
      const assistantMsg = mockChatRepo.addMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(assistantMsg).toEqual({
        conversationId: 'conv-full',
        role: 'assistant',
        content: 'Final processed output',
        provider: 'anthropic',
        model: 'claude-3-opus',
        toolCalls: [...toolCalls],
        trace: traceInfo,
        inputTokens: 50,
        outputTokens: 150,
      });

      // Verify broadcast
      expect(mockBroadcast).toHaveBeenCalledWith('chat:history:updated', {
        conversationId: 'conv-full',
        title: 'Hello',
        source: 'telegram',
        messageCount: 6,
      });

      // Verify result is returned
      expect(result).toBe(nextResult);
    });
  });
});
