/**
 * Plan Tools Tests
 *
 * Tests the executePlanTool function and PLAN_TOOLS definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPlanService = {
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  listPlans: vi.fn(async () => []),
  getSteps: vi.fn(async () => []),
  getHistory: vi.fn(async () => []),
  addStep: vi.fn(),
  deletePlan: vi.fn(),
};

vi.mock('../services/plan-service.js', () => ({
  getPlanService: () => mockPlanService,
}));

const mockPlanExecutor = {
  execute: vi.fn(),
  pause: vi.fn(),
};

vi.mock('../plans/executor.js', () => ({
  getPlanExecutor: () => mockPlanExecutor,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = { plan: mockPlanService };
        return services[token.name];
      }),
    })),
  };
});

import { PLAN_TOOLS, executePlanTool } from './plan-tools.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // PLAN_TOOLS definitions
  // ========================================================================

  describe('PLAN_TOOLS', () => {
    it('exports 7 tool definitions', () => {
      expect(PLAN_TOOLS).toHaveLength(7);
    });

    it('all tools have required fields', () => {
      for (const tool of PLAN_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.category).toBe('Automation');
      }
    });

    it('contains expected tool names', () => {
      const names = PLAN_TOOLS.map((t) => t.name);
      expect(names).toContain('create_plan');
      expect(names).toContain('add_plan_step');
      expect(names).toContain('list_plans');
      expect(names).toContain('get_plan_details');
      expect(names).toContain('execute_plan');
      expect(names).toContain('pause_plan');
      expect(names).toContain('delete_plan');
    });
  });

  // ========================================================================
  // create_plan
  // ========================================================================

  describe('create_plan', () => {
    it('creates a plan via service', async () => {
      mockPlanService.createPlan.mockResolvedValue({
        id: 'p1',
        name: 'Test Plan',
        goal: 'Test goal',
        status: 'pending',
      });

      const result = await executePlanTool(
        'create_plan',
        {
          name: 'Test Plan',
          goal: 'Test goal',
          description: 'A test',
          priority: 7,
        },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockPlanService.createPlan).toHaveBeenCalledWith('user-1', {
        name: 'Test Plan',
        goal: 'Test goal',
        description: 'A test',
        priority: 7,
      });
      expect((result.result as Record<string, unknown>).message).toContain('created');
    });
  });

  // ========================================================================
  // add_plan_step
  // ========================================================================

  describe('add_plan_step', () => {
    it('adds a tool_call step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's1',
        name: 'Fetch data',
        type: 'tool_call',
        orderNum: 1,
      });

      const result = await executePlanTool(
        'add_plan_step',
        {
          plan_id: 'p1',
          order: 1,
          type: 'tool_call',
          name: 'Fetch data',
          tool_name: 'search_memories',
          tool_args: { query: 'test' },
        },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'user-1',
        'p1',
        expect.objectContaining({
          type: 'tool_call',
          name: 'Fetch data',
          config: { toolName: 'search_memories', toolArgs: { query: 'test' } },
        })
      );
    });

    it('adds an llm_decision step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's2',
        name: 'Analyze',
        type: 'llm_decision',
        orderNum: 2,
      });

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 2,
        type: 'llm_decision',
        name: 'Analyze',
        prompt: 'What should we do?',
        choices: ['option A', 'option B'],
      });

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: { prompt: 'What should we do?', choices: ['option A', 'option B'] },
        })
      );
    });

    it('adds a user_input step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's3',
        name: 'Ask user',
        type: 'user_input',
        orderNum: 3,
      });

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 3,
        type: 'user_input',
        name: 'Ask user',
        question: 'Which format?',
      });

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: { question: 'Which format?', inputType: 'text' },
        })
      );
    });

    it('adds a condition step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's4',
        name: 'Branch',
        type: 'condition',
        orderNum: 4,
      });

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 4,
        type: 'condition',
        name: 'Branch',
        condition: 'result:s1',
        true_step: 's2',
        false_step: 's3',
      });

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: {
            condition: 'result:s1',
            trueStep: 's2',
            falseStep: 's3',
          },
        })
      );
    });

    it('adds a parallel step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's5',
        name: 'Parallel fetch',
        type: 'parallel',
        orderNum: 5,
      });

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 5,
        type: 'parallel',
        name: 'Parallel fetch',
        parallel_steps: [
          { tool_name: 'search_memories', tool_args: { query: 'a' } },
          { tool_name: 'list_goals', tool_args: {} },
        ],
      });

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: {
            steps: [
              { toolName: 'search_memories', toolArgs: { query: 'a' } },
              { toolName: 'list_goals', toolArgs: {} },
            ],
          },
        })
      );
    });

    it('adds a loop step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's6',
        name: 'Poll sensor',
        type: 'loop',
        orderNum: 6,
      });

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 6,
        type: 'loop',
        name: 'Poll sensor',
        tool_name: 'read_sensor',
        tool_args: { device_id: 'dev-1', sensor_id: 'temp-1' },
        max_iterations: 5,
      });

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: {
            toolName: 'read_sensor',
            toolArgs: { device_id: 'dev-1', sensor_id: 'temp-1' },
            maxIterations: 5,
          },
        })
      );
    });

    it('adds a sub_plan step', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's7',
        name: 'Run sub-plan',
        type: 'sub_plan',
        orderNum: 7,
      });

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 7,
        type: 'sub_plan',
        name: 'Run sub-plan',
        sub_plan_id: 'p99',
      });

      expect(result.success).toBe(true);
      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: { subPlanId: 'p99' },
        })
      );
    });

    it('parallel_steps default to empty array when omitted', async () => {
      mockPlanService.addStep.mockResolvedValue({
        id: 's8',
        name: 'Empty parallel',
        type: 'parallel',
        orderNum: 8,
      });

      await executePlanTool('add_plan_step', {
        plan_id: 'p1',
        order: 8,
        type: 'parallel',
        name: 'Empty parallel',
        // parallel_steps omitted
      });

      expect(mockPlanService.addStep).toHaveBeenCalledWith(
        'default',
        'p1',
        expect.objectContaining({
          config: { steps: [] },
        })
      );
    });

    it('handles service errors', async () => {
      mockPlanService.addStep.mockRejectedValue(new Error('Plan not found: p999'));

      const result = await executePlanTool('add_plan_step', {
        plan_id: 'p999',
        order: 1,
        type: 'tool_call',
        name: 'Step',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Plan not found');
    });
  });

  // ========================================================================
  // list_plans
  // ========================================================================

  describe('list_plans', () => {
    it('returns formatted plan list', async () => {
      mockPlanService.listPlans.mockResolvedValue([
        {
          id: 'p1',
          name: 'Plan A',
          goal: 'Goal A',
          status: 'completed',
          progress: 100,
          totalSteps: 3,
          currentStep: 3,
          createdAt: new Date('2025-01-01'),
          startedAt: new Date('2025-01-01T10:00:00'),
          completedAt: new Date('2025-01-01T10:05:00'),
          error: null,
        },
      ]);

      const result = await executePlanTool('list_plans', { status: 'completed' }, 'user-1');

      expect(result.success).toBe(true);
      const plans = result.result as Record<string, unknown>[];
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({
        id: 'p1',
        name: 'Plan A',
        status: 'completed',
        progress: 100,
      });
    });
  });

  // ========================================================================
  // get_plan_details
  // ========================================================================

  describe('get_plan_details', () => {
    it('returns plan with steps and history', async () => {
      mockPlanService.getPlan.mockResolvedValue({
        id: 'p1',
        name: 'Plan A',
        goal: 'Goal A',
        description: 'Desc',
        status: 'running',
        progress: 50,
        totalSteps: 2,
        currentStep: 1,
      });
      mockPlanService.getSteps.mockResolvedValue([
        {
          id: 's1',
          orderNum: 1,
          type: 'tool_call',
          name: 'Step 1',
          status: 'completed',
          result: 'ok',
          error: null,
          durationMs: 100,
        },
        {
          id: 's2',
          orderNum: 2,
          type: 'tool_call',
          name: 'Step 2',
          status: 'running',
          result: null,
          error: null,
          durationMs: null,
        },
      ]);
      mockPlanService.getHistory.mockResolvedValue([
        { eventType: 'started', stepId: null, createdAt: new Date('2025-01-01') },
      ]);

      const result = await executePlanTool('get_plan_details', { plan_id: 'p1' }, 'user-1');

      expect(result.success).toBe(true);
      const details = result.result as Record<string, unknown[]>;
      expect(details.steps).toHaveLength(2);
      expect(details.recentHistory).toHaveLength(1);
    });

    it('returns error when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const result = await executePlanTool('get_plan_details', { plan_id: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ========================================================================
  // execute_plan
  // ========================================================================

  describe('execute_plan', () => {
    it('starts plan execution', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', name: 'Plan A', status: 'pending' });
      mockPlanService.getSteps.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      mockPlanExecutor.execute.mockReturnValue(Promise.resolve());

      const result = await executePlanTool('execute_plan', { plan_id: 'p1' }, 'user-1');

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).totalSteps).toBe(2);
    });

    it('rejects non-pending plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'running' });

      const result = await executePlanTool('execute_plan', { plan_id: 'p1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be "pending"');
    });

    it('rejects plan with no steps', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', status: 'pending' });
      mockPlanService.getSteps.mockResolvedValue([]);

      const result = await executePlanTool('execute_plan', { plan_id: 'p1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no steps');
    });

    it('returns error when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const result = await executePlanTool('execute_plan', { plan_id: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when executor.execute throws synchronously (line 453)', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', name: 'Plan A', status: 'pending' });
      mockPlanService.getSteps.mockResolvedValue([{ id: 's1' }]);
      mockPlanExecutor.execute.mockImplementation(() => {
        throw new Error('Sync executor failure');
      });

      const result = await executePlanTool('execute_plan', { plan_id: 'p1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sync executor failure');
    });
  });

  // ========================================================================
  // pause_plan
  // ========================================================================

  describe('pause_plan', () => {
    it('pauses a plan', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', name: 'Plan A' });
      mockPlanExecutor.pause.mockResolvedValue(undefined);

      const result = await executePlanTool('pause_plan', { plan_id: 'p1' });

      expect(result.success).toBe(true);
      expect(mockPlanExecutor.pause).toHaveBeenCalledWith('p1');
    });

    it('returns error when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const result = await executePlanTool('pause_plan', { plan_id: 'nonexistent' });

      expect(result.success).toBe(false);
    });

    it('returns error when executor.pause throws (line 472)', async () => {
      mockPlanService.getPlan.mockResolvedValue({ id: 'p1', name: 'Plan A' });
      mockPlanExecutor.pause.mockRejectedValue(new Error('Pause engine failure'));

      const result = await executePlanTool('pause_plan', { plan_id: 'p1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pause engine failure');
    });
  });

  // ========================================================================
  // delete_plan
  // ========================================================================

  describe('delete_plan', () => {
    it('deletes a plan', async () => {
      mockPlanService.deletePlan.mockResolvedValue(true);

      const result = await executePlanTool('delete_plan', { plan_id: 'p1' });

      expect(result.success).toBe(true);
    });

    it('returns error when plan not found', async () => {
      mockPlanService.deletePlan.mockResolvedValue(false);

      const result = await executePlanTool('delete_plan', { plan_id: 'nonexistent' });

      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // Unknown tool
  // ========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executePlanTool('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown plan tool');
    });
  });
});

describe('workflowUsable flag', () => {
  it('all plan tools are marked workflowUsable: false', () => {
    for (const def of PLAN_TOOLS) {
      expect(def.workflowUsable, `${def.name} should have workflowUsable: false`).toBe(false);
    }
  });
});
