/**
 * Heartbeat Runner
 *
 * Executes heartbeat cycles for agents with souls.
 * Triggered by the existing cron/trigger system.
 * Handles task filtering, execution, output routing, and budget enforcement.
 */

import type {
  AgentSoul,
  HeartbeatTask,
  HeartbeatResult,
  HeartbeatTaskResult,
  TaskRetryBudget,
} from './types.js';
import type { IAgentCommunicationBus } from './communication.js';
import { SoulEvolutionEngine } from './evolution.js';
import type { ISoulRepository, IHeartbeatLogRepository } from './evolution.js';
import type { BudgetTracker } from './budget-tracker.js';
import type { Result } from '../../types/result.js';
import { getLog } from '../../services/get-log.js';
import { HeartbeatCircuitBreaker } from './heartbeat-circuit-breaker.js';
import { HeartbeatMetricsCollector } from './heartbeat-metrics.js';
import { BudgetForecaster } from './budget-forecast.js';
import { calculateBackoffDelay } from '../../utils/safe-value.js';
import { silentCatch } from '../../utils/ignore-error.js';

const log = getLog('HeartbeatRunner');

// ============================================================
// Agent engine interface (minimal subset)
// ============================================================

export interface IHeartbeatAgentEngine {
  processMessage(request: {
    agentId: string;
    message: string;
    context?: Record<string, unknown>;
  }): Promise<{
    content: string;
    tokenUsage?: { input: number; output: number };
    cost?: number;
    /**
     * Lean records of every tool the engine called while executing this
     * message. Used to populate HeartbeatLogEntry.toolCalls for operator
     * debugging. Each record is bounded in size (truncated args/errors).
     */
    toolCalls?: import('./types.js').HeartbeatToolCallRecord[];
  }>;

  saveMemory?(agentId: string, content: string, source: string): Promise<void>;
  sendToChannel?(channel: string, message: string, chatId?: string): Promise<void>;
  createNote?(note: { content: string; category: string; source: string }): Promise<void>;
}

export interface IHeartbeatEventBus {
  emit(event: string, payload: unknown): void;
}

// ============================================================
// Heartbeat Runner
// ============================================================

export class HeartbeatRunner {
  private circuitBreaker: HeartbeatCircuitBreaker;
  private metricsCollector: HeartbeatMetricsCollector;
  private budgetForecaster: BudgetForecaster | null = null;

  constructor(
    private agentEngine: IHeartbeatAgentEngine,
    private soulRepo: ISoulRepository,
    private communicationBus: IAgentCommunicationBus,
    private heartbeatLogRepo: IHeartbeatLogRepository,
    private budgetTracker: BudgetTracker,
    private eventBus?: IHeartbeatEventBus,
    circuitBreaker?: HeartbeatCircuitBreaker,
    metricsCollector?: HeartbeatMetricsCollector,
    budgetForecaster?: BudgetForecaster
  ) {
    this.circuitBreaker = circuitBreaker ?? new HeartbeatCircuitBreaker();
    this.metricsCollector = metricsCollector ?? new HeartbeatMetricsCollector();
    if (budgetForecaster) {
      this.budgetForecaster = budgetForecaster;
    }
  }

