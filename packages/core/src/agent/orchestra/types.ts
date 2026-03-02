/**
 * Agent Orchestra Types
 *
 * Multi-agent collaboration via structured plan execution.
 * The orchestra layer builds on top of the subagent system,
 * adding named agent delegation, DAG-based task dependencies,
 * and per-agent provider routing.
 */

// ============================================================================
// Task & Plan Types
// ============================================================================

/** Strategy for executing tasks in an orchestra plan */
export type OrchestraStrategy = 'sequential' | 'parallel' | 'dag';

/** Execution state of an orchestra plan */
export type OrchestraState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/** A single task in an orchestra plan */
export interface AgentTask {
  /** Unique task ID within the plan */
  id: string;
  /** Named agent to delegate to (matches agents table name) */
  agentName: string;
  /** Task description (what the agent should do) */
  input: string;
  /** Shared context from parent or previous tasks */
  context?: Record<string, unknown>;
  /** Task IDs that must complete before this task starts */
  dependsOn?: string[];
  /** Per-task timeout in ms (overrides plan-level) */
  timeout?: number;
  /** If true, failure doesn't block the pipeline */
  optional?: boolean;
  /** Override provider for this specific task */
  provider?: string;
  /** Override model for this specific task */
  model?: string;
}

/** An orchestra plan — a set of tasks with execution strategy */
export interface OrchestraPlan {
  /** Plan description (for audit) */
  description: string;
  /** Ordered list of tasks (order matters for sequential strategy) */
  tasks: AgentTask[];
  /** Execution strategy */
  strategy: OrchestraStrategy;
  /** Maximum total cost budget (USD). 0 = unlimited. */
  maxCost?: number;
  /** Maximum total duration in ms. 0 = unlimited. */
  maxDuration?: number;
}

// ============================================================================
// Result Types
// ============================================================================

/** Result of a single task execution */
export interface OrchestraTaskResult {
  taskId: string;
  agentName: string;
  /** Subagent session ID (from SubagentManager) */
  subagentId: string;
  output: string;
  toolsUsed: string[];
  tokenUsage: { prompt: number; completion: number };
  durationMs: number;
  success: boolean;
  error?: string;
}

/** Result of a full plan execution */
export interface OrchestraExecution {
  id: string;
  parentId: string;
  userId: string;
  plan: OrchestraPlan;
  state: OrchestraState;
  taskResults: OrchestraTaskResult[];
  totalDurationMs: number;
  startedAt: Date;
  completedAt: Date | null;
  error?: string;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface IOrchestraService {
  /**
   * Execute an orchestra plan.
   * Returns execution result with all task outcomes.
   */
  executePlan(plan: OrchestraPlan, parentId: string, userId: string): Promise<OrchestraExecution>;

  /** Get a running or completed execution by ID */
  getExecution(executionId: string): OrchestraExecution | null;

  /** List executions for a parent (conversation) */
  listByParent(parentId: string): OrchestraExecution[];

  /** Cancel a running execution */
  cancel(executionId: string): void;

  /** Get execution history from DB */
  getHistory(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ entries: OrchestraExecution[]; total: number }>;
}

// ============================================================================
// Delegation Types (for delegate_to_agent tool)
// ============================================================================

/** Input for delegating a task to a named agent */
export interface DelegateToAgentInput {
  /** Agent name (e.g., "Code Assistant", "Research Assistant") */
  agentName: string;
  /** Task description */
  task: string;
  /** Additional context */
  context?: string;
  /** Wait for result before continuing (default true) */
  waitForResult?: boolean;
}

/** Result of a delegation */
export interface DelegationResult {
  /** Subagent session ID */
  subagentId: string;
  /** Agent name that was delegated to */
  agentName: string;
  /** Whether delegation is still running */
  running: boolean;
  /** Result text (if complete) */
  result?: string;
  /** Tools used by the delegated agent */
  toolsUsed: string[];
  /** Duration in ms (if complete) */
  durationMs?: number;
  /** Error (if failed) */
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default limits for orchestra plan execution */
export const DEFAULT_ORCHESTRA_LIMITS = {
  /** Maximum tasks in a single plan */
  maxTasks: 10,
  /** Maximum total plan duration (5 minutes) */
  maxDurationMs: 300_000,
  /** Maximum concurrent tasks */
  maxConcurrent: 5,
} as const;
