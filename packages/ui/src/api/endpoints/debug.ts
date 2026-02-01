import { apiClient } from '../client';

export const debugApi = {
  get: (count?: number) => apiClient.get<{ enabled: boolean; entries: Array<Record<string, unknown>>; summary: Record<string, number> }>('/debug', { params: count ? { count: String(count) } : undefined }),
  clear: () => apiClient.delete<void>('/debug'),
  getLogs: (id: string) => apiClient.get<Record<string, unknown>>(`/chat/logs/${id}`),
  deleteLogs: (params: { olderThanDays?: number; all?: boolean }) => {
    const p: Record<string, string> = {};
    if (params.olderThanDays !== undefined) p.olderThanDays = String(params.olderThanDays);
    if (params.all) p.all = 'true';
    return apiClient.delete<void>('/chat/logs', { params: p });
  },
};
