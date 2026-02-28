/**
 * API Response Types
 *
 * Shared type definitions for API endpoint responses.
 * These match the shapes returned by the gateway API and
 * are used by both endpoint definitions and consuming pages/components.
 */

// ---- Autonomy ----

export interface AutonomyLevel {
  level: number;
  name: string;
  description: string;
}

export interface AutonomyConfig {
  userId: string;
  level: number;
  allowedTools: string[];
  blockedTools: string[];
  dailyBudget: number;
  dailySpend: number;
  maxCostPerAction: number;
  budgetResetAt: string;
  notificationThreshold: number;
  auditEnabled: boolean;
}

export interface PendingApproval {
  id: string;
  userId: string;
  category: string;
  type: string;
  description: string;
  params: Record<string, unknown>;
  risk: {
    level: string;
    score: number;
    factors: string[];
  };
  status: string;
  createdAt: string;
  expiresAt: string;
}

// ---- Pulse System ----

export interface PulseEngineConfig {
  userId: string;
  enabled: boolean;
  minIntervalMs: number;
  maxIntervalMs: number;
  maxActions: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export interface PulseStatus {
  running: boolean;
  enabled: boolean;
  config: PulseEngineConfig;
  activePulse: { pulseId: string; stage: string; startedAt: number } | null;
  lastPulse?: { pulsedAt: string; signalsFound: number; urgencyScore: number };
}

export interface PulseActivity {
  status: 'started' | 'stage' | 'completed' | 'error';
  stage: string;
  pulseId: string | null;
  startedAt: number | null;
  signalsFound?: number;
  actionsExecuted?: number;
  durationMs?: number;
  error?: string;
}

export interface PulseLogEntry {
  id: string;
  userId: string;
  pulsedAt: string;
  durationMs: number;
  signalsFound: number;
  llmCalled: boolean;
  actionsCount: number;
  actions: PulseActionResult[];
  reportMsg: string | null;
  error: string | null;
  manual: boolean;
  signalIds: string[];
  urgencyScore: number;
}

export interface PulseActionResult {
  type: string;
  success: boolean;
  output?: unknown;
  error?: string;
  skipped?: boolean;
}

export interface PulseStats {
  totalPulses: number;
  llmCallRate: number;
  avgDurationMs: number;
  actionsExecuted: number;
}

// ---- Pulse Directives ----

export interface RuleThresholds {
  staleDays: number;
  deadlineDays: number;
  activityDays: number;
  lowProgressPct: number;
  memoryMaxCount: number;
  memoryMinImportance: number;
  triggerErrorMin: number;
}

export interface ActionCooldowns {
  create_memory: number;
  update_goal_progress: number;
  send_notification: number;
  run_memory_cleanup: number;
}

export interface PulseDirectives {
  disabledRules: string[];
  blockedActions: string[];
  customInstructions: string;
  template: string;
  ruleThresholds: RuleThresholds;
  actionCooldowns: ActionCooldowns;
}

export interface PulseRuleDefinition {
  id: string;
  label: string;
  description: string;
  thresholdKey: string | null;
}

export interface PulseActionType {
  id: string;
  label: string;
}

// ---- System / Health / Database ----

export interface SandboxStatus {
  dockerAvailable: boolean;
  dockerVersion: string | null;
  codeExecutionEnabled: boolean;
  executionMode?: 'docker' | 'local' | 'auto';
  securityMode: 'strict' | 'relaxed' | 'local' | 'disabled';
}

export interface DatabaseStatus {
  type: 'postgres';
  connected: boolean;
  host?: string;
}

export interface BackupInfo {
  name: string;
  size: number;
  created: string;
}

export interface DatabaseStats {
  database: { size: string; sizeBytes: number };
  tables: { name: string; rowCount: number; size: string }[];
  connections: { active: number; max: number };
  version: string;
}

// ---- Debug / Logs ----

interface DebugLogEntryBase {
  timestamp: string;
  provider?: string;
  model?: string;
  duration?: number;
}

export interface ToolCallData {
  name?: string;
  id?: string;
  approved?: boolean;
  rejectionReason?: string;
  arguments?: Record<string, unknown>;
}

export interface ToolResultData {
  name?: string;
  toolCallId?: string;
  success?: boolean;
  durationMs?: number;
  resultLength?: number;
  resultPreview?: string;
  error?: string;
}

export interface DebugErrorData {
  error?: string;
  stack?: string;
  context?: string;
}

export interface RetryData {
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
  error?: string;
}

export type DebugLogEntry =
  | (DebugLogEntryBase & { type: 'tool_call'; data: ToolCallData })
  | (DebugLogEntryBase & { type: 'tool_result'; data: ToolResultData })
  | (DebugLogEntryBase & { type: 'error'; data: DebugErrorData })
  | (DebugLogEntryBase & { type: 'retry'; data: RetryData })
  | (DebugLogEntryBase & { type: 'request' | 'response'; data: Record<string, unknown> });

export interface DebugInfo {
  enabled: boolean;
  entries: DebugLogEntry[];
  summary: {
    requests: number;
    responses: number;
    toolCalls: number;
    errors: number;
    retries: number;
  };
}

export interface RequestLog {
  id: string;
  type: 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';
  conversationId: string | null;
  provider: string | null;
  model: string | null;
  statusCode: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  createdAt: string;
}

export interface LogDetail extends RequestLog {
  userId: string;
  endpoint: string | null;
  method: string;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown> | null;
  totalTokens: number | null;
  errorStack: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LogStats {
  totalRequests: number;
  errorCount: number;
  successCount: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
}

// ---- Plugins ----

export interface ConfigFieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'number' | 'boolean' | 'select' | 'json';
  required?: boolean;
  defaultValue?: unknown;
  envVar?: string;
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  order?: number;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  status: 'installed' | 'enabled' | 'disabled' | 'error' | 'updating';
  category?: string;
  capabilities: string[];
  permissions: string[];
  grantedPermissions?: string[];
  tools: string[];
  toolCount?: number;
  handlers: string[];
  error?: string;
  installedAt: string;
  updatedAt?: string;
  docs?: string;
  hasSettings?: boolean;
  hasUnconfiguredServices?: boolean;
  settings?: Record<string, unknown>;
  configSchema?: ConfigFieldDefinition[];
  pluginConfigSchema?: ConfigFieldDefinition[];
  configValues?: Record<string, unknown>;
  services?: Array<{
    serviceName: string;
    displayName: string;
    isConfigured: boolean;
  }>;
  requiredServices?: Array<{
    name: string;
    displayName: string;
    isConfigured: boolean;
  }>;
}

export interface PluginStats {
  total: number;
  enabled: number;
  disabled: number;
  error: number;
  totalTools: number;
  totalHandlers: number;
  byCapability: Record<string, number>;
  byPermission: Record<string, number>;
}

// ---- User Extensions ----

export interface ExtensionToolInfo {
  name: string;
  description: string;
  permissions?: string[];
  requires_approval?: boolean;
}

export interface ExtensionTriggerInfo {
  name: string;
  description?: string;
  type: 'schedule' | 'event';
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface ExtensionRequiredService {
  name: string;
  display_name: string;
  description?: string;
  category?: string;
  docs_url?: string;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  category: string;
  icon?: string;
  authorName?: string;
  status: 'enabled' | 'disabled' | 'error';
  sourcePath?: string;
  errorMessage?: string;
  toolCount: number;
  triggerCount: number;
  installedAt: string;
  updatedAt: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    format?: 'ownpilot' | 'agentskills';
    tools: ExtensionToolInfo[];
    triggers?: ExtensionTriggerInfo[];
    required_services?: ExtensionRequiredService[];
    system_prompt?: string;
    instructions?: string;
    tags?: string[];
    keywords?: string[];
    docs?: string;
    author?: { name: string; email?: string; url?: string };
    license?: string;
    compatibility?: string;
    allowed_tools?: string[];
    script_paths?: string[];
    reference_paths?: string[];
    _security?: {
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
      blocked: boolean;
      warnings: string[];
      undeclaredTools: string[];
      auditedAt: number;
    };
  };
}

// ---- Config Services ----

export interface RequiredByEntry {
  type: 'tool' | 'plugin';
  name: string;
  id: string;
}

export interface ConfigEntryView {
  id: string;
  serviceName: string;
  label: string;
  data: Record<string, unknown>;
  isDefault: boolean;
  isActive: boolean;
  hasSecrets: boolean;
  secretFields: string[];
}

export interface ConfigServiceView {
  id: string;
  name: string;
  displayName: string;
  category: string;
  description: string | null;
  docsUrl: string | null;
  configSchema: ConfigFieldDefinition[];
  multiEntry: boolean;
  requiredBy: RequiredByEntry[];
  isActive: boolean;
  isConfigured: boolean;
  entryCount: number;
  entries: ConfigEntryView[];
}

export interface ConfigServiceStats {
  total: number;
  configured: number;
  active: number;
  categories: string[];
  neededByTools: number;
  neededButUnconfigured: number;
}

// ---- Workspaces (workspace selector) ----

export interface WorkspaceSelectorInfo {
  id: string;
  name: string;
  description?: string;
  status: string;
  containerStatus: string;
  createdAt: string;
  updatedAt: string;
  storageUsage?: {
    usedBytes: number;
    fileCount: number;
  };
}

// ---- File Workspaces (workspaces page) ----

export interface FileWorkspaceInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  agentId?: string;
  sessionId?: string;
  description?: string;
  tags?: string[];
  size?: number;
  fileCount?: number;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

// ---- Custom Data ----

export interface ColumnDefinition {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  required?: boolean;
  description?: string;
}

export interface CustomTable {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: ColumnDefinition[];
  recordCount?: number;
  ownerPluginId?: string;
  isProtected?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRecord {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---- Channels ----

export interface Channel {
  id: string;
  type: string;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  icon?: string;
  botInfo?: {
    username: string;
    firstName: string;
  };
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  channelType: string;
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  timestamp: string;
  read: boolean;
  replied: boolean;
  direction: 'incoming' | 'outgoing';
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelUser {
  id: string;
  platform: string;
  platformUserId: string;
  platformUsername?: string;
  displayName?: string;
  isVerified: boolean;
  isBlocked: boolean;
  lastSeenAt: string;
}

export interface ChannelStats {
  totalMessages: number;
  todayMessages: number;
  weekMessages: number;
  lastActivityAt: string | null;
}

// ---- Chat History ----

export interface Conversation {
  id: string;
  title: string;
  agentId?: string;
  agentName?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  isArchived: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** 'web' for UI chat, 'channel' for Telegram/Discord/etc. */
  source?: 'web' | 'channel';
  channelPlatform?: string | null;
  channelSenderName?: string | null;
}

export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provider?: string;
  model?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  trace?: Record<string, unknown>;
  isError?: boolean;
  createdAt: string;
}

/** Unified message — used in channel conversations to merge AI + channel data. */
export interface UnifiedMessage {
  id: string;
  role: string;
  content: string;
  provider?: string | null;
  model?: string | null;
  toolCalls?: unknown[] | null;
  trace?: Record<string, unknown> | null;
  isError?: boolean;
  createdAt: string;
  source: 'channel' | 'ai' | 'web';
  direction: 'inbound' | 'outbound';
  senderName?: string;
  senderId?: string;
}

/** Channel info attached to unified conversation response. */
export interface ChannelInfo {
  platform: string;
  channelPluginId: string;
  platformChatId: string;
  senderName?: string;
  sessionId: string;
}

// ---- Expenses ----

export interface ExpenseEntry {
  id: string;
  date: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  paymentMethod?: string;
  tags?: string[];
  source: string;
  notes?: string;
}

export interface ExpenseMonthData {
  month: string;
  monthNum: string;
  total: number;
  count: number;
  byCategory: Record<string, number>;
}

export interface ExpenseCategoryInfo {
  budget?: number;
  color?: string;
}

export interface ExpenseMonthlyResponse {
  year: number;
  months: ExpenseMonthData[];
  yearTotal: number;
  expenseCount: number;
  categories: Record<string, ExpenseCategoryInfo>;
}

export interface ExpenseSummaryResponse {
  period: {
    name: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalExpenses: number;
    grandTotal: number;
    dailyAverage: number;
    totalByCurrency: Record<string, number>;
    totalByCategory: Record<string, number>;
    topCategories: Array<{
      category: string;
      amount: number;
      percentage: number;
      color: string;
    }>;
    biggestExpenses: ExpenseEntry[];
  };
  categories: Record<string, ExpenseCategoryInfo>;
}

// ---- Costs ----

export interface CostSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalCostFormatted: string;
  averageLatencyMs: number;
  periodStart: string;
  periodEnd: string;
}

export interface BudgetPeriod {
  spent: number;
  limit?: number;
  percentage: number;
  remaining?: number;
}

export interface BudgetStatus {
  daily: BudgetPeriod;
  weekly: BudgetPeriod;
  monthly: BudgetPeriod;
  alerts: Array<{
    type: string;
    threshold: number;
    currentSpend: number;
    limit: number;
    timestamp: string;
  }>;
}

export interface ProviderBreakdown {
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  costFormatted: string;
  percentOfTotal: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  cost: number;
  costFormatted: string;
  inputTokens: number;
  outputTokens: number;
}

// ---- Dashboard ----

export interface AIBriefing {
  id: string;
  summary: string;
  priorities: string[];
  insights: string[];
  suggestedFocusAreas: string[];
  generatedAt: string;
  expiresAt: string;
  modelUsed: string;
  cached: boolean;
}

export interface DailyBriefingData {
  tasks: {
    dueToday: Array<{
      id: string;
      title: string;
      dueDate?: string;
      priority: string;
      status: string;
    }>;
    overdue: Array<{
      id: string;
      title: string;
      dueDate?: string;
      priority: string;
      status: string;
    }>;
  };
  calendar: {
    todayEvents: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime?: string;
      description?: string;
    }>;
  };
  triggers: {
    scheduledToday: Array<{
      id: string;
      name: string;
      nextFire?: string;
      description?: string;
    }>;
  };
}

// ---- Model Configs / AI Models ----

export interface SyncApplyResult {
  stats?: { providers: number; totalModels: number };
}

export interface SyncResetResult {
  stats?: { deleted: number; synced: number };
}

export type ModelCapability =
  | 'chat'
  | 'code'
  | 'vision'
  | 'function_calling'
  | 'json_mode'
  | 'streaming'
  | 'embeddings'
  | 'image_generation'
  | 'audio'
  | 'reasoning';

export interface MergedModel {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled: boolean;
  isCustom: boolean;
  hasOverride: boolean;
  isConfigured: boolean;
  source: 'builtin' | 'aggregator' | 'custom' | 'local';
}

export interface AvailableProvider {
  id: string;
  name: string;
  type: 'builtin' | 'aggregator';
  description?: string;
  apiBase?: string;
  apiKeyEnv: string;
  docsUrl?: string;
  modelCount: number;
  isEnabled: boolean;
  isConfigured: boolean;
}

export interface LocalProvider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  isEnabled: boolean;
  isDefault: boolean;
  modelCount: number;
  lastDiscoveredAt?: string;
}

