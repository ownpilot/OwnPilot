/**
 * Plan Executor
 *
 * Executes multi-step plans autonomously with support for
 * pause/resume, checkpointing, and failure recovery.
 */

import { EventEmitter } from 'events';
import {
  PlansRepository,
  type Plan,
  type PlanStep,
  type PlanStatus,
  type StepStatus,
  type StepConfig,
} from '../db/repositories/plans.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutorConfig {
  userId?: string;
  /** Maximum concurrent step executions */
  maxConcurrent?: number;
  /** Default step timeout in ms */
  defaultTimeout?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Autonomy level (0-4) */
  autonomyLevel?: number;
}

export interface StepExecutionContext {
  plan: Plan;
  step: PlanStep;
  previousResults: Map<string, unknown>;
  abortSignal?: AbortSignal;
}

export type StepHandler = (
  config: StepConfig,
  context: StepExecutionContext
) => Promise<StepResult>;

export interface StepResult {
  success: boolean;
  data?: unknown;
  error?: string;
  nextStep?: string;
  shouldPause?: boolean;
  requiresApproval?: boolean;
}

export interface ExecutionResult {
  planId: string;
  status: PlanStatus;
  completedSteps: number;
  totalSteps: number;
  duration: number;
  results: Map<string, unknown>;
  error?: string;
}

export interface PlanExecutorEvents {
  'plan:started': (plan: Plan) => void;
  'plan:completed': (plan: Plan, result: ExecutionResult) => void;
  'plan:failed': (plan: Plan, error: string) => void;
  'plan:paused': (plan: Plan) => void;
  'plan:resumed': (plan: Plan) => void;
  'step:started': (plan: Plan, step: PlanStep) => void;
  'step:completed': (plan: Plan, step: PlanStep, result: StepResult) => void;
  'step:failed': (plan: Plan, step: PlanStep, error: string) => void;
  'step:skipped': (plan: Plan, step: PlanStep, reason: string) => void;
  'approval:required': (plan: Plan, step: PlanStep, context: unknown) => void;
}

// ============================================================================
// Plan Executor
// ============================================================================

export class PlanExecutor extends EventEmitter {
  private config: Required<ExecutorConfig>;
  private repo: PlansRepository;
  private stepHandlers: Map<string, StepHandler> = new Map();
  private runningPlans: Map<string, AbortController> = new Map();
  private pausedPlans: Set<string> = new Set();

