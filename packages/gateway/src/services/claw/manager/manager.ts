/**
 * Claw Manager
 *
 * Singleton that manages all running Claw sessions:
 * - Lifecycle: start, pause, resume, stop
 * - Scheduling: continuous (interval-based) for cyclic mode, one-shot for single-shot
 * - Resource limits: cycles/hour, budget caps, consecutive errors
 * - Escalation: pause on escalation request, resume on approval
 * - Graceful shutdown: persist all sessions, clear timers
 * - Auto-recovery: resume autoStart + interrupted sessions on boot
 *
 * Actual cycle execution is delegated to ClawRunner.
 */

import { getErrorMessage } from '@ownpilot/core/services';
import {
  CLAW_RECENT_FAILURES_MAX,
  CLAW_PLAN_HISTORY_MAX,
  CLAW_NEXT_INTENT_MAX,
} from '@ownpilot/core/services/claw';
import type {
  ClawSession,
  ClawCycleResult,
  ClawEscalation,
  ClawTask,
  ClawPlanHistoryEntry,
} from '@ownpilot/core/services/claw';
import { ClawRunner } from '../runner.js';
import { getClawsRepository } from '../../../db/repositories/claws.js';
import {
  getOrCreateSessionWorkspace,
  updateSessionWorkspaceMeta,
} from '../../../workspace/file-workspace.js';
import { getLog } from '../../log.js';
import { scaffoldClawDir, runRetentionCleanup, ensureConversationRow } from '../manager-helpers.js';
import { safeCost, safeDuration } from '@ownpilot/core/utils';
// Extracted helpers — see manager/ subdirectory
import { emitManagerEvent, broadcastClawUpdate } from './events.js';
// Extracted helpers — see sibling files
import {
  extractSavedTasks,
  extractSavedPlanHistory,
  stripSavedTasks,
} from '../manager-task-plan.js';
import { stringifyToolResult, truncateForFailureLog } from '../manager-failure.js';
import type { ManagedClaw } from '../manager-types.js';
// Extracted scheduling — timer + event management
import {
  scheduleNext as scheduleNextImpl,
  scheduleImmediate as scheduleImmediateImpl,
  clearScheduling as clearSchedulingImpl,
  isSchedulableState as isSchedulableStateImpl,
} from '../manager-scheduling.js';
import type { ExecuteCycleFn } from '../manager-scheduling.js';
import { shouldStop as shouldStopImpl } from '../manager-stop-conditions.js';
import {
  checkBudgetThreshold,
  checkTaskForceBlock,
  checkTaskStallEscalation,
} from '../manager-cycle-ops.js';
import {
  MAX_CONSECUTIVE_ERRORS,
  SESSION_PERSIST_INTERVAL_MS,
  MAX_CONCURRENT_CLAWS,
  CLEANUP_INTERVAL_MS,
  MAX_INBOX_MESSAGES,
  MAX_INBOX_BYTES,
} from './constants.js';

const log = getLog('ClawManager');

export class ClawManager {
  private claws = new Map<string, ManagedClaw>();
  /**
   * Tracks claw IDs whose startClaw() is in progress. Set synchronously at
   * the top of startClaw() before any await, so concurrent invocations for
   * the same id can be rejected immediately instead of racing through
   * setup and double-spawning runners/timers/workspaces.
   */
  private starting = new Set<string>();
  private running = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Bound reference to executeCycle for the scheduling module. Set in the
   * constructor so manager-scheduling.ts can call it without a circular
   * import back to the manager class.
   */
  private executeCycleBound: ExecuteCycleFn;

  /** Callbacks for cycle-ops (escalation/stall detection). */
  private cycleOpsCallbacks: {
    requestEscalation: (clawId: string, escalation: ClawEscalation) => Promise<void>;
    recordPlanHistory: (managed: ManagedClaw, entry: ClawPlanHistoryEntry) => void;
    markDirty: (managed: ManagedClaw) => void;
    emitPlanUpdated: (
      clawId: string,
      managed: ManagedClaw,
      source: 'replace' | 'task',
      taskId?: string
    ) => void;
  };

  constructor() {
    this.executeCycleBound = (clawId: string) => this.executeCycle(clawId);
    this.cycleOpsCallbacks = {
      requestEscalation: (clawId: string, escalation: ClawEscalation) =>
        this.requestEscalation(clawId, escalation),
      recordPlanHistory: (managed: ManagedClaw, entry: ClawPlanHistoryEntry) =>
        this.recordPlanHistory(managed, entry),
      markDirty: (managed: ManagedClaw) => this.markDirty(managed),
      emitPlanUpdated: (
        clawId: string,
        managed: ManagedClaw,
        source: 'replace' | 'task',
        taskId?: string
      ) => this.emitPlanUpdated(clawId, managed, source, taskId),
    };
  }

