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
