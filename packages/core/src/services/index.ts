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
export {
  getSessionService,
  setSessionService,
  hasSessionService,
  SessionToken,
} from './session-service.js';
export type {
  NormalizedMessage,
  NormalizedAttachment,
  NormalizedToolCall,
  MessageMetadata,
  MessageRole,
  MessageProcessingResult,
} from './message-types.js';
export type { IToolService, ToolServiceResult } from './tool-service.js';
export { getToolService, setToolService, hasToolService, ToolToken } from './tool-service.js';
export type {
  IProviderService,
  ProviderInfo,
  ModelInfo,
  ResolvedProvider,
} from './provider-service.js';
export {
  getProviderService,
  setProviderService,
  hasProviderService,
  ProviderToken,
} from './provider-service.js';
export type {
  ILLMRouter,
  LLMPickOptions,
  LLMResolvedModel,
  LLMMemoryBudgetOptions,
  LLMTokenUsage,
  LLMProcessKind,
} from './llm-router.js';
export { getLLMRouter, setLLMRouter, hasLLMRouter } from './llm-router.js';
export type {
  IPermissionGate,
  PermissionRequest,
  PermissionDecision,
  PermissionContext,
  PermissionActorType,
  PermissionSandbox,
} from './permission-gate.js';
export {
  getPermissionGate,
  setPermissionGate,
  hasPermissionGate,
  PermissionToken,
} from './permission-gate.js';
export type { RuntimeContext } from './runtime-context.js';
export { getRuntimeContext, hasRuntimeContext } from './runtime-context.js';
export type {
  IAuditService,
  RequestLogEntry,
  AuditLogEvent,
  LogFilter,
  LogStats,
  RequestType,
} from './audit-service.js';
export { getAuditService, setAuditService, hasAuditService, AuditToken } from './audit-service.js';
export type {
  IMessageBus,
  MessageMiddleware,
  PipelineContext,
  ProcessOptions,
  StreamCallbacks,
  ToolEndResult,
} from './message-bus.js';
export { getMessageBus, setMessageBus, hasMessageBus, MessageToken } from './message-bus.js';

// Plugin Service
export type { IPluginService, PluginInfo, PluginToolEntry } from './plugin-service.js';
export {
  getPluginService,
  setPluginService,
  hasPluginService,
  PluginToken,
} from './plugin-service.js';

// Memory Service
export type {
  IMemoryService,
  ServiceMemoryEntry,
  MemoryType as ServiceMemoryType,
  CreateMemoryInput as MemoryCreateInput,
  UpdateMemoryInput as MemoryUpdateInput,
  MemorySearchOptions,
  MemoryStats as MemoryServiceStats,
} from './memory-service.js';
export {
  getMemoryService,
  setMemoryService,
  hasMemoryService,
  MemoryToken,
} from './memory-service.js';

// Database Service
export type {
  IDatabaseService,
  TableColumn,
  TableSchema,
  DataRecord,
  TableStats as DatabaseTableStats,
} from './database-service.js';
export {
  getDatabaseService,
  setDatabaseService,
  hasDatabaseService,
  DatabaseToken,
} from './database-service.js';

