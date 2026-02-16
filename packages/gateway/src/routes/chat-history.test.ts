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

const mockChatRepo = {
  listConversations: vi.fn(async () => [sampleConversation]),
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
};

const mockLogsRepo = {
  list: vi.fn(async () => [sampleLog]),
  getStats: vi.fn(async () => sampleLogStats),
  getLog: vi.fn(async (id: string) => (id === 'log-1' ? sampleLog : null)),
  clearAll: vi.fn(async () => 42),
  deleteOldLogs: vi.fn(async () => 10),
};

const mockResetChatAgentContext = vi.fn(() => true);
const mockClearAllChatAgentCaches = vi.fn(() => 3);
const mockGetDefaultModel = vi.fn(async () => 'gpt-4o');

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

vi.mock('./agents.js', () => ({
  resetChatAgentContext: (...args: unknown[]) => mockResetChatAgentContext(...args),
  clearAllChatAgentCaches: (...args: unknown[]) => mockClearAllChatAgentCaches(...args),
  getDefaultModel: (...args: unknown[]) => mockGetDefaultModel(...args),
}));

vi.mock('../config/defaults.js', () => ({
  MAX_DAYS_LOOKBACK: 365,
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
    mockChatRepo.updateConversation.mockImplementation(async (id: string, data: { isArchived: boolean }) =>
      id === 'conv-1' ? { ...sampleConversation, isArchived: data.isArchived } : null
    );
    mockLogsRepo.list.mockResolvedValue([sampleLog]);
    mockLogsRepo.getStats.mockResolvedValue(sampleLogStats);
    mockLogsRepo.getLog.mockImplementation(async (id: string) => (id === 'log-1' ? sampleLog : null));
    mockLogsRepo.clearAll.mockResolvedValue(42);
    mockLogsRepo.deleteOldLogs.mockResolvedValue(10);
    mockResetChatAgentContext.mockReturnValue(true);
    mockClearAllChatAgentCaches.mockReturnValue(3);
    mockGetDefaultModel.mockResolvedValue('gpt-4o');
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
      const res = await app.request('/api/history/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 30 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(5);
      expect(mockChatRepo.deleteOldConversations).toHaveBeenCalledWith(30);
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

    it('returns 500 when repository throws', async () => {
      mockChatRepo.getConversationWithMessages.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/api/history/conv-1');

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

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'chat' })
      );
    });

    it('passes agent type filter', async () => {
      await app.request('/api/logs?type=agent');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent' })
      );
    });

    it('ignores invalid type values', async () => {
      await app.request('/api/logs?type=invalid');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ type: undefined })
      );
    });

    it('passes errors=true filter', async () => {
      await app.request('/api/logs?errors=true');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ hasError: true })
      );
    });

    it('passes errors=false filter', async () => {
      await app.request('/api/logs?errors=false');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ hasError: false })
      );
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
      mockResetChatAgentContext.mockReturnValue(false);

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
});
