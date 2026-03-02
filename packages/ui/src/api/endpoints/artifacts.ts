/**
 * Artifacts API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type ArtifactType = 'html' | 'svg' | 'markdown' | 'form' | 'chart' | 'react';
export type DashboardSize = 'small' | 'medium' | 'large' | 'full';

export interface DataBindingSource {
  type: 'query' | 'aggregate' | 'goal' | 'memory' | 'custom';
  [key: string]: unknown;
}

export interface DataBinding {
  id: string;
  variableName: string;
  source: DataBindingSource;
  refreshInterval?: number;
  lastValue?: unknown;
  lastRefreshed?: string;
}

export interface Artifact {
  id: string;
  conversationId: string | null;
  userId: string;
  type: ArtifactType;
  title: string;
  content: string;
  dataBindings: DataBinding[];
  pinned: boolean;
  dashboardPosition: number | null;
  dashboardSize: DashboardSize;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: string;
  dataBindings: DataBinding[] | null;
  createdAt: string;
}

export interface CreateArtifactInput {
  conversationId?: string;
  type: ArtifactType;
  title: string;
  content: string;
  dataBindings?: DataBinding[];
  pinToDashboard?: boolean;
  dashboardSize?: DashboardSize;
  tags?: string[];
}

export interface UpdateArtifactInput {
  title?: string;
  content?: string;
  dataBindings?: DataBinding[];
  pinned?: boolean;
  dashboardPosition?: number;
  dashboardSize?: DashboardSize;
  tags?: string[];
}

export interface ArtifactListQuery {
  type?: ArtifactType;
  pinned?: boolean;
  conversationId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// API
// =============================================================================

export const artifactsApi = {
  list: (query?: ArtifactListQuery) => {
    const params = new URLSearchParams();
    if (query?.type) params.set('type', query.type);
    if (query?.pinned !== undefined) params.set('pinned', String(query.pinned));
    if (query?.conversationId) params.set('conversationId', query.conversationId);
    if (query?.search) params.set('search', query.search);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    const qs = params.toString();
    return apiClient.get<{ artifacts: Artifact[]; total: number }>(
      `/artifacts${qs ? `?${qs}` : ''}`
    );
  },

  get: (id: string) => apiClient.get<Artifact>(`/artifacts/${id}`),

  create: (input: CreateArtifactInput) => apiClient.post<Artifact>('/artifacts', input),

  update: (id: string, input: UpdateArtifactInput) =>
    apiClient.patch<Artifact>(`/artifacts/${id}`, input),

  delete: (id: string) => apiClient.delete(`/artifacts/${id}`),

  togglePin: (id: string) => apiClient.post<Artifact>(`/artifacts/${id}/pin`),

  refresh: (id: string) => apiClient.post<Artifact>(`/artifacts/${id}/refresh`),

  getVersions: (id: string) => apiClient.get<ArtifactVersion[]>(`/artifacts/${id}/versions`),
};
