/**
 * IBackgroundAgentService - Background Agent System Interface
 *
 * Persistent, long-running agents that execute continuously in the background.
 * Each agent has its own mission, tools, execution loop, and persistent context.
 *
 * Execution modes:
 * - continuous: Fast loop (adaptive 500ms-2s between cycles)
 * - interval: Periodic execution (configurable, default 5 min)
 * - event: Reactive to EventBus events
 *
 * Usage:
 *   const bgAgent = registry.get(Services.BackgroundAgent);
 *   const config = await bgAgent.createAgent({ ... });
 *   await bgAgent.startAgent(config.id, userId);
 */

// ============================================================================
// Enums & Constants
// ============================================================================

/** Execution mode for background agents */
export type BackgroundAgentMode = 'continuous' | 'interval' | 'event';

/** Session lifecycle states */
export type BackgroundAgentState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'stopped';

/** Who created this background agent */
export type BackgroundAgentCreator = 'user' | 'ai';

// ============================================================================
// Configuration Types
// ============================================================================

/** Resource limits to prevent runaway agents */
export interface BackgroundAgentLimits {
  /** Max LLM turns per execution cycle (default: 10) */
  maxTurnsPerCycle: number;
  /** Max tool calls per execution cycle (default: 50) */
  maxToolCallsPerCycle: number;
  /** Max cycles per hour (default: 60 for continuous, 12 for interval) */
  maxCyclesPerHour: number;
  /** Timeout per cycle in ms (default: 120000 = 2 min) */
  cycleTimeoutMs: number;
  /** Optional total budget cap in USD */
  totalBudgetUsd?: number;
}

/** Default resource limits */
export const DEFAULT_BACKGROUND_AGENT_LIMITS: BackgroundAgentLimits = {
  maxTurnsPerCycle: 10,
  maxToolCallsPerCycle: 50,
  maxCyclesPerHour: 60,
  cycleTimeoutMs: 120_000,
};

/** Persisted agent configuration */
export interface BackgroundAgentConfig {
  /** Unique agent ID */
  id: string;
  /** Owner user ID */
  userId: string;
  /** Display name */
  name: string;
  /** Agent mission / system prompt */
  mission: string;
  /** Execution mode */
  mode: BackgroundAgentMode;
  /** Tool IDs this agent can use (qualified names) */
  allowedTools: string[];
  /** Resource limits */
  limits: BackgroundAgentLimits;
  /** Interval in ms for 'interval' mode (default: 300000 = 5 min) */
  intervalMs?: number;
  /** Event types to listen for in 'event' mode */
  eventFilters?: string[];
  /** Whether to auto-start on server boot */
  autoStart: boolean;
  /** Optional stop condition (e.g. 'max_cycles:100') */
  stopCondition?: string;
  /** Who created this agent */
  createdBy: BackgroundAgentCreator;
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new background agent */
export interface CreateBackgroundAgentInput {
  userId: string;
  name: string;
  mission: string;
  mode: BackgroundAgentMode;
  allowedTools?: string[];
  limits?: Partial<BackgroundAgentLimits>;
  intervalMs?: number;
  eventFilters?: string[];
  autoStart?: boolean;
  stopCondition?: string;
  createdBy?: BackgroundAgentCreator;
}

/** Input for updating an existing background agent */
export interface UpdateBackgroundAgentInput {
  name?: string;
  mission?: string;
  mode?: BackgroundAgentMode;
  allowedTools?: string[];
  limits?: Partial<BackgroundAgentLimits>;
  intervalMs?: number;
  eventFilters?: string[];
  autoStart?: boolean;
  stopCondition?: string;
}

// ============================================================================
// Session Types
// ============================================================================

/** Runtime session state (in-memory + persisted) */
export interface BackgroundAgentSession {
  /** Agent configuration */
  config: BackgroundAgentConfig;
  /** Current lifecycle state */
  state: BackgroundAgentState;
  /** Number of completed execution cycles */
  cyclesCompleted: number;
  /** Total tool calls across all cycles */
  totalToolCalls: number;
  /** Estimated total cost in USD */
  totalCostUsd: number;
  /** When the last cycle ran */
  lastCycleAt: Date | null;
  /** Duration of last cycle in ms */
  lastCycleDurationMs: number | null;
  /** Error from last cycle (if any) */
  lastCycleError: string | null;
  /** When the session was started */
  startedAt: Date;
  /** When the session was stopped (if applicable) */
  stoppedAt: Date | null;
  /** Persistent context (agent's working memory across cycles) */
  persistentContext: Record<string, unknown>;
  /** Inbox messages from user/other agents */
  inbox: string[];
}

// ============================================================================
// Cycle Result Types
// ============================================================================

/** Result of a single execution cycle */
export interface BackgroundAgentCycleResult {
  /** Whether the cycle completed successfully */
  success: boolean;
  /** Tool calls made during the cycle */
  toolCalls: BackgroundAgentToolCall[];
  /** Output message from the LLM */
  outputMessage: string;
  /** Token usage (if available) */
  tokensUsed?: { prompt: number; completion: number };
  /** Estimated cost in USD */
  costUsd?: number;
  /** Total cycle duration in ms */
  durationMs: number;
  /** Number of LLM turns taken */
  turns: number;
  /** Error message if failed */
  error?: string;
}

/** Individual tool call within a cycle */
export interface BackgroundAgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  duration: number;
}