  /**
   * Boot: resume autoStart claws and interrupted sessions.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const repo = getClawsRepository();

    // Resume interrupted sessions
    try {
      const interrupted = await repo.getInterruptedSessions();
      for (const { config } of interrupted) {
        try {
          await this.startClaw(config.id, config.userId);
          log.info(`Resumed interrupted claw: ${config.name} [${config.id}]`);
        } catch (err) {
          log.error('Failed to resume claw', { clawId: config.id, error: getErrorMessage(err) });
        }
      }
    } catch (err) {
      log.error('Failed to load interrupted sessions', { error: getErrorMessage(err) });
    }

    // Start autoStart claws
    try {
      const autoStartConfigs = await repo.getAutoStartClaws();
      for (const config of autoStartConfigs) {
        if (!this.claws.has(config.id)) {
          try {
            await this.startClaw(config.id, config.userId);
            log.info(`Auto-started claw: ${config.name} [${config.id}]`);
          } catch (err) {
            log.error('Failed to auto-start claw', {
              clawId: config.id,
              error: getErrorMessage(err),
            });
          }
        }
      }
    } catch (err) {
      log.error('Failed to load autoStart claws', { error: getErrorMessage(err) });
    }

    // Run initial cleanup, then schedule daily
    runRetentionCleanup();
    this.cleanupTimer = setInterval(() => runRetentionCleanup(), CLEANUP_INTERVAL_MS);
    // Don't hold the process open just for this cleanup — Node should be free
    // to exit when nothing else is keeping the event loop alive (e.g. tests).
    this.cleanupTimer.unref?.();

    log.info(`Claw Manager started (${this.claws.size} claws running)`);
  }

  /**
   * Graceful shutdown.
   *
   * Operator-initiated process exit (SIGTERM, deploy, restart) must NOT
   * mark running claws as 'stopped' — that would lose resume-on-restart
   * behavior, since getInterruptedSessions only resumes 'running' /
   * 'waiting' / 'starting'. Instead, abort any in-flight cycle so the
   * pipeline cancels cleanly, clear timers + event subscriptions, persist
   * each session in its current state, and let next boot pick them up.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const flushPromises: Promise<void>[] = [];
    for (const [clawId, managed] of this.claws) {
      // Abort in-flight cycle so it stops promptly. The catch path's abort
      // detection will skip its bogus error counting/scheduleNext.
      managed.abortController?.abort();
      // Clear timers + event subscriptions so the process can exit cleanly.
      this.clearScheduling(managed);
      if (managed.persistTimer) {
        clearInterval(managed.persistTimer);
        managed.persistTimer = null;
      }
      // Persist current state (NOT 'stopped') so getInterruptedSessions
      // resumes this claw on next boot.
      flushPromises.push(
        this.persistSession(clawId, managed).catch((err) => {
          log.warn(
            `[${clawId}] Failed to flush session on shutdown: ${err instanceof Error ? err.message : String(err)}`
          );
        })
      );
    }
    await Promise.allSettled(flushPromises);
    this.claws.clear();
    this.starting.clear();

    log.info('Claw Manager stopped');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async startClaw(clawId: string, userId: string): Promise<ClawSession> {
    if (this.claws.has(clawId)) {
      throw new Error(`Claw ${clawId} is already running`);
    }
    // Reject concurrent startClaw() calls for the same clawId. Without this
    // guard, two callers can both pass the has() check and proceed through
    // the awaited setup in parallel, ending with duplicate runners and
    // orphaned timers since map.set is last-write-wins.
    if (this.starting.has(clawId)) {
      throw new Error(`Claw ${clawId} is currently starting`);
    }

    // Enforce concurrent claw limit (count both running and starting)
    if (this.claws.size + this.starting.size >= MAX_CONCURRENT_CLAWS) {
      throw new Error(
        `Maximum concurrent claws (${MAX_CONCURRENT_CLAWS}) reached. Stop some claws before starting new ones.`
      );
    }

    this.starting.add(clawId);
    try {
      return await this.startClawInternal(clawId, userId);
    } finally {
      this.starting.delete(clawId);
    }
  }

  private async startClawInternal(clawId: string, userId: string): Promise<ClawSession> {
    const repo = getClawsRepository();
    const config = await repo.getById(clawId, userId);
    if (!config) throw new Error(`Claw ${clawId} not found`);

    // Ensure workspace exists
    let workspaceId = config.workspaceId;
    if (!workspaceId) {
      const ws = await getOrCreateSessionWorkspace(`claw-${clawId}`, clawId, userId);
      workspaceId = ws.id;
      await repo.update(clawId, userId, { workspaceId });
      config.workspaceId = workspaceId;
      // Backfill userId/agentId into workspace meta if not already set
      updateSessionWorkspaceMeta(ws.id, { userId, agentId: clawId });
    } else {
      // Workspace already exists — backfill userId if missing
      updateSessionWorkspaceMeta(workspaceId, { userId, agentId: clawId });
    }

    // Scaffold .claw/ directory with initial files if not exists
    await scaffoldClawDir(workspaceId, config);

    // Load or create session
    const savedSession = await repo.loadSession(clawId);

    // Extract the structured task plan from persistentContext (where it
    // was tucked under a reserved key by persistSession) so the new typed
    // session field stays in sync across restarts. Plan survives restart
    // because the agent's task list is genuine state, unlike the reflection
    // state which resets per-process for a clean retry.
    const savedTasks = extractSavedTasks(savedSession?.persistentContext);
    const savedPlanHistory = extractSavedPlanHistory(savedSession?.persistentContext);

    const session: ClawSession = savedSession
      ? {
          config,
          state: 'starting',
          cyclesCompleted: savedSession.cyclesCompleted,
          totalToolCalls: savedSession.totalToolCalls,
          totalCostUsd: savedSession.totalCostUsd,
          lastCycleAt: savedSession.lastCycleAt,
          lastCycleDurationMs: savedSession.lastCycleDurationMs,
          lastCycleError: savedSession.lastCycleError,
          startedAt: savedSession.startedAt,
          stoppedAt: null,
          persistentContext: stripSavedTasks(savedSession.persistentContext),
          inbox: savedSession.inbox,
          artifacts: savedSession.artifacts,
          pendingEscalation: savedSession.pendingEscalation,
          // Reflection state is not persisted across restart: a freshly
          // resumed claw deserves a clean shot at retrying. Setting both
          // to zero means the reflection prompt only fires after the
          // claw has actually accumulated failures in *this* session.
          consecutiveErrors: 0,
          recentFailures: [],
          tasks: savedTasks,
          planHistory: savedPlanHistory,
        }
      : {
          config,
          state: 'starting',
          cyclesCompleted: 0,
          totalToolCalls: 0,
          totalCostUsd: 0,
          lastCycleAt: null,
          lastCycleDurationMs: null,
          lastCycleError: null,
          startedAt: new Date(),
          stoppedAt: null,
          persistentContext: {},
          inbox: [],
          artifacts: [],
          pendingEscalation: null,
          consecutiveErrors: 0,
          recentFailures: [],
          tasks: [],
          planHistory: [],
        };

    const runner = new ClawRunner(config);

    const managed: ManagedClaw = {
      session,
      runner,
      timer: null,
      eventSubscriptions: [],
      consecutiveErrors: 0,
      cyclesThisHour: 0,
      hourWindow: Math.floor(Date.now() / 3_600_000),
      persistTimer: null,
      lastCycleToolCalls: 0,
      cycleInProgress: false,
      currentCycleNumber: 0,
      idleCycles: 0,
      abortController: null,
      steerPending: false,
      dirty: true,
      priority: config.priority ?? 3,
      inboxEvictedDuringCycle: 0,
    };

    this.claws.set(clawId, managed);

    // Set initial state based on mode
    session.state = config.mode === 'event' ? 'waiting' : 'running';

    // Persist session
    await this.persistSession(clawId, managed);

    // Emit start event
    this.emitEvent('claw.started', { clawId, userId, name: config.name });

    // Start periodic persist timer — skips no-op writes when no mutations
    // have happened since the last persist (e.g. idle event-mode claws).
    managed.persistTimer = setInterval(() => {
      if (!managed.dirty) return;
      this.persistSession(clawId, managed).catch((err) => {
        log.warn(`Failed to persist session: ${getErrorMessage(err)}`);
      });
    }, SESSION_PERSIST_INTERVAL_MS);
    // unref so a stuck persistTimer never blocks process exit — explicit stop
    // paths (stopClaw, shutdown) still clearInterval for correctness.
    managed.persistTimer.unref?.();

    // Ensure conversation row exists so Chat tab works
    ensureConversationRow(clawId, config.userId, config.name).catch((err) => {
      log.warn(`[${clawId}] Failed to create conversation row: ${getErrorMessage(err)}`);
    });

    // Schedule first cycle based on mode
    if (config.mode === 'single-shot') {
      // Await so callers (claw_spawn_subclaw) get real output back
      await this.executeCycle(clawId);
      await this.stopClawInternal(clawId, managed, 'completed');
    } else {
      this.scheduleNext(clawId, managed);
    }

    return session;
  }

  /**
   * Operator-side plan mutations. Mirror the tool path so the UI can
   * replace the plan or tweak a single task without going through the
   * agent. Returns the updated tasks (or throws on validation failure) so
   * the route layer can surface errors to the user.
   *
   * Both methods flush the session immediately because plan edits are
   * intentful operator actions — losing them in a crash before the 30s
   * persist tick would be surprising.
   */
  async replacePlan(
    clawId: string,
    tasks: ClawTask[],
    actor: 'agent' | 'operator' = 'operator'
  ): Promise<ClawTask[] | null> {
    const managed = this.claws.get(clawId);
    if (!managed) return null;
    managed.session.tasks = tasks;
    this.recordPlanHistory(managed, {
      at: new Date().toISOString(),
      actor,
      kind: 'replace',
      newTaskCount: tasks.length,
    });
    this.markDirty(managed);
    await this.persistSession(clawId, managed);
    this.emitPlanUpdated(clawId, managed, 'replace');
    return managed.session.tasks;
  }

