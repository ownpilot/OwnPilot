/**
 * MCP API Endpoints
 *
 * Client for managing external MCP server connections.
 */

import { apiClient } from '../client';

export interface McpServer {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  enabled: boolean;
  autoConnect: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  errorMessage?: string;
  toolCount: number;
  metadata: Record<string, unknown>;
  connected?: boolean; // live status enriched by API
  createdAt: string;
  updatedAt: string;
}

export interface McpServerTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface CreateMcpServerInput {
  name: string;
  displayName: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  autoConnect?: boolean;
}

export interface McpServerInfo {
  server: {
    name: string;
    version: string;
    protocol: string;
    endpoint: string;
    transport: string;
  };
  tools: {
    count: number;
    items: Array<{
      name: string;
      qualifiedName: string;
      description: string;
      category?: string;
    }>;
  };
  configSnippets: Record<string, {
    label: string;
    description: string;
    config: Record<string, unknown>;
  }>;
}

export interface UpdateMcpServerInput {
  name?: string;
  displayName?: string;
  transport?: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  autoConnect?: boolean;
}

export const mcpApi = {
  /** Get OwnPilot MCP server info (endpoint URL, exposed tools, config snippets) */
  serverInfo: () =>
    apiClient.get<McpServerInfo>('/mcp/serve/info'),

  /** List all configured MCP servers */
  list: () =>
    apiClient.get<{ servers: McpServer[]; count: number }>('/mcp'),

  /** Add new MCP server configuration */
  create: (data: CreateMcpServerInput) =>
    apiClient.post<McpServer>('/mcp', data),

  /** Get server details */
  get: (id: string) =>
    apiClient.get<McpServer>(`/mcp/${id}`),

  /** Update server configuration */
  update: (id: string, data: UpdateMcpServerInput) =>
    apiClient.put<McpServer>(`/mcp/${id}`, data),

  /** Delete server configuration */
  delete: (id: string) =>
    apiClient.delete<{ deleted: boolean }>(`/mcp/${id}`),

  /** Connect to server */
  connect: (id: string) =>
    apiClient.post<{ connected: boolean; tools: McpServerTool[]; toolCount: number }>(`/mcp/${id}/connect`),

  /** Disconnect from server */
  disconnect: (id: string) =>
    apiClient.post<{ disconnected: boolean }>(`/mcp/${id}/disconnect`),

  /** List tools from a connected server */
  tools: (id: string) =>
    apiClient.get<{ tools: McpServerTool[]; count: number }>(`/mcp/${id}/tools`),

  /** Update per-tool settings (e.g. workflowUsable) */
  setToolSettings: (serverId: string, toolName: string, workflowUsable: boolean) =>
    apiClient.patch<{ toolName: string; workflowUsable: boolean }>(
      `/mcp/${serverId}/tool-settings`,
      { toolName, workflowUsable },
    ),
};
