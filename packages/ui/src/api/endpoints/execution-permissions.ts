/**
 * Execution Permissions API Endpoints
 */

import { apiClient } from '../client';

export type PermissionMode = 'blocked' | 'prompt' | 'allowed';

export type ExecutionMode = 'local' | 'docker' | 'auto';

export interface ExecutionPermissions {
  enabled: boolean;
  mode: ExecutionMode;
  execute_javascript: PermissionMode;
  execute_python: PermissionMode;
  execute_shell: PermissionMode;
  compile_code: PermissionMode;
  package_manager: PermissionMode;
}

export interface RiskFactor {
  pattern: string;
  description: string;
  severity: string;
}

export interface CodeRiskAnalysis {
  level: string;
  score: number;
  factors: RiskFactor[];
  blocked: boolean;
  blockReason?: string;
}

export interface ApprovalRequest {
  approvalId: string;
  category: string;
  description: string;
  code?: string;
  riskAnalysis?: CodeRiskAnalysis;
}

export const executionPermissionsApi = {
  /** Get current execution permissions */
  get: () => apiClient.get<ExecutionPermissions>('/execution-permissions'),

  /** Update execution permissions (partial merge) */
  update: (perms: Partial<ExecutionPermissions>) =>
    apiClient.put<ExecutionPermissions>('/execution-permissions', perms),

  /** Reset to all-blocked defaults */
  reset: () => apiClient.post<{ reset: boolean }>('/execution-permissions/reset'),

  /** Resolve a pending approval request */
  resolveApproval: (id: string, approved: boolean) =>
    apiClient.post<{ resolved: boolean; approved: boolean }>(
      `/execution-permissions/approvals/${id}/resolve`,
      { approved }
    ),
};
