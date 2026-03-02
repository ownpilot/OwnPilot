/**
 * Artifact Service Types & Interface
 *
 * Core types for the Artifacts system — AI-generated interactive content
 * (HTML, SVG, Markdown, charts, forms) with data bindings.
 */

// ============================================================================
// Types
// ============================================================================

export type ArtifactType = 'html' | 'svg' | 'markdown' | 'form' | 'chart' | 'react';
export type DashboardSize = 'small' | 'medium' | 'large' | 'full';

export type DataBindingSource =
  | { type: 'query'; entity: string; filter: Record<string, unknown> }
  | {
      type: 'aggregate';
      entity: string;
      operation: 'count' | 'sum' | 'avg';
      field?: string;
      filter?: Record<string, unknown>;
    }
  | { type: 'goal'; goalId: string }
  | { type: 'memory'; query: string; limit?: number }
  | { type: 'custom'; toolName: string; params: Record<string, unknown> };

export interface DataBinding {
  id: string;
  variableName: string;
  source: DataBindingSource;
  refreshInterval?: number;
  lastValue?: unknown;
  lastRefreshed?: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface ArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: string;
  dataBindings: DataBinding[] | null;
  createdAt: Date;
}

// ============================================================================
// Input Types
// ============================================================================

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

export interface ArtifactQuery {
  type?: ArtifactType;
  pinned?: boolean;
  conversationId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface IArtifactService {
  createArtifact(userId: string, input: CreateArtifactInput): Promise<Artifact>;
  getArtifact(userId: string, id: string): Promise<Artifact | null>;
  updateArtifact(userId: string, id: string, input: UpdateArtifactInput): Promise<Artifact | null>;
  deleteArtifact(userId: string, id: string): Promise<boolean>;
  listArtifacts(
    userId: string,
    query?: ArtifactQuery
  ): Promise<{ artifacts: Artifact[]; total: number }>;
  togglePin(userId: string, id: string): Promise<Artifact | null>;
  refreshBindings(userId: string, id: string): Promise<Artifact | null>;
  getVersions(userId: string, artifactId: string): Promise<ArtifactVersion[]>;
}
