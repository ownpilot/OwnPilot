/**
 * SubagentRunner Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  MockAgent,
  MockToolRegistry,
  mockRegisterAllTools,
  mockGetErrorMessage,
  mockResolveForProcess,
  mockGetProviderApiKey,
  mockLoadProviderConfig,
  mockNativeProviders,
  mockRegisterGatewayTools,
  mockRegisterDynamicTools,
  mockRegisterPluginTools,
  mockRegisterExtensionTools,
  mockRegisterMcpTools,
  mockSetConfigCenter,
  mockChatFn,
  mockSetDirectToolMode,
  mockGetEventSystem,
} = vi.hoisted(() => {
  const mockChatFn = vi.fn();
  const mockSetDirectToolMode = vi.fn();
  const mockSetConfigCenter = vi.fn();

  const MockToolRegistry = vi.fn(function (this: any) {
    this.setConfigCenter = mockSetConfigCenter;
    this.register = vi.fn();
    this.has = vi.fn(() => true);
    this.get = vi.fn();
    this.getAll = vi.fn(() => []);
    this.clear = vi.fn();
  });

  const MockAgent = vi.fn(function (this: any) {
    this.chat = mockChatFn;
    this.setDirectToolMode = mockSetDirectToolMode;
  });

  const mockGetEventSystem = vi.fn(() => ({
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    hooks: { tap: vi.fn(), tapAny: vi.fn(() => vi.fn()) },
    scoped: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
      off: vi.fn(),
      hooks: { tap: vi.fn(), tapAny: vi.fn(() => vi.fn()) },
    })),
  }));

  return {
    MockAgent,
    MockToolRegistry,
    mockRegisterAllTools: vi.fn(),
    mockGetErrorMessage: vi.fn((e: unknown) => String(e instanceof Error ? e.message : e)),
    mockResolveForProcess: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o-mini' })),
    mockGetProviderApiKey: vi.fn(() => Promise.resolve('sk-test-key')),
    mockLoadProviderConfig: vi.fn(() => null),
    mockNativeProviders: new Set(['openai', 'anthropic']),
    mockRegisterGatewayTools: vi.fn(),
    mockRegisterDynamicTools: vi.fn(),
    mockRegisterPluginTools: vi.fn(),
    mockRegisterExtensionTools: vi.fn(),
    mockRegisterMcpTools: vi.fn(),
    mockSetConfigCenter,
    mockChatFn,
    mockSetDirectToolMode,
    mockGetEventSystem,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Agent: MockAgent,
    ToolRegistry: MockToolRegistry,
    registerAllTools: mockRegisterAllTools,
    getErrorMessage: mockGetErrorMessage,
    getEventSystem: (...args: unknown[]) => mockGetEventSystem(...args),
  };
});

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('./model-routing.js', () => ({
  resolveForProcess: mockResolveForProcess,
}));

vi.mock('../routes/agent-cache.js', () => ({
  getProviderApiKey: mockGetProviderApiKey,
  loadProviderConfig: mockLoadProviderConfig,
  NATIVE_PROVIDERS: mockNativeProviders,
}));

vi.mock('../routes/agent-tools.js', () => ({
  registerGatewayTools: mockRegisterGatewayTools,
  registerDynamicTools: mockRegisterDynamicTools,
  registerPluginTools: mockRegisterPluginTools,
  registerExtensionTools: mockRegisterExtensionTools,
  registerMcpTools: mockRegisterMcpTools,
}));

vi.mock('./config-center-impl.js', () => ({
  gatewayConfigCenter: {},
}));

vi.mock('../config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AGENT_DEFAULT_TEMPERATURE: 0.7,
  };
});

import { SubagentRunner } from './subagent-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides = {}) {
  return {
    name: 'test-agent',
    task: 'Do something useful',
    userId: 'user-1',
    ...overrides,
  };
}

const successChatResult = {
  ok: true,
  value: {
    content: 'Task completed successfully',
    usage: { promptTokens: 100, completionTokens: 50 },
  },
};

const failureChatResult = {
  ok: false,
  error: { message: 'LLM error' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubagentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderApiKey.mockResolvedValue('sk-test-key');
    mockResolveForProcess.mockResolvedValue({ provider: 'openai', model: 'gpt-4o-mini' });
    mockChatFn.mockResolvedValue(successChatResult);
    mockRegisterDynamicTools.mockResolvedValue(undefined);
  });

  // --- Constructor / getters ---

  it('starts with cancelled = false', () => {
    const runner = new SubagentRunner(makeInput());
    expect(runner.cancelled).toBe(false);
  });

  it('cancel() sets cancelled = true', () => {
    const runner = new SubagentRunner(makeInput());
    runner.cancel();
    expect(runner.cancelled).toBe(true);
  });

  // --- Successful run ---

  it('returns success result when chat resolves ok', async () => {
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(true);
    expect(result.result).toBe('Task completed successfully');
    expect(result.error).toBeNull();
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('includes usage in tokensUsed when provided', async () => {
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.tokensUsed).toEqual({ prompt: 100, completion: 50 });
  });

  it('sets tokensUsed to null when no usage in response', async () => {
    mockChatFn.mockResolvedValue({ ok: true, value: { content: 'done', usage: null } });
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();
    expect(result.tokensUsed).toBeNull();
  });

  it('uses explicit provider/model from input without calling resolveForProcess', async () => {
    const runner = new SubagentRunner(makeInput({ provider: 'anthropic', model: 'claude-3-opus' }));
    await runner.run();
    expect(mockResolveForProcess).not.toHaveBeenCalled();
    expect((result) => result).toBeTruthy();
  });

  it('falls back to resolveForProcess when provider/model not in input', async () => {
    const runner = new SubagentRunner(makeInput());
    await runner.run();
    expect(mockResolveForProcess).toHaveBeenCalledWith('subagent');
  });

  it('records tool calls via onToolEnd callback', async () => {
    // Simulate agent calling onToolEnd during execution
    mockChatFn.mockImplementation(async (_msg: string, opts: any) => {
      opts?.onToolEnd?.(
        { name: 'memory_search', arguments: '{"q":"test"}' },
        { content: 'result', isError: false, durationMs: 50 }
      );
      return successChatResult;
    });

    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe('memory_search');
    expect(result.toolCalls[0].success).toBe(true);
    expect(result.toolCallsUsed).toBe(1);
  });

  it('also calls external onToolEnd callback', async () => {
    mockChatFn.mockImplementation(async (_msg: string, opts: any) => {
      opts?.onToolEnd?.(
        { name: 'create_goal', arguments: '{}' },
        { content: 'ok', isError: false, durationMs: 20 }
      );
      return successChatResult;
    });

    const externalCallback = vi.fn();
    const runner = new SubagentRunner(makeInput());
    await runner.run(externalCallback);

    expect(externalCallback).toHaveBeenCalledOnce();
  });

  // --- Already-cancelled before run ---

  it('returns cancelled result when already cancelled before run', async () => {
    const runner = new SubagentRunner(makeInput({ provider: 'openai', model: 'gpt-4' }));
    runner.cancel();
    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Subagent cancelled');
    expect(mockChatFn).not.toHaveBeenCalled();
  });

  // --- Error paths ---

  it('returns failure result when chat result is not ok', async () => {
    mockChatFn.mockResolvedValue(failureChatResult);
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM error');
    expect(result.turnsUsed).toBe(0);
  });

  it('returns failure when getProviderApiKey returns null', async () => {
    mockGetProviderApiKey.mockResolvedValue(null);
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
  });

  it('returns failure when chat throws an error', async () => {
    mockChatFn.mockRejectedValue(new Error('Network error'));
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  // --- Tool registration errors are graceful ---

  it('continues when registerDynamicTools throws', async () => {
    mockRegisterDynamicTools.mockRejectedValue(new Error('DB unavailable'));
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(true); // still succeeds
  });

  it('continues when registerPluginTools throws', async () => {
    mockRegisterPluginTools.mockImplementation(() => {
      throw new Error('Plugin error');
    });
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(true);
  });

  it('continues when registerExtensionTools throws', async () => {
    mockRegisterExtensionTools.mockImplementation(() => {
      throw new Error('Extension error');
    });
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(true);
  });

  it('continues when registerMcpTools throws', async () => {
    mockRegisterMcpTools.mockImplementation(() => {
      throw new Error('MCP error');
    });
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();

    expect(result.success).toBe(true);
  });

  // --- Agent creation ---

  it('sets direct tool mode on created agent', async () => {
    const runner = new SubagentRunner(makeInput());
    await runner.run();

    expect(mockSetDirectToolMode).toHaveBeenCalledWith(true);
  });

  it('uses non-native provider type as "openai"', async () => {
    // When provider is not in NATIVE_PROVIDERS, providerType = 'openai'
    const runner = new SubagentRunner(makeInput({ provider: 'custom-llm', model: 'model-v1' }));
    await runner.run();

    // Agent was created — verify with our mock
    expect(MockAgent).toHaveBeenCalled();
    const agentConfig = (MockAgent as any).mock.calls[0][0];
    expect(agentConfig.provider.provider).toBe('openai'); // falls back to openai
  });

  it('uses native provider type when in NATIVE_PROVIDERS', async () => {
    const runner = new SubagentRunner(makeInput({ provider: 'anthropic', model: 'claude-3' }));
    await runner.run();

    const agentConfig = (MockAgent as any).mock.calls[0][0];
    expect(agentConfig.provider.provider).toBe('anthropic');
  });

  it('includes context in task message when provided', async () => {
    let sentMessage = '';
    mockChatFn.mockImplementation(async (msg: string) => {
      sentMessage = msg;
      return successChatResult;
    });

    const runner = new SubagentRunner(
      makeInput({ context: 'User is working on a TypeScript project' })
    );
    await runner.run();

    expect(sentMessage).toContain('## Context');
    expect(sentMessage).toContain('User is working on a TypeScript project');
  });

  it('task message always contains the task text', async () => {
    let sentMessage = '';
    mockChatFn.mockImplementation(async (msg: string) => {
      sentMessage = msg;
      return successChatResult;
    });

    const runner = new SubagentRunner(makeInput({ task: 'Search for recent news' }));
    await runner.run();

    expect(sentMessage).toContain('## Task');
    expect(sentMessage).toContain('Search for recent news');
  });

  it('respects limits override from input', async () => {
    const runner = new SubagentRunner(
      makeInput({ limits: { maxTurns: 3, maxTokens: 2048, maxToolCalls: 10 } })
    );
    await runner.run();

    const agentConfig = (MockAgent as any).mock.calls[0][0];
    expect(agentConfig.maxTurns).toBe(3);
    expect(agentConfig.model.maxTokens).toBe(2048);
  });

  it('uses allowedTools filter when provided', async () => {
    const runner = new SubagentRunner(
      makeInput({ allowedTools: ['memory_search', 'create_goal'] })
    );
    await runner.run();

    const agentConfig = (MockAgent as any).mock.calls[0][0];
    expect(agentConfig.tools).toEqual(['memory_search', 'create_goal']);
  });

  it('uses undefined tools filter when allowedTools is empty', async () => {
    const runner = new SubagentRunner(makeInput({ allowedTools: [] }));
    await runner.run();

    const agentConfig = (MockAgent as any).mock.calls[0][0];
    expect(agentConfig.tools).toBeUndefined();
  });

  it('result durationMs is a non-negative number', async () => {
    const runner = new SubagentRunner(makeInput());
    const result = await runner.run();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
