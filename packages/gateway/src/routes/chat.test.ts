/**
 * Chat Routes Tests
 *
 * Comprehensive test suite for chat endpoints, conversation history,
 * logs, and context management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Mock Repository Instances ───────────────────────────────────

const mockChatRepo = {
  listConversations: vi.fn(),
  getConversationWithMessages: vi.fn(),
  deleteConversation: vi.fn(),
  updateConversation: vi.fn(),
  saveConversation: vi.fn(),
  saveMessage: vi.fn(),
};

const mockLogsRepo = {
  list: vi.fn(),
  getStats: vi.fn(),
  getLog: vi.fn(),
  clearAll: vi.fn(),
  deleteOldLogs: vi.fn(),
  create: vi.fn(),
};

// ─── Mock Dependencies ───────────────────────────────────────────

vi.mock('../db/repositories/index.js', () => ({
  ChatRepository: vi.fn(() => mockChatRepo),
  LogsRepository: vi.fn(() => mockLogsRepo),
}));

const mockAgent = {
  getMemory: vi.fn(() => ({
    get: vi.fn(),
    delete: vi.fn(() => true),
  })),
  getConversation: vi.fn(() => ({ id: 'conv-1', systemPrompt: 'test' })),
  loadConversation: vi.fn(() => true),
  setWorkspaceDir: vi.fn(),
  updateSystemPrompt: vi.fn(),
  getTools: vi.fn(() => []),
  chat: vi.fn(async () => ({
    response: 'AI response',
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: 'stop',
  })),
  reset: vi.fn(() => ({ id: 'new-conv' })),
};

vi.mock('./agents.js', () => ({
  getAgent: vi.fn(),
  getOrCreateDefaultAgent: vi.fn(async () => mockAgent),
  getOrCreateChatAgent: vi.fn(async () => mockAgent),
  isDemoMode: vi.fn(async () => false),
  getDefaultModel: vi.fn(async () => 'gpt-4'),
  getWorkspaceContext: vi.fn(() => ({
    workspaceDir: '/tmp/test',
    homeDir: '/home/test',
    tempDir: '/tmp',
  })),
  resetChatAgentContext: vi.fn(() => true),
  clearAllChatAgentCaches: vi.fn(() => 3),
}));

vi.mock('./costs.js', () => ({
  usageTracker: {
    record: vi.fn(),
  },
}));

vi.mock('../audit/index.js', () => ({
  logChatEvent: vi.fn(),
}));

vi.mock('../workspace/file-workspace.js', () => ({
  getOrCreateSessionWorkspace: vi.fn(() => ({ id: 'session-1', path: '/tmp/ws/session-1' })),
  getSessionWorkspace: vi.fn(),
}));

vi.mock('../utils/index.js', () => ({
  parseLimit: vi.fn((val: string | undefined, def: number) => {
    if (!val) return def;
    const n = parseInt(val, 10);
    return isNaN(n) ? def : Math.min(Math.max(1, n), 1000);
  }),
  parseOffset: vi.fn((val: string | undefined) => {
    if (!val) return 0;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : Math.max(0, n);
  }),
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock transitive dependencies that get loaded by non-mocked modules
vi.mock('./custom-tools.js', () => ({
  executeCustomToolTool: vi.fn(),
  executeActiveCustomTool: vi.fn(),
  getActiveCustomToolDefinitions: vi.fn(async () => []),
  isCustomTool: vi.fn(() => false),
}));

vi.mock('./memories.js', () => ({
  executeMemoryTool: vi.fn(),
}));

vi.mock('./goals.js', () => ({
  executeGoalTool: vi.fn(),
}));

vi.mock('./custom-data.js', () => ({
  executeCustomDataTool: vi.fn(),
}));

vi.mock('./personal-data-tools.js', () => ({
  executePersonalDataTool: vi.fn(),
}));

vi.mock('../tools/index.js', () => ({
  CHANNEL_TOOLS: [],
  TRIGGER_TOOLS: [],
  executeTriggerTool: vi.fn(),
  PLAN_TOOLS: [],
  executePlanTool: vi.fn(),
}));

vi.mock('../services/config-tools.js', () => ({
  CONFIG_TOOLS: [],
  executeConfigTool: vi.fn(),
}));

vi.mock('../services/config-center-impl.js', () => ({
  gatewayConfigCenter: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('./settings.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  resolveProviderAndModel: vi.fn(async (p: string, m: string) => ({ provider: p, model: m })),
  getDefaultProvider: vi.fn(() => 'openai'),
  getDefaultModel: vi.fn(() => 'gpt-4'),
}));

vi.mock('../db/seeds/default-agents.js', () => ({
  getDefaultAgents: vi.fn(() => []),
}));

vi.mock('@ownpilot/core', () => ({
  debugLog: vi.fn(),
  hasServiceRegistry: vi.fn(() => true),
  getServiceRegistry: vi.fn(() => ({
    tryGet: vi.fn(() => null),
    get: vi.fn((token: { name: string }) => {
      const services: Record<string, unknown> = {
        database: { listTables: vi.fn(async () => []) },
      };
      return services[token.name];
    }),
  })),
  Services: {
    MessageBus: { name: 'messageBus' },
    Provider: { name: 'provider' },
    Database: { name: 'database' },
  },
  getDefaultPluginRegistry: vi.fn(async () => ({ getAllTools: () => [] })),
  createDynamicToolRegistry: vi.fn(() => ({
    register: vi.fn(),
    execute: vi.fn(),
    getAllTools: vi.fn(() => []),
    getDefinitions: vi.fn(() => []),
  })),
  getToolDefinitions: vi.fn(() => []),
  ToolRegistry: vi.fn(() => ({
    register: vi.fn(),
    has: vi.fn(),
    getDefinitions: vi.fn(() => []),
    setConfigCenter: vi.fn(),
  })),
  registerAllTools: vi.fn(),
  registerCoreTools: vi.fn(),
  injectMemoryIntoPrompt: vi.fn(async (prompt: string) => ({ systemPrompt: prompt })),
  createAgent: vi.fn(),
  MEMORY_TOOLS: [],
  GOAL_TOOLS: [],
  CUSTOM_DATA_TOOLS: [],
  PERSONAL_DATA_TOOLS: [],
  DYNAMIC_TOOL_DEFINITIONS: [],
  TOOL_GROUPS: {},
  TOOL_SEARCH_TAGS: {},
  TOOL_MAX_LIMITS: {},
  applyToolLimits: vi.fn((_n: string, a: unknown) => a),
  getProviderConfig: vi.fn(() => null),
  Agent: vi.fn(),
}));

vi.mock('../services/memory-service.js', () => ({
  getMemoryService: vi.fn(() => ({
    extractMemories: vi.fn(async () => []),
  })),
}));

vi.mock('../services/goal-service.js', () => ({
  getGoalService: vi.fn(() => ({
    updateProgress: vi.fn(async () => {}),
  })),
}));

vi.mock('../tracing/index.js', () => ({
  traceToolCallStart: vi.fn(() => Date.now()),
  traceToolCallEnd: vi.fn(),
  traceMemoryOp: vi.fn(),
  traceDbWrite: vi.fn(),
  traceDbRead: vi.fn(),
  createTraceContext: vi.fn(() => ({
    duration: 0,
    toolCalls: [],
    modelCalls: [],
    autonomyChecks: [],
    dbOperations: { reads: 0, writes: 0 },
    memoryOps: { adds: 0, recalls: 0 },
    triggersFired: [],
    errors: [],
    events: [],
    request: {},
    response: {},
    retries: [],
  })),
}));

// ─── Import route + mocked modules ──────────────────────────────

import { chatRoutes } from './chat.js';
import { errorHandler } from '../middleware/error-handler.js';
import { getAgent, isDemoMode, getDefaultModel, resetChatAgentContext, clearAllChatAgentCaches } from './agents.js';

// ─── Helpers ─────────────────────────────────────────────────────

function mockConversation(overrides: Partial<{
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  messageCount: number;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'conv-1',
    title: overrides.title ?? 'Test Conversation',
    agentId: overrides.agentId ?? 'agent-1',
    agentName: overrides.agentName ?? 'Test Agent',
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-4',
    messageCount: overrides.messageCount ?? 5,
    isArchived: overrides.isArchived ?? false,
    createdAt: overrides.createdAt ?? new Date('2024-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2024-01-02'),
  };
}

function mockLog(overrides: Partial<{
  id: string;
  type: string;
  conversationId: string;
  provider: string;
  model: string;
  statusCode: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'log-1',
    type: overrides.type ?? 'chat',
    conversationId: overrides.conversationId ?? 'conv-1',
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-4',
    statusCode: overrides.statusCode ?? 200,
    durationMs: overrides.durationMs ?? 150,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    error: overrides.error ?? null,
    createdAt: overrides.createdAt ?? new Date('2024-01-01'),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Chat Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.onError(errorHandler);
    app.route('/chat', chatRoutes);
    vi.clearAllMocks();

    // Reset default mock returns
    vi.mocked(isDemoMode).mockResolvedValue(false);
    vi.mocked(getDefaultModel).mockResolvedValue('gpt-4');
    vi.mocked(getAgent).mockResolvedValue(undefined);
    vi.mocked(resetChatAgentContext).mockReturnValue(true);
    vi.mocked(clearAllChatAgentCaches).mockReturnValue(3);

    // Reset repository mocks
    mockChatRepo.listConversations.mockResolvedValue([]);
    mockChatRepo.getConversationWithMessages.mockResolvedValue(null);
    mockChatRepo.deleteConversation.mockResolvedValue(false);
    mockChatRepo.updateConversation.mockResolvedValue(null);

    mockLogsRepo.list.mockResolvedValue([]);
    mockLogsRepo.getLog.mockResolvedValue(null);
    mockLogsRepo.getStats.mockResolvedValue({});
    mockLogsRepo.clearAll.mockResolvedValue(0);
    mockLogsRepo.deleteOldLogs.mockResolvedValue(0);

    // Reset agent mock
    mockAgent.getMemory.mockReturnValue({
      get: vi.fn(),
      delete: vi.fn(() => true),
    });
    mockAgent.loadConversation.mockReturnValue(true);
  });

  // ─── POST / - Send Chat Message ──────────────────────────────

  describe('POST /chat - Send message', () => {
    it('should return demo response in demo mode', async () => {
      vi.mocked(isDemoMode).mockResolvedValue(true);

      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello!' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.conversationId).toBe('demo');
      expect(data.data.response).toBeDefined();
      expect(typeof data.data.response).toBe('string');
      expect(data.data.model).toBeDefined();
    });

    it('should return 400 when message is missing', async () => {
      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 for invalid JSON', async () => {
      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 when no model available in non-demo mode', async () => {
      vi.mocked(getDefaultModel).mockResolvedValue(undefined as unknown as string);

      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('No model available');
    });

    it('should return 404 when agentId not found', async () => {
      vi.mocked(getAgent).mockResolvedValue(undefined);

      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello', agentId: 'nonexistent' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Agent not found');
    });
  });

  // ─── GET /conversations/:id ──────────────────────────────────

  describe('GET /chat/conversations/:id - Get conversation', () => {
    it('should return empty conversation in demo mode', async () => {
      vi.mocked(isDemoMode).mockResolvedValue(true);

      const res = await app.request('/chat/conversations/conv-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('conv-1');
      expect(data.data.messages).toEqual([]);
    });

    it('should return 404 when agent not found', async () => {
      vi.mocked(getAgent).mockResolvedValue(undefined);

      const res = await app.request('/chat/conversations/conv-1?agentId=nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return 404 when conversation not found', async () => {
      mockAgent.getMemory.mockReturnValue({
        get: vi.fn(() => undefined),
        delete: vi.fn(),
      });

      const res = await app.request('/chat/conversations/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return conversation with messages', async () => {
      const mockConv = {
        id: 'conv-1',
        systemPrompt: 'Be helpful.',
        messages: [
          { role: 'user', content: 'Hello', toolCalls: undefined, toolResults: undefined },
          { role: 'assistant', content: 'Hi!', toolCalls: undefined, toolResults: undefined },
        ],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      mockAgent.getMemory.mockReturnValue({
        get: vi.fn(() => mockConv),
        delete: vi.fn(),
      });

      const res = await app.request('/chat/conversations/conv-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('conv-1');
      expect(data.data.systemPrompt).toBe('Be helpful.');
      expect(data.data.messages).toHaveLength(2);
    });
  });

  // ─── DELETE /conversations/:id ────────────────────────────────

  describe('DELETE /chat/conversations/:id - Delete conversation', () => {
    it('should return success in demo mode', async () => {
      vi.mocked(isDemoMode).mockResolvedValue(true);

      const res = await app.request('/chat/conversations/conv-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should return 404 when agent not found', async () => {
      vi.mocked(getAgent).mockResolvedValue(undefined);

      const res = await app.request('/chat/conversations/conv-1?agentId=nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete conversation successfully', async () => {
      mockAgent.getMemory.mockReturnValue({
        get: vi.fn(),
        delete: vi.fn(() => true),
      });
      mockChatRepo.deleteConversation.mockResolvedValue(true);

      const res = await app.request('/chat/conversations/conv-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should return 404 when conversation not found in memory', async () => {
      mockAgent.getMemory.mockReturnValue({
        get: vi.fn(),
        delete: vi.fn(() => false),
      });

      const res = await app.request('/chat/conversations/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /history ─────────────────────────────────────────────

  describe('GET /chat/history - List conversations', () => {
    it('should return empty list', async () => {
      mockChatRepo.listConversations.mockResolvedValue([]);

      const res = await app.request('/chat/history');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.conversations).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    it('should return conversations with pagination', async () => {
      const convs = [mockConversation(), mockConversation({ id: 'conv-2', title: 'Second' })];
      mockChatRepo.listConversations.mockResolvedValue(convs);

      const res = await app.request('/chat/history?limit=10&offset=0');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.conversations).toHaveLength(2);
      expect(data.data.conversations[0].id).toBe('conv-1');
      expect(data.data.conversations[0].title).toBe('Test Conversation');
      expect(data.data.conversations[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(data.data.limit).toBe(10);
      expect(data.data.offset).toBe(0);
    });

    it('should pass search and filter params', async () => {
      mockChatRepo.listConversations.mockResolvedValue([]);

      await app.request('/chat/history?search=test&agentId=agent-1&archived=true');

      expect(mockChatRepo.listConversations).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'test',
          agentId: 'agent-1',
          isArchived: true,
        })
      );
    });
  });

  // ─── GET /history/:id ─────────────────────────────────────────

  describe('GET /chat/history/:id - Get conversation detail', () => {
    it('should return 404 when conversation not found', async () => {
      mockChatRepo.getConversationWithMessages.mockResolvedValue(null);

      const res = await app.request('/chat/history/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return conversation with messages', async () => {
      const conv = mockConversation();
      const msgs = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          provider: 'openai',
          model: 'gpt-4',
          toolCalls: null,
          trace: null,
          isError: false,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi!',
          provider: 'openai',
          model: 'gpt-4',
          toolCalls: null,
          trace: null,
          isError: false,
          createdAt: new Date('2024-01-01'),
        },
      ];
      mockChatRepo.getConversationWithMessages.mockResolvedValue({
        conversation: conv,
        messages: msgs,
      });

      const res = await app.request('/chat/history/conv-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.conversation.id).toBe('conv-1');
      expect(data.data.conversation.title).toBe('Test Conversation');
      expect(data.data.messages).toHaveLength(2);
      expect(data.data.messages[0].role).toBe('user');
      expect(data.data.messages[1].content).toBe('Hi!');
    });
  });

  // ─── DELETE /history/:id ───────────────────────────────────────

  describe('DELETE /chat/history/:id - Delete from history', () => {
    it('should delete conversation successfully', async () => {
      mockChatRepo.deleteConversation.mockResolvedValue(true);

      const res = await app.request('/chat/history/conv-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.deleted).toBe(true);
    });

    it('should return 404 when conversation not found', async () => {
      mockChatRepo.deleteConversation.mockResolvedValue(false);

      const res = await app.request('/chat/history/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── PATCH /history/:id/archive ────────────────────────────────

  describe('PATCH /chat/history/:id/archive - Archive conversation', () => {
    it('should archive conversation', async () => {
      mockChatRepo.updateConversation.mockResolvedValue({ ...mockConversation(), isArchived: true });

      const res = await app.request('/chat/history/conv-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.archived).toBe(true);
    });

    it('should unarchive conversation', async () => {
      mockChatRepo.updateConversation.mockResolvedValue({ ...mockConversation(), isArchived: false });

      const res = await app.request('/chat/history/conv-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.archived).toBe(false);
    });

    it('should return 404 when conversation not found', async () => {
      mockChatRepo.updateConversation.mockResolvedValue(null);

      const res = await app.request('/chat/history/nonexistent/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /logs ─────────────────────────────────────────────────

  describe('GET /chat/logs - Get logs', () => {
    it('should return empty log list', async () => {
      mockLogsRepo.list.mockResolvedValue([]);

      const res = await app.request('/chat/logs');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.logs).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    it('should return logs with pagination', async () => {
      const logs = [mockLog(), mockLog({ id: 'log-2', type: 'tool' })];
      mockLogsRepo.list.mockResolvedValue(logs);

      const res = await app.request('/chat/logs?limit=50&offset=10');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.logs).toHaveLength(2);
      expect(data.data.logs[0].id).toBe('log-1');
      expect(data.data.logs[0].type).toBe('chat');
      expect(data.data.logs[0].statusCode).toBe(200);
    });

    it('should pass filter params', async () => {
      mockLogsRepo.list.mockResolvedValue([]);

      await app.request('/chat/logs?type=chat&errors=true&conversationId=conv-1');

      expect(mockLogsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat',
          hasError: true,
          conversationId: 'conv-1',
        })
      );
    });
  });

  // ─── GET /logs/stats ───────────────────────────────────────────

  describe('GET /chat/logs/stats - Get log stats', () => {
    it('should return stats', async () => {
      const stats = { totalRequests: 100, averageDuration: 200 };
      mockLogsRepo.getStats.mockResolvedValue(stats);

      const res = await app.request('/chat/logs/stats?days=14');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.totalRequests).toBe(100);
    });

    it('should default to 7 days', async () => {
      mockLogsRepo.getStats.mockResolvedValue({});

      await app.request('/chat/logs/stats');

      expect(mockLogsRepo.getStats).toHaveBeenCalledWith(expect.any(Date));
    });
  });

  // ─── GET /logs/:id ─────────────────────────────────────────────

  describe('GET /chat/logs/:id - Get log detail', () => {
    it('should return log detail', async () => {
      const log = mockLog();
      mockLogsRepo.getLog.mockResolvedValue(log);

      const res = await app.request('/chat/logs/log-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('log-1');
    });

    it('should return 404 when log not found', async () => {
      mockLogsRepo.getLog.mockResolvedValue(null);

      const res = await app.request('/chat/logs/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── DELETE /logs ──────────────────────────────────────────────

  describe('DELETE /chat/logs - Clear logs', () => {
    it('should clear all logs', async () => {
      mockLogsRepo.clearAll.mockResolvedValue(50);

      const res = await app.request('/chat/logs?all=true', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(50);
      expect(data.data.mode).toBe('all');
    });

    it('should clear old logs with default days', async () => {
      mockLogsRepo.deleteOldLogs.mockResolvedValue(10);

      const res = await app.request('/chat/logs', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(10);
      expect(data.data.mode).toContain('30 days');
    });

    it('should clear logs older than specified days', async () => {
      mockLogsRepo.deleteOldLogs.mockResolvedValue(5);

      const res = await app.request('/chat/logs?olderThanDays=7', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(5);
      expect(data.data.mode).toContain('7 days');
    });
  });

  // ─── POST /reset-context ──────────────────────────────────────

  describe('POST /chat/reset-context - Reset context', () => {
    it('should clear all chat agent caches', async () => {
      const res = await app.request('/chat/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.cleared).toBe(3);
      expect(data.data.message).toContain('Cleared 3');
      expect(clearAllChatAgentCaches).toHaveBeenCalled();
    });

    it('should reset specific provider/model context', async () => {
      const res = await app.request('/chat/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-3' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.reset).toBe(true);
      expect(data.data.provider).toBe('anthropic');
      expect(data.data.model).toBe('claude-3');
      expect(resetChatAgentContext).toHaveBeenCalledWith('anthropic', 'claude-3');
    });

    it('should use default provider and model when not specified', async () => {
      const res = await app.request('/chat/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.provider).toBe('openai');
      expect(data.data.model).toBe('gpt-4');
    });

    it('should handle case when no cached agent found', async () => {
      vi.mocked(resetChatAgentContext).mockReturnValue(false);

      const res = await app.request('/chat/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.reset).toBe(false);
      expect(data.data.message).toContain('No cached agent');
    });
  });
});