  constructor(config: ExecutorConfig = {}) {
    super();
    this.config = {
      userId: config.userId ?? 'default',
      maxConcurrent: config.maxConcurrent ?? 5,
      defaultTimeout: config.defaultTimeout ?? 60000,
      verbose: config.verbose ?? false,
      autonomyLevel: config.autonomyLevel ?? 1,
    };
    this.repo = new PlansRepository(this.config.userId);
    this.registerDefaultHandlers();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Execute a plan
   */
  async execute(planId: string): Promise<ExecutionResult> {
    const plan = this.repo.get(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (this.runningPlans.has(planId)) {
      throw new Error(`Plan already running: ${planId}`);
    }

    const abortController = new AbortController();
    this.runningPlans.set(planId, abortController);
    this.pausedPlans.delete(planId);

    const startTime = Date.now();
    const results = new Map<string, unknown>();

    try {
      // Update plan status
      this.repo.update(planId, { status: 'running' });
      this.repo.logEvent(planId, 'started');
      this.emit('plan:started', plan);

      // Load previous results if resuming
      const steps = this.repo.getSteps(planId);
      for (const step of steps) {
        if (step.status === 'completed' && step.result) {
          results.set(step.id, step.result);
        }
      }

      // Execute steps
      await this.executeSteps(planId, results, abortController.signal);

      // Check final status
      const updatedPlan = this.repo.get(planId)!;
      const completedSteps = this.repo.getStepsByStatus(planId, 'completed').length;
      const totalSteps = steps.length;

      const result: ExecutionResult = {
        planId,
        status: updatedPlan.status,
        completedSteps,
        totalSteps,
        duration: Date.now() - startTime,
        results,
      };

      if (updatedPlan.status === 'completed') {
        this.repo.logEvent(planId, 'completed', undefined, { duration: result.duration });
        this.emit('plan:completed', updatedPlan, result);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.repo.update(planId, { status: 'failed', error: errorMessage });
      this.repo.logEvent(planId, 'failed', undefined, { error: errorMessage });
      this.emit('plan:failed', plan, errorMessage);

      return {
        planId,
        status: 'failed',
        completedSteps: this.repo.getStepsByStatus(planId, 'completed').length,
        totalSteps: this.repo.getSteps(planId).length,
        duration: Date.now() - startTime,
        results,
        error: errorMessage,
      };
    } finally {
      this.runningPlans.delete(planId);
    }
  }

  /**
   * Pause a running plan
   */
  pause(planId: string): boolean {
    if (!this.runningPlans.has(planId)) {
      return false;
    }

    this.pausedPlans.add(planId);
    this.repo.update(planId, { status: 'paused' });
    this.repo.logEvent(planId, 'paused');

    const plan = this.repo.get(planId);
    if (plan) {
      this.emit('plan:paused', plan);
    }

    return true;
  }

  /**
   * Resume a paused plan
   */
  async resume(planId: string): Promise<ExecutionResult> {
    const plan = this.repo.get(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (plan.status !== 'paused') {
      throw new Error(`Plan is not paused: ${planId}`);
    }

    this.pausedPlans.delete(planId);
    this.repo.update(planId, { status: 'running' });
    this.repo.logEvent(planId, 'resumed');
    this.emit('plan:resumed', plan);

    return this.execute(planId);
  }

  /**
   * Abort a running plan
   */
  abort(planId: string): boolean {
    const controller = this.runningPlans.get(planId);
    if (!controller) {
      return false;
    }

    controller.abort();
    this.repo.update(planId, { status: 'cancelled' });
    this.repo.logEvent(planId, 'cancelled');

    return true;
  }

  /**
   * Create a checkpoint for a plan
   */
  checkpoint(planId: string, data?: unknown): void {
    const checkpointData = {
      timestamp: new Date().toISOString(),
      data,
    };

    this.repo.update(planId, { checkpoint: JSON.stringify(checkpointData) });
    this.repo.logEvent(planId, 'checkpoint', undefined, checkpointData);
  }

  /**
   * Restore a plan from checkpoint
   */
  restoreFromCheckpoint(planId: string): unknown | null {
    const plan = this.repo.get(planId);
    if (!plan?.checkpoint) {
      return null;
    }

    try {
      return JSON.parse(plan.checkpoint);
    } catch {
      return null;
    }
  }

  /**
   * Register a step handler
   */
  registerHandler(type: string, handler: StepHandler): void {
    this.stepHandlers.set(type, handler);
  }

  /**
   * Check if a plan is running
   */
  isRunning(planId: string): boolean {
    return this.runningPlans.has(planId);
  }

  /**
   * Check if a plan is paused
   */
  isPaused(planId: string): boolean {
    return this.pausedPlans.has(planId);
  }

  /**
   * Get all running plan IDs
   */
  getRunningPlans(): string[] {
    return Array.from(this.runningPlans.keys());
  }

  // ============================================================================
  // Step Execution
  // ============================================================================

  private async executeSteps(
    planId: string,
    results: Map<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    while (true) {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Plan execution aborted');
      }

      // Check for pause
      if (this.pausedPlans.has(planId)) {
        return;
      }

      // Get next pending step
      const step = this.repo.getNextStep(planId);
      if (!step) {
        // All steps completed
        this.repo.update(planId, { status: 'completed' });
        this.repo.recalculateProgress(planId);
        return;
      }

      // Check dependencies
      if (!this.repo.areDependenciesMet(step.id)) {
        // Try to find another step that can run
        const pendingSteps = this.repo.getStepsByStatus(planId, 'pending');
        const readyStep = pendingSteps.find((s) => this.repo.areDependenciesMet(s.id));

        if (!readyStep) {
          // All pending steps are blocked
          const blockedSteps = pendingSteps.filter((s) => !this.repo.areDependenciesMet(s.id));
          for (const blocked of blockedSteps) {
            this.repo.updateStep(blocked.id, { status: 'blocked' });
          }
          this.repo.update(planId, { status: 'failed', error: 'All steps blocked by unmet dependencies' });
          throw new Error('All steps blocked by unmet dependencies');
        }

        // Execute the ready step instead
        await this.executeStep(planId, readyStep, results, signal);
      } else {
        await this.executeStep(planId, step, results, signal);
      }

      // Update progress
      this.repo.recalculateProgress(planId);
    }
  }

  private async executeStep(
    planId: string,
    step: PlanStep,
    results: Map<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    const plan = this.repo.get(planId)!;

    // Update step status
    this.repo.updateStep(step.id, { status: 'running' });
    this.repo.logEvent(planId, 'step_started', step.id);
    this.emit('step:started', plan, step);

    const context: StepExecutionContext = {
      plan,
      step,
      previousResults: results,
      abortSignal: signal,
    };

    try {
      // Get handler for step type
      const handler = this.stepHandlers.get(step.type);
      if (!handler) {
        throw new Error(`No handler for step type: ${step.type}`);
      }

      // Execute with timeout
      const timeout = step.timeoutMs ?? this.config.defaultTimeout;
      const result = await this.executeWithTimeout(
        () => handler(step.config, context),
        timeout
      );

      // Handle result
      if (result.success) {
        results.set(step.id, result.data);
        this.repo.updateStep(step.id, {
          status: 'completed',
          result: result.data,
        });
        this.repo.logEvent(planId, 'step_completed', step.id, { result: result.data });
        this.emit('step:completed', plan, step, result);

        // Handle branching
        if (result.nextStep) {
          // Jump to specific step (for conditions)
          const targetStep = this.repo.getSteps(planId).find((s) => s.id === result.nextStep);
          if (targetStep && targetStep.status === 'pending') {
            // Mark skipped steps
            const steps = this.repo.getSteps(planId);
            for (const s of steps) {
              if (s.orderNum > step.orderNum && s.orderNum < targetStep.orderNum && s.status === 'pending') {
                this.repo.updateStep(s.id, { status: 'skipped' });
                this.emit('step:skipped', plan, s, 'Skipped due to condition branch');
              }
            }
          }
        }

        // Handle pause request
        if (result.shouldPause) {
          this.pause(planId);
        }

        // Handle approval required
        if (result.requiresApproval) {
          this.repo.update(planId, { status: 'paused' });
          this.emit('approval:required', plan, step, result.data);
          this.pausedPlans.add(planId);
        }
      } else {
        throw new Error(result.error || 'Step execution failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check for retry
      if (step.retryCount < step.maxRetries) {
        this.repo.updateStep(step.id, {
          status: 'pending',
          retryCount: step.retryCount + 1,
          error: errorMessage,
        });
        this.log(`Step ${step.name} failed, retrying (${step.retryCount + 1}/${step.maxRetries})`);
        return; // Will be retried in next iteration
      }

      // Max retries exceeded
      this.repo.updateStep(step.id, {
        status: 'failed',
        error: errorMessage,
      });
      this.repo.logEvent(planId, 'step_failed', step.id, { error: errorMessage });
      this.emit('step:failed', plan, step, errorMessage);

      // Handle failure action
      if (step.onFailure === 'abort' || !step.onFailure) {
        throw error;
      } else if (step.onFailure === 'skip') {
        // Continue to next step
        this.log(`Step ${step.name} failed but continuing (onFailure: skip)`);
      } else {
        // Jump to specific step
        const targetStep = this.repo.getSteps(planId).find((s) => s.id === step.onFailure);
        if (targetStep) {
          // Will be picked up in next iteration
        }
      }
    }
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step timed out after ${timeout}ms`));
      }, timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  // ============================================================================
  // Default Handlers
  // ============================================================================

  private registerDefaultHandlers(): void {
    // Tool call handler
    this.registerHandler('tool_call', async (config, context) => {
      if (!config.toolName) {
        return { success: false, error: 'No tool name specified' };
      }

      // Tool execution will be handled by the caller
      // This returns a placeholder that indicates tool should be called
      return {
        success: true,
        data: {
          type: 'tool_call',
          toolName: config.toolName,
          toolArgs: config.toolArgs ?? {},
          requiresExecution: true,
        },
      };
    });

    // LLM decision handler
    this.registerHandler('llm_decision', async (config, context) => {
      if (!config.prompt) {
        return { success: false, error: 'No prompt specified' };
      }

      // LLM call will be handled by the caller
      return {
        success: true,
        data: {
          type: 'llm_decision',
          prompt: config.prompt,
          choices: config.choices,
          requiresExecution: true,
        },
      };
    });

    // User input handler
    this.registerHandler('user_input', async (config, context) => {
      // Pause for user input
      return {
        success: true,
        data: {
          type: 'user_input',
          question: config.question,
          inputType: config.inputType ?? 'text',
          options: config.options,
        },
        shouldPause: true,
      };
    });

    // Condition handler
    this.registerHandler('condition', async (config, context) => {
      if (!config.condition) {
        return { success: false, error: 'No condition specified' };
      }

      // Evaluate condition (simple implementation)
      let conditionResult = false;
      try {
        // Check if condition references a previous result
        if (config.condition.startsWith('result:')) {
          const stepId = config.condition.slice(7);
          const result = context.previousResults.get(stepId);
          conditionResult = Boolean(result);
        } else if (config.condition === 'true') {
          conditionResult = true;
        } else if (config.condition === 'false') {
          conditionResult = false;
        }
      } catch {
        conditionResult = false;
      }

      return {
        success: true,
        data: { condition: config.condition, result: conditionResult },
        nextStep: conditionResult ? config.trueStep : config.falseStep,
      };
    });

    // Parallel handler (simplified - marks steps as ready)
    this.registerHandler('parallel', async (config, context) => {
      // For now, just return success - parallel execution
      // would require more complex orchestration
      return {
        success: true,
        data: {
          type: 'parallel',
          steps: config.steps,
          message: 'Parallel execution requires external orchestration',
        },
      };
    });

    // Loop handler
    this.registerHandler('loop', async (config, context) => {
      // Loop execution would need iteration tracking
      return {
        success: true,
        data: {
          type: 'loop',
          maxIterations: config.maxIterations,
          condition: config.loopCondition,
          message: 'Loop execution requires external orchestration',
        },
      };
    });

    // Sub-plan handler
    this.registerHandler('sub_plan', async (config, context) => {
      if (!config.subPlanId) {
        return { success: false, error: 'No sub-plan ID specified' };
      }

      // Execute sub-plan
      try {
        const result = await this.execute(config.subPlanId);
        return {
          success: result.status === 'completed',
          data: result,
          error: result.error,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Sub-plan execution failed',
        };
      }
    });
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[PlanExecutor] ${message}`);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let executorInstance: PlanExecutor | null = null;

export function getPlanExecutor(config?: ExecutorConfig): PlanExecutor {
  if (!executorInstance || config) {
    executorInstance = new PlanExecutor(config);
  }
  return executorInstance;
}
