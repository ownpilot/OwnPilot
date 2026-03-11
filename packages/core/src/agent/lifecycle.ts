/**
 * Agent Lifecycle Abstraction
 *
 * Unified interface for all 6 agent types (regular, coding, background,
 * soul, subagent, orchestra). Provides a common state machine,
 * lifecycle methods, and resource tracking.
 */

// ============================================================================
// Types
// ============================================================================

/** All possible agent types in the system. */
export type AgentType =
  | 'regular'
  | 'coding'
  | 'background'
  | 'soul'
  | 'subagent'
  | 'orchestra';

/**
 * Unified agent state. Each agent type maps its internal states to these.
 * Mapping:
 *   Regular:    isProcessing → running, else idle
 *   Coding:     starting → starting, running/waiting → running, completed → completed, failed → failed, terminated → cancelled
 *   Background: starting → starting, running/waiting → running, paused → paused, completed → completed, failed → failed, stopped → cancelled
 *   Soul:       heartbeat executing → running, idle → idle
 *   Subagent:   pending → starting, running → running, completed → completed, failed → failed, cancelled → cancelled, timeout → failed
 *   Orchestra:  running → running, completed → completed, failed → failed, cancelled → cancelled
 */
export type UnifiedAgentState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Resource usage metrics for cross-agent observability. */
export interface ResourceMetrics {
  /** Total input + output tokens consumed */
  tokensUsed: number;
  /** Number of tool calls made */
  toolCallsUsed: number;
  /** Estimated cost in USD */
  costUsd: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

/** Input to an agent execute call. */
export interface AgentInput {
  /** Task description or message */
  task: string;
  /** Additional context for execution */
  context?: Record<string, unknown>;
}

/** Result from an agent execution. */
export interface AgentResult {
  /** Whether the execution was successful */
  success: boolean;
  /** Execution output */
  output?: string;
  /** Error message on failure */
  error?: string;
  /** Resource usage during this execution */
  metrics: ResourceMetrics;
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Unified lifecycle interface for all agent types.
 *
 * Not all methods apply to all agent types — `pause()` and `resume()`
 * are only meaningful for background agents. Implementations that don't
 * support these should throw or no-op.
 */
export interface IAgentLifecycle {
  /** Unique identifier */
  readonly id: string;
  /** Agent type discriminator */
  readonly type: AgentType;

  /** Get the unified state. */
  getState(): UnifiedAgentState;

  /** Execute a task (semantics vary by type). */
  execute(input: AgentInput): Promise<AgentResult>;

  /** Cancel the current execution. */
  cancel(): Promise<void>;

  /** Pause execution (background agents only). */
  pause?(): Promise<void>;

  /** Resume execution (background agents only). */
  resume?(): Promise<void>;

  /** Get resource usage metrics. */
  getResourceUsage(): ResourceMetrics;
}

// ============================================================================
// Base class
// ============================================================================

/**
 * Abstract base class with common lifecycle bookkeeping.
 * Tracks state transitions, accumulated resource metrics, and timestamps.
 */
export abstract class BaseAgentLifecycle implements IAgentLifecycle {
  abstract readonly id: string;
  abstract readonly type: AgentType;

  protected _state: UnifiedAgentState = 'idle';
  protected _metrics: ResourceMetrics = {
    tokensUsed: 0,
    toolCallsUsed: 0,
    costUsd: 0,
    durationMs: 0,
  };
  protected _startedAt: number | null = null;

  getState(): UnifiedAgentState {
    return this._state;
  }

  getResourceUsage(): ResourceMetrics {
    // If currently running, include elapsed wall-clock time
    if (this._startedAt !== null && this._state === 'running') {
      return {
        ...this._metrics,
        durationMs: this._metrics.durationMs + (Date.now() - this._startedAt),
      };
    }
    return { ...this._metrics };
  }

  /** Transition to a new state with validation. */
  protected transition(newState: UnifiedAgentState): void {
    this._state = newState;
    if (newState === 'running' && this._startedAt === null) {
      this._startedAt = Date.now();
    }
    if (
      newState === 'completed' ||
      newState === 'failed' ||
      newState === 'cancelled'
    ) {
      if (this._startedAt !== null) {
        this._metrics.durationMs += Date.now() - this._startedAt;
        this._startedAt = null;
      }
    }
  }

  /** Accumulate resource metrics from a sub-execution. */
  protected accumulateMetrics(partial: Partial<ResourceMetrics>): void {
    if (partial.tokensUsed) this._metrics.tokensUsed += partial.tokensUsed;
    if (partial.toolCallsUsed) this._metrics.toolCallsUsed += partial.toolCallsUsed;
    if (partial.costUsd) this._metrics.costUsd += partial.costUsd;
    if (partial.durationMs) this._metrics.durationMs += partial.durationMs;
  }

  abstract execute(input: AgentInput): Promise<AgentResult>;
  abstract cancel(): Promise<void>;
}
