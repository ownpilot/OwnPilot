/**
 * Fleet Manager
 *
 * Singleton that manages all running fleet sessions:
 * - Lifecycle: start, pause, resume, stop
 * - Scheduling: continuous, interval, cron, event, on-demand
 * - Task queue: dequeue ready tasks, assign to workers, collect results
 * - Resource limits: cycles/hour, budget caps, concurrency
 * - Graceful shutdown: persists all sessions, clears timers
 * - Auto-recovery: resumes autoStart fleets on boot
 *
 * The manager owns timers and task scheduling.
 * Actual task execution is delegated to FleetWorker.
 */

import { getEventSystem, getErrorMessage } from '@ownpilot/core';
import type {
  FleetConfig,
  FleetSession,
  FleetTask,
  FleetWorkerConfig,
} from '@ownpilot/core';
import { FleetWorker } from './fleet-worker.js';
import { getFleetRepository } from '../db/repositories/fleet.js';
import { getLog } from './log.js';

const log = getLog('FleetManager');

// ============================================================================
// Constants
// ============================================================================

const CONTINUOUS_MIN_DELAY_MS = 1_000;
const CONTINUOUS_MAX_DELAY_MS = 10_000;
const CONTINUOUS_IDLE_DELAY_MS = 5_000;

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute

const MAX_CONSECUTIVE_ERRORS = 5;

const SESSION_PERSIST_INTERVAL_MS = 30_000;

// ============================================================================
// Types
// ============================================================================

interface ManagedFleet {
  config: FleetConfig;
  session: FleetSession;
  timer: ReturnType<typeof setTimeout> | null;
  persistTimer: ReturnType<typeof setInterval> | null;
  consecutiveErrors: number;
  cyclesThisHour: number;
  hourWindow: number;
  activeWorkerCount: number;
}

// ============================================================================
// Manager
// ============================================================================

export class FleetManager {
  private fleets = new Map<string, ManagedFleet>();
  private running = false;

