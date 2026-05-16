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

import { getEventSystem, getErrorMessage, generateId } from '@ownpilot/core';
import type { ClawSession, ClawCycleResult, ClawEscalation, EventHandler } from '@ownpilot/core';
import { ClawRunner } from './claw-runner.js';
import { getClawsRepository } from '../db/repositories/claws.js';
import {
  getOrCreateSessionWorkspace,
  updateSessionWorkspaceMeta,
} from '../workspace/file-workspace.js';
import { getLog } from './log.js';
import {
  scaffoldClawDir,
  runRetentionCleanup,
  ensureConversationRow,
} from './claw/manager-helpers.js';

const log = getLog('ClawManager');

// ============================================================================
// Constants
// ============================================================================

const MAX_CONSECUTIVE_ERRORS = 5;
const SESSION_PERSIST_INTERVAL_MS = 30_000;
const DEFAULT_INTERVAL_MS = 300_000; // 5 min
const MISSION_COMPLETE_SENTINEL = 'MISSION_COMPLETE';
const MAX_CONCURRENT_CLAWS = 50;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const MAX_INBOX_MESSAGES = 100;
const MAX_INBOX_BYTES = 50_000;

// Continuous mode adaptive delays
const CONTINUOUS_MIN_DELAY_MS = 500; // Active: fast loop
const CONTINUOUS_MAX_DELAY_MS = 10_000; // Error: backoff
const CONTINUOUS_IDLE_DELAY_MS = 5_000; // No tool calls: slow down

// ============================================================================
// Types
// ============================================================================

interface ManagedClaw {
  session: ClawSession;
  runner: ClawRunner;
  timer: ReturnType<typeof setTimeout> | null;
  eventSubscriptions: Array<{ eventType: string; handler: EventHandler }>;
  consecutiveErrors: number;
  cyclesThisHour: number;
  hourWindow: number;
  persistTimer: ReturnType<typeof setInterval> | null;
  lastCycleToolCalls: number;
  cycleInProgress: boolean;
  currentCycleNumber: number;
  idleCycles: number;
  /**
   * AbortController for the current cycle. Allows pause/stop/escalation to
   * cancel an in-flight agent call instead of waiting for the cycle timeout.
   */
  abortController: AbortController | null;
  /**
   * Tracks whether the session has changes that have not been written to the
   * database yet. The periodic persist timer uses this to skip no-op writes
   * (e.g. event-mode claws idling between rare events). Mutating call paths
   * set this true; persistSession clears it on successful write.
   */
  dirty: boolean;
}

