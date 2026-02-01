/**
 * Tools API Endpoints
 */

import { apiClient } from '../client';
import type { Tool } from '../../types';

interface ToolGroup {
  category: string;
  tools: Tool[];
}

export const toolsApi = {
  list: () => apiClient.get<Tool[]>('/tools'),
  listGrouped: () =>
    apiClient.get<ToolGroup[]>('/tools', { params: { grouped: 'true' } }),
  execute: (toolName: string, args: Record<string, unknown>) =>
    apiClient.post<unknown>(`/tools/${toolName}/execute`, { arguments: args }),
  source: (toolName: string) =>
    apiClient.get<{ source: string }>(`/tools/${toolName}/source`),
};
