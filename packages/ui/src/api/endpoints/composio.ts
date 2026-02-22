/**
 * Composio API Endpoints
 *
 * Client for Composio OAuth connection management.
 */

import { apiClient } from '../client';

export interface ComposioApp {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  categories?: string[];
}

export interface ComposioConnection {
  id: string;
  appName: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComposioConnectionRequest {
  appName: string;
  redirectUrl: string | null;
  connectionId: string;
  status: string;
}

export interface ComposioStatus {
  configured: boolean;
  message: string;
}

export interface ComposioActionInfo {
  slug: string;
  name: string;
  description: string;
  appName: string;
}

export const composioApi = {
  /** Check if Composio is configured */
  status: () => apiClient.get<ComposioStatus>('/composio/status'),

  /** List available Composio apps (cached on server) */
  apps: () => apiClient.get<{ apps: ComposioApp[]; count: number }>('/composio/apps'),

  /** List user's active connections */
  connections: () =>
    apiClient.get<{ connections: ComposioConnection[]; count: number }>('/composio/connections'),

  /** Initiate OAuth connection for an app */
  connect: (appName: string) =>
    apiClient.post<ComposioConnectionRequest>('/composio/connections', { appName }),

  /** Get single connection status */
  getConnection: (id: string) => apiClient.get<ComposioConnection>(`/composio/connections/${id}`),

  /** Disconnect an app */
  disconnect: (id: string) =>
    apiClient.delete<{ disconnected: boolean }>(`/composio/connections/${id}`),

  /** Refresh connection tokens */
  refresh: (id: string) =>
    apiClient.post<ComposioConnection>(`/composio/connections/${id}/refresh`),

  /** Search Composio actions */
  searchActions: (query: string, app?: string) =>
    apiClient.get<{ actions: ComposioActionInfo[]; count: number }>('/composio/actions/search', {
      params: { q: query, ...(app ? { app } : {}) },
    }),
};
