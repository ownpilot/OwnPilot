/**
 * API Endpoints — barrel export
 */

export { authApi } from './auth';
export type { AuthStatus, LoginResponse, PasswordResponse, SessionsResponse } from './auth';
export { providersApi } from './providers';
export type { ProvidersListData, ProviderConfigData } from './providers';
export { modelsApi } from './models';
export { settingsApi, modelRoutingApi } from './settings';
export type {
  ToolGroupInfo,
  ProcessRouting,
  ResolvedRouting,
  RoutingProcess,
  ModelRoutingData,
  ProcessRoutingData,
} from './settings';
export { tasksApi } from './tasks';
export { summaryApi, costsApi } from './summary';
export { agentsApi } from './agents';
export { customToolsApi } from './custom-tools';
export { toolsApi } from './tools';
export { chatApi } from './chat';
export type { ChatRequestBody } from './chat';
export { executionPermissionsApi } from './execution-permissions';
export type {
  ExecutionPermissions,
  ExecutionMode,
  PermissionMode,
  ApprovalRequest,
  CodeRiskAnalysis,
} from './execution-permissions';
export { profileApi } from './profile';
export {
  autonomyApi,
  pulseApi,
  systemApi,
  debugApi,
  pluginsApi,
  workspacesApi,
  customDataApi,
  configServicesApi,
  channelsApi,
  dashboardApi,
  modelConfigsApi,
  localProvidersApi,
  fileWorkspacesApi,
  expensesApi,
} from './misc';
export { extensionsApi } from './extensions';
export { mcpApi } from './mcp';
export { composioApi } from './composio';
export type {
  ComposioApp,
  ComposioConnection,
  ComposioConnectionRequest,
  ComposioStatus,
  ComposioActionInfo,
} from './composio';
export { codingAgentsApi, cliProvidersApi } from './coding-agents';
export type {
  CodingAgentStatus,
  CodingAgentTestResult,
  CodingAgentSession,
  CodingAgentSessionState,
  CreateCodingSessionInput,
  CodingAgentResultRecord,
  CliProviderRecord,
  CliAuthMethod,
  CliOutputFormat,
  CreateCliProviderInput,
  UpdateCliProviderInput,
  CliProviderTestResult,
} from './coding-agents';
export { cliToolsApi } from './cli-tools';
export { securityApi } from './security';
export type {
  PlatformScanResult,
  SeverityLevel,
  RiskItem,
  SectionScanResult,
  ExtensionScanItem,
  CustomToolScanItem,
  TriggerScanItem,
  WorkflowScanItem,
  CliToolScanItem,
} from './security';
export type {
  CliToolStatus,
  CliToolPolicy,
  CliToolRiskLevel,
  CliToolCategory,
  CliToolPolicyEntry,
  CliToolExecutionResult,
  RegisterCustomCliToolInput,
} from './cli-tools';
export { workflowsApi } from './workflows';
export type {
  McpServer,
  McpServerTool,
  McpServerInfo,
  CreateMcpServerInput,
  UpdateMcpServerInput,
} from './mcp';
export {
  notesApi,
  bookmarksApi,
  contactsApi,
  calendarApi,
  goalsApi,
  memoriesApi,
  plansApi,
  capturesApi,
  triggersApi,
} from './personal-data';

// Re-export API response types
export type {
  PulseStatus,
  PulseActivity,
  PulseEngineConfig,
  PulseLogEntry,
  PulseActionResult,
  PulseStats,
  PulseDirectives,
  PulseRuleDefinition,
  PulseActionType,
  RuleThresholds,
  ActionCooldowns,
  AutonomyLevel,
  AutonomyConfig,
  PendingApproval,
  SandboxStatus,
  DatabaseStatus,
  BackupInfo,
  DatabaseStats,
  DebugLogEntry,
  ToolCallData,
  ToolResultData,
  DebugErrorData,
  RetryData,
  DebugInfo,
  RequestLog,
  LogDetail,
  LogStats,
  ConfigFieldDefinition,
  PluginInfo,
  PluginStats,
  RequiredByEntry,
  ConfigEntryView,
  ConfigServiceView,
  ConfigServiceStats,
  ExtensionInfo,
  ExtensionToolInfo,
  ExtensionTriggerInfo,
  ExtensionRequiredService,
  WorkspaceSelectorInfo,
  FileWorkspaceInfo,
  WorkspaceFile,
  ColumnDefinition,
  CustomTable,
  CustomRecord,
  Channel,
  ChannelMessage,
  Conversation,
  HistoryMessage,
  ExpenseEntry,
  ExpenseMonthData,
  ExpenseCategoryInfo,
  ExpenseMonthlyResponse,
  ExpenseSummaryResponse,
  CostSummary,
  BudgetPeriod,
  BudgetStatus,
  ProviderBreakdown,
  DailyUsage,
  AIBriefing,
  DailyBriefingData,
  ModelCapability,
  MergedModel,
  AvailableProvider,
  LocalProvider,
  LocalProviderTemplate,
  CapabilityDef,
  ProfileData,
  Note,
  BookmarkItem,
  Contact,
  CalendarEvent,
  Goal,
  GoalStep,
  Memory,
  Plan,
  PlanStep,
  PlanEventType,
  PlanHistoryEntry,
  Trigger,
  TriggerConfig,
  TriggerAction,
  TriggerHistoryStatus,
  TriggerHistoryEntry,
  TriggerHistoryParams,
  PaginatedHistory,
  Workflow,
  WorkflowLog,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeData,
  WorkflowToolNodeData,
  WorkflowTriggerNodeData,
  WorkflowLlmNodeData,
  WorkflowConditionNodeData,
  WorkflowCodeNodeData,
  WorkflowTransformerNodeData,
  NodeResult,
  WorkflowStatus,
  WorkflowLogStatus,
  NodeExecutionStatus,
  WorkflowProgressEvent,
  WorkflowApproval,
  WorkflowApprovalStatus,
  WorkflowVersion,
} from '../types';
