/**
 * Heartbeat Runner
 *
 * Executes heartbeat cycles for agents with souls.
 * Triggered by the existing cron/trigger system.
 * Handles task filtering, execution, output routing, and budget enforcement.
 */

import type { AgentSoul, HeartbeatTask, HeartbeatResult, HeartbeatTaskResult } from './types.js';
import type { IAgentCommunicationBus } from './communication.js';
import type { ISoulRepository, IHeartbeatLogRepository } from './evolution.js';
import type { BudgetTracker } from './budget-tracker.js';
import type { Result } from '../../types/result.js';
import { getLog } from '../../services/get-log.js';

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
  constructor(
    private agentEngine: IHeartbeatAgentEngine,
    private soulRepo: ISoulRepository,
    private communicationBus: IAgentCommunicationBus,
    private heartbeatLogRepo: IHeartbeatLogRepository,
    private budgetTracker: BudgetTracker,
    private eventBus?: IHeartbeatEventBus
  ) {}

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
      log.warn(`[Heartbeat ${agentId}] Skipped: daily budget exceeded`);
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
      return { ok: false, error: new Error('Daily budget exceeded') };
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

    log.info(`[Heartbeat ${agentId}] ${tasksToRun.length} task(s) due, ${skippedCount} skipped by schedule`, {
      tasks: tasksToRun.map((t) => t.name),
    });

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
        });
        continue;
      }

      log.info(`[Heartbeat ${agentId}] Running task "${task.name}" (${task.id})`);
      const taskResult = await this.executeTask(agentId, soul, task);
      result.tasks.push(taskResult);
      result.totalTokens.input += taskResult.tokenUsage.input;
      result.totalTokens.output += taskResult.tokenUsage.output;
      result.totalCost += taskResult.cost;

      if (taskResult.status === 'success') {
        log.info(`[Heartbeat ${agentId}] Task "${task.name}" succeeded in ${taskResult.durationMs}ms`, {
          cost: taskResult.cost,
          outputLength: taskResult.output?.length ?? 0,
        });
      } else {
        log.warn(`[Heartbeat ${agentId}] Task "${task.name}" ${taskResult.status}: ${taskResult.error}`);
      }

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
      log.warn(`[Heartbeat ${agentId}] AUTO-PAUSED: consecutive failure threshold (${soul.autonomy.pauseOnConsecutiveErrors}) reached`);
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
    });

    // AGENT-HIGH-003: Cost is recorded in heartbeat_log above.
    // BudgetTracker reads from heartbeat_log, so no need to record separately.
    // await this.budgetTracker.recordSpend(agentId, result.totalCost);

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
   * Execute a single heartbeat task.
   */
  private async executeTask(
    agentId: string,
    soul: AgentSoul,
    task: HeartbeatTask
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

      const responsePromise = this.agentEngine.processMessage({
        agentId,
        message: taskPrompt,
        context: {
          isHeartbeat: true,
          heartbeatTaskId: task.id,
          allowedTools: task.tools.length > 0 ? task.tools : undefined,
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
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const response = await Promise.race([responsePromise, timeoutPromise]);

      return {
        taskId: task.id,
        taskName: task.name,
        status: 'success',
        output: response.content,
        tokenUsage: response.tokenUsage || { input: 0, output: 0 },
        cost: response.cost || 0,
        durationMs: Date.now() - startTime,
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
      };
    }
  }

  /**
   * Filter tasks that should run this heartbeat cycle.
   * When force=true, all tasks run regardless of schedule (used for manual test runs).
   */
  private filterTasksToRun(checklist: HeartbeatTask[], force = false): HeartbeatTask[] {
    if (force) return checklist;
    const now = new Date();
    return checklist.filter((task) => {
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
    });
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
        `${soul.identity.name} ${soul.identity.emoji} paused — daily budget ($${soul.autonomy.maxCostPerDay}) exceeded.`
      );
    }
  }
}
