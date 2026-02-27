/**
 * Security Scanner API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export type SeverityLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskItem {
  source: string;
  sourceId?: string;
  severity: SeverityLevel;
  description: string;
}

export interface SectionScanResult<T = unknown> {
  count: number;
  issues: number;
  score: number;
  items: T[];
}

export interface ExtensionScanItem {
  id: string;
  name: string;
  format: string;
  status: string;
  score: number;
  riskLevel: string;
  blocked: boolean;
  warnings: string[];
}

export interface CustomToolScanItem {
  id: string;
  name: string;
  status: string;
  score: number;
  category: string;
  warnings: string[];
  permissions: string[];
}

export interface TriggerScanItem {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  score: number;
  actionType: string;
  risks: string[];
}

export interface WorkflowScanItem {
  id: string;
  name: string;
  status: string;
  score: number;
  nodeCount: number;
  riskyNodes: string[];
}

export interface CliToolScanItem {
  name: string;
  catalogRisk: string;
  policy: string;
  score: number;
  issue?: string;
}

export interface PlatformScanResult {
  overallScore: number;
  overallLevel: SeverityLevel;
  scannedAt: string;
  sections: {
    extensions: SectionScanResult<ExtensionScanItem>;
    customTools: SectionScanResult<CustomToolScanItem>;
    triggers: SectionScanResult<TriggerScanItem>;
    workflows: SectionScanResult<WorkflowScanItem>;
    cliTools: SectionScanResult<CliToolScanItem>;
  };
  topRisks: RiskItem[];
  recommendations: string[];
}

// =============================================================================
// API
// =============================================================================

export const securityApi = {
  /** Full platform security scan */
  scan: () => apiClient.post<PlatformScanResult>('/security/scan'),

  /** Scan all extensions */
  scanExtensions: () =>
    apiClient.post<SectionScanResult<ExtensionScanItem>>('/security/scan/extensions'),

  /** Scan all custom tools */
  scanCustomTools: () =>
    apiClient.post<SectionScanResult<CustomToolScanItem>>('/security/scan/custom-tools'),

  /** Scan a single custom tool by code */
  scanCustomTool: (code: string, name?: string, permissions?: string[]) =>
    apiClient.post<{
      name: string;
      score: number;
      category: string;
      valid: boolean;
      errors: string[];
      warnings: string[];
    }>('/security/scan/custom-tool', { code, name, permissions }),

  /** Scan all triggers */
  scanTriggers: () =>
    apiClient.post<SectionScanResult<TriggerScanItem>>('/security/scan/triggers'),

  /** Scan a single trigger */
  scanTrigger: (triggerId: string) =>
    apiClient.post<TriggerScanItem>('/security/scan/trigger', { triggerId }),

  /** Scan all workflows */
  scanWorkflows: () =>
    apiClient.post<SectionScanResult<WorkflowScanItem>>('/security/scan/workflows'),

  /** Scan a single workflow */
  scanWorkflow: (workflowId: string) =>
    apiClient.post<WorkflowScanItem>('/security/scan/workflow', { workflowId }),

  /** Scan CLI tool policies */
  scanCliTools: () =>
    apiClient.post<SectionScanResult<CliToolScanItem>>('/security/scan/cli-tools'),
};
