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

/** Max length for a WebSocket metadata key (chars). */
export const WS_MAX_METADATA_KEY_LENGTH = 100;

/** WebSocket ready state: OPEN (matches ws.OPEN / WebSocket.OPEN) */
export const WS_READY_STATE_OPEN = 1;

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

/** Seconds in one day (for CORS maxAge, etc.) */
export const SECONDS_PER_DAY = 86_400;

/** Maximum lookback period for date-range queries (days) */
export const MAX_DAYS_LOOKBACK = 365;

// ============================================================================
// Pagination
// ============================================================================

/** Default page limit for list endpoints */
export const PAGINATION_DEFAULT_LIMIT = 20;

/** Maximum allowed page limit */
export const PAGINATION_MAX_LIMIT = 100;

/** Maximum offset for paginated queries */
export const MAX_PAGINATION_OFFSET = 10_000;

/** Maximum limit for skill search/featured endpoints */
export const SKILLS_MAX_LIMIT = 50;

/** Maximum limit for edge device command history */
export const EDGE_COMMANDS_MAX_LIMIT = 200;

/** Maximum limit for edge telemetry history */
export const EDGE_TELEMETRY_MAX_LIMIT = 500;

/** Maximum limit for channel message history fetch */
export const CHANNEL_HISTORY_MAX_LIMIT = 50;

/** Maximum limit for activity feed endpoints */
export const ACTIVITY_MAX_LIMIT = 100;

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
export const AI_META_TOOL_NAMES = [
  'search_tools',
  'get_tool_help',
  'use_tool',
  'batch_use_tool',
] as const;

// ============================================================================
// Channel Plugins
// ============================================================================

/** IMAP connection timeout (ms) */
export const IMAP_CONNECT_TIMEOUT_MS = 15_000;

// ============================================================================
// In-Memory Cache Limits
// ============================================================================

/** Maximum cached source file contents (tool-source.ts) */
export const MAX_TOOL_SOURCE_FILE_CACHE = 200;

/** Maximum cached tool source extractions (tool-source.ts) */
export const MAX_TOOL_SOURCE_EXTRACTION_CACHE = 500;

/** Maximum outgoing message→chat mappings kept for edit/delete support */
export const MAX_MESSAGE_CHAT_MAP_SIZE = 1_000;

// ============================================================================
// Embedding Service
// ============================================================================

/** Default embedding model */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Embedding dimensions (must match schema vector(1536)) */
export const EMBEDDING_DIMENSIONS = 1536;

/** Maximum texts per OpenAI embedding API batch call */
export const EMBEDDING_MAX_BATCH_SIZE = 100;

/** Delay between batch embedding API calls (ms) */
export const EMBEDDING_RATE_LIMIT_DELAY_MS = 500;

/** Maximum chunk size for markdown splitting (~500 tokens) */
export const EMBEDDING_MAX_CHUNK_CHARS = 2000;

/** Minimum chunk size to avoid tiny fragments */
export const EMBEDDING_MIN_CHUNK_CHARS = 100;

/** Days before unused cache entries are evicted (LRU) */
export const EMBEDDING_CACHE_EVICTION_DAYS = 30;

/** RRF constant k (standard value for Reciprocal Rank Fusion) */
export const RRF_K = 60;

/** Background queue batch size (process N items at once) */
export const EMBEDDING_QUEUE_BATCH_SIZE = 10;

/** Background queue processing interval (ms) */
export const EMBEDDING_QUEUE_INTERVAL_MS = 5_000;

/** Maximum items in the embedding queue (prevents unbounded growth during backfill) */
export const EMBEDDING_QUEUE_MAX_SIZE = 5_000;

/** Maximum memories to load in a single backfill run */
export const EMBEDDING_BACKFILL_LIMIT = 1_000;

// ============================================================================
// Autonomy Engine (Pulse System)
// ============================================================================

/** Minimum pulse interval (ms) — adaptive timer floor */
export const PULSE_MIN_INTERVAL_MS = 5 * 60_000; // 5 min

/** Maximum pulse interval (ms) — adaptive timer ceiling */
export const PULSE_MAX_INTERVAL_MS = 15 * 60_000; // 15 min

