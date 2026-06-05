/**
 * Pulse Metrics Service
 *
 * Centralizes Pulse Engine monitoring for both souls (heartbeat) and claws.
 * Maintains per-agent/per-claw circuit breakers and metrics collectors,
 * subscribes to lifecycle events, and exposes aggregated status via REST.
 *
 * - ClawManager emits `claw.cycle.summary` after each cycle → we record it
 * - SoulHeartbeatService already emits `heartbeat.metrics` and `heartbeat.budget.warning`
 * - This service aggregates and provides `getPulseStatus()` for the REST API
 *
 * Architecture: event-driven, fully decoupled from ClawManager and HeartbeatRunner.
 */

import { getEventSystem, type EventHandler } from '@ownpilot/core';
import { ClawCircuitBreaker, ClawMetricsCollector, type ClawCycleSummary } from '@ownpilot/core';
import { getLog } from '../log.js';
import type { ClawState } from '@ownpilot/core';

const log = getLog('PulseMetricsService');

// Per-claw state
interface TrackedClaw {
  circuitBreaker: ClawCircuitBreaker;
  metricsCollector: ClawMetricsCollector;
  cyclesCompleted: number;
  lastSummary: ClawCycleSummary | null;
  registeredAt: number;
}

interface PulseClawStatus {
  clawId: string;
  state: ClawState;
  circuitState: 'closed' | 'open' | 'half-open';
  consecutiveErrors: number;
  avgCycleDurationMs: number;
  avgCycleCost: number;
  totalCostUsd: number;
  cyclesCompleted: number;
  lastCycleAt: Date | null;
  lastCycleError: string | null;
  circuitFailureCount: number;
  nextRetryAt: number | null;
}

export class PulseMetricsService {
  private claws = new Map<string, TrackedClaw>();
  private eventCleanup: Array<() => void> = [];
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;

    const eventSystem = getEventSystem();

    // Subscribe to claw cycle summaries
    const onCycleSummary: EventHandler = (event) => {
      const summary = (event as { payload?: ClawCycleSummary }).payload;
      if (!summary?.clawId) return;
      this.recordClawCycle(summary);
    };
    eventSystem.on('claw.cycle.summary' as never, onCycleSummary as EventHandler);
    this.eventCleanup.push(() =>
      eventSystem.off('claw.cycle.summary' as never, onCycleSummary as EventHandler)
    );

    // Register newly started claws
    const onClawStarted: EventHandler = (event) => {
      const payload = (event as { payload?: { clawId?: string } }).payload;
      if (payload?.clawId) this.registerClaw(payload.clawId);
    };
    eventSystem.on('claw.started' as never, onClawStarted as EventHandler);
    this.eventCleanup.push(() =>
      eventSystem.off('claw.started' as never, onClawStarted as EventHandler)
    );

    // Unregister stopped claws
    const onClawStopped: EventHandler = (event) => {
      const payload = (event as { payload?: { clawId?: string } }).payload;
      if (payload?.clawId) this.unregisterClaw(payload.clawId);
    };
    eventSystem.on('claw.stopped' as never, onClawStopped as EventHandler);
    this.eventCleanup.push(() =>
      eventSystem.off('claw.stopped' as never, onClawStopped as EventHandler)
    );

    log.info('[PulseMetricsService] started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const cleanup of this.eventCleanup) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
    this.eventCleanup = [];
    this.claws.clear();
    log.info('[PulseMetricsService] stopped');
  }

  /**
   * Register a claw for metrics tracking. Idempotent.
   */
  registerClaw(clawId: string): void {
    if (this.claws.has(clawId)) return;
    this.claws.set(clawId, {
      circuitBreaker: new ClawCircuitBreaker(),
      metricsCollector: new ClawMetricsCollector(),
      cyclesCompleted: 0,
      lastSummary: null,
      registeredAt: Date.now(),
    });
    log.info(`[PulseMetricsService] tracking claw ${clawId}`);
  }

  /**
   * Unregister a claw. Called on claw.stopped.
   */
  unregisterClaw(clawId: string): void {
    this.claws.delete(clawId);
    log.info(`[PulseMetricsService] stopped tracking claw ${clawId}`);
  }

