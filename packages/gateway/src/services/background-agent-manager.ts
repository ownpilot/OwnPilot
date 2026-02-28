/**
 * Background Agent Manager
 *
 * Singleton that manages all running background agent sessions:
 * - Lifecycle: start, pause, resume, stop
 * - Scheduling: continuous (adaptive delay), interval (fixed), event (reactive)
 * - Resource limits: cycles/hour, budget caps
 * - Stop condition evaluation after each cycle
 * - Graceful shutdown: persists all sessions, clears timers
 * - Auto-recovery: resumes autoStart + interrupted sessions on boot
 *
 * The manager owns timers and event subscriptions.
 * Actual cycle execution is delegated to BackgroundAgentRunner.
 */

import { getEventSystem, getErrorMessage } from '@ownpilot/core';
import type {
  BackgroundAgentConfig,
  BackgroundAgentSession,
  BackgroundAgentCycleResult,
  BackgroundAgentState,
  EventHandler,
  EventType,
  EventPayload,
} from '@ownpilot/core';
import { BackgroundAgentRunner } from './background-agent-runner.js';
import { getBackgroundAgentsRepository } from '../db/repositories/background-agents.js';
import { getOrCreateSessionWorkspace } from '../workspace/file-workspace.js';
import { getLog } from './log.js';

const log = getLog('BackgroundAgentManager');

// ============================================================================
// Constants
// ============================================================================

/** Adaptive delay bounds for continuous mode */
const CONTINUOUS_MIN_DELAY_MS = 500;
const CONTINUOUS_MAX_DELAY_MS = 5_000;
const CONTINUOUS_IDLE_DELAY_MS = 3_000;

/** Default interval for interval mode */
const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

/** Session persist interval (save to DB periodically) */
const SESSION_PERSIST_INTERVAL_MS = 30_000; // 30 seconds

/** Max consecutive errors before auto-pause */
const MAX_CONSECUTIVE_ERRORS = 5;

// ============================================================================
// Types
// ============================================================================

interface ManagedAgent {
  session: BackgroundAgentSession;
  runner: BackgroundAgentRunner;
  timer: ReturnType<typeof setTimeout> | null;
  eventSubscriptions: Array<{ eventType: string; handler: EventHandler }>;
  consecutiveErrors: number;
  cyclesThisHour: number;
  hourWindow: number; // hour timestamp for rate limiting
  persistTimer: ReturnType<typeof setInterval> | null;
}

// ============================================================================
// Manager
// ============================================================================

export class BackgroundAgentManager {
  private agents = new Map<string, ManagedAgent>();
  private running = false;

