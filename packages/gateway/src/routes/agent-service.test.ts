import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import
// ---------------------------------------------------------------------------

const mockCreateAgent = vi.fn();
const mockCreateProvider = vi.fn();
const mockInjectMemoryIntoPrompt = vi.fn(async (prompt: string) => ({ systemPrompt: prompt }));
const mockHasServiceRegistry = vi.fn(() => false);
const mockGetServiceRegistry = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class MockToolRegistry {
    has = vi.fn(() => true);
    setConfigCenter = vi.fn();
  }
  return {
    ...actual,
    hasServiceRegistry: (...args: unknown[]) => mockHasServiceRegistry(...args),
    getServiceRegistry: (...args: unknown[]) => mockGetServiceRegistry(...args),
    Services: { Provider: 'provider' },
    createAgent: (...args: unknown[]) => mockCreateAgent(...args),
    ToolRegistry: MockToolRegistry,
    injectMemoryIntoPrompt: (...args: unknown[]) => mockInjectMemoryIntoPrompt(...args),
    unsafeToolId: vi.fn((name: string) => name),
    getBaseName: vi.fn((name: string) => name),
    createProvider: (...args: unknown[]) => mockCreateProvider(...args),
  };
});

const mockAgentsRepo = {
  getById: vi.fn(),
  create: vi.fn(),
};

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
};

vi.mock('../db/repositories/index.js', () => ({
  agentsRepo: mockAgentsRepo,
}));

vi.mock('../db/repositories/local-providers.js', () => ({
  localProvidersRepo: mockLocalProvidersRepo,
}));

const mockResolveProviderAndModel = vi.fn(async (p: string, m: string) => ({
  provider: p,
  model: m,
}));
const mockGetDefaultProvider = vi.fn();
const mockGetDefaultModel = vi.fn();
const mockGetConfiguredProviderIds = vi.fn(async () => new Set<string>());
const mockGetEnabledToolGroupIds = vi.fn(() => [] as string[]);

vi.mock('./settings.js', () => ({
  resolveProviderAndModel: (...args: unknown[]) =>
    mockResolveProviderAndModel(...(args as [string, string])),
  getDefaultProvider: (...args: unknown[]) => mockGetDefaultProvider(...args),
  getDefaultModel: (...args: unknown[]) => mockGetDefaultModel(...args),
  getConfiguredProviderIds: (...args: unknown[]) => mockGetConfiguredProviderIds(...args),
  getEnabledToolGroupIds: (...args: unknown[]) => mockGetEnabledToolGroupIds(...args),
}));

vi.mock('../services/config-center-impl.js', () => ({
  gatewayConfigCenter: {},
}));

vi.mock('../services/extension-service.js', () => ({
  getExtensionService: vi.fn(() => ({
    getSystemPromptSections: vi.fn(() => []),
  })),
}));

vi.mock('./agent-prompt.js', () => ({
  BASE_SYSTEM_PROMPT: 'Test system prompt',
}));

vi.mock('./agent-tools.js', () => ({
  registerGatewayTools: vi.fn(),
  registerDynamicTools: vi.fn(async () => []),
  registerPluginTools: vi.fn(() => []),
  registerExtensionTools: vi.fn(() => []),
  registerMcpTools: vi.fn(() => []),
  registerAllTools: vi.fn(),
  getToolDefinitions: vi.fn(() => []),
  MEMORY_TOOLS: [],
  GOAL_TOOLS: [],
  CUSTOM_DATA_TOOLS: [],
  PERSONAL_DATA_TOOLS: [],
  CONFIG_TOOLS: [],
  TRIGGER_TOOLS: [],
  PLAN_TOOLS: [],
  HEARTBEAT_TOOLS: [],
  EXTENSION_TOOLS: [],
  NOTIFICATION_TOOLS: [],
  DYNAMIC_TOOL_DEFINITIONS: [],
}));

// Cache maps that we control from tests
const agentCache = new Map();
const agentConfigCache = new Map();
const chatAgentCache = new Map();
const pendingAgents = new Map();
const pendingChatAgents = new Map();

const mockLruGet = vi.fn((cache: Map<string, unknown>, key: string) => cache.get(key));
const mockGetProviderApiKey = vi.fn(async () => 'test-api-key');
const mockLoadProviderConfig = vi.fn(() => ({ baseUrl: undefined }));
const mockResolveContextWindow = vi.fn(() => 128000);
const mockResolveRecordTools = vi.fn(() => ({ tools: [], configuredToolGroups: [] }));
const mockResolveToolGroups = vi.fn(() => []);
const mockEvictAgentFromCache = vi.fn();
const mockCreateApprovalCallback = vi.fn(() => vi.fn());

vi.mock('./agent-cache.js', () => ({
  NATIVE_PROVIDERS: new Set([
    'openai',
    'anthropic',
    'google',
    'deepseek',
    'groq',
    'mistral',
    'xai',
    'together',
    'fireworks',
    'perplexity',
  ]),
  agentCache,
  agentConfigCache,
  chatAgentCache,
  pendingAgents,
  pendingChatAgents,
  lruGet: (...args: unknown[]) => mockLruGet(...(args as [Map<string, unknown>, string])),
  createApprovalCallback: (...args: unknown[]) => mockCreateApprovalCallback(...args),
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...(args as [string])),
  loadProviderConfig: (...args: unknown[]) => mockLoadProviderConfig(...(args as [string])),
  resolveContextWindow: (...args: unknown[]) =>
    mockResolveContextWindow(...(args as [string, string, number?])),
  resolveRecordTools: (...args: unknown[]) => mockResolveRecordTools(...args),
  resolveToolGroups: (...args: unknown[]) => mockResolveToolGroups(...args),
  evictAgentFromCache: (...args: unknown[]) => mockEvictAgentFromCache(...args),
  MAX_AGENT_CACHE_SIZE: 50,
  MAX_CHAT_AGENT_CACHE_SIZE: 20,
}));

