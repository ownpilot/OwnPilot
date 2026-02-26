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
}

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
