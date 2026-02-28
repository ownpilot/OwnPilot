/**
 * Miscellaneous API Endpoints
 *
 * Smaller endpoint groups that don't warrant their own file.
 */

import { apiClient } from '../client';
import type { RequestOptions, StreamOptions } from '../client';
import type {
  PulseStatus,
  PulseLogEntry,
  PulseEngineConfig,
  PulseStats,
  PulseDirectives,
  PulseRuleDefinition,
  PulseActionType,
  AutonomyConfig,
  AutonomyLevel,
  PendingApproval,
  SandboxStatus,
  DatabaseStatus,
  BackupInfo,
  DatabaseStats,
  DebugInfo,
  LogDetail,
  RequestLog,
  LogStats,
  PluginInfo,
  PluginStats,
  ConfigServiceView,
  ConfigServiceStats,
  WorkspaceSelectorInfo,
  CustomTable,
  CustomRecord,
  Channel,
  ChannelMessage,
  ChannelUser,
  ChannelStats,
  AIBriefing,
  DailyBriefingData,
  MergedModel,
  AvailableProvider,
  CapabilityDef,
  LocalProvider,
  LocalProviderTemplate,
  FileWorkspaceInfo,
  WorkspaceFile,
  ExpenseMonthlyResponse,
  ExpenseSummaryResponse,
  ColumnDefinition,
  ExpenseEntry,
  ConfigEntryView,
  SyncApplyResult,
  SyncResetResult,
} from '../types';

// ---- Autonomy ----

export const autonomyApi = {
  getConfig: () =>
    apiClient.get<{ config: AutonomyConfig; levels: AutonomyLevel[] }>('/autonomy/config'),
  getApprovals: () =>
    apiClient
      .get<{ pending: PendingApproval[]; count: number }>('/autonomy/approvals')
      .then((r) => r.pending ?? []),
  setLevel: (level: number) => apiClient.post<void>('/autonomy/level', { level }),
  updateBudget: (budget: Record<string, unknown>) =>
    apiClient.patch<void>('/autonomy/budget', budget),
  allowTool: (tool: string) => apiClient.post<void>('/autonomy/tools/allow', { tool }),
  blockTool: (tool: string) => apiClient.post<void>('/autonomy/tools/block', { tool }),
  removeTool: (tool: string) => apiClient.delete<void>(`/autonomy/tools/${tool}`),
  resolveApproval: (actionId: string, decision: 'approve' | 'reject') =>
    apiClient.post<void>(`/autonomy/approvals/${actionId}/${decision}`),
  resetConfig: () => apiClient.post<void>('/autonomy/config/reset'),
};

// ---- Pulse Engine ----

export const pulseApi = {
  status: () => apiClient.get<PulseStatus>('/autonomy/pulse/status'),
  start: () => apiClient.post<{ running: boolean; message: string }>('/autonomy/pulse/start'),
  stop: () => apiClient.post<{ running: boolean; message: string }>('/autonomy/pulse/stop'),
  run: () => apiClient.post<PulseLogEntry>('/autonomy/pulse/run'),
  updateSettings: (settings: Partial<PulseEngineConfig>) =>
    apiClient.patch<{ config: PulseEngineConfig; message: string }>(
      '/autonomy/pulse/settings',
      settings
    ),
  history: (params?: { limit?: number; offset?: number }) => {
    const p: Record<string, string> = {};
    if (params?.limit != null) p.limit = String(params.limit);
    if (params?.offset != null) p.offset = String(params.offset);
    return apiClient.get<{ history: PulseLogEntry[]; total: number }>('/autonomy/pulse/history', {
      params: Object.keys(p).length ? p : undefined,
    });
  },
  stats: () => apiClient.get<PulseStats>('/autonomy/pulse/stats'),
  getDirectives: () =>
    apiClient.get<{
      directives: PulseDirectives;
      ruleDefinitions: PulseRuleDefinition[];
      actionTypes: PulseActionType[];
      defaultThresholds: import('../types').RuleThresholds;
      defaultCooldowns: import('../types').ActionCooldowns;
    }>('/autonomy/pulse/directives'),
  updateDirectives: (d: Partial<PulseDirectives>) =>
    apiClient.put<{ directives: PulseDirectives }>('/autonomy/pulse/directives', d),
};

