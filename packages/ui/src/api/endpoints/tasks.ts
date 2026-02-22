/**
 * Tasks API Endpoints
 */

import { apiClient } from '../client';
import type { Task } from '../../types';

export const tasksApi = {
  list: (params?: { status?: string[] }) =>
    apiClient.get<Task[]>('/tasks', {
      params: params?.status ? { status: params.status } : undefined,
    }),
  create: (body: Record<string, unknown>) => apiClient.post<Task>('/tasks', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Task>(`/tasks/${id}`, body),
  complete: (id: string) => apiClient.post<Task>(`/tasks/${id}/complete`),
  delete: (id: string) => apiClient.delete<void>(`/tasks/${id}`),
};
