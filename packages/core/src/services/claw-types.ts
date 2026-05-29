/**
 * Claw — Unified Autonomous Agent Runtime Types
 *
 * A Claw agent combines: LLM brain + workspace + soul identity + coding agents +
 * sandbox execution + all 250+ tools into a single autonomous runtime.
 *
 * Execution modes:
 * - cyclic: Repeated execution with scheduling (continuous, interval, event)
 * - single-shot: One execution, auto-stop on completion
 *
 * Usage:
 *   import { getClawService } from '@ownpilot/core';
 *   const clawService = getClawService();
 *   const config = await clawService.createClaw({ ... });
 *   await clawService.startClaw(config.id, userId);
 */

import type { AutonomousAgentResult } from './agent-execution-result.js';
import { ServiceToken } from './registry.js';

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

/** Explicit contract that defines what good output means for a claw. */
export interface ClawMissionContract {
  successCriteria: string[];
  deliverables: string[];
  constraints: string[];
  escalationRules: string[];
  evidenceRequired: boolean;
  minConfidence: number;
}

/** Guardrails that control how much autonomy a claw may exercise. */
export interface ClawAutonomyPolicy {
  allowSelfModify: boolean;
  allowSubclaws: boolean;
  requireEvidence: boolean;
  destructiveActionPolicy: 'ask' | 'block' | 'allow';
  filesystemScopes: string[];
  maxCostUsdBeforePause?: number;
}

/** Derived runtime health signal returned by API responses. */
export interface ClawHealthStatus {
  score: number;
  status: 'healthy' | 'watch' | 'stuck' | 'expensive' | 'failed' | 'idle';
  signals: string[];
  recommendations: string[];
  contractScore: number;
  policyWarnings: string[];
}

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
  /** Productized preset/loadout name, if created from one */
  preset?: string;
  /** Mission success contract and evidence requirements */
  missionContract?: ClawMissionContract;
  /** Autonomy guardrails for self-modification, evidence, and risky actions */
  autonomyPolicy?: ClawAutonomyPolicy;
  /** Scheduling priority — 1=highest, 3=normal (default), 5=lowest. Higher
   * priority claws get shorter adaptive delays in continuous mode, allowing
   * more cycles per hour when the scheduler is under load. */
  priority?: number;
  /**
   * Closed learning loop: when not explicitly `false`, a successful
   * `claw_complete_report` backed by enough tool calls is distilled into a
   * reusable AgentSkills skill (default on). Set `false` to opt out.
   */
  learnSkills?: boolean;
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
  preset?: string;
  missionContract?: Partial<ClawMissionContract>;
  autonomyPolicy?: Partial<ClawAutonomyPolicy>;
  learnSkills?: boolean;
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
  stopCondition?: string | null;
  provider?: string | null;
  model?: string | null;
  soulId?: string | null;
  sandbox?: ClawSandboxMode;
  codingAgentProvider?: string | null;
  skills?: string[];
  preset?: string | null;
  missionContract?: Partial<ClawMissionContract> | null;
  autonomyPolicy?: Partial<ClawAutonomyPolicy> | null;
  priority?: number | null;
  learnSkills?: boolean;
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
  /**
   * Number of consecutive failed cycles. Reset to 0 on first success.
   * Exposed on the session so the runner can inject a reflection prompt
   * when it crosses CLAW_REFLECTION_THRESHOLD — without this signal the
   * agent has no way to know it's stuck in a failure loop and just keeps
   * retrying the same approach.
   */
  consecutiveErrors: number;
  /**
   * Bounded ring of recent cycle/tool failures (max
   * {@link CLAW_RECENT_FAILURES_MAX}). The runner serializes these into
   * the REFLECTION REQUIRED prompt block so the agent has concrete error
   * messages to diagnose against rather than just "you failed N times".
   */
  recentFailures: ClawCycleFailure[];
  /**
   * Structured task plan managed by the `claw_plan` / `claw_update_task`
   * tools. Kept on the session (not just .claw/TASKS.md) so the runner can
   * render the current state into every cycle prompt without re-parsing a
   * freeform markdown file — the LLM had to re-derive structure from text
   * before, which drifted across cycles.
   */
  tasks: ClawTask[];
  /**
   * One-line handoff from the previous cycle: "what I will do next cycle".
   * Set by the `claw_set_next_intent` tool at the end of a cycle that made
   * partial progress. Rendered prominently in the NEXT cycle's prompt and
   * then auto-cleared so it can't go stale — the agent must re-set it each
   * cycle if it still applies. Closes the inter-cycle thought-handoff gap
   * where the agent loses its train of thought between cycles and has to
   * re-derive "where was I?" from the plan + log alone.
   */
  nextIntent?: string;
  /**
   * Bounded ring of plan mutations (max {@link CLAW_PLAN_HISTORY_MAX}).
   * Surfaced via API + UI so operators can see "what changed when"
   * without scraping logs — answers questions like "when did the agent
   * mark t3 blocked?" or "did the operator override the plan during the
   * outage?". Records both agent-side (tool path) and operator-side
   * (REST path) edits with a source tag.
   */
  planHistory?: ClawPlanHistoryEntry[];
}

