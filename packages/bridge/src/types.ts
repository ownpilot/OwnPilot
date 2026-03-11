/**
 * Shared TypeScript types for OpenClaw Bridge Daemon
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  metadata?: {
    conversation_id?: string;
    project_dir?: string;
    session_id?: string;
  };
}

export interface ClaudeStreamEvent {
  type: string;
  index?: number;
  delta?: { type: string; text?: string };
  result?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { message: string; code: string };
}

export interface PendingApproval {
  pattern: 'QUESTION' | 'TASK_BLOCKED';
  text: string;
  detectedAt: number; // Unix timestamp ms
}

export interface SessionInfo {
  conversationId: string;
  sessionId: string; // UUID (RFC 4122)
  processAlive: boolean;
  lastActivity: Date;
  projectDir: string;
  tokensUsed: number;
  budgetUsed: number;
  pendingApproval: PendingApproval | null;
  // Worktree isolation (WORK-01/02/03 — optional, null when no worktree)
  worktreeName?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  /** Orchestrator session ID from X-Orchestrator-Id header (optional) */
  orchestratorId?: string;
}

export interface SpawnOptions {
  conversationId: string;
  sessionId: string;
  projectDir: string;
  systemPrompt?: string;
  model?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  // Request worktree isolation for this session (WORK-04)
  worktree?: boolean;
  worktreeName?: string;
}

export interface SendMessageOptions {
  conversationId: string;
  message: string;
  projectDir?: string;
  systemPrompt?: string;
}

export type StreamChunk = {
  type: 'text';
  text: string;
} | {
  type: 'error';
  error: string;
} | {
  type: 'done';
  usage?: { input_tokens: number; output_tokens: number };
};

/**
 * Per-session config overrides applied to the next CC spawn.
 * Stored in bridge memory only — NEVER written to JSONL.
 */
export interface SessionConfigOverrides {
  model?: string;
  effort?: string;
  additionalDirs?: string[];
  permissionMode?: string;
  fast?: boolean;
}

export interface DiskSessionEntry {
  sessionId: string;
  sizeBytes: number;
  lastModified: string;
  hasSubagents: boolean;
  isTracked: boolean;
}

export interface PatternMatch {
  pattern: string;
  value: string;
  raw: string;
}

export interface GsdIntent {
  type: 'execute' | 'plan' | 'progress' | 'debug' | 'new-milestone' | 'generic';
  workflow?: string;
  rawMessage: string;
}

/**
 * OpenClaw Bridge — Structured Error Types
 */

export enum BridgeErrorCode {
  // Auth errors
  UNAUTHORIZED = 'UNAUTHORIZED',

  // Session errors
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_PAUSED = 'SESSION_PAUSED',
  SESSION_CONFLICT = 'SESSION_CONFLICT',

  // Circuit breaker
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',

  // CC spawn errors
  SPAWN_FAILED = 'SPAWN_FAILED',
  SPAWN_TIMEOUT = 'SPAWN_TIMEOUT',

