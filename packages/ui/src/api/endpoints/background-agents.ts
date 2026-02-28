/**
 * Background Agents API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type BackgroundAgentMode = 'continuous' | 'interval' | 'event';

export type BackgroundAgentState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface BackgroundAgentLimits {
  maxTurnsPerCycle: number;
  maxToolCallsPerCycle: number;
  maxCyclesPerHour: number;
  cycleTimeoutMs: number;
  totalBudgetUsd?: number;
}

export interface BackgroundAgentSession {
  state: BackgroundAgentState;
  cyclesCompleted: number;
  totalToolCalls: number;
  totalCostUsd: number;
  lastCycleAt: string | null;
  lastCycleDurationMs: number | null;
  lastCycleError: string | null;
  startedAt: string;
  stoppedAt: string | null;
}

export interface BackgroundAgentConfig {
  id: string;
  userId: string;
  name: string;
  mission: string;
  mode: BackgroundAgentMode;
  allowedTools: string[];
  limits: BackgroundAgentLimits;
  intervalMs?: number;
  eventFilters?: string[];
  autoStart: boolean;
  stopCondition?: string;
  createdBy: 'user' | 'ai';
  createdAt: string;
  updatedAt: string;
  session: BackgroundAgentSession | null;
}

export interface BackgroundAgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  duration: number;
}

export interface BackgroundAgentHistoryEntry {
  id: string;
  agentId: string;
  cycleNumber: number;
  success: boolean;
  toolCalls: BackgroundAgentToolCall[];
  outputMessage: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  turns: number;
  error?: string;
  executedAt: string;
}

export interface CreateBackgroundAgentInput {
  name: string;
  mission: string;
  mode?: BackgroundAgentMode;
  allowed_tools?: string[];
  limits?: Partial<BackgroundAgentLimits>;
  interval_ms?: number;
  event_filters?: string[];
  auto_start?: boolean;
  stop_condition?: string;
}

// =============================================================================
// API
// =============================================================================

export const backgroundAgentsApi = {
  list: () => apiClient.get<BackgroundAgentConfig[]>('/background-agents'),

  get: (id: string) => apiClient.get<BackgroundAgentConfig>(`/background-agents/${id}`),

  create: (input: CreateBackgroundAgentInput) =>
    apiClient.post<BackgroundAgentConfig>('/background-agents', input),

  update: (id: string, input: Partial<CreateBackgroundAgentInput>) =>
    apiClient.patch<BackgroundAgentConfig>(`/background-agents/${id}`, input),

  delete: (id: string) => apiClient.delete(`/background-agents/${id}`),

  start: (id: string) => apiClient.post<{ state: string }>(`/background-agents/${id}/start`),

  pause: (id: string) => apiClient.post<{ state: string }>(`/background-agents/${id}/pause`),

  resume: (id: string) => apiClient.post<{ state: string }>(`/background-agents/${id}/resume`),

  stop: (id: string) => apiClient.post<{ state: string }>(`/background-agents/${id}/stop`),

  getHistory: (id: string, limit = 20, offset = 0) =>
    apiClient.get<{ entries: BackgroundAgentHistoryEntry[]; total: number }>(
      `/background-agents/${id}/history?limit=${limit}&offset=${offset}`
    ),

  sendMessage: (id: string, message: string) =>
    apiClient.post<{ sent: boolean }>(`/background-agents/${id}/message`, { message }),
};
