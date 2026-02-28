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

vi.mock('../services/tool-executor.js', () => ({
  executeTool: vi.fn(async () => ({ success: true, result: 'tool output' })),
  hasTool: vi.fn(async () => true),
}));

vi.mock('../db/repositories/execution-permissions.js', () => ({
  executionPermissionsRepo: {
    get: vi.fn(async () => ({
      enabled: true,
      mode: 'local',
      execute_javascript: 'allowed',
      execute_python: 'allowed',
      execute_shell: 'allowed',
      compile_code: 'allowed',
      package_manager: 'allowed',
    })),
  },
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

    // Reset mock implementations that vi.clearAllMocks() doesn't restore
    mockPlanService.areDependenciesMet.mockResolvedValue(true);
    mockPlanService.updatePlan.mockResolvedValue({});
    mockPlanService.getNextStep.mockResolvedValue(null);
    mockPlanService.getStepsByStatus.mockResolvedValue([]);

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
        new Promise<null>((resolve) => {
          resolveNextStep = resolve;
        })
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
      mockPlanService.updatePlan.mockImplementation(
        async (_uid: string, _id: string, input: Record<string, unknown>) => {
          if (input.status) planStatus = input.status;
          return {};
        }
      );
      mockPlanService.getSteps.mockResolvedValue([]);
      mockPlanService.getNextStep.mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(10);
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(mockPlanService.updatePlan).toHaveBeenCalledWith('user-1', 'plan-1', {
        status: 'running',
      });
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

      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-1', {
        status: 'running',
      });
      expect(executeTool).toHaveBeenCalledWith(
        'my_tool',
        { key: 'val' },
        'user-1',
        expect.any(Object),
        expect.objectContaining({ source: 'plan' })
      );
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

      expect(mockPlanService.updatePlan).toHaveBeenCalledWith('user-1', 'plan-1', {
        checkpoint: expect.stringContaining('"step":3'),
      });
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

    it('emits step:started event', async () => {
      const listener = vi.fn();
      executor.on('step:started', listener);

      const plan = makePlan();
      const step = makeStep({
        config: { toolName: 'test_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: 'ok',
      });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      await resultPromise;

      expect(listener).toHaveBeenCalledWith(plan, step);
    });
  });

  // ========================================================================
  // Retry logic with backoff
  // ========================================================================

  describe('retry with backoff', () => {
    it('retries a failed step and resets to pending', async () => {
      const plan = makePlan();
      const step = makeStep({
        retryCount: 0,
        maxRetries: 2,
        onFailure: 'abort',
        config: { toolName: 'flaky_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: false, error: 'Transient failure' })
        .mockResolvedValueOnce({ success: true, result: 'recovered' });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        // First call: return the step (fails, retries)
        // Second call: return the step again (succeeds)
        // Third call: null (done)
        return callCount <= 2 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      // Need enough time for backoff (1000ms * 2^0 = 1000ms)
      await vi.advanceTimersByTimeAsync(5000);
      const _result = await resultPromise;

      // Step should have been set back to pending with retryCount: 1
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-1', {
        status: 'pending',
        retryCount: 1,
        error: 'Transient failure',
      });
    });
  });

  // ========================================================================
  // Step failure with onFailure: 'skip'
  // ========================================================================

  describe('step failure with skip', () => {
    it('continues to next step when onFailure is skip', async () => {
      const plan = makePlan();
      const step1 = makeStep({
        id: 'step-1',
        retryCount: 3,
        maxRetries: 3,
        onFailure: 'skip',
        config: { toolName: 'skip_tool', toolArgs: {} },
      });
      const step2 = makeStep({
        id: 'step-2',
        orderNum: 2,
        config: { toolName: 'next_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step1, step2]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: false, error: 'Skippable error' })
        .mockResolvedValueOnce({ success: true, result: 'ok' });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return step1;
        if (callCount === 2) return step2;
        return null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step2]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      // Step 1 should be marked as failed
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-1', {
        status: 'failed',
        error: 'Skippable error',
      });
      // Step 2 should have been started
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-2', {
        status: 'running',
      });
    });
  });

  // ========================================================================
  // Step failure with onFailure referencing another step
  // ========================================================================

  describe('step failure with jump-to-step', () => {
    it('looks up the failure step by ID', async () => {
      const plan = makePlan();
      const step1 = makeStep({
        id: 'step-1',
        retryCount: 3,
        maxRetries: 3,
        onFailure: 'step-3', // Jump to step-3
        config: { toolName: 'jump_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps
        .mockResolvedValueOnce([step1]) // initial getSteps
        .mockResolvedValue([step1, { id: 'step-3', status: 'pending' }]); // failure step lookup
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Step failed',
      });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step1 : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      // Step should be marked failed
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-1', {
        status: 'failed',
        error: 'Step failed',
      });
    });
  });

  // ========================================================================
  // Dependency deadlock detection
  // ========================================================================

  describe('dependency deadlock', () => {
    it('detects deadlock after max stall count', async () => {
      const plan = makePlan();
      const step = makeStep({
        id: 'step-1',
        config: { toolName: 'test_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      // Dependencies are never met
      mockPlanService.areDependenciesMet.mockResolvedValue(false);
      // getNextStep returns the step each time, but deps always unmet
      mockPlanService.getNextStep.mockResolvedValue(step);
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      // Need to advance past PLAN_STALL_RETRY_MS * PLAN_MAX_STALL
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Dependency deadlock');
      // Blocked steps should be marked
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-1', {
        status: 'blocked',
      });
    });
  });

  // ========================================================================
  // Pause during execution
  // ========================================================================

  describe('pause during execution', () => {
    it('pauses a running plan and emits event', async () => {
      const plan = makePlan();
      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([]);

      // Make getNextStep hang so we can pause while running
      let resolveNextStep!: (value: null) => void;
      mockPlanService.getNextStep.mockReturnValue(
        new Promise<null>((resolve) => {
          resolveNextStep = resolve;
        })
      );
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const pauseListener = vi.fn();
      executor.on('plan:paused', pauseListener);

      const promise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(0);

      // Now pause
      const paused = await executor.pause('plan-1');
      expect(paused).toBe(true);
      expect(executor.isPaused('plan-1')).toBe(true);

      // Release the getNextStep promise
      resolveNextStep(null);
      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(pauseListener).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Abort during execution
  // ========================================================================

  describe('abort during execution', () => {
    it('aborts a running plan', async () => {
      const plan = makePlan();

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([]);

      // Block on getNextStep with a deferred promise
      let resolveNextStep!: (value: null) => void;
      mockPlanService.getNextStep.mockReturnValue(
        new Promise<null>((resolve) => {
          resolveNextStep = resolve;
        })
      );
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const promise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(0);

      const aborted = await executor.abort('plan-1');
      expect(aborted).toBe(true);

      expect(mockPlanService.updatePlan).toHaveBeenCalledWith('user-1', 'plan-1', {
        status: 'cancelled',
      });

      // Release getNextStep — returns null so executeSteps completes
      // Note: abort signal is only checked at the top of the loop,
      // so when getNextStep returns null, the plan completes normally
      resolveNextStep(null);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      // After abort, updatePlan was called with 'cancelled'
      // but executeSteps completed (step=null → completed path)
      expect(result.planId).toBe('plan-1');
    });
  });

  // ========================================================================
  // Resume after pause
  // ========================================================================

  describe('resume', () => {
    it('resumes a paused plan', async () => {
      const plan = makePlan({ status: 'paused' });
      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([]);
      mockPlanService.getNextStep.mockResolvedValue(null);
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resumeListener = vi.fn();
      executor.on('plan:resumed', resumeListener);

      const resultPromise = executor.resume('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(resumeListener).toHaveBeenCalledWith(plan);
      expect(mockPlanService.updatePlan).toHaveBeenCalledWith('user-1', 'plan-1', {
        status: 'running',
      });
      expect(result.planId).toBe('plan-1');
    });
  });

  // ========================================================================
  // Condition handler edge cases
  // ========================================================================

  describe('condition handler edge cases', () => {
    it('evaluates false condition', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'condition',
        config: { condition: 'false', trueStep: 'step-3', falseStep: 'step-4' },
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

      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({
          status: 'completed',
          result: { condition: 'false', result: false },
        })
      );
    });

    it('evaluates result: condition referencing previous step', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'condition',
        config: { condition: 'result:step-0', trueStep: 'step-3' },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([
        makeStep({ id: 'step-0', status: 'completed', result: { data: 'yes' } }),
        step,
      ]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(100);
      const _result = await resultPromise;

      // step-0's result is loaded from the initial steps scan
      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('returns error when condition config is missing', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'condition',
        config: {},
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

  // ========================================================================
  // Parallel handler
  // ========================================================================

  describe('parallel handler', () => {
    it('executes multiple tools in parallel', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'parallel',
        config: {
          steps: [
            { toolName: 'tool_a', toolArgs: { key: 'a' } },
            { toolName: 'tool_b', toolArgs: { key: 'b' } },
          ],
        },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true, result: 'result-a' })
        .mockResolvedValueOnce({ success: true, result: 'result-b' });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('returns empty results for no steps', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'parallel',
        config: { steps: [] },
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

      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('reports failure when some parallel steps fail', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'parallel',
        config: {
          steps: [{ toolName: 'tool_ok' }, { toolName: 'tool_fail' }],
        },
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      (executeTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true, result: 'ok' })
        .mockResolvedValueOnce({ success: false, error: 'Parallel fail' });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      // Should fail because not all succeeded
      expect(result.status).toBe('failed');
    });

    it('handles string-only step entries', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'parallel',
        config: {
          steps: ['tool_string'],
        },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: 'string-ok',
      });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      expect(executeTool).toHaveBeenCalledWith('tool_string', {}, 'user-1');
    });

    it('returns not-found error for missing parallel tools', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'parallel',
        config: {
          steps: [{ toolName: 'missing_tool' }],
        },
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
    });
  });

  // ========================================================================
  // Loop handler
  // ========================================================================

  describe('loop handler', () => {
    it('executes tool in a loop until max iterations', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'loop',
        config: { toolName: 'loop_tool', toolArgs: { x: 1 }, maxIterations: 3 },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: 'iter-ok',
      });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      // Tool called 3 times (maxIterations)
      expect(executeTool).toHaveBeenCalledTimes(3);
      // Each call should include iteration number
      expect(executeTool).toHaveBeenCalledWith('loop_tool', { x: 1, iteration: 0 }, 'user-1');
      expect(executeTool).toHaveBeenCalledWith('loop_tool', { x: 1, iteration: 1 }, 'user-1');
      expect(executeTool).toHaveBeenCalledWith('loop_tool', { x: 1, iteration: 2 }, 'user-1');
    });

    it('stops loop on tool failure', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'loop',
        config: { toolName: 'flaky_loop', toolArgs: {}, maxIterations: 5 },
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true, result: 'ok' })
        .mockResolvedValueOnce({ success: false, error: 'Loop iteration failed' });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      // Should fail after 2nd iteration
      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('failed');
    });

    it('returns error for unknown loop tool', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'loop',
        config: { toolName: 'missing_tool', maxIterations: 3 },
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
    });
  });

  // ========================================================================
  // Sub-plan handler
  // ========================================================================

  describe('sub_plan handler', () => {
    it('returns error when no sub-plan ID specified', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'sub_plan',
        config: {},
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
    });
  });

  // ========================================================================
  // Step branching (nextStep)
  // ========================================================================

  describe('step branching', () => {
    it('marks intermediate steps as skipped when branching', async () => {
      const plan = makePlan();
      const step1 = makeStep({
        id: 'step-1',
        orderNum: 1,
        type: 'condition',
        config: { condition: 'true', trueStep: 'step-4' },
      });
      const step2 = makeStep({ id: 'step-2', orderNum: 2, status: 'pending' });
      const step3 = makeStep({ id: 'step-3', orderNum: 3, status: 'pending' });
      const step4 = makeStep({ id: 'step-4', orderNum: 4, status: 'pending' });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step1, step2, step3, step4]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step1 : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const skipListener = vi.fn();
      executor.on('step:skipped', skipListener);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      // Steps 2 and 3 should be skipped
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-2', {
        status: 'skipped',
      });
      expect(mockPlanService.updateStep).toHaveBeenCalledWith('user-1', 'step-3', {
        status: 'skipped',
      });
      expect(skipListener).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // Step approval required
  // ========================================================================

  describe('approval required', () => {
    it('pauses plan and emits approval:required when step requires it', async () => {
      const approvalListener = vi.fn();
      executor.on('approval:required', approvalListener);

      // Register a handler that returns requiresApproval
      executor.registerHandler('approval_step', async () => ({
        success: true,
        data: { needsReview: true },
        requiresApproval: true,
      }));

      const plan = makePlan();
      const step = makeStep({
        type: 'approval_step' as PlanStep['type'],
        config: {},
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
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      expect(mockPlanService.updatePlan).toHaveBeenCalledWith('user-1', 'plan-1', {
        status: 'paused',
      });
      expect(approvalListener).toHaveBeenCalledWith(plan, step, { needsReview: true });
    });
  });

  // ========================================================================
  // LLM decision handler
  // ========================================================================

  describe('llm_decision handler', () => {
    it('calls agent with prompt and returns decision', async () => {
      // Use real timers — dynamic imports + chained promises don't flush with fake timers
      vi.useRealTimers();

      const { getOrCreateChatAgent } = await import('../routes/agents.js');
      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: true,
          value: { content: 'Go with option A', toolCalls: [] },
        })),
      };
      (getOrCreateChatAgent as ReturnType<typeof vi.fn>).mockResolvedValue(mockAgent);

      const plan = makePlan();
      const step = makeStep({
        type: 'llm_decision',
        config: {
          prompt: 'What should we do?',
          choices: ['option A', 'option B'],
        },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      // Create a fresh executor with real timers
      const realExecutor = new PlanExecutor({ userId: 'user-1' });
      const result = await realExecutor.execute('plan-1');

      expect(mockAgent.chat).toHaveBeenCalled();
      const chatArg = mockAgent.chat.mock.calls[0][0] as string;
      expect(chatArg).toContain('What should we do?');
      expect(chatArg).toContain('option A');
      expect(chatArg).toContain('option B');

      // Restore fake timers for subsequent tests
      vi.useFakeTimers();
    });

    it('returns error when no prompt specified', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'llm_decision',
        config: {},
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

    it('returns error when agent result is not ok', async () => {
      const { getOrCreateChatAgent } = await import('../routes/agents.js');
      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: false,
          error: { message: 'API error' },
        })),
      };
      (getOrCreateChatAgent as ReturnType<typeof vi.fn>).mockResolvedValue(mockAgent);

      const plan = makePlan();
      const step = makeStep({
        type: 'llm_decision',
        config: { prompt: 'Decide now' },
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

  // ========================================================================
  // No handler for step type
  // ========================================================================

  describe('unknown step type', () => {
    it('fails when no handler registered for step type', async () => {
      const plan = makePlan();
      const step = makeStep({
        type: 'nonexistent_type' as PlanStep['type'],
        config: {},
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
      expect(result.error).toContain('No handler for step type');
    });
  });

  // ========================================================================
  // Plan deleted during execution
  // ========================================================================

  describe('plan deleted during execution', () => {
    it('throws when plan is deleted during step execution', async () => {
      const plan = makePlan();
      const step = makeStep({ config: { toolName: 'test_tool', toolArgs: {} } });

      // First call returns plan, step execution's getPlan returns null
      let getPlanCount = 0;
      mockPlanService.getPlan.mockImplementation(async () => {
        getPlanCount++;
        return getPlanCount <= 1 ? plan : null;
      });
      mockPlanService.getSteps.mockResolvedValue([step]);

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toContain('deleted during execution');
    });
  });

  // ========================================================================
  // Verbose logging
  // ========================================================================

  describe('verbose mode', () => {
    it('does not throw when verbose is enabled', async () => {
      const verboseExecutor = new PlanExecutor({ userId: 'user-1', verbose: true });
      const plan = makePlan();
      const step = makeStep({ config: { toolName: 'test_tool', toolArgs: {} } });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: 'done',
      });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([step]);

      const resultPromise = verboseExecutor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      // Should complete without errors
      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({ status: 'completed' })
      );
    });
  });

  // ========================================================================
  // Singleton getPlanExecutor
  // ========================================================================

  describe('getPlanExecutor', () => {
    it('returns a PlanExecutor instance', async () => {
      const { getPlanExecutor } = await import('./executor.js');
      const exec1 = getPlanExecutor();
      expect(exec1).toBeInstanceOf(PlanExecutor);
    });

    it('returns new instance when config is provided', async () => {
      const { getPlanExecutor } = await import('./executor.js');
      const exec1 = getPlanExecutor({ userId: 'user-a' });
      const exec2 = getPlanExecutor({ userId: 'user-b' });
      // When config is provided, a new instance is created
      expect(exec2).toBeInstanceOf(PlanExecutor);
    });
  });

  // ========================================================================
  // Step timeout
  // ========================================================================

  describe('step timeout', () => {
    it('fails when step exceeds timeout', async () => {
      const plan = makePlan();
      const step = makeStep({
        config: { toolName: 'slow_tool', toolArgs: {} },
        timeoutMs: 100, // very short timeout
        retryCount: 3,
        maxRetries: 3,
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([step]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      // Make executeTool hang
      (executeTool as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise(() => {}) // never resolves
      );

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? step : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([]);

      const resultPromise = executor.execute('plan-1');
      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toContain('timed out');
    });
  });

  // ========================================================================
  // Resuming previous results
  // ========================================================================

  describe('resume with previous results', () => {
    it('loads completed step results before executing', async () => {
      const plan = makePlan();
      const completedStep = makeStep({
        id: 'step-0',
        status: 'completed',
        result: { loaded: true },
      });
      const pendingStep = makeStep({
        id: 'step-1',
        orderNum: 2,
        config: { toolName: 'next_tool', toolArgs: {} },
      });

      mockPlanService.getPlan.mockResolvedValue(plan);
      mockPlanService.getSteps.mockResolvedValue([completedStep, pendingStep]);
      (hasTool as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: 'done',
      });

      let callCount = 0;
      mockPlanService.getNextStep.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? pendingStep : null;
      });
      mockPlanService.getStepsByStatus.mockResolvedValue([pendingStep]);

      const resultPromise = executor.execute('plan-1');
      await vi.advanceTimersByTimeAsync(200);
      const _result = await resultPromise;

      // Step-0's result should have been pre-loaded into results map
      expect(mockPlanService.updateStep).toHaveBeenCalledWith(
        'user-1',
        'step-1',
        expect.objectContaining({ status: 'running' })
      );
    });
  });
});
