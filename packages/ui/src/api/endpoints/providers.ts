/**
 * Provider API Endpoints
 */

import { apiClient } from '../client';
import type { ProviderInfo, ProviderConfig, UserOverride } from '../../types';

export interface ProvidersListData {
  providers: (ProviderInfo | ProviderConfig)[];
  total: number;
}

export interface ProviderConfigData {
  userOverride?: UserOverride;
  baseConfig?: Record<string, unknown>;
}

export const providersApi = {
  list: () => apiClient.get<ProvidersListData>('/providers'),
  categories: () =>
    apiClient.get<{ categories: Record<string, string[]>; uncategorized: string[] }>(
      '/providers/categories'
    ),
  getConfig: (id: string) => apiClient.get<ProviderConfigData>(`/providers/${id}/config`),
  updateConfig: (id: string, config: Record<string, unknown>) =>
    apiClient.put<void>(`/providers/${id}/config`, config),
  toggle: (id: string, enabled: boolean) =>
    apiClient.patch<void>(`/providers/${id}/toggle`, { enabled }),
  resetConfig: (id: string) => apiClient.delete<void>(`/providers/${id}/config`),
  models: (id: string) =>
    apiClient.get<{ models: Array<{ id: string; name: string }>; providerName?: string }>(
      `/providers/${id}/models`
    ),
};
