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
  mockLLMRouter,
  mockRegisterGatewayTools,
  mockRegisterDynamicTools,
  mockRegisterPluginTools,
  mockRegisterExtensionTools,
  mockRegisterMcpTools,
  mockGetSessionWorkspaceFiles,
  mockGetSessionWorkspacePath,
} = vi.hoisted(() => {
  const mockChat = vi
    .fn()
    .mockImplementation((_msg: string, opts?: { onToolEnd?: (...args: unknown[]) => unknown }) => {
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

  const mockLLMRouter = {
    pick: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4o-mini' }),
    getContextWindow: vi.fn().mockReturnValue(128_000),
    getMaxOutput: vi.fn().mockReturnValue(8192),
    computeMemoryMaxTokens: vi.fn().mockReturnValue(96_000),
    calculateCost: vi.fn().mockReturnValue(0),
  };

  return {
    mockChat,
    mockGetEventSystem,
    mockLLMRouter,
    mockRegisterGatewayTools: vi.fn(),
    mockRegisterDynamicTools: vi.fn().mockResolvedValue([]),
    mockRegisterPluginTools: vi.fn().mockReturnValue([]),
    mockRegisterExtensionTools: vi.fn().mockReturnValue([]),
    mockRegisterMcpTools: vi.fn().mockReturnValue([]),
    mockGetSessionWorkspaceFiles: vi.fn().mockReturnValue([]),
    mockGetSessionWorkspacePath: vi.fn((id: string) => `/srv/data/workspaces/${id}`),
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Agent: class MockAgent {
      chat = mockChat;
      setDirectToolMode = vi.fn();
      setPreflightCompactor = vi.fn();
      reset = vi.fn();
    },
    ToolRegistry: class MockToolRegistry {
      setConfigCenter = vi.fn();
      setWorkspaceDir = vi.fn();
      register = vi.fn();
      has = vi.fn(() => true);
      get = vi.fn();
      getAll = vi.fn(() => []);
      clear = vi.fn();
    },
    registerAllTools: vi.fn(),
    getEventSystem: (...args: unknown[]) => mockGetEventSystem(...args),
    getErrorMessage: (e: unknown) => String(e instanceof Error ? e.message : e),
    // ClawRunner now takes a RuntimeContext bundle in its constructor
    // (defaulting to getRuntimeContext()). Provide a fully-stubbed bundle
    // so the test never touches the real capability registry. Tests that
    // want to assert on specific calls can pass their own runtime arg to
    // `new ClawRunner(config, runtime)`.
    getLLMRouter: () => mockLLMRouter,
    getConfigCenter: () => ({ getApiKey: vi.fn(), getFieldValue: vi.fn() }),
    getPermissionGate: () => ({
      check: vi.fn().mockResolvedValue({ type: 'allow' }),
    }),
    getMemoryService: () => ({
      listMemories: vi.fn().mockResolvedValue([]),
      createMemory: vi.fn(),
      searchMemories: vi.fn().mockResolvedValue([]),
    }),
    getAuditService: () => ({
      logRequest: vi.fn(),
      logAudit: vi.fn(),
      queryLogs: vi.fn().mockResolvedValue([]),
      getStats: vi.fn(),
    }),
    getRuntimeContext: () => ({
      llm: mockLLMRouter,
      channels: { send: vi.fn(), listChannels: vi.fn(() => []) },
      config: { getApiKey: vi.fn(), getFieldValue: vi.fn() },
      events: mockGetEventSystem(),
      permissions: { check: vi.fn().mockResolvedValue({ type: 'allow' }) },
      memory: {
        listMemories: vi.fn().mockResolvedValue([]),
        createMemory: vi.fn(),
        searchMemories: vi.fn().mockResolvedValue([]),
      },
      audit: {
        logRequest: vi.fn(),
        logAudit: vi.fn(),
        queryLogs: vi.fn().mockResolvedValue([]),
        getStats: vi.fn(),
      },
    }),
  };
});

vi.mock('../agent/cache.js', () => ({
  getProviderApiKey: vi.fn().mockResolvedValue('sk-test-key'),
  loadProviderConfig: vi.fn().mockReturnValue(null),
  NATIVE_PROVIDERS: new Set(['openai', 'anthropic']),
  resolveContextWindow: vi.fn().mockReturnValue(128000),
  resolveMaxOutput: vi.fn().mockReturnValue(8192),
  computeMemoryMaxTokens: vi.fn().mockReturnValue(96000),
}));

vi.mock('../llm/model-routing.js', () => ({
  resolveForProcess: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4o-mini' }),
}));

vi.mock('../../routes/agent-tools.js', () => ({
  registerGatewayTools: mockRegisterGatewayTools,
  registerDynamicTools: mockRegisterDynamicTools,
  registerPluginTools: mockRegisterPluginTools,
  registerExtensionTools: mockRegisterExtensionTools,
  registerMcpTools: mockRegisterMcpTools,
}));

vi.mock('../../config/defaults.js', async (importOriginal) => {
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

vi.mock('../../assistant/orchestrator.js', () => ({
  buildEnhancedSystemPrompt: mockBuildEnhancedSystemPrompt,
}));

vi.mock('../../workspace/file-workspace.js', () => ({
  getSessionWorkspaceFiles: mockGetSessionWorkspaceFiles,
  getSessionWorkspacePath: mockGetSessionWorkspacePath,
  readSessionWorkspaceFile: vi.fn(() => null),
}));

const mockSoulsGetById = vi.fn();
vi.mock('../../db/repositories/souls.js', () => ({
  getSoulsRepository: () => ({
    getById: mockSoulsGetById,
  }),
}));

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { mockSaveAuditEntry, mockSaveAuditBatch } = vi.hoisted(() => ({
  mockSaveAuditEntry: vi.fn().mockResolvedValue(undefined),
  mockSaveAuditBatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../db/repositories/claws.js', () => ({
  getClawsRepository: () => ({
    saveAuditEntry: mockSaveAuditEntry,
    saveAuditBatch: mockSaveAuditBatch,
  }),
}));

const { mockExtGetEnabledMetadata, mockExtGetById } = vi.hoisted(() => ({
  mockExtGetEnabledMetadata: vi.fn().mockReturnValue([]),
  mockExtGetById: vi.fn().mockReturnValue(null),
}));
vi.mock('../extension/service.js', () => ({
  getExtensionService: () => ({
    getEnabledMetadata: mockExtGetEnabledMetadata,
    getById: mockExtGetById,
    getToolDefinitions: () => [],
  }),
}));

const { ClawRunner } = await import('./runner.js');

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
    consecutiveErrors: 0,
    recentFailures: [],
    tasks: [],
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

    it('surfaces session.nextIntent at the top of the prompt and clears it after rendering', async () => {
      const session = makeSession({
        nextIntent: 'Re-run failing test with --grep auth.race to isolate',
      });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Continuing from last cycle');
      expect(chatArg).toContain('Re-run failing test with --grep auth.race to isolate');
      // Auto-clear so a stale intent can never linger past one cycle.
      expect(session.nextIntent).toBeUndefined();
    });

    it('does NOT render the continuation block when nextIntent is unset', async () => {
      await runner.runCycle(makeSession());
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).not.toContain('Continuing from last cycle');
    });

    it('renders the structured task plan when session.tasks is non-empty', async () => {
      const session = makeSession({
        tasks: [
          {
            id: 't1',
            title: 'Audit codebase',
            status: 'in_progress',
            createdAt: '2026-05-28T10:00:00.000Z',
            updatedAt: '2026-05-28T10:00:00.000Z',
          },
          {
            id: 't2',
            title: 'Write fix',
            status: 'blocked',
            notes: 'waiting on PR review',
            createdAt: '2026-05-28T10:00:00.000Z',
            updatedAt: '2026-05-28T10:00:00.000Z',
          },
        ],
      });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('## Plan');
      expect(chatArg).toContain('[t1] Audit codebase');
      expect(chatArg).toContain('[t2] Write fix');
      expect(chatArg).toContain('waiting on PR review');
      // Status badges should appear next to each task.
      expect(chatArg).toMatch(/▶.*Audit codebase/);
      expect(chatArg).toMatch(/⛔.*Write fix/);
    });

    it('omits the Plan block when there are no structured tasks', async () => {
      await runner.runCycle(makeSession({ tasks: [] }));

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).not.toContain('## Plan');
    });

    it('renders Focus line for the single in_progress task', async () => {
      await runner.runCycle(
        makeSession({
          tasks: [
            {
              id: 't1',
              title: 'Audit',
              status: 'in_progress',
              cyclesInProgress: 2,
              createdAt: 'x',
              updatedAt: 'x',
            },
            { id: 't2', title: 'Fix', status: 'pending', createdAt: 'x', updatedAt: 'x' },
          ],
        })
      );
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('**Focus**: [t1] Audit');
      expect(chatArg).toContain('(2 cycles)');
      expect(chatArg).not.toContain('STALLED');
    });

    it('renders STALLED banner when an in_progress task crosses the threshold', async () => {
      await runner.runCycle(
        makeSession({
          tasks: [
            {
              id: 't1',
              title: 'Audit',
              status: 'in_progress',
              cyclesInProgress: 6, // > CLAW_TASK_STALL_THRESHOLD (5)
              createdAt: 'x',
              updatedAt: 'x',
            },
          ],
        })
      );
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('STALLED');
      expect(chatArg).toContain('6 cycles');
      expect(chatArg).toMatch(/⚠STALL/);
    });

    it('renders successCriteria next to the focused task', async () => {
      await runner.runCycle(
        makeSession({
          tasks: [
            {
              id: 't1',
              title: 'Add login',
              status: 'in_progress',
              cyclesInProgress: 1,
              successCriteria: 'POST /login returns 200 with jwt',
              createdAt: 'x',
              updatedAt: 'x',
            },
          ],
        })
      );
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('success criteria: POST /login returns 200 with jwt');
    });

    it('renders evidence next to completed tasks and a hint when missing', async () => {
      await runner.runCycle(
        makeSession({
          tasks: [
            {
              id: 't1',
              title: 'With proof',
              status: 'completed',
              evidence: 'tests green 412/412',
              createdAt: 'x',
              updatedAt: 'x',
            },
            {
              id: 't2',
              title: 'Without proof',
              status: 'completed',
              createdAt: 'x',
              updatedAt: 'x',
            },
          ],
        })
      );
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('evidence: tests green 412/412');
      expect(chatArg).toContain('none recorded');
    });

    it('renders Budget remaining when totalBudgetUsd is configured', async () => {
      const customRunner = new ClawRunner(
        makeConfig({ limits: { ...makeConfig().limits, totalBudgetUsd: 1.0 } })
      );
      await customRunner.runCycle(makeSession({ totalCostUsd: 0.25 }));
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Budget remaining: $0.7500 of $1.0000');
      expect(chatArg).toContain('25% used');
    });

    it('does NOT render Budget remaining when no budget is set', async () => {
      await runner.runCycle(makeSession({ totalCostUsd: 0.25 }));
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).not.toContain('Budget remaining');
    });

    it('renders Cycles remaining when stopCondition is max_cycles:N', async () => {
      const customRunner = new ClawRunner(makeConfig({ stopCondition: 'max_cycles:10' }));
      await customRunner.runCycle(makeSession({ cyclesCompleted: 7 }));
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Cycles remaining: 3 of 10');
    });

    it('renders plan_complete reminder when configured', async () => {
      const customRunner = new ClawRunner(makeConfig({ stopCondition: 'plan_complete' }));
      await customRunner.runCycle(
        makeSession({
          tasks: [{ id: 't1', title: 'A', status: 'pending', createdAt: 'x', updatedAt: 'x' }],
        })
      );
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('Stop condition: plan_complete');
      expect(chatArg).toContain('completed or blocked');
    });

    it('renders "Focus: none" hint when no task is in_progress but pending tasks exist', async () => {
      await runner.runCycle(
        makeSession({
          tasks: [
            { id: 't1', title: 'A', status: 'pending', createdAt: 'x', updatedAt: 'x' },
            { id: 't2', title: 'B', status: 'pending', createdAt: 'x', updatedAt: 'x' },
          ],
        })
      );
      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('**Focus**: none');
    });

    it('does NOT inject REFLECTION REQUIRED block below the threshold', async () => {
      // Below threshold (default is 2) — 0 and 1 should not trigger reflection.
      const session = makeSession({ consecutiveErrors: 1, recentFailures: [] });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).not.toContain('REFLECTION REQUIRED');
    });

    it('injects REFLECTION REQUIRED block at or above the threshold with recent failures', async () => {
      const session = makeSession({
        consecutiveErrors: 2,
        recentFailures: [
          {
            cycleNumber: 4,
            at: '2026-05-28T10:00:00.000Z',
            error: 'rate-limited',
            toolErrors: [{ tool: 'browser_open', error: 'ENOENT chromium' }],
          },
          {
            cycleNumber: 5,
            at: '2026-05-28T10:01:00.000Z',
            error: null,
            toolErrors: [{ tool: 'http_get', error: '503 Service Unavailable' }],
          },
        ],
      });
      await runner.runCycle(session);

      const chatArg = mockChat.mock.calls[0][0] as string;
      expect(chatArg).toContain('REFLECTION REQUIRED');
      expect(chatArg).toContain('You have failed 2 consecutive cycles');
      expect(chatArg).toContain('rate-limited');
      expect(chatArg).toContain('browser_open');
      expect(chatArg).toContain('ENOENT chromium');
      expect(chatArg).toContain('http_get');
      expect(chatArg).toContain('503 Service Unavailable');
      // Must instruct the agent to change strategy, not just retry.
      expect(chatArg).toMatch(/DIFFERENT strategy/i);
      // Must explicitly tell the agent to escalate when stuck.
      expect(chatArg).toContain('claw_request_escalation');
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
      const cachedAgent = (runner as unknown as { agent: { reset: ReturnType<typeof vi.fn> } })
        .agent;
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

    it('injects relevant learned skills into the system prompt', async () => {
      mockExtGetEnabledMetadata.mockReturnValue([
        {
          id: 'claw-learned-market-trends',
          name: 'claw-learned-market-trends',
          description: 'research market trends and summarize findings',
          format: 'agentskills',
          toolNames: [],
          keywords: ['claw-learned', 'claw-9'],
        },
      ]);
      mockExtGetById.mockReturnValue({
        manifest: { instructions: '## Procedure\n1. search the web for trends' },
      });

      // makeConfig mission is "Research market trends" — overlaps the skill.
      runner = new ClawRunner(makeConfig());
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('Learned Skills');
      expect(basePromptArg).toContain('claw-learned-market-trends');
      expect(basePromptArg).toContain('search the web for trends');
    });

    it('omits the learned-skills section when none match', async () => {
      mockExtGetEnabledMetadata.mockReturnValue([]);
      runner = new ClawRunner(makeConfig());
      await runner.runCycle(makeSession());
      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).not.toContain('Learned Skills');
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
      expect(basePromptArg).toContain('.claw/ Files');
    });

    it('resolves workspaceId to a directory and scopes file tools to it', async () => {
      mockGetSessionWorkspacePath.mockClear();
      runner = new ClawRunner(makeConfig({ workspaceId: 'ws-boundary' }));
      await runner.runCycle(makeSession());

      expect(mockGetSessionWorkspacePath).toHaveBeenCalledWith('ws-boundary');
    });

    it('does not resolve a workspace directory when no workspaceId is configured', async () => {
      mockGetSessionWorkspacePath.mockClear();
      runner = new ClawRunner(makeConfig({ workspaceId: undefined }));
      await runner.runCycle(makeSession());

      expect(mockGetSessionWorkspacePath).not.toHaveBeenCalled();
    });

    it('includes coding agent info when configured', async () => {
      runner = new ClawRunner(makeConfig({ codingAgentProvider: 'claude-code' }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('coding agents');
      expect(basePromptArg).toContain('claude-code');
    });

    it('includes parent context for subclaws', async () => {
      runner = new ClawRunner(makeConfig({ parentClawId: 'claw-parent', depth: 2 }));
      await runner.runCycle(makeSession());

      const basePromptArg = mockBuildEnhancedSystemPrompt.mock.calls[0][0] as string;
      expect(basePromptArg).toContain('SubClaw');
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

describe('ClawRunner autonomy guardrail', () => {
  const fullPolicy = {
    allowSelfModify: false,
    allowSubclaws: true,
    requireEvidence: false,
    destructiveActionPolicy: 'block' as const,
    filesystemScopes: [],
  };

  function makeRuntime(checkImpl: ReturnType<typeof vi.fn>) {
    return {
      llm: mockLLMRouter,
      permissions: { check: checkImpl },
    } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT pass a guardrail callback when no autonomyPolicy is set', async () => {
    let captured: unknown = 'unset';
    mockChat.mockImplementationOnce((_m: string, opts?: { onBeforeToolCall?: unknown }) => {
      captured = opts?.onBeforeToolCall;
      return Promise.resolve({ ok: true, value: { content: 'done' } });
    });
    const runner = new ClawRunner(makeConfig());
    await runner.runCycle(makeSession({ config: makeConfig() }));
    expect(captured).toBeUndefined();
  });

  it('passes a guardrail that denies a blocked destructive tool and audits it', async () => {
    const check = vi.fn().mockResolvedValue({
      type: 'deny',
      reason: 'Destructive action "delete_file" blocked by autonomy policy',
    });

    let captured:
      | ((tc: {
          id: string;
          name: string;
          arguments: string;
        }) => Promise<{ approved: boolean; reason?: string }>)
      | undefined;
    mockChat.mockImplementationOnce(
      (
        _m: string,
        opts?: {
          onBeforeToolCall?: (tc: {
            id: string;
            name: string;
            arguments: string;
          }) => Promise<{ approved: boolean; reason?: string }>;
        }
      ) => {
        captured = opts?.onBeforeToolCall;
        return Promise.resolve({ ok: true, value: { content: 'done' } });
      }
    );

    const config = makeConfig({ autonomyPolicy: fullPolicy, workspaceId: 'ws-1' });
    const runner = new ClawRunner(config, makeRuntime(check));
    await runner.runCycle(makeSession({ config }));

    expect(captured).toBeTypeOf('function');
    const decision = await captured!({
      id: 't1',
      name: 'core.delete_file',
      arguments: '{"path":"/etc/passwd"}',
    });

    expect(decision.approved).toBe(false);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'core.delete_file',
        context: expect.objectContaining({ actorType: 'claw', autonomyPolicy: fullPolicy }),
      })
    );
    // The blocked call is recorded for the operator watcher trail.
    await vi.waitFor(() =>
      expect(mockSaveAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'blocked',
          success: false,
          toolName: 'core.delete_file',
        })
      )
    );
  });

  it('passes a guardrail that approves when the gate allows', async () => {
    const check = vi.fn().mockResolvedValue({ type: 'allow' });
    let captured:
      | ((tc: { id: string; name: string; arguments: string }) => Promise<{ approved: boolean }>)
      | undefined;
    mockChat.mockImplementationOnce(
      (
        _m: string,
        opts?: {
          onBeforeToolCall?: (tc: {
            id: string;
            name: string;
            arguments: string;
          }) => Promise<{ approved: boolean }>;
        }
      ) => {
        captured = opts?.onBeforeToolCall;
        return Promise.resolve({ ok: true, value: { content: 'done' } });
      }
    );

    const config = makeConfig({
      autonomyPolicy: { ...fullPolicy, destructiveActionPolicy: 'allow' },
    });
    const runner = new ClawRunner(config, makeRuntime(check));
    await runner.runCycle(makeSession({ config }));

    const decision = await captured!({ id: 't2', name: 'core.read_file', arguments: '{}' });
    expect(decision.approved).toBe(true);
    expect(mockSaveAuditEntry).not.toHaveBeenCalled();
  });
});
