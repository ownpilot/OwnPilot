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

// Config defaults (shared with CLI)
export { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './config/defaults.js';

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

// Data Migration
export {
  needsMigration,
  getMigrationStatus,
  migrateData,
  autoMigrateIfNeeded,
  type MigrationResult,
} from './paths/migration.js';
