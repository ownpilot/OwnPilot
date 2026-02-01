/**
 * Profile API Endpoints
 */

import { apiClient } from '../client';

export const profileApi = {
  get: () => apiClient.get<Record<string, unknown>>('/profile'),
  quickSetup: (data: Record<string, unknown>) =>
    apiClient.post<{ profile: Record<string, unknown> }>('/profile/quick', data),
  setData: (category: string, key: string, value: unknown) =>
    apiClient.post<void>('/profile/data', { category, key, value }),
  export: () =>
    apiClient.get<{ entries: Array<Record<string, unknown>> }>('/profile/export'),
  import: (entries: Array<Record<string, unknown>>) =>
    apiClient.post<void>('/profile/import', { entries }),
};
