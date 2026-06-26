/**
 * Claw Monitoring — Type Definitions
 *
 * Types for Claw-specific circuit breaker and metrics tracking,
 * complementing the soul heartbeat monitoring system.
 */

import type { ClawState } from '../../services/claw-types.js';

// ============================================================================
// Circuit Breaker
// ============================================================================

export type ClawCircuitState = 'closed' | 'open' | 'half-open';

export interface ClawCircuitSnapshot {
  state: ClawCircuitState;
  failureCount: number;
  lastFailureAt: number;
  nextAttemptAt: number;
  consecutiveSuccesses: number;
}

// ============================================================================
// Metrics
// ============================================================================

/** Running metrics for a Claw agent */
export interface ClawMetrics {
  clawId: string;
  state: ClawState;
  circuitState: ClawCircuitSnapshot;
  consecutiveErrors: number;
  cyclesCompleted: number;
  avgCycleDurationMs: number;
  cycleCost: number;
  avgCycleCost: number;
  totalCostUsd: number;
  lastCycleAt: Date | null;
  lastCycleError: string | null;
}

/** Per-cycle summary emitted by ClawManager after each cycle */
export interface ClawCycleSummary {
  clawId: string;
  cycleNumber: number;
  success: boolean;
  durationMs: number;
  costUsd: number;
  toolCallsCount: number;
  consecutiveErrors: number;
  totalCostUsd: number;
  state: ClawState;
  error?: string | null;
}
