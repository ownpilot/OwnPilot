/**
 * @ownpilot/gateway
 *
 * HTTP API gateway for OwnPilot
 *
 * @packageDocumentation
 */

// App
export { createApp } from './app.js';

// Types
export type {
  ApiResponse,
  ApiError,
  ResponseMeta,
  ChatRequest,
  ChatResponse,
  StreamChunkResponse,
  CreateAgentRequest,
  AgentInfo,
  ConversationInfo,
  ToolInfo,
  HealthResponse,
  HealthCheck,
  GatewayConfig,
  RateLimitConfig,
  AuthConfig,
} from './types/index.js';

// Middleware
export {
  requestId,
  timing,
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  createRateLimitMiddleware,
  createSlidingWindowRateLimiter,
  errorHandler,
  notFoundHandler,
} from './middleware/index.js';

// Routes
export {
  healthRoutes,
  agentRoutes,
  chatRoutes,
  toolsRoutes,
  getAgent,
  getOrCreateDefaultAgent,
} from './routes/index.js';

// Scheduler
export {
  initializeScheduler,
  getScheduler,
  stopScheduler,
} from './scheduler/index.js';

// Channels (plugin-based)
export { createChannelServiceImpl, getChannelServiceImpl } from './channels/service-impl.js';

// Settings (database-driven)
export {
  getApiKey,
  hasApiKey,
  getDefaultProvider,
  getDefaultModel,
  setDefaultProvider,
  setDefaultModel,
  loadApiKeysToEnvironment,
  resolveProviderAndModel,
  isDemoModeFromSettings,
} from './routes/settings.js';

// Database
export { initializeAdapter, closeAdapter, getAdapter } from './db/adapters/index.js';
export { settingsRepo } from './db/repositories/index.js';

// Plugins
export { initializePlugins, getDefaultPluginRegistry } from './plugins/index.js';

// Data Paths (for proper data directory management)
export {
  getDataPaths,
  getDataPath,
  getWorkspacePath,
  getDatabasePath,
  initializeDataDirectories,
  areDataDirectoriesInitialized,
  getDataDirectoryInfo,
  setDataPathEnvironment,
  hasLegacyData,
  getLegacyDataPath,
  type DataPaths,
  type DataDirType,
  type WorkspaceSubdir,
} from './paths/index.js';

// Services (gateway implementations)
export {
  // Log
  LogService,
  createLogService,
  type LogServiceOptions,
  // Session
  SessionService,
  createSessionService,
  // Message Bus
  MessageBus,
  createMessageBus,
  // Config Center
  GatewayConfigCenter,
  gatewayConfigCenter,
  // Tool
  ToolService,
  createToolService,
  // Provider
  ProviderService,
  createProviderService,
  // Audit
  AuditService,
  createAuditService,
  // Plugin
  PluginServiceImpl,
  createPluginService,
  // Memory
  MemoryServiceImpl,
  createMemoryServiceImpl,
  // Database
  DatabaseServiceImpl,
  createDatabaseServiceImpl,
  // Workspace
  WorkspaceServiceImpl,
  createWorkspaceServiceImpl,
  // Goal
  GoalServiceImpl,
  createGoalServiceImpl,
  // Trigger
  TriggerServiceImpl,
  createTriggerServiceImpl,
  // Plan
  PlanServiceImpl,
  createPlanServiceImpl,
  // Resource
  ResourceServiceImpl,
  createResourceServiceImpl,
} from './services/index.js';

// Config defaults (named constants for infrastructure tuning)
export {
  DB_POOL_MAX,
  DB_IDLE_TIMEOUT_MS,
  DB_CONNECT_TIMEOUT_MS,
  WS_PORT,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_SESSION_TIMEOUT_MS,
  WS_MAX_PAYLOAD_BYTES,
  SCHEDULER_CHECK_INTERVAL_MS,
  SCHEDULER_DEFAULT_TIMEOUT_MS,
  SCHEDULER_MAX_HISTORY_PER_TASK,
  TRIGGER_POLL_INTERVAL_MS,
  TRIGGER_CONDITION_CHECK_MS,
  PLAN_STEP_TIMEOUT_MS,
  PLAN_MAX_STALL,
  PLAN_MAX_BACKOFF_MS,
  PLAN_MAX_LOOP_ITERATIONS,
} from './config/defaults.js';

// Data Migration
export {
  needsMigration,
  getMigrationStatus,
  migrateData,
  autoMigrateIfNeeded,
  type MigrationResult,
} from './paths/migration.js';