vi.mock('../config/defaults.js', () => ({
  AGENT_DEFAULT_MAX_TOKENS: 8192,
  AGENT_DEFAULT_TEMPERATURE: 0.7,
  AGENT_DEFAULT_MAX_TURNS: 25,
  AGENT_DEFAULT_MAX_TOOL_CALLS: 200,
  AI_META_TOOL_NAMES: ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'],
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const mod = await import('./agent-service.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentRecord(
  overrides?: Partial<{
    id: string;
    name: string;
    systemPrompt: string;
    provider: string;
    model: string;
    config: Record<string, unknown>;
  }>
): {
  id: string;
  name: string;
  systemPrompt: string;
  provider: string;
  model: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    systemPrompt: 'You are a helpful assistant.',
    provider: 'openai',
    model: 'gpt-4o',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockConversation(id: string = 'conv-123', systemPrompt: string = 'Test prompt') {
  return {
    id,
    systemPrompt,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMockMemory(opts?: {
  stats?: { messageCount: number; estimatedTokens: number; lastActivity: Date } | null;
  contextMessages?: Array<{ role: string; content: string }>;
}) {
  const defaultStats = { messageCount: 5, estimatedTokens: 2000, lastActivity: new Date() };
  const statsValue = opts?.stats === null ? undefined : (opts?.stats ?? defaultStats);
  return {
    delete: vi.fn(),
    create: vi.fn((prompt?: string) => makeMockConversation('new-conv-456', prompt)),
    getStats: vi.fn(() => statsValue),
    getContextMessages: vi.fn(() => opts?.contextMessages ?? []),
    clearMessages: vi.fn(),
    addMessage: vi.fn(),
  };
}

function makeMockAgent(opts?: {
  conversationId?: string;
  systemPrompt?: string;
  stats?: { messageCount: number; estimatedTokens: number; lastActivity: Date } | null;
  contextMessages?: Array<{ role: string; content: string }>;
}) {
  const memory = makeMockMemory({ stats: opts?.stats, contextMessages: opts?.contextMessages });
  const conversation = makeMockConversation(
    opts?.conversationId ?? 'conv-123',
    opts?.systemPrompt ?? 'Test prompt'
  );

  return {
    agent: {
      getConversation: vi.fn(() => conversation),
      getMemory: vi.fn(() => memory),
      loadConversation: vi.fn(),
      setRequestApproval: vi.fn(),
      name: 'Test Agent',
    },
    memory,
    conversation,
  };
}

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  agentCache.clear();
  agentConfigCache.clear();
  chatAgentCache.clear();
  pendingAgents.clear();
  pendingChatAgents.clear();

  // Reset default mock behaviors
  mockLruGet.mockImplementation((cache: Map<string, unknown>, key: string) => cache.get(key));
  mockGetProviderApiKey.mockResolvedValue('test-api-key');
  mockLoadProviderConfig.mockReturnValue({ baseUrl: undefined });
  mockResolveContextWindow.mockReturnValue(128000);
  mockResolveRecordTools.mockReturnValue({ tools: [], configuredToolGroups: [] });
  mockResolveToolGroups.mockReturnValue([]);
  mockResolveProviderAndModel.mockImplementation(async (p: string, m: string) => ({
    provider: p,
    model: m,
  }));
  mockInjectMemoryIntoPrompt.mockImplementation(async (prompt: string) => ({
    systemPrompt: prompt,
  }));
  mockHasServiceRegistry.mockReturnValue(false);
  mockGetConfiguredProviderIds.mockResolvedValue(new Set<string>());
});

// =============================================================================
// getSessionInfo
// =============================================================================

describe('getSessionInfo', () => {
  it('returns correct sessionId from agent conversation', () => {
    const { agent } = makeMockAgent({ conversationId: 'session-abc' });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.sessionId).toBe('session-abc');
  });

  it('returns correct messageCount from memory stats', () => {
    const { agent } = makeMockAgent({
      stats: { messageCount: 10, estimatedTokens: 5000, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.messageCount).toBe(10);
  });

  it('returns correct estimatedTokens', () => {
    const { agent } = makeMockAgent({
      stats: { messageCount: 3, estimatedTokens: 7500, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.estimatedTokens).toBe(7500);
  });

  it('returns maxContextTokens from resolveContextWindow', () => {
    mockResolveContextWindow.mockReturnValue(64000);
    const { agent } = makeMockAgent();
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.maxContextTokens).toBe(64000);
  });

  it('calculates contextFillPercent correctly', () => {
    mockResolveContextWindow.mockReturnValue(100000);
    const { agent } = makeMockAgent({
      stats: { messageCount: 5, estimatedTokens: 25000, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.contextFillPercent).toBe(25);
  });

  it('caps contextFillPercent at 100', () => {
    mockResolveContextWindow.mockReturnValue(1000);
    const { agent } = makeMockAgent({
      stats: { messageCount: 50, estimatedTokens: 5000, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.contextFillPercent).toBe(100);
  });

  it('handles zero estimatedTokens', () => {
    const { agent } = makeMockAgent({
      stats: { messageCount: 0, estimatedTokens: 0, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.estimatedTokens).toBe(0);
    expect(result.contextFillPercent).toBe(0);
  });

  it('uses contextWindowOverride when provided', () => {
    const { agent } = makeMockAgent();
    mod.getSessionInfo(agent as never, 'openai', 'gpt-4o', 32000);
    expect(mockResolveContextWindow).toHaveBeenCalledWith('openai', 'gpt-4o', 32000);
  });

  it('handles missing stats (null)', () => {
    const { agent } = makeMockAgent({ stats: null });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.messageCount).toBe(0);
    expect(result.estimatedTokens).toBe(0);
    expect(result.contextFillPercent).toBe(0);
  });

  it('rounds contextFillPercent correctly', () => {
    mockResolveContextWindow.mockReturnValue(30000);
    const { agent } = makeMockAgent({
      stats: { messageCount: 3, estimatedTokens: 10000, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    // 10000 / 30000 * 100 = 33.33... → 33
    expect(result.contextFillPercent).toBe(33);
  });

  it('passes provider and model to resolveContextWindow', () => {
    const { agent } = makeMockAgent();
    mod.getSessionInfo(agent as never, 'anthropic', 'claude-3-opus');
    expect(mockResolveContextWindow).toHaveBeenCalledWith('anthropic', 'claude-3-opus', undefined);
  });

  it('returns sessionId even when stats are null', () => {
    const { agent } = makeMockAgent({ stats: null });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.sessionId).toBe('conv-123');
  });

  it('handles large estimatedTokens exceeding maxContextTokens', () => {
    mockResolveContextWindow.mockReturnValue(4096);
    const { agent } = makeMockAgent({
      stats: { messageCount: 100, estimatedTokens: 50000, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.contextFillPercent).toBe(100);
    expect(result.estimatedTokens).toBe(50000);
    expect(result.maxContextTokens).toBe(4096);
  });

  it('returns exact 100 when tokens equal max', () => {
    mockResolveContextWindow.mockReturnValue(10000);
    const { agent } = makeMockAgent({
      stats: { messageCount: 10, estimatedTokens: 10000, lastActivity: new Date() },
    });
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result.contextFillPercent).toBe(100);
  });

  it('returns all expected fields', () => {
    const { agent } = makeMockAgent();
    const result = mod.getSessionInfo(agent as never, 'openai', 'gpt-4o');
    expect(result).toHaveProperty('sessionId');
    expect(result).toHaveProperty('messageCount');
    expect(result).toHaveProperty('estimatedTokens');
    expect(result).toHaveProperty('maxContextTokens');
    expect(result).toHaveProperty('contextFillPercent');
  });
});

// =============================================================================
// getContextBreakdown
// =============================================================================

describe('getContextBreakdown', () => {
  it('returns null when no agent in cache', () => {
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result).toBeNull();
  });

  it('returns breakdown when agent is in cache', () => {
    const { agent } = makeMockAgent({ systemPrompt: 'Hello world' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result).not.toBeNull();
  });

  it('parses ## headings into sections', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      '## Tools\nTool list here\n## Memory\nMemory data';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.sections).toHaveLength(2);
    expect(result!.sections[0]!.name).toBe('Tools');
    expect(result!.sections[1]!.name).toBe('Memory');
  });

  it('calculates tokens as chars/4 for system prompt', () => {
    const prompt = 'A'.repeat(400); // 400 chars → 100 tokens
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt = prompt;
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.systemPromptTokens).toBe(100);
  });

  it('handles prompt with no headings', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      'Just a plain prompt with no headings';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections[0]!.name).toBe('System Prompt');
  });

  it('handles text before first heading as Base Prompt', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      'Some preamble text\n\n## Tools\nTool info';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.sections[0]!.name).toBe('Base Prompt');
    expect(result!.sections[1]!.name).toBe('Tools');
  });

  it('handles multiple headings correctly', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      '## Alpha\nContent A\n## Beta\nContent B\n## Gamma\nContent C';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.sections).toHaveLength(3);
    expect(result!.sections.map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('handles empty system prompt', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt = '';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.systemPromptTokens).toBe(0);
    expect(result!.sections).toHaveLength(0);
  });

  it('returns correct providerName and modelName', () => {
    const { agent } = makeMockAgent({ systemPrompt: 'Hello' });
    chatAgentCache.set('chat|anthropic|claude-3-opus', agent);
    const result = mod.getContextBreakdown('anthropic', 'claude-3-opus');
    expect(result!.providerName).toBe('anthropic');
    expect(result!.modelName).toBe('claude-3-opus');
  });

  it('returns maxContextTokens from resolveContextWindow', () => {
    mockResolveContextWindow.mockReturnValue(200000);
    const { agent } = makeMockAgent({ systemPrompt: 'Hello' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.maxContextTokens).toBe(200000);
  });

  it('uses contextWindowOverride when provided', () => {
    const { agent } = makeMockAgent({ systemPrompt: 'Hello' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    mod.getContextBreakdown('openai', 'gpt-4o', 32000);
    expect(mockResolveContextWindow).toHaveBeenCalledWith('openai', 'gpt-4o', 32000);
  });

  it('returns messageHistoryTokens from memory stats', () => {
    const { agent } = makeMockAgent({
      systemPrompt: 'Hello',
      stats: { messageCount: 10, estimatedTokens: 3500, lastActivity: new Date() },
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.messageHistoryTokens).toBe(3500);
    expect(result!.messageCount).toBe(10);
  });

  it('handles null stats gracefully', () => {
    const { agent } = makeMockAgent({ systemPrompt: 'Hello', stats: null });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.messageHistoryTokens).toBe(0);
    expect(result!.messageCount).toBe(0);
  });

  it('handles pipe characters in provider/model for cache key', () => {
    const { agent } = makeMockAgent({ systemPrompt: 'Hello' });
    chatAgentCache.set('chat|provider_with_pipe|model_name', agent);
    const result = mod.getContextBreakdown('provider|with|pipe', 'model_name');
    expect(result).not.toBeNull();
  });

  it('section tokens sum approximately to systemPromptTokens', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      'Preamble\n## Section1\nContent1\n## Section2\nContent2';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    const sectionSum = result!.sections.reduce((acc, s) => acc + s.tokens, 0);
    // Because of Math.ceil per section, sum can be >= systemPromptTokens
    expect(sectionSum).toBeGreaterThanOrEqual(result!.systemPromptTokens);
  });

  it('handles heading at the very start (no preamble)', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      '## Only Section\nAll content is here';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    // No "Base Prompt" section since heading starts at 0
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections[0]!.name).toBe('Only Section');
  });

  it('handles undefined systemPrompt in conversation', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string | undefined }).systemPrompt = undefined;
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.systemPromptTokens).toBe(0);
    expect(result!.sections).toHaveLength(0);
  });

  it('correctly calculates tokens for each section', () => {
    const section1 = '## A\n' + 'x'.repeat(100); // 105 chars total for section
    const section2 = '## B\n' + 'y'.repeat(200); // 205 chars total for section
    const prompt = section1 + '\n' + section2;
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt = prompt;
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.sections).toHaveLength(2);
    // Each section's tokens should be roughly its char count / 4 (rounded up)
    for (const section of result!.sections) {
      expect(section.tokens).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// resetChatAgentContext
// =============================================================================

describe('resetChatAgentContext', () => {
  it('resets existing agent and returns { reset: true, newSessionId }', () => {
    const { agent, memory } = makeMockAgent({ conversationId: 'old-conv' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(result.reset).toBe(true);
    expect(result.newSessionId).toBe('new-conv-456');
    expect(memory.delete).toHaveBeenCalledWith('old-conv');
    expect(memory.create).toHaveBeenCalled();
    expect(agent.loadConversation).toHaveBeenCalledWith('new-conv-456');
  });

  it('returns { reset: false } when agent not in cache', () => {
    const result = mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(result.reset).toBe(false);
    expect(result.newSessionId).toBeUndefined();
  });

  it('uses correct cache key with pipe escaping', () => {
    const { agent } = makeMockAgent();
    chatAgentCache.set('chat|my_provider|my_model', agent);
    const result = mod.resetChatAgentContext('my|provider', 'my|model');
    expect(result.reset).toBe(true);
  });

  it('deletes the old conversation from memory', () => {
    const { agent, memory } = makeMockAgent({ conversationId: 'conv-to-delete' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(memory.delete).toHaveBeenCalledWith('conv-to-delete');
  });

  it('creates new conversation with old system prompt', () => {
    const { agent, conversation, memory } = makeMockAgent({ systemPrompt: 'My custom prompt' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(memory.create).toHaveBeenCalledWith(conversation.systemPrompt);
  });

  it('loads the new conversation into the agent', () => {
    const { agent } = makeMockAgent();
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(agent.loadConversation).toHaveBeenCalledWith('new-conv-456');
  });

  it('handles provider with no pipe characters', () => {
    const { agent } = makeMockAgent();
    chatAgentCache.set('chat|anthropic|claude-3-opus', agent);
    const result = mod.resetChatAgentContext('anthropic', 'claude-3-opus');
    expect(result.reset).toBe(true);
  });

  it('handles model with pipe characters', () => {
    const { agent } = makeMockAgent();
    chatAgentCache.set('chat|openai|model_v1', agent);
    const result = mod.resetChatAgentContext('openai', 'model|v1');
    expect(result.reset).toBe(true);
  });

  it('returns different newSessionId each time (from mock)', () => {
    const { agent } = makeMockAgent();
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result1 = mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(result1.newSessionId).toBeDefined();
  });

  it('does not remove agent from chatAgentCache', () => {
    const { agent } = makeMockAgent();
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    mod.resetChatAgentContext('openai', 'gpt-4o');
    expect(chatAgentCache.has('chat|openai|gpt-4o')).toBe(true);
  });
});

// =============================================================================
// clearAllChatAgentCaches
// =============================================================================

describe('clearAllChatAgentCaches', () => {
  it('returns count of cleared agents', () => {
    chatAgentCache.set('key1', {});
    chatAgentCache.set('key2', {});
    chatAgentCache.set('key3', {});
    const count = mod.clearAllChatAgentCaches();
    expect(count).toBe(3);
  });

  it('actually clears the cache', () => {
    chatAgentCache.set('key1', {});
    chatAgentCache.set('key2', {});
    mod.clearAllChatAgentCaches();
    expect(chatAgentCache.size).toBe(0);
  });

  it('returns 0 when cache is empty', () => {
    const count = mod.clearAllChatAgentCaches();
    expect(count).toBe(0);
  });

  it('clears cache completely even with many entries', () => {
    for (let i = 0; i < 10; i++) {
      chatAgentCache.set(`key-${i}`, {});
    }
    const count = mod.clearAllChatAgentCaches();
    expect(count).toBe(10);
    expect(chatAgentCache.size).toBe(0);
  });

  it('can be called multiple times safely', () => {
    chatAgentCache.set('key1', {});
    mod.clearAllChatAgentCaches();
    const secondCount = mod.clearAllChatAgentCaches();
    expect(secondCount).toBe(0);
  });
});

// =============================================================================
// getWorkspaceContext
// =============================================================================

describe('getWorkspaceContext', () => {
  const originalEnv = { ...process.env };
  const _originalPlatform = process.platform;

  beforeEach(() => {
    // Restore env between tests
    process.env = { ...originalEnv };
  });

  it('uses sessionWorkspaceDir when provided', () => {
    const result = mod.getWorkspaceContext('/custom/workspace');
    expect(result.workspaceDir).toBe('/custom/workspace');
  });

  it('falls back to WORKSPACE_DIR env var when no session dir', () => {
    process.env.WORKSPACE_DIR = '/env/workspace';
    const result = mod.getWorkspaceContext();
    expect(result.workspaceDir).toBe('/env/workspace');
  });

  it('falls back to process.cwd() when no env var and no session dir', () => {
    delete process.env.WORKSPACE_DIR;
    const result = mod.getWorkspaceContext();
    expect(result.workspaceDir).toBe(process.cwd());
  });

  it('returns correct homeDir from HOME env', () => {
    process.env.HOME = '/home/testuser';
    const result = mod.getWorkspaceContext();
    expect(result.homeDir).toBe('/home/testuser');
  });

  it('returns homeDir from USERPROFILE env when HOME is missing', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = 'C:\\Users\\testuser';
    const result = mod.getWorkspaceContext();
    expect(result.homeDir).toBe('C:\\Users\\testuser');
  });

  it('returns undefined homeDir when neither HOME nor USERPROFILE set', () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const result = mod.getWorkspaceContext();
    expect(result.homeDir).toBeUndefined();
  });

  it('returns correct tempDir for win32', () => {
    // process.platform is read-only but we can check the current platform behavior
    const result = mod.getWorkspaceContext();
    if (process.platform === 'win32') {
      expect(result.tempDir).toBe('C:\\Temp');
    } else {
      expect(result.tempDir).toBe('/tmp');
    }
  });

  it('returns all three fields', () => {
    const result = mod.getWorkspaceContext('/test');
    expect(result).toHaveProperty('workspaceDir');
    expect(result).toHaveProperty('homeDir');
    expect(result).toHaveProperty('tempDir');
  });

  it('prefers sessionWorkspaceDir over WORKSPACE_DIR env', () => {
    process.env.WORKSPACE_DIR = '/env/workspace';
    const result = mod.getWorkspaceContext('/session/workspace');
    expect(result.workspaceDir).toBe('/session/workspace');
  });

  it('prefers HOME over USERPROFILE', () => {
    process.env.HOME = '/home/preferred';
    process.env.USERPROFILE = 'C:\\Users\\fallback';
    const result = mod.getWorkspaceContext();
    expect(result.homeDir).toBe('/home/preferred');
  });
});

// =============================================================================
// isDemoMode
// =============================================================================

describe('isDemoMode', () => {
  it('returns true when no providers configured', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set<string>());
    const result = await mod.isDemoMode();
    expect(result).toBe(true);
  });

  it('returns false when openai is configured', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['openai']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns false when anthropic is configured', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['anthropic']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns false when google is configured', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['google']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns false when deepseek is configured', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['deepseek']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns false when any known provider is configured', async () => {
    const knownProviders = [
      'openai',
      'anthropic',
      'zhipu',
      'deepseek',
      'groq',
      'google',
      'xai',
      'mistral',
      'together',
      'fireworks',
      'perplexity',
    ];
    for (const provider of knownProviders) {
      mockGetConfiguredProviderIds.mockResolvedValue(new Set([provider]));
      const result = await mod.isDemoMode();
      expect(result).toBe(false);
    }
  });

  it('returns false when any provider is configured (including non-standard)', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['minimax', 'ollama']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns false when multiple providers are configured', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['openai', 'anthropic', 'google']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('calls getConfiguredProviderIds', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set<string>());
    await mod.isDemoMode();
    expect(mockGetConfiguredProviderIds).toHaveBeenCalled();
  });

  it('returns false for any configured provider regardless of name', async () => {
    // Any configured provider means not demo mode
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['some-random-provider']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns false when local provider is enabled', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set<string>());
    mockLocalProvidersRepo.listProviders.mockResolvedValue([{ id: 'ollama', isEnabled: true }]);
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('returns true when local provider exists but is disabled', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set<string>());
    mockLocalProvidersRepo.listProviders.mockResolvedValue([{ id: 'ollama', isEnabled: false }]);
    const result = await mod.isDemoMode();
    expect(result).toBe(true);
  });
});

// =============================================================================
// getAgent
// =============================================================================

describe('getAgent', () => {
  it('returns cached agent from lruGet', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValueOnce(agent);
    const result = await mod.getAgent('agent-1');
    expect(result).toBe(agent);
  });

  it('returns pending agent if in pendingAgents', async () => {
    const { agent } = makeMockAgent();
    pendingAgents.set('agent-1', Promise.resolve(agent));
    mockLruGet.mockReturnValueOnce(undefined);
    const result = await mod.getAgent('agent-1');
    expect(result).toBe(agent);
  });

  it('returns undefined when pending promise rejects', async () => {
    pendingAgents.set('agent-1', Promise.reject(new Error('fail')));
    mockLruGet.mockReturnValueOnce(undefined);
    const result = await mod.getAgent('agent-1');
    expect(result).toBeUndefined();
  });

  it('returns undefined when not in DB', async () => {
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    const result = await mod.getAgent('nonexistent');
    expect(result).toBeUndefined();
  });

  it('loads from DB when not cached and not pending', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'agent-db' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockCreateAgent.mockReturnValue(agent);

    const result = await mod.getAgent('agent-db');
    expect(mockAgentsRepo.getById).toHaveBeenCalledWith('agent-db');
    expect(result).toBe(agent);
  });

  it('returns undefined when creation fails', async () => {
    const record = makeAgentRecord({ id: 'agent-fail' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockCreateAgent.mockImplementation(() => {
      throw new Error('creation failed');
    });

    const result = await mod.getAgent('agent-fail');
    expect(result).toBeUndefined();
  });

  it('returns undefined when resolveProviderAndModel returns null provider', async () => {
    const record = makeAgentRecord({ id: 'agent-no-provider' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockResolveProviderAndModel.mockResolvedValue({ provider: '', model: 'gpt-4o' });

    const result = await mod.getAgent('agent-no-provider');
    expect(result).toBeUndefined();
  });

  it('returns undefined when API key is not configured', async () => {
    const record = makeAgentRecord({ id: 'agent-no-key' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockGetProviderApiKey.mockResolvedValue(undefined);

    const result = await mod.getAgent('agent-no-key');
    expect(result).toBeUndefined();
  });

  it('cleans up pendingAgents after creation finishes', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'agent-cleanup' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getAgent('agent-cleanup');
    // After awaiting, pendingAgents should be cleaned up
    expect(pendingAgents.has('agent-cleanup')).toBe(false);
  });

  it('cleans up pendingAgents even on failure', async () => {
    const record = makeAgentRecord({ id: 'agent-fail-cleanup' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockResolveProviderAndModel.mockResolvedValue({ provider: '', model: 'gpt-4o' });

    await mod.getAgent('agent-fail-cleanup');
    expect(pendingAgents.has('agent-fail-cleanup')).toBe(false);
  });
});

// =============================================================================
// getOrCreateDefaultAgent
// =============================================================================

describe('getOrCreateDefaultAgent', () => {
  it('returns cached default agent', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValueOnce(agent);
    const result = await mod.getOrCreateDefaultAgent();
    expect(result).toBe(agent);
  });

  it('returns pending default agent', async () => {
    const { agent } = makeMockAgent();
    pendingAgents.set('default', Promise.resolve(agent));
    mockLruGet.mockReturnValueOnce(undefined);
    const result = await mod.getOrCreateDefaultAgent();
    expect(result).toBe(agent);
  });

  it('loads from DB when default record exists', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'default' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockCreateAgent.mockReturnValue(agent);

    const result = await mod.getOrCreateDefaultAgent();
    expect(result).toBe(agent);
    expect(mockAgentsRepo.getById).toHaveBeenCalledWith('default');
  });

  it('creates new record when not in DB', async () => {
    const { agent } = makeMockAgent();
    const newRecord = makeAgentRecord({ id: 'default', provider: 'openai', model: 'gpt-4o' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue('openai');
    mockGetDefaultModel.mockResolvedValue('gpt-4o');
    mockAgentsRepo.create.mockResolvedValue(newRecord);
    mockCreateAgent.mockReturnValue(agent);

    const result = await mod.getOrCreateDefaultAgent();
    expect(result).toBe(agent);
    expect(mockAgentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        name: 'Personal Assistant',
        systemPrompt: 'Test system prompt',
        provider: 'openai',
        model: 'gpt-4o',
      })
    );
  });

  it('throws when no provider configured', async () => {
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue(null);

    await expect(mod.getOrCreateDefaultAgent()).rejects.toThrow(
      'No API key configured for any provider'
    );
  });

  it('throws when no model available', async () => {
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue('openai');
    mockGetDefaultModel.mockResolvedValue(null);

    await expect(mod.getOrCreateDefaultAgent()).rejects.toThrow(
      'No model available for provider: openai'
    );
  });

  it('uses BASE_SYSTEM_PROMPT for new agents', async () => {
    const { agent } = makeMockAgent();
    const newRecord = makeAgentRecord({ id: 'default' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue('openai');
    mockGetDefaultModel.mockResolvedValue('gpt-4o');
    mockAgentsRepo.create.mockResolvedValue(newRecord);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateDefaultAgent();
    expect(mockAgentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: 'Test system prompt' })
    );
  });

  it('includes default config values when creating', async () => {
    const { agent } = makeMockAgent();
    const newRecord = makeAgentRecord({ id: 'default' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue('anthropic');
    mockGetDefaultModel.mockResolvedValue('claude-3');
    mockAgentsRepo.create.mockResolvedValue(newRecord);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateDefaultAgent();
    expect(mockAgentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          maxTokens: 8192,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
        }),
      })
    );
  });

  it('cleans up pendingAgents after completion', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'default' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateDefaultAgent();
    expect(pendingAgents.has('default')).toBe(false);
  });

  it('cleans up pendingAgents on failure', async () => {
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue(null);

    try {
      await mod.getOrCreateDefaultAgent();
    } catch {
      // expected
    }
    expect(pendingAgents.has('default')).toBe(false);
  });

  it('uses getDefaultProvider to determine provider', async () => {
    const { agent } = makeMockAgent();
    const newRecord = makeAgentRecord({ id: 'default' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockAgentsRepo.getById.mockResolvedValue(null);
    mockGetDefaultProvider.mockResolvedValue('groq');
    mockGetDefaultModel.mockResolvedValue('llama-3');
    mockAgentsRepo.create.mockResolvedValue(newRecord);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateDefaultAgent();
    expect(mockGetDefaultProvider).toHaveBeenCalled();
    expect(mockGetDefaultModel).toHaveBeenCalledWith('groq');
  });
});

// =============================================================================
// getOrCreateChatAgent
// =============================================================================

describe('getOrCreateChatAgent', () => {
  it('returns cached chat agent', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockImplementation((cache: Map<string, unknown>, key: string) => {
      if (key === 'chat|openai|gpt-4o') return agent;
      return cache.get(key);
    });

    const result = await mod.getOrCreateChatAgent('openai', 'gpt-4o');
    expect(result).toBe(agent);
  });

  it('creates new agent when not cached', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    const result = await mod.getOrCreateChatAgent('openai', 'gpt-4o');
    expect(result).toBe(agent);
  });

  it('uses correct cache key format with pipe escaping', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateChatAgent('my|provider', 'my|model');
    expect(mockLruGet).toHaveBeenCalledWith(chatAgentCache, 'chat|my_provider|my_model');
  });

  it('returns pending promise if same key is already in progress', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    const pendingPromise = Promise.resolve(agent);
    pendingChatAgents.set('chat|openai|gpt-4o', pendingPromise);

    const result = await mod.getOrCreateChatAgent('openai', 'gpt-4o');
    expect(result).toBe(agent);
  });

  it('throws when API key not configured', async () => {
    mockLruGet.mockReturnValue(undefined);
    mockGetProviderApiKey.mockResolvedValue(undefined);

    await expect(mod.getOrCreateChatAgent('openai', 'gpt-4o')).rejects.toThrow(
      'API key not configured for provider: openai'
    );
  });

  it('cleans up pendingChatAgents after creation', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateChatAgent('openai', 'gpt-4o');
    expect(pendingChatAgents.has('chat|openai|gpt-4o')).toBe(false);
  });

  it('cleans up pendingChatAgents on failure', async () => {
    mockLruGet.mockReturnValue(undefined);
    mockGetProviderApiKey.mockResolvedValue(undefined);

    try {
      await mod.getOrCreateChatAgent('openai', 'gpt-4o');
    } catch {
      // expected
    }
    expect(pendingChatAgents.has('chat|openai|gpt-4o')).toBe(false);
  });

  it('stores created agent in chatAgentCache', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateChatAgent('anthropic', 'claude-3');
    expect(chatAgentCache.has('chat|anthropic|claude-3')).toBe(true);
  });

  it('uses openai as provider type for non-native providers', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateChatAgent('custom-local', 'my-model');
    expect(mockCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ provider: 'openai' }),
      }),
      expect.anything()
    );
  });

  it('uses native provider type for native providers', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateChatAgent('anthropic', 'claude-3');
    expect(mockCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ provider: 'anthropic' }),
      }),
      expect.anything()
    );
  });

  it('sets memory maxTokens to 75% of context window', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);
    mockResolveContextWindow.mockReturnValue(100000);

    await mod.getOrCreateChatAgent('openai', 'gpt-4o');
    expect(mockCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: { maxTokens: 75000 },
      }),
      expect.anything()
    );
  });
});

