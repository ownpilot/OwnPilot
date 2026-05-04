/**
 * Claws API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type ClawMode = 'continuous' | 'interval' | 'event' | 'single-shot';

export type ClawState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'escalation_pending';

export type ClawSandboxMode = 'docker' | 'local' | 'auto';

export interface ClawLimits {
  maxTurnsPerCycle: number;
  maxToolCallsPerCycle: number;
  maxCyclesPerHour: number;
  cycleTimeoutMs: number;
  totalBudgetUsd?: number;
}

export interface ClawMissionContract {
  successCriteria: string[];
  deliverables: string[];
  constraints: string[];
  escalationRules: string[];
  evidenceRequired: boolean;
  minConfidence: number;
}

export interface ClawAutonomyPolicy {
  allowSelfModify: boolean;
  allowSubclaws: boolean;
  requireEvidence: boolean;
  destructiveActionPolicy: 'ask' | 'block' | 'allow';
  filesystemScopes: string[];
  maxCostUsdBeforePause?: number;
}

export interface ClawHealthStatus {
  score: number;
  status: 'healthy' | 'watch' | 'stuck' | 'expensive' | 'failed' | 'idle';
  signals: string[];
  recommendations: string[];
  contractScore: number;
  policyWarnings: string[];
}

export interface ClawEscalation {
  id: string;
  type: string;
  reason: string;
  details?: Record<string, unknown>;
  requestedAt: string;
}

export interface ClawSession {
  state: ClawState;
  cyclesCompleted: number;
  totalToolCalls: number;
  totalCostUsd: number;
  lastCycleAt: string | null;
  lastCycleDurationMs: number | null;
  lastCycleError: string | null;
  startedAt: string;
  stoppedAt: string | null;
  artifacts: string[];
  pendingEscalation: ClawEscalation | null;
}

export interface ClawConfig {
  id: string;
  userId: string;
  name: string;
  mission: string;
  mode: ClawMode;
  allowedTools: string[];
  limits: ClawLimits;
  intervalMs?: number;
  eventFilters?: string[];
  autoStart: boolean;
  stopCondition?: string;
  provider?: string;
  model?: string;
  workspaceId?: string;
  soulId?: string;
  parentClawId?: string;
  depth: number;
  sandbox: ClawSandboxMode;
  codingAgentProvider?: string;
  skills?: string[];
  preset?: string;
  missionContract?: ClawMissionContract;
  autonomyPolicy?: ClawAutonomyPolicy;
  health?: ClawHealthStatus;
  createdBy: 'user' | 'ai' | 'claw';
  createdAt: string;
  updatedAt: string;
  session: ClawSession | null;
}

export interface ClawToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  success: boolean;
  durationMs: number;
}

export interface ClawHistoryEntry {
  id: string;
  clawId: string;
  cycleNumber: number;
  entryType: 'cycle' | 'escalation';
  success: boolean;
  toolCalls: ClawToolCall[];
  outputMessage: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  error?: string;
  executedAt: string;
}

export interface CreateClawInput {
  name: string;
  mission: string;
  mode?: ClawMode;
  allowed_tools?: string[];
  limits?: Partial<ClawLimits>;
  interval_ms?: number;
  event_filters?: string[];
  auto_start?: boolean;
  stop_condition?: string;
  provider?: string;
  model?: string;
  soul_id?: string;
  sandbox?: ClawSandboxMode;
  coding_agent_provider?: string;
  skills?: string[];
  preset?: string;
  mission_contract?: Partial<ClawMissionContract>;
  autonomy_policy?: Partial<ClawAutonomyPolicy>;
}

export interface UpdateClawInput extends Omit<
  Partial<CreateClawInput>,
  | 'provider'
  | 'model'
  | 'soul_id'
  | 'stop_condition'
  | 'coding_agent_provider'
  | 'preset'
  | 'mission_contract'
  | 'autonomy_policy'
> {
  provider?: string | null;
  model?: string | null;
  soul_id?: string | null;
  stop_condition?: string | null;
  coding_agent_provider?: string | null;
  preset?: string | null;
  mission_contract?: Partial<ClawMissionContract> | null;
  autonomy_policy?: Partial<ClawAutonomyPolicy> | null;
}

export interface ClawPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  mission: string;
  mode: ClawMode;
  sandbox: ClawSandboxMode;
  codingAgentProvider?: string;
  successCriteria: string[];
  deliverables: string[];
  constraints?: string[];
}

export interface ClawRecommendation {
  clawId: string;
  name: string;
  status: ClawHealthStatus['status'];
  score: number;
  signals: string[];
  recommendations: string[];
}

export interface ClawDoctorResponse {
  health: ClawHealthStatus;
  patch: UpdateClawInput;
  applied: string[];
  skipped: string[];
}

export interface ClawApplyRecommendationsResponse {
  applied: string[];
  skipped: string[];
  claw: ClawConfig;
  health: ClawHealthStatus;
}

export interface ClawApplyRecommendationsBatchResponse {
  results: Array<{
    clawId: string;
    name: string;
    applied: string[];
    skipped: string[];
  }>;
  updated: number;
}

// =============================================================================
// API
// =============================================================================

export const clawsApi = {
  list: () => apiClient.get<ClawConfig[]>('/claws'),

  presets: () => apiClient.get<{ presets: ClawPreset[] }>('/claws/presets'),

  recommendations: () =>
    apiClient.get<{ recommendations: ClawRecommendation[] }>('/claws/recommendations'),

  get: (id: string) => apiClient.get<ClawConfig>(`/claws/${id}`),

  doctor: (id: string) => apiClient.get<ClawDoctorResponse>(`/claws/${id}/doctor`),

  create: (input: CreateClawInput) => apiClient.post<ClawConfig>('/claws', input),

  update: (id: string, input: UpdateClawInput) => apiClient.put<ClawConfig>(`/claws/${id}`, input),

  applyRecommendations: (id: string) =>
    apiClient.post<ClawApplyRecommendationsResponse>(`/claws/${id}/apply-recommendations`),

  applyRecommendationBatch: (ids?: string[]) =>
    apiClient.post<ClawApplyRecommendationsBatchResponse>(
      '/claws/recommendations/apply',
      ids ? { ids } : {}
    ),

  delete: (id: string) => apiClient.delete(`/claws/${id}`),

  start: (id: string) => apiClient.post<{ state: string }>(`/claws/${id}/start`),

  pause: (id: string) => apiClient.post<{ paused: boolean }>(`/claws/${id}/pause`),

  resume: (id: string) => apiClient.post<{ resumed: boolean }>(`/claws/${id}/resume`),

  stop: (id: string) => apiClient.post<{ stopped: boolean }>(`/claws/${id}/stop`),

  execute: (id: string) => apiClient.post<Record<string, unknown>>(`/claws/${id}/execute`),

  sendMessage: (id: string, message: string) =>
    apiClient.post<{ sent: boolean }>(`/claws/${id}/message`, { message }),

  getHistory: (id: string, limit = 20, offset = 0) =>
    apiClient.get<{ entries: ClawHistoryEntry[]; total: number }>(
      `/claws/${id}/history?limit=${limit}&offset=${offset}`
    ),

  getAuditLog: (id: string, limit = 50, offset = 0, category?: string) =>
    apiClient.get<{
      entries: Array<{
        id: string;
        clawId: string;
        cycleNumber: number;
        toolName: string;
        toolArgs: Record<string, unknown>;
        toolResult: string;
        success: boolean;
        durationMs: number;
        category: string;
        executedAt: string;
      }>;
      total: number;
    }>(
      `/claws/${id}/audit?limit=${limit}&offset=${offset}${category ? `&category=${encodeURIComponent(category)}` : ''}`
    ),

  stats: () =>
    apiClient.get<{
      total: number;
      running: number;
      totalCost: number;
      totalCycles: number;
      totalToolCalls: number;
      byMode: Record<string, number>;
      byState: Record<string, number>;
      byHealth: Record<string, number>;
      needsAttention: number;
    }>('/claws/stats'),

  approveEscalation: (id: string) =>
    apiClient.post<{ approved: boolean }>(`/claws/${id}/approve-escalation`),

  denyEscalation: (id: string, reason?: string) =>
    apiClient.post<{ denied: boolean }>(`/claws/${id}/deny-escalation`, reason ? { reason } : {}),
};
