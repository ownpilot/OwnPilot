/**
 * Personal Data API Endpoints
 *
 * Notes, Bookmarks, Contacts, Calendar, Goals, Memories, Plans, Triggers
 */

import { apiClient } from '../client';
import type {
  Note,
  BookmarkItem,
  Contact,
  CalendarEvent,
  Goal,
  GoalStep,
  Memory,
  Plan,
  PlanStep,
  PlanHistoryEntry,
  Trigger,
  TriggerHistoryParams,
  PaginatedHistory,
} from '../types';

// ---- Notes ----

export const notesApi = {
  list: (params?: Record<string, string>) => apiClient.get<Note[]>('/notes', { params }),
  create: (body: Record<string, unknown>) => apiClient.post<Note>('/notes', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Note>(`/notes/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/notes/${id}`),
  pin: (id: string) => apiClient.post<void>(`/notes/${id}/pin`),
};

// ---- Bookmarks ----

export const bookmarksApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<BookmarkItem[]>('/bookmarks', { params }),
  create: (body: Record<string, unknown>) => apiClient.post<BookmarkItem>('/bookmarks', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<BookmarkItem>(`/bookmarks/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/bookmarks/${id}`),
  favorite: (id: string) => apiClient.post<void>(`/bookmarks/${id}/favorite`),
};

// ---- Contacts ----

export const contactsApi = {
  list: (params?: Record<string, string>) => apiClient.get<Contact[]>('/contacts', { params }),
  create: (body: Record<string, unknown>) => apiClient.post<Contact>('/contacts', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<Contact>(`/contacts/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/contacts/${id}`),
  favorite: (id: string) => apiClient.post<void>(`/contacts/${id}/favorite`),
};

// ---- Calendar ----

export const calendarApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<CalendarEvent[]>('/calendar', { params }),
  create: (body: Record<string, unknown>) => apiClient.post<CalendarEvent>('/calendar', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<CalendarEvent>(`/calendar/${id}`, body),
  delete: (id: string) => apiClient.delete<void>(`/calendar/${id}`),
};

// ---- Goals ----

export const goalsApi = {
  list: (params?: Record<string, string>) => apiClient.get<{ goals: Goal[] }>('/goals', { params }),
  create: (data: Record<string, unknown>) => apiClient.post<Goal>('/goals', data),
  delete: (id: string) => apiClient.delete<void>(`/goals/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Goal>(`/goals/${id}`, data),
  steps: (id: string) => apiClient.get<{ steps: GoalStep[] }>(`/goals/${id}/steps`),
  updateStep: (goalId: string, stepId: string, data: Record<string, unknown>) =>
    apiClient.patch<GoalStep>(`/goals/${goalId}/steps/${stepId}`, data),
};

// ---- Memories ----

export const memoriesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<{ memories: Memory[] }>('/memories', { params }),
  create: (data: Record<string, unknown>) => apiClient.post<Memory>('/memories', data),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Memory>(`/memories/${id}`, data),
  delete: (id: string) => apiClient.delete<void>(`/memories/${id}`),
};

// ---- Plans ----

export const plansApi = {
  list: (params?: Record<string, string>) => apiClient.get<{ plans: Plan[] }>('/plans', { params }),
  create: (data: Record<string, unknown>) => apiClient.post<Plan>('/plans', data),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Plan>(`/plans/${id}`, data),
  delete: (id: string) => apiClient.delete<void>(`/plans/${id}`),
  action: (id: string, endpoint: string) => apiClient.post<Plan>(`/plans/${id}/${endpoint}`),
  rollback: (id: string) => apiClient.post<Plan>(`/plans/${id}/rollback`),
  history: (id: string) => apiClient.get<{ history: PlanHistoryEntry[] }>(`/plans/${id}/history`),
  steps: (id: string) => apiClient.get<{ steps: PlanStep[] }>(`/plans/${id}/steps`),
  addStep: (id: string, data: Record<string, unknown>) =>
    apiClient.post<PlanStep>(`/plans/${id}/steps`, data),
};

// ---- Captures ----

export const capturesApi = {
  create: (body: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/captures', body),
};

// ---- Triggers ----

export const triggersApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<{ triggers: Trigger[] }>('/triggers', { params }),
  history: (id: string, params?: TriggerHistoryParams) => {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.from) p.from = params.from;
    if (params?.to) p.to = params.to;
    if (params?.limit != null) p.limit = String(params.limit);
    if (params?.offset != null) p.offset = String(params.offset);
    return apiClient.get<PaginatedHistory>(`/triggers/${id}/history`, {
      params: Object.keys(p).length ? p : undefined,
    });
  },
  delete: (id: string) => apiClient.delete<void>(`/triggers/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Trigger>(`/triggers/${id}`, data),
  fire: (id: string) => apiClient.post<Record<string, unknown>>(`/triggers/${id}/fire`),
  stats: () => apiClient.get<Record<string, unknown>>('/triggers/stats'),
  globalHistory: (params?: TriggerHistoryParams) => {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.triggerId) p.triggerId = params.triggerId;
    if (params?.from) p.from = params.from;
    if (params?.to) p.to = params.to;
    if (params?.limit != null) p.limit = String(params.limit);
    if (params?.offset != null) p.offset = String(params.offset);
    return apiClient.get<PaginatedHistory>('/triggers/history', {
      params: Object.keys(p).length ? p : undefined,
    });
  },
  due: () => apiClient.get<{ triggers: Trigger[]; count: number }>('/triggers/due'),
  engineStatus: () => apiClient.get<{ running: boolean }>('/triggers/engine/status'),
  engineStart: () =>
    apiClient.post<{ running: boolean; message: string }>('/triggers/engine/start'),
  engineStop: () => apiClient.post<{ running: boolean; message: string }>('/triggers/engine/stop'),
};