/** Persisted history entry */
export interface BackgroundAgentHistoryEntry {
  id: string;
  agentId: string;
  cycleNumber: number;
  success: boolean;
  toolCalls: BackgroundAgentToolCall[];
  outputMessage: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  turns: number;
  error?: string;
  executedAt: Date;
}

// ============================================================================
// IBackgroundAgentService
// ============================================================================

export interface IBackgroundAgentService {
  // ---- Agent Configuration CRUD ----

  /** Create a new background agent configuration */
  createAgent(input: CreateBackgroundAgentInput): Promise<BackgroundAgentConfig>;

  /** Get a background agent by ID */
  getAgent(agentId: string, userId: string): Promise<BackgroundAgentConfig | null>;

  /** List all background agents for a user */
  listAgents(userId: string): Promise<BackgroundAgentConfig[]>;

  /** Update a background agent configuration */
  updateAgent(
    agentId: string,
    userId: string,
    updates: UpdateBackgroundAgentInput
  ): Promise<BackgroundAgentConfig | null>;

  /** Delete a background agent (stops it first if running) */
  deleteAgent(agentId: string, userId: string): Promise<boolean>;

  // ---- Session Lifecycle ----

  /** Start a background agent */
  startAgent(agentId: string, userId: string): Promise<BackgroundAgentSession>;

  /** Pause a running agent (preserves state) */
  pauseAgent(agentId: string, userId: string): Promise<boolean>;

  /** Resume a paused agent */
  resumeAgent(agentId: string, userId: string): Promise<boolean>;

  /** Stop a running/paused agent */
  stopAgent(agentId: string, userId: string): Promise<boolean>;

  // ---- Session Queries ----

  /** Get the current session for an agent (null if not running) */
  getSession(agentId: string, userId: string): BackgroundAgentSession | null;

  /** List all active sessions for a user */
  listSessions(userId: string): BackgroundAgentSession[];

  // ---- Execution History ----

  /** Get cycle history for an agent */
  getHistory(
    agentId: string,
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ entries: BackgroundAgentHistoryEntry[]; total: number }>;

  // ---- Communication ----

  /** Send a message to a running agent's inbox (processed next cycle) */
  sendMessage(agentId: string, userId: string, message: string): Promise<void>;

  // ---- Service Lifecycle ----

  /** Start the service: resume autoStart agents + interrupted sessions */
  start(): Promise<void>;

  /** Stop the service: graceful shutdown of all agents */
  stop(): Promise<void>;
}
