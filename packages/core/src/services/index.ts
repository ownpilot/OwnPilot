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

// Logging
export type { ILogService, LogLevel } from './log-service.js';
export { getLog } from './get-log.js';

// Error Utilities
export { getErrorMessage } from './error-utils.js';

// ID Utilities
export { generateId } from './id-utils.js';
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

// Goal Service
export type {
  IGoalService,
  GoalStatus,
  StepStatus as GoalStepStatus,
  Goal as ServiceGoal,
  GoalStep as ServiceGoalStep,
  GoalWithSteps as ServiceGoalWithSteps,
  GoalNextAction,
  GoalStats as GoalServiceStats,
  GoalQuery,
  CreateGoalInput,
  UpdateGoalInput,
  CreateStepInput as CreateGoalStepInput,
  UpdateStepInput as UpdateGoalStepInput,
  DecomposeStepInput as GoalDecomposeInput,
} from './goal-service.js';

// Trigger Service
export type {
  ITriggerService,
  TriggerType,
  TriggerStatus as TriggerExecutionStatus,
  Trigger as ServiceTrigger,
  TriggerHistory as ServiceTriggerHistory,
  TriggerStats as TriggerServiceStats,
  TriggerConfig,
  ScheduleConfig,
  EventConfig,
  ConditionConfig,
  WebhookConfig,
  TriggerAction,
  TriggerQuery,
  CreateTriggerInput,
  UpdateTriggerInput,
} from './trigger-service.js';

// Plan Service
export type {
  IPlanService,
  PlanStatus,
  StepType as PlanStepType,
  StepStatus as PlanStepStatus,
  PlanEventType,
  Plan as ServicePlan,
  PlanStep as ServicePlanStep,
  PlanHistory as ServicePlanHistory,
  StepConfig as PlanStepConfig,
  PlanWithSteps as ServicePlanWithSteps,
  PlanStats as PlanServiceStats,
  CreatePlanInput,
  UpdatePlanInput,
  CreateStepInput as CreatePlanStepInput,
  UpdateStepInput as UpdatePlanStepInput,
} from './plan-service.js';

// Resource Service
export type {
  IResourceService,
  ResourceOwnerType,
  ResourceCapabilities,
  ResourceTypeDefinition,
  ResourceSummaryEntry,
} from './resource-service.js';

// Config Center
export * from './config-center.js';


// Weather Service
export * from './weather-service.js';