// ---- System / Health / Database ----

export interface ToolDependency {
  package: string;
  category: string;
  tools: string[];
  description: string;
  installed: boolean;
  version: string | null;
  type?: 'cli';
}

export interface ToolDependenciesResponse {
  packages: ToolDependency[];
  cliTools: ToolDependency[];
  summary: {
    packagesInstalled: number;
    packagesTotal: number;
    cliInstalled: number;
    cliTotal: number;
  };
}

export const systemApi = {
  health: () =>
    apiClient.get<{
      status: string;
      version: string;
      uptime: number;
      checks: Array<Record<string, unknown>>;
      sandbox?: SandboxStatus;
      database?: DatabaseStatus;
    }>('/health'),
  toolDependencies: () => apiClient.get<ToolDependenciesResponse>('/health/tool-dependencies'),
  databaseStatus: () => apiClient.get<{ backups: BackupInfo[] }>('/database/status'),
  databaseStats: () => apiClient.get<DatabaseStats>('/database/stats'),
  databaseOperation: (endpoint: string, body?: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/database/${endpoint}`, body),
  databaseOperationStatus: () =>
    apiClient.get<{ output: string[]; isRunning: boolean; lastResult?: string }>(
      '/database/operation/status'
    ),
  deleteBackup: (filename: string) => apiClient.delete<void>(`/database/backup/${filename}`),
};

// ---- Debug / Logs ----

export const debugApi = {
  get: (count?: number) =>
    apiClient.get<DebugInfo>('/debug', { params: count ? { count: String(count) } : undefined }),
  clear: () => apiClient.delete<void>('/debug'),
  listLogs: (params?: Record<string, string>) =>
    apiClient.get<{ logs: RequestLog[] }>('/chat/logs', { params }),
  getLogStats: (params?: Record<string, string>) =>
    apiClient.get<LogStats>('/chat/logs/stats', { params }),
  getLogs: (id: string) => apiClient.get<LogDetail>(`/chat/logs/${id}`),
  deleteLogs: (params: { olderThanDays?: number; all?: boolean }) => {
    const p: Record<string, string> = {};
    if (params.olderThanDays !== undefined) p.olderThanDays = String(params.olderThanDays);
    if (params.all) p.all = 'true';
    return apiClient.delete<void>('/chat/logs', { params: p });
  },
};

// ---- Plugins ----

export const pluginsApi = {
  list: () => apiClient.get<PluginInfo[]>('/plugins'),
  stats: () => apiClient.get<PluginStats>('/plugins/stats'),
};

// ---- Workspaces ----

export const workspacesApi = {
  list: () => apiClient.get<{ workspaces: WorkspaceSelectorInfo[] }>('/workspaces'),
  create: (name: string) => apiClient.post<WorkspaceSelectorInfo>('/workspaces', { name }),
  delete: (id: string) => apiClient.delete<void>(`/workspaces/${id}`),
};

// ---- Custom Data ----

export const customDataApi = {
  tables: () => apiClient.get<CustomTable[]>('/custom-data/tables'),
  search: (tableId: string, query: string) =>
    apiClient.get<CustomRecord[]>(`/custom-data/tables/${tableId}/search`, {
      params: { q: query },
    }),
  records: (tableId: string, limit?: number) =>
    apiClient.get<{ records: CustomRecord[]; total: number }>(
      `/custom-data/tables/${tableId}/records`,
      { params: limit ? { limit: String(limit) } : undefined }
    ),
  createTable: (table: {
    name: string;
    displayName: string;
    description?: string;
    columns: ColumnDefinition[];
  }) => apiClient.post<CustomTable>('/custom-data/tables', table),
  deleteTable: (tableId: string) => apiClient.delete<void>(`/custom-data/tables/${tableId}`),
  createRecord: (tableId: string, data: Record<string, unknown>) =>
    apiClient.post<CustomRecord>(`/custom-data/tables/${tableId}/records`, { data }),
  updateRecord: (recordId: string, data: Record<string, unknown>) =>
    apiClient.put<CustomRecord>(`/custom-data/records/${recordId}`, { data }),
  deleteRecord: (recordId: string) => apiClient.delete<void>(`/custom-data/records/${recordId}`),
};

// ---- Dashboard ----

export const dashboardApi = {
  data: () => apiClient.get<DailyBriefingData>('/dashboard/data'),
  briefing: (options?: RequestOptions) =>
    apiClient.get<{ aiBriefing?: AIBriefing; error?: string }>('/dashboard/briefing', options),
  /** Returns raw Response for SSE stream parsing */
  briefingStream: (options?: StreamOptions) =>
    apiClient.stream('/dashboard/briefing/stream', {}, options),
};

// ---- Model Configs ----

export const modelConfigsApi = {
  list: () => apiClient.get<MergedModel[]>('/model-configs'),
  availableProviders: () =>
    apiClient.get<AvailableProvider[]>('/model-configs/providers/available'),
  capabilities: () => apiClient.get<CapabilityDef[]>('/model-configs/capabilities/list'),
  syncApply: () => apiClient.post<SyncApplyResult>('/model-configs/sync/apply'),
  syncReset: () => apiClient.post<SyncResetResult>('/model-configs/sync/reset'),
};

// ---- Local Providers ----

export const localProvidersApi = {
  list: () => apiClient.get<LocalProvider[]>('/local-providers'),
  templates: () => apiClient.get<LocalProviderTemplate[]>('/local-providers/templates'),
  create: (data: {
    name: string;
    providerType: string;
    baseUrl: string;
    apiKey?: string;
    discoveryEndpoint?: string;
  }) => apiClient.post<LocalProvider>('/local-providers', data),
  models: (id: string) =>
    apiClient.get<Array<{ modelId: string; displayName?: string }>>(
      `/local-providers/${id}/models`
    ),
};

// ---- File Workspaces ----

export const fileWorkspacesApi = {
  list: () => apiClient.get<{ workspaces: FileWorkspaceInfo[]; count: number }>('/file-workspaces'),
  files: (id: string, path?: string) =>
    apiClient.get<{ path: string; files: WorkspaceFile[]; count: number }>(
      `/file-workspaces/${id}/files`,
      { params: path ? { path } : undefined }
    ),
  /** Returns URL for browser download (not an API call) */
  downloadUrl: (id: string) => `/api/v1/file-workspaces/${id}/download`,
  delete: (id: string) => apiClient.delete<void>(`/file-workspaces/${id}`),
  cleanup: (options?: { mode?: 'empty' | 'old' | 'both'; maxAgeDays?: number }) =>
    apiClient.post<{
      deleted: number;
      kept: number;
      mode: string;
      stats: { deletedEmpty: number; deletedOld: number };
    }>('/file-workspaces/cleanup', {
      mode: options?.mode ?? 'old',
      maxAgeDays: options?.maxAgeDays ?? 7,
    }),
};

// ---- Config Services ----

export const configServicesApi = {
  list: () => apiClient.get<{ services: ConfigServiceView[]; count: number }>('/config-services'),
  stats: () => apiClient.get<ConfigServiceStats>('/config-services/stats'),
  categories: () => apiClient.get<{ categories: string[] }>('/config-services/categories'),
  createEntry: (serviceName: string, body: Record<string, unknown>) =>
    apiClient.post<ConfigEntryView>(`/config-services/${serviceName}/entries`, body),
  updateEntry: (serviceName: string, entryId: string, body: Record<string, unknown>) =>
    apiClient.put<ConfigEntryView>(`/config-services/${serviceName}/entries/${entryId}`, body),
  deleteEntry: (serviceName: string, entryId: string) =>
    apiClient.delete<void>(`/config-services/${serviceName}/entries/${entryId}`),
  setDefault: (serviceName: string, entryId: string) =>
    apiClient.put<void>(`/config-services/${serviceName}/entries/${entryId}/default`),
};

// ---- Channels ----

export const channelsApi = {
  list: () =>
    apiClient.get<{
      channels: Channel[];
      summary: { total: number; connected: number; disconnected: number };
      availableTypes: string[];
    }>('/channels'),
  create: (body: { id: string; type: string; name: string; config: Record<string, unknown> }) =>
    apiClient.post<Channel>('/channels', body),
  send: (channelId: string, body: Record<string, unknown>) =>
    apiClient.post<void>(`/channels/${channelId}/send`, body),
  inbox: (params?: { limit?: number; channelId?: string }) =>
    apiClient.get<{
      messages: ChannelMessage[];
      total: number;
      unreadCount: number;
    }>('/channels/messages/inbox', { params: params as Record<string, string> }),
  markRead: (messageId: string) => apiClient.post<void>(`/channels/messages/${messageId}/read`),
  setup: (channelId: string, config: Record<string, unknown>) =>
    apiClient.post<{
      pluginId: string;
      status: string;
      botInfo?: { username: string; firstName: string };
    }>(`/channels/${channelId}/setup`, { config }),
  connect: (channelId: string) =>
    apiClient.post<{ pluginId: string; status: string }>(`/channels/${channelId}/connect`),
  disconnect: (channelId: string) =>
    apiClient.post<{ pluginId: string; status: string }>(`/channels/${channelId}/disconnect`),
  logout: (channelId: string) =>
    apiClient.post<{ pluginId: string; status: string }>(`/channels/${channelId}/logout`),
  reply: (
    channelId: string,
    body: { text: string; platformChatId?: string; replyToMessageId?: string }
  ) =>
    apiClient.post<{ messageId: string; platformMessageId: string }>(
      `/channels/${channelId}/reply`,
      body
    ),
  clearMessages: (channelId?: string) =>
    apiClient.delete<{ deleted: number }>('/channels/messages', {
      params: channelId ? { channelId } : undefined,
    }),
  getUsers: (channelId: string) =>
    apiClient.get<{ users: ChannelUser[]; count: number }>(`/channels/${channelId}/users`),
  getStats: (channelId: string) => apiClient.get<ChannelStats>(`/channels/${channelId}/stats`),
  reconnect: (channelId: string) =>
    apiClient.post<{ pluginId: string; status: string }>(`/channels/${channelId}/reconnect`),
  getDetail: (channelId: string) => apiClient.get<Channel>(`/channels/${channelId}`),
  getQr: (channelId: string) =>
    apiClient.get<{
      qr: string | null;
      status: string;
      botInfo?: { username?: string; firstName?: string };
    }>(`/channels/${channelId}/qr`),
  approveUser: (userId: string) =>
    apiClient.post<{ approved: boolean }>(`/channels/auth/users/${userId}/approve`),
  blockUser: (userId: string) =>
    apiClient.post<{ blocked: boolean }>(`/channels/auth/users/${userId}/block`),
  unblockUser: (userId: string) =>
    apiClient.post<{ unblocked: boolean }>(`/channels/auth/users/${userId}/unblock`),
  deleteUser: (userId: string) =>
    apiClient.delete<{ deleted: boolean }>(`/channels/auth/users/${userId}`),
};

// ---- Expenses ----

export const expensesApi = {
  monthly: (year: number) =>
    apiClient.get<ExpenseMonthlyResponse>(`/expenses/monthly`, { params: { year } }),
  summary: (params: Record<string, string>) =>
    apiClient.get<ExpenseSummaryResponse>(`/expenses/summary`, { params }),
  list: (params: Record<string, string>) =>
    apiClient.get<{ expenses: ExpenseEntry[] }>(`/expenses`, { params }),
  create: (expense: {
    date: string;
    amount: number;
    currency: string;
    category: string;
    description: string;
    notes?: string;
  }) => apiClient.post<ExpenseEntry>(`/expenses`, expense),
  update: (
    id: string,
    expense: Partial<{
      date: string;
      amount: number;
      currency: string;
      category: string;
      description: string;
      notes: string;
      paymentMethod: string;
    }>
  ) => apiClient.put<ExpenseEntry>(`/expenses/${id}`, expense),
  delete: (id: string) => apiClient.delete<void>(`/expenses/${id}`),
};
