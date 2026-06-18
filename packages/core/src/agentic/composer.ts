/**
 * Agentic Orchestration Composer
 *
 * Automatically composes multi-agent execution pipelines from natural
 * language task descriptions. The composer uses the Capability Registry
 * and Task Router to build, validate, and optimize execution plans.
 *
 * This is the "conductor" that orchestrates claws, souls, crews, coding
 * agents, workflows, triggers, and channels into a coherent execution.
 *
 * Key capabilities:
 * - Auto-compose pipelines from task descriptions
 * - Parallel step execution when no dependencies exist
 * - Automatic fallback and retry logic
 * - Resource-aware scheduling (cost, concurrency, latency)
 * - Full execution observability via AgenticReport
 */

import { generateId } from '../services/id-utils.js';
import type {
  AgenticTask,
  AgenticReport,
  ExecutionPlan,
  ExecutionStep,
  StepResult,
  StepStatus,
  ExecutionStatus,
  IAgenticOrchestrator,
} from './types.js';
import { getCapabilityRegistry, type CapabilityRegistry } from './capability-registry.js';
import { AgenticRouter } from './router.js';

// ============================================================================
// Execution Context
// ============================================================================

interface ExecutionState {
  id: string;
  task: AgenticTask;
  plan: ExecutionPlan;
  stepResults: StepResult[];
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  abortController: AbortController | null;
  totalCostUsd: number;
  totalTokens: { input: number; output: number };
}

// ============================================================================
// Pipeline Optimization
// ============================================================================

export interface OptimizationSuggestion {
  type: 'parallelize' | 'merge_steps' | 'reorder' | 'split_task' | 'change_executor';
  description: string;
  impact: 'cost' | 'latency' | 'reliability';
  estimatedImprovement: string;
}

/**
 * Analyze an execution plan and suggest optimizations.
 */
export function optimizePlan(plan: ExecutionPlan): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // Check for parallelizable steps
  const stepMap = new Map<number, ExecutionStep>();
  for (const step of plan.steps) {
    stepMap.set(step.index, step);
  }

  // Find pairs of steps that could run in parallel
  for (let i = 0; i < plan.steps.length; i++) {
    for (let j = i + 1; j < plan.steps.length; j++) {
      const a = plan.steps[i]!;
      const b = plan.steps[j]!;

      // If A doesn't depend on B and B doesn't depend on A, they could be parallel
      if (!a.dependsOn.includes(b.index) && !b.dependsOn.includes(a.index)) {
        // Check they don't share transitive dependencies
        const aDeps = new Set(expandDependencies(a, stepMap));
        const bDeps = new Set(expandDependencies(b, stepMap));

        // Check if their dependency sets are independent
        const shared = [...aDeps].filter((d) => bDeps.has(d));
        if (shared.length === 0) {
          suggestions.push({
            type: 'parallelize',
            description: `Steps ${a.index} (${a.executorKind}) and ${b.index} (${b.executorKind}) can run in parallel`,
            impact: 'latency',
            estimatedImprovement: `Reduces total time by ~${Math.min(
              a.timeoutMs ?? 30_000,
              b.timeoutMs ?? 30_000
            )}ms`,
          });
        }
      }
    }
  }

  // Check if any two claw steps could be merged
  const clawSteps = plan.steps.filter((s) => s.executorKind === 'claw');
  if (clawSteps.length > 1) {
    const adjacent = clawSteps.filter(
      (s, i) => i > 0 && clawSteps[i - 1] && s.dependsOn.includes(clawSteps[i - 1]!.index)
    );
    if (adjacent.length > 0) {
      suggestions.push({
        type: 'merge_steps',
        description: `${adjacent.length + 1} sequential claw steps could be merged into one autonomous cycle`,
        impact: 'cost',
        estimatedImprovement: 'Eliminates redundant context loading overhead',
      });
    }
  }

  return suggestions;
}

function expandDependencies(step: ExecutionStep, stepMap: Map<number, ExecutionStep>): number[] {
  const deps: number[] = [];
  const queue = [...step.dependsOn];
  const seen = new Set<number>();

  while (queue.length > 0) {
    const depIdx = queue.shift()!;
    if (seen.has(depIdx)) continue;
    seen.add(depIdx);
    deps.push(depIdx);

    const depStep = stepMap.get(depIdx);
    if (depStep) {
      queue.push(...depStep.dependsOn);
    }
  }

  return deps;
}

