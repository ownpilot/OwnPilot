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
  installCommand?: string;
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

export type CodingAgentOutputFormat = 'text' | 'json' | 'stream-json';
export type CodingAgentFileAccess = 'none' | 'read-only' | 'read-write' | 'full';
export type CodingAgentAutonomy = 'supervised' | 'semi-auto' | 'full-auto';

export interface CodingAgentPermissions {
  output_format?: CodingAgentOutputFormat;
  file_access?: CodingAgentFileAccess;
  allowed_paths?: string[];
  network_access?: boolean;
  shell_access?: boolean;
  git_access?: boolean;
  autonomy?: CodingAgentAutonomy;
  max_file_changes?: number;
}

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
  skillIds?: string[];
  permissions?: CodingAgentPermissions;
  acp?: {
    enabled: boolean;
    toolCalls: AcpToolCall[];
    plan: AcpPlan | null;
  };
}

// =============================================================================
// ACP (Agent Client Protocol) types
// =============================================================================

export interface AcpToolCall {
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  rawInput?: Record<string, unknown>;
  content?: AcpToolCallContent[];
  locations?: Array<{ path: string; startLine?: number }>;
  startedAt: string;
  completedAt?: string;
}

export interface AcpToolCallContent {
  type: 'text' | 'diff' | 'terminal' | 'content';
  text?: string;
  path?: string;
  oldText?: string;
  newText?: string;
  terminalId?: string;
  content?: unknown;
}

export interface AcpPlan {
  entries: Array<{ content: string; status: string; priority: string }>;
  updatedAt: string;
}

export interface AcpData {
  toolCalls: AcpToolCall[];
  plan: AcpPlan | null;
  isAcp: boolean;
}

export interface AcpPromptResult {
  stopReason: string;
  output: string;
}

export interface CreateCodingSessionInput {
  provider: string;
  prompt: string;
  cwd?: string;
  model?: string;
  settings_file?: string;
  mode?: 'auto' | 'interactive';
  timeout_seconds?: number;
  max_turns?: number;
  max_budget_usd?: number;
  skill_ids?: string[];
  permissions?: CodingAgentPermissions;
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
  listSessions: () => apiClient.get<CodingAgentSession[]>('/coding-agents/sessions'),

  /** Create a new PTY session */
  createSession: (input: CreateCodingSessionInput) =>
    apiClient.post<CodingAgentSession>('/coding-agents/sessions', input),