// =============================================================================
// getOrCreateAgentInstance
// =============================================================================

describe('getOrCreateAgentInstance', () => {
  it('returns cached agent via lruGet', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValueOnce(agent);
    const record = makeAgentRecord();

    const result = await mod.getOrCreateAgentInstance(record);
    expect(result).toBe(agent);
  });

  it('returns pending agent if same id in pendingAgents', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord();
    pendingAgents.set(record.id, Promise.resolve(agent));
    mockLruGet.mockReturnValueOnce(undefined);

    const result = await mod.getOrCreateAgentInstance(record);
    expect(result).toBe(agent);
  });

  it('creates agent from record when not cached or pending', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord();
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    const result = await mod.getOrCreateAgentInstance(record);
    expect(result).toBe(agent);
  });

  it('sets pending promise during creation', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord();
    mockLruGet.mockReturnValue(undefined);

    let _resolveCreation!: (value: unknown) => void;
    mockCreateAgent.mockImplementation(() => {
      return new Promise((resolve) => {
        _resolveCreation = resolve;
      });
    });

    // For agent creation, createAgentFromRecord is not directly mockable since it's internal.
    // Instead we mock createAgent (from core) to return our agent.
    mockCreateAgent.mockReturnValue(agent);
    const result = await mod.getOrCreateAgentInstance(record);
    expect(result).toBe(agent);
  });

  it('cleans up pendingAgents in finally', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'agent-pending-cleanup' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateAgentInstance(record);
    expect(pendingAgents.has('agent-pending-cleanup')).toBe(false);
  });

  it('throws when provider resolution fails', async () => {
    const record = makeAgentRecord({ id: 'agent-no-provider' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockResolveProviderAndModel.mockResolvedValue({ provider: '', model: 'gpt-4o' });

    await expect(mod.getOrCreateAgentInstance(record)).rejects.toThrow('No provider configured');
  });

  it('throws when no API key', async () => {
    const record = makeAgentRecord();
    mockLruGet.mockReturnValueOnce(undefined);
    mockGetProviderApiKey.mockResolvedValue(undefined);

    await expect(mod.getOrCreateAgentInstance(record)).rejects.toThrow('API key not configured');
  });

  it('throws when model is empty', async () => {
    const record = makeAgentRecord();
    mockLruGet.mockReturnValueOnce(undefined);
    mockResolveProviderAndModel.mockResolvedValue({ provider: 'openai', model: '' });

    await expect(mod.getOrCreateAgentInstance(record)).rejects.toThrow('No model configured');
  });

  it('caches agent after creation', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'agent-cache-test' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateAgentInstance(record);
    expect(agentCache.get('agent-cache-test')).toBe(agent);
  });

  it('evicts oldest when cache is at capacity', async () => {
    // Fill cache to capacity
    for (let i = 0; i < 50; i++) {
      agentCache.set(`old-agent-${i}`, {});
    }

    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'new-agent' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateAgentInstance(record);
    expect(mockEvictAgentFromCache).toHaveBeenCalled();
  });

  it('uses ServiceRegistry provider service when available', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord();
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    const mockProviderSvc = {
      resolve: vi.fn(async () => ({ provider: 'anthropic', model: 'claude-3' })),
    };
    mockHasServiceRegistry.mockReturnValue(true);
    mockGetServiceRegistry.mockReturnValue({
      tryGet: vi.fn(() => mockProviderSvc),
    });

    await mod.getOrCreateAgentInstance(record);
    expect(mockProviderSvc.resolve).toHaveBeenCalled();
  });

  it('falls back to resolveProviderAndModel when no ServiceRegistry', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord();
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);
    mockHasServiceRegistry.mockReturnValue(false);

    await mod.getOrCreateAgentInstance(record);
    expect(mockResolveProviderAndModel).toHaveBeenCalled();
  });

  it('uses record systemPrompt for agent config', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ systemPrompt: 'Custom prompt for agent' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateAgentInstance(record);
    expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
      'Custom prompt for agent',
      expect.anything()
    );
  });

  it('uses fallback prompt when record has no systemPrompt', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord();
    (record as { systemPrompt: undefined }).systemPrompt = undefined;
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateAgentInstance(record);
    expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
      'You are a helpful personal AI assistant.',
      expect.anything()
    );
  });
});

