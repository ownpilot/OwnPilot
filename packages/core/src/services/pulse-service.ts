/**
 * IPulseService - Autonomy Engine Pulse Interface
 *
 * The pulse system is an AI-driven autonomous layer that proactively
 * gathers context, evaluates signals, and takes actions without
 * user prompting. Runs on an adaptive interval (5-15 min).
 *
 * Usage:
 *   const pulse = registry.get(Services.Pulse);
 *   const result = await pulse.runPulse(userId);
 */

// ============================================================================
// Types
// ============================================================================

export interface PulseActionResult {
  /** Action type (e.g. 'create_memory', 'update_goal_progress') */
  type: string;
  /** Whether the action executed successfully */
  success: boolean;
  /** Action output data */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** Whether the action was skipped (e.g. risk too high) */
  skipped?: boolean;
}

export interface PulseResult {
  /** Unique pulse cycle ID */
  pulseId: string;
  /** User this pulse ran for */
  userId: string;
  /** When the pulse ran */
  pulsedAt: Date;
  /** Total pulse duration in ms */
  durationMs: number;
  /** Number of signals detected by the evaluator */
  signalsFound: number;
  /** Whether an LLM call was made */
  llmCalled: boolean;
  /** Results of executed actions */
  actionsExecuted: PulseActionResult[];
  /** Human-readable report message from the LLM */
  reportMessage: string;
  /** Urgency score (0-100) driving adaptive interval */
  urgencyScore: number;
  /** Error message if pulse failed */
  error?: string;
  /** Whether this was a manually triggered pulse */
  manual: boolean;
  /** IDs of signals that fired during evaluation */
  signalIds?: string[];
}

export interface PulseStats {
  /** Total number of pulse cycles */
  totalPulses: number;
  /** Percentage of pulses that invoked the LLM */
  llmCallRate: number;
  /** Average pulse duration in ms */
  avgDurationMs: number;
  /** Total actions executed across all pulses */
  actionsExecuted: number;
}

export interface AutonomyLogEntry {
  id: string;
  userId: string;
  pulsedAt: Date;
  durationMs: number;
  signalsFound: number;
  llmCalled: boolean;
  actionsCount: number;
  actions: PulseActionResult[];
  reportMsg: string | null;
  error: string | null;
  manual: boolean;
  signalIds: string[];
  urgencyScore: number;
}

// ============================================================================
// IPulseService
// ============================================================================

export interface IPulseService {
  /** Start the autonomous pulse timer */
  start(): void;
  /** Stop the pulse timer */
  stop(): void;
  /** Check if the engine is currently running */
  isRunning(): boolean;
  /** Manually trigger a single pulse cycle */
  runPulse(userId: string, manual?: boolean): Promise<PulseResult>;
  /** Get recent autonomy log entries */
  getRecentLogs(userId: string, limit?: number): Promise<AutonomyLogEntry[]>;
  /** Get aggregate pulse statistics */
  getStats(userId: string): Promise<PulseStats>;
}
