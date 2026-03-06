/**
 * ConversationService Tests
 *
 * Tests for all exported functions and class methods:
 * - ConversationService class (getOrCreate, broadcastUpdate, saveChat, saveLog,
 *   saveStreamingChat, saveStreamingLog)
 * - broadcastChatUpdate (standalone)
 * - saveChatToDatabase (standalone)
 * - saveStreamingChat (standalone)
 * - clearChannelSession
 * - runPostChatProcessing
 * - waitForPendingProcessing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables (TDZ prevention)
// ---------------------------------------------------------------------------

const { mockChatRepo, mockLogsRepo, MockChatRepository, MockLogsRepository } = vi.hoisted(() => {
  const mockChatRepo = {
    getOrCreateConversation: vi.fn(),
    addMessage: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    listConversations: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    deleteConversations: vi.fn(),
    archiveConversations: vi.fn(),
    getMessages: vi.fn(),
    getMessage: vi.fn(),
    addMessageDirect: vi.fn(),
    deleteMessage: vi.fn(),
    getOrCreateConversationWithMessages: vi.fn(),
    getRecentConversations: vi.fn(),
    generateTitle: vi.fn(),
  };
  const mockLogsRepo = {
    log: vi.fn(),
    getLog: vi.fn(),
    listLogs: vi.fn(),
    getStats: vi.fn(),
  };
  const MockChatRepository = vi.fn(function () {
    return mockChatRepo;
  });
  const MockLogsRepository = vi.fn(function () {
    return mockLogsRepo;
  });
  return { mockChatRepo, mockLogsRepo, MockChatRepository, MockLogsRepository };
});

const { mockChannelSessionsRepo } = vi.hoisted(() => {
  const mockChannelSessionsRepo = {
    findActive: vi.fn(),
    deactivate: vi.fn(),
    create: vi.fn(),
    findOrCreate: vi.fn(),
    getById: vi.fn(),
    findByConversation: vi.fn(),
    linkConversation: vi.fn(),
    touchLastMessage: vi.fn(),
    listByUser: vi.fn(),
    updateContext: vi.fn(),
    delete: vi.fn(),
    cleanupOld: vi.fn(),
  };
  return { mockChannelSessionsRepo };
});

const { mockWsBroadcast } = vi.hoisted(() => {
  const mockWsBroadcast = vi.fn();
  return { mockWsBroadcast };
});

const { mockLog } = vi.hoisted(() => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockLog };
});

const { mockDebugLog } = vi.hoisted(() => {
  const mockDebugLog = {
    getRecent: vi.fn().mockReturnValue([]),
    add: vi.fn(),
    clear: vi.fn(),
  };
  return { mockDebugLog };
});

const { mockExtractMemories, mockUpdateGoalProgress, mockEvaluateTriggers } = vi.hoisted(() => ({
  mockExtractMemories: vi.fn(),
  mockUpdateGoalProgress: vi.fn(),
  mockEvaluateTriggers: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock('../db/repositories/index.js', () => ({
  ChatRepository: MockChatRepository,
  LogsRepository: MockLogsRepository,
}));

vi.mock('../db/repositories/channel-sessions.js', () => ({
  channelSessionsRepo: mockChannelSessionsRepo,
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: mockWsBroadcast },
}));

vi.mock('./log.js', () => ({
  getLog: () => mockLog,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    debugLog: mockDebugLog,
  };
});

vi.mock('../routes/helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/helpers.js')>();
  return {
    ...actual,
    truncate: vi.fn((s: string, len = 100) => s.slice(0, len)),
    getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  };
});

vi.mock('../assistant/index.js', () => ({
  extractMemories: mockExtractMemories,
  updateGoalProgress: mockUpdateGoalProgress,
  evaluateTriggers: mockEvaluateTriggers,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  ConversationService,
  broadcastChatUpdate,
  saveChatToDatabase,
  saveStreamingChat,
  clearChannelSession,
  runPostChatProcessing,
  waitForPendingProcessing,
  type SaveChatParams,
  type SaveStreamingParams,
} from './conversation-service.js';
import type { StreamState } from '../routes/chat-streaming.js';
import type { Conversation } from '../db/repositories/chat.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: 'Test Conversation',
    agentId: null,
    agentName: 'Chat',
    provider: 'openai',
    model: 'gpt-4o',
    systemPrompt: null,
    messageCount: 5,
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    metadata: {},
    ...overrides,
  };
}

function makeSaveChatParams(overrides: Partial<SaveChatParams> = {}): SaveChatParams {
  return {
    conversationId: 'conv-1',
    provider: 'openai',
    model: 'gpt-4o',
    userMessage: 'Hello world',
    assistantContent: 'Hello back!',
    ...overrides,
  };
}

function makeStreamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    streamedContent: 'streamed response',
    lastUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    traceToolCalls: [],
    startTime: performance.now() - 1000,
    rawContent: 'streamed response',
    sentContentLength: 0,
    isThinking: false,
    thinkingContent: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDebugLog.getRecent.mockReturnValue([]);
    mockExtractMemories.mockResolvedValue(0);
    mockUpdateGoalProgress.mockResolvedValue(undefined);
    mockEvaluateTriggers.mockResolvedValue({ triggered: [], pending: [], executed: [] });
    service = new ConversationService('user-1');
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates ChatRepository and LogsRepository with the given userId', () => {
      new ConversationService('user-abc');
      expect(MockChatRepository).toHaveBeenCalledWith('user-abc');
      expect(MockLogsRepository).toHaveBeenCalledWith('user-abc');
    });
  });

  // ── getOrCreate ──────────────────────────────────────────────────────────

  describe('getOrCreate', () => {
    it('delegates to chatRepo.getOrCreateConversation with the given id', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);

      const result = await service.getOrCreate('conv-1', { title: 'New convo' });

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith('conv-1', {
        title: 'New convo',
      });
      expect(result).toBe(conv);
    });

    it('passes null when conversationId is undefined', async () => {
      const conv = makeConversation({ id: 'new-conv' });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);

      await service.getOrCreate(undefined, { title: 'Brand new' });

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(null, {
        title: 'Brand new',
      });
    });
  });

  // ── broadcastUpdate ──────────────────────────────────────────────────────

  describe('broadcastUpdate', () => {
    it('broadcasts chat:history:updated with correct payload', () => {
      const conv = makeConversation({ id: 'conv-42', title: 'My Chat', messageCount: 3 });

      service.broadcastUpdate(conv);

      expect(mockWsBroadcast).toHaveBeenCalledWith('chat:history:updated', {
        conversationId: 'conv-42',
        title: 'My Chat',
        source: 'web',
        messageCount: 5, // 3 + 2
      });
    });

    it('uses empty string when conversation title is null', () => {
      const conv = makeConversation({ title: null, messageCount: 0 });

      service.broadcastUpdate(conv);

      expect(mockWsBroadcast).toHaveBeenCalledWith('chat:history:updated', {
        conversationId: conv.id,
        title: '',
        source: 'web',
        messageCount: 2, // 0 + 2
      });
    });
  });

  // ── saveChat ─────────────────────────────────────────────────────────────

  describe('saveChat', () => {
    it('saves both user and assistant messages and a log entry', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });
      mockLogsRepo.log.mockResolvedValue({ id: 'log-1' });

      const params = makeSaveChatParams({
        userMessage: 'Hi there',
        assistantContent: 'Hello!',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      await service.saveChat(params);

      expect(mockChatRepo.addMessage).toHaveBeenCalledTimes(2);

      // User message
      expect(mockChatRepo.addMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ role: 'user', content: 'Hi there' })
      );

      // Assistant message
      expect(mockChatRepo.addMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ role: 'assistant', content: 'Hello!' })
      );

      expect(mockLogsRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: conv.id,
          type: 'chat',
          provider: 'openai',
          model: 'gpt-4o',
        })
      );
    });

    it('includes attachments in the user message when provided', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const params = makeSaveChatParams({
        attachments: [{ type: 'image', mimeType: 'image/png', filename: 'pic.png' }],
      });

      await service.saveChat(params);

      expect(mockChatRepo.addMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          attachments: [{ type: 'image', mimeType: 'image/png', filename: 'pic.png' }],
        })
      );
    });

    it('does NOT include attachments when array is empty', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const params = makeSaveChatParams({ attachments: [] });

      await service.saveChat(params);

      const userMsgCall = mockChatRepo.addMessage.mock.calls[0][0];
      expect(userMsgCall).not.toHaveProperty('attachments');
    });

    it('includes toolCalls in assistant message when provided', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const toolCalls = [{ id: 'tc-1', name: 'search', arguments: '{}' }];
      const params = makeSaveChatParams({ toolCalls });

      await service.saveChat(params);

      expect(mockChatRepo.addMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ toolCalls })
      );
    });

    it('broadcasts a WebSocket update after saving', async () => {
      const conv = makeConversation({ messageCount: 4 });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      await service.saveChat(makeSaveChatParams());

      expect(mockWsBroadcast).toHaveBeenCalledWith('chat:history:updated', {
        conversationId: conv.id,
        title: conv.title,
        source: 'web',
        messageCount: 6, // 4 + 2
      });
    });

    it('logs a warning and does not throw when an error occurs', async () => {
      mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB error'));

      await expect(service.saveChat(makeSaveChatParams())).resolves.toBeUndefined();

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save'),
        expect.any(Error)
      );
    });

    it('includes payload from debugLog when a request entry is present', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const fakePayload = { messages: [{ role: 'user', content: 'hi' }] };
      mockDebugLog.getRecent.mockReturnValue([{ type: 'request', data: { payload: fakePayload } }]);

      await service.saveChat(makeSaveChatParams());

      expect(mockLogsRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ payload: fakePayload }),
        })
      );
    });

    it('passes streaming flag in requestBody when streaming param is true', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      await service.saveChat(makeSaveChatParams({ streaming: true }));

      expect(mockLogsRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ streaming: true }),
        })
      );
    });

    it('includes agentId in getOrCreate options when provided', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      await service.saveChat(makeSaveChatParams({ agentId: 'agent-99' }));

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ agentId: 'agent-99', agentName: undefined })
      );
    });

    it('sets agentName to "Chat" when agentId is not provided', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      await service.saveChat(makeSaveChatParams({ agentId: undefined }));

      expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ agentName: 'Chat' })
      );
    });
  });

  // ── saveLog ──────────────────────────────────────────────────────────────

  describe('saveLog', () => {
    it('saves a log entry but does NOT call addMessage', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockLogsRepo.log.mockResolvedValue({ id: 'log-1' });

      await service.saveLog(makeSaveChatParams());

      expect(mockChatRepo.addMessage).not.toHaveBeenCalled();
      expect(mockLogsRepo.log).toHaveBeenCalledTimes(1);
    });

    it('still broadcasts a WebSocket update after log-only save', async () => {
      const conv = makeConversation({ messageCount: 2 });
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockLogsRepo.log.mockResolvedValue({ id: 'log-1' });

      await service.saveLog(makeSaveChatParams());

      expect(mockWsBroadcast).toHaveBeenCalledWith('chat:history:updated', {
        conversationId: conv.id,
        title: conv.title,
        source: 'web',
        messageCount: 4, // 2 + 2
      });
    });

    it('logs a warning and does not throw when an error occurs', async () => {
      mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB failed'));

      await expect(service.saveLog(makeSaveChatParams())).resolves.toBeUndefined();

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save'),
        expect.any(Error)
      );
    });
  });

  // ── saveStreamingChat ────────────────────────────────────────────────────

  describe('saveStreamingChat', () => {
    it('saves messages and log with streaming flag and extracted trace/usage', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const state = makeStreamState({
        lastUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
        traceToolCalls: [{ name: 'search', success: true, duration: 500 }],
      });
      const params: SaveStreamingParams = {
        conversationId: 'conv-1',
        provider: 'anthropic',
        model: 'claude-3',
        userMessage: 'What is AI?',
        assistantContent: 'AI stands for...',
      };

      await service.saveStreamingChat(state, params);

      expect(mockChatRepo.addMessage).toHaveBeenCalledTimes(2);
      expect(mockLogsRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ streaming: true }),
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        })
      );
    });

    it('handles state with no lastUsage (undefined usage)', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const state = makeStreamState({ lastUsage: undefined });
      const params: SaveStreamingParams = {
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4o',
        userMessage: 'Hello',
        assistantContent: 'Hi',
      };

      await service.saveStreamingChat(state, params);

      expect(mockLogsRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        })
      );
    });

    it('includes traceToolCalls in the trace object', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
      mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

      const state = makeStreamState({
        traceToolCalls: [
          { name: 'get_weather', arguments: { city: 'Paris' }, success: true, duration: 250 },
        ],
      });
      const params: SaveStreamingParams = {
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4o',
        userMessage: 'Weather in Paris?',
        assistantContent: 'Sunny!',
      };

      await service.saveStreamingChat(state, params);

      // The assistant message should contain trace with toolCalls
      const assistantCall = mockChatRepo.addMessage.mock.calls[1][0];
      expect(assistantCall.trace).toMatchObject({
        toolCalls: [{ name: 'get_weather', success: true }],
      });
    });
  });

  // ── saveStreamingLog ─────────────────────────────────────────────────────

  describe('saveStreamingLog', () => {
    it('saves log only (no messages) with streaming trace from state', async () => {
      const conv = makeConversation();
      mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);

      const state = makeStreamState({
        lastUsage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      });
      const params: SaveStreamingParams = {
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4o',
        userMessage: 'Test',
        assistantContent: 'Response',
      };

      await service.saveStreamingLog(state, params);

      expect(mockChatRepo.addMessage).not.toHaveBeenCalled();
      expect(mockLogsRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ streaming: true }),
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

describe('broadcastChatUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcasts chat:history:updated to WebSocket clients', () => {
    broadcastChatUpdate({ id: 'conv-99', title: 'My Conversation', messageCount: 10 });

    expect(mockWsBroadcast).toHaveBeenCalledWith('chat:history:updated', {
      conversationId: 'conv-99',
      title: 'My Conversation',
      source: 'web',
      messageCount: 12, // 10 + 2
    });
  });

  it('uses empty string for null title', () => {
    broadcastChatUpdate({ id: 'conv-100', title: null, messageCount: 0 });

    expect(mockWsBroadcast).toHaveBeenCalledWith('chat:history:updated', {
      conversationId: 'conv-100',
      title: '',
      source: 'web',
      messageCount: 2,
    });
  });
});

describe('saveChatToDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDebugLog.getRecent.mockReturnValue([]);
  });

  it('instantiates ConversationService with userId and calls saveChat', async () => {
    const conv = makeConversation();
    mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
    mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

    await saveChatToDatabase({
      userId: 'user-xyz',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'World',
    });

    expect(MockChatRepository).toHaveBeenCalledWith('user-xyz');
    expect(mockChatRepo.addMessage).toHaveBeenCalledTimes(2);
  });

  it('does not throw when underlying save fails', async () => {
    mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB down'));

    await expect(
      saveChatToDatabase({
        userId: 'user-1',
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4o',
        userMessage: 'Hi',
        assistantContent: 'Hey',
      })
    ).resolves.toBeUndefined();
  });
});

describe('saveStreamingChat (standalone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDebugLog.getRecent.mockReturnValue([]);
  });

  it('instantiates ConversationService with userId and calls saveStreamingChat', async () => {
    const conv = makeConversation();
    mockChatRepo.getOrCreateConversation.mockResolvedValue(conv);
    mockChatRepo.addMessage.mockResolvedValue({ id: 'msg-1' });

    const state = makeStreamState();

    await saveStreamingChat(state, {
      userId: 'user-stream',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Stream me',
      assistantContent: 'Streamed!',
    });

    expect(MockChatRepository).toHaveBeenCalledWith('user-stream');
    expect(mockChatRepo.addMessage).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// clearChannelSession
// ---------------------------------------------------------------------------

describe('clearChannelSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when no active session is found', async () => {
    mockChannelSessionsRepo.findActive.mockResolvedValue(null);

    const result = await clearChannelSession('user-1', 'telegram', 'chat-123');

    expect(result).toBe(false);
    expect(mockChannelSessionsRepo.deactivate).not.toHaveBeenCalled();
  });

  it('deactivates the session and returns true when session exists', async () => {
    const session = {
      id: 'session-abc',
      channelUserId: 'user-1',
      channelPluginId: 'telegram',
      platformChatId: 'chat-123',
      conversationId: 'conv-1',
      isActive: true,
      context: {},
      createdAt: new Date(),
      lastMessageAt: new Date(),
    };
    mockChannelSessionsRepo.findActive.mockResolvedValue(session);
    mockChannelSessionsRepo.deactivate.mockResolvedValue(undefined);

    const result = await clearChannelSession('user-1', 'telegram', 'chat-123');

    expect(result).toBe(true);
    expect(mockChannelSessionsRepo.findActive).toHaveBeenCalledWith(
      'user-1',
      'telegram',
      'chat-123'
    );
    expect(mockChannelSessionsRepo.deactivate).toHaveBeenCalledWith('session-abc');
  });

  it('passes all three arguments to findActive correctly', async () => {
    mockChannelSessionsRepo.findActive.mockResolvedValue(null);

    await clearChannelSession('chan-user', 'whatsapp', 'platform-chat-99');

    expect(mockChannelSessionsRepo.findActive).toHaveBeenCalledWith(
      'chan-user',
      'whatsapp',
      'platform-chat-99'
    );
  });
});

// ---------------------------------------------------------------------------
// runPostChatProcessing + waitForPendingProcessing
// ---------------------------------------------------------------------------

describe('runPostChatProcessing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractMemories.mockResolvedValue(0);
    mockUpdateGoalProgress.mockResolvedValue(undefined);
    mockEvaluateTriggers.mockResolvedValue({ triggered: [], pending: [], executed: [] });
  });

  it('calls extractMemories, updateGoalProgress, and evaluateTriggers', async () => {
    runPostChatProcessing('user-1', 'Hello', 'World');
    await waitForPendingProcessing();

    expect(mockExtractMemories).toHaveBeenCalledWith('user-1', 'Hello', 'World');
    expect(mockUpdateGoalProgress).toHaveBeenCalledWith('user-1', 'Hello', 'World', undefined);
    expect(mockEvaluateTriggers).toHaveBeenCalledWith('user-1', 'Hello', 'World');
  });

  it('passes toolCalls to updateGoalProgress when provided', async () => {
    const toolCalls = [
      { id: 'tc-1', name: 'search', arguments: '{}' },
    ] as import('@ownpilot/core').ToolCall[];

    runPostChatProcessing('user-1', 'Find stuff', 'Here is what I found', toolCalls);
    await waitForPendingProcessing();

    expect(mockUpdateGoalProgress).toHaveBeenCalledWith(
      'user-1',
      'Find stuff',
      'Here is what I found',
      toolCalls
    );
  });

  it('logs memory count when memories were extracted', async () => {
    mockExtractMemories.mockResolvedValue(3);

    runPostChatProcessing('user-1', 'msg', 'reply');
    await waitForPendingProcessing();

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('3 new memories'));
  });

  it('logs trigger count when triggers were evaluated', async () => {
    mockEvaluateTriggers.mockResolvedValue({
      triggered: ['t1', 't2'],
      pending: [],
      executed: ['t1'],
    });

    runPostChatProcessing('user-1', 'msg', 'reply');
    await waitForPendingProcessing();

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('2 triggers evaluated'));
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('1 triggers executed'));
  });

  it('logs pending triggers when some are pending', async () => {
    mockEvaluateTriggers.mockResolvedValue({
      triggered: [],
      pending: ['p1', 'p2', 'p3'],
      executed: [],
    });

    runPostChatProcessing('user-1', 'msg', 'reply');
    await waitForPendingProcessing();

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('3 triggers pending'));
  });

  it('does not throw when extractMemories rejects', async () => {
    mockExtractMemories.mockRejectedValue(new Error('Memory failed'));

    runPostChatProcessing('user-1', 'msg', 'reply');

    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Memory extraction failed'),
      expect.any(Error)
    );
  });

  it('does not throw when updateGoalProgress rejects', async () => {
    mockUpdateGoalProgress.mockRejectedValue(new Error('Goal failed'));

    runPostChatProcessing('user-1', 'msg', 'reply');

    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Goal progress update failed'),
      expect.any(Error)
    );
  });

  it('does not throw when evaluateTriggers rejects', async () => {
    mockEvaluateTriggers.mockRejectedValue(new Error('Trigger failed'));

    runPostChatProcessing('user-1', 'msg', 'reply');

    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Trigger evaluation failed'),
      expect.any(Error)
    );
  });

  it('calls all three post-processing functions regardless of each other', async () => {
    // Verify all three are always called even in normal flow
    mockExtractMemories.mockResolvedValue(0);
    mockUpdateGoalProgress.mockResolvedValue(undefined);
    mockEvaluateTriggers.mockResolvedValue({ triggered: [], pending: [], executed: [] });

    runPostChatProcessing('user-1', 'msg', 'reply');
    await waitForPendingProcessing();

    expect(mockExtractMemories).toHaveBeenCalledTimes(1);
    expect(mockUpdateGoalProgress).toHaveBeenCalledTimes(1);
    expect(mockEvaluateTriggers).toHaveBeenCalledTimes(1);
  });
});

describe('waitForPendingProcessing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractMemories.mockResolvedValue(0);
    mockUpdateGoalProgress.mockResolvedValue(undefined);
    mockEvaluateTriggers.mockResolvedValue({ triggered: [], pending: [], executed: [] });
  });

  it('resolves immediately when there are no pending tasks', async () => {
    await expect(waitForPendingProcessing()).resolves.toBeUndefined();
  });

  it('resolves after all in-flight tasks complete', async () => {
    let resolveMemories!: (v: number) => void;
    mockExtractMemories.mockReturnValue(
      new Promise<number>((r) => {
        resolveMemories = r;
      })
    );

    runPostChatProcessing('user-1', 'msg', 'reply');

    const waitPromise = waitForPendingProcessing();
    resolveMemories(0);

    await expect(waitPromise).resolves.toBeUndefined();
  });
});