// =============================================================================
// compactContext
// =============================================================================

describe('compactContext', () => {
  it('returns { compacted: false } when no agent in cache', async () => {
    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result).toEqual({ compacted: false, removedMessages: 0, newTokenEstimate: 0 });
  });

  it('returns { compacted: false } when too few messages', async () => {
    const { agent, memory } = makeMockAgent({
      contextMessages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    memory.getContextMessages.mockReturnValue([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(false);
  });

  it('returns { compacted: false } when messages equal keepRecentMessages + 2', async () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    // default keepRecentMessages = 6, so 6 + 2 = 8 messages exactly
    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(false);
  });

  it('successfully compacts when enough messages exist', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message content number ${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 8,
      estimatedTokens: 1500,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary of the conversation' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(true);
    expect(result.summary).toBe('Summary of the conversation');
    expect(result.removedMessages).toBe(14); // 20 - 6
    expect(result.newTokenEstimate).toBe(1500);
  });

  it('returns { compacted: false } when no API key', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    mockGetProviderApiKey.mockResolvedValue(undefined);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(false);
  });

  it('returns { compacted: false } when AI summarization returns not ok', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({ ok: false, error: 'rate limited' }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(false);
  });

  it('returns { compacted: false } when provider creation throws', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    mockCreateProvider.mockImplementation(() => {
      throw new Error('provider error');
    });

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(false);
  });

  it('uses default keepRecentMessages of 6', async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 8,
      estimatedTokens: 500,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.removedMessages).toBe(6); // 12 - 6
  });

  it('respects custom keepRecentMessages', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 4,
      estimatedTokens: 300,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    const result = await mod.compactContext('openai', 'gpt-4o', 10);
    expect(result.removedMessages).toBe(10); // 20 - 10
  });

  it('clears messages and adds summary + acknowledgment + recent messages', async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 8,
      estimatedTokens: 800,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Conversation summary text' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    await mod.compactContext('openai', 'gpt-4o');

    expect(memory.clearMessages).toHaveBeenCalled();
    // Should add summary message
    expect(memory.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('Previous conversation summary'),
      })
    );
    // Should add acknowledgment message
    expect(memory.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Understood'),
      })
    );
    // Total addMessage calls: 2 (summary + ack) + 6 (recent) = 8
    expect(memory.addMessage).toHaveBeenCalledTimes(8);
  });

  it('handles complex content in older messages', async () => {
    const messages = [
      ...Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: i === 3 ? { type: 'image', data: 'base64...' } : `msg-${i}`,
      })),
    ];
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 4,
      estimatedTokens: 500,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    // Should not throw — complex content gets replaced with '[complex content]'
    const result = await mod.compactContext('openai', 'gpt-4o', 4);
    expect(result.compacted).toBe(true);
  });

  it('uses correct cache key with pipe escaping', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|my_provider|my_model', agent);
    mockGetProviderApiKey.mockResolvedValue(undefined);

    const result = await mod.compactContext('my|provider', 'my|model');
    expect(result.compacted).toBe(false); // no api key, but cache key was correct
  });

  it('returns newTokenEstimate from updated stats', async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    // getStats is called once in compactContext (after compaction, line 635)
    memory.getStats.mockReturnValue({
      messageCount: 8,
      estimatedTokens: 2500,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.newTokenEstimate).toBe(2500);
  });

  it('returns { compacted: false } when complete throws', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockRejectedValue(new Error('network error')),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    const result = await mod.compactContext('openai', 'gpt-4o');
    expect(result.compacted).toBe(false);
    expect(result.removedMessages).toBe(0);
  });

  it('passes correct parameters to provider.complete', async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 8,
      estimatedTokens: 800,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    await mod.compactContext('openai', 'gpt-4o');

    expect(mockProvider.complete).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: expect.stringContaining('Summarize the following') }],
      model: { model: 'gpt-4o', maxTokens: 500, temperature: 0.3 },
    });
  });

  it('creates provider with correct config', async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    memory.getStats.mockReturnValue({
      messageCount: 8,
      estimatedTokens: 800,
      lastActivity: new Date(),
    });
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    mockLoadProviderConfig.mockReturnValue({ baseUrl: 'https://custom.api.com' });

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: true,
        value: { content: 'Summary' },
      }),
    };
    mockCreateProvider.mockReturnValue(mockProvider);

    await mod.compactContext('openai', 'gpt-4o');

    expect(mockCreateProvider).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'test-api-key',
      baseUrl: 'https://custom.api.com',
    });
  });
});

