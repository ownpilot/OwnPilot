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

import { getEventSystem, getErrorMessage } from '@ownpilot/core';
import type { ClawSession, ClawCycleResult, ClawEscalation, EventHandler } from '@ownpilot/core';
import { ClawRunner } from './claw-runner.js';
import { getClawsRepository } from '../db/repositories/claws.js';
import {
  getOrCreateSessionWorkspace,
  writeSessionWorkspaceFile,
  readSessionWorkspaceFile,
} from '../workspace/file-workspace.js';
import { getLog } from './log.js';

const log = getLog('ClawManager');

// ============================================================================
// Constants
// ============================================================================

const MAX_CONSECUTIVE_ERRORS = 5;
const SESSION_PERSIST_INTERVAL_MS = 30_000;
const DEFAULT_INTERVAL_MS = 300_000; // 5 min
const MISSION_COMPLETE_SENTINEL = 'MISSION_COMPLETE';
const MAX_CONCURRENT_CLAWS = 50;
const HISTORY_RETENTION_DAYS = 90;
const AUDIT_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

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
}

// ============================================================================
// Manager
// ============================================================================

export class ClawManager {
  private claws = new Map<string, ManagedClaw>();
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
    this.runCleanup();
    this.cleanupTimer = setInterval(() => this.runCleanup(), CLEANUP_INTERVAL_MS);

