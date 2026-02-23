/**
 * Pulse Evaluator
 *
 * Pure-function rule-based quick checks that decide whether an LLM call
 * is warranted. Each rule produces a Signal with severity; the set of
 * signals drives urgency scoring and adaptive interval calculation.
 */

import type { PulseContext } from './context.js';
import {
  PULSE_MIN_INTERVAL_MS,
  PULSE_MAX_INTERVAL_MS,
} from '../config/defaults.js';

// ============================================================================
// Types
// ============================================================================

export type SignalSeverity = 'info' | 'warning' | 'critical';

export interface Signal {
  /** Machine-readable signal ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** Brief description */
  description: string;
  /** Severity level */
  severity: SignalSeverity;
}

export interface EvaluationResult {
  /** Whether to invoke the LLM */
  shouldCallLLM: boolean;
  /** Detected signals */
  signals: Signal[];
  /** Urgency score 0-100 */
  urgencyScore: number;
}

// ============================================================================
// Severity weights for urgency calculation
// ============================================================================

const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  info: 10,
  warning: 25,
  critical: 50,
};

// ============================================================================
// Rules
// ============================================================================

type RuleFn = (ctx: PulseContext) => Signal | null;

const rules: RuleFn[] = [
  // 1. Stale goals — not updated in >3 days
  (ctx) => {
    if (ctx.goals.stale.length === 0) return null;
    return {
      id: 'stale_goals',
      label: 'Stale Goals',
      description: `${ctx.goals.stale.length} goal(s) not updated in >3 days`,
      severity: 'warning',
    };
  },

  // 2. Upcoming deadline — goal due within 3 days
  (ctx) => {
    const urgent = ctx.goals.upcoming.filter((g) => g.daysUntilDue <= 3);
    if (urgent.length === 0) return null;
    return {
      id: 'upcoming_deadline',
      label: 'Upcoming Deadline',
      description: `${urgent.length} goal(s) due within 3 days`,
      severity: 'critical',
    };
  },

  // 3. No user activity in >2 days
  (ctx) => {
    if (ctx.activity.hasRecentActivity) return null;
    return {
      id: 'no_activity',
      label: 'No Recent Activity',
      description: `No user activity for ${ctx.activity.daysSinceLastActivity} day(s)`,
      severity: 'info',
    };
  },

  // 4. Low progress — active goal with progress <10%
  (ctx) => {
    const lowProgress = ctx.goals.active.filter((g) => g.progress < 10);
    if (lowProgress.length === 0) return null;
    return {
      id: 'low_progress',
      label: 'Low Progress',
      description: `${lowProgress.length} goal(s) below 10% progress`,
      severity: 'warning',
    };
  },

  // 5. Memory cleanup — too many memories, low avg importance
  (ctx) => {
    if (ctx.memories.total <= 500 || ctx.memories.avgImportance >= 0.3) return null;
    return {
      id: 'memory_cleanup',
      label: 'Memory Cleanup',
      description: `${ctx.memories.total} memories with avg importance ${ctx.memories.avgImportance.toFixed(2)}`,
      severity: 'info',
    };
  },

  // 6. Pending approvals
  (ctx) => {
    if (ctx.systemHealth.pendingApprovals === 0) return null;
    return {
      id: 'pending_approvals',
      label: 'Pending Approvals',
      description: `${ctx.systemHealth.pendingApprovals} action(s) awaiting approval`,
      severity: 'warning',
    };
  },

  // 7. Trigger errors in last 24h
  (ctx) => {
    if (ctx.systemHealth.triggerErrors <= 2) return null;
    return {
      id: 'trigger_errors',
      label: 'Trigger Errors',
      description: `${ctx.systemHealth.triggerErrors} trigger failure(s) in last 24h`,
      severity: 'warning',
    };
  },
];

// ============================================================================
// Evaluator
// ============================================================================

/**
 * Evaluate pulse context against all rules.
 * Pure function — no side effects or service dependencies.
 */
export function evaluatePulseContext(ctx: PulseContext): EvaluationResult {
  const signals: Signal[] = [];

  for (const rule of rules) {
    const signal = rule(ctx);
    if (signal) {
      signals.push(signal);
    }
  }

  // Urgency score: sum of severity weights, clamped to 0-100
  const rawScore = signals.reduce((sum, s) => sum + SEVERITY_WEIGHT[s.severity], 0);
  const urgencyScore = Math.min(100, rawScore);

  return {
    shouldCallLLM: signals.length > 0,
    signals,
    urgencyScore,
  };
}

/**
 * Calculate the next pulse interval based on urgency score.
 * Higher urgency → shorter interval.
 */
export function calculateNextInterval(
  urgencyScore: number,
  minMs = PULSE_MIN_INTERVAL_MS,
  maxMs = PULSE_MAX_INTERVAL_MS
): number {
  const clamped = Math.max(0, Math.min(100, urgencyScore));
  return Math.round(maxMs - (clamped / 100) * (maxMs - minMs));
}