/**
 * A single recorded plan mutation. The `kind` distinguishes whole-plan
 * rewrites from per-task patches; `actor` distinguishes the agent from a
 * human operator so the UI can colour-code who did what. For task edits
 * `before` captures the prior state so the diff is reconstructible
 * without replaying the whole history.
 */
export interface ClawPlanHistoryEntry {
  /** ISO timestamp of the mutation. */
  at: string;
  /** Who initiated the change. */
  actor: 'agent' | 'operator';
  /** What kind of mutation it was. */
  kind: 'replace' | 'task_update' | 'task_added';
  /** For task-scoped mutations, the affected task id. */
  taskId?: string;
  /** For task_update: the prior status (lets the UI render "pending → in_progress"). */
  prevStatus?: ClawTaskStatus;
  /** For task_update: the new status. */
  newStatus?: ClawTaskStatus;
  /** Short title of the task at mutation time (helps when the row is later renamed/removed). */
  title?: string;
  /** For replace: number of tasks in the new plan. */
  newTaskCount?: number;
}

/** Status of a single planned task. `blocked` is for stalled work that needs
 *  intervention or a precondition before it can move. */
export type ClawTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/** Single entry in the structured plan. */
export interface ClawTask {
  /** Stable id — the agent picks this (e.g. "t1") so updates target the right row. */
  id: string;
  /** Short human-readable description of what the task accomplishes. */
  title: string;
  status: ClawTaskStatus;
  /** Optional free-form note: blockers, links, sub-steps. */
  notes?: string;
  /** ISO timestamp when this task was created. */
  createdAt: string;
  /** ISO timestamp of the last status / notes change. */
  updatedAt: string;
  /**
   * Number of cycles this task has spent in `in_progress` without a status
   * change. Reset to 0 when status flips. The runner uses this to surface a
   * stall warning so the agent splits or blocks rather than spinning on a
   * task that's too big or has hidden blockers.
   */
  cyclesInProgress?: number;
  /**
   * Concrete, falsifiable bar for what counts as "done" — written at plan
   * time so the agent commits to a definition of success BEFORE doing the
   * work, rather than rationalising completion after the fact. Rendered
   * next to the focused task every cycle so it stays salient.
   */
  successCriteria?: string;
  /**
   * Short, post-hoc record of what changed and how the agent knows the
   * successCriteria was met. Surfaced next to completed tasks so future
   * cycles (and the operator) can audit the claim instead of trusting a
   * bare status flip. Optional — completing without evidence yields a soft
   * warning rather than a hard error so the agent isn't blocked on a
   * trivially-true task.
   */
  evidence?: string;
  /**
   * ISO timestamp set by the manager when this task triggered an automatic
   * `task_stalled` escalation (see `CLAW_TASK_STALL_AUTO_ESCALATE`). Used to
   * guarantee the auto-escalation fires at most once per task — even if the
   * operator denies the escalation and the agent stays focused on the same
   * task for further cycles. Cleared whenever the task's status changes.
   */
  autoEscalatedAt?: string;
}

/** Maximum number of tasks retained on a session — prevents the plan from
 *  blowing up the cycle prompt. Sized to be useful for non-trivial missions
 *  while still bounded. */