  /**
   * Boot: resume autoStart fleets.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const repo = getFleetRepository();
      const autoStartFleets = await repo.getAutoStartFleets();

      for (const config of autoStartFleets) {
        try {
          await this.startFleet(config);
          log.info(`Auto-started fleet: ${config.name} [${config.id}]`);
        } catch (err) {
          log.error(`Failed to auto-start fleet ${config.id}: ${getErrorMessage(err)}`);
        }
      }
    } catch (err) {
      log.warn(`Fleet auto-start scan failed: ${getErrorMessage(err)}`);
    }

    log.info('FleetManager started');
  }

  /**
   * Graceful shutdown: stop all fleets.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    const stopPromises = [...this.fleets.keys()].map((id) =>
      this.stopFleet(id, 'shutdown').catch((err) =>
        log.error(`Error stopping fleet ${id}: ${getErrorMessage(err)}`)
      )
    );
    await Promise.allSettled(stopPromises);

    log.info('FleetManager stopped');
  }

  // ---------- Lifecycle ----------

  async startFleet(config: FleetConfig): Promise<FleetSession> {
    if (this.fleets.has(config.id)) {
      throw new Error(`Fleet ${config.id} is already running`);
    }

    const repo = getFleetRepository();
    const session = await repo.createSession(config.id, config.sharedContext);

    const managed: ManagedFleet = {
      config,
      session,
      timer: null,
      persistTimer: null,
      consecutiveErrors: 0,
      cyclesThisHour: 0,
      hourWindow: Math.floor(Date.now() / 3_600_000),
      activeWorkerCount: 0,
    };

    this.fleets.set(config.id, managed);

    // Start periodic session persistence
    managed.persistTimer = setInterval(() => {
      this.persistSession(config.id).catch((err) =>
        log.warn(`Session persist failed for ${config.id}: ${getErrorMessage(err)}`)
      );
    }, SESSION_PERSIST_INTERVAL_MS);

    // Schedule first cycle
    this.scheduleNextCycle(config.id);

    this.emitEvent('fleet.started', { fleetId: config.id, name: config.name });
    log.info(`Fleet started: ${config.name} [${config.id}]`);

    return session;
  }

  async pauseFleet(fleetId: string): Promise<boolean> {
    const managed = this.fleets.get(fleetId);
    if (!managed) return false;

    if (managed.timer) {
      clearTimeout(managed.timer);
      managed.timer = null;
    }

    managed.session.state = 'paused';
    await this.persistSession(fleetId);

    this.emitEvent('fleet.paused', { fleetId });
    log.info(`Fleet paused: ${fleetId}`);
    return true;
  }

  async resumeFleet(fleetId: string): Promise<boolean> {
    const managed = this.fleets.get(fleetId);
    if (!managed || managed.session.state !== 'paused') return false;

    managed.session.state = 'running';
    managed.consecutiveErrors = 0;
    this.scheduleNextCycle(fleetId);

    this.emitEvent('fleet.resumed', { fleetId });
    log.info(`Fleet resumed: ${fleetId}`);
    return true;
  }

  async stopFleet(fleetId: string, reason: string = 'user'): Promise<boolean> {
    const managed = this.fleets.get(fleetId);
    if (!managed) return false;

    // Clear timers
    if (managed.timer) {
      clearTimeout(managed.timer);
      managed.timer = null;
    }
    if (managed.persistTimer) {
      clearInterval(managed.persistTimer);
      managed.persistTimer = null;
    }

    // Update session
    managed.session.state = 'stopped';
    managed.session.stoppedAt = new Date();
    await this.persistSession(fleetId);

    this.fleets.delete(fleetId);

    this.emitEvent('fleet.stopped', { fleetId, reason });
    log.info(`Fleet stopped: ${fleetId} (reason: ${reason})`);
    return true;
  }

  // ---------- Queries ----------

  isRunning(fleetId: string): boolean {
    return this.fleets.has(fleetId);
  }

  getSession(fleetId: string): FleetSession | null {
    return this.fleets.get(fleetId)?.session ?? null;
  }

  getSessionsByUser(userId: string): FleetSession[] {
    const sessions: FleetSession[] = [];
    for (const managed of this.fleets.values()) {
      if (managed.config.userId === userId) {
        sessions.push(managed.session);
      }
    }
    return sessions;
  }

  updateFleetConfig(fleetId: string, config: FleetConfig): void {
    const managed = this.fleets.get(fleetId);
    if (managed) {
      managed.config = config;
    }
  }

  // ---------- Task Communication ----------

  async broadcastToFleet(fleetId: string, message: string): Promise<void> {
    const managed = this.fleets.get(fleetId);
    if (!managed) throw new Error(`Fleet ${fleetId} is not running`);

    // Store message as a task for all workers
    const repo = getFleetRepository();
    for (const worker of managed.config.workers) {
      await repo.createTask(fleetId, {
        title: `Broadcast: ${message.slice(0, 50)}`,
        description: message,
        assignedWorker: worker.name,
        priority: 'high',
      });
    }

    // Trigger immediate cycle
    this.scheduleImmediate(fleetId);
  }

  /** Trigger an immediate cycle */
  executeNow(fleetId: string): boolean {
    const managed = this.fleets.get(fleetId);
    if (!managed) return false;

    this.scheduleImmediate(fleetId);
    return true;
  }

  // ---------- Core Cycle ----------

  private scheduleNextCycle(fleetId: string): void {
    const managed = this.fleets.get(fleetId);
    if (!managed || managed.session.state !== 'running') return;

    const { scheduleType, scheduleConfig } = managed.config;

    switch (scheduleType) {
      case 'continuous':
        this.scheduleContinuous(fleetId, managed);
        break;
      case 'interval':
        this.scheduleInterval(fleetId, managed, scheduleConfig?.intervalMs);
        break;
      case 'cron':
        this.scheduleCron(fleetId, managed, scheduleConfig?.cron);
        break;
      case 'event':
        // Event-driven: no timer, triggered by broadcastToFleet or executeNow
        break;
      case 'on-demand':
        // Manual only: no timer
        break;
      default:
        this.scheduleInterval(fleetId, managed, DEFAULT_INTERVAL_MS);
    }
  }

  private scheduleContinuous(fleetId: string, managed: ManagedFleet): void {
    // Adaptive delay: busy → short, idle → long
    const hasPendingWork = managed.activeWorkerCount > 0;
    const delay = hasPendingWork
      ? CONTINUOUS_MIN_DELAY_MS
      : managed.consecutiveErrors > 0
        ? CONTINUOUS_MAX_DELAY_MS
        : CONTINUOUS_IDLE_DELAY_MS;

    managed.timer = setTimeout(() => {
      this.runCycle(fleetId).catch((err) =>
        log.error(`Fleet cycle error: ${getErrorMessage(err)}`)
      );
    }, delay);
  }

  private scheduleInterval(
    fleetId: string,
    managed: ManagedFleet,
    intervalMs?: number
  ): void {
    const delay = intervalMs ?? DEFAULT_INTERVAL_MS;
    managed.timer = setTimeout(() => {
      this.runCycle(fleetId).catch((err) =>
        log.error(`Fleet cycle error: ${getErrorMessage(err)}`)
      );
    }, delay);
  }

