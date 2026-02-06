/**
 * Agents API Endpoints
 */

import { apiClient } from '../client';
import type { Agent, AgentDetail } from '../../types';

export const agentsApi = {
  list: async () => {
    const data = await apiClient.get<{ items: Agent[] }>('/agents');
    return data.items;
  },
  get: (id: string) => apiClient.get<AgentDetail>(`/agents/${id}`),
  create: (agent: {
    name: string;
    systemPrompt: string;
    provider?: string;
    model?: string;
    tools?: string[];
    maxTurns?: number;
    maxToolCalls?: number;
    maxTokens?: number;
    temperature?: number;
  }) => apiClient.post<Agent>('/agents', agent),
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<AgentDetail>(`/agents/${id}`, data),
  delete: (id: string) => apiClient.delete<void>(`/agents/${id}`),
};
