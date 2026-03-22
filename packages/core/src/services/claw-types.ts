/**
 * Claw — Unified Autonomous Agent Runtime Types
 *
 * A Claw agent combines: LLM brain + workspace + soul identity + coding agents +
 * sandbox execution + all 250+ tools into a single autonomous runtime.
 *
 * Execution modes:
 * - cyclic: Repeated execution with scheduling (continuous, interval, event)
 * - single-shot: One execution, auto-stop on completion (like Subagent)
 *
 * Usage:
 *   const clawService = registry.get(Services.Claw);
 *   const config = await clawService.createClaw({ ... });
 *   await clawService.startClaw(config.id, userId);
 */

import type { AutonomousAgentResult } from './agent-execution-result.js';

// ============================================================================
// Enums & Constants
// ============================================================================

/** Claw execution mode */
export type ClawMode = 'continuous' | 'interval' | 'event' | 'single-shot';

/** Claw session lifecycle states */
export type ClawState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'escalation_pending';

/** Sandbox execution mode for scripts */
export type ClawSandboxMode = 'docker' | 'local' | 'auto';

/** Who created this claw */
export type ClawCreator = 'user' | 'ai' | 'claw';

/** Maximum subclaw nesting depth */
export const MAX_CLAW_DEPTH = 3;

// ============================================================================
// Configuration Types
// ============================================================================

/** Resource limits for claws — generous defaults, each claw is an autonomous agent */
export interface ClawLimits {
  /** Max LLM turns per execution cycle (default: 50) */
  maxTurnsPerCycle: number;
  /** Max tool calls per execution cycle (default: 500) */
  maxToolCallsPerCycle: number;
  /** Max cycles per hour (default: 120) */
  maxCyclesPerHour: number;
  /** Timeout per cycle in ms (default: 600000 = 10 min) */
  cycleTimeoutMs: number;
  /** Optional total budget cap in USD — undefined = unlimited */
  totalBudgetUsd?: number;
}

/**
 * Default resource limits — generous by design.
 * Each claw should feel like it has unlimited resources.
 * Budget is undefined (unlimited) by default.
 */
export const DEFAULT_CLAW_LIMITS: ClawLimits = {
  maxTurnsPerCycle: 50,
  maxToolCallsPerCycle: 500,
  maxCyclesPerHour: 120,
  cycleTimeoutMs: 600_000,
};

/** Persisted claw configuration */
export interface ClawConfig {
  id: string;
  userId: string;
  name: string;
  mission: string;
  mode: ClawMode;
  allowedTools: string[];
  limits: ClawLimits;
  /** Interval in ms for interval mode (default: 300000 = 5 min) */
  intervalMs?: number;
  /** Event types to listen for in event mode */
  eventFilters?: string[];
  autoStart: boolean;
  /** Optional stop condition (e.g. 'max_cycles:100') */
  stopCondition?: string;
  provider?: string;
  model?: string;
  /** File workspace ID (auto-created on start) */
  workspaceId?: string;
  /** Optional soul identity for persistent memory/personality */
  soulId?: string;
  /** Parent claw ID for subclaw tracking */
  parentClawId?: string;
  /** Nesting depth (0 = root) */
  depth: number;
  /** Script execution mode */
  sandbox: ClawSandboxMode;
  /** Coding agent provider (e.g. 'claude-code', 'codex', 'gemini-cli') */
  codingAgentProvider?: string;
  /** Skill IDs this claw has access to */
  skills?: string[];
  createdBy: ClawCreator;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new claw */
export interface CreateClawInput {
  userId: string;
  name: string;
  mission: string;
  mode?: ClawMode;
  allowedTools?: string[];
  limits?: Partial<ClawLimits>;
  intervalMs?: number;
  eventFilters?: string[];
  autoStart?: boolean;
  stopCondition?: string;
  provider?: string;
  model?: string;
  soulId?: string;
  parentClawId?: string;
  sandbox?: ClawSandboxMode;
  codingAgentProvider?: string;
  skills?: string[];
  createdBy?: ClawCreator;
}

/** Input for updating an existing claw */
export interface UpdateClawInput {
  name?: string;
  mission?: string;
  mode?: ClawMode;
  allowedTools?: string[];
  limits?: Partial<ClawLimits>;
  intervalMs?: number;
  eventFilters?: string[];
  autoStart?: boolean;
  stopCondition?: string;
  provider?: string | null;
  model?: string | null;
  soulId?: string | null;
  sandbox?: ClawSandboxMode;
  codingAgentProvider?: string | null;
  skills?: string[];
}

// ============================================================================
// Session Types
// ============================================================================

/** Pending escalation request */
export interface ClawEscalation {
  id: string;
  type: string;
  reason: string;
  details?: Record<string, unknown>;
  requestedAt: Date;
}

/** Runtime session state */
export interface ClawSession {
  config: ClawConfig;
  state: ClawState;
  cyclesCompleted: number;
  totalToolCalls: number;
  totalCostUsd: number;
  lastCycleAt: Date | null;
  lastCycleDurationMs: number | null;
  lastCycleError: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
  persistentContext: Record<string, unknown>;
  inbox: string[];
  artifacts: string[];
  pendingEscalation: ClawEscalation | null;
}

// ============================================================================
// Cycle Result Types
// ============================================================================

/** Individual tool call within a cycle */
export interface ClawToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  success: boolean;
  durationMs: number;
}

/** Result of a single execution cycle */
export interface ClawCycleResult extends AutonomousAgentResult {
  toolCalls: ClawToolCall[];
  outputMessage: string;
  costUsd?: number;
  turns: number;
}

/** Persisted history entry */
export interface ClawHistoryEntry {
  id: string;
  clawId: string;
  cycleNumber: number;
  entryType: 'cycle' | 'escalation';
  success: boolean;
  toolCalls: ClawToolCall[];
  outputMessage: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  error?: string;
  executedAt: Date;
}

// ============================================================================
// IClawService
// ============================================================================

export interface IClawService {
  // ---- Claw Configuration CRUD ----
  createClaw(input: CreateClawInput): Promise<ClawConfig>;
  getClaw(clawId: string, userId: string): Promise<ClawConfig | null>;
  listClaws(userId: string): Promise<ClawConfig[]>;
  updateClaw(clawId: string, userId: string, updates: UpdateClawInput): Promise<ClawConfig | null>;
  deleteClaw(clawId: string, userId: string): Promise<boolean>;

  // ---- Session Lifecycle ----
  startClaw(clawId: string, userId: string): Promise<ClawSession>;
  pauseClaw(clawId: string, userId: string): Promise<boolean>;
  resumeClaw(clawId: string, userId: string): Promise<boolean>;
  stopClaw(clawId: string, userId: string): Promise<boolean>;
  executeNow(clawId: string, userId: string): Promise<ClawCycleResult>;

  // ---- Session Queries ----
  getSession(clawId: string, userId: string): ClawSession | null;
  listSessions(userId: string): ClawSession[];

  // ---- Execution History ----
  getHistory(
    clawId: string,
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ entries: ClawHistoryEntry[]; total: number }>;

  // ---- Communication ----
  sendMessage(clawId: string, userId: string, message: string): Promise<void>;

  // ---- Escalation ----
  approveEscalation(clawId: string, userId: string): Promise<boolean>;
  denyEscalation(clawId: string, userId: string, reason?: string): Promise<boolean>;

  // ---- Service Lifecycle ----
  start(): Promise<void>;
  stop(): Promise<void>;
}
