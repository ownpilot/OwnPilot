/**
 * Agent Soul System — Type Definitions
 *
 * Persistent identity injected into every agent prompt.
 * Provides personality, purpose, autonomy rules, heartbeat config,
 * inter-agent relationships, and evolutionary learning.
 */

// ============================================================
// AGENT SOUL — persistent identity, injected into every prompt
// ============================================================

export interface AgentSoul {
  id: string;
  agentId: string;

  identity: SoulIdentity;
  purpose: SoulPurpose;
  autonomy: SoulAutonomy;
  heartbeat: SoulHeartbeat;
  relationships: SoulRelationships;
  evolution: SoulEvolution;
  bootSequence: SoulBootSequence;

  /** AI Provider configuration */
  provider?: {
    /** Primary provider ID */
    providerId: string;
    /** Primary model ID */
    modelId: string;
    /** Fallback provider if primary fails */
    fallbackProviderId?: string;
    /** Fallback model if primary fails */
    fallbackModelId?: string;
  };

  /** Skill access configuration */
  skillAccess?: {
    /** Skill/extension IDs this agent can access */
    allowed: string[];
    /** Skill/extension IDs explicitly blocked */
    blocked: string[];
  };

  workspaceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Identity ────────────────────────────────────────

export interface SoulIdentity {
  /** Display name: "Scout", "Ghost", "Forge", "Radar" */
  name: string;
  /** Emoji identifier: "🔍", "✍️", "⚒️", "📡" */
  emoji: string;
  /** Role description: "X/Twitter Trend Researcher" */
  role: string;
  /** Personality description */
  personality: string;
  /** Voice configuration */
  voice: SoulVoice;
  /** Hard boundaries the agent must always respect */
  boundaries: string[];
  /** Optional backstory for richer personality */
  backstory?: string;
}

export interface SoulVoice {
  /** Tone: "casual-professional" | "analytical" | "creative" */
  tone: string;
  /** Language preference */
  language: 'tr' | 'en' | 'both';
  /** Personality quirks: "Uses cooking analogies", "Ends reports with haiku" */
  quirks?: string[];
}

// ── Purpose ─────────────────────────────────────────

export interface SoulPurpose {
  /** Single-sentence mission statement */
  mission: string;
  /** Active goals (can link to Goals system) */
  goals: string[];
  /** Domain expertise areas */
  expertise: string[];
  /** Preferred tools (weighted in search_tools results) */
  toolPreferences: string[];
  /** Knowledge domains for memory search */
  knowledgeDomains?: string[];
}

// ── Autonomy ────────────────────────────────────────

export interface SoulAutonomy {
  /** Autonomy level: 0-4 standard, 5 = claw mode (unrestricted) */
  level: 0 | 1 | 2 | 3 | 4 | 5;

  /** Actions the agent can perform freely */
  allowedActions: string[];
  /** Actions permanently blocked */
  blockedActions: string[];
  /** Actions requiring user approval */
  requiresApproval: string[];

  /** Budget per heartbeat cycle (USD) */
  maxCostPerCycle: number;
  /** Daily budget (USD) */
  maxCostPerDay: number;
  /** Monthly budget (USD) */
  maxCostPerMonth: number;

  /** Auto-pause after N consecutive errors (default: 5) */
  pauseOnConsecutiveErrors: number;
  /** Auto-pause when budget exceeded (default: true) */
  pauseOnBudgetExceeded: boolean;
  /** Notify user on pause (default: true) */
  notifyUserOnPause: boolean;