  /**
   * Run a full heartbeat cycle for the given agent.
   * @param force - When true, bypasses task scheduling and runs all tasks immediately (used for manual test runs)
   */
  async runHeartbeat(agentId: string, force = false): Promise<Result<HeartbeatResult, Error>> {
    const soul = await this.soulRepo.getByAgentId(agentId);
    if (!soul || !soul.heartbeat.enabled) {
      return {
        ok: false,
        error: new Error('Soul not found or heartbeat disabled'),
      };
    }

    log.info(`[Heartbeat ${agentId}] Starting cycle${force ? ' (forced)' : ''}`, {
      soulName: soul.identity.name,
      version: soul.evolution.version,
      taskCount: soul.heartbeat.checklist.length,
    });

    // Initialize budget forecaster on first use
    if (!this.budgetForecaster) {
      this.budgetForecaster = new BudgetForecaster(soul.autonomy);
    }

    // Circuit breaker — skip entire cycle if open
    if (this.circuitBreaker.shouldSkipCycle()) {
      log.info(`[Heartbeat ${agentId}] Skipped: circuit open`);
      const circuitSnapshot = this.circuitBreaker.getSnapshot();
      return {
        ok: true,
        value: {
          agentId,
          soulVersion: soul.evolution.version,
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
          tasks: [],
          skippedReason: 'circuit_open',
          totalTokens: { input: 0, output: 0 },
          totalCost: 0,
          metrics: this.metricsCollector.buildMetrics(circuitSnapshot, [], 0),
        },
      };
    }

    // Quiet hours check (bypassed when force=true for manual test runs)
    if (!force && this.isQuietHours(soul)) {
      log.info(`[Heartbeat ${agentId}] Skipped: quiet hours active`);
      return {
        ok: true,
        value: this.createSkippedResult(agentId, soul, 'quiet_hours'),
      };
    }

    // Budget check
    const budgetOk = await this.budgetTracker.checkBudget(agentId, soul.autonomy);
    if (!budgetOk) {
      log.warn(`[Heartbeat ${agentId}] Skipped: budget exceeded (daily or monthly)`);
      await this.handleBudgetExceeded(agentId, soul);
      // Log the skipped run so history is complete
      await this.heartbeatLogRepo.create({
        agentId,
        soulVersion: soul.evolution.version,
        tasksRun: [],
        tasksSkipped: soul.heartbeat.checklist.map((t) => ({
          id: t.id,
          reason: 'budget_exceeded',
        })),
        tasksFailed: [],
        durationMs: 0,
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
      });
      return { ok: false, error: new Error('Budget exceeded') };
    }

    const result: HeartbeatResult = {
      agentId,
      soulVersion: soul.evolution.version,
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      tasks: [],
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };

    // Filter tasks that should run this cycle (force=true runs all tasks regardless of schedule)
    const tasksToRun = this.filterTasksToRun(soul.heartbeat.checklist, force);
    const skippedCount = soul.heartbeat.checklist.length - tasksToRun.length;

    log.info(
      `[Heartbeat ${agentId}] ${tasksToRun.length} task(s) due, ${skippedCount} skipped by schedule`,
      {
        tasks: tasksToRun.map((t) => t.name),
      }
    );

    // Keep an in-memory copy of the checklist to batch all status updates in one DB write.
    const updatedChecklist = soul.heartbeat.checklist.map((t) => ({ ...t }));
    let pauseTriggered = false;

    for (const task of tasksToRun) {
      // Per-cycle budget check
      if (result.totalCost >= soul.autonomy.maxCostPerCycle) {
        result.tasks.push({
          taskId: task.id,
          taskName: task.name,
          status: 'skipped',
          error: 'Cycle budget exceeded',
          tokenUsage: { input: 0, output: 0 },
          cost: 0,
          durationMs: 0,
          attemptNumber: 0,
        });
        continue;
      }

      log.info(`[Heartbeat ${agentId}] Running task "${task.name}" (${task.id})`);
      const taskResult = await this.executeTaskWithRetry(agentId, soul, task);
      result.tasks.push(taskResult);
      result.totalTokens.input += taskResult.tokenUsage.input;
      result.totalTokens.output += taskResult.tokenUsage.output;
      result.totalCost += taskResult.cost;

      // Record circuit breaker success/failure
      if (taskResult.status === 'success') {
        this.circuitBreaker.recordSuccess();
        log.info(
          `[Heartbeat ${agentId}] Task "${task.name}" succeeded in ${taskResult.durationMs}ms`,
          {
            cost: taskResult.cost,
            outputLength: taskResult.output?.length ?? 0,
          }
        );
      } else {
        this.circuitBreaker.recordFailure();
        log.warn(
          `[Heartbeat ${agentId}] Task "${task.name}" ${taskResult.status}: ${taskResult.error}`
        );
      }

      // Record metrics
      this.metricsCollector.recordTask(taskResult);

      // Route output
      if (taskResult.status === 'success' && task.outputTo) {
        log.info(`[Heartbeat ${agentId}] Routing output to ${task.outputTo.type}`);
        await this.routeOutput(agentId, soul, task, taskResult.output || '');
      }

      // Update in-memory checklist (batched — no per-task DB write)
      const newConsecutiveFailures =
        taskResult.status === 'failure' ? (task.consecutiveFailures || 0) + 1 : 0;
      const idx = updatedChecklist.findIndex((t) => t.id === task.id);
      if (idx !== -1) {
        const existing = updatedChecklist[idx];
        updatedChecklist[idx] = Object.assign({}, existing, {
          lastRunAt: new Date(),
          lastResult: taskResult.status as 'success' | 'failure' | 'skipped',
          lastError: taskResult.error,
          consecutiveFailures: newConsecutiveFailures,
        });
      }

      // Enforce pauseOnConsecutiveErrors threshold
      if (
        taskResult.status === 'failure' &&
        soul.autonomy.pauseOnConsecutiveErrors > 0 &&
        newConsecutiveFailures >= soul.autonomy.pauseOnConsecutiveErrors
      ) {
        pauseTriggered = true;
      }
    }

    // Persist all checklist updates in a single DB write (fixes N+1 per-task SELECT+UPDATE)
    await this.soulRepo.updateHeartbeatChecklist(agentId, updatedChecklist);

    // Auto-pause agent if any task crossed the consecutiveFailures threshold
    if (pauseTriggered) {
      log.warn(
        `[Heartbeat ${agentId}] AUTO-PAUSED: consecutive failure threshold (${soul.autonomy.pauseOnConsecutiveErrors}) reached`
      );
      await this.soulRepo.setHeartbeatEnabled(agentId, false);
      this.eventBus?.emit('soul.heartbeat.auto_paused', {
        agentId,
        reason: 'consecutive_failures',
        threshold: soul.autonomy.pauseOnConsecutiveErrors,
      });
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - result.startedAt.getTime();

    const succeeded = result.tasks.filter((t) => t.status === 'success').length;
    const failed = result.tasks.filter((t) => t.status === 'failure').length;
    const skipped = result.tasks.filter((t) => t.status === 'skipped').length;

    log.info(`[Heartbeat ${agentId}] Cycle complete in ${result.durationMs}ms`, {
      succeeded,
      failed,
      skipped,
      totalCost: result.totalCost,
      tokens: result.totalTokens,
    });

    // Flatten per-task tool calls into a single audit list tagged with taskId
    // so operators can group by task or query across the whole cycle.
    const aggregatedToolCalls = result.tasks.flatMap((t) =>
      (t.toolCalls ?? []).map((c) => ({ ...c, taskId: t.taskId }))
    );

    // Log to DB
    await this.heartbeatLogRepo.create({
      agentId,
      soulVersion: soul.evolution.version,
      tasksRun: result.tasks
        .filter((t) => t.status === 'success')
        .map((t) => ({ id: t.taskId, name: t.taskName })),
      tasksSkipped: result.tasks
        .filter((t) => t.status === 'skipped')
        .map((t) => ({ id: t.taskId, reason: t.error })),
      tasksFailed: result.tasks
        .filter((t) => t.status === 'failure')
        .map((t) => ({ id: t.taskId, error: t.error })),
      durationMs: result.durationMs,
      tokenUsage: result.totalTokens,
      cost: result.totalCost,
      toolCalls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
    });

    // AGENT-HIGH-003: Cost is recorded in heartbeat_log above.
    // BudgetTracker reads from heartbeat_log, so no need to record separately.
    // await this.budgetTracker.recordSpend(agentId, result.totalCost);

    // Claw mode: post-cycle self-reflection
    if (soul.autonomy.level === 5 && soul.autonomy.clawMode?.selfImprovement !== 'disabled') {
      await this.runClawReflection(agentId, soul);
    }

    // Build and emit heartbeat metrics
    const circuitSnapshot = this.circuitBreaker.getSnapshot();
    const metrics = this.metricsCollector.buildMetrics(
      circuitSnapshot,
      result.tasks,
      result.totalCost
    );
    result.metrics = metrics;
    this.eventBus?.emit('heartbeat.metrics', {
      agentId,
      metrics,
      timestamp: new Date().toISOString(),
    });

    // Budget forecast + warning event
    if (this.budgetForecaster) {
      const dailySpend = await this.budgetTracker.getDailySpend(agentId);
      const forecast = this.budgetForecaster.buildForecast(dailySpend, result.totalCost);
      result.budgetForecast = forecast;
      if (forecast.warningIssued) {
        this.eventBus?.emit('heartbeat.budget.warning', {
          agentId,
          forecast,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Emit event
    this.eventBus?.emit('soul.heartbeat.completed', {
      agentId,
      soulVersion: soul.evolution.version,
      tasksRun: result.tasks.length,
      tasksFailed: result.tasks.filter((t) => t.status === 'failure').length,
      cost: result.totalCost,
    });

    return { ok: true, value: result };
  }

  /**
   * Execute a single heartbeat task with per-task retry support.
   * Uses exponential backoff with jitter between retries.
   */
  private async executeTaskWithRetry(
    agentId: string,
    soul: AgentSoul,
    task: HeartbeatTask
  ): Promise<HeartbeatTaskResult> {
    const retryBudget: TaskRetryBudget = {
      maxRetries: task.retryBudget?.maxRetries ?? 3,
      retryDelayMs: task.retryBudget?.retryDelayMs ?? 5_000,
      backoffMultiplier: task.retryBudget?.backoffMultiplier ?? 2.0,
      maxRetryDelayMs: task.retryBudget?.maxRetryDelayMs ?? 120_000,
    };

    let attemptNumber = 0;
    let lastError: string | undefined;

    while (attemptNumber <= retryBudget.maxRetries) {
      const taskResult = await this.executeTaskAttempt(agentId, soul, task, attemptNumber);
      taskResult.attemptNumber = attemptNumber;

      if (taskResult.status === 'success' || attemptNumber >= retryBudget.maxRetries) {
        return taskResult;
      }

      // Failure with retries remaining — compute backoff delay
      const delay = calculateBackoffDelay(attemptNumber, {
        baseDelayMs: retryBudget.retryDelayMs,
        multiplier: retryBudget.backoffMultiplier,
        maxDelayMs: retryBudget.maxRetryDelayMs,
      });

      lastError = taskResult.error;
      taskResult.nextRetryDelayMs = delay;

      log.info(
        `[Heartbeat ${agentId}] Task "${task.name}" failed (attempt ${attemptNumber + 1}/${retryBudget.maxRetries + 1}), retrying in ${delay}ms: ${taskResult.error}`
      );

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      attemptNumber++;
    }

    // Should not reach here, but typed for safety
    return {
      taskId: task.id,
      taskName: task.name,
      status: 'failure',
      error: lastError ?? 'Max retries exceeded',
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
      durationMs: 0,
      attemptNumber,
    };
  }

  /**
   * Execute a single heartbeat task attempt (no retry logic — handled by executeTaskWithRetry).
   */
  private async executeTaskAttempt(
    agentId: string,
    soul: AgentSoul,
    task: HeartbeatTask,
    _attemptNumber: number
  ): Promise<HeartbeatTaskResult> {
    const startTime = Date.now();
    const timeoutMs = soul.heartbeat.maxDurationMs ?? 120_000;
    try {
      const taskPrompt =
        task.prompt ||
        `Execute the following heartbeat task:
**${task.name}**: ${task.description}
${task.tools.length ? `Available tools: ${task.tools.join(', ')}` : ''}
Be concise and focused. Report your findings clearly.`.trim();

      const isClawMode = soul.autonomy.level === 5 && soul.autonomy.clawMode?.enabled === true;

      const responsePromise = this.agentEngine.processMessage({
        agentId,
        message: taskPrompt,
        context: {
          isHeartbeat: true,
          heartbeatTaskId: task.id,
          // Claw mode: all tools available (task.tools becomes advisory, not enforced)
          allowedTools: isClawMode ? undefined : task.tools.length > 0 ? task.tools : undefined,
          // Pass soul's provider preference so the engine can use it
          provider: soul.provider?.providerId,
          model: soul.provider?.modelId,
          fallbackProvider: soul.provider?.fallbackProviderId,
          fallbackModel: soul.provider?.fallbackModelId,
          // Pass skill access config so engine can enforce per-soul extension filtering
          skillAccessAllowed: soul.skillAccess?.allowed,
          skillAccessBlocked: soul.skillAccess?.blocked,
          // Pass crew ID so the service layer can inject crew context and communication
          // tools can resolve the correct soul identity via AsyncLocalStorage
          crewId: soul.relationships?.crewId,
          // Pass soul's workspace ID so the service layer can scope file-system
          // tool access to the soul's session workspace via ExecContext.
          // Without this, heartbeats inherit the chat agent's process.cwd().
          workspaceId: soul.workspaceId,
          // Opt-in auto-recall: when true, the service prepends a
          // "Relevant memories" block (hybrid vector+FTS) before the task
          // prompt — same affordance chat gets via context-injection middleware.
          injectRelevantMemories: soul.heartbeat.injectRelevantMemories === true,
          // Claw mode flags
          clawMode: isClawMode,
          clawCanManageAgents: soul.autonomy.clawMode?.canManageAgents,
          clawCanCreateTools: soul.autonomy.clawMode?.canCreateTools,
        },
      });

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timeoutHandle = null;
          reject(new Error(`Task timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      // Race-loser suppression. timeoutPromise only rejects when the timer
      // fires; if responsePromise wins, finally clearTimeout()s it before
      // it can reject — so timeoutPromise needs no catch. But if the timer
      // wins, responsePromise is still in-flight and may later reject
      // (e.g. provider returns an error after the deadline). Attach a no-op
      // catch so that late rejection stays bounded here and doesn't bubble
      // up as an unhandledRejection.
      responsePromise.catch(silentCatch('heartbeat.response.raceLoser'));

      let response;
      try {
        response = await Promise.race([responsePromise, timeoutPromise]);
      } finally {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      }

      return {
        taskId: task.id,
        taskName: task.name,
        status: 'success',
        output: response.content,
        tokenUsage: response.tokenUsage || { input: 0, output: 0 },
        cost: response.cost || 0,
        durationMs: Date.now() - startTime,
        attemptNumber: 0,
        toolCalls: response.toolCalls,
      };
    } catch (error) {
      return {
        taskId: task.id,
        taskName: task.name,
        status: 'failure',
        error: error instanceof Error ? error.message : String(error),
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
        durationMs: Date.now() - startTime,
        attemptNumber: 0,
      };
    }
  }

  /**
   * Filter and sort tasks that should run this heartbeat cycle.
   * When force=true, all tasks run regardless of schedule (used for manual test runs).
   *
   * Sort order:
   * 1. 'every' tasks always first (within their schedule group)
   * 2. Then by numeric priority (1=highest)
   * 3. Then by staleness (most stale first)
   * 4. Then by last run time (oldest first)
   */
  private filterTasksToRun(checklist: HeartbeatTask[], force = false): HeartbeatTask[] {
    if (force) return checklist;
    const now = new Date();

    type ScoredTask = { task: HeartbeatTask; sortKey: number; isEvery: boolean };

    const scored: ScoredTask[] = checklist
      .filter((task) => {
        if (task.schedule === 'every') return true;

        if (task.schedule === 'daily' && task.dailyAt) {
          const [h, m] = task.dailyAt.split(':').map(Number);
          const todayTarget = new Date(now);
          todayTarget.setHours(h!, m ?? 0, 0, 0);
          if ((!task.lastRunAt || task.lastRunAt < todayTarget) && now >= todayTarget) {
            return true;
          }
          return false;
        }

        if (task.schedule === 'weekly' && task.weeklyOn !== undefined) {
          if (now.getDay() === task.weeklyOn) {
            if (!task.lastRunAt || this.daysSince(task.lastRunAt) >= 6) return true;
          }
          return false;
        }

        // Staleness — force re-run if stale
        if (task.lastRunAt && task.stalenessHours > 0) {
          const hoursSince = (now.getTime() - task.lastRunAt.getTime()) / (1000 * 60 * 60);
          if (hoursSince > task.stalenessHours) return true;
        }

        return false;
      })
      .map((task) => {
        const isEvery = task.schedule === 'every';
        const priority = (task.numericPriority ?? 3) as number;
        const stalenessMs = task.lastRunAt ? now.getTime() - task.lastRunAt.getTime() : Infinity;
        const lastRun = task.lastRunAt?.getTime() ?? 0;
        // Combine: isEvery flag + priority + staleness + lastRun
        // isEvery=0 sorts before isEvery=1; lower sortKey = higher priority/more stale
        const sortKey =
          priority * 1_000_000_000 +
          Math.min(99999, Math.floor(stalenessMs / 1000)) * 1_000 +
          lastRun;
        return { task, sortKey, isEvery };
      });

    return scored
      .sort((a, b) => {
        if (a.isEvery !== b.isEvery) return a.isEvery ? -1 : 1;
        return a.sortKey - b.sortKey;
      })
      .map((s) => s.task);
  }

  /**
   * Route task output to its configured destination.
   */
  private async routeOutput(
    agentId: string,
    soul: AgentSoul,
    task: HeartbeatTask,
    output: string
  ): Promise<void> {
    if (!task.outputTo) return;

    switch (task.outputTo.type) {
      case 'memory':
        await this.agentEngine.saveMemory?.(agentId, output, 'heartbeat');
        break;
      case 'inbox': {
        const targetAgentId = task.outputTo.agentId;
        if (!targetAgentId) {
          log.warn(`Task ${task.id} outputTo.inbox missing agentId — skipping output routing`);
          break;
        }
        await this.communicationBus.send({
          from: agentId,
          to: targetAgentId,
          type: 'task_result',
          subject: `[Heartbeat] ${task.name}`,
          content: output,
          priority: task.priority === 'critical' ? 'urgent' : 'normal',
          requiresResponse: false,
        });
        break;
      }
      case 'channel':
        await this.agentEngine.sendToChannel?.(task.outputTo.channel, output, task.outputTo.chatId);
        break;
      case 'note':
        await this.agentEngine.createNote?.({
          content: output,
          category: task.outputTo.category || 'heartbeat',
          source: `${soul.identity.name} heartbeat`,
        });
        break;
      case 'broadcast':
        await this.communicationBus.broadcast(task.outputTo.crewId, {
          from: agentId,
          type: 'knowledge_share',
          subject: `[${soul.identity.name}] ${task.name}`,
          content: output,
          priority: 'normal',
          requiresResponse: false,
        });
        break;
    }
  }

  private isQuietHours(soul: AgentSoul): boolean {
    if (!soul.heartbeat.quietHours) return false;

    const { start, end, timezone } = soul.heartbeat.quietHours;
    const now = new Date();

    // Get current time as total minutes in the configured timezone.
    // Use Intl.DateTimeFormat with hourCycle h23 to guarantee 0-23 range
    // (avoids toLocaleString returning "24:00" for midnight on some V8/ICU builds).
    let currentTotalMinutes: number;
    if (timezone) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const parts = fmt.formatToParts(now);
      const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
      const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
      currentTotalMinutes = h * 60 + m;
    } else {
      currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    }

    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startTotal = (startH ?? 0) * 60 + (startM ?? 0);
    const endTotal = (endH ?? 0) * 60 + (endM ?? 0);

    if (startTotal > endTotal) {
      // Spanning midnight (e.g., 22:30 - 06:00)
      return currentTotalMinutes >= startTotal || currentTotalMinutes < endTotal;
    }
    return currentTotalMinutes >= startTotal && currentTotalMinutes < endTotal;
  }

  private daysSince(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  }

  private createSkippedResult(agentId: string, soul: AgentSoul, reason: string): HeartbeatResult {
    return {
      agentId,
      soulVersion: soul.evolution.version,
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      tasks: [],
      skippedReason: reason,
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };
  }

  private async handleBudgetExceeded(agentId: string, soul: AgentSoul): Promise<void> {
    if (soul.autonomy.pauseOnBudgetExceeded) {
      await this.soulRepo.setHeartbeatEnabled(agentId, false);
    }
    if (soul.autonomy.notifyUserOnPause) {
      await this.agentEngine.sendToChannel?.(
        'telegram',
        `${soul.identity.name} ${soul.identity.emoji} paused — budget exceeded ` +
          `(daily $${soul.autonomy.maxCostPerDay} / monthly $${soul.autonomy.maxCostPerMonth}).`
      );
    }
  }

  /**
   * Claw mode post-cycle self-reflection.
   * Uses the existing SoulEvolutionEngine.selfReflect() which handles
   * supervised (suggest only) vs autonomous (auto-apply learnings) modes.
   */
  private async runClawReflection(agentId: string, _soul: AgentSoul): Promise<void> {
    try {
      log.info(`[Heartbeat ${agentId}] Running claw self-reflection`);
      const evolutionEngine = new SoulEvolutionEngine(
        this.soulRepo,
        this.heartbeatLogRepo,
        this.agentEngine
      );
      const { suggestions, applied } = await evolutionEngine.selfReflect(agentId);
      if (suggestions.length > 0) {
        log.info(
          `[Heartbeat ${agentId}] Claw reflection: ${suggestions.length} suggestion(s)${applied ? ' (applied)' : ' (pending review)'}`
        );
      }
    } catch (err) {
      // Self-reflection failure should not break the heartbeat cycle
      log.warn(
        `[Heartbeat ${agentId}] Claw reflection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
