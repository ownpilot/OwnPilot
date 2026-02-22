/**
 * Custom Tools API Endpoints
 */

import { apiClient } from '../client';
import type { CustomTool, ToolStats, ToolStatus } from '../../types';

export const customToolsApi = {
  list: (status?: ToolStatus) =>
    apiClient.get<{ tools: CustomTool[] }>('/custom-tools', {
      params: status ? { status } : undefined,
    }),
  stats: () => apiClient.get<ToolStats>('/custom-tools/stats'),
  create: (tool: {
    name: string;
    description: string;
    code: string;
    parameters: Record<string, unknown>;
    category?: string;
    permissions?: string[];
    requiresApproval?: boolean;
    createdBy?: string;
  }) => apiClient.post<CustomTool>('/custom-tools', tool),
  action: (id: string, action: 'enable' | 'disable' | 'approve' | 'reject') =>
    apiClient.post<void>(`/custom-tools/${id}/${action}`),
  delete: (id: string) => apiClient.delete<void>(`/custom-tools/${id}`),
  execute: (id: string, args: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>(`/custom-tools/${id}/execute`, { arguments: args }),

  /** Toggle workflowUsable flag for a custom tool */
  setWorkflowUsable: (id: string, enabled: boolean) =>
    apiClient.patch<{ workflowUsable: boolean }>(`/custom-tools/${id}/workflow-usable`, { enabled }),
};