  // Request validation
  INVALID_REQUEST = 'INVALID_REQUEST',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Internal
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface StructuredError {
  error: {
    code: BridgeErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  };
}

// ---------------------------------------------------------------------------
// GSD Orchestration Types (Phase 4 — ORCH-01..04)
// ---------------------------------------------------------------------------

/**
 * Represents the lifecycle state of a GSD orchestration session.
 * Returned by GsdOrchestrationService.trigger() and getStatus().
 */
export interface GsdSessionState {
  /** Unique identifier for this GSD orchestration session */
  gsdSessionId: string;
  /** CC conversation ID used to drive this session */
  conversationId: string;
  /** Absolute path to the project directory */
  projectDir: string;
  /** GSD command (e.g. 'execute-phase', 'plan-phase') */
  command: string;
  /** Additional command arguments */
  args: Record<string, unknown>;
  /** Current lifecycle status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** ISO timestamp when the session was created */
  startedAt: string;
  /** ISO timestamp when the session finished (completed or failed) */
  completedAt?: string;
  /** Error message if status='failed' */
  error?: string;
}

/**
 * Request body for triggering a new GSD session.
 */
export interface GsdTriggerRequest {
  /** GSD command to run (e.g. 'execute-phase') */
  command: string;
  /** Optional command arguments */
  args?: Record<string, unknown>;
  /** Optional model/effort config overrides */
  config?: {
    model?: string;
    effort?: string;
  };
}

/**
 * Response body for GSD status queries — same shape as GsdSessionState.
 */
export type GsdStatusResponse = GsdSessionState;

/**
 * Live progress state for a GSD orchestration session.
 * Stored in GsdOrchestrationService and returned by GET /v1/projects/:projectDir/gsd/progress.
 */
export interface GsdProgressState {
  gsdSessionId: string;
  projectDir: string;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  /** Current GSD phase number being executed (0 = not started) */
  phaseNumber: number;
  /** Number of plans completed so far in this session */
  plansCompleted: number;
  /** Total plans expected in this session (0 = unknown until started) */
  plansTotal: number;
  /** Completion percentage 0-100 */
  completionPercent: number;
}

// ---------------------------------------------------------------------------
// Orchestration types (v4.0)
// ---------------------------------------------------------------------------

export type OrchestrationStage = 'research' | 'devil_advocate' | 'plan_generation' | 'execute' | 'verify';

export type OrchestrationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface OrchestrationRequest {
  /** Task description — what should be done */
  message: string;
  /** Allowed scope — what CC workers may touch */
  scope_in: string;
  /** Forbidden scope — what CC workers must NOT touch */
  scope_out: string;
  /** Number of parallel research agents (default: 5) */
  research_agents?: number;
  /** Number of parallel devil's advocate agents (default: 3) */
  da_agents?: number;
  /** If true, abort pipeline when DA risk score >= 8 (default: false = warn only) */
  da_strict?: boolean;
  /** If false, skip verify stage (default: true) */
  verify?: boolean;
}

export interface OrchestrationStageProgress {
  completed: number;
  total: number;
  /** Highest risk score (devil_advocate stage only) */
  highestRisk?: number;
  /** Whether verify stage passed (verify stage only) */
  passed?: boolean;
}

export interface OrchestrationState {
  /** Unique identifier for this orchestration run */
  orchestrationId: string;
  /** Absolute path to the project directory */
  projectDir: string;
  /** The task message */
  message: string;
  /** Allowed scope */
  scope_in: string;
  /** Forbidden scope */
  scope_out: string;
  /** Current lifecycle status */
  status: OrchestrationStatus;
  /** Currently executing stage, null if not yet started */
  currentStage: OrchestrationStage | null;
  /** ISO timestamp when the orchestration was created */
  startedAt: string;
  /** ISO timestamp when it finished (completed or failed) */
  completedAt?: string;
  /** Error message if status='failed' */
  error?: string;
  /** Per-stage progress tracking */
  stageProgress: Partial<Record<OrchestrationStage, OrchestrationStageProgress>>;
}

// Helper to create structured error responses
export function createBridgeError(
  code: BridgeErrorCode,
  message: string,
  options: { retryable?: boolean; retryAfterMs?: number } = {}
): StructuredError {
  return {
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      retryAfterMs: options.retryAfterMs,
    },
  };
}

export interface ProjectSessionDetail {
  sessionId: string;
  conversationId: string;
  status: 'active' | 'paused' | 'idle';
  tokens: { input: number; output: number };
  projectDir: string;
  createdAt: string;
}

export interface ProjectResourceMetrics {
  projectDir: string;
  totalTokens: number;
  spawnCount: number;
  activeDurationMs: number;
  sessionCount: number;
}

// ---------------------------------------------------------------------------
// Plan Generation types (Phase 18 — God Mode P0)
// ---------------------------------------------------------------------------

export interface PlanGenerationInput {
  /** Original task description */
  message: string;
  /** Allowed scope */
  scopeIn: string;
  /** Forbidden scope */
  scopeOut: string;
  /** Research findings from research wave */
  researchFindings: string[];
  /** Highest DA risk score (1-10) */
  daRiskScore: number;
  /** Project directory */
  projectDir: string;
}