  /** Get a specific session */
  getSession: (id: string) => apiClient.get<CodingAgentSession>(`/coding-agents/sessions/${id}`),

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
    apiClient.get<{
      data: CodingAgentResultRecord[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/coding-agents/results?page=${page}&limit=${limit}`),

  /** Get a specific result */
  getResult: (id: string) => apiClient.get<CodingAgentResultRecord>(`/coding-agents/results/${id}`),

  // --- Permissions ---

  /** List all permission profiles */
  listPermissions: () =>
    apiClient.get<CodingAgentPermissionProfile[]>('/coding-agents/permissions'),

  /** Get permission profile for a provider */
  getPermissions: (providerRef: string) =>
    apiClient.get<CodingAgentPermissionProfile>(`/coding-agents/permissions/${providerRef}`),

  /** Upsert permission profile */
  updatePermissions: (providerRef: string, data: Record<string, unknown>) =>
    apiClient.put<CodingAgentPermissionProfile>(`/coding-agents/permissions/${providerRef}`, data),

  /** Delete permission profile */
  deletePermissions: (providerRef: string) =>
    apiClient.delete<{ deleted: boolean }>(`/coding-agents/permissions/${providerRef}`),

  // --- Skill Attachments ---

  /** List skill attachments for a provider */
  listSkillAttachments: (providerRef: string) =>
    apiClient.get<SkillAttachment[]>(`/coding-agents/skills/${providerRef}`),

  /** Attach a skill to a provider */
  attachSkill: (providerRef: string, data: Record<string, unknown>) =>
    apiClient.post<SkillAttachment>(`/coding-agents/skills/${providerRef}`, data),

  /** Update a skill attachment */
  updateSkillAttachment: (providerRef: string, id: string, data: Record<string, unknown>) =>
    apiClient.put<SkillAttachment>(`/coding-agents/skills/${providerRef}/${id}`, data),

  /** Detach a skill */
  detachSkill: (providerRef: string, id: string) =>
    apiClient.delete<{ deleted: boolean }>(`/coding-agents/skills/${providerRef}/${id}`),

  // --- ACP (Agent Client Protocol) ---

  /** Get ACP-specific data for a session (tool calls, plan) */
  getAcpData: (sessionId: string) =>
    apiClient.get<AcpData>(`/coding-agents/sessions/${sessionId}/acp`),

  /** Send a follow-up prompt to an ACP session */
  promptAcpSession: (sessionId: string, prompt: string) =>
    apiClient.post<AcpPromptResult>(`/coding-agents/sessions/${sessionId}/acp/prompt`, { prompt }),

  /** Cancel an ongoing ACP prompt turn */
  cancelAcpSession: (sessionId: string) =>
    apiClient.post<{ cancelled: boolean }>(`/coding-agents/sessions/${sessionId}/acp/cancel`),

  // --- Subscriptions ---

  /** List all subscriptions */
  listSubscriptions: () => apiClient.get<CodingAgentSubscription[]>('/coding-agents/subscriptions'),

  /** Get subscription for a provider */
  getSubscription: (providerRef: string) =>
    apiClient.get<CodingAgentSubscription>(`/coding-agents/subscriptions/${providerRef}`),

  /** Upsert subscription */
  updateSubscription: (providerRef: string, data: Record<string, unknown>) =>
    apiClient.put<CodingAgentSubscription>(`/coding-agents/subscriptions/${providerRef}`, data),

  /** Delete subscription */
  deleteSubscription: (providerRef: string) =>
    apiClient.delete<{ deleted: boolean }>(`/coding-agents/subscriptions/${providerRef}`),
};

// =============================================================================
// Permission / Skill / Subscription types
// =============================================================================

export interface CodingAgentPermissionProfile {
  id: string;
  userId: string;
  providerRef: string;
  ioFormat: string;
  fsAccess: string;
  allowedDirs: string[];
  networkAccess: boolean;
  shellAccess: boolean;
  gitAccess: boolean;
  autonomy: string;
  maxFileChanges: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillAttachment {
  id: string;
  userId: string;
  providerRef: string;
  type: 'extension' | 'inline';
  extensionId?: string;
  label?: string;
  instructions?: string;
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodingAgentSubscription {
  id: string;
  userId: string;
  providerRef: string;
  tier?: string;
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  maxConcurrentSessions: number;
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Orchestration types
// =============================================================================

export interface OrchestrationAnalysis {
  summary: string;
  goalComplete: boolean;
  hasErrors: boolean;
  errors?: string[];
  nextPrompt: string | null;
  confidence: number;
  needsUserInput: boolean;
  userQuestion?: string;
}

export interface OrchestrationStep {
  index: number;
  prompt: string;
  sessionId?: string;
  resultId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  outputSummary?: string;
  exitCode?: number;
  durationMs?: number;
  analysis?: OrchestrationAnalysis;
  startedAt?: string;
  completedAt?: string;
}

export interface OrchestrationRun {
  id: string;
  userId: string;
  goal: string;
  provider: string;
  cwd: string;
  model?: string;
  status: string;
  steps: OrchestrationStep[];
  currentStep: number;
  maxSteps: number;
  autoMode: boolean;
  enableAnalysis: boolean;
  skillIds?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

// =============================================================================
// Orchestration API
// =============================================================================

export const orchestrationApi = {
  /** Start a new orchestration run */
  start: (input: {
    goal: string;
    provider: string;
    cwd: string;
    model?: string;
    maxSteps?: number;
    autoMode?: boolean;
    enableAnalysis?: boolean;
    skillIds?: string[];
  }) => apiClient.post<{ run: OrchestrationRun }>('/coding-agents/orchestrate', input),

  /** List orchestration runs */
  list: (limit = 20, offset = 0) =>
    apiClient.get<{ runs: OrchestrationRun[] }>(
      `/coding-agents/orchestrate?limit=${limit}&offset=${offset}`
    ),

  /** Get a specific run */
  get: (id: string) => apiClient.get<{ run: OrchestrationRun }>(`/coding-agents/orchestrate/${id}`),

  /** Continue a paused run with user input */
  continue: (id: string, prompt: string) =>
    apiClient.post<{ run: OrchestrationRun }>(`/coding-agents/orchestrate/${id}/continue`, {
      prompt,
    }),

  /** Cancel a run */
  cancel: (id: string) =>
    apiClient.post<{ cancelled: boolean }>(`/coding-agents/orchestrate/${id}/cancel`),

  /** Delete a run */
  delete: (id: string) =>
    apiClient.delete<{ deleted: boolean }>(`/coding-agents/orchestrate/${id}`),

  stats: () =>
    apiClient.get<{
      total: number;
      active: number;
      successRate: number;
      avgDuration: number;
      totalCost: number;
      errorRate: number;
      byState: Record<string, number>;
      tasksSucceeded: number;
      tasksFailed: number;
    }>('/orchestra/stats'),

  health: () =>
    apiClient.get<{
      status: string;
      score: number;
      signals: string[];
      recommendations: string[];
    }>('/orchestra/health'),
};
