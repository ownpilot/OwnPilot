/**
 * ISubagentService - Ephemeral Subagent System Interface
 *
 * Lightweight, task-oriented child agents spawned by a parent (chat agent,
 * claw agent, or another subagent). Each subagent gets its own Agent
 * instance, runs a single task to completion, and reports results back.
 *
 * Usage:
 *   const subagent = registry.get(Services.Subagent);
 *   const session = await subagent.spawn({ ... });
 *   // ... later
 *   const result = subagent.getResult(session.id, userId);
 */

// ============================================================================
// Enums & Constants
// ============================================================================

/** Subagent lifecycle states */
export type SubagentState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/** Who can be a parent of a subagent */
export type SubagentParentType = 'chat' | 'claw' | 'subagent';

// ============================================================================
// Configuration Types
// ============================================================================

/** Resource limits for a single subagent */
export interface SubagentLimits {
  /** Max LLM turns (default: 20) */
  maxTurns: number;
  /** Max tool calls (default: 100) */
  maxToolCalls: number;
  /** Timeout in ms (default: 120000 = 2 min) */
  timeoutMs: number;
  /** Max tokens for this subagent's model response (default: 8192) */
  maxTokens: number;
}

/** Default resource limits */
export const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = {
  maxTurns: 20,
  maxToolCalls: 100,
  timeoutMs: 120_000,
  maxTokens: 8192,
};

/** Global resource budget for all subagents within one parent session */
export interface SubagentBudget {
  /** Max concurrent subagents per parent (default: 5) */
  maxConcurrent: number;
  /** Max total subagents spawned per conversation (default: 20) */
  maxTotalSpawns: number;
  /** Max total token budget across all subagents (0 = unlimited) */
  maxTotalTokens: number;
}

/** Default budget */
export const DEFAULT_SUBAGENT_BUDGET: SubagentBudget = {
  maxConcurrent: 5,
  maxTotalSpawns: 20,
  maxTotalTokens: 0,
};

/** Max nesting depth for subagent → sub-subagent spawning */
export const MAX_SUBAGENT_DEPTH = 2;

// ============================================================================
// Input Types
// ============================================================================

/** Configuration for spawning a subagent */
export interface SpawnSubagentInput {
  /** Parent context */
  parentId: string;
  parentType: SubagentParentType;
  userId: string;

  /** Task description */
  name: string;
  task: string;
  context?: string;

  /** Resource controls */
  limits?: Partial<SubagentLimits>;
  allowedTools?: string[];

  /** Model override (falls back to system model routing) */
  provider?: string;
  model?: string;

  /** Nesting depth (0 = top-level, 1 = sub-subagent) — managed internally */
  _depth?: number;
}

// ============================================================================
// Session Types
// ============================================================================

/** Individual tool call within a subagent execution */
export interface SubagentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  durationMs: number;
}

/** Runtime state of a subagent */
export interface SubagentSession {
  /** Unique subagent ID */
  id: string;
  /** Parent session ID */
  parentId: string;
  parentType: SubagentParentType;
  /** Owner user ID */
  userId: string;

  /** Task info */
  name: string;
  task: string;

  /** Lifecycle */
  state: SubagentState;
  spawnedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;

  /** Execution stats */
  turnsUsed: number;
  toolCallsUsed: number;
  tokensUsed: { prompt: number; completion: number } | null;
  durationMs: number | null;

  /** Results */
  result: string | null;
  error: string | null;

  /** Tool calls made during execution */
  toolCalls: SubagentToolCall[];

  /** Provider/model used */
  provider: string;
  model: string;

  /** Resource limits applied */
  limits: SubagentLimits;
}

// ============================================================================
// History Types
// ============================================================================

/** Persisted history entry */
export interface SubagentHistoryEntry {
  id: string;
  parentId: string;
  parentType: string;
  userId: string;
  name: string;
  task: string;
  state: SubagentState;
  result: string | null;
  error: string | null;
  toolCalls: SubagentToolCall[];
  turnsUsed: number;
  toolCallsUsed: number;
  tokensUsed: { prompt: number; completion: number } | null;
  durationMs: number | null;
  provider: string;
  model: string;
  spawnedAt: Date;
  completedAt: Date | null;
}

// ============================================================================
// ISubagentService
// ============================================================================

export interface ISubagentService {
  /** Spawn a new subagent (starts execution immediately, returns session) */
  spawn(input: SpawnSubagentInput): Promise<SubagentSession>;

  /** Get current state of a subagent */
  getSession(subagentId: string, userId: string): SubagentSession | null;

  /** List active subagents for a parent */
  listByParent(parentId: string, userId: string): SubagentSession[];

  /** Get result (returns current session state including result if complete) */
  getResult(subagentId: string, userId: string): SubagentSession | null;

  /** Cancel a running subagent */
  cancel(subagentId: string, userId: string): boolean;

  /** Get execution history from DB */
  getHistory(
    parentId: string,
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ entries: SubagentHistoryEntry[]; total: number }>;
}
