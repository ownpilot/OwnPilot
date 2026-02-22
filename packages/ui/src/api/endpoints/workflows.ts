/**
 * Workflows API Endpoints
 */

import { apiClient } from '../client';
import type { Workflow, WorkflowLog, WorkflowProgressEvent } from '../types';

interface PaginatedWorkflows {
  workflows: Workflow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface PaginatedLogs {
  logs: WorkflowLog[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const workflowsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<PaginatedWorkflows>('/workflows', { params }),

  get: (id: string) =>
    apiClient.get<Workflow>(`/workflows/${id}`),

  create: (data: Record<string, unknown>) =>
    apiClient.post<Workflow>('/workflows', data),

  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Workflow>(`/workflows/${id}`, data),

  delete: (id: string) =>
    apiClient.delete<void>(`/workflows/${id}`),

  /** Execute workflow — returns raw Response for SSE streaming */
  execute: (id: string) =>
    apiClient.stream(`/workflows/${id}/execute`, {}),

  cancel: (id: string) =>
    apiClient.post<{ message: string }>(`/workflows/${id}/cancel`),

  logs: (id: string, params?: Record<string, string>) =>
    apiClient.get<PaginatedLogs>(`/workflows/${id}/logs`, { params }),

  recentLogs: (params?: Record<string, string>) =>
    apiClient.get<PaginatedLogs>('/workflows/logs/recent', { params }),

  logDetail: (logId: string) =>
    apiClient.get<WorkflowLog>(`/workflows/logs/${logId}`),

  /** Copilot — stream AI-generated workflow definitions */
  copilot: (body: WorkflowCopilotRequest, options?: { signal?: AbortSignal }) =>
    apiClient.stream('/workflows/copilot', body, { signal: options?.signal }),

  /** Get tool names used in active workflows */
  activeToolNames: () =>
    apiClient.get<string[]>('/workflows/active-tool-names'),
};

export interface WorkflowCopilotRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentWorkflow?: { name: string; nodes: unknown[]; edges: unknown[] };
  availableTools?: string[];
  provider?: string;
  model?: string;
}

export type { PaginatedWorkflows, PaginatedLogs, Workflow, WorkflowLog, WorkflowProgressEvent };
