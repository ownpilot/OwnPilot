/**
 * Orchestra Engine
 *
 * Executes multi-agent orchestra plans using the SubagentManager.
 * Supports sequential, parallel, and DAG (dependency graph) strategies.
 *
 * The engine:
 * 1. Resolves named agents to their configs (system prompt, preferred model)
 * 2. Spawns subagents for each task
 * 3. Manages execution flow based on strategy
 * 4. Collects results and emits progress events
 * 5. Persists completed executions to DB
 */

import {
  generateId,
  getErrorMessage,
  type OrchestraPlan,
  type OrchestraExecution,
  type OrchestraTaskResult,
  type OrchestraState,
  type AgentTask,
  type DelegateToAgentInput,
  type DelegationResult,
  type SubagentSession,
  DEFAULT_ORCHESTRA_LIMITS,
} from '@ownpilot/core';
import { getEventSystem } from '@ownpilot/core';
import { getLog } from './log.js';
import { getSubagentService } from './subagent-service.js';
import { AgentsRepository } from '../db/repositories/agents.js';
import { OrchestraRepository } from '../db/repositories/orchestra.js';

const log = getLog('OrchestraEngine');

// ============================================================================
// In-Memory Execution State
// ============================================================================

interface ManagedExecution {
  execution: OrchestraExecution;
  /** Map taskId → subagentId */
  taskSubagents: Map<string, string>;
  /** Cancelled flag */
  cancelled: boolean;
}

// ============================================================================
// Engine
// ============================================================================

export class OrchestraEngine {
  private executions = new Map<string, ManagedExecution>();

  // --------------------------------------------------------------------------
  // Delegate to Named Agent (single task, no plan)
  // --------------------------------------------------------------------------

  async delegateToAgent(
    input: DelegateToAgentInput,
    parentId: string,
    userId: string
  ): Promise<DelegationResult> {
    const agentsRepo = new AgentsRepository();
    const agent = await agentsRepo.getByName(input.agentName);

    if (!agent) {
      return {
        subagentId: '',
        agentName: input.agentName,
        running: false,
        error: `Agent "${input.agentName}" not found. Use list_subagents or check available agents.`,
        toolsUsed: [],
      };
    }

    // Spawn via SubagentManager with agent's config
    const svc = getSubagentService();
    const session = await svc.spawn({
      parentId,
      parentType: 'chat',
      userId,
      name: `delegate:${agent.name}`,
      task: buildDelegationPrompt(agent.name, agent.systemPrompt ?? '', input.task),
      context: input.context,
      provider: extractPreferred(agent.config, 'preferredProvider'),
      model: extractPreferred(agent.config, 'preferredModel'),
    });

    // If waitForResult, poll until complete
    if (input.waitForResult !== false) {
      const result = await this.waitForSubagent(session.id, userId, 120_000);
      return {
        subagentId: session.id,
        agentName: agent.name,
        running: false,
        result: result?.result ?? undefined,
        toolsUsed: result?.toolCalls.map((tc) => tc.tool) ?? [],
        durationMs: result?.durationMs ?? undefined,
        error: result?.error ?? undefined,
      };
    }

    return {
      subagentId: session.id,
      agentName: agent.name,
      running: true,
      toolsUsed: [],
    };
  }

  // --------------------------------------------------------------------------
  // Execute Orchestra Plan
  // --------------------------------------------------------------------------

