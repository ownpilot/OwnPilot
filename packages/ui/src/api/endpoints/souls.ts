/**
 * Agent Souls & Crews API Endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types — aligned with @ownpilot/core types.ts
// =============================================================================

export interface AgentSoul {
  id: string;
  agentId: string;
  identity: {
    name: string;
    emoji: string;
    role: string;
    personality: string;
    voice: {
      tone: string;
      language: string;
      quirks?: string[];
    };
    boundaries: string[];
    backstory?: string;
  };
  purpose: {
    mission: string;
    goals: string[];
    expertise: string[];
    toolPreferences: string[];
    knowledgeDomains?: string[];
  };
  autonomy: {
    level: number; // 0-5 (5 = claw mode)
    allowedActions: string[];
    blockedActions: string[];
    requiresApproval: string[];
    maxCostPerCycle: number;
    maxCostPerDay: number;
    maxCostPerMonth: number;
    pauseOnConsecutiveErrors: number;
    pauseOnBudgetExceeded: boolean;
    notifyUserOnPause: boolean;
    clawMode?: {
      enabled: boolean;
      canManageAgents: boolean;
      canCreateTools: boolean;
      selfImprovement: 'disabled' | 'suggest' | 'auto';
    };
  };
  heartbeat: {
    enabled: boolean;
    interval: string; // cron expression
    checklist: HeartbeatTask[];
    quietHours?: {
      start: string;
      end: string;
      timezone: string;
    };
    selfHealingEnabled: boolean;
    maxDurationMs: number;
  };
  relationships: {
    reportsTo?: string;
    delegates: string[];
    peers: string[];
    channels: string[];
    crewId?: string;
  };
  evolution: {
    version: number;
    evolutionMode: string;
    coreTraits: string[];
    mutableTraits: string[];
    learnings: string[];
    feedbackLog: Array<{
      id: string;
      timestamp: string;
      type: string;
      content: string;
      appliedToVersion: number;
      source: string;
    }>;
  };
  bootSequence: {
    onStart: string[];
    onHeartbeat: string[];
    onMessage: string[];
    contextFiles?: string[];
    warmupPrompt?: string;
  };
  /** AI Provider configuration with fallback support */
  provider?: {
    providerId: string;
    modelId: string;
    fallbackProviderId?: string;
    fallbackModelId?: string;
  };
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  /** Skills this agent has access to */
  skillAccess?: {
    allowed: string[]; // skill/extension IDs
    blocked: string[];
  };
}

export interface HeartbeatTask {
  id: string;
  name: string;
  description: string;
  schedule: string;
  tools: string[];
  prompt?: string;
  outputTo?: { type: string; [key: string]: unknown };
  priority: string;
  stalenessHours: number;
  lastRunAt?: string;
  lastResult?: string;
  lastError?: string;
  consecutiveFailures?: number;
}

export interface SoulVersion {
  id: string;
  soulId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changeReason?: string;
  changedBy?: string;
  createdAt: string;
}

export interface AgentCrew {
  id: string;
  name: string;
  description?: string;
  templateId?: string;
  coordinationPattern: string;
  status: 'active' | 'paused' | 'disbanded';
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched by GET /:id
  agents?: CrewAgentInfo[];
}

export interface CrewAgentInfo {
  agentId: string;
  role: string;
  name: string;
  emoji: string;
  heartbeatEnabled: boolean;
  lastHeartbeat: string | null;
  soulVersion: number;
}

export interface CrewMember {
  crewId: string;
  agentId: string;
  role: string;
  joinedAt: string;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  subject: string;
  content: string;
  attachments: unknown[];
  priority: string;
  threadId?: string;
  requiresResponse: boolean;
  deadline?: string;
  status: string;
  crewId?: string;
  createdAt: string;
  readAt?: string;
}

export interface HeartbeatLog {
  id: string;
  agentId: string;
  soulVersion: number;
  tasksRun: Array<{ id: string; name: string }>;
  tasksSkipped: Array<{ id: string; reason?: string }>;
  tasksFailed: Array<{ id: string; error?: string }>;
  durationMs: number;
  tokenUsage: { input: number; output: number };
  cost: number;
  createdAt: string;
}

export interface HeartbeatStats {
  totalCycles: number;
  totalCost: number;
  avgDurationMs: number;
  failureRate: number;
}

export interface CrewTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  coordinationPattern: string;
  agents: Array<{
    identity: {
      name: string;
      emoji: string;
      role: string;
      personality: string;
    };
    purpose: {
      mission: string;
    };
  }>;
  tags: string[];
}

// =============================================================================
// Souls API
// =============================================================================

