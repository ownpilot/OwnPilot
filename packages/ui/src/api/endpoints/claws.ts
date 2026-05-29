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

export type ClawTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface ClawTask {
  id: string;
  title: string;
  status: ClawTaskStatus;
  notes?: string;
  successCriteria?: string;
  evidence?: string;
  cyclesInProgress?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClawCycleFailure {
  cycleNumber: number;
  at: string;
  error: string | null;
  toolErrors?: Array<{ tool: string; error: string }>;
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
  tasks: ClawTask[];
  consecutiveErrors: number;
  recentFailures: ClawCycleFailure[];
  /**
   * Cross-cycle handoff message set by the agent via claw_set_next_intent.
   * Surfaced once at the top of the next cycle prompt and then auto-cleared
   * — so when the UI sees it set, the next cycle hasn't started yet.
   */
  nextIntent?: string;
  /** Bounded ring of plan mutations. Newest entries are last. */
  planHistory: ClawPlanHistoryEntry[];
}

export interface ClawPlanHistoryEntry {
  at: string;
  actor: 'agent' | 'operator';
  kind: 'replace' | 'task_update' | 'task_added';
  taskId?: string;
  prevStatus?: ClawTaskStatus;
  newStatus?: ClawTaskStatus;
  title?: string;
  newTaskCount?: number;
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
  priority?: number;
  /** Closed learning loop: distill successful runs into reusable skills (default on). */
  learnSkills?: boolean;
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

export interface ShareGPTTurn {
  from: 'system' | 'human' | 'gpt' | 'tool';
  value: string;
}

export interface ShareGPTTrajectory {
  id: string;
  mission: string;
  conversations: ShareGPTTurn[];
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
  priority?: number;
  learn_skills?: boolean;
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
  | 'priority'
> {
  provider?: string | null;
  model?: string | null;
  soul_id?: string | null;
  stop_condition?: string | null;
  coding_agent_provider?: string | null;
  preset?: string | null;
  mission_contract?: Partial<ClawMissionContract> | null;
  autonomy_policy?: Partial<ClawAutonomyPolicy> | null;
  priority?: number | null;
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
  list: (limit = 50, offset = 0) =>
    apiClient.get<{ claws: ClawConfig[]; total: number; limit: number; offset: number }>(
      `/claws?limit=${limit}&offset=${offset}`
    ),

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

  /**
   * Replace the structured task plan. Validation mirrors the agent's
   * `claw_plan` tool, including the single-focus invariant — sending more
   * than one in_progress task returns a 400.
   */
  replacePlan: (
    id: string,
    tasks: Array<{
      id: string;
      title: string;
      status?: ClawTaskStatus;
      notes?: string;
      successCriteria?: string;
    }>
  ) => apiClient.put<{ tasks: ClawTask[] }>(`/claws/${id}/plan`, { tasks }),

  /**
   * Update a single task — same semantics as the agent's `claw_update_task`.
   * Returns the updated task plus any soft warnings (e.g. completing
   * without evidence).
   */
  updateTask: (
    id: string,
    taskId: string,
    patch: { status?: ClawTaskStatus; notes?: string; evidence?: string }
  ) =>
    apiClient.patch<{ task: ClawTask; message: string; warnings?: string[] }>(
      `/claws/${id}/tasks/${taskId}`,
      patch
    ),

  /**
   * Atomically split a task into subtasks. Same semantics as the agent's
   * `claw_split_task` tool: marks parent blocked + inserts subtasks
   * t&lt;parentId&gt;.&lt;N&gt; immediately after.
   */
  splitTask: (
    id: string,
    taskId: string,
    subtasks: Array<{ title: string; successCriteria?: string }>
  ) =>
    apiClient.post<{ parent: ClawTask; subtasks: ClawTask[] }>(
      `/claws/${id}/tasks/${taskId}/split`,
      { subtasks }
    ),

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

  /**
   * Export run history as a ShareGPT-format trajectory (for eval / fine-tuning).
   */
  exportTrajectory: (id: string, limit = 100, offset = 0) =>
    apiClient.get<{ format: string; trajectory: ShareGPTTrajectory }>(
      `/claws/${id}/trajectory?limit=${limit}&offset=${offset}`
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
      llmConcurrency: {
        max: number;
        active: number;
        queued: number;
        slots: Array<{
          slotIdx: number;
          agentId: string;
          label: string;
          state: 'active' | 'queued' | 'free';
        }>;
      };
    }>('/claws/stats'),

  /**
   * Operator-side recovery: clear consecutiveErrors + recentFailures without
   * restarting the claw. After this the reflection-required banner clears and
   * the next cycle is treated as a clean attempt. 409 if the claw is not
   * running, 404 if not found.
   */
  resetFailures: (id: string) => apiClient.post<{ reset: boolean }>(`/claws/${id}/reset-failures`),

  /**
   * Operator-side soft handoff — queue a directive that will be rendered at
   * the top of the next cycle prompt (with `[OPERATOR]` framing) and then
   * auto-clear. Unlike `sendMessage` (lands in inbox) and steer (interrupts
   * the in-flight cycle), this waits for the current cycle to finish and
   * then nudges the next one. 400 on empty / oversized intent, 409 if not
   * running, 404 if not found.
   */
  setNextIntent: (id: string, intent: string) =>
    apiClient.post<{ queued: boolean }>(`/claws/${id}/next-intent`, { intent }),

  approveEscalation: (id: string) =>
    apiClient.post<{ approved: boolean }>(`/claws/${id}/approve-escalation`),

  denyEscalation: (id: string, reason?: string) =>
    apiClient.post<{ denied: boolean }>(`/claws/${id}/deny-escalation`, reason ? { reason } : {}),
};
