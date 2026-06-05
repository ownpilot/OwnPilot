/**
 * Heartbeat Metrics
 *
 * Tracks running averages and observable metrics for heartbeat cycles.
 */

import type { HeartbeatMetrics, HeartbeatTaskResult } from './types.js';
import type { HeartbeatCircuitSnapshot } from './heartbeat-circuit-breaker.js';
import { safeDuration, safeCost } from '../../utils/safe-value.js';

interface MetricsOptions {
  /** Window size for rolling averages (default: 10) */
  rollingWindowSize?: number;
}

const DEFAULT_WINDOW = 10;

export class HeartbeatMetricsCollector {
  private taskDurations: number[] = [];
  private cycleCosts: number[] = [];
  private readonly windowSize: number;

  constructor(options: MetricsOptions = {}) {
    this.windowSize = options.rollingWindowSize ?? DEFAULT_WINDOW;
  }

  /**
   * Record a completed task result to update running metrics.
   */
  recordTask(result: HeartbeatTaskResult): void {
    const duration = safeDuration(result.durationMs);
    if (duration > 0) {
      this.taskDurations.push(duration);
      if (this.taskDurations.length > this.windowSize) {
        this.taskDurations.shift();
      }
    }

    const cost = safeCost(result.cost);
    if (cost > 0) {
      this.cycleCosts.push(cost);
      if (this.cycleCosts.length > this.windowSize) {
        this.cycleCosts.shift();
      }
    }
  }

  /**
   * Build a HeartbeatMetrics snapshot from current state + task results.
   */
  buildMetrics(
    circuitSnapshot: HeartbeatCircuitSnapshot,
    taskResults: HeartbeatTaskResult[],
    currentCycleCost: number
  ): HeartbeatMetrics {
    const succeeded = taskResults.filter((r) => r.status === 'success').length;
    const failed = taskResults.filter((r) => r.status === 'failure').length;
    const skipped = taskResults.filter((r) => r.status === 'skipped').length;

    const avgDuration =
      this.taskDurations.length > 0
        ? Math.round(this.taskDurations.reduce((a, b) => a + b, 0) / this.taskDurations.length)
        : 0;

    const avgCost =
      this.cycleCosts.length > 0
        ? this.cycleCosts.reduce((a, b) => a + b, 0) / this.cycleCosts.length
        : 0;

    return {
      avgTaskDurationMs: avgDuration,
      circuitState: circuitSnapshot,
      consecutiveFailures: failed,
      tasksAttempted: taskResults.length,
      tasksSucceeded: succeeded,
      tasksSkipped: skipped,
      cycleCost: safeCost(currentCycleCost),
      avgCycleCost: Math.round(avgCost * 1000) / 1000,
    };
  }

  /** Reset all rolling metrics (e.g., on agent reset) */
  reset(): void {
    this.taskDurations = [];
    this.cycleCosts = [];
  }
}