  async executePlan(
    plan: OrchestraPlan,
    parentId: string,
    userId: string
  ): Promise<OrchestraExecution> {
    // Validate plan
    if (plan.tasks.length === 0) {
      throw new Error('Orchestra plan has no tasks');
    }
    if (plan.tasks.length > DEFAULT_ORCHESTRA_LIMITS.maxTasks) {
      throw new Error(
        `Plan exceeds maximum tasks (${plan.tasks.length} > ${DEFAULT_ORCHESTRA_LIMITS.maxTasks})`
      );
    }

    const executionId = generateId('orch');
    const now = new Date();

    const execution: OrchestraExecution = {
      id: executionId,
      parentId,
      userId,
      plan,
      state: 'running',
      taskResults: [],
      totalDurationMs: 0,
      startedAt: now,
      completedAt: null,
    };

    const managed: ManagedExecution = {
      execution,
      taskSubagents: new Map(),
      cancelled: false,
    };

    this.executions.set(executionId, managed);

    // Emit started event
    emitEvent('orchestra.started', {
      executionId,
      parentId,
      userId,
      description: plan.description,
      strategy: plan.strategy,
      taskCount: plan.tasks.length,
    });

    const startTime = Date.now();
    const maxDuration = plan.maxDuration || DEFAULT_ORCHESTRA_LIMITS.maxDurationMs;

    try {
      switch (plan.strategy) {
        case 'sequential':
          await this.executeSequential(managed, userId);
          break;
        case 'parallel':
          await this.executeParallel(managed, userId);
          break;
        case 'dag':
          await this.executeDag(managed, userId, maxDuration);
          break;
        default:
          throw new Error(`Unknown strategy: ${plan.strategy}`);
      }

      execution.state = managed.cancelled ? 'cancelled' : 'completed';
    } catch (error) {
      execution.state = 'failed';
      execution.error = getErrorMessage(error);
    }

    execution.totalDurationMs = Date.now() - startTime;
    execution.completedAt = new Date();

    // Emit completed event
    const succeeded = execution.taskResults.filter((r) => r.success).length;
    const failed = execution.taskResults.filter((r) => !r.success).length;

    emitEvent('orchestra.completed', {
      executionId,
      parentId,
      userId,
      state: execution.state,
      totalDurationMs: execution.totalDurationMs,
      tasksSucceeded: succeeded,
      tasksFailed: failed,
    });

    // Persist to DB (fire-and-forget)
    this.persistExecution(execution).catch((err) =>
      log.error(`Failed to persist orchestra execution: ${getErrorMessage(err)}`)
    );

    return execution;
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  getExecution(executionId: string): OrchestraExecution | null {
    return this.executions.get(executionId)?.execution ?? null;
  }

  listByParent(parentId: string): OrchestraExecution[] {
    const results: OrchestraExecution[] = [];
    for (const managed of this.executions.values()) {
      if (managed.execution.parentId === parentId) {
        results.push(managed.execution);
      }
    }
    return results;
  }

  cancel(executionId: string): void {
    const managed = this.executions.get(executionId);
    if (!managed) return;

    managed.cancelled = true;

    // Cancel all running subagents
    const svc = getSubagentService();
    const userId = managed.execution.userId;
    for (const subId of managed.taskSubagents.values()) {
      try {
        svc.cancel(subId, userId);
      } catch {
        // Best-effort
      }
    }
  }

  async getHistory(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: OrchestraExecution[]; total: number }> {
    const repo = new OrchestraRepository();
    return repo.getHistory(userId, limit, offset);
  }

  /** Remove completed executions from memory (older than ttlMs) */
  cleanup(ttlMs = 30 * 60_000): void {
    const cutoff = Date.now() - ttlMs;
    for (const [id, managed] of this.executions.entries()) {
      const exec = managed.execution;
      if (exec.completedAt && exec.completedAt.getTime() < cutoff) {
        this.executions.delete(id);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Strategy Implementations
  // --------------------------------------------------------------------------

  private async executeSequential(managed: ManagedExecution, userId: string): Promise<void> {
    const { execution } = managed;

    for (const task of execution.plan.tasks) {
      if (managed.cancelled) break;

      const result = await this.executeTask(task, managed, userId);
      execution.taskResults.push(result);

      this.emitTaskComplete(execution, task, result);

      if (!result.success && !task.optional) {
        throw new Error(`Required task "${task.id}" failed: ${result.error}`);
      }
    }
  }

  private async executeParallel(managed: ManagedExecution, userId: string): Promise<void> {
    const { execution } = managed;

    const promises = execution.plan.tasks.map((task) =>
      this.executeTask(task, managed, userId).then((result) => {
        execution.taskResults.push(result);
        this.emitTaskComplete(execution, task, result);
        return result;
      })
    );

    const results = await Promise.allSettled(promises);

    // Check for required task failures
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const task = execution.plan.tasks[i]!;
      if (r.status === 'rejected' && !task.optional) {
        throw new Error(`Required task "${task.id}" failed: ${r.reason}`);
      }
    }
  }

  private async executeDag(
    managed: ManagedExecution,
    userId: string,
    maxDuration: number
  ): Promise<void> {
    const { execution } = managed;
    const tasks = execution.plan.tasks;
    const startTime = Date.now();

    // Build dependency map
    const completed = new Set<string>();
    const running = new Map<string, Promise<OrchestraTaskResult>>();
    const remaining = new Map<string, AgentTask>();
    for (const task of tasks) {
      remaining.set(task.id, task);
    }

    while (remaining.size > 0 || running.size > 0) {
      if (managed.cancelled) break;

      // Check timeout
      if (Date.now() - startTime > maxDuration) {
        execution.state = 'timeout';
        throw new Error(`Orchestra plan timed out after ${maxDuration}ms`);
      }

      // Find ready tasks (all dependencies completed)
      const ready: AgentTask[] = [];
      for (const [taskId, task] of remaining) {
        const deps = task.dependsOn ?? [];
        if (deps.every((d) => completed.has(d))) {
          ready.push(task);
          remaining.delete(taskId);
        }
      }

      // Limit concurrent tasks
      const slotsAvailable = DEFAULT_ORCHESTRA_LIMITS.maxConcurrent - running.size;
      const toStart = ready.slice(0, Math.max(0, slotsAvailable));

      // Start ready tasks
      for (const task of toStart) {
        const promise = this.executeTask(task, managed, userId).then((result) => {
          execution.taskResults.push(result);
          this.emitTaskComplete(execution, task, result);
          return result;
        });
        running.set(task.id, promise);
      }

      // Wait for any task to complete
      if (running.size > 0) {
        const entries = [...running.entries()];
        const settled = await Promise.race(
          entries.map(([id, p]) => p.then((r) => ({ id, result: r })))
        );

        running.delete(settled.id);

        if (settled.result.success) {
          completed.add(settled.id);
        } else {
          const task = tasks.find((t) => t.id === settled.id);
          if (task && !task.optional) {
            throw new Error(`Required task "${settled.id}" failed: ${settled.result.error}`);
          }
          // Optional task failed — mark as completed so dependents can proceed
          completed.add(settled.id);
        }
      }

      // Prevent busy loop when waiting for running tasks
      if (toStart.length === 0 && remaining.size > 0 && running.size > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  // --------------------------------------------------------------------------
  // Task Execution
  // --------------------------------------------------------------------------

  private async executeTask(
    task: AgentTask,
    managed: ManagedExecution,
    userId: string
  ): Promise<OrchestraTaskResult> {
    const { execution } = managed;

    try {
      // Look up the named agent
      const agentsRepo = new AgentsRepository();
      const agent = await agentsRepo.getByName(task.agentName);

      // Build context string from task context + previous results
      const contextParts: string[] = [];
      if (task.context) {
        contextParts.push(JSON.stringify(task.context));
      }

      // Add results from dependency tasks
      if (task.dependsOn && task.dependsOn.length > 0) {
        const depResults = execution.taskResults.filter((r) => task.dependsOn!.includes(r.taskId));
        if (depResults.length > 0) {
          contextParts.push('## Results from previous tasks:');
          for (const dr of depResults) {
            contextParts.push(`### ${dr.agentName} (${dr.taskId}):`);
            contextParts.push(dr.output || '(no output)');
          }
        }
      }

      const svc = getSubagentService();
      const session = await svc.spawn({
        parentId: execution.parentId,
        parentType: 'chat',
        userId,
        name: `orchestra:${task.id}:${task.agentName}`,
        task: agent
          ? buildDelegationPrompt(agent.name, agent.systemPrompt ?? '', task.input)
          : task.input,
        context: contextParts.length > 0 ? contextParts.join('\n\n') : undefined,
        provider: task.provider ?? extractPreferred(agent?.config, 'preferredProvider'),
        model: task.model ?? extractPreferred(agent?.config, 'preferredModel'),
      });

      managed.taskSubagents.set(task.id, session.id);

      // Wait for subagent completion
      const timeout = task.timeout || DEFAULT_ORCHESTRA_LIMITS.maxDurationMs;
      const result = await this.waitForSubagent(session.id, userId, timeout);

      return {
        taskId: task.id,
        agentName: task.agentName,
        subagentId: session.id,
        output: result?.result ?? '',
        toolsUsed: result?.toolCalls.map((tc) => tc.tool) ?? [],
        tokenUsage: result?.tokensUsed ?? { prompt: 0, completion: 0 },
        durationMs: result?.durationMs ?? 0,
        success: result?.state === 'completed',
        error: result?.error ?? undefined,
      };
    } catch (error) {
      return {
        taskId: task.id,
        agentName: task.agentName,
        subagentId: '',
        output: '',
        toolsUsed: [],
        tokenUsage: { prompt: 0, completion: 0 },
        durationMs: 0,
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async waitForSubagent(
    subagentId: string,
    userId: string,
    timeoutMs: number
  ): Promise<SubagentSession | null> {
    const svc = getSubagentService();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const session = svc.getSession(subagentId, userId);
      if (!session) return null;

      if (
        session.state === 'completed' ||
        session.state === 'failed' ||
        session.state === 'cancelled' ||
        session.state === 'timeout'
      ) {
        return session;
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    // Timeout — cancel and return what we have
    try {
      svc.cancel(subagentId, userId);
    } catch {
      // Best-effort
    }

    return svc.getSession(subagentId, userId);
  }

  private emitTaskComplete(
    execution: OrchestraExecution,
    task: AgentTask,
    result: OrchestraTaskResult
  ): void {
    emitEvent('orchestra.task.complete', {
      executionId: execution.id,
      taskId: task.id,
      agentName: task.agentName,
      success: result.success,
      durationMs: result.durationMs,
      tasksCompleted: execution.taskResults.length,
      tasksTotal: execution.plan.tasks.length,
    });
  }

  private async persistExecution(execution: OrchestraExecution): Promise<void> {
    const repo = new OrchestraRepository();
    await repo.saveExecution(execution);
  }
}

// ============================================================================
// Module-level helpers
// ============================================================================

function buildDelegationPrompt(agentName: string, agentSystemPrompt: string, task: string): string {
  const parts: string[] = [];

  if (agentSystemPrompt) {
    parts.push(agentSystemPrompt);
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  parts.push(`You are acting as the "${agentName}" agent.`);
  parts.push('A parent orchestrator has delegated the following task to you.');
  parts.push('Complete it thoroughly using your specialized expertise.');
  parts.push('');
  parts.push(task);

  return parts.join('\n');
}

function extractPreferred(
  config: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!config) return undefined;
  const value = config[key];
  return typeof value === 'string' && value !== 'default' ? value : undefined;
}

function emitEvent(
  type: keyof import('@ownpilot/core').EventMap,
  data: Record<string, unknown>
): void {
  try {
    const events = getEventSystem();
    events.emit(type, 'orchestra-engine', data);
  } catch {
    // EventSystem may not be initialized in tests
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _engine: OrchestraEngine | null = null;

export function getOrchestraEngine(): OrchestraEngine {
  if (!_engine) {
    _engine = new OrchestraEngine();
  }
  return _engine;
}

/** Reset for testing */
export function resetOrchestraEngine(): void {
  _engine = null;
}
