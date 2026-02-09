/**
 * Agents Routes Tests
 *
 * Comprehensive test suite for agent CRUD operations and management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Mock all heavy dependencies ─────────────────────────────────

const mockToolRegistry = {
  register: vi.fn(),
  has: vi.fn(() => true),
  unregister: vi.fn(() => false),
  getDefinitions: vi.fn(() => []),
  getDefinition: vi.fn(),
  setConfigCenter: vi.fn(),
  updateExecutor: vi.fn(),
  execute: vi.fn(),
};

const mockMemorySvc = {
  getImportantMemories: vi.fn(async () => []),
  search: vi.fn(async () => []),
};

const mockGoalSvc = {
  getActiveGoals: vi.fn(async () => []),
  getActive: vi.fn(async () => []),
  getNextActions: vi.fn(async () => []),
};

const mockPluginSvc = {
  getAllTools: vi.fn(() => []),
};

vi.mock('@ownpilot/core', () => ({
  hasServiceRegistry: vi.fn(() => true),
  getServiceRegistry: vi.fn(() => ({
    tryGet: vi.fn(() => null),
    get: vi.fn((token: { name: string }) => {
      const services: Record<string, unknown> = {
        memory: mockMemorySvc,
        goal: mockGoalSvc,
        plugin: mockPluginSvc,
      };
      return services[token.name];
    }),
  })),
  Services: {
    Provider: { name: 'provider' },
    Memory: { name: 'memory' },
    Goal: { name: 'goal' },
    Plugin: { name: 'plugin' },
  },
  Agent: vi.fn(),
  createAgent: vi.fn(() => ({
    reset: vi.fn(() => ({ id: 'new-conversation-id' })),
    getTools: vi.fn(() => []),
  })),
  ToolRegistry: vi.fn(() => mockToolRegistry),
  registerCoreTools: vi.fn(),
  registerAllTools: vi.fn(),
  getToolDefinitions: vi.fn(() => []),
  injectMemoryIntoPrompt: vi.fn(async (prompt: string) => ({ systemPrompt: prompt })),
  MEMORY_TOOLS: [],
  GOAL_TOOLS: [],
  CUSTOM_DATA_TOOLS: [],
  PERSONAL_DATA_TOOLS: [],
  DYNAMIC_TOOL_DEFINITIONS: [],
  TOOL_SEARCH_TAGS: {},
  TOOL_MAX_LIMITS: {},
  applyToolLimits: vi.fn((_name: string, args: unknown) => args),
  getDefaultPluginRegistry: vi.fn(async () => ({ getAllTools: () => [] })),
  TOOL_GROUPS: {
    core: { tools: ['get_current_time', 'calculate'] },
    memory: { tools: ['save_memory', 'search_memories'] },
    goals: { tools: ['create_goal', 'list_goals'] },
  } as Record<string, { tools: string[] }>,
  getProviderConfig: vi.fn(() => null),
  unsafeToolId: vi.fn((id: string) => id),
}));

vi.mock('../db/repositories/index.js', () => ({
  agentsRepo: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  localProvidersRepo: {
    getProviderSync: vi.fn(() => null),
    getProvider: vi.fn(async () => null),
  },
}));

vi.mock('./settings.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-api-key'),
  resolveProviderAndModel: vi.fn(async (p: string, m: string) => ({
    provider: p === 'default' ? 'openai' : p,
    model: m === 'default' ? 'gpt-4' : m,
  })),
  getDefaultProvider: vi.fn(() => 'openai'),
  getDefaultModel: vi.fn(() => 'gpt-4'),
}));

vi.mock('../services/config-center-impl.js', () => ({
  gatewayConfigCenter: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
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

vi.mock('./custom-tools.js', () => ({
  executeCustomToolTool: vi.fn(),
  executeActiveCustomTool: vi.fn(),
  getActiveCustomToolDefinitions: vi.fn(async () => []),
}));

vi.mock('../tools/index.js', () => ({
  TRIGGER_TOOLS: [],
  executeTriggerTool: vi.fn(),
  PLAN_TOOLS: [],
  executePlanTool: vi.fn(),
}));

vi.mock('../services/config-tools.js', () => ({
  CONFIG_TOOLS: [],
  executeConfigTool: vi.fn(),
}));

vi.mock('../tracing/index.js', () => ({
  traceToolCallStart: vi.fn(() => Date.now()),
  traceToolCallEnd: vi.fn(),
  traceMemoryOp: vi.fn(),
  traceDbWrite: vi.fn(),
  traceDbRead: vi.fn(),
}));

vi.mock('../services/memory-service.js', () => ({
  getMemoryService: vi.fn(() => ({
    getImportantMemories: vi.fn(async () => []),
    search: vi.fn(async () => []),
  })),
}));

vi.mock('../services/goal-service.js', () => ({
  getGoalService: vi.fn(() => ({
    getActiveGoals: vi.fn(async () => []),
    getActive: vi.fn(async () => []),
    getNextActions: vi.fn(async () => []),
  })),
}));

vi.mock('../db/seeds/default-agents.js', () => ({
  getDefaultAgents: vi.fn(() => []),
}));

// ─── Import route + mocked modules ──────────────────────────────

import { agentRoutes } from './agents.js';
import { agentsRepo } from '../db/repositories/index.js';
import { errorHandler } from '../middleware/error-handler.js';

// ─── Helpers ─────────────────────────────────────────────────────

function mockAgentRecord(overrides: Partial<{
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'agent-1',
    name: overrides.name ?? 'Test Agent',
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-4',
    systemPrompt: overrides.systemPrompt ?? 'You are helpful.',
    config: overrides.config ?? {
      maxTokens: 4096,
      temperature: 0.7,
      maxTurns: 25,
      maxToolCalls: 200,
      tools: ['get_current_time'],
      toolGroups: ['memory'],
    },
    createdAt: overrides.createdAt ?? new Date('2024-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2024-01-02'),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Agent Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.onError(errorHandler);
    app.route('/agents', agentRoutes);
    vi.clearAllMocks();
  });

  // ─── GET / - List Agents ─────────────────────────────────────

  describe('GET /agents - List agents', () => {
    it('should return list of agents with resolved tools', async () => {
      const records = [
        mockAgentRecord({ id: 'agent-1', name: 'Agent A' }),
        mockAgentRecord({
          id: 'agent-2',
          name: 'Agent B',
          config: { tools: ['calculate'], toolGroups: ['core'] },
        }),
      ];
      vi.mocked(agentsRepo.getAll).mockResolvedValue(records);

      const res = await app.request('/agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(2);
      expect(data.data.total).toBe(2);
      expect(data.data.hasMore).toBe(false);
      expect(data.data.items[0].id).toBe('agent-1');
      expect(data.data.items[0].name).toBe('Agent A');
      expect(data.data.items[0].provider).toBe('openai');
      expect(data.data.items[0].model).toBe('gpt-4');
      // Tools should include explicit + toolGroup tools
      expect(data.data.items[0].tools).toContain('get_current_time');
      expect(data.data.items[0].tools).toContain('save_memory');
      expect(data.data.items[0].tools).toContain('search_memories');
      expect(data.data.items[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should return empty list when no agents exist', async () => {
      vi.mocked(agentsRepo.getAll).mockResolvedValue([]);

      const res = await app.request('/agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.items).toEqual([]);
      expect(data.data.total).toBe(0);
      expect(data.data.hasMore).toBe(false);
    });

    it('should resolve toolGroups into individual tool names', async () => {
      const records = [
        mockAgentRecord({
          config: { toolGroups: ['core', 'memory'], tools: undefined },
        }),
      ];
      vi.mocked(agentsRepo.getAll).mockResolvedValue(records);

      const res = await app.request('/agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      const tools: string[] = data.data.items[0].tools;
      expect(tools).toContain('get_current_time');
      expect(tools).toContain('calculate');
      expect(tools).toContain('save_memory');
      expect(tools).toContain('search_memories');
    });

    it('should handle agents with no tools or groups', async () => {
      const records = [
        mockAgentRecord({
          config: { maxTokens: 4096, temperature: 0.7, maxTurns: 25, maxToolCalls: 200 },
        }),
      ];
      vi.mocked(agentsRepo.getAll).mockResolvedValue(records);

      const res = await app.request('/agents');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.items[0].tools).toEqual([]);
    });

    it('should handle database error', async () => {
      vi.mocked(agentsRepo.getAll).mockRejectedValue(new Error('DB connection failed'));

      const res = await app.request('/agents');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // ─── POST / - Create Agent ───────────────────────────────────

  describe('POST /agents - Create agent', () => {
    it('should create agent with name and system prompt', async () => {
      const created = mockAgentRecord({
        id: 'agent_123_abc',
        name: 'My Agent',
        provider: 'default',
        model: 'default',
        config: {
          maxTokens: 4096,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
          tools: undefined,
          toolGroups: undefined,
        },
      });
      vi.mocked(agentsRepo.create).mockResolvedValue(created);

      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Agent',
          systemPrompt: 'You are a coding assistant.',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('My Agent');
      expect(data.data.provider).toBe('default');
      expect(data.data.model).toBe('default');
      expect(agentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Agent',
          systemPrompt: 'You are a coding assistant.',
          provider: 'default',
          model: 'default',
        })
      );
    });

    it('should create agent with explicit provider and model', async () => {
      const created = mockAgentRecord({
        id: 'agent_456_def',
        name: 'Claude Agent',
        provider: 'anthropic',
        model: 'claude-3-opus',
        config: {
          maxTokens: 8192,
          temperature: 0.5,
          maxTurns: 10,
          maxToolCalls: 100,
          tools: ['get_current_time'],
          toolGroups: ['memory'],
        },
      });
      vi.mocked(agentsRepo.create).mockResolvedValue(created);

      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Claude Agent',
          systemPrompt: 'Be helpful.',
          provider: 'anthropic',
          model: 'claude-3-opus',
          maxTokens: 8192,
          temperature: 0.5,
          maxTurns: 10,
          maxToolCalls: 100,
          tools: ['get_current_time'],
          toolGroups: ['memory'],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.provider).toBe('anthropic');
      expect(data.data.model).toBe('claude-3-opus');
      expect(data.data.tools).toContain('get_current_time');
      expect(data.data.tools).toContain('save_memory');
    });

    it('should return 400 for missing name', async () => {
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: 'You are helpful.',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Validation failed');
    });

    it('should return 400 for empty name', async () => {
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          systemPrompt: 'You are helpful.',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should handle database creation error', async () => {
      vi.mocked(agentsRepo.create).mockRejectedValue(new Error('Write failed'));

      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Failing Agent',
          systemPrompt: 'Test',
        }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should default maxTokens, temperature, maxTurns, maxToolCalls', async () => {
      const created = mockAgentRecord({ name: 'Defaults Agent' });
      vi.mocked(agentsRepo.create).mockResolvedValue(created);

      await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Defaults Agent',
          systemPrompt: 'Test',
        }),
      });

      expect(agentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxTokens: 4096,
            temperature: 0.7,
            maxTurns: 25,
            maxToolCalls: 200,
          }),
        })
      );
    });
  });

  // ─── GET /:id - Get Agent Details ────────────────────────────

  describe('GET /agents/:id - Get agent details', () => {
    it('should return full agent details', async () => {
      const record = mockAgentRecord();
      vi.mocked(agentsRepo.getById).mockResolvedValue(record);

      const res = await app.request('/agents/agent-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('agent-1');
      expect(data.data.name).toBe('Test Agent');
      expect(data.data.systemPrompt).toBe('You are helpful.');
      expect(data.data.config.maxTokens).toBe(4096);
      expect(data.data.config.temperature).toBe(0.7);
      expect(data.data.config.maxTurns).toBe(25);
      expect(data.data.config.maxToolCalls).toBe(200);
      expect(data.data.config.tools).toEqual(['get_current_time']);
      expect(data.data.config.toolGroups).toEqual(['memory']);
      expect(data.data.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(data.data.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should resolve tools from toolGroups and explicit tools', async () => {
      const record = mockAgentRecord({
        config: {
          maxTokens: 4096,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
          tools: ['custom_tool'],
          toolGroups: ['core'],
        },
      });
      vi.mocked(agentsRepo.getById).mockResolvedValue(record);

      const res = await app.request('/agents/agent-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      // Should include explicit tool + tools from core group
      expect(data.data.tools).toContain('custom_tool');
      expect(data.data.tools).toContain('get_current_time');
      expect(data.data.tools).toContain('calculate');
    });

    it('should fall back to default tools when none configured', async () => {
      const record = mockAgentRecord({
        config: {
          maxTokens: 4096,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
        },
      });
      vi.mocked(agentsRepo.getById).mockResolvedValue(record);

      const res = await app.request('/agents/agent-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      // Falls back to ['get_current_time', 'calculate']
      expect(data.data.tools).toEqual(['get_current_time', 'calculate']);
    });

    it('should return 404 for non-existent agent', async () => {
      vi.mocked(agentsRepo.getById).mockResolvedValue(null);

      const res = await app.request('/agents/nonexistent-id');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('Agent not found');
    });

    it('should return empty systemPrompt when not set', async () => {
      const record = mockAgentRecord({ systemPrompt: undefined as unknown as string });
      // Force null to test the ?? '' fallback
      (record as Record<string, unknown>).systemPrompt = null;
      vi.mocked(agentsRepo.getById).mockResolvedValue(record);

      const res = await app.request('/agents/agent-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.systemPrompt).toBe('');
    });

    it('should handle database error', async () => {
      vi.mocked(agentsRepo.getById).mockRejectedValue(new Error('DB error'));

      const res = await app.request('/agents/agent-1');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // ─── PATCH /:id - Update Agent ───────────────────────────────

  describe('PATCH /agents/:id - Update agent', () => {
    it('should update agent name', async () => {
      const existing = mockAgentRecord();
      const updated = mockAgentRecord({
        name: 'Updated Agent',
        updatedAt: new Date('2024-02-01'),
      });
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(updated);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Agent' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('Updated Agent');
      expect(agentsRepo.update).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        name: 'Updated Agent',
      }));
    });

    it('should update agent config fields', async () => {
      const existing = mockAgentRecord();
      const updated = mockAgentRecord({ updatedAt: new Date('2024-02-01') });
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(updated);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxTokens: 8192,
          temperature: 0.3,
          maxTurns: 50,
          maxToolCalls: 300,
        }),
      });

      expect(res.status).toBe(200);
      expect(agentsRepo.update).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        config: expect.objectContaining({
          maxTokens: 8192,
          temperature: 0.3,
          maxTurns: 50,
          maxToolCalls: 300,
        }),
      }));
    });

    it('should update tools and toolGroups', async () => {
      const existing = mockAgentRecord();
      const updated = mockAgentRecord({
        config: {
          maxTokens: 4096,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
          tools: ['new_tool'],
          toolGroups: ['goals'],
        },
      });
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(updated);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: ['new_tool'],
          toolGroups: ['goals'],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.tools).toContain('new_tool');
      expect(data.data.tools).toContain('create_goal');
      expect(data.data.tools).toContain('list_goals');
    });

    it('should validate API key when changing provider', async () => {
      const existing = mockAgentRecord({ provider: 'openai' });
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);

      // getProviderApiKey checks localProvidersRepo.getProvider first (returns null),
      // then falls back to getApiKey from settings. Mock getApiKey to return undefined once.
      const { getApiKey } = await import('./settings.js');
      vi.mocked(getApiKey).mockResolvedValueOnce(undefined);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('API key not configured');
    });

    it('should skip API key validation when setting provider to default', async () => {
      const existing = mockAgentRecord({ provider: 'openai' });
      const updated = mockAgentRecord({ provider: 'default' });
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(updated);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'default' }),
      });

      expect(res.status).toBe(200);
    });

    it('should skip API key validation when provider unchanged', async () => {
      const existing = mockAgentRecord({ provider: 'openai' });
      const updated = mockAgentRecord();
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(updated);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      // Should not check API key since provider didn't change
      expect(res.status).toBe(200);
    });

    it('should return 404 for non-existent agent', async () => {
      vi.mocked(agentsRepo.getById).mockResolvedValue(null);

      const res = await app.request('/agents/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 500 when update fails', async () => {
      const existing = mockAgentRecord();
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(null);

      const res = await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Failed to update agent');
    });

    it('should preserve existing config when updating partial fields', async () => {
      const existing = mockAgentRecord({
        config: {
          maxTokens: 4096,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
          tools: ['existing_tool'],
        },
      });
      const updated = mockAgentRecord();
      vi.mocked(agentsRepo.getById).mockResolvedValue(existing);
      vi.mocked(agentsRepo.update).mockResolvedValue(updated);

      await app.request('/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTokens: 8192 }),
      });

      // Existing config fields should be preserved
      expect(agentsRepo.update).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        config: expect.objectContaining({
          maxTokens: 8192,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
          tools: ['existing_tool'],
        }),
      }));
    });
  });

  // ─── DELETE /:id - Delete Agent ──────────────────────────────

  describe('DELETE /agents/:id - Delete agent', () => {
    it('should delete agent successfully', async () => {
      vi.mocked(agentsRepo.delete).mockResolvedValue(true);

      const res = await app.request('/agents/agent-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual({});
      expect(agentsRepo.delete).toHaveBeenCalledWith('agent-1');
    });

    it('should return 404 for non-existent agent', async () => {
      vi.mocked(agentsRepo.delete).mockResolvedValue(false);

      const res = await app.request('/agents/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('Agent not found');
    });

    it('should handle database deletion error', async () => {
      vi.mocked(agentsRepo.delete).mockRejectedValue(new Error('Delete failed'));

      const res = await app.request('/agents/agent-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // ─── POST /:id/reset - Reset Conversation ────────────────────

  describe('POST /agents/:id/reset - Reset conversation', () => {
    it('should return 404 for non-existent agent', async () => {
      vi.mocked(agentsRepo.getById).mockResolvedValue(null);

      const res = await app.request('/agents/agent-1/reset', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should reset conversation and return new ID', async () => {
      const record = mockAgentRecord();
      vi.mocked(agentsRepo.getById).mockResolvedValue(record);

      const res = await app.request('/agents/agent-1/reset', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.conversationId).toBeDefined();
      expect(typeof data.data.conversationId).toBe('string');
    });
  });

  // ─── POST /resync - Resync Default Agents ────────────────────

  describe('POST /agents/resync - Resync from defaults', () => {
    it('should return counts when no defaults exist', async () => {
      // getDefaultAgents returns [] (our mock default)
      const res = await app.request('/agents/resync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.updated).toBe(0);
      expect(data.data.created).toBe(0);
      expect(data.data.total).toBe(0);
    });

    it('should update existing agents from defaults', async () => {
      const { getDefaultAgents } = await import('../db/seeds/default-agents.js');
      vi.mocked(getDefaultAgents).mockReturnValue([
        {
          id: 'default',
          name: 'Default Agent',
          systemPrompt: 'Be helpful.',
          provider: 'default',
          model: 'default',
          config: { toolGroups: ['core', 'memory'] },
        },
      ]);

      const existingRecord = mockAgentRecord({ id: 'default' });
      vi.mocked(agentsRepo.getById).mockResolvedValue(existingRecord);
      vi.mocked(agentsRepo.update).mockResolvedValue(existingRecord);

      const res = await app.request('/agents/resync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.updated).toBe(1);
      expect(data.data.created).toBe(0);
      expect(data.data.total).toBe(1);
      expect(agentsRepo.update).toHaveBeenCalledWith('default', expect.objectContaining({
        config: expect.objectContaining({
          toolGroups: ['core', 'memory'],
        }),
      }));
    });

    it('should create new agents from defaults', async () => {
      const { getDefaultAgents } = await import('../db/seeds/default-agents.js');
      vi.mocked(getDefaultAgents).mockReturnValue([
        {
          id: 'new-agent',
          name: 'New Default',
          systemPrompt: 'Be creative.',
          provider: 'default',
          model: 'default',
          config: { toolGroups: ['core'] },
        },
      ]);

      vi.mocked(agentsRepo.getById).mockResolvedValue(null);
      vi.mocked(agentsRepo.create).mockResolvedValue(mockAgentRecord({ id: 'new-agent' }));

      const res = await app.request('/agents/resync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.updated).toBe(0);
      expect(data.data.created).toBe(1);
      expect(agentsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        id: 'new-agent',
        name: 'New Default',
      }));
    });

    it('should handle errors for individual agents', async () => {
      const { getDefaultAgents } = await import('../db/seeds/default-agents.js');
      vi.mocked(getDefaultAgents).mockReturnValue([
        {
          id: 'failing-agent',
          name: 'Failing',
          systemPrompt: '',
          provider: 'default',
          model: 'default',
          config: {},
        },
        {
          id: 'success-agent',
          name: 'Success',
          systemPrompt: '',
          provider: 'default',
          model: 'default',
          config: {},
        },
      ]);

      vi.mocked(agentsRepo.getById)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      vi.mocked(agentsRepo.create)
        .mockRejectedValueOnce(new Error('Disk full'))
        .mockResolvedValueOnce(mockAgentRecord({ id: 'success-agent' }));

      const res = await app.request('/agents/resync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.created).toBe(1);
      expect(data.data.errors).toBeDefined();
      expect(data.data.errors).toHaveLength(1);
      expect(data.data.errors[0]).toContain('failing-agent');
      expect(data.data.errors[0]).toContain('Disk full');
    });

    it('should handle mixed updates and creates', async () => {
      const { getDefaultAgents } = await import('../db/seeds/default-agents.js');
      vi.mocked(getDefaultAgents).mockReturnValue([
        {
          id: 'existing-1',
          name: 'Existing',
          systemPrompt: '',
          provider: 'default',
          model: 'default',
          config: { toolGroups: ['core'] },
        },
        {
          id: 'new-1',
          name: 'New',
          systemPrompt: '',
          provider: 'default',
          model: 'default',
          config: { toolGroups: ['memory'] },
        },
      ]);

      vi.mocked(agentsRepo.getById)
        .mockResolvedValueOnce(mockAgentRecord({ id: 'existing-1' }))
        .mockResolvedValueOnce(null);
      vi.mocked(agentsRepo.update).mockResolvedValue(mockAgentRecord());
      vi.mocked(agentsRepo.create).mockResolvedValue(mockAgentRecord({ id: 'new-1' }));

      const res = await app.request('/agents/resync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.updated).toBe(1);
      expect(data.data.created).toBe(1);
      expect(data.data.total).toBe(2);
      expect(data.data.errors).toBeUndefined();
    });
  });

  // ─── Response Format ─────────────────────────────────────────

  describe('Response format', () => {
    it('should include meta with timestamp in success responses', async () => {
      vi.mocked(agentsRepo.getAll).mockResolvedValue([]);

      const res = await app.request('/agents');

      const data = await res.json();
      expect(data.meta).toBeDefined();
      expect(data.meta.timestamp).toBeDefined();
      expect(new Date(data.meta.timestamp).getTime()).not.toBeNaN();
    });

    it('should include meta with timestamp in error responses', async () => {
      vi.mocked(agentsRepo.getById).mockResolvedValue(null);

      const res = await app.request('/agents/nonexistent');

      const data = await res.json();
      expect(data.meta).toBeDefined();
      expect(data.meta.timestamp).toBeDefined();
    });
  });
});
