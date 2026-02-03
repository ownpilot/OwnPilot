/**
 * Services exports
 */

// Service Registry (typed DI container)
export {
  ServiceToken,
  ServiceRegistry,
  initServiceRegistry,
  getServiceRegistry,
  hasServiceRegistry,
  resetServiceRegistry,
  type Disposable,
} from './registry.js';

// Service Tokens
export { Services } from './tokens.js';

// Service Interfaces
export type { ILogService, LogLevel } from './log-service.js';
export type {
  ISessionService,
  Session,
  CreateSessionInput,
  SessionSource,
} from './session-service.js';
export type {
  NormalizedMessage,
  NormalizedAttachment,
  NormalizedToolCall,
  MessageMetadata,
  MessageRole,
  MessageProcessingResult,
} from './message-types.js';
export type {
  IToolService,
  ToolServiceResult,
} from './tool-service.js';
export type {
  IProviderService,
  ProviderInfo,
  ModelInfo,
  ResolvedProvider,
} from './provider-service.js';
export type {
  IAuditService,
  RequestLogEntry,
  AuditLogEvent,
  LogFilter,
  LogStats,
  RequestType,
} from './audit-service.js';
export type {
  IMessageBus,
  MessageMiddleware,
  PipelineContext,
  ProcessOptions,
  StreamCallbacks,
  ToolEndResult,
} from './message-bus.js';

// Plugin Service
export type { IPluginService, PluginInfo, PluginToolEntry } from './plugin-service.js';

// Memory Service
export type {
  IMemoryService,
  ServiceMemoryEntry,
  MemoryType as ServiceMemoryType,
  CreateMemoryInput as MemoryCreateInput,
  UpdateMemoryInput as MemoryUpdateInput,
  MemorySearchOptions,
  MemoryStats as MemoryServiceStats,
} from './memory-service-interface.js';

// Database Service
export type {
  IDatabaseService,
  TableColumn,
  TableSchema,
  DataRecord,
  TableStats as DatabaseTableStats,
} from './database-service.js';

// Workspace Service
export type {
  IWorkspaceService,
  WorkspaceInfo,
  CreateWorkspaceInput,
  WorkspaceAgentInput,
} from './workspace-service.js';

// Config Center
export * from './config-center.js';

// Media Service
export * from './media-service.js';

// Weather Service
export * from './weather-service.js';
