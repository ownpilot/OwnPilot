import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (before dynamic import) ---

const mockGenerateId = vi.fn().mockReturnValue('agent_123_abc');
const mockGetProviderConfig = vi.fn().mockReturnValue(null);
const mockGetModelPricing = vi.fn().mockReturnValue(null);
const mockToolGroups: Record<string, { tools: string[] }> = {
  email: { tools: ['send_email', 'list_emails', 'read_email'] },
  memory: { tools: ['create_memory', 'search_memories'] },
};
const mockLocalProvidersRepo = {
  getProvider: vi.fn().mockResolvedValue(null),
  getProviderSync: vi.fn().mockReturnValue(null),
};
const mockGetApiKey = vi.fn().mockResolvedValue(undefined);
const mockGetApprovalManager = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: (...args: unknown[]) => mockGenerateId(...args),
    getProviderConfig: (...args: unknown[]) => mockGetProviderConfig(...args),
    getModelPricing: (...args: unknown[]) => mockGetModelPricing(...args),
    TOOL_GROUPS: mockToolGroups,
  };
});

vi.mock('../db/repositories/index.js', () => ({
  localProvidersRepo: mockLocalProvidersRepo,
}));

vi.mock('./settings.js', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

vi.mock('../autonomy/index.js', () => ({
  getApprovalManager: (...args: unknown[]) => mockGetApprovalManager(...args),
}));

vi.mock('../config/defaults.js', () => ({
  MAX_AGENT_CACHE_SIZE: 50,
  MAX_CHAT_AGENT_CACHE_SIZE: 10,
  AGENT_CREATE_DEFAULT_MAX_TOKENS: 4096,
  AGENT_DEFAULT_TEMPERATURE: 0.7,
  AGENT_DEFAULT_MAX_TURNS: 25,
  AGENT_DEFAULT_MAX_TOOL_CALLS: 200,
}));

vi.mock('./agent-tools.js', () => ({
  safeStringArray: (value: unknown) => {
    if (!Array.isArray(value)) return undefined;
    return value.filter((v): v is string => typeof v === 'string');
  },
}));

const mod = await import('./agent-cache.js');

beforeEach(() => {
  vi.clearAllMocks();
  mod.agentCache.clear();
  mod.agentConfigCache.clear();
  mod.chatAgentCache.clear();
  mod.pendingAgents.clear();
  mod.pendingChatAgents.clear();
});

// ---------------------------------------------------------------------------
// NATIVE_PROVIDERS
// ---------------------------------------------------------------------------
describe('NATIVE_PROVIDERS', () => {
  it('contains all expected providers', () => {
    const expected = [
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
    ];
    for (const p of expected) {
      expect(mod.NATIVE_PROVIDERS.has(p)).toBe(true);
    }
    expect(mod.NATIVE_PROVIDERS.size).toBe(expected.length);
  });

  it('does not contain unknown providers', () => {
    expect(mod.NATIVE_PROVIDERS.has('ollama')).toBe(false);
    expect(mod.NATIVE_PROVIDERS.has('azure')).toBe(false);
    expect(mod.NATIVE_PROVIDERS.has('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lruGet
// ---------------------------------------------------------------------------
describe('lruGet', () => {
  it('returns undefined for missing key', () => {
    const cache = new Map<string, number>();
    expect(mod.lruGet(cache, 'missing')).toBeUndefined();
  });

  it('returns value for existing key', () => {
    const cache = new Map<string, number>([['a', 1]]);
    expect(mod.lruGet(cache, 'a')).toBe(1);
  });

  it('moves accessed key to end of iteration order (LRU touch)', () => {
    const cache = new Map<string, number>();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' — should move it to the end
    mod.lruGet(cache, 'a');

    const keys = Array.from(cache.keys());
    expect(keys).toEqual(['b', 'c', 'a']);
  });

  it('works with empty map', () => {
    const cache = new Map<string, string>();
    expect(mod.lruGet(cache, 'any')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('does not affect other entries', () => {
    const cache = new Map<string, number>();
    cache.set('x', 10);
    cache.set('y', 20);
    cache.set('z', 30);

    mod.lruGet(cache, 'y');

    expect(cache.get('x')).toBe(10);
    expect(cache.get('z')).toBe(30);
    expect(cache.size).toBe(3);
  });

  it('preserves original value after LRU touch', () => {
    const cache = new Map<string, string>();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    const result = mod.lruGet(cache, 'key1');
    expect(result).toBe('value1');
    expect(cache.get('key1')).toBe('value1');
  });
});

// ---------------------------------------------------------------------------
// invalidateAgentCache
// ---------------------------------------------------------------------------
describe('invalidateAgentCache', () => {
  it('clears agentCache', () => {
    mod.agentCache.set('a1', {} as never);
    mod.invalidateAgentCache();
    expect(mod.agentCache.size).toBe(0);
  });

  it('clears agentConfigCache and chatAgentCache', () => {
    mod.agentConfigCache.set('cfg1', {} as never);
    mod.chatAgentCache.set('chat1', {} as never);
    mod.invalidateAgentCache();
    expect(mod.agentConfigCache.size).toBe(0);
    expect(mod.chatAgentCache.size).toBe(0);
  });

  it('clears pendingAgents and pendingChatAgents', () => {
    mod.pendingAgents.set('p1', Promise.resolve({} as never));
    mod.pendingChatAgents.set('p2', Promise.resolve({} as never));
    mod.invalidateAgentCache();
    expect(mod.pendingAgents.size).toBe(0);
    expect(mod.pendingChatAgents.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateAgentId
// ---------------------------------------------------------------------------
describe('generateAgentId', () => {
  it('calls generateId with "agent" prefix', () => {
    mod.generateAgentId();
    expect(mockGenerateId).toHaveBeenCalledWith('agent');
  });

  it('returns the result from generateId', () => {
    mockGenerateId.mockReturnValueOnce('agent_xyz_999');
    expect(mod.generateAgentId()).toBe('agent_xyz_999');
  });
});

// ---------------------------------------------------------------------------
// createApprovalCallback
// ---------------------------------------------------------------------------
describe('createApprovalCallback', () => {
  it('returns true when approvalManager.requestApproval returns null (pre-approved)', async () => {
    const mockApprovalMgr = {
      requestApproval: vi.fn().mockResolvedValue(null),
      processDecision: vi.fn(),
    };
    mockGetApprovalManager.mockReturnValue(mockApprovalMgr);

    const callback = mod.createApprovalCallback();
    const result = await callback!('filesystem', 'read_file', 'Read a file', {});
    expect(result).toBe(true);
  });

  it('returns false when action already rejected', async () => {
    const mockApprovalMgr = {
      requestApproval: vi.fn().mockResolvedValue({
        action: { id: 'act_1', status: 'rejected' },
      }),
      processDecision: vi.fn(),
    };
    mockGetApprovalManager.mockReturnValue(mockApprovalMgr);

    const callback = mod.createApprovalCallback();
    const result = await callback!('filesystem', 'write_file', 'Write a file', {});
    expect(result).toBe(false);
    expect(mockApprovalMgr.processDecision).not.toHaveBeenCalled();
  });

  it('auto-rejects pending actions in non-streaming context and returns false', async () => {
    const mockApprovalMgr = {
      requestApproval: vi.fn().mockResolvedValue({
        action: { id: 'act_2', status: 'pending' },
      }),
      processDecision: vi.fn(),
    };
    mockGetApprovalManager.mockReturnValue(mockApprovalMgr);

    const callback = mod.createApprovalCallback();
    const result = await callback!('execution', 'run_code', 'Execute code', { lang: 'js' });
    expect(result).toBe(false);
  });

  it('calls processDecision with reject and reason for pending actions', async () => {
    const mockApprovalMgr = {
      requestApproval: vi.fn().mockResolvedValue({
        action: { id: 'act_3', status: 'pending' },
      }),
      processDecision: vi.fn(),
    };
    mockGetApprovalManager.mockReturnValue(mockApprovalMgr);

    const callback = mod.createApprovalCallback();
    await callback!('network', 'fetch_url', 'Fetch URL', { url: 'https://example.com' });

    expect(mockApprovalMgr.processDecision).toHaveBeenCalledWith({
      actionId: 'act_3',
      decision: 'reject',
      reason: 'Auto-rejected: approval not available in non-streaming context',
    });
  });

  it('passes correct args to requestApproval', async () => {
    const mockApprovalMgr = {
      requestApproval: vi.fn().mockResolvedValue(null),
      processDecision: vi.fn(),
    };
    mockGetApprovalManager.mockReturnValue(mockApprovalMgr);

    const callback = mod.createApprovalCallback();
    const params = { path: '/etc/passwd' };
    await callback!('filesystem', 'read_file', 'Read sensitive file', params);

    expect(mockApprovalMgr.requestApproval).toHaveBeenCalledWith(
      'default',
      'filesystem',
      'read_file',
      'Read sensitive file',
      params
    );
  });
});

// ---------------------------------------------------------------------------
// getProviderApiKey
// ---------------------------------------------------------------------------
describe('getProviderApiKey', () => {
  it('returns local provider apiKey when available', async () => {
    mockLocalProvidersRepo.getProvider.mockResolvedValueOnce({ apiKey: 'sk-local-key' });
    const key = await mod.getProviderApiKey('ollama');
    expect(key).toBe('sk-local-key');
  });

  it('returns "local-no-key" when local provider has no apiKey', async () => {
    mockLocalProvidersRepo.getProvider.mockResolvedValueOnce({ apiKey: '' });
    const key = await mod.getProviderApiKey('ollama');
    expect(key).toBe('local-no-key');
  });

  it('falls back to getApiKey when no local provider', async () => {
    mockLocalProvidersRepo.getProvider.mockResolvedValueOnce(null);
    mockGetApiKey.mockResolvedValueOnce('sk-remote-key');
    const key = await mod.getProviderApiKey('openai');
    expect(key).toBe('sk-remote-key');
    expect(mockGetApiKey).toHaveBeenCalledWith('openai');
  });

  it('returns undefined when neither source has key', async () => {
    mockLocalProvidersRepo.getProvider.mockResolvedValueOnce(null);
    mockGetApiKey.mockResolvedValueOnce(undefined);
    const key = await mod.getProviderApiKey('unknown-provider');
    expect(key).toBeUndefined();
  });

  it('does not call getApiKey when local provider exists', async () => {
    mockLocalProvidersRepo.getProvider.mockResolvedValueOnce({ apiKey: 'sk-local' });
    await mod.getProviderApiKey('local-prov');
    expect(mockGetApiKey).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadProviderConfig
// ---------------------------------------------------------------------------
describe('loadProviderConfig', () => {
  it('returns builtin provider config when available', () => {
    mockGetProviderConfig.mockReturnValueOnce({
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      type: 'openai',
    });

    const result = mod.loadProviderConfig('openai');
    expect(result).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      type: 'openai',
    });
  });

  it('returns local provider config with /v1 suffix appended', () => {
    mockGetProviderConfig.mockReturnValueOnce(null);
    mockLocalProvidersRepo.getProviderSync.mockReturnValueOnce({
      baseUrl: 'http://localhost:11434',
    });

    const result = mod.loadProviderConfig('ollama');
    expect(result).toEqual({
      baseUrl: 'http://localhost:11434/v1',
      apiKeyEnv: undefined,
      type: 'openai-compatible',
    });
  });

  it('returns local provider config unchanged if already ends with /v1', () => {
    mockGetProviderConfig.mockReturnValueOnce(null);
    mockLocalProvidersRepo.getProviderSync.mockReturnValueOnce({
      baseUrl: 'http://localhost:8080/v1',
    });

    const result = mod.loadProviderConfig('lmstudio');
    expect(result).toEqual({
      baseUrl: 'http://localhost:8080/v1',
      apiKeyEnv: undefined,
      type: 'openai-compatible',
    });
  });

  it('strips trailing slashes from local provider baseUrl', () => {
    mockGetProviderConfig.mockReturnValueOnce(null);
    mockLocalProvidersRepo.getProviderSync.mockReturnValueOnce({
      baseUrl: 'http://localhost:11434///',
    });

    const result = mod.loadProviderConfig('ollama');
    expect(result).toEqual({
      baseUrl: 'http://localhost:11434/v1',
      apiKeyEnv: undefined,
      type: 'openai-compatible',
    });
  });

  it('returns null when neither source has config', () => {
    mockGetProviderConfig.mockReturnValueOnce(null);
    mockLocalProvidersRepo.getProviderSync.mockReturnValueOnce(null);

    const result = mod.loadProviderConfig('nonexistent');
    expect(result).toBeNull();
  });

  it('does not check local providers when builtin config exists', () => {
    mockGetProviderConfig.mockReturnValueOnce({
      baseUrl: 'https://api.anthropic.com',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      type: 'anthropic',
    });

    mod.loadProviderConfig('anthropic');
    expect(mockLocalProvidersRepo.getProviderSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveContextWindow
// ---------------------------------------------------------------------------
describe('resolveContextWindow', () => {
  it('returns userOverride when provided', () => {
    expect(mod.resolveContextWindow('openai', 'gpt-4', 32_000)).toBe(32_000);
    // Should not even call getProviderConfig
    expect(mockGetProviderConfig).not.toHaveBeenCalled();
  });

  it('returns provider model contextWindow from provider config', () => {
    mockGetProviderConfig.mockReturnValueOnce({
      models: [
        { id: 'gpt-4o', contextWindow: 200_000 },
        { id: 'gpt-4', contextWindow: 8_192 },
      ],
    });

    expect(mod.resolveContextWindow('openai', 'gpt-4')).toBe(8_192);
  });

  it('falls back to pricing contextWindow', () => {
    mockGetProviderConfig.mockReturnValueOnce({ models: [] });
    mockGetModelPricing.mockReturnValueOnce({ contextWindow: 100_000 });

    expect(mod.resolveContextWindow('anthropic', 'claude-3-opus')).toBe(100_000);
  });

  it('falls back to 128000 when no data', () => {
    mockGetProviderConfig.mockReturnValueOnce(null);
    mockGetModelPricing.mockReturnValueOnce(null);

    expect(mod.resolveContextWindow('unknown', 'unknown-model')).toBe(128_000);
  });

  it('returns pricing fallback when model not found in provider config', () => {
    mockGetProviderConfig.mockReturnValueOnce({
      models: [{ id: 'other-model', contextWindow: 4_096 }],
    });
    mockGetModelPricing.mockReturnValueOnce({ contextWindow: 64_000 });

    expect(mod.resolveContextWindow('openai', 'gpt-4-turbo')).toBe(64_000);
  });
});

// ---------------------------------------------------------------------------
// resolveToolGroups
// ---------------------------------------------------------------------------
describe('resolveToolGroups', () => {
  it('returns empty array when both args undefined', () => {
    expect(mod.resolveToolGroups(undefined, undefined)).toEqual([]);
  });

  it('returns explicit tools only when no groups', () => {
    const result = mod.resolveToolGroups(undefined, ['my_tool', 'another_tool']);
    expect(result).toEqual(['my_tool', 'another_tool']);
  });

  it('returns group tools only when no explicit tools', () => {
    const result = mod.resolveToolGroups(['email'], undefined);
    expect(result).toEqual(['send_email', 'list_emails', 'read_email']);
  });

  it('merges explicit and group tools with deduplication', () => {
    // 'send_email' is both explicit and in the email group
    const result = mod.resolveToolGroups(['email'], ['send_email', 'custom_tool']);
    expect(result).toContain('send_email');
    expect(result).toContain('list_emails');
    expect(result).toContain('read_email');
    expect(result).toContain('custom_tool');
    // send_email should appear only once (Set deduplication)
    expect(result.filter((t) => t === 'send_email')).toHaveLength(1);
  });

  it('skips unknown group names', () => {
    const result = mod.resolveToolGroups(['nonexistent_group'], ['my_tool']);
    expect(result).toEqual(['my_tool']);
  });

  it('returns empty array when both are empty arrays', () => {
    expect(mod.resolveToolGroups([], [])).toEqual([]);
  });

  it('handles empty explicit tools with valid groups', () => {
    const result = mod.resolveToolGroups(['memory'], []);
    expect(result).toEqual(['create_memory', 'search_memories']);
  });

  it('combines multiple groups', () => {
    const result = mod.resolveToolGroups(['email', 'memory'], undefined);
    expect(result).toEqual(
      expect.arrayContaining([
        'send_email',
        'list_emails',
        'read_email',
        'create_memory',
        'search_memories',
      ])
    );
    expect(result).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// resolveRecordTools
// ---------------------------------------------------------------------------
describe('resolveRecordTools', () => {
  it('returns configured tools from config.tools', () => {
    const result = mod.resolveRecordTools({ tools: ['tool_a', 'tool_b'] });
    expect(result.configuredTools).toEqual(['tool_a', 'tool_b']);
  });

  it('returns tool groups from config.toolGroups', () => {
    const result = mod.resolveRecordTools({ toolGroups: ['email'] });
    expect(result.configuredToolGroups).toEqual(['email']);
    expect(result.tools).toEqual(['send_email', 'list_emails', 'read_email']);
  });

  it('returns undefined for non-array config values', () => {
    const result = mod.resolveRecordTools({ tools: 'not-an-array', toolGroups: 42 });
    expect(result.configuredTools).toBeUndefined();
    expect(result.configuredToolGroups).toBeUndefined();
    expect(result.tools).toEqual([]);
  });

  it('merges tools and toolGroups', () => {
    const result = mod.resolveRecordTools({
      tools: ['custom_tool'],
      toolGroups: ['memory'],
    });
    expect(result.configuredTools).toEqual(['custom_tool']);
    expect(result.configuredToolGroups).toEqual(['memory']);
    expect(result.tools).toEqual(
      expect.arrayContaining(['custom_tool', 'create_memory', 'search_memories'])
    );
  });
});

// ---------------------------------------------------------------------------
// buildAgentConfigResponse
// ---------------------------------------------------------------------------
describe('buildAgentConfigResponse', () => {
  it('returns defaults when config is empty', () => {
    const result = mod.buildAgentConfigResponse({}, undefined, undefined);
    expect(result).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      maxTurns: 25,
      maxToolCalls: 200,
      tools: undefined,
      toolGroups: undefined,
    });
  });

  it('uses config values when present', () => {
    const result = mod.buildAgentConfigResponse(
      { maxTokens: 2048, temperature: 0.5, maxTurns: 10, maxToolCalls: 50 },
      ['tool_a'],
      ['email']
    );
    expect(result).toEqual({
      maxTokens: 2048,
      temperature: 0.5,
      maxTurns: 10,
      maxToolCalls: 50,
      tools: ['tool_a'],
      toolGroups: ['email'],
    });
  });

  it('passes through configuredTools and configuredToolGroups', () => {
    const tools = ['read_file', 'write_file'];
    const groups = ['memory', 'email'];
    const result = mod.buildAgentConfigResponse({}, tools, groups);
    expect(result.tools).toBe(tools);
    expect(result.toolGroups).toBe(groups);
  });

  it('handles partial overrides (some config, rest defaults)', () => {
    const result = mod.buildAgentConfigResponse(
      { maxTokens: 1024, temperature: 0.3 },
      undefined,
      undefined
    );
    expect(result).toEqual({
      maxTokens: 1024,
      temperature: 0.3,
      maxTurns: 25,
      maxToolCalls: 200,
      tools: undefined,
      toolGroups: undefined,
    });
  });

  it('falls back to defaults for null/undefined config values', () => {
    const result = mod.buildAgentConfigResponse(
      { maxTokens: null, temperature: undefined, maxTurns: null, maxToolCalls: undefined },
      undefined,
      undefined
    );
    expect(result).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      maxTurns: 25,
      maxToolCalls: 200,
      tools: undefined,
      toolGroups: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// evictAgentFromCache
// ---------------------------------------------------------------------------
describe('evictAgentFromCache', () => {
  it('deletes from agentCache', () => {
    mod.agentCache.set('agent_1', {} as never);
    mod.evictAgentFromCache('agent_1');
    expect(mod.agentCache.has('agent_1')).toBe(false);
  });

  it('deletes from agentConfigCache', () => {
    mod.agentConfigCache.set('agent_1', {} as never);
    mod.evictAgentFromCache('agent_1');
    expect(mod.agentConfigCache.has('agent_1')).toBe(false);
  });

  it('does not throw for missing key', () => {
    expect(() => mod.evictAgentFromCache('nonexistent')).not.toThrow();
  });

  it('does not affect chatAgentCache', () => {
    mod.chatAgentCache.set('agent_1', {} as never);
    mod.evictAgentFromCache('agent_1');
    // evictAgentFromCache only touches agentCache and agentConfigCache
    expect(mod.chatAgentCache.has('agent_1')).toBe(true);
  });

  it('only removes the specified id, leaving others intact', () => {
    mod.agentCache.set('agent_1', {} as never);
    mod.agentCache.set('agent_2', {} as never);
    mod.agentConfigCache.set('agent_1', {} as never);
    mod.agentConfigCache.set('agent_2', {} as never);

    mod.evictAgentFromCache('agent_1');

    expect(mod.agentCache.has('agent_1')).toBe(false);
    expect(mod.agentCache.has('agent_2')).toBe(true);
    expect(mod.agentConfigCache.has('agent_1')).toBe(false);
    expect(mod.agentConfigCache.has('agent_2')).toBe(true);
  });
});