  /** Claw mode config — only active when level === 5 */
  clawMode?: ClawModeConfig;
}

/** Claw mode configuration for unrestricted autonomous agents (autonomy level 5) */
export interface ClawModeConfig {
  /** Whether claw mode is active */
  enabled: boolean;
  /** Can spawn/manage other agents (subclaws) */
  canManageAgents: boolean;
  /** Can create tools at runtime */
  canCreateTools: boolean;
  /** Self-improvement strategy after each heartbeat cycle */
  selfImprovement: 'disabled' | 'suggest' | 'auto';
}

// ── Heartbeat ───────────────────────────────────────

// ── Heartbeat ───────────────────────────────────────

/** Numeric priority range (1 = highest, 5 = lowest). Default: 3 */
export type TaskPriorityLevel = 1 | 2 | 3 | 4 | 5;

/** Retry budget for a single heartbeat task */
export interface TaskRetryBudget {
  /** Maximum retry attempts after failure (default: 3) */
  maxRetries: number;
  /** Initial delay before first retry in ms (default: 5000) */
  retryDelayMs: number;
  /** Multiplier applied each retry attempt (default: 2.0) */
  backoffMultiplier?: number;
  /** Maximum delay cap in ms (default: 120000) */
  maxRetryDelayMs?: number;
}

/** Heartbeat-level circuit breaker snapshot */
export interface HeartbeatCircuitBreaker {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureAt: number;
  nextAttemptAt: number;
  consecutiveSuccesses: number;
}

/** Running metrics for a heartbeat cycle */
export interface HeartbeatMetrics {
  avgTaskDurationMs: number;
  circuitState: HeartbeatCircuitBreaker;
  consecutiveFailures: number;
  tasksAttempted: number;
  tasksSucceeded: number;
  tasksSkipped: number;
  cycleCost: number;
  avgCycleCost: number;
}

/** Budget state and exhaustion forecast */
export interface BudgetForecast {
  dailyLimit: number;
  spentToday: number;
  remainingToday: number;
  avgCostPerCycle: number;
  estimatedCyclesRemaining: number | null;
  lastWarningAt: number | null;
  warningIssued: boolean;
}

export interface SoulHeartbeat {
  /** Whether heartbeat is active */
  enabled: boolean;
  /** Cron expression: "* /30 * * * *", "0 9,17 * * *" */
  interval: string;
  /** Tasks to run each heartbeat */
  checklist: HeartbeatTask[];
  /** Quiet hours (no heartbeats during this window) */
  quietHours?: QuietHours;
  /** Retry failed tasks on next beat */
  selfHealingEnabled: boolean;
  /** Heartbeat timeout in ms (default: 120000 = 2 min) */
  maxDurationMs: number;
}

export interface QuietHours {
  /** Start time: "23:00" */
  start: string;
  /** End time: "07:00" */
  end: string;
  /** IANA timezone: "Europe/Istanbul" */
  timezone: string;
}

export interface HeartbeatTask {
  id: string;
  /** Task display name */
  name: string;
  /** Task description for the agent */
  description: string;

  /** Schedule type */
  schedule: 'every' | 'daily' | 'weekly' | 'condition';
  /** For 'daily': "09:00" */
  dailyAt?: string;
  /** For 'weekly': 0=Sun, 1=Mon, ... */
  weeklyOn?: number;
  /** For 'condition': evaluated expression */
  condition?: string;

  /** Tools this task can use */
  tools: string[];
  /** Custom prompt for the agent */
  prompt?: string;
  /** Where to send the output */
  outputTo?: HeartbeatOutput;

  /** Task priority */
  priority: 'low' | 'medium' | 'high' | 'critical' | TaskPriorityLevel;
  /** Numeric priority 1-5 (1 = highest). Defaults to 3 if omitted. */
  numericPriority?: TaskPriorityLevel;
  /** Retry budget for this task. When omitted, task uses autonomy defaults. */
  retryBudget?: TaskRetryBudget;
  /** Force re-run if last run is older than X hours */
  stalenessHours: number;

  // Runtime state (stored in DB)
  lastRunAt?: Date;
  lastResult?: 'success' | 'failure' | 'skipped';
  lastError?: string;
  consecutiveFailures?: number;
}

export type HeartbeatOutput =
  | { type: 'memory' }
  | { type: 'inbox'; agentId: string }
  | { type: 'channel'; channel: string; chatId?: string }
  | { type: 'note'; category?: string }
  | { type: 'task'; listId?: string }
  | { type: 'artifact'; dashboardPin?: boolean }
  | { type: 'broadcast'; crewId: string };

// ── Relationships ───────────────────────────────────

export interface SoulRelationships {
  /** Superior agent ID */
  reportsTo?: string;
  /** Agents this one can delegate tasks to */
  delegates: string[];
  /** Peer-level agents for direct communication */
  peers: string[];
  /** Communication channels this agent uses */
  channels: string[];
  /** Crew membership */
  crewId?: string;
}

// ── Evolution ───────────────────────────────────────

export interface SoulEvolution {
  /** Current version number */
  version: number;
  /** How the soul evolves */
  evolutionMode: 'manual' | 'supervised' | 'autonomous';

  /** Immutable core traits (agent's DNA) */
  coreTraits: string[];
  /** Traits that evolve through experience */
  mutableTraits: string[];

  /** Lessons learned from experience (capped at 50) */
  learnings: string[];
  /** User feedback history (capped at 100) */
  feedbackLog: SoulFeedback[];

