/**
 * Gateway Default Configuration
 *
 * Named constants for all tunable infrastructure values.
 * Import these instead of using inline magic numbers.
 *
 * Override via environment variables where noted.
 */

// ============================================================================
// Database
// ============================================================================

/** Maximum number of connections in the Postgres pool */
export const DB_POOL_MAX = 10;

/** Idle connection timeout before closing (ms) */
export const DB_IDLE_TIMEOUT_MS = 30_000;

/** Connection acquisition timeout (ms) */
export const DB_CONNECT_TIMEOUT_MS = 5_000;

// ============================================================================
// WebSocket
// ============================================================================

/** Default WS server port */
export const WS_PORT = 18_789;

/** Heartbeat ping interval (ms) */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** Session idle timeout before cleanup (ms) */
export const WS_SESSION_TIMEOUT_MS = 300_000;

/** Maximum WebSocket payload size (bytes) */
export const WS_MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB

/** Maximum concurrent WebSocket connections */
export const WS_MAX_CONNECTIONS = 50;

/** Close code for session timeout */
export const WS_CLOSE_SESSION_TIMEOUT = 4000;

/** Maximum messages per second per session (token bucket refill rate) */
export const WS_RATE_LIMIT_MESSAGES_PER_SEC = 30;

/** Maximum burst messages (token bucket capacity) */
export const WS_RATE_LIMIT_BURST = 50;

/** Maximum size (bytes) for a single metadata value */
export const WS_MAX_METADATA_VALUE_BYTES = 1024;

// ============================================================================
// Scheduler
// ============================================================================

/** How often the scheduler checks for pending tasks (ms) */
export const SCHEDULER_CHECK_INTERVAL_MS = 60_000;

/** Default task execution timeout (ms) */
export const SCHEDULER_DEFAULT_TIMEOUT_MS = 300_000;

/** Maximum history entries retained per task */
export const SCHEDULER_MAX_HISTORY_PER_TASK = 100;

// ============================================================================
// Triggers
// ============================================================================

/** Schedule trigger poll interval (ms) */
export const TRIGGER_POLL_INTERVAL_MS = 60_000;

/** Condition check interval (ms) */
export const TRIGGER_CONDITION_CHECK_MS = 300_000;

// ============================================================================
// Plan Executor
// ============================================================================

/** Default step execution timeout (ms) */
export const PLAN_STEP_TIMEOUT_MS = 60_000;

/** Maximum stall iterations before deadlock detection */
export const PLAN_MAX_STALL = 3;

/** Delay before retrying a stalled step (ms) */
export const PLAN_STALL_RETRY_MS = 1_000;

/** Maximum backoff delay for retries (ms) */
export const PLAN_MAX_BACKOFF_MS = 30_000;

/** Maximum iterations for loop steps */
export const PLAN_MAX_LOOP_ITERATIONS = 10;

// ============================================================================
// Rate Limiting
// ============================================================================

/** Default rate-limit window (ms) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Default max requests per window */
export const RATE_LIMIT_MAX_REQUESTS = 500;

/** Default burst limit (50% above max) */
export const RATE_LIMIT_BURST = 750;

// ============================================================================
// Tool Execution
// ============================================================================

/** Maximum tool arguments payload size (bytes) */
export const TOOL_ARGS_MAX_SIZE = 100_000; // 100KB

// ============================================================================
// Time Constants
// ============================================================================

/** Milliseconds in one minute */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds in one hour */
export const MS_PER_HOUR = 3_600_000; // 1000 * 60 * 60

/** Milliseconds in one day (for date difference calculations) */
export const MS_PER_DAY = 86_400_000; // 1000 * 60 * 60 * 24

/** Maximum lookback period for date-range queries (days) */
export const MAX_DAYS_LOOKBACK = 365;

// ============================================================================
// Pagination
// ============================================================================

/** Maximum offset for paginated queries */
export const MAX_PAGINATION_OFFSET = 10_000;

// ============================================================================
// Agent Caches
// ============================================================================

/** Maximum cached agent instances (persistent agents) */
export const MAX_AGENT_CACHE_SIZE = 100;

/** Maximum cached chat agent instances (ephemeral chat agents) */
export const MAX_CHAT_AGENT_CACHE_SIZE = 20;

// ============================================================================
// Agent Defaults
// ============================================================================

/** Default max tokens for agent runtime execution */
export const AGENT_DEFAULT_MAX_TOKENS = 8192;

/** Default max tokens when creating/updating agent config */
export const AGENT_CREATE_DEFAULT_MAX_TOKENS = 4096;

/** Default temperature for agent responses */
export const AGENT_DEFAULT_TEMPERATURE = 0.7;

/** Default maximum conversation turns */
export const AGENT_DEFAULT_MAX_TURNS = 25;

/** Default maximum tool calls per conversation */
export const AGENT_DEFAULT_MAX_TOOL_CALLS = 200;

/** Maximum tool calls in a single batch_use_tool invocation */
export const MAX_BATCH_TOOL_CALLS = 20;

// ============================================================================
// Meta-Tool Names
// ============================================================================

/** The 4 user-facing meta-tools exposed to the AI for tool discovery and execution */
export const AI_META_TOOL_NAMES = ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'] as const;

// ============================================================================
// Channel Plugins
// ============================================================================

/** IMAP connection timeout (ms) */
export const IMAP_CONNECT_TIMEOUT_MS = 15_000;
