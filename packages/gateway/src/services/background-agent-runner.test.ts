/**
 * Background Agent Runner Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackgroundAgentConfig, BackgroundAgentSession } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChat = vi.fn().mockImplementation((_msg: string, opts?: { onToolEnd?: Function }) => {
  // Simulate a tool call via the onToolEnd callback
  if (opts?.onToolEnd) {
    opts.onToolEnd(
      { name: 'memory_search', arguments: '{"query":"test"}' },
      { content: 'found', isError: false, durationMs: 100 }
    );
  }
  return Promise.resolve({
    ok: true,
    value: {
      id: 'resp-1',
      content: 'Cycle complete',
      finishReason: 'stop',
      usage: { promptTokens: 200, completionTokens: 50, totalTokens: 250 },
      model: 'gpt-4o-mini',
      createdAt: new Date(),
    },
  });
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Agent: class MockAgent {
      chat = mockChat;
      setDirectToolMode = vi.fn();
    },
    ToolRegistry: class MockToolRegistry {
      setConfigCenter = vi.fn();
    },
    registerAllTools: vi.fn(),
  };
});

vi.mock('../routes/agent-cache.js', () => ({
  getProviderApiKey: vi.fn().mockResolvedValue('sk-test-key'),
  loadProviderConfig: vi.fn().mockReturnValue(null),
  NATIVE_PROVIDERS: new Set(['openai', 'anthropic']),
}));

vi.mock('./model-routing.js', () => ({
  resolveForProcess: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4o-mini' }),
}));

const mockRegisterGatewayTools = vi.fn();
const mockRegisterDynamicTools = vi.fn().mockResolvedValue([]);
const mockRegisterPluginTools = vi.fn().mockReturnValue([]);
const mockRegisterExtensionTools = vi.fn().mockReturnValue([]);
const mockRegisterMcpTools = vi.fn().mockReturnValue([]);

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

vi.mock('../config/defaults.js', () => ({
  AGENT_DEFAULT_MAX_TOKENS: 8192,
  AGENT_DEFAULT_TEMPERATURE: 0.7,
}));

const mockBuildEnhancedSystemPrompt = vi.fn().mockResolvedValue({
  prompt: 'enhanced prompt with memories',
  stats: { memoriesUsed: 3, goalsUsed: 2 },
});

vi.mock('../assistant/orchestrator.js', () => ({
  buildEnhancedSystemPrompt: mockBuildEnhancedSystemPrompt,
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { BackgroundAgentRunner } = await import('./background-agent-runner.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BackgroundAgentConfig> = {}): BackgroundAgentConfig {
  return {
    id: 'bg-1',
    userId: 'user-1',
    name: 'Test Agent',
    mission: 'Monitor user goals',
    mode: 'interval',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 120000,
    },
    autoStart: false,
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<BackgroundAgentSession> = {}): BackgroundAgentSession {
  return {
    config: makeConfig(),
    state: 'running',
    cyclesCompleted: 0,
    totalToolCalls: 0,
    totalCostUsd: 0,
    lastCycleAt: null,
    lastCycleDurationMs: null,
    lastCycleError: null,
    startedAt: new Date(),
    stoppedAt: null,
    persistentContext: {},
    inbox: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundAgentRunner', () => {
  let runner: InstanceType<typeof BackgroundAgentRunner>;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new BackgroundAgentRunner(makeConfig());
  });

  describe('runCycle', () => {
    it('executes a successful cycle and returns result', async () => {
      const session = makeSession();
      const result = await runner.runCycle(session);

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.tool).toBe('memory_search');
      expect(result.outputMessage).toBe('Cycle complete');
      expect(result.tokensUsed).toEqual({ prompt: 200, completion: 50 });
      expect(result.turns).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns error result when agent.chat throws', async () => {
      mockChat.mockImplementationOnce(() => Promise.reject(new Error('API error')));

      const session = makeSession();
      const result = await runner.runCycle(session);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('includes inbox messages in cycle prompt', async () => {
      const session = makeSession({ inbox: ['Check goal progress'] });
      await runner.runCycle(session);

      const cycleMessage = mockChat.mock.calls[0]![0] as string;
      expect(cycleMessage).toContain('Inbox Messages');
      expect(cycleMessage).toContain('Check goal progress');
    });

    it('includes persistent context in cycle prompt', async () => {
      const session = makeSession({
        persistentContext: { lastChecked: '2026-01-01' },
      });
      await runner.runCycle(session);

      const cycleMessage = mockChat.mock.calls[0]![0] as string;
      expect(cycleMessage).toContain('Working Memory');
      expect(cycleMessage).toContain('lastChecked');
    });

    it('includes stop condition in cycle prompt', async () => {
      const config = makeConfig({ stopCondition: 'max_cycles:100' });
      const r = new BackgroundAgentRunner(config);
      const session = makeSession({ config });
      await r.runCycle(session);

      const cycleMessage = mockChat.mock.calls[0]![0] as string;
      expect(cycleMessage).toContain('max_cycles:100');
    });

    // --- Full tool registration ---

    it('registers all 5 tool sources during cycle', async () => {
      const session = makeSession();
      await runner.runCycle(session);

      expect(mockRegisterGatewayTools).toHaveBeenCalledWith(expect.anything(), 'user-1', false);
      expect(mockRegisterDynamicTools).toHaveBeenCalledWith(expect.anything(), 'user-1', 'bg-bg-1', false);
      expect(mockRegisterPluginTools).toHaveBeenCalledWith(expect.anything(), false);
      expect(mockRegisterExtensionTools).toHaveBeenCalledWith(expect.anything(), 'user-1', false);
      expect(mockRegisterMcpTools).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('calls buildEnhancedSystemPrompt with userId', async () => {
      const session = makeSession();
      await runner.runCycle(session);

      expect(mockBuildEnhancedSystemPrompt).toHaveBeenCalledWith(
        expect.stringContaining('Test Agent'),
        expect.objectContaining({
          userId: 'user-1',
          maxMemories: 10,
          maxGoals: 5,
        })
      );
    });

    // --- Configurable provider/model ---

    it('uses configured provider/model when set', async () => {
      const config = makeConfig({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' });
      const r = new BackgroundAgentRunner(config);
      const session = makeSession({ config });
      await r.runCycle(session);

      // Verify resolveForProcess was NOT called since both provider and model are set
      const { resolveForProcess } = await import('./model-routing.js');
      expect(resolveForProcess).not.toHaveBeenCalled();
    });

    it('falls back to model routing when provider/model not configured', async () => {
      const session = makeSession();
      await runner.runCycle(session);

      const { resolveForProcess } = await import('./model-routing.js');
      expect(resolveForProcess).toHaveBeenCalledWith('pulse');
    });

    // --- Graceful degradation ---

    it('continues even if dynamic tools registration fails', async () => {
      mockRegisterDynamicTools.mockRejectedValueOnce(new Error('DB not ready'));

      const session = makeSession();
      const result = await runner.runCycle(session);

      expect(result.success).toBe(true);
    });

    it('continues even if plugin tools registration fails', async () => {
      mockRegisterPluginTools.mockImplementationOnce(() => {
        throw new Error('Plugin service not ready');
      });

      const session = makeSession();
      const result = await runner.runCycle(session);

      expect(result.success).toBe(true);
    });

    it('uses base prompt if buildEnhancedSystemPrompt fails', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValueOnce(new Error('Memory service not ready'));

      const session = makeSession();
      const result = await runner.runCycle(session);

      expect(result.success).toBe(true);
    });

    // --- System prompt ---

    it('builds system prompt with mission and rules', async () => {
      const session = makeSession();
      await runner.runCycle(session);

      const basePrompt = mockBuildEnhancedSystemPrompt.mock.calls[0]![0] as string;
      expect(basePrompt).toContain('Test Agent');
      expect(basePrompt).toContain('Monitor user goals');
      expect(basePrompt).toContain('MISSION_COMPLETE');
      expect(basePrompt).toContain('ALL system tools');
    });
  });

  describe('updateConfig', () => {
    it('updates the internal config', () => {
      const newConfig = makeConfig({ name: 'Updated Agent' });
      runner.updateConfig(newConfig);
      // No throw means success — internal state updated
    });
  });
});
