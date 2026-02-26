/**
 * CLI Tools API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type CliToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type CliToolPolicy = 'allowed' | 'prompt' | 'blocked';
export type CliToolCategory =
  | 'linter'
  | 'formatter'
  | 'build'
  | 'test'
  | 'package-manager'
  | 'container'
  | 'version-control'
  | 'coding-agent'
  | 'utility'
  | 'security'
  | 'database';

export interface CliToolStatus {
  name: string;
  displayName: string;
  category: CliToolCategory;
  riskLevel: CliToolRiskLevel;
  installed: boolean;
  version?: string;
  npxAvailable: boolean;
  policy: CliToolPolicy;
  source: 'catalog' | 'custom';
}

export interface CliToolPolicyEntry {
  name: string;
  displayName: string;
  category: CliToolCategory;
  riskLevel: CliToolRiskLevel;
  policy: CliToolPolicy;
  source: 'catalog' | 'custom';
}

export interface CliToolExecutionResult {
  success: boolean;
  toolName: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: string;
  truncated: boolean;
}

export interface RegisterCustomCliToolInput {
  name: string;
  displayName: string;
  binaryName: string;
  description?: string;
  category?: CliToolCategory;
  riskLevel?: CliToolRiskLevel;
}

// =============================================================================
// API
// =============================================================================

export const cliToolsApi = {
  /** List all CLI tools with status */
  list: () => apiClient.get<CliToolStatus[]>('/cli-tools'),

  /** Get user's per-tool policies */
  policies: () => apiClient.get<CliToolPolicyEntry[]>('/cli-tools/policies'),

  /** Update a tool's execution policy */
  setPolicy: (toolName: string, policy: CliToolPolicy) =>
    apiClient.put<{ toolName: string; policy: CliToolPolicy }>(`/cli-tools/policies/${toolName}`, {
      policy,
    }),

  /** Batch update policies by risk level or tool list */
  batchSetPolicy: (policy: CliToolPolicy, opts: { riskLevel?: string; tools?: string[] }) =>
    apiClient.post<{ updated: number; policy: CliToolPolicy }>('/cli-tools/policies/batch', {
      policy,
      ...opts,
    }),

  /** Install a CLI tool */
  install: (name: string, method: 'npm-global' | 'pnpm-global' = 'npm-global') =>
    apiClient.post<CliToolExecutionResult>(`/cli-tools/${name}/install`, { method }),

  /** Refresh discovery cache */
  refresh: () => apiClient.post<{ refreshed: boolean }>('/cli-tools/refresh'),

  /** Register a custom CLI tool */
  registerCustom: (input: RegisterCustomCliToolInput) =>
    apiClient.post<{ name: string; displayName: string; policy: CliToolPolicy }>(
      '/cli-tools/custom',
      input
    ),

  /** Remove a custom CLI tool */
  deleteCustom: (name: string) =>
    apiClient.delete<{ deleted: boolean }>(`/cli-tools/custom/${name}`),
};
