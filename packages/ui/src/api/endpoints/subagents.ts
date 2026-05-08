/**
 * Subagent API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type SubagentState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface SubagentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  durationMs: number;
}

export interface SubagentSession {
  id: string;
  parentId: string;
  parentType: string;
  userId: string;
  name: string;
  task: string;
  state: SubagentState;
  spawnedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  turnsUsed: number;
  toolCallsUsed: number;
  tokensUsed: { prompt: number; completion: number } | null;
  durationMs: number | null;
  result: string | null;
  error: string | null;
  toolCalls: SubagentToolCall[];
  provider: string;
  model: string;
}

export interface SubagentHistoryEntry {
  id: string;
  parentId: string;
  parentType: string;
  userId: string;
  name: string;
  task: string;
  state: SubagentState;
  result: string | null;
  error: string | null;
  toolCalls: SubagentToolCall[];
  turnsUsed: number;
  toolCallsUsed: number;
  tokensUsed: { prompt: number; completion: number } | null;
  durationMs: number | null;
  provider: string;
  model: string;
  spawnedAt: string;
  completedAt: string | null;
}

export interface SpawnSubagentInput {
  parentId?: string;
  parentType?: string;
  name: string;
  task: string;
  context?: string;
  allowedTools?: string[];
  provider?: string;
  model?: string;
  limits?: {
    maxTurns?: number;
    maxToolCalls?: number;
    timeoutMs?: number;
    maxTokens?: number;
  };
}

// =============================================================================
// API
// =============================================================================

export const subagentsApi = {
  list: (parentId?: string) =>
    apiClient.get<SubagentSession[]>(parentId ? `/subagents?parentId=${parentId}` : '/subagents'),

  get: (id: string) => apiClient.get<SubagentSession>(`/subagents/${id}`),

  spawn: (input: SpawnSubagentInput) => apiClient.post<SubagentSession>('/subagents', input),

  cancel: (id: string) => apiClient.delete(`/subagents/${id}`),

  getHistory: (parentId?: string, limit = 20, offset = 0) =>
    apiClient.get<{ entries: SubagentHistoryEntry[]; total: number }>(
      `/subagents/history?${parentId ? `parentId=${parentId}&` : ''}limit=${limit}&offset=${offset}`
    ),

  stats: () =>
    apiClient.get<{
      active: number;
      total: number;
      successRate: number;
      avgCost: number;
      avgDuration: number;
      totalCost: number;
      errorRate: number;
      byState: Record<string, number>;
      totalTokens: { input: number; output: number };
    }>('/subagents/stats'),

  health: () =>
    apiClient.get<{
      status: string;
      score: number;
      signals: string[];
      recommendations: string[];
    }>('/subagents/health'),
};
