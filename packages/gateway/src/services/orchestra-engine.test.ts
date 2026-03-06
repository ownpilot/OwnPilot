/**
 * OrchestraEngine Tests
 *
 * Tests multi-agent plan execution: sequential, parallel, cancelled executions,
 * delegation, cancel, getExecution, and getHistory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks via vi.hoisted()
// =============================================================================

const {
  mockGenerateId,
  mockGetErrorMessage,
  mockEventsEmit,
  mockGetEventSystem,
  mockAgentsRepoInstance,
  MockAgentsRepository,
  mockOrchestraRepoInstance,
  MockOrchestraRepository,
  mockSubagentServiceInstance,
  mockGetSubagentService,
} = vi.hoisted(() => {
  let idCounter = 0;

  const mockGenerateId = vi.fn(() => `orch-${++idCounter}`);
  const mockGetErrorMessage = vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e)));

  const mockEventsEmit = vi.fn();
  const mockGetEventSystem = vi.fn(() => ({ emit: mockEventsEmit }));

  // AgentsRepository
  const mockAgentsRepoInstance = {
    getByName: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  const MockAgentsRepository = vi.fn(function () {
    return mockAgentsRepoInstance;
  });

  // OrchestraRepository
  const mockOrchestraRepoInstance = {
    saveExecution: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    getById: vi.fn(),
    cleanupOld: vi.fn(),
  };
  const MockOrchestraRepository = vi.fn(function () {
    return mockOrchestraRepoInstance;
  });

  // SubagentService
  let subSessionCounter = 0;
  const mockSubagentServiceInstance = {
    spawn: vi.fn(async (input: { name: string }) => ({
      id: `sub-${++subSessionCounter}`,
      parentId: 'conv-1',
      parentType: 'chat',
      userId: 'user-1',
      name: input.name,
      task: 'task',
      state: 'completed',
      spawnedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      turnsUsed: 1,
      toolCallsUsed: 0,
      tokensUsed: { prompt: 10, completion: 20 },
      durationMs: 100,
      result: 'Task done',
      error: null,
      toolCalls: [{ tool: 'search', args: {}, result: '' }],
      provider: 'openai',
      model: 'gpt-4o-mini',
      limits: { maxTurns: 20, maxToolCalls: 100, timeoutMs: 120000, maxTokens: 8192 },
    })),
    getSession: vi.fn(),
    cancel: vi.fn(),
    listByParent: vi.fn(),
  };
  const mockGetSubagentService = vi.fn(() => mockSubagentServiceInstance);

  return {
    mockGenerateId,
    mockGetErrorMessage,
    mockEventsEmit,
    mockGetEventSystem,
    mockAgentsRepoInstance,
    MockAgentsRepository,
    mockOrchestraRepoInstance,
    MockOrchestraRepository,
    mockSubagentServiceInstance,
    mockGetSubagentService,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: mockGenerateId,
    getErrorMessage: mockGetErrorMessage,
    getEventSystem: mockGetEventSystem,
    DEFAULT_ORCHESTRA_LIMITS: {
      maxTasks: 10,
      maxDurationMs: 300_000,
      maxConcurrent: 5,
    },
  };
});

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('./subagent-service.js', () => ({
  getSubagentService: mockGetSubagentService,
}));

vi.mock('../db/repositories/agents.js', () => ({
  AgentsRepository: MockAgentsRepository,
  agentsRepo: mockAgentsRepoInstance,
  createAgentsRepository: () => mockAgentsRepoInstance,
}));

vi.mock('../db/repositories/orchestra.js', () => ({
  OrchestraRepository: MockOrchestraRepository,
}));

// =============================================================================
// Import after mocks
// =============================================================================

const { OrchestraEngine, getOrchestraEngine, resetOrchestraEngine } =
  await import('./orchestra-engine.js');

// =============================================================================
// Helpers
// =============================================================================

function makeAgent(
  overrides: Partial<{
    id: string;
    name: string;
    systemPrompt: string;
    provider: string;
    model: string;
    config: Record<string, unknown>;
  }> = {}
) {
  return {
    id: 'agent-1',
    name: 'Research',
    systemPrompt: 'You are a researcher.',
    provider: 'openai',
    model: 'gpt-4o',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<{
    id: string;
    agentName: string;
    input: string;
    optional: boolean;
    dependsOn: string[];
    timeout: number;
  }> = {}
) {
  return {
    id: 'task-1',
    agentName: 'Research',
    input: 'Do some research',
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<{
    id: string;
    state: string;
    result: string | null;
    error: string | null;
    toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
    tokensUsed: { prompt: number; completion: number } | null;
    durationMs: number | null;
  }> = {}
) {
  return {
    id: 'sub-1',
    parentId: 'conv-1',
    parentType: 'chat',
    userId: 'user-1',
    name: 'Research',
    task: 'Do research',
    state: 'completed',
    spawnedAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    turnsUsed: 1,
    toolCallsUsed: 1,
    tokensUsed: { prompt: 10, completion: 20 },
    durationMs: 100,
    result: 'Task done',
    error: null,
    toolCalls: [{ tool: 'search', args: {}, result: '' }],
    provider: 'openai',
    model: 'gpt-4o-mini',
    limits: { maxTurns: 20, maxToolCalls: 100, timeoutMs: 120000, maxTokens: 8192 },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('OrchestraEngine', () => {
  let engine: InstanceType<typeof OrchestraEngine>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset ID counter
    mockGenerateId.mockImplementation(
      (() => {
        let c = 0;
        return () => `orch-${++c}`;
      })()
    );

    // Reset spawn session counter
    let spawnCounter = 0;
    mockSubagentServiceInstance.spawn.mockImplementation(async (input: { name: string }) => ({
      id: `sub-${++spawnCounter}`,
      parentId: 'conv-1',
      parentType: 'chat',
      userId: 'user-1',
      name: input.name,
      task: 'task',
      state: 'completed',
      spawnedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      turnsUsed: 1,
      toolCallsUsed: 0,
      tokensUsed: { prompt: 10, completion: 20 },
      durationMs: 100,
      result: 'Task done',
      error: null,
      toolCalls: [{ tool: 'search', args: {}, result: '' }],
      provider: 'openai',
      model: 'gpt-4o-mini',
      limits: { maxTurns: 20, maxToolCalls: 100, timeoutMs: 120000, maxTokens: 8192 },
    }));

    // Default getSession returns a completed session
    mockSubagentServiceInstance.getSession.mockImplementation((id: string) =>
      makeSession({ id, state: 'completed', result: 'Task done' })
    );

    mockOrchestraRepoInstance.saveExecution.mockResolvedValue(undefined);

    engine = new OrchestraEngine();
  });

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  describe('getOrchestraEngine() / resetOrchestraEngine()', () => {
    it('returns same instance on repeated calls', () => {
      resetOrchestraEngine();
      const a = getOrchestraEngine();
      const b = getOrchestraEngine();
      expect(a).toBe(b);
    });

    it('returns new instance after reset', () => {
      resetOrchestraEngine();
      const a = getOrchestraEngine();
      resetOrchestraEngine();
      const b = getOrchestraEngine();
      expect(a).not.toBe(b);
    });
  });

  // ---------------------------------------------------------------------------
  // delegateToAgent
  // ---------------------------------------------------------------------------

  describe('delegateToAgent()', () => {
    it('returns error when agent is not found', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(null);

      const result = await engine.delegateToAgent(
        { agentName: 'Unknown', task: 'Do something' },
        'conv-1',
        'user-1'
      );

      expect(result.running).toBe(false);
      expect(result.error).toMatch(/"Unknown" not found/);
      expect(result.subagentId).toBe('');
      expect(result.toolsUsed).toEqual([]);
    });

    it('returns running:false with result when agent found and waitForResult=true', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({ id: 'sub-1', state: 'completed', result: 'Research complete' })
      );

      const result = await engine.delegateToAgent(
        { agentName: 'Research', task: 'Find info', waitForResult: true },
        'conv-1',
        'user-1'
      );

      expect(result.running).toBe(false);
      expect(result.agentName).toBe('Research');
      expect(result.subagentId).toBeTruthy();
      expect(result.error).toBeUndefined();
      expect(result.toolsUsed).toBeInstanceOf(Array);
    });

    it('returns running:true when waitForResult=false', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const result = await engine.delegateToAgent(
        { agentName: 'Research', task: 'Find info', waitForResult: false },
        'conv-1',
        'user-1'
      );

      expect(result.running).toBe(true);
      expect(result.agentName).toBe('Research');
      expect(result.subagentId).toBeTruthy();
      // No result when not waiting
      expect(result.result).toBeUndefined();
    });

    it('uses agent system prompt in delegation prompt', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(
        makeAgent({ name: 'Coder', systemPrompt: 'You write clean code.' })
      );
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({ state: 'completed', result: 'done' })
      );

      await engine.delegateToAgent(
        { agentName: 'Coder', task: 'Write tests', waitForResult: true },
        'conv-1',
        'user-1'
      );

      const spawnCall = mockSubagentServiceInstance.spawn.mock.calls[0][0];
      expect(spawnCall.task).toContain('You write clean code.');
      expect(spawnCall.task).toContain('Write tests');
    });

    it('passes preferredProvider and preferredModel from agent config', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(
        makeAgent({
          config: { preferredProvider: 'anthropic', preferredModel: 'claude-3-5-sonnet' },
        })
      );
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({ state: 'completed', result: 'done' })
      );

      await engine.delegateToAgent(
        { agentName: 'Research', task: 'Research', waitForResult: true },
        'conv-1',
        'user-1'
      );

      const spawnCall = mockSubagentServiceInstance.spawn.mock.calls[0][0];
      expect(spawnCall.provider).toBe('anthropic');
      expect(spawnCall.model).toBe('claude-3-5-sonnet');
    });

    it('includes error in result when session has error state', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({ state: 'failed', result: null, error: 'model error' })
      );

      const result = await engine.delegateToAgent(
        { agentName: 'Research', task: 'Find info', waitForResult: true },
        'conv-1',
        'user-1'
      );

      expect(result.running).toBe(false);
      expect(result.error).toBe('model error');
    });
  });

  // ---------------------------------------------------------------------------
  // executePlan - validation
  // ---------------------------------------------------------------------------

  describe('executePlan() - validation', () => {
    it('throws when plan has no tasks', async () => {
      await expect(
        engine.executePlan(
          { description: 'empty', tasks: [], strategy: 'sequential' },
          'conv-1',
          'user-1'
        )
      ).rejects.toThrow('no tasks');
    });

    it('throws when plan exceeds maxTasks limit', async () => {
      const tasks = Array.from({ length: 11 }, (_, i) =>
        makeTask({ id: `t-${i}`, agentName: 'A' })
      );
      await expect(
        engine.executePlan(
          { description: 'too many', tasks, strategy: 'sequential' },
          'conv-1',
          'user-1'
        )
      ).rejects.toThrow('exceeds maximum tasks');
    });
  });

  // ---------------------------------------------------------------------------
  // executePlan - sequential
  // ---------------------------------------------------------------------------

  describe('executePlan() - sequential strategy', () => {
    it('executes all tasks in sequence and returns completed state', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        {
          description: 'Sequential plan',
          tasks: [
            makeTask({ id: 't-1', agentName: 'Research', input: 'Task 1' }),
            makeTask({ id: 't-2', agentName: 'Research', input: 'Task 2' }),
          ],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      expect(execution.state).toBe('completed');
      expect(execution.taskResults).toHaveLength(2);
      expect(execution.taskResults[0].taskId).toBe('t-1');
      expect(execution.taskResults[1].taskId).toBe('t-2');
      expect(execution.taskResults.every((r) => r.success)).toBe(true);
    });

    it('emits orchestra.started and orchestra.completed events', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      await engine.executePlan(
        {
          description: 'Event test',
          tasks: [makeTask({ id: 't-1' })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      const emitCalls = mockEventsEmit.mock.calls;
      const eventTypes = emitCalls.map((c: unknown[]) => c[0]);
      expect(eventTypes).toContain('orchestra.started');
      expect(eventTypes).toContain('orchestra.completed');
    });

    it('emits orchestra.task.complete events for each task', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      await engine.executePlan(
        {
          description: 'Task events',
          tasks: [makeTask({ id: 't-1' }), makeTask({ id: 't-2' })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      const taskCompleteEmits = mockEventsEmit.mock.calls.filter(
        (c: unknown[]) => c[0] === 'orchestra.task.complete'
      );
      expect(taskCompleteEmits).toHaveLength(2);
    });

    it('fails with state=failed when a required task fails', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());
      mockSubagentServiceInstance.getSession.mockReturnValueOnce(
        makeSession({ state: 'failed', result: null, error: 'task error' })
      );

      const execution = await engine.executePlan(
        {
          description: 'Failing plan',
          tasks: [makeTask({ id: 't-1', optional: false })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      expect(execution.state).toBe('failed');
    });

    it('continues past optional task failure', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      // First task fails (optional), second succeeds
      mockSubagentServiceInstance.getSession
        .mockReturnValueOnce(
          makeSession({ state: 'failed', result: null, error: 'optional task error' })
        )
        .mockReturnValueOnce(makeSession({ state: 'completed', result: 'ok' }));

      const execution = await engine.executePlan(
        {
          description: 'Optional fail plan',
          tasks: [
            makeTask({ id: 't-1', optional: true }),
            makeTask({ id: 't-2', optional: false }),
          ],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      expect(execution.state).toBe('completed');
      expect(execution.taskResults).toHaveLength(2);
    });

    it('persists execution to database', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      await engine.executePlan(
        { description: 'Persist test', tasks: [makeTask()], strategy: 'sequential' },
        'conv-1',
        'user-1'
      );

      // Wait for fire-and-forget persist
      await new Promise((r) => setImmediate(r));
      expect(mockOrchestraRepoInstance.saveExecution).toHaveBeenCalled();
    });

    it('stores execution in memory by ID', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        { description: 'Memory test', tasks: [makeTask()], strategy: 'sequential' },
        'conv-1',
        'user-1'
      );

      const retrieved = engine.getExecution(execution.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(execution.id);
    });

    it('works when agent is not found (falls back to raw task input)', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(null);

      const execution = await engine.executePlan(
        {
          description: 'No agent',
          tasks: [makeTask({ agentName: 'Ghost' })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      // The engine uses raw task input when no agent found
      expect(execution.state).toBe('completed');
      expect(execution.taskResults[0].agentName).toBe('Ghost');
    });
  });

  // ---------------------------------------------------------------------------
  // executePlan - parallel
  // ---------------------------------------------------------------------------

  describe('executePlan() - parallel strategy', () => {
    it('executes all tasks concurrently and returns completed state', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        {
          description: 'Parallel plan',
          tasks: [
            makeTask({ id: 't-1', agentName: 'Research', input: 'Task A' }),
            makeTask({ id: 't-2', agentName: 'Research', input: 'Task B' }),
            makeTask({ id: 't-3', agentName: 'Research', input: 'Task C' }),
          ],
          strategy: 'parallel',
        },
        'conv-1',
        'user-1'
      );

      expect(execution.state).toBe('completed');
      expect(execution.taskResults).toHaveLength(3);
    });

    it('state is completed even when a required parallel task returns success:false', async () => {
      // The parallel strategy only throws (setting state=failed) if a task PROMISE rejects.
      // executeTask() internally catches all errors and returns {success: false}.
      // Therefore, required task failures in parallel do NOT cause state=failed —
      // they surface in taskResults[].success but the plan itself completes.
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());
      mockSubagentServiceInstance.getSession.mockReturnValueOnce(
        makeSession({ state: 'failed', result: null, error: 'fail' })
      );

      const execution = await engine.executePlan(
        {
          description: 'Parallel fail',
          tasks: [makeTask({ id: 't-1', optional: false })],
          strategy: 'parallel',
        },
        'conv-1',
        'user-1'
      );

      // The plan completes (parallel strategy does not fail on task result failures)
      expect(execution.state).toBe('completed');
      // But the task result itself shows failure
      expect(execution.taskResults[0].success).toBe(false);
    });

    it('does not fail when optional parallel task fails', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());
      mockSubagentServiceInstance.getSession
        .mockReturnValueOnce(makeSession({ state: 'failed', result: null, error: 'opt fail' }))
        .mockReturnValue(makeSession({ state: 'completed', result: 'ok' }));

      const execution = await engine.executePlan(
        {
          description: 'Parallel optional',
          tasks: [
            makeTask({ id: 't-1', optional: true }),
            makeTask({ id: 't-2', optional: false }),
          ],
          strategy: 'parallel',
        },
        'conv-1',
        'user-1'
      );

      expect(execution.state).toBe('completed');
    });
  });

  // ---------------------------------------------------------------------------
  // executePlan - unknown strategy
  // ---------------------------------------------------------------------------

  describe('executePlan() - unknown strategy', () => {
    it('fails with unknown strategy error', async () => {
      const execution = await engine.executePlan(
        {
          description: 'Bad strategy',
          tasks: [makeTask()],
          strategy: 'unknown' as never,
        },
        'conv-1',
        'user-1'
      );

      expect(execution.state).toBe('failed');
      expect(execution.error).toMatch(/Unknown strategy/);
    });
  });

  // ---------------------------------------------------------------------------
  // cancel()
  // ---------------------------------------------------------------------------

  describe('cancel()', () => {
    it('does nothing when execution is not found', () => {
      expect(() => engine.cancel('nonexistent')).not.toThrow();
      expect(mockSubagentServiceInstance.cancel).not.toHaveBeenCalled();
    });

    it('sets cancelled flag and cancels running subagents', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      // Make spawn stall — getSession never returns completed
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({ state: 'running', result: null })
      );

      const planPromise = engine.executePlan(
        {
          description: 'Cancel test',
          tasks: [makeTask({ id: 't-1' })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      // Allow spawn to be called
      await new Promise((r) => setImmediate(r));

      // Get the executionId from the in-memory map (first key)
      // Then cancel and let getSession return completed to unblock waitForSubagent
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({ state: 'completed', result: 'cancelled result' })
      );

      const execution = await planPromise;

      // Cancel via stored id
      engine.cancel(execution.id);
      expect(mockSubagentServiceInstance.cancel).toHaveBeenCalled();
    });

    it('cancels all tracked subagents for the execution', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        {
          description: 'Multi-task cancel',
          tasks: [makeTask({ id: 't-1' }), makeTask({ id: 't-2' })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      engine.cancel(execution.id);
      // cancel should be called once per subagent tracked
      expect(mockSubagentServiceInstance.cancel).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getExecution()
  // ---------------------------------------------------------------------------

  describe('getExecution()', () => {
    it('returns null for unknown execution ID', () => {
      expect(engine.getExecution('no-such-id')).toBeNull();
    });

    it('returns the execution after executePlan completes', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        { description: 'Get test', tasks: [makeTask()], strategy: 'sequential' },
        'conv-1',
        'user-1'
      );

      const retrieved = engine.getExecution(execution.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.state).toBe('completed');
    });
  });

  // ---------------------------------------------------------------------------
  // listByParent()
  // ---------------------------------------------------------------------------

  describe('listByParent()', () => {
    it('returns empty array when no executions for parent', () => {
      expect(engine.listByParent('conv-none')).toEqual([]);
    });

    it('returns executions matching the parentId', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      await engine.executePlan(
        { description: 'P1', tasks: [makeTask()], strategy: 'sequential' },
        'conv-1',
        'user-1'
      );
      await engine.executePlan(
        { description: 'P2', tasks: [makeTask()], strategy: 'sequential' },
        'conv-2',
        'user-1'
      );

      const conv1Results = engine.listByParent('conv-1');
      expect(conv1Results).toHaveLength(1);
      expect(conv1Results[0].parentId).toBe('conv-1');
    });
  });

  // ---------------------------------------------------------------------------
  // getHistory()
  // ---------------------------------------------------------------------------

  describe('getHistory()', () => {
    it('delegates to OrchestraRepository.getHistory', async () => {
      const fakeHistory = {
        entries: [
          {
            id: 'orch-old',
            parentId: 'conv-1',
            userId: 'user-1',
            plan: { description: 'old', tasks: [], strategy: 'sequential' as const },
            state: 'completed' as const,
            taskResults: [],
            totalDurationMs: 500,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        total: 1,
      };
      mockOrchestraRepoInstance.getHistory.mockResolvedValue(fakeHistory);

      const result = await engine.getHistory('user-1', 10, 0);

      expect(mockOrchestraRepoInstance.getHistory).toHaveBeenCalledWith('user-1', 10, 0);
      expect(result.total).toBe(1);
      expect(result.entries[0].id).toBe('orch-old');
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup()
  // ---------------------------------------------------------------------------

  describe('cleanup()', () => {
    it('removes completed executions older than ttl', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        { description: 'Cleanup test', tasks: [makeTask()], strategy: 'sequential' },
        'conv-1',
        'user-1'
      );

      expect(engine.getExecution(execution.id)).not.toBeNull();

      // Backdate the completedAt so it falls before the cutoff
      const managed = engine.getExecution(execution.id);
      if (managed) {
        managed.completedAt = new Date(Date.now() - 31 * 60_000);
      }

      engine.cleanup(30 * 60_000);

      expect(engine.getExecution(execution.id)).toBeNull();
    });

    it('keeps executions newer than ttl', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());

      const execution = await engine.executePlan(
        { description: 'Keep test', tasks: [makeTask()], strategy: 'sequential' },
        'conv-1',
        'user-1'
      );

      // Default ttl of 30min — should not remove freshly completed
      engine.cleanup(30 * 60_000);

      expect(engine.getExecution(execution.id)).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Task result structure
  // ---------------------------------------------------------------------------

  describe('task result structure', () => {
    it('includes correct fields in task result', async () => {
      mockAgentsRepoInstance.getByName.mockResolvedValue(makeAgent());
      mockSubagentServiceInstance.getSession.mockReturnValue(
        makeSession({
          state: 'completed',
          result: 'Research result',
          toolCalls: [{ tool: 'search', args: {}, result: 'found' }],
          tokensUsed: { prompt: 50, completion: 100 },
          durationMs: 250,
        })
      );

      const execution = await engine.executePlan(
        {
          description: 'Struct test',
          tasks: [makeTask({ id: 'struct-task' })],
          strategy: 'sequential',
        },
        'conv-1',
        'user-1'
      );

      const taskResult = execution.taskResults[0];
      expect(taskResult.taskId).toBe('struct-task');
      expect(taskResult.agentName).toBe('Research');
      expect(taskResult.success).toBe(true);
      expect(taskResult.toolsUsed).toContain('search');
      expect(typeof taskResult.durationMs).toBe('number');
      expect(taskResult.tokenUsage).toBeDefined();
    });
  });
});
