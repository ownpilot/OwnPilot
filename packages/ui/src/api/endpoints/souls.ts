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
    level: number; // 0-4
    allowedActions: string[];
    blockedActions: string[];
    requiresApproval: string[];
    maxCostPerCycle: number;
    maxCostPerDay: number;
    maxCostPerMonth: number;
    pauseOnConsecutiveErrors: number;
    pauseOnBudgetExceeded: boolean;
    notifyUserOnPause: boolean;
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
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
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

export const soulsApi = {
  list: async () => {
    const data = await apiClient.get<{ items: AgentSoul[]; total: number }>('/souls');
    return data;
  },
  get: (agentId: string) => apiClient.get<AgentSoul>(`/souls/${agentId}`),
  create: (soul: Record<string, unknown>) => apiClient.post<AgentSoul>('/souls', soul),
  update: (agentId: string, data: Record<string, unknown>) =>
    apiClient.put<AgentSoul>(`/souls/${agentId}`, data),
  delete: (agentId: string) => apiClient.delete<void>(`/souls/${agentId}`),
  getVersions: (agentId: string) => apiClient.get<SoulVersion[]>(`/souls/${agentId}/versions`),
  getVersion: (agentId: string, version: number) =>
    apiClient.get<SoulVersion>(`/souls/${agentId}/versions/${version}`),
  feedback: (agentId: string, feedback: { type: string; content: string }) =>
    apiClient.post<AgentSoul>(`/souls/${agentId}/feedback`, feedback),
};

// =============================================================================
// Crews API
// =============================================================================

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