  /** Last self-reflection timestamp */
  lastReflectionAt?: Date;
  /** Reflection frequency (cron expression) */
  reflectionInterval?: string;
}

export interface SoulFeedback {
  id: string;
  timestamp: Date;
  type: 'praise' | 'correction' | 'directive' | 'personality_tweak';
  content: string;
  appliedToVersion: number;
  source: 'user' | 'self_reflection' | 'peer_feedback';
}

// ── Boot Sequence ───────────────────────────────────

export interface SoulBootSequence {
  /** Commands to run on agent start */
  onStart: string[];
  /** Pre-heartbeat routine */
  onHeartbeat: string[];
  /** Pre-message routine */
  onMessage: string[];
  /** Context files to load */
  contextFiles?: string[];
  /** Warmup prompt */
  warmupPrompt?: string;
}

// ============================================================
// HEARTBEAT RESULTS
// ============================================================

export interface HeartbeatResult {
  agentId: string;
  soulVersion: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  tasks: HeartbeatTaskResult[];
  totalTokens: { input: number; output: number };
  totalCost: number;
  /** Populated when the entire cycle was skipped (quiet hours, etc.) */
  skippedReason?: string;
  /** Observable metrics snapshot (emitted on heartbeat.metrics event) */
  metrics?: HeartbeatMetrics;
  /** Budget forecast (emitted on heartbeat.budget.warning if threshold crossed) */
  budgetForecast?: BudgetForecast;
}

export interface HeartbeatTaskResult {
  taskId: string;
  taskName: string;
  status: 'success' | 'failure' | 'skipped';
  output?: string;
  error?: string;
  tokenUsage: { input: number; output: number };
  cost: number;
  durationMs: number;
  /** Current retry attempt (0 = first attempt, 1 = first retry, ...) */
  attemptNumber: number;
  /** Delay ms before next retry (only populated when status === 'failure' and retries remain) */
  nextRetryDelayMs?: number;
  /**
   * Tools the engine called while executing this task. Populated by the runtime
   * via onToolEnd. Args + errors are truncated previews (not full payloads) so
   * heartbeat_log rows stay small even when an agent makes many tool calls.
   */
  toolCalls?: HeartbeatToolCallRecord[];
}

/**
 * Lean per-tool-call record persisted with heartbeat logs. Operators use this
 * to debug what a soul actually did inside a cycle. The full tool result is
 * intentionally omitted — store previews only.
 */
export interface HeartbeatToolCallRecord {
  /** Tool name (e.g. "create_memory") */
  tool: string;
  /** Truncated JSON of arguments (max ~500 chars) */
  argsPreview?: string;
  /** Tool execution duration in ms */
  durationMs: number;
  /** Whether the tool returned an error */
  success: boolean;
  /** Truncated error message when success is false */
  errorPreview?: string;
}

// ============================================================
// CREW SYSTEM
// ============================================================

export interface AgentCrew {
  id: string;
  name: string;
  description?: string;
  templateId?: string;
  coordinationPattern: CrewCoordinationPattern;
  status: CrewStatus;
  workspaceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CrewCoordinationPattern = 'hub_spoke' | 'peer_to_peer' | 'pipeline' | 'hierarchical';

export type CrewStatus = 'active' | 'paused' | 'disbanded';

export interface CrewMember {
  crewId: string;
  agentId: string;
  role: string;
  joinedAt: Date;
}

export interface CrewStatusReport {
  crew: {
    id: string;
    name: string;
    status: CrewStatus;
    coordinationPattern: CrewCoordinationPattern;
    createdAt: Date;
  };
  agents: CrewAgentStatus[];
  messagesToday: number;
  totalCostToday: number;
  totalCostMonth: number;
}

export interface CrewAgentStatus {
  agentId: string;
  name: string;
  emoji: string;
  role: string;
  status: string;
  lastHeartbeat: Date | null;
  lastHeartbeatStatus: 'healthy' | 'has_errors' | 'never_run';
  errorCount: number;
  costToday: number;
  unreadMessages: number;
  soulVersion: number;
}

// ============================================================
// SOUL VERSION
// ============================================================

export interface SoulVersion {
  id: string;
  soulId: string;
  version: number;
  /** Null when the snapshot column is corrupt or missing in the DB row. */
  snapshot: AgentSoul | null;
  changeReason?: string;
  changedBy?: string;
  createdAt: Date;
}
