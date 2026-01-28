/**
 * Database Repositories Index
 */

// Core repositories
export { ConversationsRepository, conversationsRepo, type Conversation } from './conversations.js';
export { MessagesRepository, messagesRepo, type Message } from './messages.js';
export { ChannelsRepository, channelsRepo, type Channel } from './channels.js';
export { ChannelMessagesRepository, channelMessagesRepo, type ChannelMessage } from './channel-messages.js';
export { CostsRepository, costsRepo, type Cost, type CostSummary, type DailyCost } from './costs.js';
export { AgentsRepository, agentsRepo, type AgentRecord } from './agents.js';
export { SettingsRepository, settingsRepo, type Setting } from './settings.js';

// Personal data repositories
export {
  TasksRepository,
  tasksRepo,
  type Task,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskQuery,
} from './tasks.js';

export {
  BookmarksRepository,
  bookmarksRepo,
  type Bookmark,
  type CreateBookmarkInput,
  type UpdateBookmarkInput,
  type BookmarkQuery,
} from './bookmarks.js';

export {
  NotesRepository,
  notesRepo,
  type Note,
  type CreateNoteInput,
  type UpdateNoteInput,
  type NoteQuery,
} from './notes.js';

export {
  CalendarRepository,
  calendarRepo,
  type CalendarEvent,
  type CreateEventInput,
  type UpdateEventInput,
  type EventQuery,
} from './calendar.js';

export {
  ContactsRepository,
  contactsRepo,
  type Contact,
  type CreateContactInput,
  type UpdateContactInput,
  type ContactQuery,
} from './contacts.js';

// Autonomous AI repositories
export {
  MemoriesRepository,
  memoriesRepo,
  type Memory,
  type MemoryType,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type MemoryQuery,
} from './memories.js';

export {
  GoalsRepository,
  goalsRepo,
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
  triggersRepo,
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
  pomodoroRepo,
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
  habitsRepo,
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
  capturesRepo,
  type Capture,
  type CaptureType,
  type ProcessedAsType,
  type CreateCaptureInput,
  type ProcessCaptureInput,
  type CaptureQuery,
} from './captures.js';

// OAuth & Media Settings repositories
export {
  OAuthIntegrationsRepository,
  oauthIntegrationsRepo,
  type OAuthIntegration,
  type OAuthProvider,
  type OAuthService,
  type IntegrationStatus,
  type CreateIntegrationInput,
  type UpdateIntegrationInput,
} from './oauth-integrations.js';

export {
  MediaSettingsRepository,
  mediaSettingsRepo,
  type MediaProviderSetting,
  type MediaCapability,
  type SetMediaProviderInput,
  type ProviderOption,
  DEFAULT_PROVIDERS,
  AVAILABLE_PROVIDERS,
} from './media-settings.js';

// AI Model Configs repository
export {
  ModelConfigsRepository,
  modelConfigsRepo,
  type UserModelConfig,
  type CustomProvider,
  type CreateModelConfigInput,
  type UpdateModelConfigInput,
  type CreateProviderInput,
  type UpdateProviderInput,
} from './model-configs.js';

// Chat History repository (enhanced conversations + messages)
export {
  ChatRepository,
  chatRepository,
  type Conversation as ChatConversation,
  type Message as ChatMessage,
  type CreateConversationInput,
  type CreateMessageInput,
  type ConversationQuery,
} from './chat.js';

// Request Logs repository (for debugging)
export {
  LogsRepository,
  logsRepository,
  type RequestLog,
  type CreateLogInput,
  type LogQuery,
  type LogStats,
} from './logs.js';
