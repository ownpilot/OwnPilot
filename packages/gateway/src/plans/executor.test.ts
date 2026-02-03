/**
 * Plan Executor Tests
 *
 * Tests the PlanExecutor class covering:
 * - Plan execution lifecycle (execute, pause, resume, abort)
 * - Checkpointing
 * - Step handler registration
 * - Default step handlers (tool_call, user_input, condition)
 * - Error handling and retries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plan, PlanStep } from '../db/repositories/plans.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPlanService = {
  getPlan: vi.fn(),
  updatePlan: vi.fn(async () => ({})),
  getSteps: vi.fn(async () => []),
  getNextStep: vi.fn(async () => null),
  getStepsByStatus: vi.fn(async () => []),
  updateStep: vi.fn(async () => ({})),
  logEvent: vi.fn(async () => {}),
  recalculateProgress: vi.fn(async () => {}),
  areDependenciesMet: vi.fn(async () => true),
};

vi.mock('../services/plan-service.js', () => ({
  getPlanService: () => mockPlanService,
}));

vi.mock('../services/tool-executor.js', () => ({
  executeTool: vi.fn(async () => ({ success: true, result: 'tool output' })),
  hasTool: vi.fn(async () => true),
}));

// Mock the dynamic imports used by llm_decision handler
vi.mock('../routes/agents.js', () => ({
  getOrCreateChatAgent: vi.fn(),
}));
vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4o-mini' })),
}));

import { PlanExecutor } from './executor.js';
import { executeTool, hasTool } from '../services/tool-executor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    userId: 'default',
    name: 'Test Plan',
    goal: 'Test goal',
    description: null,
    status: 'pending',
    progress: 0,
    totalSteps: 2,
    currentStep: 0,
    priority: 5,
    error: null,
    startedAt: null,
    completedAt: null,
    checkpoint: null,
    goalId: null,
    triggerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Plan;
}

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step-1',
    planId: 'plan-1',
    orderNum: 1,
    type: 'tool_call',
    name: 'Test Step',
    description: null,
    config: { toolName: 'test_tool', toolArgs: {} },
    status: 'pending',
    result: null,
    error: null,
    durationMs: null,
    retryCount: 0,
    maxRetries: 3,
    dependencies: [],
    timeoutMs: null,
    onFailure: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PlanStep;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanExecutor', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    executor = new PlanExecutor({ userId: 'user-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('execute', () => {
    it('throws when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      await expect(executor.execute('nonexistent')).rejects.toThrow('Plan not found');
    });

    it('throws when plan already running', async () => {
      const plan = makePlan();
      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([]);

      // Make getNextStep hang so the plan stays in the running state
      let resolveNextStep!: (value: null) => void;
      mockPlanService.getNextStep.mockReturnValue(
        new Promise<null>((resolve) => { resolveNextStep = resolve; })
      );
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      // Start execution — it will block inside executeSteps waiting for getNextStep
      const promise1 = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(0); // let the setTimeout(0) yield pass

      // Now the plan is running
      expect(executor.isRunning('plan-1')).toBe(true);
      await expect(executor.execute('plan-1')).rejects.toThrow('Plan already running');

      // Clean up: unblock the first execution so it finishes
      resolveNextStep(null);
      await vi.advanceTimersByTimeAsync(10);
      await promise1;
    });

    it('completes when no steps remain', async () => {
      const plan = makePlan();
      // After executeSteps sets status to 'completed', getPlan should reflect that
      let planStatus = 'pending';
      mockPlanService.getPlan.mockImplementation(async () => ({ ...plan, status: planStatus }));
      mockPlanService.updatePlan.mockImplementation(async (_uid: string, _id: string, input: Record<string, unknown>) => {
        if (input.status) planStatus = input.status;
        return {};
      });
      mockPlanService.getSteps.mockResolvedValue([]);
      mockPlanService.getNextStep.mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(10);
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(mockPlanService.updatePlan).toHaveBeenCalledWith('user-1', 'plan-1', { status: 'running' });
    });

    it('executes a tool_call step successfully', async () => {
      const plan = makePlan();
      const step = makeStep({
        config: { toolName: 'my_tool', toolArgs: { key: 'val' } },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: { output: 'done' },
      });

      // First call returns step, second returns null (plan complete)
      let stepCallCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        stepCallCount++;
        return stepCallCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      // Advance timers to allow the while loop iterations
      await vi.advanceTimersByTimeAsync(100);
      const _result = await resultPromise;

      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-1', { status: 'running' });
      expect(executeTool).toHaveBeenCalledWith('my_tool', { key: 'val' }, 'user-1');
    });

    it('handles step execution failure', async () => {
      const plan = makePlan();
      const step = makeStep({
        retryCount: 3,
        maxRetries: 3,
        onFailure: 'abort',
        config: { toolName: 'fail_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      mockPlanService.getNextStep.mockResolvedValueOnce(step).mockResolvedValue(null);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Tool crashed',
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });
  });

  // ========================================================================
  // Pause / Resume / Abort
  // ========================================================================

  describe('pause', () => {
    it('returns false when plan is not running', async () => {
      const result = await executor.pause('plan-1');
      expect(result).toBe(false);
    });
  });

  describe('resume', () => {
    it('throws when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);
      await expect(executor.resume('nonexistent')).rejects.toThrow('Plan not found');
    });

    it('throws when plan is not paused', async () => {
      mockPlanService.getPlan.mockResolvedValue(makePlan({ status: 'running' }));
      await expect(executor.resume('plan-1')).rejects.toThrow('Plan is not paused');
    });
  });

  describe('abort', () => {
    it('returns false when plan is not running', async () => {
      const result = await executor.abort('plan-1');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // Checkpoint
  // ========================================================================

  describe('checkpoint', () => {
    it('saves checkpoint data to plan', async () => {
      await executor.checkpoint('plan-1', { step: 3, state: 'partial' });

      expect(mockPlanService.updatePlan).toHaveBeenCalledWith(
        'user-1',
        'plan-1',
        { checkpoint: expect.stringContaining('"step":3') }
      );
      expect(mockPlanService.logEvent).toHaveBeenCalledWith(
        'user-1',
        'plan-1',
        'checkpoint',
        undefined,
        expect.objectContaining({ data: { step: 3, state: 'partial' } })
      );
    });
  });

  describe('restoreFromCheckpoint', () => {
    it('returns parsed checkpoint data', async () => {
      mockPlanService.getPlan.mockResolvedValue(
        makePlan({ checkpoint: JSON.stringify({ timestamp: '2025-01-01', data: { x: 1 } }) })
      );

      const data = await executor.restoreFromCheckpoint('plan-1');

      expect(data).toEqual({ timestamp: '2025-01-01', data: { x: 1 } });
    });

    it('returns null when plan has no checkpoint', async () => {
      mockPlanService.getPlan.mockResolvedValue(makePlan({ checkpoint: null }));

      const data = await executor.restoreFromCheckpoint('plan-1');

      expect(data).toBeNull();
    });

    it('returns null when plan not found', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);

      const data = await executor.restoreFromCheckpoint('nonexistent');

      expect(data).toBeNull();
    });

    it('returns null when checkpoint JSON is invalid', async () => {
      mockPlanService.getPlan.mockResolvedValue(makePlan({ checkpoint: '{invalid json' }));

      const data = await executor.restoreFromCheckpoint('plan-1');

      expect(data).toBeNull();
    });
  });

  // ========================================================================
  // Utility methods
  // ========================================================================

  describe('utility methods', () => {
    it('isRunning returns false for non-running plan', () => {
      expect(executor.isRunning('plan-1')).toBe(false);
    });

    it('isPaused returns false for non-paused plan', () => {
      expect(executor.isPaused('plan-1')).toBe(false);
    });

    it('getRunningPlans returns empty initially', () => {
      expect(executor.getRunningPlans()).toEqual([]);
    });
  });

  // ========================================================================
  // Custom handler registration
  // ========================================================================

  describe('registerHandler', () => {
    it('registers a custom step handler', async () => {
      const customHandler = vi.fn(async () => ({
        success: true,
        data: { custom: true },
      }));
      executor.registerHandler('custom_type', customHandler);

      const plan = makePlan();
      const step = makeStep({ type: 'custom_type' as PlanStep['type'], config: { myArg: 42 } });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      const _result = await resultPromise;

      expect(customHandler).toHaveBeenCalledWith(
        { myArg: 42 },
        expect.objectContaining({ plan, step })
      );
    });
  });

  // ========================================================================
  // Default step handlers
  // ========================================================================

  describe('tool_call handler', () => {
    it('returns error when no toolName in config', async () => {
      const plan = makePlan();
      const step = makeStep({ config: {} });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      // With retryCount >= maxRetries, the step will fail and abort plan
      step.retryCount = 3;
      step.maxRetries = 3;

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
    });

    it('returns error when tool not found', async () => {
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const plan = makePlan();
      const step = makeStep({
        config: { toolName: 'nonexistent_tool' },
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      mockPlanService.getNextStep.mockResolvedValueOnce(step).mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
    });
  });

  describe('user_input handler', () => {
    it('pauses execution for user input', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'user_input',
        config: { question: 'What color?', inputType: 'text' },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      mockPlanService.getNextStep.mockResolvedValueOnce(step).mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      const _result = await resultPromise;

      // Should have paused the plan
      expect(mockPlanService.updatePlan).toHaveBeenCalledWith(
        'user-1',
        'plan-1',
        expect.objectContaining({ status: 'paused' })
      );
    });
  });

  describe('condition handler', () => {
    it('evaluates true condition', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'condition',
        config: { condition: 'true', trueStep: 'step-3', falseStep: 'step-4' },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      const _result = await resultPromise;

      // Step should have been completed
      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({ status: 'completed' })
      );
    });
  });

  // ========================================================================
  // Events
  // ========================================================================

  describe('events', () => {
    it('emits plan:started event', async () => {
      const listener = vi.fn();
      executor.on('plan:started', listener);

      const plan = makePlan();
      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([]);
      mockPlanService.getNextStep.mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(10);
      await resultPromise;

      expect(listener).toHaveBeenCalledWith(plan);
    });

    it('emits plan:completed event', async () => {
      const listener = vi.fn();
      executor.on('plan:completed', listener);

      const plan = makePlan({ status: 'completed' });
      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([]);
      mockPlanService.getNextStep.mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(10);
      await resultPromise;

      // After execute, getPlan returns the updated plan which has status 'completed'
      expect(listener).toHaveBeenCalled();
    });

    it('emits plan:failed event on error', async () => {
      const listener = vi.fn();
      executor.on('plan:failed', listener);

      const plan = makePlan();
      const step = makeStep({
        retryCount: 3,
        maxRetries: 3,
        config: { toolName: 'bad_tool' },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      mockPlanService.getNextStep.mockResolvedValueOnce(step).mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Tool failed',
      });

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      await resultPromise;

      expect(listener).toHaveBeenCalled();
    });
  });
});
