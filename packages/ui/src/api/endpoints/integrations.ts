/**
 * Integrations & Auth API Endpoints
 */

import { apiClient } from '../client';
import type { Integration, AvailableIntegration } from '../../types';

export const integrationsApi = {
  list: () => apiClient.get<Integration[]>('/integrations'),
  available: () => apiClient.get<AvailableIntegration[]>('/integrations/available'),
  delete: (id: string) => apiClient.delete<void>(`/integrations/${id}`),
  sync: (id: string) => apiClient.post<void>(`/integrations/${id}/sync`),
};

export const authApi = {
  status: () =>
    apiClient.get<{ google: { configured: boolean; redirectUri?: string } }>('/auth/status'),
  /** Build the OAuth start URL (browser navigation, not API call) */
  startUrl: (provider: string, service: string, returnUrl: string) =>
    `/api/v1/auth/${provider}/start?service=${encodeURIComponent(service)}&returnUrl=${encodeURIComponent(returnUrl)}`,
  saveGoogleConfig: (config: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  }) => apiClient.post<void>('/auth/config/google', config),
  deleteGoogleConfig: () => apiClient.delete<void>('/auth/config/google'),
};