export const CLAW_MAX_TASKS = 50;

/**
 * Number of cycles a task can sit in `in_progress` before the runner surfaces
 * a stall warning. Picked deliberately larger than CLAW_REFLECTION_THRESHOLD
 * (which fires on consecutive *failures*) — staying on one task for a few
 * cycles is normal; staying for many is a signal it needs to be split.
 */
export const CLAW_TASK_STALL_THRESHOLD = 5;

/**
 * Number of cycles a single task can sit `in_progress` before the manager
 * auto-requests a `task_stalled` escalation. The agent is given multiple
 * cycles past `CLAW_TASK_STALL_THRESHOLD` to self-correct (split, block,
 * or escalate) — when it doesn't, the manager forces the issue instead of
 * letting the claw burn cycles on a single stuck task indefinitely.
 *
 * Fires once per task: the per-task `autoEscalatedAt` marker prevents a
 * second escalation for the same task even if the operator denies the
 * first and the agent keeps spinning.
 */
export const CLAW_TASK_STALL_AUTO_ESCALATE = 10;

/**
 * Hard fail-safe: number of cycles a single task can sit `in_progress` before
 * the manager force-flips its status to `blocked` regardless of the agent's
 * behavior. Sits above `CLAW_TASK_STALL_AUTO_ESCALATE` to give the
 * operator-approval loop a chance to recover first — only fires when the
 * escalation was denied (or not yet acted on) and the agent kept spinning.
 *
 * Operator can later edit the task back to `in_progress` from the Plan tab
 * if the block was misjudged.
 */
export const CLAW_TASK_STALL_FORCE_BLOCK = 20;

/**
 * Max plan-history entries retained on a session. Picked to comfortably
 * cover the operator inspecting "what happened in the last hour or so"
 * without ballooning the session row when serialised.
 */
export const CLAW_PLAN_HISTORY_MAX = 50;

/**
 * Max length of a cross-cycle handoff message set via `claw_set_next_intent`.
 * Intentionally tight — this is a one-liner that primes the next cycle, not
 * a place to dump a plan. Larger context belongs in .claw/MEMORY.md.
 */
export const CLAW_NEXT_INTENT_MAX = 500;

/**
 * Snapshot of a failed cycle or failed tool call. Kept in a bounded
 * ring on the session so the reflection prompt can show specifics —
 * "tool X failed with ENOENT" is actionable; "you've failed 3 times" is
 * not.
 */
export interface ClawCycleFailure {
  cycleNumber: number;
  /** ISO timestamp when the failure was observed. */
  at: string;
  /** Top-level cycle error message (if the whole cycle threw), else null. */
  error: string | null;
  /** Per-tool failures from inside the cycle. Truncated to keep prompts cheap. */
  toolErrors?: Array<{ tool: string; error: string }>;
}

/** Maximum number of failure snapshots retained on a session. */
export const CLAW_RECENT_FAILURES_MAX = 5;

/**
 * Consecutive-error count at which the runner injects a REFLECTION
 * REQUIRED prompt block. Set deliberately below `MAX_CONSECUTIVE_ERRORS`
 * (the auto-fail threshold) so the agent gets multiple chances to
 * self-correct before the manager kills the claw.
 */
export const CLAW_REFLECTION_THRESHOLD = 2;

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

// ============================================================================
// Singleton access — matches the LLMRouter / PermissionGate / MemoryService
// pattern. Gateway registers an implementation via setClawService() at
// startup; production callers and tests use the accessor.
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';

export const ClawToken = new ServiceToken<IClawService>('claw');

let _clawService: IClawService | null = null;

export function setClawService(service: IClawService): void {
  _clawService = service;
  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(ClawToken)) {
        registry.register(ClawToken, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

export function getClawService(): IClawService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(ClawToken);
    } catch {
      // Fall through
    }
  }
  if (!_clawService) {
    throw new Error('ClawService not initialized. Call setClawService() during gateway startup.');
  }
  return _clawService;
}

export function hasClawService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(ClawToken);
    } catch {
      // Fall through
    }
  }
  return _clawService !== null;
}