export interface DeploySoulInput {
  identity: {
    name: string;
    emoji?: string;
    role?: string;
    personality?: string;
    voice?: { tone?: string; language?: string; quirks?: string[] };
    boundaries?: string[];
  };
  purpose?: {
    mission?: string;
    goals?: string[];
    expertise?: string[];
    toolPreferences?: string[];
  };
  autonomy?: {
    level?: number;
    allowedActions?: string[];
    blockedActions?: string[];
    requiresApproval?: string[];
    maxCostPerCycle?: number;
    maxCostPerDay?: number;
    maxCostPerMonth?: number;
  };
  heartbeat?: {
    enabled?: boolean;
    interval?: string;
    checklist?: HeartbeatTask[];
    quietHours?: { start: string; end: string; timezone: string };
    selfHealingEnabled?: boolean;
    maxDurationMs?: number;
  };
  relationships?: {
    delegates?: string[];
    peers?: string[];
    channels?: string[];
  };
  evolution?: {
    evolutionMode?: 'manual' | 'supervised' | 'autonomous';
    coreTraits?: string[];
    mutableTraits?: string[];
  };
  bootSequence?: {
    onStart?: string[];
    onHeartbeat?: string[];
    onMessage?: string[];
  };
  provider?: string;
  model?: string;
  /** Skills this agent should have access to */
  skillAccess?: {
    allowed: string[];
    blocked?: string[];
  };
}

export interface DeploySoulResponse {
  agentId: string;
  soul: AgentSoul;
  provider: string;
  model: string;
  triggerCreated: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  category: string;
  status: 'allowed' | 'blocked' | 'neutral';
  provider?: string;
}

export interface ToolsResponse {
  tools: ToolInfo[];
  allowed: string[];
  blocked: string[];
  summary: {
    total: number;
    allowed: number;
    blocked: number;
    neutral: number;
  };
}

export interface CommandResponse {
  command: {
    id: string;
    timestamp: string;
    command: string;
    params: Record<string, unknown>;
    status: string;
  };
  result: unknown;
  agentId: string;
}

export interface AgentStatsResponse {
  agentId: string;
  soulVersion: number;
  heartbeat: {
    enabled: boolean;
    interval: string;
    lastRunAt: string | null;
  };
  stats: {
    totalCycles: number;
    totalCost: number;
    avgDurationMs: number;
    failureRate: number;
  };
  budget: {
    maxCostPerDay: number;
    maxCostPerMonth: number;
  };
}

export const soulsApi = {
  list: async () => {
    const data = await apiClient.get<{ items: AgentSoul[]; total: number }>('/souls');
    return data;
  },
  get: (agentId: string) => apiClient.get<AgentSoul>(`/souls/${agentId}`),
  create: (soul: Partial<AgentSoul> | Record<string, unknown>) =>
    apiClient.post<AgentSoul>('/souls', soul as Record<string, unknown>),
  /** Deploy a complete soul agent (creates agent + soul + trigger in one call) */
  deploy: (input: DeploySoulInput) => apiClient.post<DeploySoulResponse>('/souls/deploy', input),
  update: (agentId: string, data: Partial<AgentSoul> | Record<string, unknown>) =>
    apiClient.put<AgentSoul>(`/souls/${agentId}`, data as Record<string, unknown>),
  delete: (agentId: string) => apiClient.delete<void>(`/souls/${agentId}`),
  getVersions: (agentId: string) => apiClient.get<SoulVersion[]>(`/souls/${agentId}/versions`),
  getVersion: (agentId: string, version: number) =>
    apiClient.get<SoulVersion>(`/souls/${agentId}/versions/${version}`),
  feedback: (agentId: string, feedback: { type: string; content: string }) =>
    apiClient.post<AgentSoul>(`/souls/${agentId}/feedback`, feedback),
  /** Get all available tools with their permission status for this agent */
  getTools: (agentId: string) => apiClient.get<ToolsResponse>(`/souls/${agentId}/tools`),
  /** Update tool permissions (allowed/blocked lists) */
  updateTools: (agentId: string, tools: { allowed?: string[]; blocked?: string[] }) =>
    apiClient.put<ToolsResponse>(`/souls/${agentId}/tools`, tools),
  /** Send a command to the agent (run_heartbeat, pause, resume, reset_budget) */
  sendCommand: (agentId: string, command: string, params?: Record<string, unknown>) =>
    apiClient.post<CommandResponse>(`/souls/${agentId}/command`, { command, params }),
  /** Get agent statistics (cycles, cost, budget usage) */
  getStats: (agentId: string) => apiClient.get<AgentStatsResponse>(`/souls/${agentId}/stats`),
  /** Run immediate test (trigger heartbeat without waiting for schedule) */
  runTest: (agentId: string) =>
    apiClient.post<{ success: boolean; message: string; agentId: string; startedAt: string }>(
      `/souls/${agentId}/test`
    ),
  /** Get agent execution logs (heartbeats) */
  getLogs: (agentId: string, limit = 20, offset = 0) =>
    apiClient.get<{
      agentId: string;
      logs: Array<{
        id: string;
        timestamp: string;
        durationMs: number;
        cost: number;
        tasksRun: number;
        tasksFailed: number;
      }>;
      stats: {
        totalCycles: number;
        successRate: number;
        avgCost: number;
        avgDurationMs: number;
      };
    }>(`/souls/${agentId}/logs?limit=${limit}&offset=${offset}`),
};