export interface GeneratedPlanEntry {
  /** Plan ID like "01", "02" */
  planId: string;
  /** Human-readable title */
  title: string;
  /** Execution wave (1 = no deps, 2 = depends on wave 1, etc.) */
  wave: number;
  /** Other planIds this depends on */
  dependsOn: string[];
  /** Whether TDD is required */
  tdd: boolean;
  /** What this plan achieves */
  goal: string;
  /** Task descriptions */
  tasks: string[];
  /** How to test this plan */
  testStrategy: string;
  /** Files expected to be created/modified */
  estimatedFiles: string[];
}

export interface GeneratedPlan {
  /** Phase number in .planning/phases/ */
  phaseNumber: number;
  /** Human-readable phase title */
  phaseTitle: string;
  /** Individual plans within this phase */
  plans: GeneratedPlanEntry[];
}

// ---------------------------------------------------------------------------
// Multi-Project Orchestration types (H6)
// ---------------------------------------------------------------------------

export type MultiProjectProjectStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type MultiProjectStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';

export interface MultiProjectItem {
  /** User-defined ID for this project (defaults to basename of dir if not provided) */
  id?: string;
  /** Absolute path to the project directory */
  dir: string;
  /** GSD command to run (e.g. 'execute-phase') */
  command: string;
  /** Phase number for commands like 'execute-phase' */
  phase?: number;
  /** Additional GSD command arguments */
  args?: Record<string, unknown>;
  /** IDs of other projects this depends on (must complete first) */
  depends_on?: string[];
}

export interface MultiProjectProjectState {
  /** Resolved project ID */
  id: string;
  /** Absolute path to the project directory */
  dir: string;
  /** GSD command being run */
  command: string;
  /** Wave number assigned to this project */
  wave: number;
  /** Current lifecycle status */
  status: MultiProjectProjectStatus;
  /** GSD session ID (assigned when triggered) */
  gsdSessionId?: string;
  /** ISO timestamp when this project started */
  startedAt?: string;
  /** ISO timestamp when this project finished */
  completedAt?: string;
  /** Error message if status='failed' */
  error?: string;
}

export interface MultiProjectState {
  /** Unique identifier for this multi-project orchestration */
  multiOrchId: string;
  /** Overall lifecycle status */
  status: MultiProjectStatus;
  /** Per-project states */
  projects: MultiProjectProjectState[];
  /** Total number of waves */
  totalWaves: number;
  /** Currently executing wave (0 = not started) */
  currentWave: number;
  /** ISO timestamp when orchestration was created */
  startedAt: string;
  /** ISO timestamp when orchestration finished */
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Quality Gate & Self-Reflection types (H7)
// ---------------------------------------------------------------------------

export type QualityCheckName = 'tests' | 'scope_drift' | 'commit_quality';

export interface QualityCheck {
  /** Which check this is */
  name: QualityCheckName;
  /** Whether this check passed */
  passed: boolean;
  /** Human-readable summary */
  details: string;
  /** Specific issues found (if any) */
  issues?: string[];
}

export interface QualityGateResult {
  /** True only if ALL checks passed */
  passed: boolean;
  /** Individual check results */
  checks: QualityCheck[];
  /** ISO timestamp */
  timestamp: string;
}

export type ReflectStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface ReflectAttempt {
  /** 1-based attempt number */
  attempt: number;
  /** Quality gate result for this attempt */
  result: QualityGateResult;
  /** Whether a CC fix was applied after this attempt */
  fixApplied: boolean;
  /** Conversation ID of the fix CC (if applied) */
  fixConversationId?: string;
}

export interface ReflectState {
  /** Unique identifier */
  reflectId: string;
  /** Project directory being reflected on */
  projectDir: string;
  /** Current lifecycle status */
  status: ReflectStatus;
  /** Scope constraint used for drift check */
  scopeIn?: string;
  /** All attempts (initial + fix retries) */
  attempts: ReflectAttempt[];
  /** Final quality gate result after all attempts */
  finalResult?: QualityGateResult;
  /** ISO timestamp when started */
  startedAt: string;
  /** ISO timestamp when finished */
  completedAt?: string;
}