// Workspace Service
export type {
  IWorkspaceService,
  WorkspaceInfo,
  CreateWorkspaceInput,
  WorkspaceAgentInput,
} from './workspace-service.js';
export {
  getWorkspaceService,
  setWorkspaceService,
  hasWorkspaceService,
  WorkspaceToken,
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
export { getGoalService, setGoalService, hasGoalService, GoalToken } from './goal-service.js';

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
  HistoryQuery as TriggerHistoryQuery,
  CreateTriggerInput,
  UpdateTriggerInput,
} from './trigger-service.js';
export {
  getTriggerService,
  setTriggerService,
  hasTriggerService,
  TriggerToken,
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
export { getPlanService, setPlanService, hasPlanService, PlanToken } from './plan-service.js';

// Resource Service
export type {
  IResourceService,
  ResourceOwnerType,
  ResourceCapabilities,
  ResourceTypeDefinition,
  ResourceSummaryEntry,
} from './resource-service.js';
export {
  getResourceService,
  setResourceService,
  hasResourceService,
  ResourceToken,
} from './resource-service.js';

// Workflow Service
export type {
  IWorkflowService,
  WorkflowExecuteOptions,
  WorkflowLog as ServiceWorkflowLog,
  WorkflowLogStatus,
  WorkflowProgressEvent,
} from './workflow-service.js';
export {
  getWorkflowService,
  setWorkflowService,
  hasWorkflowService,
  WorkflowToken,
} from './workflow-service.js';

// MCP Client Service
export type {
  IMcpClientService,
  McpToolInfo as ServiceMcpToolInfo,
  McpServerConfig,
  McpServerStatus,
} from './mcp-client-service.js';
export {
  getMcpClientService,
  setMcpClientService,
  hasMcpClientService,
  McpClientToken,
} from './mcp-client-service.js';

// Extension Service
export type { IExtensionService, ExtensionInfo, ExtensionScanResult } from './extension-service.js';
export {
  getExtensionService,
  setExtensionService,
  hasExtensionService,
  ExtensionToken,
} from './extension-service.js';

// Embedding Service
export type { IEmbeddingService, EmbeddingResult } from './embedding-service.js';
export {
  getEmbeddingService,
  setEmbeddingService,
  hasEmbeddingService,
  EmbeddingToken,
} from './embedding-service.js';

// Heartbeat Service
export type {
  IHeartbeatService,
  HeartbeatInfo,
  CreateHeartbeatInput as HeartbeatCreateInput,
  UpdateHeartbeatInput as HeartbeatUpdateInput,
} from './heartbeat-service.js';
export {
  getHeartbeatService,
  setHeartbeatService,
  hasHeartbeatService,
  HeartbeatToken,
} from './heartbeat-service.js';

// Pulse Service (Autonomy Engine)
export type {
  IPulseService,
  PulseResult,
  PulseActionResult,
  PulseStats,
  AutonomyLogEntry,
} from './pulse-service.js';
export { getPulseService, setPulseService, hasPulseService, PulseToken } from './pulse-service.js';

// Coding Agent Service
export type {
  ICodingAgentService,
  BuiltinCodingAgentProvider,
  CodingAgentProvider,
  CodingAgentMode,
  CodingAgentSessionMode,
  CodingAgentSessionState,
  CodingAgentTask,
  CodingAgentResult,
  CodingAgentStatus,
  CodingAgentSession,
  CreateCodingSessionInput,
  CodingAgentOutputFormat,
  CodingAgentFileAccess,
  CodingAgentAutonomy,
  CodingAgentPermissions,
  CodingAgentSkill,
  OrchestrationRunStatus,
  OrchestrationStep,
  OrchestrationAnalysis,
  StartOrchestrationInput,
  OrchestrationRun,
} from './coding-agent-service.js';
export {
  isBuiltinProvider,
  getCustomProviderName,
  DEFAULT_CODING_AGENT_PERMISSIONS,
} from './coding-agent-service.js';
export {
  getCodingAgentService,
  setCodingAgentService,
  hasCodingAgentService,
  CodingAgentToken,
} from './coding-agent-service.js';

// CLI Tool Service
export type {
  ICliToolService,
  CliToolCatalogEntry,
  CliToolStatus,
  CliToolExecutionResult,
  CliToolRiskLevel,
  CliToolPolicy,
  CliToolCategory,
  CliInstallMethod,
} from './cli-tool-service.js';
export {
  getCliToolService,
  setCliToolService,
  hasCliToolService,
  CliToolToken,
} from './cli-tool-service.js';

// Autonomous Agent Result (shared base for all autonomous agent runners)
export type { AutonomousAgentResult } from './agent-execution-result.js';

// Claw Service (unified autonomous agent runtime)
export type {
  IClawService,
  ClawMode,
  ClawState,
  ClawSandboxMode,
  ClawCreator,
  ClawLimits,
  ClawMissionContract,
  ClawAutonomyPolicy,
  AutonomyDisposition,
  ActionCategory,
  ClawHealthStatus,
  ClawConfig,
  CreateClawInput,
  UpdateClawInput,
  ClawEscalation,
  ClawSession,
  ClawToolCall,
  ClawCycleResult,
  ClawHistoryEntry,
  ClawCycleFailure,
  ClawTask,
  ClawTaskStatus,
  ClawPlanHistoryEntry,
} from './claw-types.js';
export {
  DEFAULT_CLAW_LIMITS,
  MAX_CLAW_DEPTH,
  CLAW_RECENT_FAILURES_MAX,
  CLAW_REFLECTION_THRESHOLD,
  CLAW_MAX_TASKS,
  CLAW_TASK_STALL_THRESHOLD,
  CLAW_TASK_STALL_AUTO_ESCALATE,
  CLAW_TASK_STALL_FORCE_BLOCK,
  CLAW_NEXT_INTENT_MAX,
  CLAW_PLAN_HISTORY_MAX,
  getClawService,
  setClawService,
  hasClawService,
  ClawToken,
} from './claw-types.js';

// Artifact Service
export type {
  IArtifactService,
  Artifact,
  ArtifactVersion,
  ArtifactType,
  DashboardSize,
  DataBinding,
  DataBindingSource,
  CreateArtifactInput,
  UpdateArtifactInput,
  ArtifactQuery,
} from './artifact-service.js';
export {
  getArtifactService,
  setArtifactService,
  hasArtifactService,
  ArtifactToken,
} from './artifact-service.js';

// Canvas Service (Live Canvas)
export type {
  ICanvasService,
  CanvasElement,
  CanvasElementType,
  CanvasOpAction,
  AddCanvasElementInput,
  UpdateCanvasElementInput,
} from './canvas-service.js';
export {
  getCanvasService,
  setCanvasService,
  hasCanvasService,
  CanvasToken,
} from './canvas-service.js';

// Edge Service
export type { IEdgeService } from './edge-service.js';
export type {
  EdgeDevice,
  EdgeCommand,
  EdgeTelemetry,
  RegisterDeviceInput,
  UpdateDeviceInput,
  EdgeDeviceQuery,
  EdgeCommandInput,
} from './edge-service.js';
export { getEdgeService, setEdgeService, hasEdgeService, EdgeToken } from './edge-service.js';

// Config Center
export * from './config-center.js';

// Weather Service
export * from './weather-service.js';

// Safe JSON Utilities
export {
  safeJsonParse,
  safeJsonParseWithDefault,
  safeJsonStringify,
  isValidJson,
} from '../utils/safe-json.js';

// Safe Value Utilities (NaN/Infinity/negative guards for cost + duration fields)
export { safeCost, safeDuration } from '../utils/safe-value.js';