// =============================================================================
// Crews API
// =============================================================================

export interface CrewMemoryEntry {
  id: string;
  crewId: string;
  agentId: string;
  category: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTask {
  id: string;
  crewId: string;
  createdBy: string;
  claimedBy: string | null;
  taskName: string;
  description: string;
  context: string | null;
  expectedOutput: string | null;
  priority: string;
  status: string;
  result: string | null;
  deadline: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

export const crewsApi = {
  list: async () => {
    const data = await apiClient.get<{ items: AgentCrew[]; total: number }>('/crews');
    return data;
  },
  get: (id: string) => apiClient.get<AgentCrew>(`/crews/${id}`),
  deploy: (templateId: string, customizations?: Record<string, unknown>) =>
    apiClient.post<AgentCrew>('/crews/deploy', { templateId, ...customizations }),
  pause: (id: string) => apiClient.post<AgentCrew>(`/crews/${id}/pause`),
  resume: (id: string) => apiClient.post<AgentCrew>(`/crews/${id}/resume`),
  disband: (id: string) => apiClient.delete<void>(`/crews/${id}`),
  getTemplates: () => apiClient.get<CrewTemplate[]>('/crews/templates'),
  getTemplate: (id: string) => apiClient.get<CrewTemplate>(`/crews/templates/${id}`),

  // Crew shared memory
  getMemory: (id: string, category?: string, query?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (query) params.set('query', query);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return apiClient.get<{ entries: CrewMemoryEntry[]; total: number }>(
      `/crews/${id}/memory?${params}`
    );
  },
  deleteMemory: (crewId: string, memoryId: string) =>
    apiClient.delete<void>(`/crews/${crewId}/memory/${memoryId}`),

  // Crew task queue
  getTasks: (id: string, status?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return apiClient.get<{ tasks: CrewTask[]; total: number }>(`/crews/${id}/tasks?${params}`);
  },
};

// =============================================================================
// Agent Messages API
// =============================================================================

export const agentMessagesApi = {
  list: async (limit = 50, offset = 0) => {
    const data = await apiClient.get<{ items: AgentMessage[]; total: number }>(
      `/agent-messages?limit=${limit}&offset=${offset}`
    );
    return data;
  },
  listByAgent: (agentId: string, limit = 50, offset = 0) =>
    apiClient.get<AgentMessage[]>(
      `/agent-messages/agent/${agentId}?limit=${limit}&offset=${offset}`
    ),
  getThread: (threadId: string) =>
    apiClient.get<AgentMessage[]>(`/agent-messages/thread/${threadId}`),
  getByCrew: (crewId: string, limit = 50, offset = 0) =>
    apiClient.get<AgentMessage[]>(`/agent-messages/crew/${crewId}?limit=${limit}&offset=${offset}`),
  send: (message: {
    to: string;
    content: string;
    from?: string;
    type?: string;
    subject?: string;
    crewId?: string;
  }) => apiClient.post<AgentMessage>('/agent-messages', message),
};

// =============================================================================
// Heartbeat Logs API
// =============================================================================

export const heartbeatLogsApi = {
  list: async (limit = 50, offset = 0) => {
    const data = await apiClient.get<{ items: HeartbeatLog[]; total: number }>(
      `/heartbeat-logs?limit=${limit}&offset=${offset}`
    );
    return data;
  },
  listByAgent: (agentId: string, limit = 50, offset = 0) =>
    apiClient.get<HeartbeatLog[]>(
      `/heartbeat-logs/agent/${agentId}?limit=${limit}&offset=${offset}`
    ),
  getStats: (agentId?: string) =>
    apiClient.get<HeartbeatStats>(`/heartbeat-logs/stats${agentId ? `?agentId=${agentId}` : ''}`),
};
