/**
 * Coding Agent Service Interface
 *
 * Manages external AI coding CLI agents (Claude Code, OpenAI Codex, Google Gemini CLI).
 * Each agent authenticates with the user's own API key/subscription and can
 * autonomously perform coding tasks in a specified working directory.
 */

// =============================================================================
// TYPES
// =============================================================================

/** Built-in coding agent providers */
export type BuiltinCodingAgentProvider = 'claude-code' | 'codex' | 'gemini-cli';

/** All supported coding agent providers (built-in + custom) */
export type CodingAgentProvider = BuiltinCodingAgentProvider | `custom:${string}`;

/** Check if a provider string is a built-in provider */
export function isBuiltinProvider(p: string): p is BuiltinCodingAgentProvider {
  return p === 'claude-code' || p === 'codex' || p === 'gemini-cli';
}

/** Extract the custom provider name from a 'custom:xyz' provider string, or null if built-in */
export function getCustomProviderName(p: string): string | null {
  return p.startsWith('custom:') ? p.slice(7) : null;
}

/** Execution mode: SDK/CLI first, PTY as fallback */
export type CodingAgentMode = 'auto' | 'sdk' | 'pty';

/** Session execution mode: auto runs non-interactively, interactive allows user input */
export type CodingAgentSessionMode = 'auto' | 'interactive';

/** Session lifecycle states */
export type CodingAgentSessionState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'terminated';

// =============================================================================
// PERMISSIONS & SKILLS
// =============================================================================

/** Output format the coding agent should use */
export type CodingAgentOutputFormat = 'text' | 'json' | 'stream-json';

/** File system access level */
export type CodingAgentFileAccess = 'none' | 'read-only' | 'read-write' | 'full';

/** Autonomy level — how much the agent can do without approval */
export type CodingAgentAutonomy = 'supervised' | 'semi-auto' | 'full-auto';

/** Per-session permission set for a coding agent */
export interface CodingAgentPermissions {
  /** Output format: text (default), json (structured), stream-json (streaming) */
  outputFormat?: CodingAgentOutputFormat;
  /** File system access level */
  fileAccess?: CodingAgentFileAccess;
  /** Restrict file access to these directories only (empty = cwd only) */
  allowedPaths?: string[];
  /** Allow network/internet access */
  networkAccess?: boolean;
  /** Allow shell/command execution */
  shellAccess?: boolean;
  /** Allow git operations */
  gitAccess?: boolean;
  /** Autonomy level */
  autonomy?: CodingAgentAutonomy;
  /** Maximum number of files the agent can create/modify */
  maxFileChanges?: number;
}

/** A skill/instruction set that can be attached to a coding agent session */
export interface CodingAgentSkill {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Markdown content (instructions, conventions, rules) */
  content: string;
  /** Where the skill came from */
  source: 'builtin' | 'user' | 'extension';
}

/** Task definition for a coding agent */
export interface CodingAgentTask {
  /** Which coding agent to use */
  provider: CodingAgentProvider;
  /** The coding task description / prompt */
  prompt: string;
  /** Working directory for the task (absolute path) */
  cwd?: string;
  /** Override default model */
  model?: string;
  /** Maximum number of agent turns (Claude Code SDK) */
  maxTurns?: number;
  /** Maximum cost in USD (Claude Code SDK) */
  maxBudgetUsd?: number;
  /** Restrict which tools the agent can use */
  allowedTools?: string[];
  /** Timeout in milliseconds (default: 300000 = 5 min) */
  timeout?: number;
  /** Execution mode: auto tries SDK/CLI first, falls back to PTY */
  mode?: CodingAgentMode;
  /** Skills/instructions to inject into the agent's system prompt */
  skills?: CodingAgentSkill[];
  /** Permission constraints for this task */
  permissions?: CodingAgentPermissions;
}

