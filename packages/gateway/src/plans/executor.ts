/**
 * Plan Executor
 *
 * Executes multi-step plans autonomously with support for
 * pause/resume, checkpointing, and failure recovery.
 */

import { EventEmitter } from 'events';
import {
  type Plan,
  type PlanStep,
  type PlanStatus,
  type StepStatus,
  type StepConfig,
} from '../db/repositories/plans.js';
import { getPlanService, type PlanService } from '../services/plan-service.js';
import { executeTool, hasTool } from '../services/tool-executor.js';
import { getLog } from '../services/log.js';

const log = getLog('PlanExecutor');

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
  private planService: PlanService;
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
    this.planService = getPlanService();
    this.registerDefaultHandlers();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Execute a plan
   */
  async execute(planId: string): Promise<ExecutionResult> {
    const plan = await this.planService.getPlan(this.config.userId, planId);
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
      await this.planService.updatePlan(this.config.userId, planId, { status: 'running' });
      await this.planService.logEvent(this.config.userId, planId, 'started');
      this.emit('plan:started', plan);

      // Load previous results if resuming
      const steps = await this.planService.getSteps(this.config.userId, planId);
      for (const step of steps) {
        if (step.status === 'completed' && step.result) {
          results.set(step.id, step.result);
        }
      }

      // Execute steps
      await this.executeSteps(planId, results, abortController.signal);

      // Check final status
      const updatedPlan = (await this.planService.getPlan(this.config.userId, planId))!;
      const completedSteps = (await this.planService.getStepsByStatus(this.config.userId, planId, 'completed')).length;
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
        await this.planService.logEvent(this.config.userId, planId, 'completed', undefined, { duration: result.duration });
        this.emit('plan:completed', updatedPlan, result);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.planService.updatePlan(this.config.userId, planId, { status: 'failed', error: errorMessage });
      await this.planService.logEvent(this.config.userId, planId, 'failed', undefined, { error: errorMessage });
      this.emit('plan:failed', plan, errorMessage);

      return {
        planId,
        status: 'failed',
        completedSteps: (await this.planService.getStepsByStatus(this.config.userId, planId, 'completed')).length,
        totalSteps: (await this.planService.getSteps(this.config.userId, planId)).length,
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
  async pause(planId: string): Promise<boolean> {
    if (!this.runningPlans.has(planId)) {
      return false;
    }

    this.pausedPlans.add(planId);
    await this.planService.updatePlan(this.config.userId, planId, { status: 'paused' });
    await this.planService.logEvent(this.config.userId, planId, 'paused');

    const plan = await this.planService.getPlan(this.config.userId, planId);
    if (plan) {
      this.emit('plan:paused', plan);
    }

    return true;
  }

  /**
   * Resume a paused plan
   */
  async resume(planId: string): Promise<ExecutionResult> {
    const plan = await this.planService.getPlan(this.config.userId, planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (plan.status !== 'paused') {
      throw new Error(`Plan is not paused: ${planId}`);
    }

    this.pausedPlans.delete(planId);
    await this.planService.updatePlan(this.config.userId, planId, { status: 'running' });
    await this.planService.logEvent(this.config.userId, planId, 'resumed');
    this.emit('plan:resumed', plan);

    return this.execute(planId);
  }

  /**
   * Abort a running plan
   */
  async abort(planId: string): Promise<boolean> {
    const controller = this.runningPlans.get(planId);
    if (!controller) {
      return false;
    }

    controller.abort();
    await this.planService.updatePlan(this.config.userId, planId, { status: 'cancelled' });
    await this.planService.logEvent(this.config.userId, planId, 'cancelled');

    return true;
  }

  /**
   * Create a checkpoint for a plan
   */
  async checkpoint(planId: string, data?: unknown): Promise<void> {
    const checkpointData = {
      timestamp: new Date().toISOString(),
      data,
    };

    await this.planService.updatePlan(this.config.userId, planId, { checkpoint: JSON.stringify(checkpointData) });
    await this.planService.logEvent(this.config.userId, planId, 'checkpoint', undefined, checkpointData);
  }

  /**
   * Restore a plan from checkpoint
   */
  async restoreFromCheckpoint(planId: string): Promise<unknown | null> {
    const plan = await this.planService.getPlan(this.config.userId, planId);
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
    let stallCount = 0;
    const MAX_STALL = 3;

    while (true) {
      // Yield to event loop to prevent blocking
      await new Promise((r) => setTimeout(r, 0));

      // Check for abort
      if (signal.aborted) {
        throw new Error('Plan execution aborted');
      }

      // Check for pause
      if (this.pausedPlans.has(planId)) {
        return;
      }

      // Get next pending step
      const step = await this.planService.getNextStep(this.config.userId, planId);
      if (!step) {
        // All steps completed
        await this.planService.updatePlan(this.config.userId, planId, { status: 'completed' });
        await this.planService.recalculateProgress(this.config.userId, planId);
        return;
      }

      // Check dependencies
      if (!await this.planService.areDependenciesMet(this.config.userId, step.id)) {
        // Try to find another step that can run
        const pendingSteps = await this.planService.getStepsByStatus(this.config.userId, planId, 'pending');

        // Find a ready step (one with met dependencies)
        let readyStep: PlanStep | undefined;
        for (const s of pendingSteps) {
          if (await this.planService.areDependenciesMet(this.config.userId, s.id)) {
            readyStep = s;
            break;
          }
        }

        if (!readyStep) {
          stallCount++;
          this.log(`No runnable steps (stall ${stallCount}/${MAX_STALL})`);

          if (stallCount >= MAX_STALL) {
            // Deadlock detected — mark blocked steps and fail plan
            for (const s of pendingSteps) {
              if (!await this.planService.areDependenciesMet(this.config.userId, s.id)) {
                await this.planService.updateStep(this.config.userId, s.id, { status: 'blocked' });
              }
            }
            await this.planService.updatePlan(this.config.userId, planId, { status: 'failed', error: 'Dependency deadlock: all pending steps have unmet dependencies' });
            throw new Error('Dependency deadlock: all pending steps have unmet dependencies');
          }

          // Wait before retrying to avoid busy loop
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // Found a runnable step — reset stall counter
        stallCount = 0;
        await this.executeStep(planId, readyStep, results, signal);
      } else {
        stallCount = 0;
        await this.executeStep(planId, step, results, signal);
      }

      // Update progress
      await this.planService.recalculateProgress(this.config.userId, planId);
    }
  }

  private async executeStep(
    planId: string,
    step: PlanStep,
    results: Map<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    const plan = (await this.planService.getPlan(this.config.userId, planId))!;

    // Update step status
    await this.planService.updateStep(this.config.userId, step.id, { status: 'running' });
    await this.planService.logEvent(this.config.userId, planId, 'step_started', step.id);
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
        await this.planService.updateStep(this.config.userId, step.id, {
          status: 'completed',
          result: result.data,
        });
        await this.planService.logEvent(this.config.userId, planId, 'step_completed', step.id, { result: result.data });
        this.emit('step:completed', plan, step, result);

        // Handle branching
        if (result.nextStep) {
          // Jump to specific step (for conditions)
          const allSteps = await this.planService.getSteps(this.config.userId, planId);
          const targetStep = allSteps.find((s) => s.id === result.nextStep);
          if (targetStep && targetStep.status === 'pending') {
            // Mark skipped steps
            const steps = await this.planService.getSteps(this.config.userId, planId);
            for (const s of steps) {
              if (s.orderNum > step.orderNum && s.orderNum < targetStep.orderNum && s.status === 'pending') {
                await this.planService.updateStep(this.config.userId, s.id, { status: 'skipped' });
                this.emit('step:skipped', plan, s, 'Skipped due to condition branch');
              }
            }
          }
        }

        // Handle pause request
        if (result.shouldPause) {
          await this.pause(planId);
        }

        // Handle approval required
        if (result.requiresApproval) {
          await this.planService.updatePlan(this.config.userId, planId, { status: 'paused' });
          this.emit('approval:required', plan, step, result.data);
          this.pausedPlans.add(planId);
        }
      } else {
        throw new Error(result.error || 'Step execution failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check for retry with exponential backoff
      if (step.retryCount < step.maxRetries) {
        const retryNum = step.retryCount + 1;
        const backoffMs = Math.min(1000 * Math.pow(2, step.retryCount), 30000);
        this.log(`Step ${step.name} failed, retrying in ${backoffMs}ms (${retryNum}/${step.maxRetries})`);

        await new Promise((r) => setTimeout(r, backoffMs));

        await this.planService.updateStep(this.config.userId, step.id, {
          status: 'pending',
          retryCount: retryNum,
          error: errorMessage,
        });
        return; // Will be retried in next iteration
      }

      // Max retries exceeded
      await this.planService.updateStep(this.config.userId, step.id, {
        status: 'failed',
        error: errorMessage,
      });
      await this.planService.logEvent(this.config.userId, planId, 'step_failed', step.id, { error: errorMessage });
      this.emit('step:failed', plan, step, errorMessage);

      // Handle failure action
      if (step.onFailure === 'abort' || !step.onFailure) {
        throw error;
      } else if (step.onFailure === 'skip') {
        // Continue to next step
        this.log(`Step ${step.name} failed but continuing (onFailure: skip)`);
      } else {
        // Jump to specific step
        const failureSteps = await this.planService.getSteps(this.config.userId, planId);
        const targetStep = failureSteps.find((s) => s.id === step.onFailure);
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
    let settled = false;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Step timed out after ${timeout}ms`));
        }
      }, timeout);

      fn()
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        });
    });
  }

  // ============================================================================
  // Default Handlers
  // ============================================================================

  private registerDefaultHandlers(): void {
    // Tool call handler - executes tools via shared tool executor
    this.registerHandler('tool_call', async (config, context) => {
      if (!config.toolName) {
        return { success: false, error: 'No tool name specified' };
      }

      const toolName = config.toolName as string;
      const toolArgs = (config.toolArgs ?? {}) as Record<string, unknown>;

      if (!await hasTool(toolName)) {
        return { success: false, error: `Tool '${toolName}' not found` };
      }

      this.log(`Executing tool: ${toolName}`);
      const result = await executeTool(toolName, toolArgs, this.config.userId);

      if (result.success) {
        return {
          success: true,
          data: {
            type: 'tool_call',
            toolName,
            result: result.result,
          },
        };
      }

      return {
        success: false,
        error: result.error ?? `Tool '${toolName}' execution failed`,
      };
    });

    // LLM decision handler - calls the AI agent for decision-making
    this.registerHandler('llm_decision', async (config, context) => {
      if (!config.prompt) {
        return { success: false, error: 'No prompt specified' };
      }

      try {
        // Dynamic import to avoid circular dependencies
        const { getOrCreateChatAgent } = await import('../routes/agents.js');
        const { resolveProviderAndModel } = await import('../routes/settings.js');
        const resolved = await resolveProviderAndModel('default', 'default');
        const agent = await getOrCreateChatAgent(resolved.provider ?? 'openai', resolved.model ?? 'gpt-4o-mini');

        // Build the prompt with choices if provided
        let fullPrompt = config.prompt as string;
        if (config.choices && Array.isArray(config.choices)) {
          fullPrompt += '\n\nAvailable choices:\n';
          for (const choice of config.choices as string[]) {
            fullPrompt += `- ${choice}\n`;
          }
          fullPrompt += '\nRespond with your decision and reasoning.';
        }

        // Add context from previous steps if available
        if (context.previousResults.size > 0) {
          fullPrompt += '\n\nPrevious step results:\n';
          for (const [stepId, result] of context.previousResults) {
            fullPrompt += `- Step ${stepId}: ${JSON.stringify(result)}\n`;
          }
        }

        const result = await agent.chat(fullPrompt);

        if (result.ok) {
          return {
            success: true,
            data: {
              type: 'llm_decision',
              decision: result.value.content,
              toolCalls: result.value.toolCalls?.length ?? 0,
            },
          };
        }

        return {
          success: false,
          error: result.error?.message ?? 'LLM decision failed',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'LLM decision failed',
        };
      }
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

    // Parallel handler - executes multiple tool calls concurrently (respects maxConcurrent)
    this.registerHandler('parallel', async (config, context) => {
      const rawSteps = (config.steps ?? []) as unknown[];
      const steps = rawSteps.map((s) => {
        if (typeof s === 'object' && s !== null) {
          const obj = s as Record<string, unknown>;
          return { toolName: obj.toolName as string, toolArgs: (obj.toolArgs ?? {}) as Record<string, unknown> };
        }
        return { toolName: String(s), toolArgs: {} as Record<string, unknown> };
      });
      if (steps.length === 0) {
        return { success: true, data: { type: 'parallel', results: [] } };
      }

      const batchSize = this.config.maxConcurrent;
      this.log(`Executing ${steps.length} steps in parallel (batch size: ${batchSize})`);

      const allOutputs: Array<{ step: string | undefined; success: boolean; error?: string; result?: unknown }> = [];

      // Process in batches to respect maxConcurrent
      for (let i = 0; i < steps.length; i += batchSize) {
        const batch = steps.slice(i, i + batchSize);
        const promises = batch.map(async (step) => {
          if (step.toolName && await hasTool(step.toolName)) {
            return executeTool(step.toolName, step.toolArgs ?? {}, this.config.userId);
          }
          return { success: false, error: `Tool '${step.toolName}' not found` };
        });

        const results = await Promise.allSettled(promises);
        const batchOutputs = results.map((r, j) => ({
          step: batch[j]?.toolName,
          ...(r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message ?? 'Failed' }),
        }));
        allOutputs.push(...batchOutputs);
      }

      const allSucceeded = allOutputs.every((o) => o.success);
      return {
        success: allSucceeded,
        data: { type: 'parallel', results: allOutputs },
        error: allSucceeded ? undefined : 'Some parallel steps failed',
      };
    });

    // Loop handler - executes a tool repeatedly until condition is met
    this.registerHandler('loop', async (config, context) => {
      const maxIterations = (config.maxIterations as number) ?? 10;
      const toolName = config.toolName as string;
      const toolArgs = (config.toolArgs ?? {}) as Record<string, unknown>;

      if (!toolName || !await hasTool(toolName)) {
        return { success: false, error: `Loop tool '${toolName}' not found` };
      }

      this.log(`Starting loop: ${toolName} (max ${maxIterations} iterations)`);
      const iterationResults: unknown[] = [];

      for (let i = 0; i < maxIterations; i++) {
        const result = await executeTool(toolName, { ...toolArgs, iteration: i }, this.config.userId);
        iterationResults.push(result.result);

        if (!result.success) {
          return {
            success: false,
            data: { type: 'loop', iterations: i + 1, results: iterationResults },
            error: result.error ?? `Loop iteration ${i + 1} failed`,
          };
        }

        // Check abort signal
        if (context.abortSignal?.aborted) {
          return {
            success: true,
            data: { type: 'loop', iterations: i + 1, results: iterationResults, aborted: true },
          };
        }
      }

      return {
        success: true,
        data: { type: 'loop', iterations: maxIterations, results: iterationResults },
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
      log.info(`[PlanExecutor] ${message}`);
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