  private scheduleCron(
    fleetId: string,
    managed: ManagedFleet,
    _cron?: string
  ): void {
    // Simplified: parse cron-like interval. For full cron, use a library.
    // Fall back to 60s interval.
    const delay = DEFAULT_INTERVAL_MS;
    managed.timer = setTimeout(() => {
      this.runCycle(fleetId).catch((err) =>
        log.error(`Fleet cycle error: ${getErrorMessage(err)}`)
      );
    }, delay);
  }

  private scheduleImmediate(fleetId: string): void {
    const managed = this.fleets.get(fleetId);
    if (!managed) return;

    if (managed.timer) {
      clearTimeout(managed.timer);
    }

    managed.timer = setTimeout(() => {
      this.runCycle(fleetId).catch((err) =>
        log.error(`Fleet cycle error: ${getErrorMessage(err)}`)
      );
    }, 0);
  }

  /**
   * Main cycle: dequeue tasks, assign to workers, execute, collect results.
   */
  private async runCycle(fleetId: string): Promise<void> {
    const managed = this.fleets.get(fleetId);
    if (!managed || managed.session.state !== 'running') return;

    // Rate limiting
    const currentHour = Math.floor(Date.now() / 3_600_000);
    if (currentHour !== managed.hourWindow) {
      managed.cyclesThisHour = 0;
      managed.hourWindow = currentHour;
    }

    const maxCyclesPerHour = managed.config.budget?.maxCyclesPerHour ?? 60;
    if (managed.cyclesThisHour >= maxCyclesPerHour) {
      log.warn(`[${fleetId}] Rate limit reached (${maxCyclesPerHour}/hr), skipping cycle`);
      this.scheduleNextCycle(fleetId);
      return;
    }

    // Budget check
    const maxCost = managed.config.budget?.maxCostUsd;
    if (maxCost && managed.session.totalCostUsd >= maxCost) {
      log.warn(`[${fleetId}] Budget exceeded ($${managed.session.totalCostUsd}/$${maxCost})`);
      await this.pauseFleet(fleetId);
      return;
    }

    // Total cycles check
    const maxTotal = managed.config.budget?.maxTotalCycles;
    if (maxTotal && managed.session.cyclesCompleted >= maxTotal) {
      log.info(`[${fleetId}] Max total cycles reached (${maxTotal})`);
      await this.stopFleet(fleetId, 'max_cycles_reached');
      return;
    }

    const repo = getFleetRepository();

    try {
      // Dequeue ready tasks (respecting concurrency + dependencies)
      const availableSlots = managed.config.concurrencyLimit - managed.activeWorkerCount;
      if (availableSlots <= 0) {
        this.scheduleNextCycle(fleetId);
        return;
      }

      const readyTasks = await repo.getReadyTasks(fleetId, availableSlots);

      if (readyTasks.length === 0) {
        // No pending tasks — schedule next cycle
        managed.consecutiveErrors = 0;
        this.scheduleNextCycle(fleetId);
        return;
      }

      this.emitEvent('fleet.cycle.start', {
        fleetId,
        cycle: managed.session.cyclesCompleted + 1,
        taskCount: readyTasks.length,
      });

      // Assign tasks to workers and execute in parallel
      const execPromises = readyTasks.map(async (task) => {
        const workerConfig = this.resolveWorker(managed.config, task);
        if (!workerConfig) {
          log.warn(`[${fleetId}] No suitable worker for task ${task.id}`);
          await repo.updateTask(task.id, { status: 'failed', error: 'No suitable worker' });
          return null;
        }

        // Mark task as running
        await repo.updateTask(task.id, {
          status: 'running',
          startedAt: new Date(),
          assignedWorker: workerConfig.name,
        });

        managed.activeWorkerCount++;

        const worker = new FleetWorker({
          config: workerConfig,
          fleetId,
          sessionId: managed.session.id,
          userId: managed.config.userId,
          defaultProvider: managed.config.provider,
          defaultModel: managed.config.model,
          mission: managed.config.mission,
        });

        // Emit per-worker started event
        this.emitEvent('fleet.worker.started', {
          fleetId,
          taskId: task.id,
          workerName: workerConfig.name,
          workerType: workerConfig.type,
        });

        try {
          const result = await worker.execute(task, managed.session.sharedContext);

          // Update task status
          if (result.success) {
            await repo.updateTask(task.id, {
              status: 'completed',
              output: result.output,
              completedAt: new Date(),
            });
          } else {
            const retries = task.retries + 1;
            if (retries < task.maxRetries) {
              await repo.updateTask(task.id, {
                status: 'queued',
                retries,
                error: result.error,
              });
            } else {
              await repo.updateTask(task.id, {
                status: 'failed',
                error: result.error,
                retries,
                completedAt: new Date(),
              });
            }
          }

          // Save worker result
          await repo.saveWorkerResult(result);

          // Emit per-worker completed event
          this.emitEvent('fleet.worker.completed', {
            fleetId,
            taskId: task.id,
            workerName: workerConfig.name,
            workerType: workerConfig.type,
            success: result.success,
            output: (result.output ?? '').slice(0, 500),
            durationMs: result.durationMs ?? 0,
            costUsd: result.costUsd ?? 0,
          });

          return result;
        } finally {
          managed.activeWorkerCount--;
        }
      });

      const results = await Promise.allSettled(execPromises);

      // Aggregate results
      let cycleCost = 0;
      let tasksCompleted = 0;
      let tasksFailed = 0;

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          const result = r.value;
          cycleCost += result.costUsd ?? 0;
          if (result.success) {
            tasksCompleted++;
          } else {
            tasksFailed++;
          }
        } else if (r.status === 'rejected') {
          tasksFailed++;
        }
      }

