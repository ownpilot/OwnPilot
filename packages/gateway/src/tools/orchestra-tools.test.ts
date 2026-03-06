/**
 * Orchestra Tools Tests
 *
 * Tests for all 4 orchestra LLM-callable tools:
 * - delegate_to_agent
 * - execute_orchestra_plan
 * - check_orchestra
 * - list_available_agents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEngine = {
  delegateToAgent: vi.fn(),
  executePlan: vi.fn(),
  getExecution: vi.fn(),
};

vi.mock('../services/orchestra-engine.js', () => ({
  getOrchestraEngine: () => mockEngine,
}));

const mockAgentsRepo = {
  getAll: vi.fn(),
};

const MockAgentsRepository = vi.fn().mockImplementation(function () {
  return mockAgentsRepo;
});

vi.mock('../db/repositories/agents.js', () => ({
  AgentsRepository: MockAgentsRepository,
}));

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

const { executeOrchestraTool, ORCHESTRA_TOOL_DEFINITIONS, ORCHESTRA_TOOL_NAMES } =
  await import('./orchestra-tools.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    parentId: 'conv-1',
    userId: 'user-1',
    state: 'completed',
    totalDurationMs: 3000,
    startedAt: new Date(),
    completedAt: new Date(),
    plan: {
      description: 'Test plan',
      strategy: 'sequential',
      tasks: [{ id: 'task-1', agentName: 'Research Assistant', input: 'Do research' }],
    },
    taskResults: [
      {
        taskId: 'task-1',
        agentName: 'Research Assistant',
        subagentId: 'sub-1',
        output: 'Research done',
        toolsUsed: ['web_search'],
        tokenUsage: { prompt: 100, completion: 200 },
        durationMs: 2500,
        success: true,
      },
    ],
    error: undefined,
    ...overrides,
  };
}

function makeDelegationResult(overrides: Record<string, unknown> = {}) {
  return {
    subagentId: 'sub-1',
    agentName: 'Code Assistant',
    running: false,
    result: 'Task completed successfully',
    toolsUsed: ['read_file', 'write_file'],
    durationMs: 1500,
    error: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

describe('ORCHESTRA_TOOL_DEFINITIONS', () => {
  it('exports 4 tool definitions', () => {
    expect(ORCHESTRA_TOOL_DEFINITIONS).toHaveLength(4);
  });

  it('all tools have category Orchestra', () => {
    for (const tool of ORCHESTRA_TOOL_DEFINITIONS) {
      expect(tool.category).toBe('Orchestra');
    }
  });

  it('all tools are workflow-usable', () => {
    for (const tool of ORCHESTRA_TOOL_DEFINITIONS) {
      expect(tool.workflowUsable).toBe(true);
    }
  });

  it('exports expected tool names', () => {
    expect(ORCHESTRA_TOOL_NAMES).toContain('delegate_to_agent');
    expect(ORCHESTRA_TOOL_NAMES).toContain('execute_orchestra_plan');
    expect(ORCHESTRA_TOOL_NAMES).toContain('check_orchestra');
    expect(ORCHESTRA_TOOL_NAMES).toContain('list_available_agents');
  });
});

// ---------------------------------------------------------------------------
// executeOrchestraTool
// ---------------------------------------------------------------------------

describe('executeOrchestraTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // delegate_to_agent
  // -------------------------------------------------------------------------

  describe('delegate_to_agent', () => {
    it('delegates successfully and returns result', async () => {
      const delegation = makeDelegationResult();
      mockEngine.delegateToAgent.mockResolvedValue(delegation);

      const result = await executeOrchestraTool(
        'delegate_to_agent',
        { agent_name: 'Code Assistant', task: 'Write a sorting function' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(delegation);
      expect(mockEngine.delegateToAgent).toHaveBeenCalledWith(
        {
          agentName: 'Code Assistant',
          task: 'Write a sorting function',
          context: undefined,
          waitForResult: true,
        },
        'conv-1',
        'user-1'
      );
    });

    it('passes optional context and wait_for_result=false', async () => {
      mockEngine.delegateToAgent.mockResolvedValue(makeDelegationResult({ running: true }));

      await executeOrchestraTool(
        'delegate_to_agent',
        {
          agent_name: 'Research Assistant',
          task: 'Research topic',
          context: 'Extra context',
          wait_for_result: false,
        },
        'user-1',
        'conv-1'
      );

      expect(mockEngine.delegateToAgent).toHaveBeenCalledWith(
        {
          agentName: 'Research Assistant',
          task: 'Research topic',
          context: 'Extra context',
          waitForResult: false,
        },
        'conv-1',
        'user-1'
      );
    });

    it('returns error when agent_name is missing', async () => {
      const result = await executeOrchestraTool(
        'delegate_to_agent',
        { task: 'Do something' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('agent_name and task are required');
    });

    it('returns error when task is missing', async () => {
      const result = await executeOrchestraTool(
        'delegate_to_agent',
        { agent_name: 'Code Assistant' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('agent_name and task are required');
    });

    it('reflects engine error in result when delegation has error field', async () => {
      mockEngine.delegateToAgent.mockResolvedValue(
        makeDelegationResult({ error: 'Agent not found', running: false })
      );

      const result = await executeOrchestraTool(
        'delegate_to_agent',
        { agent_name: 'Ghost Agent', task: 'Do work' },
        'user-1',
        'conv-1'
      );

      // success is false when result.error is truthy
      expect(result.success).toBe(false);
    });

    it('returns success:false when engine throws', async () => {
      mockEngine.delegateToAgent.mockRejectedValue(new Error('Engine unavailable'));

      const result = await executeOrchestraTool(
        'delegate_to_agent',
        { agent_name: 'Code Assistant', task: 'Fix bug' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Engine unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // execute_orchestra_plan
  // -------------------------------------------------------------------------

  describe('execute_orchestra_plan', () => {
    const minimalTasks = [
      { id: 'task-1', agentName: 'Research Assistant', input: 'Research pricing' },
    ];

    it('executes a sequential plan successfully', async () => {
      const execution = makeExecution({ state: 'completed', strategy: 'sequential' });
      mockEngine.executePlan.mockResolvedValue(execution);

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        {
          description: 'Research pricing',
          strategy: 'sequential',
          tasks: minimalTasks,
        },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          executionId: 'exec-1',
          state: 'completed',
        })
      );
      expect(mockEngine.executePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Research pricing',
          strategy: 'sequential',
          tasks: minimalTasks,
        }),
        'conv-1',
        'user-1'
      );
    });

    it('executes a parallel plan successfully', async () => {
      const execution = makeExecution({
        state: 'completed',
        plan: {
          description: 'Parallel work',
          strategy: 'parallel',
          tasks: [
            { id: 't1', agentName: 'Agent A', input: 'Task A' },
            { id: 't2', agentName: 'Agent B', input: 'Task B' },
          ],
        },
        taskResults: [],
      });
      mockEngine.executePlan.mockResolvedValue(execution);

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        {
          description: 'Parallel work',
          strategy: 'parallel',
          tasks: [
            { id: 't1', agentName: 'Agent A', input: 'Task A' },
            { id: 't2', agentName: 'Agent B', input: 'Task B' },
          ],
        },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
    });

    it('executes a valid DAG plan (no cycles)', async () => {
      const execution = makeExecution({ state: 'completed' });
      mockEngine.executePlan.mockResolvedValue(execution);

      const dagTasks = [
        { id: 'research', agentName: 'Research Assistant', input: 'Do research' },
        { id: 'analyze', agentName: 'Data Analyst', input: 'Analyze', dependsOn: ['research'] },
        {
          id: 'write',
          agentName: 'Creative Writer',
          input: 'Write report',
          dependsOn: ['research', 'analyze'],
        },
      ];

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Research and write', strategy: 'dag', tasks: dagTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      expect(mockEngine.executePlan).toHaveBeenCalled();
    });

    it('passes max_duration_ms to engine', async () => {
      const execution = makeExecution({ state: 'completed' });
      mockEngine.executePlan.mockResolvedValue(execution);

      await executeOrchestraTool(
        'execute_orchestra_plan',
        {
          description: 'Timed plan',
          strategy: 'sequential',
          tasks: minimalTasks,
          max_duration_ms: 60000,
        },
        'user-1',
        'conv-1'
      );

      expect(mockEngine.executePlan).toHaveBeenCalledWith(
        expect.objectContaining({ maxDuration: 60000 }),
        'conv-1',
        'user-1'
      );
    });

    it('returns success:false when execution state is not completed', async () => {
      const execution = makeExecution({ state: 'failed', error: 'Task timeout' });
      mockEngine.executePlan.mockResolvedValue(execution);

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Failing plan', strategy: 'sequential', tasks: minimalTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect((result.result as Record<string, unknown>).state).toBe('failed');
    });

    it('returns error when description is missing', async () => {
      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { strategy: 'sequential', tasks: minimalTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('description, strategy, and tasks are required');
    });

    it('returns error when strategy is missing', async () => {
      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'My plan', tasks: minimalTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('description, strategy, and tasks are required');
    });

    it('returns error when tasks is not an array', async () => {
      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'My plan', strategy: 'sequential', tasks: 'not-an-array' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('description, strategy, and tasks are required');
    });

    it('returns error when a task is missing id', async () => {
      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        {
          description: 'Plan',
          strategy: 'sequential',
          tasks: [{ agentName: 'Agent', input: 'Do stuff' }],
        },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('id, agentName, and input');
    });

    it('returns error when a task is missing agentName', async () => {
      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        {
          description: 'Plan',
          strategy: 'sequential',
          tasks: [{ id: 'task-1', input: 'Do stuff' }],
        },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('id, agentName, and input');
    });

    it('detects DAG cycle (A depends on B, B depends on A)', async () => {
      const cyclicTasks = [
        { id: 'A', agentName: 'Agent A', input: 'Task A', dependsOn: ['B'] },
        { id: 'B', agentName: 'Agent B', input: 'Task B', dependsOn: ['A'] },
      ];

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Cyclic plan', strategy: 'dag', tasks: cyclicTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dependency cycle detected');
      expect(mockEngine.executePlan).not.toHaveBeenCalled();
    });

    it('skips external dependency not in task set during cycle check (line 346)', async () => {
      const execution = makeExecution({ state: 'completed' });
      mockEngine.executePlan.mockResolvedValue(execution);

      // Task A depends on 'EXTERNAL' which is not in the task list
      const tasks = [
        { id: 'A', agentName: 'Agent A', input: 'Task A', dependsOn: ['EXTERNAL'] },
        { id: 'B', agentName: 'Agent B', input: 'Task B', dependsOn: ['A'] },
      ];

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Plan with external dep', strategy: 'dag', tasks },
        'user-1',
        'conv-1'
      );

      // No cycle found — external dep is skipped — plan runs
      expect(result.success).toBe(true);
      expect(mockEngine.executePlan).toHaveBeenCalled();
    });

    it('detects three-node DAG cycle (A->B->C->A)', async () => {
      const cyclicTasks = [
        { id: 'A', agentName: 'Agent A', input: 'Task A', dependsOn: ['C'] },
        { id: 'B', agentName: 'Agent B', input: 'Task B', dependsOn: ['A'] },
        { id: 'C', agentName: 'Agent C', input: 'Task C', dependsOn: ['B'] },
      ];

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Three-node cycle', strategy: 'dag', tasks: cyclicTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dependency cycle detected');
    });

    it('does not run cycle check for non-dag strategy', async () => {
      // Even if tasks had cycles, sequential strategy skips the check
      const execution = makeExecution({ state: 'completed' });
      mockEngine.executePlan.mockResolvedValue(execution);

      const cyclicTasks = [
        { id: 'A', agentName: 'Agent A', input: 'Task A', dependsOn: ['B'] },
        { id: 'B', agentName: 'Agent B', input: 'Task B', dependsOn: ['A'] },
      ];

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Sequential plan', strategy: 'sequential', tasks: cyclicTasks },
        'user-1',
        'conv-1'
      );

      // sequential skips cycle check — engine is called
      expect(mockEngine.executePlan).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('returns error when engine throws', async () => {
      mockEngine.executePlan.mockRejectedValue(new Error('DB connection failed'));

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Plan', strategy: 'sequential', tasks: minimalTasks },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection failed');
    });

    it('maps task results correctly in response', async () => {
      const execution = makeExecution({
        state: 'completed',
        taskResults: [
          {
            taskId: 'task-1',
            agentName: 'Research Assistant',
            subagentId: 'sub-1',
            output: 'Found data',
            toolsUsed: ['web_search'],
            tokenUsage: { prompt: 50, completion: 100 },
            durationMs: 1200,
            success: true,
          },
        ],
      });
      mockEngine.executePlan.mockResolvedValue(execution);

      const result = await executeOrchestraTool(
        'execute_orchestra_plan',
        { description: 'Plan', strategy: 'sequential', tasks: minimalTasks },
        'user-1',
        'conv-1'
      );

      const res = result.result as {
        taskResults: Array<Record<string, unknown>>;
        totalDurationMs: number;
      };
      expect(res.taskResults).toHaveLength(1);
      expect(res.taskResults[0]).toEqual(
        expect.objectContaining({
          taskId: 'task-1',
          agentName: 'Research Assistant',
          success: true,
          output: 'Found data',
        })
      );
      expect(res.totalDurationMs).toBe(3000);
    });
  });

  // -------------------------------------------------------------------------
  // check_orchestra
  // -------------------------------------------------------------------------

  describe('check_orchestra', () => {
    it('returns execution status when found', async () => {
      const execution = makeExecution({ state: 'running' });
      mockEngine.getExecution.mockReturnValue(execution);

      const result = await executeOrchestraTool(
        'check_orchestra',
        { execution_id: 'exec-1' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          executionId: 'exec-1',
          state: 'running',
          description: 'Test plan',
          strategy: 'sequential',
        })
      );
      expect(mockEngine.getExecution).toHaveBeenCalledWith('exec-1');
    });

    it('includes completed task results in response', async () => {
      const execution = makeExecution({ state: 'completed' });
      mockEngine.getExecution.mockReturnValue(execution);

      const result = await executeOrchestraTool(
        'check_orchestra',
        { execution_id: 'exec-1' },
        'user-1',
        'conv-1'
      );

      const res = result.result as {
        completedTasks: number;
        totalTasks: number;
        taskResults: unknown[];
      };
      expect(res.completedTasks).toBe(1);
      expect(res.totalTasks).toBe(1);
      expect(res.taskResults).toHaveLength(1);
    });

    it('returns error when execution_id is missing', async () => {
      const result = await executeOrchestraTool('check_orchestra', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('execution_id is required');
    });

    it('returns error when execution not found', async () => {
      mockEngine.getExecution.mockReturnValue(null);

      const result = await executeOrchestraTool(
        'check_orchestra',
        { execution_id: 'exec-unknown' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution not found: exec-unknown');
    });

    it('returns error when engine throws', async () => {
      mockEngine.getExecution.mockImplementation(() => {
        throw new Error('Memory error');
      });

      const result = await executeOrchestraTool(
        'check_orchestra',
        { execution_id: 'exec-1' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Memory error');
    });
  });

  // -------------------------------------------------------------------------
  // list_available_agents
  // -------------------------------------------------------------------------

  describe('list_available_agents', () => {
    it('returns list of available agents', async () => {
      mockAgentsRepo.getAll.mockResolvedValue([
        {
          id: 'agent-1',
          name: 'Code Assistant',
          systemPrompt: 'You are a coding expert.',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          config: { preferredProvider: 'anthropic', preferredModel: 'claude-sonnet-4-5-20250929' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'agent-2',
          name: 'Research Assistant',
          systemPrompt: null,
          provider: 'openai',
          model: 'gpt-4o',
          config: { preferredProvider: 'default', preferredModel: 'gpt-4o' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await executeOrchestraTool('list_available_agents', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(true);
      const res = result.result as { agents: unknown[]; total: number };
      expect(res.total).toBe(2);
      expect(res.agents).toHaveLength(2);
      expect(res.agents[0]).toEqual(
        expect.objectContaining({
          name: 'Code Assistant',
          hasSystemPrompt: true,
          preferredProvider: 'anthropic',
          preferredModel: 'claude-sonnet-4-5-20250929',
        })
      );
    });

    it('returns empty list when no agents configured', async () => {
      mockAgentsRepo.getAll.mockResolvedValue([]);

      const result = await executeOrchestraTool('list_available_agents', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(true);
      const res = result.result as { agents: unknown[]; total: number };
      expect(res.total).toBe(0);
      expect(res.agents).toHaveLength(0);
    });

    it('omits preferredProvider/preferredModel when config value is "default"', async () => {
      mockAgentsRepo.getAll.mockResolvedValue([
        {
          id: 'agent-1',
          name: 'Generic Agent',
          systemPrompt: 'Be helpful.',
          provider: 'openai',
          model: 'gpt-4o',
          config: { preferredProvider: 'default', preferredModel: 'default' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await executeOrchestraTool('list_available_agents', {}, 'user-1', 'conv-1');

      const res = result.result as { agents: Array<Record<string, unknown>> };
      expect(res.agents[0].preferredProvider).toBeUndefined();
      expect(res.agents[0].preferredModel).toBeUndefined();
    });

    it('returns error when repo throws', async () => {
      mockAgentsRepo.getAll.mockRejectedValue(new Error('DB error'));

      const result = await executeOrchestraTool('list_available_agents', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown tool
  // -------------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns error for an unknown tool name', async () => {
      const result = await executeOrchestraTool('unknown_tool', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown orchestra tool: unknown_tool');
    });

    it('includes the tool name in the error message', async () => {
      const result = await executeOrchestraTool('bogus_tool_xyz', {}, 'user-1', 'conv-1');

      expect(result.error).toContain('bogus_tool_xyz');
    });
  });
});
