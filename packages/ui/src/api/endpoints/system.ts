import { apiClient } from '../client';

export const systemApi = {
  health: () => apiClient.get<{ status: string; version: string; uptime: number; checks: Array<Record<string, unknown>> }>('/health'),
  databaseStatus: () => apiClient.get<Record<string, unknown>>('/database/status'),
  databaseStats: () => apiClient.get<Record<string, unknown>>('/database/stats'),
  databaseOperation: (endpoint: string, body?: Record<string, unknown>) => apiClient.post<Record<string, unknown>>(`/database/${endpoint}`, body),
  databaseOperationStatus: () => apiClient.get<Record<string, unknown>>('/database/operation/status'),
  deleteBackup: (filename: string) => apiClient.delete<void>(`/database/backup/${filename}`),
};
