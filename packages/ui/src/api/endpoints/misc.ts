/**
 * Miscellaneous API Endpoints
 *
 * Smaller endpoint groups that don't warrant their own file.
 */

import { apiClient } from '../client';
import type { RequestOptions, StreamOptions } from '../client';
import type {
  PendingApproval,
  SandboxStatus,
  DatabaseStatus,
  BackupInfo,
  DatabaseStats,
  DebugInfo,
  LogDetail,
  PluginInfo,
  PluginStats,
  ConfigServiceView,
  ConfigServiceStats,
  WorkspaceSelectorInfo,
  CustomTable,
  CustomRecord,
  Channel,
  ChannelMessage,
  AIBriefing,
  DailyBriefingData,
  CapabilitySettings,
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
} from '../types';

// ---- Autonomy ----

export const autonomyApi = {
  getConfig: () => apiClient.get<Record<string, unknown>>('/autonomy/config'),
  getApprovals: () =>
    apiClient.get<{ pending: PendingApproval[]; count: number }>('/autonomy/approvals').then((r) => r.pending ?? []),
  setLevel: (level: string) => apiClient.post<void>('/autonomy/level', { level }),
  updateBudget: (budget: Record<string, unknown>) =>
    apiClient.patch<void>('/autonomy/budget', budget),
  allowTool: (tool: string) => apiClient.post<void>('/autonomy/tools/allow', { tool }),
  blockTool: (tool: string) => apiClient.post<void>('/autonomy/tools/block', { tool }),
  removeTool: (tool: string) => apiClient.delete<void>(`/autonomy/tools/${tool}`),
  resolveApproval: (actionId: string, decision: 'approve' | 'reject') =>
    apiClient.post<void>(`/autonomy/approvals/${actionId}/${decision}`),
  resetConfig: () => apiClient.post<void>('/autonomy/config/reset'),
};

// ---- System / Health / Database ----

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
  databaseStatus: () =>
    apiClient.get<{ backups: BackupInfo[] }>('/database/status'),
  databaseStats: () => apiClient.get<DatabaseStats>('/database/stats'),
  databaseOperation: (endpoint: string, body?: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/database/${endpoint}`, body),
  databaseOperationStatus: () =>
    apiClient.get<{ output: string[]; isRunning: boolean; lastResult?: string }>(
      '/database/operation/status',
    ),
  deleteBackup: (filename: string) =>
    apiClient.delete<void>(`/database/backup/${filename}`),
};

// ---- Debug / Logs ----

export const debugApi = {
  get: (count?: number) =>
    apiClient.get<DebugInfo>(
      '/debug',
      { params: count ? { count: String(count) } : undefined },
    ),
  clear: () => apiClient.delete<void>('/debug'),
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
  list: () =>
    apiClient.get<{ workspaces: WorkspaceSelectorInfo[] }>('/workspaces'),
  create: (name: string) =>
    apiClient.post<WorkspaceSelectorInfo>('/workspaces', { name }),
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
      { params: limit ? { limit: String(limit) } : undefined },
    ),
  createTable: (table: {
    name: string;
    displayName: string;
    description?: string;
    columns: ColumnDefinition[];
  }) => apiClient.post<CustomTable>('/custom-data/tables', table),
  deleteTable: (tableId: string) =>
    apiClient.delete<void>(`/custom-data/tables/${tableId}`),
  createRecord: (tableId: string, data: Record<string, unknown>) =>
    apiClient.post<CustomRecord>(`/custom-data/tables/${tableId}/records`, { data }),
  updateRecord: (recordId: string, data: Record<string, unknown>) =>
    apiClient.put<CustomRecord>(`/custom-data/records/${recordId}`, { data }),
  deleteRecord: (recordId: string) =>
    apiClient.delete<void>(`/custom-data/records/${recordId}`),
};

// ---- Dashboard ----

export const dashboardApi = {
  data: () => apiClient.get<DailyBriefingData>('/dashboard/data'),
  briefing: (options?: RequestOptions) =>
    apiClient.get<{ aiBriefing?: AIBriefing; error?: string }>(
      '/dashboard/briefing',
      options,
    ),
  /** Returns raw Response for SSE stream parsing */
  briefingStream: (options?: StreamOptions) =>
    apiClient.stream('/dashboard/briefing/stream', {}, options),
};

// ---- Media Settings ----

export const mediaSettingsApi = {
  get: () =>
    apiClient.get<{ data: CapabilitySettings[] }>('/media-settings').then((r) => r.data ?? []),
  update: (capability: string, data: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/media-settings/${capability}`, data),
  reset: (capability: string) =>
    apiClient.delete<void>(`/media-settings/${capability}`),
};

