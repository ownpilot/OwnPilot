/**
 * Agentic API endpoints — unified task execution across all agent types
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partially_completed'
  | 'cancelled'
  | 'escalated';

export type ExecutorKind =
  | 'claw'
  | 'soul_heartbeat'
  | 'crew'
  | 'coding_agent'
  | 'workflow'
  | 'trigger'
  | 'channel'
  | 'direct_llm'
  | 'sandbox_code'
  | 'tool_catalog';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'timed_out';
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface AgenticStepResult {
  index: number;
  executorKind: ExecutorKind;
  capabilityId: string;
  status: StepStatus;
  durationMs: number;
  costUsd?: number;
  error?: string;
  output?: unknown;
}

export interface AgenticExecution {
  id: string;
  taskName: string;
  status: ExecutionStatus;
  summary: string;
  provider?: string | null;
  model?: string | null;
  totalCostUsd: number;
  totalDurationMs: number;
  stepCount: number;
  completedSteps: number;
  error?: string;
  steps?: AgenticStepResult[];
  startedAt: string;
  completedAt: string | null;
}

export interface AgenticStats {
  totalExecutions: number;
  activeExecutions: number;
  totalCostUsd: number;
  successRate: number;
  byExecutorKind: Record<string, number>;
}

export interface CapabilityInfo {
  id: string;
  name: string;
  description: string;
  executorKind: ExecutorKind;
  providerId: string;
  costTier?: string;
  latencyTier?: string;
  tags: string[];
  requiresApproval: boolean;
}

export interface AgenticPlanAnalysis {
  suggestedKinds: ExecutorKind[];
  requiresOrchestration: boolean;
  likelyNeedsCodeExecution: boolean;
  likelyNeedsExternalData: boolean;
  confidence: number;
  reasoning: string;
}

export interface AgenticPlanStep {
  index: number;
  executorKind: ExecutorKind;
  capabilityId: string;
  providerId: string;
  dependsOn: number[];
  timeoutMs: number;
  retryOnFailure: boolean;
}

export interface AgenticPlan {
  analysis: AgenticPlanAnalysis;
  steps: AgenticPlanStep[];
  estimatedCostUsd: number;
  estimatedDurationMs: number;
  requiresApproval: boolean;
  fallbackStrategy: string;
}

export interface ExecuteTaskInput {
  name: string;
  description: string;
  prompt?: string;
  provider?: string;
  model?: string;
  expectedOutput?: string;
  priority?: TaskPriority;
  trigger?: {
    type: 'immediate' | 'scheduled' | 'interval' | 'continuous' | 'event' | 'condition' | 'webhook';
    cron?: string;
    intervalMs?: number;
    eventType?: string;
    condition?: string;
    timezone?: string;
  };
  constraints?: {
    maxCostUsd?: number;
    timeoutMs?: number;
    maxTurns?: number;
    maxToolCalls?: number;
    allowCodeExecution?: boolean;
    allowNetwork?: boolean;
  };
  outputRouting?: {
    memory?: boolean;
    artifact?: { name?: string; tags?: string[] };
  };
}

export interface PlanTaskInput {
  name: string;
  description: string;
  expectedOutput?: string;
  priority?: TaskPriority;
  trigger?: {
    type: 'immediate' | 'scheduled' | 'interval' | 'continuous';
    cron?: string;
    intervalMs?: number;
  };
}

// =============================================================================
// API
// =============================================================================

export const agenticApi = {
  /** Execute a task */
  execute: (input: ExecuteTaskInput) =>
    apiClient.post<AgenticExecution>('/agentic/execute', input),

  /** Plan a task without executing */
  plan: (input: PlanTaskInput) =>
    apiClient.post<AgenticPlan>('/agentic/plan', input),

  /** List recent executions */
  list: (limit = 20, offset = 0) =>
    apiClient.get<{ executions: AgenticExecution[]; total: number; limit: number; offset: number }>(
      `/agentic/executions?limit=${limit}&offset=${offset}`
    ),

  /** Get a single execution report */
  get: (id: string) =>
    apiClient.get<AgenticExecution>(`/agentic/executions/${id}`),

  /** Cancel a running execution */
  cancel: (id: string) =>
    apiClient.post<{ id: string; status: string }>(`/agentic/executions/${id}/cancel`),

  /** Get execution stats */
  stats: () =>
    apiClient.get<AgenticStats>('/agentic/stats'),

  /** List capabilities */
  capabilities: (params?: { kind?: string; search?: string; provider?: string }) => {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.search) qs.set('search', params.search);
    if (params?.provider) qs.set('provider', params.provider);
    const query = qs.toString();
    return apiClient.get<{ capabilities: CapabilityInfo[]; total: number }>(
      `/agentic/capabilities${query ? `?${query}` : ''}`
    );
  },
};
