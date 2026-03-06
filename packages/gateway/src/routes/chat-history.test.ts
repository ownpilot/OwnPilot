/**
 * Chat History & Logs Routes Tests
 *
 * Integration tests for the chat-history API endpoints.
 * Mocks ChatRepository, LogsRepository, and agent context functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleConversation = {
  id: 'conv-1',
  title: 'Test Chat',
  agentId: null,
  agentName: null,
  provider: 'openai',
  model: 'gpt-4',
  messageCount: 5,
  isArchived: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const sampleConversation2 = {
  id: 'conv-2',
  title: 'Another Chat',
  agentId: 'agent-1',
  agentName: 'MyAgent',
  provider: 'anthropic',
  model: 'claude-3',
  messageCount: 3,
  isArchived: true,
  createdAt: new Date('2026-01-02'),
  updatedAt: new Date('2026-01-02'),
};

const sampleMessage = {
  id: 'msg-1',
  role: 'user',
  content: 'Hello world',
  provider: 'openai',
  model: 'gpt-4',
  toolCalls: null,
  trace: null,
  isError: false,
  createdAt: new Date('2026-01-01'),
};

const sampleMessage2 = {
  id: 'msg-2',
  role: 'assistant',
  content: 'Hi there!',
  provider: 'openai',
  model: 'gpt-4',
  toolCalls: null,
  trace: null,
  isError: false,
  createdAt: new Date('2026-01-01'),
};

const sampleLog = {
  id: 'log-1',
  type: 'chat',
  conversationId: 'conv-1',
  provider: 'openai',
  model: 'gpt-4',
  statusCode: 200,
  durationMs: 500,
  inputTokens: 100,
  outputTokens: 200,
  error: null,
  createdAt: new Date('2026-01-01'),
};

const sampleLog2 = {
  id: 'log-2',
  type: 'agent',
  conversationId: 'conv-2',
  provider: 'anthropic',
  model: 'claude-3',
  statusCode: 500,
  durationMs: 1200,
  inputTokens: 50,
  outputTokens: 0,
  error: 'Rate limit exceeded',
  createdAt: new Date('2026-01-02'),
};

const sampleLogStats = {
  totalRequests: 42,
  totalErrors: 3,
  totalInputTokens: 5000,
  totalOutputTokens: 8000,
  averageDurationMs: 350,
  byType: { chat: 30, agent: 12 },
  byProvider: { openai: 25, anthropic: 17 },
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Channel-specific fixtures
// ---------------------------------------------------------------------------

const sampleChannelConversation = {
  id: 'conv-ch-1',
  title: 'WhatsApp Conversation',
  agentId: null,
  agentName: null,
  provider: null,
  model: null,
  systemPrompt: null,
  messageCount: 3,
  isArchived: false,
  userId: 'default',
  metadata: { source: 'channel', platform: 'whatsapp' },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const sampleChannelSession = {
  id: 'session-1',
  channelPluginId: 'whatsapp-plugin',
  platformChatId: 'chat-123',
  channelUserId: 'user-ch-1',
  conversationId: 'conv-ch-1',
};

// ---------------------------------------------------------------------------
// Mock objects
// ---------------------------------------------------------------------------

const mockChatRepo = {
  listConversations: vi.fn(async () => [sampleConversation]),
  getConversation: vi.fn(async (id: string) =>
    id === 'conv-ch-1' ? sampleChannelConversation : id === 'conv-1' ? sampleConversation : null
  ),
  getConversationWithMessages: vi.fn(async (id: string) =>
    id === 'conv-1'
      ? { conversation: sampleConversation, messages: [sampleMessage, sampleMessage2] }
      : null
  ),
  deleteConversation: vi.fn(async (id: string) => id === 'conv-1'),
  deleteConversations: vi.fn(async (ids: string[]) => ids.length),
  deleteOldConversations: vi.fn(async () => 5),
  archiveConversations: vi.fn(async (ids: string[]) => ids.length),
  updateConversation: vi.fn(async (id: string, data: { isArchived: boolean }) =>
    id === 'conv-1' ? { ...sampleConversation, isArchived: data.isArchived } : null
  ),
  addMessage: vi.fn(async () => ({})),
};

const mockChannelSessionsRepo = {
  findByConversation: vi.fn(async () => sampleChannelSession as typeof sampleChannelSession | null),
};

const mockProcessIncomingMessage = vi.fn(async () => {});

const mockGetChannelServiceImpl = vi.fn(() => ({
  processIncomingMessage: mockProcessIncomingMessage,
}));

const mockGetOwnerUserId = vi.fn(async () => 'owner-user-123' as string | null);
const mockGetOwnerChatId = vi.fn(async () => 'owner-chat-456' as string | null);

const mockLogsRepo = {
  list: vi.fn(async () => [sampleLog]),
  getStats: vi.fn(async () => sampleLogStats),
  getLog: vi.fn(async (id: string) => (id === 'log-1' ? sampleLog : null)),
  clearAll: vi.fn(async () => 42),
  deleteOldLogs: vi.fn(async () => 10),
};

const mockResetChatAgentContext = vi.fn(() => ({ reset: true, newSessionId: 'new-session-1' }));
const mockClearAllChatAgentCaches = vi.fn(() => 3);
const mockGetDefaultModel = vi.fn(async () => 'gpt-4o');
const mockGetDefaultProvider = vi.fn(async () => 'openai');
const mockGetContextBreakdown = vi.fn(() => ({
  systemPromptTokens: 1200,
  messageHistoryTokens: 800,
  messageCount: 5,
  maxContextTokens: 128000,
  modelName: 'gpt-4o',
  providerName: 'openai',
  sections: [
    { name: 'Base Prompt', tokens: 400 },
    { name: 'User Context', tokens: 800 },
  ],
}));
const mockCompactContext = vi.fn(async () => ({
  compacted: true,
  summary: 'Summary of conversation',
  removedMessages: 8,
  newTokenEstimate: 450,
}));

vi.mock('../db/repositories/index.js', () => ({
  ChatRepository: class {
    constructor(_userId: string) {
      return mockChatRepo;
    }
  },
  LogsRepository: class {
    constructor(_userId: string) {
      return mockLogsRepo;
    }
  },
}));

vi.mock('../db/repositories/model-configs.js', () => ({
  modelConfigsRepo: {
    getModel: vi.fn(async () => null),
  },
}));

vi.mock('./settings.js', () => ({
  getDefaultProvider: (...args: unknown[]) => mockGetDefaultProvider(...args),
}));

vi.mock('./agents.js', () => ({
  resetChatAgentContext: (...args: unknown[]) => mockResetChatAgentContext(...args),
  clearAllChatAgentCaches: (...args: unknown[]) => mockClearAllChatAgentCaches(...args),
  getDefaultModel: (...args: unknown[]) => mockGetDefaultModel(...args),
  getContextBreakdown: (...args: unknown[]) => mockGetContextBreakdown(...args),
  compactContext: (...args: unknown[]) => mockCompactContext(...args),
}));

vi.mock('./chat-state.js', () => ({
  promptInitializedConversations: new Set<string>(),
  lastExecPermHash: new Map<string, string>(),
}));

vi.mock('../config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    WS_PORT: 18789,
    WS_HEARTBEAT_INTERVAL_MS: 30000,
    WS_SESSION_TIMEOUT_MS: 300000,
    WS_MAX_PAYLOAD_BYTES: 1048576,
    WS_MAX_CONNECTIONS: 50,
  };
});

vi.mock('../db/repositories/channel-sessions.js', () => ({
  channelSessionsRepo: mockChannelSessionsRepo,
}));

vi.mock('../db/repositories/channel-messages.js', () => ({
  channelMessagesRepo: {
    getByConversation: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
  },
}));

vi.mock('../db/repositories/channel-users.js', () => ({
  channelUsersRepo: {
    getById: vi.fn(async () => null),
  },
}));

vi.mock('../channels/service-impl.js', () => ({
  getChannelServiceImpl: (...args: unknown[]) => mockGetChannelServiceImpl(...args),
}));

vi.mock('../services/pairing-service.js', () => ({
  getOwnerUserId: (...args: unknown[]) => mockGetOwnerUserId(...args),
  getOwnerChatId: (...args: unknown[]) => mockGetOwnerChatId(...args),
}));

vi.mock('../services/middleware/context-injection.js', () => ({
  clearInjectionCache: vi.fn(),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: {
    broadcast: vi.fn(),
  },
}));

// Import after mocks
const { chatHistoryRoutes } = await import('./chat-history.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/api', chatHistoryRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chat History & Logs Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default implementations
    mockChatRepo.listConversations.mockResolvedValue([sampleConversation]);
    mockChatRepo.getConversationWithMessages.mockImplementation(async (id: string) =>
      id === 'conv-1'
        ? { conversation: sampleConversation, messages: [sampleMessage, sampleMessage2] }
        : null
    );
    mockChatRepo.deleteConversation.mockImplementation(async (id: string) => id === 'conv-1');
    mockChatRepo.deleteConversations.mockImplementation(async (ids: string[]) => ids.length);
    mockChatRepo.deleteOldConversations.mockResolvedValue(5);
    mockChatRepo.archiveConversations.mockImplementation(async (ids: string[]) => ids.length);
    mockChatRepo.updateConversation.mockImplementation(
      async (id: string, data: { isArchived: boolean }) =>
        id === 'conv-1' ? { ...sampleConversation, isArchived: data.isArchived } : null
    );
    mockLogsRepo.list.mockResolvedValue([sampleLog]);
    mockLogsRepo.getStats.mockResolvedValue(sampleLogStats);
    mockLogsRepo.getLog.mockImplementation(async (id: string) =>
      id === 'log-1' ? sampleLog : null
    );
    mockLogsRepo.clearAll.mockResolvedValue(42);
    mockLogsRepo.deleteOldLogs.mockResolvedValue(10);
    mockResetChatAgentContext.mockReturnValue({ reset: true, newSessionId: 'new-session-1' });
    mockClearAllChatAgentCaches.mockReturnValue(3);
    mockGetDefaultModel.mockResolvedValue('gpt-4o');
    // Channel-send mocks
    mockChatRepo.getConversation.mockImplementation(async (id: string) =>
      id === 'conv-ch-1' ? sampleChannelConversation : id === 'conv-1' ? sampleConversation : null
    );
    mockChannelSessionsRepo.findByConversation.mockResolvedValue(sampleChannelSession);
    mockGetChannelServiceImpl.mockReturnValue({
      processIncomingMessage: mockProcessIncomingMessage,
    });
    mockProcessIncomingMessage.mockResolvedValue(undefined);
    mockGetOwnerUserId.mockResolvedValue('owner-user-123');
    mockGetOwnerChatId.mockResolvedValue('owner-chat-456');
    mockChatRepo.addMessage.mockResolvedValue({});
    app = createApp();
  });

  // ========================================================================
  // GET /history - List conversations
  // ========================================================================

  describe('GET /api/history', () => {
    it('returns conversations with pagination metadata', async () => {
      const res = await app.request('/api/history');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.conversations).toHaveLength(1);
      expect(json.data.conversations[0]).toEqual({
        id: 'conv-1',
        title: 'Test Chat',
        agentId: null,
        agentName: null,
        provider: 'openai',
        model: 'gpt-4',
        messageCount: 5,
        isArchived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'web',
        channelPlatform: null,
        channelSenderName: null,
      });
      expect(json.data.total).toBe(1);
      expect(json.data.limit).toBe(50);
      expect(json.data.offset).toBe(0);
    });

    it('passes pagination params to repository', async () => {
      await app.request('/api/history?limit=10&offset=20');

      expect(mockChatRepo.listConversations).toHaveBeenCalledWith({
        limit: 10,
        offset: 20,
        search: undefined,
        agentId: undefined,
        isArchived: false,
      });
    });

    it('passes search filter to repository', async () => {
      await app.request('/api/history?search=hello');

      expect(mockChatRepo.listConversations).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'hello' })
      );
    });

    it('passes agentId filter to repository', async () => {
      await app.request('/api/history?agentId=agent-1');

      expect(mockChatRepo.listConversations).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1' })
      );
    });

    it('passes archived filter to repository', async () => {
      await app.request('/api/history?archived=true');

      expect(mockChatRepo.listConversations).toHaveBeenCalledWith(
        expect.objectContaining({ isArchived: true })
      );
    });

    it('defaults archived to false', async () => {
      await app.request('/api/history');

      expect(mockChatRepo.listConversations).toHaveBeenCalledWith(
        expect.objectContaining({ isArchived: false })
      );
    });

    it('returns empty list when no conversations', async () => {
      mockChatRepo.listConversations.mockResolvedValue([]);

      const res = await app.request('/api/history');
      const json = await res.json();

      expect(json.data.conversations).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });

    it('serializes dates as ISO strings', async () => {
      const res = await app.request('/api/history');
      const json = await res.json();

      expect(json.data.conversations[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(json.data.conversations[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns multiple conversations', async () => {
      mockChatRepo.listConversations.mockResolvedValue([sampleConversation, sampleConversation2]);

      const res = await app.request('/api/history');
      const json = await res.json();

      expect(json.data.conversations).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.conversations[1].id).toBe('conv-2');
      expect(json.data.conversations[1].agentId).toBe('agent-1');
      expect(json.data.conversations[1].isArchived).toBe(true);
    });
  });

  // ========================================================================
  // POST /history/bulk-delete
  // ========================================================================

  describe('POST /api/history/bulk-delete', () => {
    it('deletes by ids array', async () => {
      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['conv-1', 'conv-2'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(2);
      expect(mockChatRepo.deleteConversations).toHaveBeenCalledWith(['conv-1', 'conv-2']);
    });

    it('deletes all conversations when all:true', async () => {
      mockChatRepo.listConversations.mockResolvedValue([sampleConversation, sampleConversation2]);
      mockChatRepo.deleteConversations.mockResolvedValue(2);

      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(2);
      expect(mockChatRepo.listConversations).toHaveBeenCalledWith({ limit: 10000 });
      expect(mockChatRepo.deleteConversations).toHaveBeenCalledWith(['conv-1', 'conv-2']);
    });

    it('deletes by olderThanDays', async () => {
      // Create 5 old conversations (more than 30 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      const oldConversations = Array.from({ length: 5 }, (_, i) => ({
        ...sampleConversation,
        id: `old-conv-${i}`,
        updatedAt: oldDate,
      }));
      mockChatRepo.listConversations.mockResolvedValueOnce(oldConversations);

      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 30 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(5);
      expect(mockChatRepo.deleteConversations).toHaveBeenCalledWith([
        'old-conv-0',
        'old-conv-1',
        'old-conv-2',
        'old-conv-3',
        'old-conv-4',
      ]);
    });

    it('returns 400 when body is missing', async () => {
      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Request body is required');
    });

    it('returns 400 when no valid delete option provided', async () => {
      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ something: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Provide ids array');
    });

    it('returns 400 when ids array is empty', async () => {
      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Provide ids array');
    });

    it('returns 400 when more than 500 ids', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `conv-${i}`);

      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Maximum 500 IDs');
    });

    it('returns 400 when olderThanDays is zero or negative', async () => {
      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 0 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.deleteConversations.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['conv-1'] }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // POST /history/bulk-archive
  // ========================================================================

  describe('POST /api/history/bulk-archive', () => {
    it('archives conversations', async () => {
      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['conv-1', 'conv-2'], archived: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toBe(2);
      expect(json.data.archived).toBe(true);
      expect(mockChatRepo.archiveConversations).toHaveBeenCalledWith(['conv-1', 'conv-2'], true);
    });

    it('unarchives conversations', async () => {
      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['conv-1'], archived: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.archived).toBe(false);
    });

    it('returns 400 when body is invalid JSON', async () => {
      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Provide ids array and archived boolean');
    });

    it('returns 400 when ids is not an array', async () => {
      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: 'conv-1', archived: true }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when archived is not a boolean', async () => {
      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['conv-1'], archived: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when more than 500 ids', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `conv-${i}`);

      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, archived: true }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Maximum 500 IDs');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.archiveConversations.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['conv-1'], archived: true }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // GET /history/:id - Get conversation with messages
  // ========================================================================

  describe('GET /api/history/:id', () => {
    it('returns conversation with messages', async () => {
      const res = await app.request('/api/history/conv-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.conversation.id).toBe('conv-1');
      expect(json.data.conversation.title).toBe('Test Chat');
      expect(json.data.conversation.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(json.data.conversation.updatedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(json.data.messages).toHaveLength(2);
    });

    it('serializes message fields correctly', async () => {
      const res = await app.request('/api/history/conv-1');
      const json = await res.json();
      const msg = json.data.messages[0];

      expect(msg).toEqual({
        id: 'msg-1',
        role: 'user',
        content: 'Hello world',
        provider: 'openai',
        model: 'gpt-4',
        toolCalls: null,
        trace: null,
        isError: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('returns 404 for unknown conversation', async () => {
      const res = await app.request('/api/history/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Conversation not found');
    });

    it('strips internal tags from assistant messages', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleConversation,
        messages: [
          sampleMessage,
          { ...sampleMessage2, content: 'Answer<suggestions>opt1\nopt2</suggestions> done.' },
        ],
      });

      const res = await app.request('/api/history/conv-1');
      const json = await res.json();
      const [userMsg, assistantMsg] = json.data.messages;
      expect(userMsg.content).toBe('Hello world');
      expect(assistantMsg.content).toBe('Answer done.');
    });

    it('does not strip content from user messages', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleConversation,
        messages: [
          { ...sampleMessage, content: 'What about <context>this</context>?' },
          sampleMessage2,
        ],
      });

      const res = await app.request('/api/history/conv-1');
      const json = await res.json();
      expect(json.data.messages[0].content).toBe('What about <context>this</context>?');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.getConversationWithMessages.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/conv-1');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // GET /history/:id/unified - Unified conversation view
  // ========================================================================

  describe('GET /api/history/:id/unified', () => {
    it('returns web conversation with source tag', async () => {
      const res = await app.request('/api/history/conv-1/unified');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.conversation.source).toBe('web');
      expect(json.data.messages).toHaveLength(2);
      expect(json.data.messages[0].direction).toBe('inbound');
      expect(json.data.messages[1].direction).toBe('outbound');
    });

    it('strips internal tags from assistant messages in web path', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleConversation,
        messages: [
          sampleMessage,
          { ...sampleMessage2, content: 'Response<memories>note</memories> here.' },
        ],
      });

      const res = await app.request('/api/history/conv-1/unified');
      const json = await res.json();
      const assistantMsg = json.data.messages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsg.content).toBe('Response here.');
    });

    it('does not strip user messages in web path', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleConversation,
        messages: [
          { ...sampleMessage, content: 'User <context>ctx</context> msg' },
          sampleMessage2,
        ],
      });

      const res = await app.request('/api/history/conv-1/unified');
      const json = await res.json();
      const userMsg = json.data.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.content).toBe('User <context>ctx</context> msg');
    });

    it('returns 404 when conversation not found', async () => {
      const res = await app.request('/api/history/nonexistent/unified');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Conversation not found');
    });

    it('returns channel conversation with source and channelInfo', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleChannelConversation,
        messages: [sampleMessage, sampleMessage2],
      });

      const res = await app.request('/api/history/conv-ch-1/unified');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.conversation.source).toBe('channel');
      expect(json.data.conversation.channelPlatform).toBe('whatsapp');
      expect(json.data.channelInfo).toBeTruthy();
      expect(json.data.channelInfo.channelPluginId).toBe('whatsapp-plugin');
    });

    it('strips internal tags from AI messages in channel path', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleChannelConversation,
        messages: [
          sampleMessage,
          {
            ...sampleMessage2,
            content: 'Resp<context>internal</context><suggestions>s</suggestions>',
          },
        ],
      });

      const res = await app.request('/api/history/conv-ch-1/unified');
      const json = await res.json();
      const aiMsg = json.data.messages.find(
        (m: { role: string; source: string }) => m.role === 'assistant' && m.source === 'ai'
      );
      expect(aiMsg?.content).toBe('Resp');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.getConversationWithMessages.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/conv-1/unified');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // DELETE /history/:id - Delete conversation
  // ========================================================================

  describe('DELETE /api/history/:id', () => {
    it('deletes a conversation', async () => {
      const res = await app.request('/api/history/conv-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(mockChatRepo.deleteConversation).toHaveBeenCalledWith('conv-1');
    });

    it('returns 404 for unknown conversation', async () => {
      const res = await app.request('/api/history/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Conversation not found');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.deleteConversation.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/conv-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // PATCH /history/:id/archive - Archive/unarchive single conversation
  // ========================================================================

  describe('PATCH /api/history/:id/archive', () => {
    it('archives a conversation', async () => {
      const res = await app.request('/api/history/conv-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.archived).toBe(true);
      expect(mockChatRepo.updateConversation).toHaveBeenCalledWith('conv-1', { isArchived: true });
    });

    it('unarchives a conversation', async () => {
      const res = await app.request('/api/history/conv-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.archived).toBe(false);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/api/history/conv-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid JSON body');
    });

    it('returns 404 for unknown conversation', async () => {
      const res = await app.request('/api/history/nonexistent/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Conversation not found');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.updateConversation.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/conv-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // GET /logs - List request logs
  // ========================================================================

  describe('GET /api/logs', () => {
    it('returns logs with pagination metadata', async () => {
      const res = await app.request('/api/logs');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.logs).toHaveLength(1);
      expect(json.data.logs[0]).toEqual({
        id: 'log-1',
        type: 'chat',
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4',
        statusCode: 200,
        durationMs: 500,
        inputTokens: 100,
        outputTokens: 200,
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(json.data.total).toBe(1);
      expect(json.data.limit).toBe(100);
      expect(json.data.offset).toBe(0);
    });

    it('passes pagination params to repository', async () => {
      await app.request('/api/logs?limit=25&offset=10');

      expect(mockLogsRepo.list).toHaveBeenCalledWith({
        limit: 25,
        offset: 10,
        type: undefined,
        hasError: undefined,
        conversationId: undefined,
      });
    });

    it('passes type filter to repository', async () => {
      await app.request('/api/logs?type=chat');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('passes agent type filter', async () => {
      await app.request('/api/logs?type=agent');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent' }));
    });

    it('ignores invalid type values', async () => {
      await app.request('/api/logs?type=invalid');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(expect.objectContaining({ type: undefined }));
    });

    it('passes errors=true filter', async () => {
      await app.request('/api/logs?errors=true');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(expect.objectContaining({ hasError: true }));
    });

    it('passes errors=false filter', async () => {
      await app.request('/api/logs?errors=false');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(expect.objectContaining({ hasError: false }));
    });

    it('treats unset errors param as undefined', async () => {
      await app.request('/api/logs');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ hasError: undefined })
      );
    });

    it('passes conversationId filter', async () => {
      await app.request('/api/logs?conversationId=conv-1');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv-1' })
      );
    });

    it('returns multiple logs', async () => {
      mockLogsRepo.list.mockResolvedValue([sampleLog, sampleLog2]);

      const res = await app.request('/api/logs');
      const json = await res.json();

      expect(json.data.logs).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.logs[1].id).toBe('log-2');
      expect(json.data.logs[1].error).toBe('Rate limit exceeded');
    });
  });

  // ========================================================================
  // GET /logs/stats - Log statistics
  // ========================================================================

  describe('GET /api/logs/stats', () => {
    it('returns log statistics with default days', async () => {
      const res = await app.request('/api/logs/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual(sampleLogStats);
      expect(mockLogsRepo.getStats).toHaveBeenCalledWith(expect.any(Date));
    });

    it('accepts custom days parameter', async () => {
      const res = await app.request('/api/logs/stats?days=30');

      expect(res.status).toBe(200);
      expect(mockLogsRepo.getStats).toHaveBeenCalledWith(expect.any(Date));
    });

    it('clamps days to minimum of 1', async () => {
      await app.request('/api/logs/stats?days=0');

      // getIntParam clamps to min=1
      expect(mockLogsRepo.getStats).toHaveBeenCalledWith(expect.any(Date));
    });

    it('clamps days to MAX_DAYS_LOOKBACK', async () => {
      await app.request('/api/logs/stats?days=9999');

      // getIntParam clamps to max=365 (MAX_DAYS_LOOKBACK)
      expect(mockLogsRepo.getStats).toHaveBeenCalledWith(expect.any(Date));
    });
  });

  // ========================================================================
  // GET /logs/:id - Get single log
  // ========================================================================

  describe('GET /api/logs/:id', () => {
    it('returns log details', async () => {
      const res = await app.request('/api/logs/log-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('log-1');
      expect(json.data.type).toBe('chat');
    });

    it('returns 404 for unknown log', async () => {
      const res = await app.request('/api/logs/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Log not found');
    });

    it('returns 500 when repository throws', async () => {
      mockLogsRepo.getLog.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/logs/log-1');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // DELETE /logs - Clear logs
  // ========================================================================

  describe('DELETE /api/logs', () => {
    it('clears all logs when all=true', async () => {
      const res = await app.request('/api/logs?all=true', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(42);
      expect(json.data.mode).toBe('all');
      expect(mockLogsRepo.clearAll).toHaveBeenCalled();
    });

    it('deletes old logs by default (30 days)', async () => {
      const res = await app.request('/api/logs', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(10);
      expect(json.data.mode).toBe('older than 30 days');
      expect(mockLogsRepo.deleteOldLogs).toHaveBeenCalledWith(30);
    });

    it('deletes old logs with custom days', async () => {
      const res = await app.request('/api/logs?olderThanDays=7', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(10);
      expect(json.data.mode).toBe('older than 7 days');
      expect(mockLogsRepo.deleteOldLogs).toHaveBeenCalledWith(7);
    });

    it('prefers all=true over olderThanDays', async () => {
      const res = await app.request('/api/logs?all=true&olderThanDays=7', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.mode).toBe('all');
      expect(mockLogsRepo.clearAll).toHaveBeenCalled();
      expect(mockLogsRepo.deleteOldLogs).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // POST /reset-context - Reset chat context
  // ========================================================================

  describe('POST /api/reset-context', () => {
    it('clears all caches when clearAll is true', async () => {
      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.cleared).toBe(3);
      expect(json.data.message).toContain('Cleared 3 chat agent caches');
      expect(mockClearAllChatAgentCaches).toHaveBeenCalled();
    });

    it('resets specific provider/model context', async () => {
      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-3' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.reset).toBe(true);
      expect(json.data.provider).toBe('anthropic');
      expect(json.data.model).toBe('claude-3');
      expect(json.data.message).toContain('Context reset for anthropic/claude-3');
      expect(mockResetChatAgentContext).toHaveBeenCalledWith('anthropic', 'claude-3');
    });

    it('defaults provider to openai when not specified', async () => {
      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.provider).toBe('openai');
      expect(mockResetChatAgentContext).toHaveBeenCalledWith('openai', 'gpt-4o');
    });

    it('uses getDefaultModel when model not specified', async () => {
      mockGetDefaultModel.mockResolvedValue('gpt-4-turbo');

      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.model).toBe('gpt-4-turbo');
      expect(mockGetDefaultModel).toHaveBeenCalledWith('openai');
    });

    it('falls back to gpt-4o when getDefaultModel returns null', async () => {
      mockGetDefaultModel.mockResolvedValue(null);

      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.model).toBe('gpt-4o');
    });

    it('reports when no cached agent was found', async () => {
      mockResetChatAgentContext.mockReturnValue({ reset: false });

      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.reset).toBe(false);
      expect(json.data.message).toContain('No cached agent found');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/api/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid JSON body');
    });
  });

  // ========================================================================
  // GET /context-detail - Context breakdown
  // ========================================================================

  describe('GET /api/context-detail', () => {
    it('returns context breakdown for given provider/model', async () => {
      const res = await app.request('/api/context-detail?provider=openai&model=gpt-4o');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.breakdown).toBeDefined();
      expect(json.data.breakdown.systemPromptTokens).toBe(1200);
      expect(json.data.breakdown.messageHistoryTokens).toBe(800);
      expect(json.data.breakdown.sections).toHaveLength(2);
      expect(mockGetContextBreakdown).toHaveBeenCalledWith('openai', 'gpt-4o', undefined);
    });

    it('returns null breakdown when no cached agent exists', async () => {
      mockGetContextBreakdown.mockReturnValueOnce(null);

      const res = await app.request('/api/context-detail?provider=openai&model=gpt-4o');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.breakdown).toBeNull();
    });

    it('uses defaults when provider/model not specified', async () => {
      const res = await app.request('/api/context-detail');

      expect(res.status).toBe(200);
      expect(mockGetDefaultProvider).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // POST /compact - Context compaction
  // ========================================================================

  describe('POST /api/compact', () => {
    it('compacts context and returns result', async () => {
      const res = await app.request('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4o', keepRecentMessages: 4 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.compacted).toBe(true);
      expect(json.data.removedMessages).toBe(8);
      expect(json.data.newTokenEstimate).toBe(450);
      expect(mockCompactContext).toHaveBeenCalledWith('openai', 'gpt-4o', 4);
    });

    it('uses default keepRecentMessages of 6', async () => {
      const res = await app.request('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-3' }),
      });

      expect(res.status).toBe(200);
      expect(mockCompactContext).toHaveBeenCalledWith('anthropic', 'claude-3', 6);
    });

    it('uses provider/model defaults when not specified', async () => {
      const res = await app.request('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockGetDefaultProvider).toHaveBeenCalled();
    });

    it('returns 500 on compaction error', async () => {
      mockCompactContext.mockRejectedValueOnce(new Error('Agent not found'));

      const res = await app.request('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4o' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Agent not found');
    });
  });

  // ========================================================================
  // GET /history/:id/unified - channel path: channelUserInfo + timeline merge
  // ========================================================================

  describe('GET /api/history/:id/unified — channel path detail', () => {
    const channelUser = {
      id: 'user-ch-1',
      displayName: 'Alice',
      platform: 'whatsapp',
      avatarUrl: 'https://example.com/alice.jpg',
    };

    const t = (offset: number) => new Date(new Date('2026-01-01T10:00:00.000Z').getTime() + offset);

    it('populates channelUserInfo from channelUsersRepo when user found (line 336)', async () => {
      const { channelUsersRepo } = await import('../db/repositories/channel-users.js');
      vi.mocked(channelUsersRepo.getById).mockResolvedValueOnce(channelUser as never);

      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleChannelConversation,
        messages: [],
      });

      const res = await app.request('/api/history/conv-ch-1/unified');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.channelInfo.senderName).toBe('Alice');
      expect(json.data.conversation.channelSenderName).toBe('Alice');
    });

    it('adds channel messages to unified timeline (lines 364-374)', async () => {
      const { channelMessagesRepo } = await import('../db/repositories/channel-messages.js');
      vi.mocked(channelMessagesRepo.getByConversation).mockResolvedValueOnce([
        {
          id: 'cm-1',
          direction: 'inbound',
          content: 'Hi from WhatsApp',
          senderName: 'Alice',
          senderId: 'wa-alice',
          createdAt: t(0),
        },
        {
          id: 'cm-2',
          direction: 'outbound',
          content: 'Hello back',
          senderName: 'Bot',
          senderId: 'bot',
          createdAt: t(1000),
        },
      ] as never);

      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleChannelConversation,
        messages: [],
      });

      const res = await app.request('/api/history/conv-ch-1/unified');
      const json = await res.json();

      expect(res.status).toBe(200);
      const msgs = json.data.messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toMatchObject({
        id: 'cm-1',
        role: 'user',
        source: 'channel',
        direction: 'inbound',
        senderName: 'Alice',
        senderId: 'wa-alice',
      });
      expect(msgs[1]).toMatchObject({
        id: 'cm-2',
        role: 'assistant',
        source: 'channel',
        direction: 'outbound',
      });
    });

    it('deduplicates AI messages that overlap with channel messages by time (lines 379-391)', async () => {
      const baseTime = t(0);
      const { channelMessagesRepo } = await import('../db/repositories/channel-messages.js');
      vi.mocked(channelMessagesRepo.getByConversation).mockResolvedValueOnce([
        {
          id: 'cm-inbound',
          direction: 'inbound',
          content: 'Same user msg',
          senderName: 'Alice',
          senderId: 'wa-alice',
          createdAt: baseTime,
        },
        {
          id: 'cm-outbound',
          direction: 'outbound',
          content: 'Same assistant msg',
          senderName: 'Bot',
          senderId: 'bot',
          createdAt: new Date(baseTime.getTime() + 500),
        },
      ] as never);

      // AI messages at nearly the same time — should be deduplicated
      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleChannelConversation,
        messages: [
          {
            id: 'ai-user',
            role: 'user',
            content: 'Same user msg',
            provider: null,
            model: null,
            toolCalls: null,
            trace: null,
            isError: false,
            createdAt: new Date(baseTime.getTime() + 100), // within 2000ms of cm-inbound
          },
          {
            id: 'ai-assistant',
            role: 'assistant',
            content: 'Same assistant msg',
            provider: null,
            model: null,
            toolCalls: null,
            trace: null,
            isError: false,
            createdAt: new Date(baseTime.getTime() + 600), // within 2000ms of cm-outbound
          },
        ],
      });

      const res = await app.request('/api/history/conv-ch-1/unified');
      const json = await res.json();

      // Both AI messages should be deduplicated — only 2 channel messages remain
      expect(json.data.messages).toHaveLength(2);
      const sources = json.data.messages.map((m: { source: string }) => m.source);
      expect(sources).not.toContain('ai');
    });

    it('includes AI tool messages that have no channel equivalent (lines 394-409)', async () => {
      const { channelMessagesRepo } = await import('../db/repositories/channel-messages.js');
      vi.mocked(channelMessagesRepo.getByConversation).mockResolvedValueOnce([] as never);

      mockChatRepo.getConversationWithMessages.mockResolvedValueOnce({
        conversation: sampleChannelConversation,
        messages: [
          {
            id: 'tool-msg',
            role: 'tool',
            content: 'tool result',
            provider: null,
            model: null,
            toolCalls: null,
            trace: null,
            isError: false,
            createdAt: t(0),
          },
        ],
      });

      const res = await app.request('/api/history/conv-ch-1/unified');
      const json = await res.json();

      expect(json.data.messages).toHaveLength(1);
      expect(json.data.messages[0].source).toBe('ai');
      expect(json.data.messages[0].id).toBe('tool-msg');
    });
  });

  // ========================================================================
  // POST /history/:id/channel-reply - Send reply from WebUI to channel
  // ========================================================================

  describe('POST /api/history/:conversationId/channel-reply', () => {
    const mockChannelService = {
      send: vi.fn(async () => 'sent-msg-id-123'),
    };

    beforeEach(() => {
      mockGetChannelServiceImpl.mockReturnValue(mockChannelService as never);
      mockChannelService.send.mockResolvedValue('sent-msg-id-123');
    });

    it('sends reply and returns sent:true', async () => {
      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello back' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.sent).toBe(true);
      expect(json.data.messageId).toBe('sent-msg-id-123');
      expect(json.data.channelPluginId).toBe('whatsapp-plugin');
    });

    it('calls channelService.send with correct params', async () => {
      await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '  trimmed text  ' }),
      });

      expect(mockChannelService.send).toHaveBeenCalledWith('whatsapp-plugin', {
        platformChatId: 'chat-123',
        text: 'trimmed text',
      });
    });

    it('persists to channel_messages and messages table', async () => {
      const { channelMessagesRepo } = await import('../db/repositories/channel-messages.js');

      await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello back' }),
      });

      expect(channelMessagesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'whatsapp-plugin',
          externalId: 'sent-msg-id-123',
          direction: 'outbound',
          senderId: 'webui',
          senderName: 'WebUI',
          content: 'Hello back',
          conversationId: 'conv-ch-1',
        })
      );
      expect(mockChatRepo.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-ch-1',
          role: 'assistant',
          content: 'Hello back',
        })
      );
    });

    it('broadcasts WebSocket events', async () => {
      const { wsGateway } = await import('../ws/server.js');

      await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello back' }),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'channel:message',
        expect.objectContaining({
          channelId: 'whatsapp-plugin',
          content: 'Hello back',
          direction: 'outgoing',
        })
      );
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ id: 'conv-ch-1', action: 'updated' })
      );
    });

    it('returns 400 when text is missing', async () => {
      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('text is required');
    });

    it('returns 400 when text is blank whitespace', async () => {
      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when conversation not found', async () => {
      mockChatRepo.getConversation.mockResolvedValueOnce(null);

      const res = await app.request('/api/history/nonexistent/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when conversation is not channel-sourced', async () => {
      mockChatRepo.getConversation.mockResolvedValueOnce({
        ...sampleConversation,
        metadata: { source: 'web' },
      });

      const res = await app.request('/api/history/conv-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Not a channel conversation');
    });

    it('returns 404 when no channel session found', async () => {
      mockChannelSessionsRepo.findByConversation.mockResolvedValueOnce(null);

      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('No active channel session');
    });

    it('returns 503 when channel service is not available', async () => {
      mockGetChannelServiceImpl.mockReturnValueOnce(null);

      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error.message).toContain('Channel service not available');
    });

    it('continues (non-fatal) when channelMessagesRepo.create throws', async () => {
      const { channelMessagesRepo } = await import('../db/repositories/channel-messages.js');
      vi.mocked(channelMessagesRepo.create).mockRejectedValueOnce(new Error('DB write failed'));

      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      // Still 200 — message was sent, persist is non-fatal
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.sent).toBe(true);
    });

    it('continues (non-fatal) when chatRepo.addMessage throws', async () => {
      mockChatRepo.addMessage.mockRejectedValueOnce(new Error('DB write failed'));

      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 500 when channelService.send throws', async () => {
      mockChannelService.send.mockRejectedValueOnce(new Error('Send failed'));

      const res = await app.request('/api/history/conv-ch-1/channel-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Send failed');
    });
  });

  // ========================================================================
  // PATCH /history/:id - Rename conversation
  // ========================================================================

  describe('PATCH /api/history/:id (rename)', () => {
    beforeEach(() => {
      mockChatRepo.updateConversation.mockImplementation(
        async (id: string, data: { title?: string }) =>
          id === 'conv-1'
            ? { ...sampleConversation, title: data.title ?? sampleConversation.title }
            : null
      );
    });

    it('renames a conversation and returns updated id + title', async () => {
      const res = await app.request('/api/history/conv-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('conv-1');
      expect(json.data.title).toBe('New Title');
      expect(mockChatRepo.updateConversation).toHaveBeenCalledWith('conv-1', {
        title: 'New Title',
      });
    });

    it('returns 404 when conversation not found', async () => {
      const res = await app.request('/api/history/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Conversation not found');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/api/history/conv-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid JSON body');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.updateConversation.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/api/history/conv-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('DB error');
    });

    it('omits title field from update when not provided in body', async () => {
      const res = await app.request('/api/history/conv-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockChatRepo.updateConversation).toHaveBeenCalledWith('conv-1', {});
    });
  });

  // ========================================================================
  // POST /channel-send - Send Web UI message through channel AI pipeline
  // ========================================================================

  describe('POST /api/channel-send', () => {
    it('returns queued:true and fires processIncomingMessage', async () => {
      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: 'Hello from web' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.queued).toBe(true);
      // processIncomingMessage is fire-and-forget; give microtasks a tick to fire
      await Promise.resolve();
      expect(mockProcessIncomingMessage).toHaveBeenCalledTimes(1);
    });

    it('builds synthetic message with correct fields', async () => {
      await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: '  trimmed  ' }),
      });

      await Promise.resolve();
      const [syntheticMsg] = mockProcessIncomingMessage.mock.calls[0] as [
        {
          text: string;
          channelPluginId: string;
          platform: string;
          sender: { platformUserId: string };
        },
      ];
      expect(syntheticMsg.text).toBe('trimmed');
      expect(syntheticMsg.channelPluginId).toBe('whatsapp-plugin');
      expect(syntheticMsg.platform).toBe('whatsapp');
      expect(syntheticMsg.sender.platformUserId).toBe('owner-user-123');
    });

    it('returns 400 when text is missing', async () => {
      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('text and conversationId are required');
    });

    it('returns 400 when text is blank whitespace', async () => {
      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: '   ' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('text and conversationId are required');
    });

    it('returns 400 when conversationId is missing', async () => {
      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('text and conversationId are required');
    });

    it('returns 400 when body is invalid JSON', async () => {
      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when conversation not found', async () => {
      mockChatRepo.getConversation.mockResolvedValueOnce(null);

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'nonexistent', text: 'hello' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Conversation');
    });

    it('returns 400 when conversation is not a channel conversation', async () => {
      mockChatRepo.getConversation.mockResolvedValueOnce({
        ...sampleConversation,
        metadata: { source: 'web' },
      });

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-1', text: 'hello' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Not a channel conversation');
    });

    it('returns 404 when no active channel session found', async () => {
      mockChannelSessionsRepo.findByConversation.mockResolvedValueOnce(null);

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: 'hello' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('No active channel session');
    });

    it('returns 503 when channel service is not available', async () => {
      mockGetChannelServiceImpl.mockReturnValueOnce(null);

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: 'hello' }),
      });

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error.message).toContain('Channel service not available');
    });

    it('returns 400 when no owner is registered for the platform', async () => {
      mockGetOwnerUserId.mockResolvedValueOnce(null);

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: 'hello' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('No owner registered for platform');
    });

    it('returns 500 when repository throws', async () => {
      mockChatRepo.getConversation.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: 'hello' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('still returns 200 even when processIncomingMessage fails (fire-and-forget)', async () => {
      mockProcessIncomingMessage.mockRejectedValueOnce(new Error('AI pipeline crashed'));

      const res = await app.request('/api/channel-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-ch-1', text: 'hello' }),
      });

      // The endpoint returns immediately; the error is swallowed by .catch()
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.queued).toBe(true);
    });
  });
});
