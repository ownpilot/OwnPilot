/**
 * Workflows API Endpoints
 */

import { apiClient } from '../client';
import type { Workflow, WorkflowLog, WorkflowVersion, WorkflowApproval, WorkflowProgressEvent } from '../types';

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

interface PaginatedVersions {
  versions: WorkflowVersion[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface PaginatedApprovals {
  approvals: WorkflowApproval[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const workflowsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<PaginatedWorkflows>('/workflows', { params }),

  get: (id: string) => apiClient.get<Workflow>(`/workflows/${id}`),

  create: (data: Record<string, unknown>) => apiClient.post<Workflow>('/workflows', data),

  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Workflow>(`/workflows/${id}`, data),

  delete: (id: string) => apiClient.delete<void>(`/workflows/${id}`),

  clone: (id: string) => apiClient.post<Workflow>(`/workflows/${id}/clone`),

  /** Execute workflow — returns raw Response for SSE streaming */
  execute: (id: string, options?: { dryRun?: boolean }) => {
    const query = options?.dryRun ? '?dryRun=true' : '';
    return apiClient.stream(`/workflows/${id}/execute${query}`, {});
  },

  cancel: (id: string) => apiClient.post<{ message: string }>(`/workflows/${id}/cancel`),

  logs: (id: string, params?: Record<string, string>) =>
    apiClient.get<PaginatedLogs>(`/workflows/${id}/logs`, { params }),

  recentLogs: (params?: Record<string, string>) =>
    apiClient.get<PaginatedLogs>('/workflows/logs/recent', { params }),

  logDetail: (logId: string) => apiClient.get<WorkflowLog>(`/workflows/logs/${logId}`),

  versions: (id: string, params?: Record<string, string>) =>
    apiClient.get<PaginatedVersions>(`/workflows/${id}/versions`, { params }),

  restoreVersion: (id: string, version: number) =>
    apiClient.post<Workflow>(`/workflows/${id}/versions/${version}/restore`),

  /** Copilot — stream AI-generated workflow definitions */
  copilot: (body: WorkflowCopilotRequest, options?: { signal?: AbortSignal }) =>
    apiClient.stream('/workflows/copilot', body, { signal: options?.signal }),

  /** Get tool names used in active workflows */
  activeToolNames: () => apiClient.get<string[]>('/workflows/active-tool-names'),

  // Approvals
  pendingApprovals: (params?: Record<string, string>) =>
    apiClient.get<PaginatedApprovals>('/workflows/approvals/pending', { params }),

  allApprovals: (params?: Record<string, string>) =>
    apiClient.get<PaginatedApprovals>('/workflows/approvals/all', { params }),

  approveApproval: (id: string) =>
    apiClient.post<WorkflowApproval>(`/workflows/approvals/${id}/approve`),

  rejectApproval: (id: string) =>
    apiClient.post<WorkflowApproval>(`/workflows/approvals/${id}/reject`),

  /** Replay a completed execution — returns SSE stream */
  replayLog: (logId: string) =>
    apiClient.stream(`/workflows/logs/${logId}/replay`, {}),

  /** Public API: Run workflow with inputs (requires API key) */
  apiRun: (id: string, inputs?: Record<string, unknown>) =>
    apiClient.post<{ logId: string; workflowId: string; status: string; pollUrl: string }>(
      `/workflows/${id}/run`,
      inputs ? { inputs } : {}
    ),

  /** Public API: Poll run status */
  apiRunStatus: (id: string, logId: string) =>
    apiClient.get<WorkflowLog>(`/workflows/${id}/run/${logId}`),
};

export interface WorkflowCopilotRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentWorkflow?: { name: string; nodes: unknown[]; edges: unknown[] };
  availableTools?: string[];
  provider?: string;
  model?: string;
}

export type {
  PaginatedWorkflows,
  PaginatedLogs,
  PaginatedVersions,
  PaginatedApprovals,
  Workflow,
  WorkflowLog,
  WorkflowVersion,
  WorkflowApproval,
  WorkflowProgressEvent,
};
