/**
 * Custom Tool Types
 *
 * Shared types for custom tool management (CustomToolsPage, etc.)
 */

export type ToolStatus = 'active' | 'disabled' | 'pending_approval' | 'rejected';
export type ToolPermission = 'network' | 'filesystem' | 'database' | 'shell' | 'email' | 'scheduling';

export interface CustomTool {
  id: string;
  userId: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  code: string;
  category?: string;
  status: ToolStatus;
  permissions: ToolPermission[];
  requiresApproval: boolean;
  createdBy: 'user' | 'llm';
  version: number;
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ToolStats {
  total: number;
  active: number;
  disabled: number;
  pendingApproval: number;
  createdByLLM: number;
  createdByUser: number;
  totalUsage: number;
}