      // Update session counters
      managed.session.cyclesCompleted++;
      managed.session.tasksCompleted += tasksCompleted;
      managed.session.tasksFailed += tasksFailed;
      managed.session.totalCostUsd += cycleCost;
      managed.session.activeWorkers = managed.activeWorkerCount;
      managed.cyclesThisHour++;
      managed.consecutiveErrors = 0;

      this.emitEvent('fleet.cycle.end', {
        fleetId,
        cycle: managed.session.cyclesCompleted,
        tasksCompleted,
        tasksFailed,
        cycleCost,
      });

      log.info(`[${fleetId}] Cycle ${managed.session.cyclesCompleted} done`, {
        tasksCompleted,
        tasksFailed,
        cycleCost,
      });
    } catch (error) {
      managed.consecutiveErrors++;
      const errMsg = getErrorMessage(error);
      log.error(`[${fleetId}] Cycle failed: ${errMsg}`);

      if (managed.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.error(`[${fleetId}] Too many consecutive errors, pausing fleet`);
        await this.pauseFleet(fleetId);
        return;
      }
    }

    // Schedule next cycle
    // For on-demand/event: auto-schedule follow-up if queued tasks remain
    const { scheduleType } = managed.config;
    if (scheduleType === 'on-demand' || scheduleType === 'event') {
      try {
        const remainingTasks = await repo.getReadyTasks(fleetId, 1);
        if (remainingTasks.length > 0) {
          // More tasks waiting — schedule another cycle immediately
          this.scheduleImmediate(fleetId);
          return;
        }
      } catch {
        // Non-critical: if check fails, just don't auto-schedule
      }
    }
    this.scheduleNextCycle(fleetId);
  }

  // ---------- Helpers ----------

  /**
   * Resolve which worker should handle a task.
   * If assignedWorker is set, use that. Otherwise round-robin.
   */
  private resolveWorker(
    config: FleetConfig,
    task: FleetTask
  ): FleetWorkerConfig | null {
    if (task.assignedWorker) {
      return config.workers.find((w) => w.name === task.assignedWorker) ?? null;
    }

    // Round-robin: pick first available worker
    if (config.workers.length === 0) return null;

    // Simple strategy: distribute by task ID hash
    const hash = simpleHash(task.id);
    const idx = hash % config.workers.length;
    return config.workers[idx] ?? config.workers[0] ?? null;
  }

  private async persistSession(fleetId: string): Promise<void> {
    const managed = this.fleets.get(fleetId);
    if (!managed) return;

    const repo = getFleetRepository();
    await repo.updateSession(managed.session.id, {
      state: managed.session.state,
      stoppedAt: managed.session.stoppedAt,
      cyclesCompleted: managed.session.cyclesCompleted,
      tasksCompleted: managed.session.tasksCompleted,
      tasksFailed: managed.session.tasksFailed,
      totalCostUsd: managed.session.totalCostUsd,
      activeWorkers: managed.activeWorkerCount,
      sharedContext: managed.session.sharedContext,
    });
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getEventSystem() as any).emit(eventType, 'fleet-manager', data);
    } catch {
      // Event system not available — non-critical
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ============================================================================
// Singleton
// ============================================================================

let _manager: FleetManager | null = null;

export function getFleetManager(): FleetManager {
  if (!_manager) {
    _manager = new FleetManager();
  }
  return _manager;
}

export function resetFleetManager(): void {
  _manager = null;
}