// ============================================================================
// Orchestrator Implementation
// ============================================================================

/**
 * Signature for a step dispatch function.
 * Gateway implementations provide this to route steps to real services
 * (ClawService, WorkflowService, CodingAgentService, TriggerEngine, etc.).
 */
export type StepDispatchFn = (
  step: ExecutionStep,
  signal?: AbortSignal
) => Promise<{ success: boolean; output: unknown; error?: string; costUsd?: number }>;

export class AgenticOrchestrator implements IAgenticOrchestrator {
  private readonly executions = new Map<string, ExecutionState>();
  private readonly router: AgenticRouter;
  private readonly registry: CapabilityRegistry;
  private readonly stepHandler: StepDispatchFn | null;

  /**
   * Shared static store across orchestrator instances — enables
   * `listExecutions()` and `getReport()` to work across API requests
   * even when routes create fresh orchestrator instances.
   *
   * Execution state is written here by `execute()` on every orchestrator
   * and read by `listExecutions()` / `getReport()` on any orchestrator.
   * Indexed by execution id — Map<string, ExecutionState>.
   * Writes are additive (insert/overwrite), never deleted — executions
   * accumulate until process restart.
   */
  private static readonly sharedStore = new Map<string, ExecutionState>();

  constructor(registry?: CapabilityRegistry, stepHandler?: StepDispatchFn) {
    this.registry = registry ?? getCapabilityRegistry();
    this.router = new AgenticRouter(this.registry);
    this.stepHandler = stepHandler ?? null;
  }

  /**
   * Execute a task end-to-end.
   *
   * 1. Analyze the task → determine executor kind
   * 2. Generate an execution plan
   * 3. Execute each step respecting dependencies
   * 4. Collect results and produce an AgenticReport
   */
  async execute(task: Omit<AgenticTask, 'id'>): Promise<AgenticReport> {
    const fullTask: AgenticTask = { ...task, id: generateId('agentic_exec') };
    const { plan } = await this.router.route(fullTask);

    const state: ExecutionState = {
      id: fullTask.id,
      task: fullTask,
      plan,
      stepResults: [],
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      abortController: new AbortController(),
      totalCostUsd: 0,
      totalTokens: { input: 0, output: 0 },
    };

    this.executions.set(state.id, state);
    AgenticOrchestrator.sharedStore.set(state.id, state);

    try {
      await this.executePlan(state);
      // Don't clobber a terminal status reached DURING execution — cancel() sets
      // 'cancelled' and a fallbackStrategy:'escalate' step sets 'escalated'.
      // Only derive the final status from step results when the run actually ran
      // to its natural end (still 'running' here). Without this guard a user
      // cancel was overwritten with completed/failed/partially_completed.
      if (state.status === 'running') {
        state.status = state.stepResults.every((r) => r.status === 'completed')
          ? 'completed'
          : state.stepResults.some((r) => r.status === 'failed')
            ? 'failed'
            : 'partially_completed';
      }
    } catch {
      if (state.status === 'running') state.status = 'failed';
    } finally {
      state.completedAt = new Date();
      state.abortController = null;
    }

    return this.buildReport(state);
  }

  /**
   * Cancel a running execution. Checks both local and shared stores.
   */
  async cancel(executionId: string): Promise<boolean> {
    const state =
      this.executions.get(executionId) ?? AgenticOrchestrator.sharedStore.get(executionId);
    if (!state) return false;
    if (state.status !== 'running') return false;

    state.abortController?.abort();
    state.status = 'cancelled';
    state.completedAt = new Date();
    return true;
  }

  /**
   * Get execution status. Checks both local and shared stores.
   */
  async getStatus(executionId: string): Promise<ExecutionStatus | null> {
    return (
      (this.executions.get(executionId) ?? AgenticOrchestrator.sharedStore.get(executionId))
        ?.status ?? null
    );
  }

  /**
   * Get full execution report. Checks both local and shared stores.
   */
  async getReport(executionId: string): Promise<AgenticReport | null> {
    const state =
      this.executions.get(executionId) ?? AgenticOrchestrator.sharedStore.get(executionId);
    if (!state) return null;
    return this.buildReport(state);
  }