    log.info(`Claw Manager started (${this.claws.size} claws running)`);
  }

  /**
   * Graceful shutdown.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const stopPromises: Promise<void>[] = [];
    for (const [clawId, managed] of this.claws) {
      stopPromises.push(this.stopClawInternal(clawId, managed, 'user'));
    }
    await Promise.allSettled(stopPromises);
    this.claws.clear();

    log.info('Claw Manager stopped');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async startClaw(clawId: string, userId: string): Promise<ClawSession> {
    if (this.claws.has(clawId)) {
      throw new Error(`Claw ${clawId} is already running`);
    }

    // Enforce concurrent claw limit
    if (this.claws.size >= MAX_CONCURRENT_CLAWS) {
      throw new Error(
        `Maximum concurrent claws (${MAX_CONCURRENT_CLAWS}) reached. Stop some claws before starting new ones.`
      );
    }

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
    }

    // Scaffold .claw/ directory with initial files if not exists
    this.scaffoldClawDir(workspaceId, config);

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
    };

    this.claws.set(clawId, managed);

    // Set initial state based on mode
    session.state = config.mode === 'event' ? 'waiting' : 'running';

    // Persist session
    await this.persistSession(clawId, managed);

    // Emit start event
    this.emitEvent('claw.started', { clawId, userId, name: config.name });

    // Start periodic persist timer
    managed.persistTimer = setInterval(() => {
      this.persistSession(clawId, managed).catch((err) => {
        log.warn(`Failed to persist session: ${getErrorMessage(err)}`);
      });
    }, SESSION_PERSIST_INTERVAL_MS);

    // Ensure conversation row exists so Chat tab works
    this.ensureConversationRow(clawId, config.userId, config.name).catch((err) => {
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

    const repo = getClawsRepository();
    await repo.appendToInbox(clawId, message);

    this.emitEvent('claw.progress', { clawId, message: 'New message received' });
    return true;
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

    const repo = getClawsRepository();
    await repo.saveEscalationHistory(clawId, managed.session.cyclesCompleted, escalation);
    await this.persistSession(clawId, managed);

    this.emitEvent('claw.escalation', {
      clawId,
      type: escalation.type,
      reason: escalation.reason,
      requestId: escalation.id,
    });

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

      // Consume inbox messages for this cycle — keep a backup to restore on failure
      const inboxSnapshot = [...managed.session.inbox];
      managed.session.inbox = [];

      // Execute
      let result;
      try {
        result = await managed.runner.runCycle(managed.session);
      } catch (err) {
        // Restore inbox messages so they aren't lost on cycle failure
        managed.session.inbox.push(...inboxSnapshot);
        throw err;
      }

      // Update session
      managed.session.cyclesCompleted = cycleNumber;
      managed.session.totalToolCalls += result.toolCalls.length;
      managed.session.totalCostUsd += result.costUsd ?? 0;
      managed.session.lastCycleAt = new Date();
      managed.session.lastCycleDurationMs = result.durationMs;
      managed.session.lastCycleError = result.error ?? null;
      managed.lastCycleToolCalls = result.toolCalls.length;
      managed.cyclesThisHour++;

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

      // Check consecutive errors — set 'failed' state to distinguish from manual pause
      if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.warn(`Claw ${clawId} auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        managed.session.state = 'failed';
        await this.persistSession(clawId, managed);
        this.claws.delete(clawId);
        if (managed.persistTimer) {
          clearInterval(managed.persistTimer);
          managed.persistTimer = null;
        }
        this.emitEvent('claw.stopped', {
          clawId,
          userId: managed.session.config.userId,
          reason: 'failed',
          error: `Auto-failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Last error: ${result.error ?? 'unknown'}`,
        });
        return result;
      }

      // Schedule next cycle (non single-shot modes)
      if (managed.session.config.mode !== 'single-shot') {
        if (managed.session.config.mode === 'event') {
          managed.session.state = 'waiting'; // back to waiting for next event
        }
        this.scheduleNext(clawId, managed);
      }

      return result;
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      log.error(`Claw ${clawId} cycle execution error: ${errorMsg}`);
      this.emitEvent('claw.error', { clawId, error: errorMsg, cycleNumber });
      return null;
    } finally {
      managed.cycleInProgress = false;
    }
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

    try {
      const eventSystem = getEventSystem();
      for (const eventType of filters) {
        const handler: EventHandler = () => {
          if (managed.session.state === 'waiting') {
            managed.session.state = 'running';
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

    if (managed.persistTimer) {
      clearInterval(managed.persistTimer);
      managed.persistTimer = null;
    }

    managed.session.state = reason === 'completed' ? 'completed' : 'stopped';
    managed.session.stoppedAt = new Date();

    await this.persistSession(clawId, managed);
    this.claws.delete(clawId);

    this.emitEvent('claw.stopped', {
      clawId,
      userId: managed.session.config.userId,
      reason,
    });

    log.info(`Claw ${clawId} stopped (${reason})`);
  }

  private async persistSession(clawId: string, managed: ManagedClaw): Promise<void> {
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

  private runCleanup(): void {
    const repo = getClawsRepository();

    repo
      .cleanupOldHistory(HISTORY_RETENTION_DAYS)
      .then((deleted) => {
        if (deleted > 0) log.info(`Cleaned up ${deleted} old claw history entries`);
      })
      .catch((err) => {
        log.warn(`History cleanup failed: ${getErrorMessage(err)}`);
      });

    repo
      .cleanupOldAuditLog(AUDIT_RETENTION_DAYS)
      .then((deleted) => {
        if (deleted > 0) log.info(`Cleaned up ${deleted} old claw audit log entries`);
      })
      .catch((err) => {
        log.warn(`Audit log cleanup failed: ${getErrorMessage(err)}`);
      });
  }

  /**
   * Ensure a conversation row exists for the claw's chat history.
   * The Chat tab fetches /api/v1/chat/claw-{id}/messages — this needs a row in conversations.
   */
  private async ensureConversationRow(
    clawId: string,
    _userId: string,
    clawName: string
  ): Promise<void> {
    const conversationId = `claw-${clawId}`;
    try {
      const { ConversationsRepository } = await import('../db/repositories/conversations.js');
      const repo = new ConversationsRepository();
      const existing = await repo.getById(conversationId).catch((err) => {
        log.debug('Conversation lookup failed (best-effort)', { conversationId, error: String(err) });
        return null;
      });
      if (!existing) {
        await repo.create({
          id: conversationId,
          agentName: `claw-${clawId}`,
          metadata: { clawId, clawName, type: 'claw' },
        });
      }
    } catch (err) {
      log.debug('Failed to persist claw conversation (best-effort)', { clawId, error: String(err) });
    }
  }

  /**
   * Scaffold .claw/ directory with initial instruction files.
   * Only creates files that don't already exist (idempotent).
   */
  private scaffoldClawDir(
    workspaceId: string,
    config: { name: string; mission: string; mode: string }
  ): void {
    try {
      // INSTRUCTIONS.md — persistent directives the claw reads every cycle
      if (!readSessionWorkspaceFile(workspaceId, '.claw/INSTRUCTIONS.md')) {
        writeSessionWorkspaceFile(
          workspaceId,
          '.claw/INSTRUCTIONS.md',
          Buffer.from(
            `# ${config.name} — Instructions

## Mission
${config.mission}

## Directives
- Follow these instructions every cycle
- Update TASKS.md as you make progress
- Save important findings to MEMORY.md
- Send progress to the user via claw_send_output
- When done, use claw_complete_report to deliver results

## Notes
Add custom directives here. This file persists across cycles.
`,
            'utf-8'
          )
        );
      }

      // TASKS.md — checklist the claw maintains
      if (!readSessionWorkspaceFile(workspaceId, '.claw/TASKS.md')) {
        writeSessionWorkspaceFile(
          workspaceId,
          '.claw/TASKS.md',
          Buffer.from(
            `# Tasks

## TODO
- [ ] Start working on the mission
- [ ] Research and gather information
- [ ] Process and analyze findings
- [ ] Send results to user
- [ ] Write final report

## IN PROGRESS

## DONE
`,
            'utf-8'
          )
        );
      }

      // MEMORY.md — persistent notes across cycles
      if (!readSessionWorkspaceFile(workspaceId, '.claw/MEMORY.md')) {
        writeSessionWorkspaceFile(
          workspaceId,
          '.claw/MEMORY.md',
          Buffer.from(
            `# Memory

Persistent notes across cycles. Write findings, decisions, and context here.
The claw reads this every cycle to maintain continuity.

## Findings

## Decisions

## Context
`,
            'utf-8'
          )
        );
      }

      // LOG.md — execution log
      if (!readSessionWorkspaceFile(workspaceId, '.claw/LOG.md')) {
        writeSessionWorkspaceFile(
          workspaceId,
          '.claw/LOG.md',
          Buffer.from(
            `# Execution Log

Append cycle summaries here for a running log of what happened.
`,
            'utf-8'
          )
        );
      }
    } catch (err) {
      log.warn(`Failed to scaffold .claw/ dir: ${getErrorMessage(err)}`);
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
