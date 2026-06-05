/**
 * Claw Metrics
 *
 * Tracks rolling averages and observable metrics for Claw cycle execution.
 * Each claw gets its own collector instance so metrics are isolated.
 */

import type { ClawMetrics, ClawCycleSummary } from './claw-types.js';
import type { ClawCircuitSnapshot } from './claw-types.js';
import { safeDuration, safeCost } from '../../utils/safe-value.js';

interface ClawMetricsOptions {
  /** Window size for rolling averages (default: 10) */
  rollingWindowSize?: number;
}

const DEFAULT_WINDOW = 10;

export class ClawMetricsCollector {
  private cycleDurations: number[] = [];
  private cycleCosts: number[] = [];
  private readonly windowSize: number;

  constructor(options: ClawMetricsOptions = {}) {
    this.windowSize = options.rollingWindowSize ?? DEFAULT_WINDOW;
  }

  /**
   * Record a completed cycle.
   */
  recordCycle(summary: ClawCycleSummary): void {
    const duration = safeDuration(summary.durationMs);
    if (duration > 0) {
      this.cycleDurations.push(duration);
      if (this.cycleDurations.length > this.windowSize) {
        this.cycleDurations.shift();
      }
    }

    const cost = safeCost(summary.costUsd);
    if (cost > 0) {
      this.cycleCosts.push(cost);
      if (this.cycleCosts.length > this.windowSize) {
        this.cycleCosts.shift();
      }
    }
  }

  /**
   * Build a ClawMetrics snapshot from current state + circuit snapshot.
   */
  buildMetrics(
    clawId: string,
    circuitSnapshot: ClawCircuitSnapshot,
    summary: ClawCycleSummary
  ): ClawMetrics {
    const avgDuration =
      this.cycleDurations.length > 0
        ? Math.round(this.cycleDurations.reduce((a, b) => a + b, 0) / this.cycleDurations.length)
        : 0;

    const avgCost =
      this.cycleCosts.length > 0
        ? this.cycleCosts.reduce((a, b) => a + b, 0) / this.cycleCosts.length
        : 0;

    return {
      clawId,
      state: summary.state,
      circuitState: circuitSnapshot,
      consecutiveErrors: summary.consecutiveErrors,
      cyclesCompleted: 0, // filled by PulseMetricsService
      avgCycleDurationMs: avgDuration,
      cycleCost: safeCost(summary.costUsd),
      avgCycleCost: Math.round(avgCost * 1000) / 1000,
      totalCostUsd: safeCost(summary.totalCostUsd),
      lastCycleAt: new Date(),
      lastCycleError: null,
    };
  }

  /**
   * Get current rolling averages without building full snapshot.
   */
  getRollingAverages(): { avgDurationMs: number; avgCost: number } {
    const avgDuration =
      this.cycleDurations.length > 0
        ? Math.round(this.cycleDurations.reduce((a, b) => a + b, 0) / this.cycleDurations.length)
        : 0;
    const avgCost =
      this.cycleCosts.length > 0
        ? this.cycleCosts.reduce((a, b) => a + b, 0) / this.cycleCosts.length
        : 0;
    return { avgDurationMs: avgDuration, avgCost };
  }

  /** Reset all rolling metrics (e.g., on claw stop/reset) */
  reset(): void {
    this.cycleDurations = [];
    this.cycleCosts = [];
  }
}