  /**
   * List recent executions. Merges local and shared stores (deduplicated by id).
   */
  async listExecutions(limit = 20, offset = 0): Promise<AgenticReport[]> {
    const merged = new Map<string, ExecutionState>();
    for (const [id, state] of AgenticOrchestrator.sharedStore) merged.set(id, state);
    for (const [id, state] of this.executions) merged.set(id, state);
    return Array.from(merged.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(offset, offset + limit)
      .map((s) => this.buildReport(s));
  }

  /**
   * Delete a single execution from both local and shared stores.
   */
  async deleteExecution(executionId: string): Promise<boolean> {
    const existed = this.executions.delete(executionId);
    const existedShared = AgenticOrchestrator.sharedStore.delete(executionId);
    return existed || existedShared;
  }

  /**
   * Clear all executions from both local and shared stores.
   */
  async clearExecutions(): Promise<void> {
    this.executions.clear();
    AgenticOrchestrator.sharedStore.clear();
  }

  /**
   * Get execution stats. Uses merged local + shared stores.
   */
  async getStats(): Promise<{
    totalExecutions: number;
    activeExecutions: number;
    totalCostUsd: number;
    successRate: number;
    byExecutorKind: Record<string, number>;
  }> {
    const merged = new Map<string, ExecutionState>();
    for (const [id, state] of AgenticOrchestrator.sharedStore) merged.set(id, state);
    for (const [id, state] of this.executions) merged.set(id, state);
    const all = Array.from(merged.values());
    const active = all.filter((s) => s.status === 'running').length;
    const completed = all.filter((s) => s.status === 'completed');
    const successRate = completed.length / Math.max(all.length, 1);

    const byExecutorKind: Record<string, number> = {};
    for (const s of all) {
      for (const r of s.stepResults) {
        const kind = r.step.executorKind;
        byExecutorKind[kind] = (byExecutorKind[kind] ?? 0) + 1;
      }
    }

    return {
      totalExecutions: all.length,
      activeExecutions: active,
      totalCostUsd: all.reduce((sum, s) => sum + s.totalCostUsd, 0),
      successRate,
      byExecutorKind,
    };
  }

  // ── Private Plan Execution ──

  /**
   * Execute all steps in the plan respecting the dependency DAG.
   */
  private async executePlan(state: ExecutionState): Promise<void> {
    const { steps } = state.plan;
    const completed = new Set<number>();
    const failed = new Set<number>();
    const signal = state.abortController?.signal;

    while (completed.size + failed.size < steps.length) {
      if (signal?.aborted) {
        state.status = 'cancelled';
        return;
      }

      // Find steps whose dependencies are all satisfied
      const ready = steps.filter(
        (s) =>
          !completed.has(s.index) &&
          !failed.has(s.index) &&
          s.dependsOn.every((d) => completed.has(d))
      );

      if (ready.length === 0) {
        // No steps ready but not all done → stuck (likely circular dep or failed prerequisite)
        const stuck = steps.filter((s) => !completed.has(s.index) && !failed.has(s.index));
        for (const s of stuck) {
          const missingDeps = s.dependsOn.filter((d) => !completed.has(d));
          this.recordStepResult(state, s, 'skipped', null, {
            error: `Dependency ${missingDeps.join(', ')} not met`,
          });
          failed.add(s.index);
        }
        break;
      }

      // Execute ready steps in parallel
      const results = await Promise.allSettled(
        ready.map((step) => this.executeStep(step, state, signal))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const step = ready[i]!;
        if (result.status === 'fulfilled') {
          completed.add(step.index);
        } else {
          failed.add(step.index);
        }
      }
    }

    // Mark any unexecuted steps as skipped
    for (const step of steps) {
      if (!completed.has(step.index) && !failed.has(step.index)) {
        this.recordStepResult(state, step, 'skipped', null, {
          error: 'Step was not reached',
        });
      }
    }
  }

  /**
   * Execute a single step (with retry support).
   */
  private async executeStep(
    step: ExecutionStep,
    state: ExecutionState,
    signal?: AbortSignal
  ): Promise<void> {
    const maxRetries = step.retryOnFailure ? 2 : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        this.recordStepResult(state, step, 'skipped', null, {
          error: 'Execution cancelled',
        });
        return;
      }

      const startTime = Date.now();

      try {
        const { output, costUsd } = await this.executeStepWithTimeout(step, signal);

        const durationMs = Date.now() - startTime;
        this.recordStepResult(state, step, 'completed', output, {
          durationMs,
          // Prefer the real cost reported by the executor; fall back to the
          // per-kind estimate only when the handler didn't report one.
          costUsd: costUsd ?? this.estimateStepCost(step),
        });
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;

        if (attempt < maxRetries) {
          // Will retry
          continue;
        }

        this.recordStepResult(state, step, 'failed', null, {
          error: errMsg,
          durationMs,
          costUsd: 0,
        });

        // Handle fallback
        if (state.plan.fallbackStrategy === 'escalate') {
          state.status = 'escalated';
        }
        throw err;
      }
    }
  }

  /**
   * Execute a step with timeout.
   */
  private async executeStepWithTimeout(
    step: ExecutionStep,
    signal?: AbortSignal
  ): Promise<{ output: unknown; costUsd?: number }> {
    const timeoutMs = step.timeoutMs ?? 60_000;

    // Race the step execution against the timeout
    const result = await Promise.race([
      this.dispatchStep(step, signal),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Step ${step.index} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);

    return result;
  }

  /**
   * Dispatch a step to the actual executor.
   *
   * When a `stepHandler` was provided to the constructor (e.g. the gateway
   * passed its AgenticGatewayExecutor), this delegates to it — the gateway
   * routes to ClawService, WorkflowService, CodingAgentService, etc.
   *
   * When no handler is set (vanilla core usage), returns the params as a
   * placeholder so the orchestration logic can still be tested without
   * any gateway services running.
   */
  private async dispatchStep(
    step: ExecutionStep,
    signal?: AbortSignal
  ): Promise<{ output: unknown; costUsd?: number }> {
    if (this.stepHandler) {
      const result = await this.stepHandler(step, signal);
      if (!result.success) {
        throw new Error(result.error ?? `Step ${step.index} (${step.executorKind}) failed`);
      }
      // Carry the executor's real cost through so executeStep records it instead
      // of the per-kind estimate (the previous code dropped result.costUsd).
      return { output: result.output, costUsd: result.costUsd };
    }

    // Default placeholder — no gateway handler wired
    return {
      output: {
        executorKind: step.executorKind,
        capabilityId: step.capabilityId,
        params: step.params,
        dispatched: true,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Record a step result in the execution state.
   */
  private recordStepResult(
    state: ExecutionState,
    step: ExecutionStep,
    status: StepStatus,
    output: unknown,
    meta?: { error?: string; durationMs?: number; costUsd?: number }
  ): void {
    const existing = state.stepResults.findIndex((r) => r.step.index === step.index);
    const result: StepResult = {
      step,
      status,
      output: output ?? null,
      error: meta?.error,
      durationMs: meta?.durationMs ?? 0,
      costUsd: meta?.costUsd,
      startedAt: new Date(),
      completedAt: status === 'running' ? null : new Date(),
    };

    if (existing >= 0) {
      state.stepResults[existing] = result;
    } else {
      state.stepResults.push(result);
    }

    if (meta?.costUsd) {
      state.totalCostUsd += meta.costUsd;
    }
  }

  /**
   * Estimate the cost of executing a step.
   */
  private estimateStepCost(step: ExecutionStep): number {
    const costMap: Record<string, number> = {
      claw: 0.05,
      soul_heartbeat: 0.01,
      crew: 0.1,
      coding_agent: 0.2,
      workflow: 0.05,
      trigger: 0.001,
      channel: 0.001,
      direct_llm: 0.005,
      sandbox_code: 0.001,
      tool_catalog: 0.001,
    };
    return costMap[step.executorKind] ?? 0.01;
  }

  /**
   * Build an AgenticReport from execution state.
   */
  private buildReport(state: ExecutionState): AgenticReport {
    const totalDurationMs = state.completedAt
      ? state.completedAt.getTime() - state.startedAt.getTime()
      : Date.now() - state.startedAt.getTime();

    const successCount = state.stepResults.filter((r) => r.status === 'completed').length;
    const totalSteps = state.plan.steps.length;
    const summary =
      state.status === 'completed'
        ? `Completed ${successCount}/${totalSteps} steps successfully`
        : state.status === 'failed'
          ? `Failed after ${successCount}/${totalSteps} steps — ${state.stepResults.find((r) => r.status === 'failed')?.error ?? 'Unknown error'}`
          : state.status === 'cancelled'
            ? `Cancelled after ${successCount}/${totalSteps} steps`
            : state.status === 'partially_completed'
              ? `Partially completed (${successCount}/${totalSteps} steps)`
              : `Execution is ${state.status}`;

    return {
      id: state.id,
      task: state.task,
      plan: state.plan,
      stepResults: [...state.stepResults],
      status: state.status,
      totalCostUsd: state.totalCostUsd,
      totalDurationMs,
      totalTokens: { ...state.totalTokens },
      error: state.stepResults.find((r) => r.error)?.error,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      summary,
    };
  }
}

// ============================================================================
// Pre-built pipeline templates
// ============================================================================

/**
 * Create a research pipeline: research → analyze → report.
 */
export function createResearchPipeline(
  topic: string,
  options?: {
    depth?: 'quick' | 'standard' | 'deep';
    outputFormat?: 'markdown' | 'json' | 'html';
  }
): Omit<AgenticTask, 'id'> {
  const depth = options?.depth ?? 'standard';
  const depthDesc =
    depth === 'quick'
      ? 'Do a quick overview — spend no more than 5 minutes on research.'
      : depth === 'deep'
        ? 'Do a thorough deep-dive. Use web search, browse multiple sources, cross-reference findings.'
        : 'Do standard research — gather key facts, verify sources, produce a concise report.';

  return {
    name: `Research: ${topic}`,
    description: `Research the topic "${topic}" thoroughly. ${depthDesc} Compile findings into a structured ${options?.outputFormat ?? 'markdown'} report with sources.`,
    expectedOutput: `${options?.outputFormat ?? 'markdown'} report with findings, analysis, and source links`,
    priority: 'normal',
    trigger: { type: 'immediate' },
    constraints: {
      maxCostUsd: depth === 'deep' ? 0.5 : depth === 'standard' ? 0.2 : 0.1,
      allowNetwork: true,
      allowCodeExecution: false,
    },
    outputRouting: {
      memory: true,
      artifact: {
        name: `research-${topic.toLowerCase().replace(/\s+/g, '-')}`,
        tags: ['research', topic.toLowerCase()],
      },
    },
  };
}

/**
 * Create a monitoring pipeline: periodic check → alert on failure.
 */
export function createMonitoringPipeline(
  name: string,
  checkDescription: string,
  intervalMs: number,
  outputChannel?: { provider: string; chatId: string }
): Omit<AgenticTask, 'id'> {
  return {
    name: `Monitor: ${name}`,
    description: `Periodically ${checkDescription}. Run every ${Math.round(intervalMs / 60000)} minutes. On failure or unexpected result, ${outputChannel ? `send alert via ${outputChannel.provider}` : 'log the issue'}.`,
    expectedOutput: 'Health check result or alert',
    priority: 'normal',
    trigger: { type: 'interval', intervalMs },
    constraints: {
      maxCostUsd: 0.1,
      timeoutMs: 60_000,
      allowNetwork: true,
      allowCodeExecution: false,
    },
    outputRouting: {
      memory: true,
      channel: outputChannel
        ? { provider: outputChannel.provider, chatId: outputChannel.chatId }
        : undefined,
    },
  };
}

/**
 * Create a code generation pipeline: design → implement → test.
 */
export function createCodePipeline(
  description: string,
  options?: {
    language?: string;
    testFramework?: string;
    includeTests?: boolean;
  }
): Omit<AgenticTask, 'id'> {
  const lang = options?.language ?? 'TypeScript';
  const tests = options?.includeTests ?? true;

  return {
    name: `Code: ${description.slice(0, 60)}`,
    description: `Implement the following in ${lang}: ${description}${tests ? ` Include ${options?.testFramework ?? 'vitest'} tests.` : ''} Ensure the solution is production-ready with error handling and documentation.`,
    expectedOutput: `Working ${lang} implementation${tests ? ' with tests' : ''}`,
    priority: 'normal',
    trigger: { type: 'immediate' },
    constraints: {
      maxCostUsd: 1.0,
      timeoutMs: 600_000,
      allowCodeExecution: true,
      allowNetwork: true,
    },
    outputRouting: {
      memory: true,
      artifact: { name: `code-${Date.now()}`, tags: ['code', lang.toLowerCase()] },
    },
  };
}
