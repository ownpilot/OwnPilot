/**
 * Settings API Endpoints
 */

import { apiClient } from '../client';
import type { SettingsData } from '../../types';

export interface ToolGroupInfo {
  id: string;
  name: string;
  description: string;
  toolCount: number;
  tools: string[];
  enabled: boolean;
  alwaysOn: boolean;
  defaultEnabled: boolean;
}

// ---- Model Routing Types ----

export interface ProcessRouting {
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
}

export interface ResolvedRouting extends ProcessRouting {
  source: 'process' | 'global' | 'first-configured';
}

export type RoutingProcess = 'chat' | 'telegram' | 'pulse';

export interface ModelRoutingData {
  routing: Record<RoutingProcess, ProcessRouting>;
  resolved: Record<RoutingProcess, ResolvedRouting>;
}

export interface ProcessRoutingData {
  routing: ProcessRouting;
  resolved: ResolvedRouting;
}

// ---- Model Routing API ----

export const modelRoutingApi = {
  getAll: () => apiClient.get<ModelRoutingData>('/model-routing'),
  get: (process: RoutingProcess) => apiClient.get<ProcessRoutingData>(`/model-routing/${process}`),
  update: (process: RoutingProcess, data: Partial<ProcessRouting>) =>
    apiClient.put<ProcessRoutingData>(`/model-routing/${process}`, data),
  clear: (process: RoutingProcess) =>
    apiClient.delete<{ cleared: boolean }>(`/model-routing/${process}`),
};

// ---- Settings API ----

export const settingsApi = {
  get: () => apiClient.get<SettingsData>('/settings'),
  getProviders: () =>
    apiClient.get<{ providers: Array<{ id: string; name: string; apiKeyEnv: string }> }>(
      '/providers'
    ),
  saveApiKey: (provider: string, apiKey: string) =>
    apiClient.post<void>('/settings/api-keys', { provider, apiKey }),
  setDefaultProvider: (provider: string) =>
    apiClient.post<void>('/settings/default-provider', { provider }),
  setDefaultModel: (model: string) => apiClient.post<void>('/settings/default-model', { model }),
  deleteApiKey: (provider: string) => apiClient.delete<void>(`/settings/api-keys/${provider}`),
  getToolGroups: () =>
    apiClient.get<{ groups: ToolGroupInfo[]; enabledGroupIds: string[] }>('/settings/tool-groups'),
  saveToolGroups: (enabledGroupIds: string[]) =>
    apiClient.put<{ enabledGroupIds: string[] }>('/settings/tool-groups', { enabledGroupIds }),
};
