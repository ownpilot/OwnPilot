/**
 * Database Repositories Index
 *
 * All repositories now use PostgreSQL with async initialization.
 * Use the factory functions to create repository instances.
 */

// Base repository
export { BaseRepository } from './base.js';

// Core repositories
export {
  ConversationsRepository,
  createConversationsRepository,
  type Conversation,
} from './conversations.js';

export { MessagesRepository, createMessagesRepository, type Message } from './messages.js';

export {
  ChannelMessagesRepository,
  createChannelMessagesRepository,
  type ChannelMessage,
} from './channel-messages.js';

export {
  CostsRepository,
  createCostsRepository,
  type Cost,
  type CostSummary,
  type DailyCost,
} from './costs.js';

export {
  AgentsRepository,
  createAgentsRepository,
  agentsRepo,
  type AgentRecord,
} from './agents.js';

export {
  SettingsRepository,
  createSettingsRepository,
  settingsRepo,
  type Setting,
} from './settings.js';

// Personal data repositories
export {
  TasksRepository,
  createTasksRepository,
  type Task,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskQuery,
} from './tasks.js';

export {
  BookmarksRepository,
  createBookmarksRepository,
  type Bookmark,
  type CreateBookmarkInput,
  type UpdateBookmarkInput,
  type BookmarkQuery,
} from './bookmarks.js';

export {
  NotesRepository,
  createNotesRepository,
  type Note,
  type CreateNoteInput,
  type UpdateNoteInput,
  type NoteQuery,
} from './notes.js';

export {
  CalendarRepository,
  createCalendarRepository,
  type CalendarEvent,
  type CreateEventInput,
  type UpdateEventInput,
  type EventQuery,
} from './calendar.js';

export {
  ContactsRepository,
  createContactsRepository,
  type Contact,
  type CreateContactInput,
  type UpdateContactInput,
  type ContactQuery,
} from './contacts.js';

// Autonomous AI repositories
export {
  MemoriesRepository,
  createMemoriesRepository,
  type Memory,
  type MemoryType,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type MemoryQuery,
} from './memories.js';

export {
  GoalsRepository,
  createGoalsRepository,
  type Goal,
  type GoalStep,
  type GoalStatus,
  type StepStatus,
  type CreateGoalInput,
  type UpdateGoalInput,
  type CreateStepInput,
  type UpdateStepInput,
  type GoalQuery,
} from './goals.js';

export {
  TriggersRepository,
  createTriggersRepository,
  type Trigger,
  type TriggerHistory,
  type TriggerType,
  type TriggerStatus,
  type TriggerConfig,
  type TriggerAction,
  type ScheduleConfig,
  type EventConfig,
  type ConditionConfig,
  type WebhookConfig,
  type CreateTriggerInput,
  type UpdateTriggerInput,
  type TriggerQuery,
} from './triggers.js';

export {
  PlansRepository,
  createPlansRepository,
  type Plan,
  type PlanStep,
  type PlanHistory,
  type PlanStatus,
  type StepType,
  type StepStatus as PlanStepStatus,
  type StepConfig,
  type PlanEventType,
  type CreatePlanInput,
  type CreateStepInput as CreatePlanStepInput,
  type UpdatePlanInput,
  type UpdateStepInput as UpdatePlanStepInput,
} from './plans.js';

// Productivity plugin repositories
export {
  PomodoroRepository,
  createPomodoroRepository,
  type PomodoroSession,
  type PomodoroSettings,
  type PomodoroDailyStats,
  type SessionType,
  type SessionStatus,
  type CreateSessionInput,
  type UpdateSettingsInput,
} from './pomodoro.js';

export {
  HabitsRepository,
  createHabitsRepository,
  type Habit,
  type HabitLog,
  type HabitFrequency,
  type HabitWithTodayStatus,
  type CreateHabitInput,
  type UpdateHabitInput,
  type HabitQuery,
} from './habits.js';