/** Result from a coding agent task */
export interface CodingAgentResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Final text output from the agent */
  output: string;
  /** Which provider was used */
  provider: CodingAgentProvider;
  /** Model used (if reported) */
  model?: string;
  /** Execution time in milliseconds */
  durationMs: number;
  /** Process exit code (for CLI-spawned agents) */
  exitCode?: number;
  /** Error message if failed */
  error?: string;
  /** Execution mode that was used */
  mode?: CodingAgentMode;
}

/** Status of a coding agent provider */
export interface CodingAgentStatus {
  /** Provider identifier */
  provider: CodingAgentProvider;
  /** Display name */
  displayName: string;
  /** Whether the CLI binary / SDK is available */
  installed: boolean;
  /** Whether an API key is configured (optional — CLIs support login-based auth) */
  hasApiKey: boolean;
  /** Alias for hasApiKey (used by UI) */
  configured: boolean;
  /** Authentication method hint */
  authMethod: 'api-key' | 'login' | 'both';
  /** Detected version */
  version?: string;
  /** Whether PTY fallback is available */
  ptyAvailable?: boolean;
}

/** Represents an active coding agent terminal session */
export interface CodingAgentSession {
  /** Unique session ID */
  id: string;
  /** Which provider CLI is running */
  provider: CodingAgentProvider;
  /** Display name for UI */
  displayName: string;
  /** Current session state */
  state: CodingAgentSessionState;
  /** Session mode: auto or interactive */
  mode: CodingAgentSessionMode;
  /** Working directory */
  cwd: string;
  /** Original prompt/task */
  prompt: string;
  /** Model override (if any) */
  model?: string;
  /** Started timestamp (ISO) */
  startedAt: string;
  /** Completed timestamp (ISO, if done) */
  completedAt?: string;
  /** Process exit code (if completed) */
  exitCode?: number;
  /** User ID who owns this session */
  userId: string;
  /** How this session was created */
  source?: 'user' | 'ai-tool';
  /** Skill IDs attached to this session */
  skillIds?: string[];
  /** Permission set for this session */
  permissions?: CodingAgentPermissions;
}

/** Input for creating a new coding agent session */
export interface CreateCodingSessionInput {
  /** Which coding agent to use */
  provider: CodingAgentProvider;
  /** The coding task description / prompt */
  prompt: string;
  /** Working directory for the task (absolute path) */
  cwd?: string;
  /** Override default model */
  model?: string;
  /** Session mode: auto (non-interactive) or interactive (user can type) */
  mode?: CodingAgentSessionMode;
  /** Timeout in milliseconds (default: 1800000 = 30 min) */
  timeout?: number;
  /** Maximum number of agent turns (Claude Code SDK auto mode) */
  maxTurns?: number;
  /** Maximum cost in USD (Claude Code SDK auto mode) */
  maxBudgetUsd?: number;
  /** How this session is being created */
  source?: 'user' | 'ai-tool';
  /** Skill IDs to attach (resolved to content before injection) */
  skillIds?: string[];
  /** Permission constraints for this session */
  permissions?: CodingAgentPermissions;
}

/** Default permissions — safe defaults for supervised use */
export const DEFAULT_CODING_AGENT_PERMISSIONS: Required<CodingAgentPermissions> = {
  outputFormat: 'text',
  fileAccess: 'read-write',
  allowedPaths: [],
  networkAccess: true,
  shellAccess: true,
  gitAccess: true,
  autonomy: 'semi-auto',
  maxFileChanges: 50,
};

// =============================================================================
// SERVICE INTERFACE
// =============================================================================

export interface ICodingAgentService {
  /** Run a coding task with the specified provider (legacy blocking mode) */
  runTask(task: CodingAgentTask, userId?: string): Promise<CodingAgentResult>;

  /** Get status of all coding agent providers */
  getStatus(): Promise<CodingAgentStatus[]>;