  async updateTaskOnSession(
    clawId: string,
    update: import('../../../tools/claw/plan-executors.js').ValidatedTaskUpdate,
    actor: 'agent' | 'operator' = 'operator'
  ): Promise<{ task: ClawTask; warnings: string[] } | null> {
    const managed = this.claws.get(clawId);
    if (!managed) return null;
    // Import lazily to avoid a circular import (plan-executors imports manager).
    const { applyTaskUpdate } = await import('../../../tools/claw/plan-executors.js');
    // Snapshot prior status BEFORE mutation so the history entry can render
    // the "pending → in_progress" arrow without a separate diff pass.
    const prevTask = managed.session.tasks.find((t) => t.id === update.id);
    const prevStatus = prevTask?.status;
    const result = applyTaskUpdate(managed.session.tasks, update);
    if (update.status !== undefined && update.status !== prevStatus) {
      this.recordPlanHistory(managed, {
        at: new Date().toISOString(),
        actor,
        kind: 'task_update',
        taskId: result.task.id,
        title: result.task.title,
        prevStatus,
        newStatus: result.task.status,
      });
    }
    this.markDirty(managed);
    await this.persistSession(clawId, managed);
    this.emitPlanUpdated(clawId, managed, 'task', result.task.id);
    return result;
  }

  /**
   * Atomic split: marks the parent task blocked and inserts subtasks
   * immediately after it in the plan. Records one task_update entry for
   * the parent + one task_added entry per subtask in the plan history so
   * the change is fully auditable.
   */
  async splitTaskOnSession(
    clawId: string,
    split: import('../../../tools/claw/plan-executors.js').ValidatedSplit,
    actor: 'agent' | 'operator' = 'operator'
  ): Promise<{ parent: ClawTask; subtasks: ClawTask[] } | null> {
    const managed = this.claws.get(clawId);
    if (!managed) return null;
    const { applySplit } = await import('../../../tools/claw/plan-executors.js');
    const prevTask = managed.session.tasks.find((t) => t.id === split.parentId);
    const prevStatus = prevTask?.status;
    const result = applySplit(managed.session.tasks, split);

    const at = new Date().toISOString();
    this.recordPlanHistory(managed, {
      at,
      actor,
      kind: 'task_update',
      taskId: result.parent.id,
      title: result.parent.title,
      prevStatus,
      newStatus: result.parent.status,
    });
    for (const sub of result.subtasks) {
      this.recordPlanHistory(managed, {
        at,
        actor,
        kind: 'task_added',
        taskId: sub.id,
        title: sub.title,
      });
    }

    this.markDirty(managed);
    await this.persistSession(clawId, managed);
    // Broadcast as a replace event since multiple rows changed at once —
    // subscribers re-fetch and see all the changes together.
    this.emitPlanUpdated(clawId, managed, 'replace');
    return { parent: result.parent, subtasks: result.subtasks };
  }

