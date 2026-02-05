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
// Channel Plugins
// ============================================================================

/** Discord auto-reconnect delay (ms) */
export const DISCORD_RECONNECT_DELAY_MS = 5_000;

/** LINE reply token expiry (ms) — LINE tokens expire at ~30s */
export const LINE_REPLY_TOKEN_EXPIRY_MS = 25_000;

/** LINE default webhook port */
export const LINE_WEBHOOK_PORT = 3_100;

/** Matrix typing indicator timeout (ms) */
export const MATRIX_TYPING_TIMEOUT_MS = 5_000;

/** IMAP connection timeout (ms) */
export const IMAP_CONNECT_TIMEOUT_MS = 15_000;