  /** Check if a specific provider is available (installed — API key is optional for CLI auth) */
  isAvailable(provider: CodingAgentProvider): Promise<boolean>;

  // ---- Session-based API (interactive PTY terminals) ----

  /** Create a new interactive PTY session */
  createSession(input: CreateCodingSessionInput, userId: string): Promise<CodingAgentSession>;

  /** Get a specific session by ID (returns undefined if not found or not owned) */
  getSession(sessionId: string, userId: string): CodingAgentSession | undefined;

  /** List all active sessions for a user */
  listSessions(userId: string): CodingAgentSession[];

  /** Send input to a session's PTY stdin */
  writeToSession(sessionId: string, userId: string, data: string): boolean;

  /** Resize session terminal dimensions */
  resizeSession(sessionId: string, userId: string, cols: number, rows: number): boolean;

  /** Terminate a session (kill PTY process) */
  terminateSession(sessionId: string, userId: string): boolean;
}

// =============================================================================
// ORCHESTRATION TYPES
// =============================================================================

/** Orchestration run status */
export type OrchestrationRunStatus =
  | 'planning'
  | 'running'
  | 'waiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A single step in an orchestration run */
export interface OrchestrationStep {
  /** Step index (0-based) */
  index: number;
  /** The prompt sent to the CLI tool */
  prompt: string;
  /** Session ID (from CodingAgentSessionManager) */
  sessionId?: string;
  /** Result DB record ID */
  resultId?: string;
  /** Step status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** Truncated output summary (for context chaining) */
  outputSummary?: string;
  /** Exit code from the CLI tool */
  exitCode?: number;
  /** Duration in ms */
  durationMs?: number;
  /** AI analysis verdict after this step */
  analysis?: OrchestrationAnalysis;
  /** Timestamp */
  startedAt?: string;
  completedAt?: string;
}

/** AI analysis of a CLI tool's output */
export interface OrchestrationAnalysis {
  /** What did the CLI tool accomplish? */
  summary: string;
  /** Is the overall goal achieved? */
  goalComplete: boolean;
  /** Were there errors or issues? */
  hasErrors: boolean;
  /** Error details if any */
  errors?: string[];
  /** Suggested next prompt for the CLI tool (null = done) */
  nextPrompt: string | null;
  /** Confidence 0-1 that the goal is complete */
  confidence: number;
  /** Should we ask the user before continuing? */
  needsUserInput: boolean;
  /** Question for the user (if needsUserInput) */
  userQuestion?: string;
}

/** Input to start an orchestration run */
export interface StartOrchestrationInput {
  /** High-level goal description */
  goal: string;
  /** Which CLI tool to use */
  provider: CodingAgentProvider;
  /** Working directory */
  cwd: string;
  /** Model override for the CLI tool */
  model?: string;
  /** Max steps before stopping (default: 10) */
  maxSteps?: number;
  /** Max total time in ms (default: 30 min) */
  maxDurationMs?: number;
  /** Skill IDs to attach to each session */
  skillIds?: string[];
  /** Permission constraints */
  permissions?: CodingAgentPermissions;
  /** Auto-continue without asking user (full autonomy) */
  autoMode?: boolean;
}

/** Full orchestration run state */
export interface OrchestrationRun {
  id: string;
  userId: string;
  /** High-level goal */
  goal: string;
  /** CLI tool provider */
  provider: CodingAgentProvider;
  /** Working directory */
  cwd: string;
  /** Model override */
  model?: string;
  /** Current status */
  status: OrchestrationRunStatus;
  /** All steps executed so far */
  steps: OrchestrationStep[];
  /** Current step index */
  currentStep: number;
  /** Max allowed steps */
  maxSteps: number;
  /** Auto-continue mode */
  autoMode: boolean;
  /** Skill IDs */
  skillIds?: string[];
  /** Permission constraints */
  permissions?: CodingAgentPermissions;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Total duration ms (all steps) */
  totalDurationMs?: number;
}