  /**
   * Boot: resume autoStart agents and interrupted sessions.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const repo = getBackgroundAgentsRepository();

    // Resume interrupted sessions (agents that were running when server stopped)
    try {
      const interrupted = await repo.getInterruptedSessions();
      for (const { config } of interrupted) {
        try {
          await this.startAgent(config);
          log.info(`Resumed interrupted agent: ${config.name} [${config.id}]`);
        } catch (err) {
          log.error(`Failed to resume agent ${config.id}: ${getErrorMessage(err)}`);
        }
      }
    } catch (err) {
      log.error(`Failed to load interrupted sessions: ${getErrorMessage(err)}`);
    }

    // Start autoStart agents that don't have interrupted sessions
    try {
      const autoStartConfigs = await repo.getAutoStartAgents();
      for (const config of autoStartConfigs) {
        if (!this.agents.has(config.id)) {
          try {
            await this.startAgent(config);
            log.info(`Auto-started agent: ${config.name} [${config.id}]`);
          } catch (err) {
            log.error(`Failed to auto-start agent ${config.id}: ${getErrorMessage(err)}`);
          }
        }
      }
    } catch (err) {
      log.error(`Failed to load autoStart agents: ${getErrorMessage(err)}`);
    }

    log.info(`Background Agent Manager started (${this.agents.size} agents running)`);
  }

  /**
   * Graceful shutdown: save all sessions and stop all agents.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    const stopPromises: Promise<void>[] = [];
    for (const [agentId, managed] of this.agents) {
      stopPromises.push(this.stopAgentInternal(agentId, managed, 'user'));
    }
    await Promise.allSettled(stopPromises);
    this.agents.clear();

    log.info('Background Agent Manager stopped');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start an agent. Creates a new session (or resumes from DB).
   */
  async startAgent(config: BackgroundAgentConfig): Promise<BackgroundAgentSession> {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent ${config.id} is already running`);
    }

    const repo = getBackgroundAgentsRepository();

    // Try to load existing session from DB (for resume after restart)
    const savedSession = await repo.loadSession(config.id);

    const session: BackgroundAgentSession = savedSession
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
        };

    // Ensure agent has an isolated workspace for file operations
    if (!config.workspaceId) {
      try {
        const wsId = `bg-agent-${config.id}`;
        getOrCreateSessionWorkspace(wsId, config.id, config.userId);
        config.workspaceId = wsId;
        // Persist workspace ID back to DB
        await repo.update(config.id, config.userId, { workspaceId: wsId });
      } catch (err) {
        log.debug(`Workspace creation for ${config.id} skipped: ${getErrorMessage(err)}`);
      }
    }

    const runner = new BackgroundAgentRunner(config);

    const managed: ManagedAgent = {
      session,
      runner,
      timer: null,
      eventSubscriptions: [],
      consecutiveErrors: 0,
      cyclesThisHour: 0,
      hourWindow: this.getCurrentHour(),
      persistTimer: null,
    };

    this.agents.set(config.id, managed);

    // Start periodic session persistence
    managed.persistTimer = setInterval(() => {
      this.persistSession(config.id).catch((err) => {
        log.error(`Session persist error for ${config.id}: ${getErrorMessage(err)}`);
      });
    }, SESSION_PERSIST_INTERVAL_MS);

    // Transition to running/waiting and begin scheduling
    session.state = config.mode === 'event' ? 'waiting' : 'running';
    this.scheduleNext(config.id, managed);

    // Persist initial session state
    await this.persistSession(config.id);

    // Emit started event
    this.emitEvent('background-agent.started', {
      agentId: config.id,
      userId: config.userId,
      name: config.name,
    });

    log.info(`Agent started: ${config.name} [${config.id}] mode=${config.mode}`);

    return session;
  }

  /**
   * Pause a running agent (preserves session state).
   */
  async pauseAgent(agentId: string): Promise<boolean> {
    const managed = this.agents.get(agentId);
    if (!managed) return false;

    const { session } = managed;
    if (session.state !== 'running' && session.state !== 'waiting') return false;

    // Clear timer and event subscriptions
    this.clearScheduling(managed);

    session.state = 'paused';
    await this.persistSession(agentId);

    this.emitEvent('background-agent.paused', { agentId });
    this.broadcastUpdate(agentId, managed);

    log.info(`Agent paused: ${session.config.name} [${agentId}]`);
    return true;
  }

  /**
   * Resume a paused agent.
   */
  async resumeAgent(agentId: string): Promise<boolean> {
    const managed = this.agents.get(agentId);
    if (!managed) return false;

    const { session } = managed;
    if (session.state !== 'paused') return false;

    session.state = session.config.mode === 'event' ? 'waiting' : 'running';
    managed.consecutiveErrors = 0;
    this.scheduleNext(agentId, managed);

    await this.persistSession(agentId);

    this.emitEvent('background-agent.resumed', { agentId });
    this.broadcastUpdate(agentId, managed);

    log.info(`Agent resumed: ${session.config.name} [${agentId}]`);
    return true;
  }

  /**
   * Stop a running/paused agent.
   */
  async stopAgent(agentId: string, reason: 'user' | 'completed' | 'failed' | 'budget_exceeded' = 'user'): Promise<boolean> {
    const managed = this.agents.get(agentId);
    if (!managed) return false;

    await this.stopAgentInternal(agentId, managed, reason);
    this.agents.delete(agentId);

    return true;
  }

  /**
   * Update a running agent's config (e.g. after DB update).
   * If mode/interval changed, rescheduling occurs.
   */
  updateAgentConfig(agentId: string, config: BackgroundAgentConfig): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    const modeChanged = managed.session.config.mode !== config.mode;
    const intervalChanged = managed.session.config.intervalMs !== config.intervalMs;

    managed.session.config = config;
    managed.runner.updateConfig(config);

    // Reschedule if mode or interval changed
    if (modeChanged || intervalChanged) {
      this.clearScheduling(managed);
      if (managed.session.state === 'running' || managed.session.state === 'waiting') {
        this.scheduleNext(agentId, managed);
      }
    }
  }

  /**
   * Send a message to an agent's inbox.
   */
  async sendMessage(agentId: string, from: string, message: string): Promise<boolean> {
    const managed = this.agents.get(agentId);
    if (!managed) return false;

    managed.session.inbox.push(message);

    // For event-mode agents, trigger an immediate cycle when a message arrives
    if (managed.session.config.mode === 'event' && managed.session.state === 'waiting') {
      this.clearScheduling(managed);
      managed.session.state = 'running';
      this.scheduleImmediate(agentId, managed);
    }

    this.emitEvent('background-agent.message', { agentId, from, content: message });

    return true;
  }

  // ============================================================================
  // Queries
  // ============================================================================

  /** Get the in-memory session for an agent */
  getSession(agentId: string): BackgroundAgentSession | null {
    return this.agents.get(agentId)?.session ?? null;
  }

  /** Get all active sessions */
  getAllSessions(): BackgroundAgentSession[] {
    return Array.from(this.agents.values()).map((m) => m.session);
  }

  /** Get sessions filtered by userId */
  getSessionsByUser(userId: string): BackgroundAgentSession[] {
    return Array.from(this.agents.values())
      .filter((m) => m.session.config.userId === userId)
      .map((m) => m.session);
  }

  /** Check if an agent is currently managed */
  isRunning(agentId: string): boolean {
    const managed = this.agents.get(agentId);
    return managed !== undefined && managed.session.state !== 'stopped';
  }

  // ============================================================================
  // Scheduling
  // ============================================================================

  private scheduleNext(agentId: string, managed: ManagedAgent): void {
    const { session } = managed;

    switch (session.config.mode) {
      case 'continuous':
        this.scheduleContinuous(agentId, managed);
        break;

      case 'interval':
        this.scheduleInterval(agentId, managed);
        break;

      case 'event':
        this.subscribeToEvents(agentId, managed);
        break;
    }
  }

  private scheduleContinuous(agentId: string, managed: ManagedAgent): void {
    // Adaptive delay based on last cycle activity
    let delay: number;
    if (managed.session.lastCycleDurationMs === null) {
      // First cycle — start quickly
      delay = CONTINUOUS_MIN_DELAY_MS;
    } else {
      const lastResult = managed.session.lastCycleError;
      if (lastResult) {
        // Backoff on error
        delay = CONTINUOUS_MAX_DELAY_MS;
      } else if (managed.session.totalToolCalls === 0) {
        // No activity yet — use idle delay
        delay = CONTINUOUS_IDLE_DELAY_MS;
      } else {
        // Active — fast delay
        delay = CONTINUOUS_MIN_DELAY_MS;
      }
    }

    managed.timer = setTimeout(() => {
      this.executeCycle(agentId).catch((err) => {
        log.error(`Cycle execution error for ${agentId}: ${getErrorMessage(err)}`);
      });
    }, delay);
  }

  private scheduleInterval(agentId: string, managed: ManagedAgent): void {
    const interval = managed.session.config.intervalMs ?? DEFAULT_INTERVAL_MS;

    managed.timer = setTimeout(() => {
      this.executeCycle(agentId).catch((err) => {
        log.error(`Cycle execution error for ${agentId}: ${getErrorMessage(err)}`);
      });
    }, interval);
  }

  private scheduleImmediate(agentId: string, managed: ManagedAgent): void {
    managed.timer = setTimeout(() => {
      this.executeCycle(agentId).catch((err) => {
        log.error(`Cycle execution error for ${agentId}: ${getErrorMessage(err)}`);
      });
    }, 0);
  }

  private subscribeToEvents(agentId: string, managed: ManagedAgent): void {
    const eventSystem = getEventSystem();
    const filters = managed.session.config.eventFilters ?? [];

    for (const eventType of filters) {
      const handler: EventHandler = () => {
        // Only trigger if in waiting state (debounce multiple events)
        if (managed.session.state === 'waiting') {
          managed.session.state = 'running';
          this.scheduleImmediate(agentId, managed);
        }
      };

      // Use onAny since event filters are user-provided strings
      eventSystem.onAny(eventType, handler);
      managed.eventSubscriptions.push({ eventType, handler });
    }
  }

  private clearScheduling(managed: ManagedAgent): void {
    if (managed.timer) {
      clearTimeout(managed.timer);
      managed.timer = null;
    }

    // Unsubscribe from events
    const eventSystem = getEventSystem();
    for (const sub of managed.eventSubscriptions) {
      eventSystem.off(sub.eventType, sub.handler);
    }
    managed.eventSubscriptions = [];
  }

  // ============================================================================
  // Cycle Execution
  // ============================================================================

  private async executeCycle(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed || !this.running) return;

    const { session, runner } = managed;

    // Check if agent should still be running
    if (session.state !== 'running' && session.state !== 'waiting') return;

    // Rate limit check: cycles per hour
    this.enforceRateLimit(managed);
    if (!this.canExecuteCycle(managed)) {
      // Wait and try again later
      if (session.config.mode !== 'event') {
        managed.timer = setTimeout(() => {
          this.executeCycle(agentId).catch((err) => {
            log.error(`Rate-limited cycle retry error for ${agentId}: ${getErrorMessage(err)}`);
          });
        }, 60_000); // Retry in 1 minute
      }
      return;
    }

    // Budget check
    if (session.config.limits.totalBudgetUsd !== undefined) {
      if (session.totalCostUsd >= session.config.limits.totalBudgetUsd) {
        log.warn(`Agent ${agentId} has exceeded budget (${session.totalCostUsd} USD)`);
        await this.stopAgent(agentId, 'budget_exceeded');
        return;
      }
    }

    session.state = 'running';
    const cycleNumber = session.cyclesCompleted + 1;

    // Emit cycle start event
    this.emitEvent('background-agent.cycle.start', { agentId, cycleNumber });

    // Run the cycle
    let result: BackgroundAgentCycleResult;
    try {
      result = await runner.runCycle(session);
    } catch (err) {
      result = {
        success: false,
        toolCalls: [],
        outputMessage: '',
        durationMs: 0,
        turns: 0,
        error: getErrorMessage(err),
      };
    }

    // Update session with result
    session.cyclesCompleted = cycleNumber;
    session.totalToolCalls += result.toolCalls.length;
    session.totalCostUsd += result.costUsd ?? 0;
    session.lastCycleAt = new Date();
    session.lastCycleDurationMs = result.durationMs;
    session.lastCycleError = result.error ?? null;

    // Clear inbox after cycle (messages were included in the cycle prompt)
    session.inbox = [];

    // Track rate limiting
    managed.cyclesThisHour++;

    // Track consecutive errors
    if (result.success) {
      managed.consecutiveErrors = 0;
    } else {
      managed.consecutiveErrors++;
    }

    // Save cycle to history
    try {
      const repo = getBackgroundAgentsRepository();
      await repo.saveHistory(agentId, cycleNumber, result);
    } catch (err) {
      log.error(`Failed to save cycle history for ${agentId}: ${getErrorMessage(err)}`);
    }

    // Emit cycle complete event
    this.emitEvent('background-agent.cycle.complete', {
      agentId,
      cycleNumber,
      success: result.success,
      toolCallsCount: result.toolCalls.length,
      durationMs: result.durationMs,
      outputPreview: result.outputMessage.slice(0, 200),
    });

    // Broadcast to WS for UI
    this.broadcastUpdate(agentId, managed);

    // Check stop conditions
    if (this.shouldStop(managed, result)) {
      return; // stopAgent was already called inside shouldStop
    }

    // Auto-pause on too many consecutive errors
    if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log.warn(
        `Agent ${agentId} hit ${MAX_CONSECUTIVE_ERRORS} consecutive errors, auto-pausing`
      );
      this.emitEvent('background-agent.error', {
        agentId,
        error: `Auto-paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`,
        cycleNumber,
      });
      await this.pauseAgent(agentId);
      return;
    }

    // Schedule next cycle
    if (session.config.mode === 'event') {
      session.state = 'waiting';
    }
    this.scheduleNext(agentId, managed);
  }

  // ============================================================================
  // Resource Limits
  // ============================================================================

  private enforceRateLimit(managed: ManagedAgent): void {
    const currentHour = this.getCurrentHour();
    if (managed.hourWindow !== currentHour) {
      managed.cyclesThisHour = 0;
      managed.hourWindow = currentHour;
    }
  }

  private canExecuteCycle(managed: ManagedAgent): boolean {
    return managed.cyclesThisHour < managed.session.config.limits.maxCyclesPerHour;
  }

  private getCurrentHour(): number {
    return Math.floor(Date.now() / 3_600_000);
  }

  // ============================================================================
  // Stop Condition Evaluation
  // ============================================================================

  /**
   * Evaluate stop conditions. Returns true if the agent should stop.
   * Supported conditions:
   * - "MISSION_COMPLETE" — LLM output contains the sentinel
   * - "max_cycles:N" — stop after N cycles
   */
  private shouldStop(managed: ManagedAgent, result: BackgroundAgentCycleResult): boolean {
    const { session } = managed;
    const agentId = session.config.id;

    // Check for MISSION_COMPLETE sentinel in LLM output
    if (result.outputMessage.includes('MISSION_COMPLETE')) {
      log.info(`Agent ${agentId} reported MISSION_COMPLETE`);
      this.stopAgent(agentId, 'completed').catch((err) => {
        log.error(`Failed to stop completed agent ${agentId}: ${getErrorMessage(err)}`);
      });
      return true;
    }

    // Check stop condition string
    if (session.config.stopCondition) {
      const match = session.config.stopCondition.match(/^max_cycles:(\d+)$/);
      if (match) {
        const maxCycles = parseInt(match[1]!, 10);
        if (session.cyclesCompleted >= maxCycles) {
          log.info(`Agent ${agentId} reached max_cycles:${maxCycles}`);
          this.stopAgent(agentId, 'completed').catch((err) => {
            log.error(`Failed to stop completed agent ${agentId}: ${getErrorMessage(err)}`);
          });
          return true;
        }
      }
    }

    return false;
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  private async stopAgentInternal(
    agentId: string,
    managed: ManagedAgent,
    reason: 'user' | 'completed' | 'failed' | 'budget_exceeded'
  ): Promise<void> {
    // Clear all scheduling
    this.clearScheduling(managed);

    // Clear persist timer
    if (managed.persistTimer) {
      clearInterval(managed.persistTimer);
      managed.persistTimer = null;
    }

    // Update session state
    managed.session.state = reason === 'completed' ? 'completed' : reason === 'failed' ? 'failed' : 'stopped';
    managed.session.stoppedAt = new Date();

    // Persist final session state
    await this.persistSession(agentId);

    // Emit stopped event
    this.emitEvent('background-agent.stopped', {
      agentId,
      userId: managed.session.config.userId,
      reason,
    });

    this.broadcastUpdate(agentId, managed);

    log.info(`Agent stopped: ${managed.session.config.name} [${agentId}] reason=${reason}`);
  }

  private async persistSession(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    const { session } = managed;
    const repo = getBackgroundAgentsRepository();

    await repo.saveSession(agentId, {
      state: session.state,
      cyclesCompleted: session.cyclesCompleted,
      totalToolCalls: session.totalToolCalls,
      totalCostUsd: session.totalCostUsd,
      lastCycleAt: session.lastCycleAt,
      lastCycleDurationMs: session.lastCycleDurationMs,
      lastCycleError: session.lastCycleError,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      persistentContext: session.persistentContext,
      inbox: session.inbox,
    });
  }

  private emitEvent<K extends EventType>(type: K, data: EventPayload<K>): void {
    try {
      const eventSystem = getEventSystem();
      eventSystem.emit(type, 'background-agent-manager', data);
    } catch {
      // Event system may not be initialized during tests
    }
  }

  private broadcastUpdate(agentId: string, managed: ManagedAgent): void {
    try {
      getEventSystem().emitRaw({
        type: 'background-agent.update',
        category: 'background-agent',
        source: 'background-agent-manager',
        data: {
          agentId,
          state: managed.session.state,
          cyclesCompleted: managed.session.cyclesCompleted,
          totalToolCalls: managed.session.totalToolCalls,
          lastCycleAt: managed.session.lastCycleAt,
          lastCycleDurationMs: managed.session.lastCycleDurationMs,
          lastCycleError: managed.session.lastCycleError,
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // EventSystem may not be initialized during tests
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _manager: BackgroundAgentManager | null = null;

export function getBackgroundAgentManager(): BackgroundAgentManager {
  if (!_manager) {
    _manager = new BackgroundAgentManager();
  }
  return _manager;
}
