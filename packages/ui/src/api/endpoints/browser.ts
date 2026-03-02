/**
 * Browser API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export interface BrowserConfig {
  available: boolean;
  executablePath: string | null;
  allowedDomains: string[];
  maxPagesPerUser: number;
}

export interface BrowserNavigateResult {
  url: string;
  title: string;
  text: string;
}

export interface BrowserActionResult {
  url: string;
  title: string;
  piiWarnings?: string[];
  text?: string;
  data?: Record<string, string>;
  screenshot?: string;
}

export interface BrowserScreenshotResult {
  url: string;
  title: string;
  screenshot: string;
}

export interface BrowserAction {
  type: 'click' | 'type' | 'scroll' | 'select' | 'wait' | 'fill_form' | 'extract';
  selector?: string;
  text?: string;
  value?: string;
  direction?: 'up' | 'down';
  pixels?: number;
  timeout?: number;
  fields?: { selector: string; value: string }[];
  dataSelectors?: Record<string, string>;
}

export interface BrowserWorkflow {
  id: string;
  userId: string;
  name: string;
  description: string;
  steps: BrowserAction[];
  parameters: { name: string; type: string; description: string }[];
  triggerId: string | null;
  lastExecutedAt: string | null;
  executionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBrowserWorkflowInput {
  name: string;
  description?: string;
  steps: BrowserAction[];
  parameters?: { name: string; type: string; description: string }[];
  triggerId?: string;
}

// =============================================================================
// API
// =============================================================================

export const browserApi = {
  getConfig: () => apiClient.get<BrowserConfig>('/browser/config'),

  navigate: (url: string) =>
    apiClient.post<BrowserNavigateResult>('/browser/navigate', { url }),

  action: (action: BrowserAction) =>
    apiClient.post<BrowserActionResult>('/browser/action', action),

  screenshot: (opts?: { fullPage?: boolean; selector?: string }) =>
    apiClient.post<BrowserScreenshotResult>('/browser/screenshot', opts ?? {}),

  closeSession: () => apiClient.delete<{ closed: boolean }>('/browser/session'),

  // Workflows
  listWorkflows: (limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const qs = params.toString();
    return apiClient.get<{ workflows: BrowserWorkflow[]; total: number }>(
      `/browser/workflows${qs ? `?${qs}` : ''}`
    );
  },

  createWorkflow: (input: CreateBrowserWorkflowInput) =>
    apiClient.post<BrowserWorkflow>('/browser/workflows', input),

  getWorkflow: (id: string) => apiClient.get<BrowserWorkflow>(`/browser/workflows/${id}`),

  updateWorkflow: (id: string, input: Partial<CreateBrowserWorkflowInput>) =>
    apiClient.patch<BrowserWorkflow>(`/browser/workflows/${id}`, input),

  deleteWorkflow: (id: string) => apiClient.delete(`/browser/workflows/${id}`),
};