/** Maximum actions the engine can execute per pulse cycle */
export const PULSE_MAX_ACTIONS = 5;

/** Quiet hours start (hour, 0-23) — pulses are skipped during quiet hours */
export const PULSE_QUIET_HOURS_START = 22;

/** Quiet hours end (hour, 0-23) */
export const PULSE_QUIET_HOURS_END = 7;

/** Days to retain autonomy log entries */
export const PULSE_LOG_RETENTION_DAYS = 30;

// ============================================================================
// HTTP / Security
// ============================================================================

/** HSTS max-age with preload (2 years, seconds) */
export const HSTS_MAX_AGE_PRELOAD = 63_072_000;

/** HSTS max-age without preload (1 year, seconds) */
export const HSTS_MAX_AGE = 31_536_000;

/** Default HTTP request body size limit (bytes) — 1 MB */
export const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;

/** HTTP 413 Payload Too Large status code */
export const HTTP_PAYLOAD_TOO_LARGE = 413;

/** Cache-Control max-age for immutable hashed assets (seconds) — 1 year */
export const STATIC_ASSET_MAX_AGE = 31_536_000;

// ============================================================================
// Browser Service
// ============================================================================

/** Maximum concurrent pages per user */
export const BROWSER_MAX_PAGES = 5;

/** Browser session idle timeout before cleanup (ms) — 10 minutes */
export const BROWSER_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

/** Browser session cleanup interval (ms) — 5 minutes */
export const BROWSER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Default page navigation timeout (ms) */
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;

/** Default DOM action timeout (ms) */
export const BROWSER_ACTION_TIMEOUT_MS = 10_000;

/** Maximum extracted text length (chars) */
export const BROWSER_MAX_TEXT_LENGTH = 50_000;

// ============================================================================
// CLI Tool Service
// ============================================================================

/** Default CLI tool execution timeout (ms) — 1 minute */
export const CLI_TOOL_DEFAULT_TIMEOUT_MS = 60_000;

/** Maximum CLI tool execution timeout (ms) — 5 minutes */
export const CLI_TOOL_MAX_TIMEOUT_MS = 300_000;

// ============================================================================
// Embedding Service (retry logic)
// ============================================================================

/** Default retry-after delay when rate-limited (seconds) */
export const EMBEDDING_RETRY_AFTER_DEFAULT_S = 5;

/** Retry delay on transient server errors (ms) */
export const EMBEDDING_SERVER_ERROR_RETRY_MS = 2_000;

// ============================================================================
// Rate Limiting (internal)
// ============================================================================

/** Maximum unique key entries in rate-limit store (prevents OOM) */
export const RATE_LIMIT_MAX_STORE_SIZE = 10_000;

// ============================================================================
// Channel Assets
// ============================================================================

/** Default asset TTL before cleanup (ms) — 72 hours */
export const CHANNEL_ASSET_TTL_MS = 72 * 60 * 60 * 1000;

/** Maximum filename segment length (chars) */
export const CHANNEL_ASSET_MAX_FILENAME_LENGTH = 120;

// ============================================================================
// Risk Assessment
// ============================================================================

/** Risk score threshold: critical (>= this) */
export const RISK_THRESHOLD_CRITICAL = 75;

/** Risk score threshold: high (>= this) */
export const RISK_THRESHOLD_HIGH = 50;

/** Risk score threshold: medium (>= this) */
export const RISK_THRESHOLD_MEDIUM = 25;

/** Factor weight threshold for compound risk detection */
export const RISK_COMPOUND_WEIGHT_THRESHOLD = 0.7;

/** Minimum high-severity factors for compound risk */
export const RISK_COMPOUND_FACTOR_COUNT = 3;

/** Score floor when compound risk is detected */
export const RISK_COMPOUND_SCORE_FLOOR = 75;

/** Bulk operation item count threshold */
export const RISK_BULK_OPERATION_THRESHOLD = 10;

/** High-cost threshold (currency units) */
export const RISK_HIGH_COST_THRESHOLD = 1000;

/** High-token-usage threshold */
export const RISK_HIGH_TOKEN_THRESHOLD = 5000;
