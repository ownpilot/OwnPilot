import { apiClient } from '../client';

export const autonomyApi = {
  getConfig: () => apiClient.get<Record<string, unknown>>('/autonomy/config'),
  getApprovals: () => apiClient.get<Array<Record<string, unknown>>>('/autonomy/approvals'),
  setLevel: (level: string) => apiClient.post<void>('/autonomy/level', { level }),
  updateBudget: (budget: Record<string, unknown>) => apiClient.patch<void>('/autonomy/budget', budget),
  allowTool: (tool: string) => apiClient.post<void>('/autonomy/tools/allow', { tool }),
  blockTool: (tool: string) => apiClient.post<void>('/autonomy/tools/block', { tool }),
  removeTool: (tool: string) => apiClient.delete<void>(`/autonomy/tools/${tool}`),
  resolveApproval: (actionId: string, decision: 'approve' | 'reject') => apiClient.post<void>(`/autonomy/approvals/${actionId}/${decision}`),
  resetConfig: () => apiClient.post<void>('/autonomy/config/reset'),
};