export {
  CapturesRepository,
  createCapturesRepository,
  type Capture,
  type CaptureType,
  type ProcessedAsType,
  type CreateCaptureInput,
  type ProcessCaptureInput,
  type CaptureQuery,
} from './captures.js';

// AI Model Configs repository
export {
  ModelConfigsRepository,
  createModelConfigsRepository,
  modelConfigsRepo,
  type UserModelConfig,
  type CustomProvider,
  type UserProviderConfig,
  type CreateModelConfigInput,
  type UpdateModelConfigInput,
  type CreateProviderInput,
  type UpdateProviderInput,
  type CreateUserProviderConfigInput,
  type UpdateUserProviderConfigInput,
} from './model-configs.js';

// Chat History repository (enhanced conversations + messages)
export {
  ChatRepository,
  createChatRepository,
  type Conversation as ChatConversation,
  type Message as ChatMessage,
  type CreateConversationInput,
  type CreateMessageInput,
  type ConversationQuery,
} from './chat.js';

// Request Logs repository (for debugging)
export {
  LogsRepository,
  createLogsRepository,
  type RequestLog,
  type CreateLogInput,
  type LogQuery,
  type LogStats,
} from './logs.js';

// Custom Data repository
export {
  CustomDataRepository,
  createCustomDataRepository,
  type CustomTableSchema,
  type CustomDataRecord,
  type ColumnDefinition,
} from './custom-data.js';

// Custom Tools repository
export {
  CustomToolsRepository,
  createCustomToolsRepo,
  type CustomToolRecord,
  type ToolPermission,
  type ToolStatus,
} from './custom-tools.js';

// Plugins repository
export {
  PluginsRepository,
  pluginsRepo,
  initializePluginsRepo,
  type PluginRecord,
  type UpsertPluginInput,
} from './plugins.js';

// Local AI Providers repository
export {
  LocalProvidersRepository,
  localProvidersRepo,
  initializeLocalProvidersRepo,
  type LocalProvider,
  type LocalModel,
  type LocalProviderType,
  type CreateLocalProviderInput,
  type CreateLocalModelInput,
} from './local-providers.js';

// Execution permissions repository
export { executionPermissionsRepo } from './execution-permissions.js';

// Embedding cache repository
export {
  EmbeddingCacheRepository,
  embeddingCacheRepo,
  type EmbeddingCacheEntry,
} from './embedding-cache.js';

// Heartbeats repository
export {
  HeartbeatsRepository,
  createHeartbeatsRepository,
  type Heartbeat,
  type CreateHeartbeatInput,
  type UpdateHeartbeatInput,
  type HeartbeatQuery,
} from './heartbeats.js';

// Extensions repository
export {
  ExtensionsRepository,
  extensionsRepo,
  initializeExtensionsRepo,
  type ExtensionRecord,
  type UpsertExtensionInput,
} from './extensions.js';

// Workflows repository
export {
  WorkflowsRepository,
  createWorkflowsRepository,
  type Workflow,
  type WorkflowLog,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowNodeData,
  type ToolNodeData as WorkflowToolNodeData,
  type TriggerNodeData as WorkflowTriggerNodeData,
  type LlmNodeData as WorkflowLlmNodeData,
  type ConditionNodeData as WorkflowConditionNodeData,
  type CodeNodeData as WorkflowCodeNodeData,
  type TransformerNodeData as WorkflowTransformerNodeData,
  type NodeResult,
  type WorkflowStatus,
  type WorkflowLogStatus,
  type NodeExecutionStatus,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
} from './workflows.js';

// Workspaces repository
export {
  WorkspacesRepository,
  createWorkspacesRepository,
  type UserWorkspace,
  type CodeExecution,
  type WorkspaceStatus,
  type ContainerStatus,
  type ExecutionStatus,
  type CreateWorkspaceInput as CreateWorkspaceRepoInput,
  type UpdateWorkspaceInput as UpdateWorkspaceRepoInput,
} from './workspaces.js';
