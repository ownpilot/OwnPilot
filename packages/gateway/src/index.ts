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
  RequestContext,
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
  ErrorCodes,
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

// Channels (new plugin-based + backward-compat bridge)
export { initializeChannelFactories, channelManager } from './channels/manager.js';
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
export { getDatabase, closeDatabase } from './db/connection.js';
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
export { createLogService, LogService, type LogServiceOptions } from './services/log-service-impl.js';
export { createSessionService, SessionService } from './services/session-service-impl.js';
export { createMessageBus, MessageBus } from './services/message-bus-impl.js';
export { createToolService, ToolService } from './services/tool-service-impl.js';
export { createProviderService, ProviderService } from './services/provider-service-impl.js';

// Data Migration
export {
  needsMigration,
  getMigrationStatus,
  migrateData,
  autoMigrateIfNeeded,
  type MigrationResult,
} from './paths/migration.js';
