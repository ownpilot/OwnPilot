/**
 * Coding Agents API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export interface CodingAgentStatus {
  provider: string;
  displayName: string;
  installed: boolean;
  configured: boolean;
  hasApiKey?: boolean;
  authMethod?: string;
  version?: string;
  ptyAvailable?: boolean;
}

export interface CodingAgentTestResult {
  provider: string;
  available: boolean;
  installed: boolean;
  configured: boolean;
  version?: string;
  ptyAvailable: boolean;
}

export type CodingAgentSessionState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'terminated';

export interface CodingAgentSession {
  id: string;
  provider: string;
  displayName: string;
  state: CodingAgentSessionState;
  mode: 'auto' | 'interactive';
  cwd: string;
  prompt: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  userId: string;
}

export interface CreateCodingSessionInput {
  provider: string;
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: 'auto' | 'interactive';
  timeout_seconds?: number;
  max_turns?: number;
  max_budget_usd?: number;
}

// =============================================================================
// Result types (persisted task outcomes)
// =============================================================================

export interface CodingAgentResultRecord {
  id: string;
  userId: string;
  sessionId?: string;
  provider: string;
  prompt: string;
  cwd?: string;
  model?: string;
  success: boolean;
  output: string;
  exitCode?: number;
  error?: string;
  durationMs: number;
  costUsd?: number;
  mode?: string;
  createdAt: string;
}

// =============================================================================
// CLI Provider types (custom provider registry)
// =============================================================================

export type CliAuthMethod = 'none' | 'config_center' | 'env_var';
export type CliOutputFormat = 'text' | 'json' | 'stream-json';

export interface CliProviderRecord {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  description?: string;
  binary: string;
  category: string;
  icon?: string;
  color?: string;
  authMethod: CliAuthMethod;
  configServiceName?: string;
  apiKeyEnvVar?: string;
  defaultArgs: string[];
  promptTemplate?: string;
  outputFormat: CliOutputFormat;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCliProviderInput {
  name: string;
  display_name: string;
  description?: string;
  binary: string;
  category?: string;
  icon?: string;
  color?: string;
  auth_method?: CliAuthMethod;
  config_service_name?: string;
  api_key_env_var?: string;
  default_args?: string[];
  prompt_template?: string;
  output_format?: CliOutputFormat;
  default_timeout_ms?: number;
  max_timeout_ms?: number;
}

export interface UpdateCliProviderInput {
  name?: string;
  display_name?: string;
  description?: string;
  binary?: string;
  category?: string;
  icon?: string;
  color?: string;
  auth_method?: CliAuthMethod;
  config_service_name?: string;
  api_key_env_var?: string;
  default_args?: string[];
  prompt_template?: string;
  output_format?: CliOutputFormat;
  default_timeout_ms?: number;
  max_timeout_ms?: number;
  is_active?: boolean;
}

export interface CliProviderTestResult {
  installed: boolean;
  version?: string;
  binary: string;
}

// =============================================================================
// API
// =============================================================================

export const codingAgentsApi = {
  /** Get status of all coding agent providers */
  status: () => apiClient.get<CodingAgentStatus[]>('/coding-agents/status'),

  /** Quick connectivity test for a single provider */
  test: (provider: string) =>
    apiClient.post<CodingAgentTestResult>('/coding-agents/test', { provider }),

  // --- Session management ---

  /** List active sessions */
  listSessions: () =>
    apiClient.get<CodingAgentSession[]>('/coding-agents/sessions'),

  /** Create a new PTY session */
  createSession: (input: CreateCodingSessionInput) =>
    apiClient.post<CodingAgentSession>('/coding-agents/sessions', input),

  /** Get a specific session */
  getSession: (id: string) =>
    apiClient.get<CodingAgentSession>(`/coding-agents/sessions/${id}`),

  /** Terminate a session */
  terminateSession: (id: string) =>
    apiClient.delete<{ terminated: boolean }>(`/coding-agents/sessions/${id}`),

  /** Send input to a session (REST fallback for WS) */
  sendInput: (id: string, data: string) =>
    apiClient.post<{ sent: boolean }>(`/coding-agents/sessions/${id}/input`, { data }),

  /** Resize terminal dimensions */
  resizeTerminal: (id: string, cols: number, rows: number) =>
    apiClient.post<{ resized: boolean }>(`/coding-agents/sessions/${id}/resize`, { cols, rows }),

  /** Get session output buffer (REST fallback for WS) */
  getOutput: (id: string) =>
    apiClient.get<{ sessionId: string; state: string; output: string; hasOutput: boolean }>(
      `/coding-agents/sessions/${id}/output`
    ),

  // --- Results ---

  /** List persisted task results */
  listResults: (page = 1, limit = 20) =>
    apiClient.get<{ data: CodingAgentResultRecord[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
      `/coding-agents/results?page=${page}&limit=${limit}`
    ),

  /** Get a specific result */
  getResult: (id: string) =>
    apiClient.get<CodingAgentResultRecord>(`/coding-agents/results/${id}`),
};

// =============================================================================
// CLI Providers API (custom provider registry)
// =============================================================================

export const cliProvidersApi = {
  /** List all CLI providers */
  list: () => apiClient.get<CliProviderRecord[]>('/cli-providers'),

  /** Create a new CLI provider */
  create: (input: CreateCliProviderInput) =>
    apiClient.post<CliProviderRecord>('/cli-providers', input),

  /** Update a CLI provider */
  update: (id: string, input: UpdateCliProviderInput) =>
    apiClient.put<CliProviderRecord>(`/cli-providers/${id}`, input),

  /** Delete a CLI provider */
  delete: (id: string) =>
    apiClient.delete<{ deleted: boolean }>(`/cli-providers/${id}`),

  /** Test if a CLI provider binary is installed */
  test: (id: string) =>
    apiClient.post<CliProviderTestResult>(`/cli-providers/${id}/test`),
};
