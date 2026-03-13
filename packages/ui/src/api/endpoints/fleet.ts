/**
 * Fleet API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type FleetWorkerType = 'ai-chat' | 'coding-cli' | 'api-call' | 'mcp-bridge';
export type FleetScheduleType = 'continuous' | 'interval' | 'cron' | 'event' | 'on-demand';
export type FleetTaskPriority = 'low' | 'normal' | 'high' | 'critical';
export type FleetTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type FleetSessionState = 'running' | 'paused' | 'stopped' | 'completed' | 'error';

export interface FleetWorkerConfig {
  name: string;
  type: FleetWorkerType;
  description?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  skills?: string[];
  cliProvider?: string;
  cwd?: string;
  mcpServer?: string;
  mcpTools?: string[];
  maxTurns?: number;
  maxTokens?: number;
  timeoutMs?: number;
  count?: number;
}

export interface FleetBudget {
  maxCostUsd?: number;
  maxCyclesPerHour?: number;
  maxTotalCycles?: number;
}

export interface FleetScheduleConfig {
  intervalMs?: number;
  cron?: string;
  eventFilters?: string[];
}

export interface FleetSession {
  state: FleetSessionState;
  cyclesCompleted: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  activeWorkers: number;
  startedAt: string;
  stoppedAt: string | null;
}

export interface FleetConfig {
  id: string;
  userId: string;
  name: string;
  description?: string;
  mission: string;
  scheduleType: FleetScheduleType;
  scheduleConfig?: FleetScheduleConfig;
  workers: FleetWorkerConfig[];
  budget?: FleetBudget;
  concurrencyLimit: number;
  autoStart: boolean;
  provider?: string;
  model?: string;
  sharedContext?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  session: FleetSession | null;
}

export interface FleetTask {
  id: string;
  fleetId: string;
  title: string;
  description: string;
  assignedWorker?: string;
  priority: FleetTaskPriority;
  status: FleetTaskStatus;
  input?: Record<string, unknown>;
  output?: string;
  dependsOn?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retries: number;
  maxRetries: number;
}

export interface FleetWorkerResult {
  workerId: string;
  workerName: string;
  workerType: FleetWorkerType;
  taskId?: string;
  success: boolean;
  output: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  error?: string;
  executedAt: string;
}

export interface CreateFleetInput {
  name: string;
  mission: string;
  description?: string;
  workers: Array<{
    name: string;
    type: FleetWorkerType;
    description?: string;
    provider?: string;
    model?: string;
    system_prompt?: string;
    allowed_tools?: string[];
    cli_provider?: string;
    cwd?: string;
    mcp_server?: string;
    mcp_tools?: string[];
  }>;
  schedule_type?: FleetScheduleType;
  schedule_config?: Record<string, unknown>;
  budget?: FleetBudget;
  concurrency_limit?: number;
  auto_start?: boolean;
  provider?: string;
  model?: string;
  shared_context?: Record<string, unknown>;
}

export interface CreateFleetTaskInput {
  title: string;
  description: string;
  assigned_worker?: string;
  priority?: FleetTaskPriority;
  input?: Record<string, unknown>;
  depends_on?: string[];
  max_retries?: number;
}

// =============================================================================
// API
// =============================================================================

export const fleetApi = {
  list: () => apiClient.get<FleetConfig[]>('/fleet'),

  get: (id: string) => apiClient.get<FleetConfig>(`/fleet/${id}`),

  create: (input: CreateFleetInput) => apiClient.post<FleetConfig>('/fleet', input),

  update: (id: string, input: Partial<CreateFleetInput>) =>
    apiClient.put<FleetConfig>(`/fleet/${id}`, input),

  delete: (id: string) => apiClient.delete(`/fleet/${id}`),

  start: (id: string) => apiClient.post<{ state: string; startedAt: string }>(`/fleet/${id}/start`),

  pause: (id: string) => apiClient.post<{ state: string }>(`/fleet/${id}/pause`),

  resume: (id: string) => apiClient.post<{ state: string }>(`/fleet/${id}/resume`),

  stop: (id: string) => apiClient.post<{ state: string }>(`/fleet/${id}/stop`),

  // Tasks
  listTasks: (id: string, status?: string) =>
    apiClient.get<FleetTask[]>(`/fleet/${id}/tasks${status ? `?status=${status}` : ''}`),

  addTasks: (id: string, tasks: CreateFleetTaskInput[]) =>
    apiClient.post<FleetTask[]>(`/fleet/${id}/tasks`, { tasks }),

  // Communication
  broadcast: (id: string, message: string) =>
    apiClient.post<{ sent: boolean }>(`/fleet/${id}/broadcast`, { message }),

  // Session & History
  getSession: (id: string) => apiClient.get<FleetSession | null>(`/fleet/${id}/session`),

  getHistory: (id: string, limit = 20, offset = 0) =>
    apiClient.get<{ entries: FleetWorkerResult[]; total: number }>(
      `/fleet/${id}/history?limit=${limit}&offset=${offset}`
    ),
};
