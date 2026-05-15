/**
 * Claw Runner Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClawConfig, ClawSession } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockChat,
  mockGetEventSystem,
  mockRegisterGatewayTools,
  mockRegisterDynamicTools,
  mockRegisterPluginTools,
  mockRegisterExtensionTools,
  mockRegisterMcpTools,
  mockGetSessionWorkspaceFiles,
} = vi.hoisted(() => {
  const mockChat = vi.fn().mockImplementation((_msg: string, opts?: { onToolEnd?: Function }) => {
    if (opts?.onToolEnd) {
      opts.onToolEnd(
        { name: 'search_web', arguments: '{"query":"test"}' },
        { content: 'found', isError: false, durationMs: 100 }
      );
    }
    return Promise.resolve({
      ok: true,
      value: {
        id: 'resp-1',
        content: 'Cycle complete',
        finishReason: 'stop',
        usage: { promptTokens: 300, completionTokens: 80, totalTokens: 380 },
        model: 'gpt-4o-mini',
        createdAt: new Date(),
      },
    });
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
    mockChat,
    mockGetEventSystem,
    mockRegisterGatewayTools: vi.fn(),
    mockRegisterDynamicTools: vi.fn().mockResolvedValue([]),
    mockRegisterPluginTools: vi.fn().mockReturnValue([]),
    mockRegisterExtensionTools: vi.fn().mockReturnValue([]),
    mockRegisterMcpTools: vi.fn().mockReturnValue([]),
    mockGetSessionWorkspaceFiles: vi.fn().mockReturnValue([]),
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Agent: class MockAgent {
      chat = mockChat;
      setDirectToolMode = vi.fn();
      reset = vi.fn();
    },
    ToolRegistry: class MockToolRegistry {
      setConfigCenter = vi.fn();
      register = vi.fn();
      has = vi.fn(() => true);
      get = vi.fn();
      getAll = vi.fn(() => []);
      clear = vi.fn();
    },
    registerAllTools: vi.fn(),
    getEventSystem: (...args: unknown[]) => mockGetEventSystem(...args),
    getErrorMessage: (e: unknown) => String(e instanceof Error ? e.message : e),
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
    AGENT_DEFAULT_MAX_TOKENS: 8192,
    AGENT_DEFAULT_TEMPERATURE: 0.7,
  };
});

const mockBuildEnhancedSystemPrompt = vi.fn().mockResolvedValue({
  prompt: 'enhanced prompt with memories',
  stats: { memoriesUsed: 3, goalsUsed: 2 },
});

vi.mock('../assistant/orchestrator.js', () => ({
  buildEnhancedSystemPrompt: mockBuildEnhancedSystemPrompt,
}));

vi.mock('../workspace/file-workspace.js', () => ({
  getSessionWorkspaceFiles: mockGetSessionWorkspaceFiles,
}));

const mockSoulsGetById = vi.fn();
vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: () => ({
    getById: mockSoulsGetById,
  }),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { ClawRunner } = await import('./claw-runner.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return {
    id: 'claw-1',
    userId: 'user-1',
    name: 'Research Claw',
    mission: 'Research market trends',
    mode: 'continuous',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 20,
      maxToolCallsPerCycle: 100,
      maxCyclesPerHour: 30,
      cycleTimeoutMs: 300000,
    },
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ClawSession> = {}): ClawSession {
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
    artifacts: [],
    pendingEscalation: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClawRunner', () => {
  let runner: InstanceType<typeof ClawRunner>;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new ClawRunner(makeConfig());
  });

  describe('runCycle', () => {
    it('executes a successful cycle and returns result', async () => {
      const session = makeSession();
      const result = await runner.runCycle(session);

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('search_web');
      expect(result.outputMessage).toBe('Cycle complete');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.tokensUsed).toEqual({ prompt: 300, completion: 80 });
    });

    it('returns error result on failure', async () => {
      mockChat.mockRejectedValueOnce(new Error('Provider unavailable'));

      const result = await runner.runCycle(makeSession());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Provider unavailable');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('includes inbox messages in cycle message', async () => {
      const session = makeSession({ inbox: ['Please check task #42'] });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Inbox Messages');
      expect(chatArg).toContain('Please check task #42');
    });

    it('includes persistent context in cycle message', async () => {
      const session = makeSession({ persistentContext: { lastUrl: 'https://example.com' } });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Working Memory');
      expect(chatArg).toContain('lastUrl');
    });

    it('includes artifact count when artifacts exist', async () => {
      const session = makeSession({ artifacts: ['art-1', 'art-2'] });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Published Artifacts: 2');
    });

    it('includes cost in cycle message', async () => {
      const session = makeSession({ totalCostUsd: 0.0523 });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('$0.0523');
    });

    it('resets the cached agent between cycles to bound conversation history', async () => {
      // First cycle creates the agent, second should reuse + reset it.
      const session = makeSession();
      await runner.runCycle(session);
      const cachedAgent = (runner as unknown as { agent: { reset?: () => void } }).agent;
      expect(cachedAgent).toBeDefined();
      expect(cachedAgent?.reset).toBeDefined();

      await runner.runCycle(session);
      expect((cachedAgent?.reset as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      await runner.runCycle(session);
      expect((cachedAgent?.reset as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });

    it('does not reset on the very first cycle (fresh agent)', async () => {
      await runner.runCycle(makeSession());
      const cachedAgent = (runner as unknown as { agent: { reset: ReturnType<typeof vi.fn> } }).agent;
      // Reset should not have been called on cycle 1 because the agent was
      // just created — only between cycles.
      expect(cachedAgent.reset.mock.calls.length).toBe(0);
    });
  });

  describe('system prompt', () => {
    it('includes claw capabilities section', async () => {
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Claw Tools');
      expect(basePromptArg).toContain('claw_install_package');
      expect(basePromptArg).toContain('claw_run_script');
      expect(basePromptArg).toContain('claw_create_tool');
      expect(basePromptArg).toContain('claw_spawn_subclaw');
      expect(basePromptArg).toContain('claw_publish_artifact');
      expect(basePromptArg).toContain('claw_request_escalation');
    });

    it('includes workspace info when workspaceId is set', async () => {
      // Workspace tree now refreshes per cycle (in cycle message), not in the
      // cached system prompt. The system prompt only mentions the workspace ID
      // and points at the per-cycle listing.
      mockGetSessionWorkspaceFiles.mockReturnValue([
        { name: 'script.py', isDirectory: false, size: 120 },
      ]);

      runner = new ClawRunner(makeConfig({ workspaceId: 'ws-abc' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Workspace');
      expect(basePromptArg).toContain('ws-abc');

      const cycleArg = mockChat.mock.calls[0][0] as string;
      expect(cycleArg).toContain('Workspace Files');
      expect(cycleArg).toContain('script.py');
    });

    it('handles empty workspace gracefully', async () => {
      mockGetSessionWorkspaceFiles.mockReturnValueOnce([]);

      runner = new ClawRunner(makeConfig({ workspaceId: 'ws-empty' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Workspace');
      expect(basePromptArg).toContain('.claw/ Directive System');
    });

    it('includes coding agent info when configured', async () => {
      runner = new ClawRunner(makeConfig({ codingAgentProvider: 'claude-code' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Coding Agent');
      expect(basePromptArg).toContain('claude-code');
    });

    it('includes parent context for subclaws', async () => {
      runner = new ClawRunner(makeConfig({ parentClawId: 'claw-parent', depth: 2 }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Parent Context');
      expect(basePromptArg).toContain('depth 2');
      expect(basePromptArg).toContain('claw-parent');
    });

    it('includes single-shot mode notice', async () => {
      runner = new ClawRunner(makeConfig({ mode: 'single-shot' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Single-Shot');
    });

    it('includes stop condition when set', async () => {
      runner = new ClawRunner(makeConfig({ stopCondition: 'max_cycles:50' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('max_cycles:50');
    });

    it('prepends soul identity when soulId is configured', async () => {
      mockSoulsGetById.mockResolvedValue({
        id: 'soul-1',
        identity: {
          name: 'Scout',
          emoji: '🔍',
          role: 'Trend Researcher',
          personality: 'Curious and methodical',
          voice: { tone: 'analytical' },
          boundaries: ['Never fabricate sources'],
          backstory: 'Born from a thousand RSS feeds',
        },
      });

      runner = new ClawRunner(makeConfig({ soulId: 'soul-1' }));
      await runner.runCycle(makeSession());

      const promptWithSoul = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(promptWithSoul).toContain('Your Identity');
      expect(promptWithSoul).toContain('Scout');
      expect(promptWithSoul).toContain('Trend Researcher');
      expect(promptWithSoul).toContain('Curious and methodical');
      expect(promptWithSoul).toContain('Never fabricate sources');
      expect(promptWithSoul).toContain('Born from a thousand RSS feeds');
    });

    it('falls back gracefully when soul is not found', async () => {
      mockSoulsGetById.mockResolvedValue(null);
      runner = new ClawRunner(makeConfig({ soulId: 'soul-missing' }));
      await runner.runCycle(makeSession());

      const promptWithSoul = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(promptWithSoul).not.toContain('Your Identity');
      // The base prompt should still be there
      expect(promptWithSoul).toContain('Claw Tools');
    });

    it('falls back gracefully when soul lookup throws', async () => {
      mockSoulsGetById.mockRejectedValue(new Error('db down'));
      runner = new ClawRunner(makeConfig({ soulId: 'soul-1' }));
      await runner.runCycle(makeSession());

      const promptWithSoul = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(promptWithSoul).not.toContain('Your Identity');
      expect(promptWithSoul).toContain('Claw Tools');
    });
  });

  describe('updateConfig', () => {
    it('updates the config used for subsequent cycles', async () => {
      runner.updateConfig(makeConfig({ name: 'Updated Claw' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Updated Claw');
    });
  });

  describe('enhanced prompt fallback', () => {
    it('uses base prompt when enhanced prompt fails', async () => {
      mockBuildEnhancedSystemPrompt.mockRejectedValueOnce(new Error('DB offline'));

      const result = await runner.runCycle(makeSession());
      expect(result.success).toBe(true);
    });
  });
});