  /**
   * Record a completed claw cycle.
   */
  private recordClawCycle(summary: ClawCycleSummary): void {
    let tracked = this.claws.get(summary.clawId);
    if (!tracked) {
      // Race: claw.started might not have fired yet. Register on first summary.
      this.registerClaw(summary.clawId);
      tracked = this.claws.get(summary.clawId)!;
    }

    tracked.cyclesCompleted = summary.cycleNumber;
    tracked.lastSummary = summary;

    // Update circuit breaker
    if (summary.success) {
      tracked.circuitBreaker.recordSuccess();
    } else {
      tracked.circuitBreaker.recordFailure();
    }

    // Record metrics
    tracked.metricsCollector.recordCycle(summary);

    log.info(`[PulseMetricsService] recorded cycle for ${summary.clawId}`, {
      success: summary.success,
      durationMs: summary.durationMs,
      costUsd: summary.costUsd,
      consecutiveErrors: summary.consecutiveErrors,
      circuitState: tracked.circuitBreaker.state,
    });
  }

  /**
   * Get current pulse status for all tracked claws.
   */
  getPulseClawStatus(): PulseClawStatus[] {
    const result: PulseClawStatus[] = [];
    for (const [clawId, tracked] of this.claws) {
      const snapshot = tracked.circuitBreaker.getSnapshot();
      const averages = tracked.metricsCollector.getRollingAverages();
      const lastSummary = tracked.lastSummary;

      result.push({
        clawId,
        state: lastSummary?.state ?? ('stopped' as ClawState),
        circuitState: snapshot.state,
        consecutiveErrors: lastSummary?.consecutiveErrors ?? 0,
        avgCycleDurationMs: averages.avgDurationMs,
        avgCycleCost: averages.avgCost,
        totalCostUsd: lastSummary?.totalCostUsd ?? 0,
        cyclesCompleted: tracked.cyclesCompleted,
        lastCycleAt: lastSummary ? new Date() : null,
        lastCycleError: null,
        circuitFailureCount: snapshot.failureCount,
        nextRetryAt: snapshot.nextAttemptAt > Date.now() ? snapshot.nextAttemptAt : null,
      });
    }
    return result;
  }

  /**
   * Get pulse status for a single claw.
   */
  getPulseClawStatusById(clawId: string): PulseClawStatus | null {
    const tracked = this.claws.get(clawId);
    if (!tracked) return null;

    const snapshot = tracked.circuitBreaker.getSnapshot();
    const averages = tracked.metricsCollector.getRollingAverages();
    const lastSummary = tracked.lastSummary;

    return {
      clawId,
      state: lastSummary?.state ?? ('stopped' as ClawState),
      circuitState: snapshot.state,
      consecutiveErrors: lastSummary?.consecutiveErrors ?? 0,
      avgCycleDurationMs: averages.avgDurationMs,
      avgCycleCost: averages.avgCost,
      totalCostUsd: lastSummary?.totalCostUsd ?? 0,
      cyclesCompleted: tracked.cyclesCompleted,
      lastCycleAt: lastSummary ? new Date() : null,
      lastCycleError: null,
      circuitFailureCount: snapshot.failureCount,
      nextRetryAt: snapshot.nextAttemptAt > Date.now() ? snapshot.nextAttemptAt : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton (for ServiceRegistry)
// ---------------------------------------------------------------------------

let instance: PulseMetricsService | null = null;

export function getPulseMetricsService(): PulseMetricsService {
  if (!instance) {
    instance = new PulseMetricsService();
    instance.start();
  }
  return instance;
}

/**
 * Returns the instance for ServiceRegistry factory use.
 * Does NOT auto-start — caller is responsible for lifecycle.
 */
export function getPulseMetricsServiceForRegistry(): PulseMetricsService {
  if (!instance) {
    instance = new PulseMetricsService();
  }
  return instance;
}

/**
 * Stop and null the singleton. Call during shutdown or reset.
 */
export function resetPulseMetricsService(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