// ---- Model Configs ----

export const modelConfigsApi = {
  list: () =>
    apiClient.get<{ data: MergedModel[]; count: number }>('/model-configs').then((r) => r.data ?? []),
  availableProviders: () =>
    apiClient.get<{ data: AvailableProvider[] }>('/model-configs/providers/available').then((r) => r.data ?? []),
  capabilities: () =>
    apiClient.get<{ data: CapabilityDef[] }>('/model-configs/capabilities/list').then((r) => r.data ?? []),
  syncApply: () => apiClient.post<Record<string, unknown>>('/model-configs/sync/apply'),
  syncReset: () => apiClient.post<Record<string, unknown>>('/model-configs/sync/reset'),
};

// ---- Local Providers ----

export const localProvidersApi = {
  list: () =>
    apiClient.get<{ data: LocalProvider[] }>('/local-providers').then((r) => r.data ?? []),
  templates: () =>
    apiClient.get<{ data: LocalProviderTemplate[] }>('/local-providers/templates').then((r) => r.data ?? []),
  create: (data: { providerName: string; url: string; apiKey?: string }) =>
    apiClient.post<Record<string, unknown>>('/local-providers', data),
  models: (id: string) =>
    apiClient.get<{ data: Array<{ modelId: string; displayName?: string }> }>(`/local-providers/${id}/models`).then((r) => r.data ?? []),
};

// ---- File Workspaces ----

export const fileWorkspacesApi = {
  list: () =>
    apiClient.get<{ workspaces: FileWorkspaceInfo[]; count: number }>('/file-workspaces'),
  files: (id: string, path?: string) =>
    apiClient.get<{ path: string; files: WorkspaceFile[]; count: number }>(
      `/file-workspaces/${id}/files`,
      { params: path ? { path } : undefined },
    ),
  /** Returns URL for browser download (not an API call) */
  downloadUrl: (id: string) => `/api/v1/file-workspaces/${id}/download`,
  delete: (id: string) => apiClient.delete<void>(`/file-workspaces/${id}`),
  cleanup: (maxAgeDays: number) =>
    apiClient.post<void>('/file-workspaces/cleanup', { maxAgeDays }),
};

// ---- Config Services ----

export const configServicesApi = {
  list: () =>
    apiClient.get<{ services: ConfigServiceView[]; count: number }>('/config-services'),
  stats: () => apiClient.get<ConfigServiceStats>('/config-services/stats'),
  categories: () =>
    apiClient.get<{ categories: string[] }>('/config-services/categories'),
  createEntry: (serviceName: string, body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/config-services/${serviceName}/entries`, body),
  updateEntry: (serviceName: string, entryId: string, body: Record<string, unknown>) =>
    apiClient.put<Record<string, unknown>>(
      `/config-services/${serviceName}/entries/${entryId}`,
      body,
    ),
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
    apiClient.post<Record<string, unknown>>('/channels', body),
  send: (channelId: string, body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/channels/${channelId}/send`, body),
  inbox: (params?: { limit?: number; channelType?: string }) =>
    apiClient.get<{
      messages: ChannelMessage[];
      total: number;
      unreadCount: number;
    }>('/channels/messages/inbox', { params: params as Record<string, string> }),
  markRead: (messageId: string) =>
    apiClient.post<void>(`/channels/messages/${messageId}/read`),
};

// ---- Expenses ----

export const expensesApi = {
  monthly: (year: number) =>
    apiClient.get<ExpenseMonthlyResponse>(`/expenses/monthly`, { params: { year } }),
  summary: (params: Record<string, string>) =>
    apiClient.get<ExpenseSummaryResponse>(`/expenses/summary`, { params }),
  list: (params: Record<string, string>) =>
    apiClient.get<Record<string, unknown>>(`/expenses`, { params }),
  create: (expense: {
    date: string;
    amount: number;
    currency: string;
    category: string;
    description: string;
    notes?: string;
  }) => apiClient.post<Record<string, unknown>>(`/expenses`, expense),
  delete: (id: string) => apiClient.delete<void>(`/expenses/${id}`),
};