export interface LocalProviderTemplate {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  discoveryEndpoint: string;
  description: string;
}

export interface CapabilityDef {
  id: ModelCapability;
  name: string;
  description: string;
}

// ---- Profile ----

export interface ProfileData {
  userId: string;
  identity: {
    name?: string;
    nickname?: string;
    age?: number;
    birthday?: string;
    gender?: string;
    nationality?: string;
    languages?: string[];
  };
  location: {
    home?: { city?: string; country?: string; timezone?: string };
    work?: { city?: string; company?: string };
    current?: string;
  };
  lifestyle: {
    wakeUpTime?: string;
    sleepTime?: string;
    workHours?: string;
    eatingHabits?: {
      favoriteFoods?: string[];
      dislikedFoods?: string[];
      dietaryRestrictions?: string[];
      allergies?: string[];
    };
    hobbies?: string[];
  };
  communication: {
    preferredStyle?: 'formal' | 'casual' | 'mixed';
    verbosity?: 'concise' | 'detailed' | 'mixed';
    primaryLanguage?: string;
  };
  work: {
    occupation?: string;
    industry?: string;
    skills?: string[];
    tools?: string[];
  };
  preferences: {
    customInstructions?: string[];
    boundaries?: string[];
    goals?: string[];
  };
  aiPreferences?: {
    autonomyLevel?: 'none' | 'low' | 'medium' | 'high' | 'full';
    customInstructions?: string[];
    boundaries?: string[];
  };
  meta?: {
    completeness?: number;
    totalEntries?: number;
  };
  goals?: {
    shortTerm?: string[];
    mediumTerm?: string[];
    longTerm?: string[];
  };
}

