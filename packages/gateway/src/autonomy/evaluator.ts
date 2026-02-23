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

export interface RuleThresholds {
  staleDays: number;
  deadlineDays: number;
  activityDays: number;
  lowProgressPct: number;
  memoryMaxCount: number;
  memoryMinImportance: number;
  triggerErrorMin: number;
}

export const DEFAULT_RULE_THRESHOLDS: RuleThresholds = {
  staleDays: 3,
  deadlineDays: 3,
  activityDays: 2,
  lowProgressPct: 10,
  memoryMaxCount: 500,
  memoryMinImportance: 0.3,
  triggerErrorMin: 3,
};

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
// Rule Definitions (exported for UI)
// ============================================================================

export const RULE_DEFINITIONS = [
  { id: 'stale_goals', label: 'Stale Goals', description: 'Goals not updated in >3 days', thresholdKey: 'staleDays' as const },
  { id: 'upcoming_deadline', label: 'Upcoming Deadline', description: 'Goals due within 3 days', thresholdKey: 'deadlineDays' as const },
  { id: 'no_activity', label: 'No Recent Activity', description: 'No user activity for >2 days', thresholdKey: null },
  { id: 'low_progress', label: 'Low Progress', description: 'Active goals below 10% progress', thresholdKey: 'lowProgressPct' as const },
  { id: 'memory_cleanup', label: 'Memory Cleanup', description: 'Too many low-importance memories', thresholdKey: 'memoryMaxCount' as const },
  { id: 'pending_approvals', label: 'Pending Approvals', description: 'Actions awaiting approval', thresholdKey: null },
  { id: 'trigger_errors', label: 'Trigger Errors', description: 'Trigger failures in last 24h', thresholdKey: 'triggerErrorMin' as const },
] as const;

// ============================================================================
// Rules
// ============================================================================

type RuleFn = (ctx: PulseContext, thresholds: RuleThresholds) => Signal | null;

interface Rule {
  id: string;
  fn: RuleFn;
}

const rules: Rule[] = [
  // 1. Stale goals — not updated in >N days
  {
    id: 'stale_goals',
    fn: (ctx, _thresholds) => {
      if (ctx.goals.stale.length === 0) return null;
      return {
        id: 'stale_goals',
        label: 'Stale Goals',
        description: `${ctx.goals.stale.length} goal(s) not updated recently`,
        severity: 'warning',
      };
    },
  },

  // 2. Upcoming deadline — goal due within N days
  {
    id: 'upcoming_deadline',
    fn: (ctx, thresholds) => {
      const urgent = ctx.goals.upcoming.filter((g) => g.daysUntilDue <= thresholds.deadlineDays);
      if (urgent.length === 0) return null;
      return {
        id: 'upcoming_deadline',
        label: 'Upcoming Deadline',
        description: `${urgent.length} goal(s) due within ${thresholds.deadlineDays} days`,
        severity: 'critical',
      };
    },
  },

  // 3. No user activity
  {
    id: 'no_activity',
    fn: (ctx, _thresholds) => {
      if (ctx.activity.hasRecentActivity) return null;
      return {
        id: 'no_activity',
        label: 'No Recent Activity',
        description: `No user activity for ${ctx.activity.daysSinceLastActivity} day(s)`,
        severity: 'info',
      };
    },
  },

  // 4. Low progress — active goal with progress <N%
  {
    id: 'low_progress',
    fn: (ctx, thresholds) => {
      const lowProgress = ctx.goals.active.filter((g) => g.progress < thresholds.lowProgressPct);
      if (lowProgress.length === 0) return null;
      return {
        id: 'low_progress',
        label: 'Low Progress',
        description: `${lowProgress.length} goal(s) below ${thresholds.lowProgressPct}% progress`,
        severity: 'warning',
      };
    },
  },

  // 5. Memory cleanup — too many memories, low avg importance
  {
    id: 'memory_cleanup',
    fn: (ctx, thresholds) => {
      if (ctx.memories.total <= thresholds.memoryMaxCount || ctx.memories.avgImportance >= thresholds.memoryMinImportance) return null;
      return {
        id: 'memory_cleanup',
        label: 'Memory Cleanup',
        description: `${ctx.memories.total} memories with avg importance ${ctx.memories.avgImportance.toFixed(2)}`,
        severity: 'info',
      };
    },
  },

  // 6. Pending approvals
  {
    id: 'pending_approvals',
    fn: (ctx, _thresholds) => {
      if (ctx.systemHealth.pendingApprovals === 0) return null;
      return {
        id: 'pending_approvals',
        label: 'Pending Approvals',
        description: `${ctx.systemHealth.pendingApprovals} action(s) awaiting approval`,
        severity: 'warning',
      };
    },
  },

  // 7. Trigger errors in last 24h
  {
    id: 'trigger_errors',
    fn: (ctx, thresholds) => {
      const threshold = thresholds.triggerErrorMin - 1;
      if (ctx.systemHealth.triggerErrors <= threshold) return null;
      return {
        id: 'trigger_errors',
        label: 'Trigger Errors',
        description: `${ctx.systemHealth.triggerErrors} trigger failure(s) in last 24h`,
        severity: 'warning',
      };
    },
  },
];

// ============================================================================
// Evaluator
// ============================================================================

/**
 * Evaluate pulse context against all rules.
 * Pure function — no side effects or service dependencies.
 */
export function evaluatePulseContext(
  ctx: PulseContext,
  disabledRules: string[] = [],
  thresholds: RuleThresholds = DEFAULT_RULE_THRESHOLDS
): EvaluationResult {
  const signals: Signal[] = [];

  for (const rule of rules) {
    if (disabledRules.includes(rule.id)) continue;
    const signal = rule.fn(ctx, thresholds);
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