  private recordPlanHistory(managed: ManagedClaw, entry: ClawPlanHistoryEntry): void {
    if (!managed.session.planHistory) managed.session.planHistory = [];
    managed.session.planHistory.push(entry);
    if (managed.session.planHistory.length > CLAW_PLAN_HISTORY_MAX) {
      managed.session.planHistory.splice(
        0,
        managed.session.planHistory.length - CLAW_PLAN_HISTORY_MAX
      );
    }
  }

  /**
   * Notify subscribers (WS broadcaster, dashboards) that the plan changed.
   * Fires for both operator-side and agent-side mutations so the UI can
   * stream live updates without polling. Includes a snapshot of the plan
   * + counts so subscribers don't have to round-trip a re-fetch.
   */
  notifyPlanUpdated(clawId: string, source: 'replace' | 'task', taskId?: string): void {
    const managed = this.claws.get(clawId);
    if (!managed) return;
    this.emitPlanUpdated(clawId, managed, source, taskId);
  }

  private emitPlanUpdated(
    clawId: string,
    managed: ManagedClaw,
    source: 'replace' | 'task',
    taskId?: string
  ): void {
    const tasks = managed.session.tasks;
    const counts = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
    };
    this.emitEvent('claw.plan.updated', {
      clawId,
      source,
      ...(taskId ? { taskId } : {}),
      tasks,
      counts,
    });
  }

  async pauseClaw(clawId: string, _userId: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    if (managed.session.state !== 'running' && managed.session.state !== 'waiting') return false;

    this.clearScheduling(managed);
    // Cancel any in-flight cycle so pause is immediate.
    managed.abortController?.abort();
    managed.session.state = 'paused';
    await this.persistSession(clawId, managed);
    this.emitEvent('claw.paused', { clawId });
    return true;
  }

  async resumeClaw(clawId: string, _userId: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    if (managed.session.state !== 'paused') return false;

    managed.session.state = managed.session.config.mode === 'event' ? 'waiting' : 'running';
    managed.consecutiveErrors = 0;
    await this.persistSession(clawId, managed);
    this.emitEvent('claw.resumed', { clawId });

    this.scheduleNext(clawId, managed);
    return true;
  }

  async stopClaw(clawId: string, _userId: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;

    await this.stopClawInternal(clawId, managed, 'user');
    return true;
  }

  async executeNow(clawId: string): Promise<ClawCycleResult | null> {
    const managed = this.claws.get(clawId);
    if (!managed) return null;

    return this.executeCycle(clawId);
  }

  async sendMessage(clawId: string, message: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;

    managed.session.inbox.push(message);
    this.trimInbox(managed);
    this.markDirty(managed);

    const repo = getClawsRepository();
    await repo.appendToInbox(clawId, message);

    this.emitEvent('claw.progress', { clawId, message: 'New message received' });
    return true;
  }

  /**
   * Queue a directive for the next cycle without interrupting the in-flight
   * one. The runner renders this prominently at the top of the next prompt
   * (with operator vs agent framing) and then auto-clears it so stale intent
   * can never leak past one cycle.
   *
   * - `actor: 'agent'` is what the `claw_set_next_intent` tool calls — the
   *   agent telling itself what to do next.
   * - `actor: 'operator'` is what the operator REST path calls — gets the
   *   `[OPERATOR] ` marker so the runner can render it differently.
   *
   * Returns `false` if the claw is not loaded (not running). Throws on
   * length violations so the caller can map to a 400.
   */
  async setNextIntent(
    clawId: string,
    intent: string,
    actor: 'agent' | 'operator' = 'agent'
  ): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    const trimmed = intent.trim();
    if (!trimmed) throw new Error('intent must not be empty');
    if (trimmed.length > CLAW_NEXT_INTENT_MAX) {
      throw new Error(
        `intent exceeds ${CLAW_NEXT_INTENT_MAX} chars — use .claw/MEMORY.md for longer context`
      );
    }
    managed.session.nextIntent = actor === 'operator' ? `[OPERATOR] ${trimmed}` : trimmed;
    await this.persistSession(clawId, managed);
    this.emitEvent('claw.progress', {
      clawId,
      message:
        actor === 'operator'
          ? 'Operator queued next-cycle directive'
          : 'Next-cycle intent recorded',
    });
    return true;
  }

  /**
   * Operator-facing recovery: clear `consecutiveErrors` and `recentFailures`
   * without restarting the claw. Useful when reflection mode keeps firing
   * because the failure ring still holds stale errors from a tool that has
   * since been fixed (config change, network restored, etc.). After this the
   * next cycle is treated as a clean attempt and the REFLECTION banner clears.
   */
  async resetFailures(clawId: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    if (managed.consecutiveErrors === 0 && managed.session.recentFailures.length === 0) {
      // Nothing to reset — surface as success so the UI doesn't show an error
      // for a no-op, but skip the persist/broadcast roundtrip.
      return true;
    }
    managed.consecutiveErrors = 0;
    managed.session.consecutiveErrors = 0;
    managed.session.recentFailures = [];
    await this.persistSession(clawId, managed);
    this.emitEvent('claw.progress', { clawId, message: 'Failures reset by operator' });
    return true;
  }

  /**
   * Steer a running claw: inject a directive and redirect it NOW.
   *
   * Unlike {@link sendMessage} (which lands in the inbox and is only seen on
   * the next scheduled cycle), steer interrupts any in-flight cycle and starts
   * a fresh one immediately with the steer message in context. This is the
   * mid-run "interrupt and redirect" path — the agent abandons what it was
   * doing and re-plans against the new instruction.
   */
  async steerClaw(clawId: string, _userId: string, message: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    // Only steer a live claw (running or waiting for events).
    if (managed.session.state !== 'running' && managed.session.state !== 'waiting') return false;
    if (!message.trim()) return false;

    // Surface the steer prominently so the next prompt treats it as a directive.
    const steerMsg = `[STEER] ${message}`;
    managed.session.inbox.push(steerMsg);
    this.trimInbox(managed);
    this.markDirty(managed);
    const repo = getClawsRepository();
    await repo.appendToInbox(clawId, steerMsg);

    this.emitEvent('claw.progress', { clawId, message: 'Steer received — redirecting' });

    if (managed.cycleInProgress) {
      // Interrupt the in-flight cycle; the aborted-cycle path starts a fresh
      // cycle immediately because steerPending is set.
      managed.steerPending = true;
      managed.abortController?.abort();
    } else {
      // Idle between cycles — run a fresh cycle right away.
      this.scheduleImmediate(clawId, managed);
    }
    return true;
  }

  /** Clear any pending timer and run a cycle on the next tick. */
  private scheduleImmediate(clawId: string, managed: ManagedClaw): void {
    scheduleImmediateImpl(clawId, managed, this.executeCycleBound);
  }

  private trimInbox(managed: ManagedClaw): void {
    // O(n): compute per-message byte cost once, then drop from the head until
    // both the byte and count caps are satisfied. Avoids the prior O(n²)
    // stringify-on-every-shift pattern that scales poorly with chatty inboxes.
    const session = managed.session;
    if (session.inbox.length === 0) return;
    const sizes = session.inbox.map((m) => Buffer.byteLength(m, 'utf8') + 4); // +4 for JSON quoting/comma
    let totalBytes = sizes.reduce((s, n) => s + n, 0);
    let head = 0;
    while (
      head < session.inbox.length &&
      (totalBytes > MAX_INBOX_BYTES || session.inbox.length - head > MAX_INBOX_MESSAGES)
    ) {
      totalBytes -= sizes[head] ?? 0;
      head++;
    }
    if (head > 0) {
      session.inbox.splice(0, head);
      // Record head evictions so executeCycle can tell how many of the
      // cycle's snapshot messages were dropped from the queue while it ran —
      // see inboxEvictedDuringCycle. New messages only ever append to the
      // tail, so the eviction count is exactly what the consume-slice must
      // discount to avoid eating mid-cycle arrivals.
      managed.inboxEvictedDuringCycle += head;
    }
  }

  /**
   * Handle escalation request from claw_request_escalation tool.
   */
  async requestEscalation(clawId: string, escalation: ClawEscalation): Promise<void> {
    const managed = this.claws.get(clawId);
    if (!managed) throw new Error(`Claw ${clawId} not found`);

    managed.session.pendingEscalation = escalation;
    managed.session.state = 'escalation_pending';
    this.clearScheduling(managed);
    // The cycle that called claw_request_escalation has already finished its
    // tool call, but if another cycle is still in flight, cancel it so the
    // claw doesn't keep working past the escalation gate.
    managed.abortController?.abort();

    const repo = getClawsRepository();
    await repo.saveEscalationHistory(clawId, managed.session.cyclesCompleted, escalation);
    await this.persistSession(clawId, managed);

    this.emitEvent('claw.escalation', {
      clawId,
      type: escalation.type,
      reason: escalation.reason,
      requestId: escalation.id,
    });
    this.broadcastUpdate(clawId, managed);

    log.info(`Claw ${clawId} requested escalation: ${escalation.type} — ${escalation.reason}`);
  }

  /**
   * Approve pending escalation and resume execution.
   *
   * For `task_stalled` the manager injects an inbox nudge so the agent
   * acts decisively on the focus task instead of resuming on the same
   * stuck cycle the auto-escalation fired on. For other types the
   * approval just clears the pending state — the meaning ("budget bumped")
   * is implicit in whatever follow-on action the operator took.
   */
  async approveEscalation(clawId: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    if (managed.session.state !== 'escalation_pending') return false;

    const escalation = managed.session.pendingEscalation;
    managed.session.pendingEscalation = null;
    managed.session.state = managed.session.config.mode === 'event' ? 'waiting' : 'running';

    if (escalation?.type === 'task_stalled') {
      const taskId = escalation.details?.taskId;
      const taskTitle = escalation.details?.taskTitle;
      const cycles = escalation.details?.cyclesInProgress;
      const nudge =
        `[ESCALATION_APPROVED] Operator confirmed your "${taskId ?? 'focus'}" task ("${taskTitle ?? 'current focus'}") ` +
        `has stalled at ${cycles ?? 'many'} cycles. On THIS cycle you must take one of: ` +
        `(1) claw_split_task to break it into smaller subtasks, ` +
        `(2) claw_update_task with status="blocked" and a note explaining what is blocking you, ` +
        `(3) claw_request_escalation with a concrete, actionable ask for the operator. ` +
        `Do not run another attempt at the same task with the same approach.`;
      managed.session.inbox.push(nudge);
      const repo = getClawsRepository();
      await repo.appendToInbox(clawId, nudge);
    } else if (escalation?.type === 'task_force_blocked') {
      // Force-block already happened — approval means "agent, you decide
      // how to recover the mission". Reaffirm the three required actions
      // from the original force-block nudge so the agent doesn't drift
      // back to a doomed retry.
      const taskId = escalation.details?.taskId;
      const taskTitle = escalation.details?.taskTitle;
      const nudge =
        `[ESCALATION_APPROVED] Operator approved your task_force_blocked escalation for "${taskId ?? 'focus'}" ("${taskTitle ?? 'force-blocked task'}"). ` +
        `The task remains blocked. Choose ONE of: ` +
        `(A) claw_split_task into one-hypothesis-per-subtask and try the FIRST subtask with a different approach, ` +
        `(B) claw_complete_report status="failed" if no path forward exists (dependent tasks WILL fail too), ` +
        `(C) claw_update_task to unblock the task ONLY if you have a concretely different strategy — explain it in the notes field.`;
      managed.session.inbox.push(nudge);
      const repo = getClawsRepository();
      await repo.appendToInbox(clawId, nudge);
    }

    await this.persistSession(clawId, managed);

    this.emitEvent('claw.resumed', { clawId });
    this.scheduleNext(clawId, managed);
    return true;
  }

  /**
   * Deny pending escalation — resume without granting and inform the claw via inbox.
   */
  async denyEscalation(clawId: string, reason?: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    if (managed.session.state !== 'escalation_pending') return false;

    const escalation = managed.session.pendingEscalation;
    managed.session.pendingEscalation = null;
    managed.session.state = managed.session.config.mode === 'event' ? 'waiting' : 'running';

    // Inject denial notice into inbox so the claw knows on next cycle.
    // For force-block denials the implicit message "continue with your
    // current capabilities" is dangerously misleading — the task IS still
    // blocked and the operator just refused to look at it, so the agent
    // should mark the mission failed rather than keep retrying.
    const denialMsg =
      escalation?.type === 'task_force_blocked'
        ? `[ESCALATION_DENIED] Operator denied your task_force_blocked escalation.${reason ? ` Reason: ${reason}` : ''} The task remains blocked. Do not unblock it without a fundamentally different strategy. If the rest of the mission depends on this task, call claw_complete_report with status="failed" so the operator sees the outcome instead of grinding through downstream tasks that cannot succeed.`
        : `[ESCALATION_DENIED] Your escalation request "${escalation?.type}" was denied.${reason ? ` Reason: ${reason}` : ''} Continue with your current capabilities.`;
    managed.session.inbox.push(denialMsg);

    const repo = getClawsRepository();
    await repo.appendToInbox(clawId, denialMsg);
    await this.persistSession(clawId, managed);

    this.emitEvent('claw.resumed', { clawId });
    this.scheduleNext(clawId, managed);
    return true;
  }

  /**
   * Add an artifact ID to the session's artifact list.
   * Called by claw tools after publishing an artifact.
   */
  addArtifact(clawId: string, artifactId: string): void {
    const managed = this.claws.get(clawId);
    if (!managed) return;
    if (!managed.session.artifacts.includes(artifactId)) {
      managed.session.artifacts.push(artifactId);
      this.markDirty(managed);
    }
  }

  /**
   * Persist a session immediately (used by claw_set_context so working memory
   * survives an unexpected crash between the periodic-persist intervals).
   * Errors are logged internally so callers can fire-and-forget without
   * unhandled-rejection warnings.
   */
  async flushSession(clawId: string): Promise<void> {
    const managed = this.claws.get(clawId);
    if (!managed) return;
    try {
      await this.persistSession(clawId, managed);
    } catch (err) {
      log.warn(
        `flushSession failed for ${clawId}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Hot-reload runner config so changes from REST PUT take effect immediately.
   */
  updateClawConfig(clawId: string, config: import('@ownpilot/core').ClawConfig): void {
    const managed = this.claws.get(clawId);
    if (!managed) return;
    managed.session.config = config;
    managed.runner.updateConfig(config);

    // Hot-reload scheduling priority so scheduleContinuous picks up the new
    // multiplier on the next cycle.
    if (config.priority !== undefined) {
      managed.priority = config.priority;
    }

    if (['running', 'waiting'].includes(managed.session.state) && !managed.cycleInProgress) {
      managed.session.state = config.mode === 'event' ? 'waiting' : 'running';

      if (config.mode === 'single-shot') {
        this.clearScheduling(managed);
        managed.timer = setTimeout(() => {
          this.executeCycle(clawId)
            .then(async () => {
              if (this.claws.has(clawId)) {
                await this.stopClawInternal(clawId, managed, 'completed');
              }
            })
            .catch((err) => {
              log.error(`Single-shot config update cycle error: ${getErrorMessage(err)}`);
            });
        }, 0);
      } else {
        this.scheduleNext(clawId, managed);
      }

      this.persistSession(clawId, managed).catch((err) => {
        log.warn(
          `[${clawId}] Failed to persist hot-reloaded config state: ${getErrorMessage(err)}`
        );
      });
    }

    log.info(`[${clawId}] Config hot-reloaded`);
  }

  // ============================================================================
  // Queries
  // ============================================================================

  getSession(clawId: string): ClawSession | null {
    return this.claws.get(clawId)?.session ?? null;
  }

  getAllSessions(): ClawSession[] {
    return Array.from(this.claws.values()).map((m) => m.session);
  }

  getSessionsByUser(userId: string): ClawSession[] {
    return this.getAllSessions().filter((s) => s.config.userId === userId);
  }

  isRunning(clawId: string): boolean {
    const managed = this.claws.get(clawId);
    return managed?.session.state === 'running' || managed?.session.state === 'waiting';
  }

  // ============================================================================
  // Private: Cycle Execution
  // ============================================================================

  private async executeCycle(clawId: string): Promise<ClawCycleResult | null> {
    const managed = this.claws.get(clawId);
    if (!managed) return null;

    const cycleNumber = managed.session.cyclesCompleted + 1;
    if (managed.cycleInProgress) {
      this.emitEvent('claw.cycle.skipped', { clawId, cycleNumber, reason: 'concurrent' });
      // Reschedule so the claw keeps cycling once the in-flight cycle finishes.
      // Without this, a missed tick from the previous timer would silently end
      // the cycling loop for non single-shot modes.
      if (managed.session.config.mode !== 'single-shot') {
        this.scheduleNext(clawId, managed);
      }
      return null;
    }

    managed.cycleInProgress = true;
    managed.currentCycleNumber = cycleNumber;

    this.emitEvent('claw.cycle.start', { clawId, cycleNumber });

    try {
      // Rate limit check
      const currentHour = Math.floor(Date.now() / 3_600_000);
      if (currentHour !== managed.hourWindow) {
        managed.hourWindow = currentHour;
        managed.cyclesThisHour = 0;
      }

      if (managed.cyclesThisHour >= managed.session.config.limits.maxCyclesPerHour) {
        log.warn(`Claw ${clawId} rate limited (${managed.cyclesThisHour} cycles this hour)`);
        managed.session.state = 'paused';
        await this.persistSession(clawId, managed);
        this.emitEvent('claw.paused', { clawId, reason: 'rate_limit' });
        this.broadcastUpdate(clawId, managed);
        // Schedule auto-resume at the start of the next hour window so the
        // claw recovers without operator intervention.
        const nextHourMs = (managed.hourWindow + 1) * 3_600_000 - Date.now();
        managed.timer = setTimeout(
          () => {
            const m = this.claws.get(clawId);
            if (!m) return;
            m.session.state = m.session.config.mode === 'event' ? 'waiting' : 'running';
            m.cyclesThisHour = 0;
            m.hourWindow = Math.floor(Date.now() / 3_600_000);
            this.markDirty(m);
            this.emitEvent('claw.resumed', { clawId, reason: 'rate_limit_window' });
            this.broadcastUpdate(clawId, m);
            this.scheduleNext(clawId, m);
          },
          Math.max(1000, nextHourMs)
        );
        return null;
      }

      // Budget check
      if (managed.session.config.limits.totalBudgetUsd !== undefined) {
        if (managed.session.totalCostUsd >= managed.session.config.limits.totalBudgetUsd) {
          log.warn(`Claw ${clawId} budget exceeded`);
          await this.stopClawInternal(clawId, managed, 'budget_exceeded');
          return null;
        }
      }

      // Record how many messages the cycle will consume but do NOT clear them —
      // runCycle reads session.inbox to build the prompt.
      const inboxLengthAtStart = managed.session.inbox.length;
      managed.inboxEvictedDuringCycle = 0;

      // Fresh AbortController per cycle so pause/stop can cancel mid-cycle.
      managed.abortController = new AbortController();

      // Execute
      const result = await managed.runner.runCycle(managed.session, managed.abortController.signal);

      // Consume messages that were present at cycle start
      const consumed = Math.max(0, inboxLengthAtStart - managed.inboxEvictedDuringCycle);
      managed.session.inbox = managed.session.inbox.slice(consumed);

      // Update session
      managed.session.cyclesCompleted = cycleNumber;
      managed.session.totalToolCalls += result.toolCalls.length;
      managed.session.totalCostUsd += safeCost(result.costUsd);
      managed.session.lastCycleAt = new Date();
      managed.session.lastCycleDurationMs = safeDuration(result.durationMs);
      managed.session.lastCycleError = result.error ?? null;
      managed.lastCycleToolCalls = result.toolCalls.length;
      managed.cyclesThisHour++;
      for (const t of managed.session.tasks) {
        if (t.status === 'in_progress') {
          t.cyclesInProgress = (t.cyclesInProgress ?? 0) + 1;
        }
      }
      this.markDirty(managed);

      if (result.success) {
        managed.consecutiveErrors = 0;
        managed.session.consecutiveErrors = 0;
      } else {
        managed.consecutiveErrors++;
        managed.session.consecutiveErrors = managed.consecutiveErrors;
      }
      const toolErrors = result.toolCalls
        .filter((tc) => !tc.success)
        .map((tc) => ({
          tool: tc.tool,
          error: truncateForFailureLog(stringifyToolResult(tc.result)),
        }));
      if (!result.success || toolErrors.length > 0) {
        managed.session.recentFailures.push({
          cycleNumber,
          at: new Date().toISOString(),
          error: result.error ?? null,
          ...(toolErrors.length > 0 ? { toolErrors } : {}),
        });
        if (managed.session.recentFailures.length > CLAW_RECENT_FAILURES_MAX) {
          managed.session.recentFailures.splice(
            0,
            managed.session.recentFailures.length - CLAW_RECENT_FAILURES_MAX
          );
        }
      }

      const repo = getClawsRepository();
      await repo.saveHistory(clawId, cycleNumber, result);

      this.emitEvent('claw.cycle.complete', {
        clawId,
        cycleNumber,
        success: result.success,
        toolCallsCount: result.toolCalls.length,
        durationMs: result.durationMs,
        outputPreview: result.outputMessage.slice(0, 200),
      });

      this.broadcastUpdate(clawId, managed);

      this.emitEvent('claw.cycle.summary', {
        clawId,
        cycleNumber,
        success: result.success,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        toolCallsCount: result.toolCalls.length,
        consecutiveErrors: managed.consecutiveErrors,
        totalCostUsd: managed.session.totalCostUsd,
        state: managed.session.state,
        error: result.error ?? null,
      });

      if (this.shouldStop(managed, result)) {
        await this.stopClawInternal(clawId, managed, 'completed');
        return result;
      }

      if (await checkBudgetThreshold(clawId, managed, this.cycleOpsCallbacks)) {
        return result;
      }

      if (await checkTaskForceBlock(clawId, managed, this.cycleOpsCallbacks)) {
        return result;
      }

      if (await checkTaskStallEscalation(clawId, managed, this.cycleOpsCallbacks)) {
        return result;
      }

      if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.warn(`Claw ${clawId} auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        managed.session.lastCycleError =
          result.error ?? `Auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`;
        await this.stopClawInternal(clawId, managed, 'failed');
        return result;
      }

      if (managed.session.config.mode !== 'single-shot') {
        if (managed.session.config.mode === 'event') {
          if (managed.session.state === 'running') {
            managed.session.state = 'waiting';
          }
        }
        if (this.isSchedulableState(managed.session.state)) {
          this.scheduleNext(clawId, managed);
        }
      }

      return result;
    } catch (err) {
      const aborted =
        managed.abortController?.signal.aborted === true ||
        (err instanceof Error && err.name === 'AbortError');
      if (aborted) {
        log.info(`[${clawId}] Cycle ${cycleNumber} cancelled (pause/stop/escalation/steer)`);
        if (
          managed.steerPending &&
          this.claws.has(clawId) &&
          this.isSchedulableState(managed.session.state)
        ) {
          managed.steerPending = false;
          this.scheduleImmediate(clawId, managed);
        }
        return null;
      }

      const errorMsg = getErrorMessage(err);
      log.error(`Claw ${clawId} cycle execution error: ${errorMsg}`);
      managed.consecutiveErrors++;
      managed.session.lastCycleError = errorMsg;
      managed.session.lastCycleAt = new Date();
      this.markDirty(managed);
      this.emitEvent('claw.error', { clawId, error: errorMsg, cycleNumber });

      try {
        const repo = getClawsRepository();
        await repo.saveHistory(clawId, cycleNumber, {
          success: false,
          toolCalls: [],
          output: '',
          outputMessage: '',
          durationMs: 0,
          turns: 0,
          error: errorMsg,
        });
      } catch (saveErr) {
        log.warn(`[${clawId}] Failed to save error history: ${getErrorMessage(saveErr)}`);
      }

      if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.warn(`Claw ${clawId} auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        await this.stopClawInternal(clawId, managed, 'failed');
        return null;
      }

      if (
        managed.session.config.mode !== 'single-shot' &&
        this.claws.has(clawId) &&
        this.isSchedulableState(managed.session.state)
      ) {
        this.scheduleNext(clawId, managed);
      }
      return null;
    } finally {
      managed.cycleInProgress = false;
      managed.abortController = null;
    }
  }

  private isSchedulableState(state: ClawSession['state']): boolean {
    return isSchedulableStateImpl(state);
  }

  private shouldStop(managed: ManagedClaw, result: ClawCycleResult): boolean {
    return shouldStopImpl(managed, result);
  }

  private scheduleNext(clawId: string, managed: ManagedClaw): void {
    scheduleNextImpl(clawId, managed, this.executeCycleBound);
  }

  private clearScheduling(managed: ManagedClaw): void {
    clearSchedulingImpl(managed);
  }

  private async stopClawInternal(
    clawId: string,
    managed: ManagedClaw,
    reason: string
  ): Promise<void> {
    this.clearScheduling(managed);
    managed.abortController?.abort();

    if (managed.persistTimer) {
      clearInterval(managed.persistTimer);
      managed.persistTimer = null;
    }

    if (reason === 'completed') {
      managed.session.state = 'completed';
    } else if (reason === 'failed' || reason === 'budget_exceeded') {
      managed.session.state = 'failed';
    } else {
      managed.session.state = 'stopped';
    }
    managed.session.stoppedAt = new Date();

    await this.persistSession(clawId, managed);
    this.claws.delete(clawId);

    this.emitEvent('claw.stopped', {
      clawId,
      userId: managed.session.config.userId,
      reason,
    });

    log.info(`Claw ${clawId} stopped (${reason})`);

    const childIds: string[] = [];
    for (const [childId, child] of this.claws.entries()) {
      if (child.session.config.parentClawId === clawId) {
        childIds.push(childId);
      }
    }
    for (const childId of childIds) {
      const child = this.claws.get(childId);
      if (!child) continue;
      try {
        await this.stopClawInternal(childId, child, 'parent_stopped');
      } catch (err) {
        log.warn(
          `[${clawId}] Failed to cascade-stop child ${childId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private async persistSession(clawId: string, managed: ManagedClaw): Promise<void> {
    this.trimInbox(managed);

    const repo = getClawsRepository();
    await repo.saveSession(clawId, {
      state: managed.session.state,
      cyclesCompleted: managed.session.cyclesCompleted,
      totalToolCalls: managed.session.totalToolCalls,
      totalCostUsd: managed.session.totalCostUsd,
      lastCycleAt: managed.session.lastCycleAt,
      lastCycleDurationMs: managed.session.lastCycleDurationMs,
      lastCycleError: managed.session.lastCycleError,
      startedAt: managed.session.startedAt,
      stoppedAt: managed.session.stoppedAt,
      persistentContext: {
        ...managed.session.persistentContext,
        __claw_tasks: managed.session.tasks,
        ...(managed.session.planHistory && managed.session.planHistory.length > 0
          ? { __claw_plan_history: managed.session.planHistory }
          : {}),
      },
      inbox: managed.session.inbox,
      artifacts: managed.session.artifacts,
      pendingEscalation: managed.session.pendingEscalation,
    });

    managed.dirty = false;
  }

  private markDirty(managed: ManagedClaw): void {
    managed.dirty = true;
  }

  private emitEvent(type: string, data: Record<string, unknown>): void {
    emitManagerEvent(type, data);
  }

  private broadcastUpdate(clawId: string, managed: ManagedClaw): void {
    broadcastClawUpdate(clawId, managed);
  }
}