// ---- Notes ----

export interface Note {
  id: string;
  title: string;
  content: string;
  contentType: 'markdown' | 'text';
  category?: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Bookmarks ----

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  tags: string[];
  folder?: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Contacts ----

export interface Contact {
  id: string;
  name: string;
  nickname?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  avatar?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  relationship?: string;
  tags: string[];
  isFavorite: boolean;
  socialLinks?: Record<string, string>;
  customFields?: Record<string, string>;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Calendar ----

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  isAllDay: boolean;
  color?: string;
  reminders: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- Goals ----

export interface GoalStep {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  orderNum: number;
  dependencies?: string[];
  result?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  priority: number;
  parentId?: string;
  dueDate?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps?: GoalStep[];
}

// ---- Memories ----

export interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'conversation' | 'event';
  content: string;
  source?: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  metadata?: Record<string, unknown>;
}

// ---- Plans ----

export interface PlanStep {
  id: string;
  planId: string;
  type:
    | 'tool_call'
    | 'llm_decision'
    | 'user_input'
    | 'condition'
    | 'parallel'
    | 'loop'
    | 'sub_plan';
  name: string;
  description?: string;
  config: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'waiting';
  orderNum: number;
  dependencies: string[];
  result?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface Plan {
  id: string;
  name: string;
  goal: string;
  description?: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  goalId?: string;
  triggerId?: string;
  progress: number;
  totalSteps: number;
  currentStep?: number;
  error?: string;
  checkpoint?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  steps?: PlanStep[];
}

export type PlanEventType =
  | 'started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'checkpoint'
  | 'rollback';

export interface PlanHistoryEntry {
  id: string;
  planId: string;
  stepId: string | null;
  eventType: PlanEventType;
  details: Record<string, unknown>;
  createdAt: string;
}

// ---- Triggers ----

export interface TriggerConfig {
  cron?: string;
  eventType?: string;
  condition?: string;
  webhookPath?: string;
  timezone?: string;
  threshold?: number;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TriggerAction {
  type: 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary' | 'workflow';
  payload: Record<string, unknown>;
}

export interface Trigger {
  id: string;
  type: 'schedule' | 'event' | 'condition' | 'webhook';
  name: string;
  description: string | null;
  config: TriggerConfig;
  action: TriggerAction;
  enabled: boolean;
  priority: number;
  lastFired: string | null;
  nextFire: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TriggerHistoryStatus = 'success' | 'failure' | 'skipped';

export interface TriggerHistoryEntry {
  id: string;
  triggerId: string | null;
  triggerName: string | null;
  firedAt: string;
  status: TriggerHistoryStatus;
  result?: unknown;
  error: string | null;
  durationMs: number | null;
}

export interface TriggerHistoryParams {
  status?: TriggerHistoryStatus;
  triggerId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedHistory {
  history: TriggerHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ---- Workflows ----

export type WorkflowStatus = 'active' | 'inactive';
export type WorkflowLogStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval';
export type NodeExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowToolNodeData {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowTriggerNodeData {
  triggerType: 'manual' | 'schedule' | 'event' | 'condition' | 'webhook';
  label: string;
  cron?: string;
  timezone?: string;
  eventType?: string;
  condition?: string;
  threshold?: number;
  webhookPath?: string;
  triggerId?: string;
}

export interface WorkflowLlmNodeData {
  label: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowConditionNodeData {
  label: string;
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowCodeNodeData {
  label: string;
  language: 'javascript' | 'python' | 'shell';
  code: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowTransformerNodeData {
  label: string;
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowForEachNodeData {
  label: string;
  arrayExpression: string;
  itemVariable?: string;
  maxIterations?: number;
  onError?: 'stop' | 'continue';
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export type WorkflowNodeData =
  | WorkflowToolNodeData
  | WorkflowTriggerNodeData
  | WorkflowLlmNodeData
  | WorkflowConditionNodeData
  | WorkflowCodeNodeData
  | WorkflowTransformerNodeData
  | WorkflowForEachNodeData;

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface InputParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  defaultValue?: string;
  description?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  variables: Record<string, unknown>;
  inputSchema: InputParameter[];
  lastRun: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NodeResult {
  nodeId: string;
  status: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  retryAttempts?: number;
}

export interface WorkflowLog {
  id: string;
  workflowId: string | null;
  workflowName: string | null;
  status: WorkflowLogStatus;
  nodeResults: Record<string, NodeResult>;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  nodes: unknown[];
  edges: unknown[];
  variables: Record<string, unknown>;
  createdAt: string;
}

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface WorkflowApproval {
  id: string;
  workflowLogId: string;
  workflowId: string;
  nodeId: string;
  userId: string;
  status: WorkflowApprovalStatus;
  context: Record<string, unknown>;
  message: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface WorkflowProgressEvent {
  type:
    | 'started'
    | 'node_start'
    | 'node_complete'
    | 'node_error'
    | 'node_retry'
    | 'done'
    | 'error'
    | 'foreach_iteration_start'
    | 'foreach_iteration_complete';
  nodeId?: string;
  toolName?: string;
  status?: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  branchTaken?: string;
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: WorkflowLogStatus;
  iterationIndex?: number;
  iterationTotal?: number;
  retryAttempt?: number;
}