// ============================================================================
// Manager
// ============================================================================

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
          persistentContext: savedSession.persistentContext,
          inbox: savedSession.inbox,
          artifacts: savedSession.artifacts,
          pendingEscalation: savedSession.pendingEscalation,
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
      dirty: true,
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
    this.trimInbox(managed.session);
    this.markDirty(managed);

    const repo = getClawsRepository();
    await repo.appendToInbox(clawId, message);

    this.emitEvent('claw.progress', { clawId, message: 'New message received' });
    return true;
  }

  private trimInbox(session: ClawSession): void {
    // O(n): compute per-message byte cost once, then drop from the head until
    // both the byte and count caps are satisfied. Avoids the prior O(n²)
    // stringify-on-every-shift pattern that scales poorly with chatty inboxes.
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
   */
  async approveEscalation(clawId: string): Promise<boolean> {
    const managed = this.claws.get(clawId);
    if (!managed) return false;
    if (managed.session.state !== 'escalation_pending') return false;

    managed.session.pendingEscalation = null;
    managed.session.state = managed.session.config.mode === 'event' ? 'waiting' : 'running';
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

    // Inject denial notice into inbox so the claw knows on next cycle
    const denialMsg = `[ESCALATION_DENIED] Your escalation request "${escalation?.type}" was denied.${reason ? ` Reason: ${reason}` : ''} Continue with your current capabilities.`;
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

      // Snapshot inbox for this cycle but do NOT clear it —
      // runCycle reads session.inbox to build the prompt.
      const inboxSnapshot = [...managed.session.inbox];

      // Fresh AbortController per cycle so pause/stop can cancel mid-cycle.
      managed.abortController = new AbortController();

      // Execute
      const result = await managed.runner.runCycle(managed.session, managed.abortController.signal);

      // After successful cycle, remove only the messages that were
      // present at cycle start. Messages that arrived during the
      // cycle remain for the next cycle.
      //
      // Bound the slice arg by current length: trimInbox can run during the
      // cycle (sendMessage push, periodic persist) and may have evicted
      // head-of-queue messages if the cap was exceeded. Without this guard,
      // slicing past inbox.length would silently drop legitimately-newer
      // mid-cycle messages.
      const consumed = Math.min(inboxSnapshot.length, managed.session.inbox.length);
      managed.session.inbox = managed.session.inbox.slice(consumed);

      // Update session
      managed.session.cyclesCompleted = cycleNumber;
      managed.session.totalToolCalls += result.toolCalls.length;
      // Guard against NaN / Infinity / negative cost from a misbehaving
      // provider or cost-calculation bug. NaN is especially nasty because
      // it propagates: NaN >= totalBudgetUsd is false, so the budget
      // guardrail would silently never fire again.
      const safeCost =
        typeof result.costUsd === 'number' && Number.isFinite(result.costUsd) && result.costUsd >= 0
          ? result.costUsd
          : 0;
      managed.session.totalCostUsd += safeCost;
      managed.session.lastCycleAt = new Date();
      managed.session.lastCycleDurationMs =
        typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
          ? result.durationMs
          : 0;
      managed.session.lastCycleError = result.error ?? null;
      managed.lastCycleToolCalls = result.toolCalls.length;
      managed.cyclesThisHour++;
      this.markDirty(managed);

      if (result.success) {
        managed.consecutiveErrors = 0;
      } else {
        managed.consecutiveErrors++;
      }

      // Save history
      const repo = getClawsRepository();
      await repo.saveHistory(clawId, cycleNumber, result);

      // Emit completion event
      this.emitEvent('claw.cycle.complete', {
        clawId,
        cycleNumber,
        success: result.success,
        toolCallsCount: result.toolCalls.length,
        durationMs: result.durationMs,
        outputPreview: result.outputMessage.slice(0, 200),
      });

      // Broadcast update for UI
      this.broadcastUpdate(clawId, managed);

      // Check stop conditions
      if (this.shouldStop(managed, result)) {
        await this.stopClawInternal(clawId, managed, 'completed');
        return result;
      }

      // Programmatically enforce autonomyPolicy.maxCostUsdBeforePause. The
      // prompt-side instruction tells the LLM to self-pause, but we cannot
      // rely on it — a runaway claw will keep spending. Auto-request an
      // escalation so the operator decides whether to grant a budget bump
      // or stop the claw. Only fires once: subsequent cycles see
      // pendingEscalation already set and skip via state guard.
      const policyMaxCost = managed.session.config.autonomyPolicy?.maxCostUsdBeforePause;
      if (
        policyMaxCost !== undefined &&
        managed.session.totalCostUsd >= policyMaxCost &&
        managed.session.state !== 'escalation_pending' &&
        !managed.session.pendingEscalation
      ) {
        log.warn(
          `[${clawId}] autonomyPolicy.maxCostUsdBeforePause reached ($${managed.session.totalCostUsd.toFixed(4)} >= $${policyMaxCost}); requesting budget_increase escalation`
        );
        try {
          await this.requestEscalation(clawId, {
            id: generateId('esc'),
            type: 'budget_increase',
            reason: `Total cost $${managed.session.totalCostUsd.toFixed(4)} reached autonomy-policy threshold $${policyMaxCost}`,
            details: {
              totalCostUsd: managed.session.totalCostUsd,
              maxCostUsdBeforePause: policyMaxCost,
              cyclesCompleted: managed.session.cyclesCompleted,
              autoTriggered: true,
            },
            requestedAt: new Date(),
          });
        } catch (err) {
          log.warn(
            `[${clawId}] Failed to auto-request escalation: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return result;
      }

      // Check consecutive errors — set 'failed' state to distinguish from manual pause
      if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.warn(`Claw ${clawId} auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        managed.session.lastCycleError =
          result.error ?? `Auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`;
        await this.stopClawInternal(clawId, managed, 'failed');
        return result;
      }

      // Schedule next cycle (non single-shot modes), but only if the claw
      // is still in a runnable state. pauseClaw/stopClaw can flip state to
      // 'paused'/'stopped' while a cycle is in flight; without this guard
      // we'd resurrect a paused claw the moment its current cycle finishes.
      if (managed.session.config.mode !== 'single-shot') {
        if (managed.session.config.mode === 'event') {
          if (managed.session.state === 'running') {
            managed.session.state = 'waiting'; // back to waiting for next event
          }
        }
        if (this.isSchedulableState(managed.session.state)) {
          this.scheduleNext(clawId, managed);
        }
      }

      return result;
    } catch (err) {
      // Aborted cycles are benign cancellations (pause/stop/escalation), not
      // real errors. Don't count toward MAX_CONSECUTIVE_ERRORS, don't save a
      // bogus history row, and don't reschedule. The pause/stop caller has
      // already set the next state.
      const aborted =
        managed.abortController?.signal.aborted === true ||
        (err instanceof Error && err.name === 'AbortError');
      if (aborted) {
        log.info(`[${clawId}] Cycle ${cycleNumber} cancelled (pause/stop/escalation)`);
        return null;
      }

      const errorMsg = getErrorMessage(err);
      log.error(`Claw ${clawId} cycle execution error: ${errorMsg}`);
      // Count exception-path failures toward consecutive-error budget so a
      // persistently broken provider/agent will eventually trigger auto-fail.
      managed.consecutiveErrors++;
      managed.session.lastCycleError = errorMsg;
      managed.session.lastCycleAt = new Date();
      this.markDirty(managed);
      this.emitEvent('claw.error', { clawId, error: errorMsg, cycleNumber });

      // Persist failure as a history entry so users can investigate from the UI.
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

      // Trip MAX_CONSECUTIVE_ERRORS auto-fail from the catch path too.
      if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.warn(`Claw ${clawId} auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        await this.stopClawInternal(clawId, managed, 'failed');
        return null;
      }

      // For non single-shot modes, keep cycling — backoff scheduling kicks in.
      // Same state-guard as the happy path: don't resurrect a paused/stopped claw.
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

  /**
   * States from which it is safe to schedule the next cycle. Anything else
   * (paused, stopped, completed, failed, escalation_pending) means an
   * external actor has decided this claw should stop running.
   */
  private isSchedulableState(state: ClawSession['state']): boolean {
    return state === 'running' || state === 'waiting';
  }

  // ============================================================================
  // Private: Helpers
  // ============================================================================

  private shouldStop(managed: ManagedClaw, result: ClawCycleResult): boolean {
    // Check for MISSION_COMPLETE sentinel
    if (result.outputMessage.includes(MISSION_COMPLETE_SENTINEL)) {
      return true;
    }

    // Check stop condition
    const stopCondition = managed.session.config.stopCondition;
    if (stopCondition) {
      // max_cycles:N — stop after N cycles
      const maxCyclesMatch = stopCondition.match(/^max_cycles:(\d+)$/i);
      if (maxCyclesMatch?.[1]) {
        const maxCycles = parseInt(maxCyclesMatch[1], 10);
        if (managed.session.cyclesCompleted >= maxCycles) {
          return true;
        }
      }

      // on_report — stop when claw_complete_report was called this cycle
      if (stopCondition === 'on_report') {
        const calledReport = result.toolCalls.some(
          (tc) => tc.tool === 'claw_complete_report' && tc.success
        );
        if (calledReport) return true;
      }

      // on_error — stop on first cycle failure
      if (stopCondition === 'on_error' && !result.success) {
        return true;
      }

      // idle:N — stop after N consecutive cycles with 0 tool calls
      const idleMatch = stopCondition.match(/^idle:(\d+)$/i);
      if (idleMatch?.[1]) {
        const idleLimit = parseInt(idleMatch[1], 10);
        if (managed.lastCycleToolCalls === 0) {
          managed.idleCycles = (managed.idleCycles ?? 0) + 1;
          if (managed.idleCycles >= idleLimit) return true;
        } else {
          managed.idleCycles = 0;
        }
      }
    }

    return false;
  }

  private scheduleNext(clawId: string, managed: ManagedClaw): void {
    this.clearScheduling(managed);

    switch (managed.session.config.mode) {
      case 'continuous':
        this.scheduleContinuous(clawId, managed);
        break;
      case 'interval':
        this.scheduleInterval(clawId, managed);
        break;
      case 'event':
        this.subscribeToEvents(clawId, managed);
        break;
      // single-shot handled separately in startClaw
    }
  }

  private scheduleContinuous(clawId: string, managed: ManagedClaw): void {
    let delay: number;
    if (managed.session.lastCycleDurationMs === null) {
      delay = CONTINUOUS_MIN_DELAY_MS; // First cycle — start fast
    } else if (managed.session.lastCycleError) {
      delay = CONTINUOUS_MAX_DELAY_MS; // Error — backoff
    } else if (managed.lastCycleToolCalls === 0) {
      delay = CONTINUOUS_IDLE_DELAY_MS; // Idle — slow down
    } else {
      delay = CONTINUOUS_MIN_DELAY_MS; // Active — fast loop
    }

    managed.timer = setTimeout(() => {
      this.executeCycle(clawId).catch((err) => {
        log.error(`Continuous cycle error: ${getErrorMessage(err)}`);
      });
    }, delay);
  }

  private scheduleInterval(clawId: string, managed: ManagedClaw): void {
    const interval = managed.session.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    managed.timer = setTimeout(() => {
      this.executeCycle(clawId).catch((err) => {
        log.error(`Interval cycle error: ${getErrorMessage(err)}`);
      });
    }, interval);
  }

  private subscribeToEvents(clawId: string, managed: ManagedClaw): void {
    const filters = managed.session.config.eventFilters ?? [];
    if (filters.length === 0) return;

    const selfSource = `claw:${clawId}`;
    const selfMarker = clawId;

    try {
      const eventSystem = getEventSystem();
      for (const eventType of filters) {
        const handler: EventHandler = (event: unknown) => {
          // Guard against self-trigger loops when an event-mode claw filters on
          // event types it can emit itself (e.g. claw.*, claw.cycle.complete).
          const ev = event as
            | { source?: string; payload?: { _clawId?: string; clawId?: string } }
            | undefined;
          if (ev) {
            if (ev.source === selfSource || ev.source === 'claw-manager') return;
            const payloadClawId = ev.payload?._clawId ?? ev.payload?.clawId;
            if (payloadClawId === selfMarker) return;
          }

          if (managed.session.state === 'waiting') {
            managed.session.state = 'running';
            this.markDirty(managed);
            managed.timer = setTimeout(() => {
              this.executeCycle(clawId).catch((err) => {
                log.error(`Event-triggered cycle error: ${getErrorMessage(err)}`);
              });
            }, 0);
          }
        };

        eventSystem.onAny(eventType, handler);
        managed.eventSubscriptions.push({ eventType, handler });
      }
    } catch {
      // Event system may not be initialized
    }
  }

  private clearScheduling(managed: ManagedClaw): void {
    if (managed.timer) {
      clearTimeout(managed.timer);
      managed.timer = null;
    }

    // Unsubscribe from events
    try {
      const eventSystem = getEventSystem();
      for (const sub of managed.eventSubscriptions) {
        eventSystem.off(sub.eventType, sub.handler);
      }
    } catch {
      // Event system may not be initialized
    }
    managed.eventSubscriptions = [];
  }

  private async stopClawInternal(
    clawId: string,
    managed: ManagedClaw,
    reason: string
  ): Promise<void> {
    this.clearScheduling(managed);
    // Cancel any in-flight cycle so stop is immediate instead of waiting for
    // the cycle timeout.
    managed.abortController?.abort();

    if (managed.persistTimer) {
      clearInterval(managed.persistTimer);
      managed.persistTimer = null;
    }

    // Map stop reasons to terminal session states so the UI and health checks
    // can distinguish completion, manual stops, and failure conditions.
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

    // Cascade stop to running subclaws so they don't outlive their parent.
    // Without this, a stopped parent leaves orphaned children consuming
    // budget/cycles. Recursion is bounded by MAX_CLAW_DEPTH (currently 3).
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
    // Trim inbox before persisting to keep DB bounded
    this.trimInbox(managed.session);

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
      persistentContext: managed.session.persistentContext,
      inbox: managed.session.inbox,
      artifacts: managed.session.artifacts,
      pendingEscalation: managed.session.pendingEscalation,
    });

    // Successful write — clear the dirty flag so the next periodic tick can
    // skip if no further mutations happen.
    managed.dirty = false;
  }

  /**
   * Mark the in-memory session as having unwritten changes. The periodic
   * persist timer reads this to decide whether the next tick needs a DB
   * write. Call this from any code path that mutates managed.session.
   */
  private markDirty(managed: ManagedClaw): void {
    managed.dirty = true;
  }

  private emitEvent(type: string, data: Record<string, unknown>): void {
    try {
      const eventSystem = getEventSystem();
      eventSystem.emit(type as never, 'claw-manager', data as never);
    } catch {
      // Event system may not be initialized in tests
    }
  }

  private broadcastUpdate(clawId: string, managed: ManagedClaw): void {
    try {
      const eventSystem = getEventSystem();
      eventSystem.emit('claw.update' as never, 'claw-manager', {
        clawId,
        state: managed.session.state,
        cyclesCompleted: managed.session.cyclesCompleted,
        totalToolCalls: managed.session.totalToolCalls,
        totalCostUsd: managed.session.totalCostUsd,
        lastCycleAt: managed.session.lastCycleAt,
      } as never);
    } catch {
      // Event system may not be initialized
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _manager: ClawManager | null = null;

export function getClawManager(): ClawManager {
  if (!_manager) {
    _manager = new ClawManager();
  }
  return _manager;
}

export function resetClawManager(): void {
  if (_manager) {
    _manager.stop().catch((err) => {
      getLog('ClawManager').warn('ClawManager stop failed during reset:', String(err));
    });
    _manager = null;
  }
}
