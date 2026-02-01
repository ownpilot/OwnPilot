/**
 * Personal Data API Endpoints
 *
 * Notes, Bookmarks, Contacts, Calendar, Goals, Memories, Plans, Triggers
 */

import { apiClient } from '../client';

// ---- Notes ----

export const notesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<unknown[]>('/notes', { params }),
  create: (body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/notes', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/notes/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/notes/${id}`),
  pin: (id: string) => apiClient.post<void>(`/notes/${id}/pin`),
};

// ---- Bookmarks ----

export const bookmarksApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<unknown[]>('/bookmarks', { params }),
  create: (body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/bookmarks', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/bookmarks/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/bookmarks/${id}`),
  favorite: (id: string) => apiClient.post<void>(`/bookmarks/${id}/favorite`),
};

// ---- Contacts ----

export const contactsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<unknown[]>('/contacts', { params }),
  create: (body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/contacts', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/contacts/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/contacts/${id}`),
  favorite: (id: string) => apiClient.post<void>(`/contacts/${id}/favorite`),
};

// ---- Calendar ----

export const calendarApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<unknown[]>('/calendar', { params }),
  create: (body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/calendar', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/calendar/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/calendar/${id}`),
};

// ---- Goals ----

export const goalsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<{ goals: unknown[] }>('/goals', { params }),
  delete: (id: string) => apiClient.delete<void>(`/goals/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/goals/${id}`, data),
  steps: (id: string) =>
    apiClient.get<{ steps: unknown[] }>(`/goals/${id}/steps`),
  updateStep: (goalId: string, stepId: string, data: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/goals/${goalId}/steps/${stepId}`, data),
};

// ---- Memories ----

export const memoriesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<{ memories: unknown[] }>('/memories', { params }),
  delete: (id: string) => apiClient.delete<void>(`/memories/${id}`),
};

// ---- Plans ----

export const plansApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<{ plans: unknown[] }>('/plans', { params }),
  delete: (id: string) => apiClient.delete<void>(`/plans/${id}`),
  action: (id: string, endpoint: string) =>
    apiClient.post<Record<string, unknown>>(`/plans/${id}/${endpoint}`),
  rollback: (id: string) =>
    apiClient.post<Record<string, unknown>>(`/plans/${id}/rollback`),
  history: (id: string) =>
    apiClient.get<{ history: unknown[] }>(`/plans/${id}/history`),
  steps: (id: string) =>
    apiClient.get<{ steps: unknown[] }>(`/plans/${id}/steps`),
  addStep: (id: string, data: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/plans/${id}/steps`, data),
};

// ---- Triggers ----

export const triggersApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<{ triggers: unknown[] }>('/triggers', { params }),
  history: (id: string) =>
    apiClient.get<{ history: unknown[] }>(`/triggers/${id}/history`),
  delete: (id: string) => apiClient.delete<void>(`/triggers/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Record<string, unknown>>(`/triggers/${id}`, data),
  fire: (id: string) =>
    apiClient.post<Record<string, unknown>>(`/triggers/${id}/fire`),
};