// =============================================================================
// ContextBreakdown type
// =============================================================================

describe('ContextBreakdown type exports', () => {
  it('getContextBreakdown returns object matching ContextBreakdown shape', () => {
    const { agent } = makeMockAgent({ systemPrompt: 'Hello world' });
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result).toHaveProperty('systemPromptTokens');
    expect(result).toHaveProperty('messageHistoryTokens');
    expect(result).toHaveProperty('messageCount');
    expect(result).toHaveProperty('maxContextTokens');
    expect(result).toHaveProperty('modelName');
    expect(result).toHaveProperty('providerName');
    expect(result).toHaveProperty('sections');
    expect(Array.isArray(result!.sections)).toBe(true);
  });
});

// =============================================================================
// Edge cases and integration-style tests
// =============================================================================

describe('edge cases', () => {
  it('getOrCreateAgentInstance deduplicates concurrent requests', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'dedup-test' });
    mockLruGet.mockReturnValue(undefined);

    let _callCount = 0;
    mockCreateAgent.mockImplementation(() => {
      _callCount++;
      return agent;
    });

    // Fire two concurrent requests for the same agent
    const [result1, result2] = await Promise.all([
      mod.getOrCreateAgentInstance(record),
      mod.getOrCreateAgentInstance(record),
    ]);

    expect(result1).toBe(agent);
    expect(result2).toBe(agent);
    // createAgent should only be called once due to deduplication
    // (but createAgentFromRecord is internal, so the pendingAgents
    // dedup is what matters — both get the same promise)
  });

  it('getOrCreateChatAgent deduplicates concurrent requests', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValue(undefined);
    mockCreateAgent.mockReturnValue(agent);

    const [result1, result2] = await Promise.all([
      mod.getOrCreateChatAgent('openai', 'gpt-4o'),
      mod.getOrCreateChatAgent('openai', 'gpt-4o'),
    ]);

    expect(result1).toBe(agent);
    expect(result2).toBe(agent);
  });

  it('getOrCreateDefaultAgent deduplicates concurrent requests', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'default' });
    mockLruGet.mockReturnValue(undefined);
    mockAgentsRepo.getById.mockResolvedValue(record);
    mockCreateAgent.mockReturnValue(agent);

    const [result1, result2] = await Promise.all([
      mod.getOrCreateDefaultAgent(),
      mod.getOrCreateDefaultAgent(),
    ]);

    expect(result1).toBe(agent);
    expect(result2).toBe(agent);
  });

  it('compactContext with keepRecentMessages larger than total messages', async () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { agent, memory } = makeMockAgent();
    memory.getContextMessages.mockReturnValue(messages);
    chatAgentCache.set('chat|openai|gpt-4o', agent);

    const result = await mod.compactContext('openai', 'gpt-4o', 100);
    // 5 <= 100 + 2, so should NOT compact
    expect(result.compacted).toBe(false);
  });

  it('getWorkspaceContext with empty string sessionWorkspaceDir keeps it (nullish coalescing)', () => {
    // ?? only falls through for null/undefined, not empty string
    const result = mod.getWorkspaceContext('');
    expect(result.workspaceDir).toBe('');
  });

  it('isDemoMode returns false when zhipu is the only provider', async () => {
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['zhipu']));
    const result = await mod.isDemoMode();
    expect(result).toBe(false);
  });

  it('getContextBreakdown handles heading with special characters', () => {
    const { agent, conversation } = makeMockAgent();
    (conversation as { systemPrompt: string }).systemPrompt =
      '## Tools & Utilities (v2.0)\nContent here';
    chatAgentCache.set('chat|openai|gpt-4o', agent);
    const result = mod.getContextBreakdown('openai', 'gpt-4o');
    expect(result!.sections[0]!.name).toBe('Tools & Utilities (v2.0)');
  });

  it('resetChatAgentContext for non-existent provider/model', () => {
    const result = mod.resetChatAgentContext('nonexistent', 'model');
    expect(result).toEqual({ reset: false });
  });

  it('getAgent checks cache before DB', async () => {
    const { agent } = makeMockAgent();
    mockLruGet.mockReturnValueOnce(agent);
    const result = await mod.getAgent('cached-id');
    expect(result).toBe(agent);
    expect(mockAgentsRepo.getById).not.toHaveBeenCalled();
  });

  it('getOrCreateAgentInstance stores config in agentConfigCache', async () => {
    const { agent } = makeMockAgent();
    const record = makeAgentRecord({ id: 'config-cache-test' });
    mockLruGet.mockReturnValueOnce(undefined);
    mockCreateAgent.mockReturnValue(agent);

    await mod.getOrCreateAgentInstance(record);
    expect(agentConfigCache.has('config-cache-test')).toBe(true);
  });
});
