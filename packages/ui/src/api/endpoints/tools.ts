/**
 * Tools API Endpoints
 */

import { apiClient } from '../client';
import type { Tool } from '../../types';

/**
 * Response from GET /tools?grouped=true
 * Matches the gateway's grouped tools response format
 */
interface GroupedToolsResponse {
  categories: Record<
    string,
    {
      info: {
        icon: string;
        description: string;
      };
      tools: Tool[];
    }
  >;
  totalTools: number;
}

export const toolsApi = {
  list: () => apiClient.get<Tool[]>('/tools'),
  listGrouped: () => apiClient.get<GroupedToolsResponse>('/tools', { params: { grouped: 'true' } }),
  execute: (toolName: string, args: Record<string, unknown>) =>
    apiClient.post<unknown>(`/tools/${toolName}/execute`, { arguments: args }),
  source: (toolName: string) => apiClient.get<{ source: string }>(`/tools/${toolName}/source`),
};
