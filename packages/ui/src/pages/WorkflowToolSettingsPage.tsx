/**
 * Workflow Tool Settings Page
 *
 * Manage workflowUsable toggles for custom tools and MCP tools.
 * Shows which tools are used in active workflows and warns before disabling.
 */

import { useState, useEffect, useCallback } from 'react';
import { customToolsApi, mcpApi, workflowsApi } from '../api';
import type { CustomTool } from '../types';
import type { McpServer, McpServerTool } from '../api/endpoints/mcp';

type TabId = 'custom' | 'mcp';

interface McpServerWithTools extends McpServer {
  liveTools: McpServerTool[];
}

export function WorkflowToolSettingsPage() {
  const [tab, setTab] = useState<TabId>('custom');
  const [customTools, setCustomTools] = useState<CustomTool[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerWithTools[]>([]);
  const [activeToolNames, setActiveToolNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'custom' | 'mcp';
    id: string;
    toolName: string;
    enabled: boolean;
    serverId?: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [customResult, mcpResult, activeNames] = await Promise.all([
        customToolsApi.list('active'),
        mcpApi.list(),
        workflowsApi.activeToolNames(),
      ]);

      setCustomTools(customResult.tools);
      setActiveToolNames(new Set(activeNames));

      // Fetch live tools for connected servers
      const serversWithTools: McpServerWithTools[] = await Promise.all(
        mcpResult.servers.map(async (server) => {
          let liveTools: McpServerTool[] = [];
          if (server.connected) {
            try {
              const toolsResult = await mcpApi.tools(server.id);
              liveTools = toolsResult.tools;
            } catch {
              // Server may have disconnected between list and tools call
            }
          }
          return { ...server, liveTools };
        }),
      );
      setMcpServers(serversWithTools);
    } catch {
      // Error handled silently — empty state is shown
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getWorkflowUsable = (tool: CustomTool): boolean => {
    return tool.metadata?.workflowUsable !== false;
  };

  const getMcpToolWorkflowUsable = (server: McpServer, toolName: string): boolean => {
    const toolSettings = (server.metadata?.toolSettings ?? {}) as Record<string, { workflowUsable?: boolean }>;
    return toolSettings[toolName]?.workflowUsable !== false;
  };

  const handleCustomToggle = async (tool: CustomTool, enabled: boolean) => {
    // Warn if disabling a tool used in active workflows
    if (!enabled && activeToolNames.has(tool.name)) {
      setConfirmDialog({ type: 'custom', id: tool.id, toolName: tool.name, enabled });
      return;
    }
    await performCustomToggle(tool.id, enabled);
  };

  const performCustomToggle = async (id: string, enabled: boolean) => {
    setToggling(id);
    try {
      await customToolsApi.setWorkflowUsable(id, enabled);
      setCustomTools(prev =>
        prev.map(t =>
          t.id === id ? { ...t, metadata: { ...t.metadata, workflowUsable: enabled } } : t,
        ),
      );
    } finally {
      setToggling(null);
    }
  };

  const handleMcpToggle = async (server: McpServer, toolName: string, enabled: boolean) => {
    const qualifiedName = `mcp.${server.name}.${toolName}`;
    if (!enabled && activeToolNames.has(qualifiedName)) {
      setConfirmDialog({ type: 'mcp', id: server.id, toolName, enabled, serverId: server.id });
      return;
    }
    await performMcpToggle(server.id, toolName, enabled);
  };

  const performMcpToggle = async (serverId: string, toolName: string, enabled: boolean) => {
    const key = `${serverId}:${toolName}`;
    setToggling(key);
    try {
      await mcpApi.setToolSettings(serverId, toolName, enabled);
      setMcpServers(prev =>
        prev.map(s => {
          if (s.id !== serverId) return s;
          const toolSettings = { ...((s.metadata?.toolSettings ?? {}) as Record<string, Record<string, unknown>>) };
          toolSettings[toolName] = { ...(toolSettings[toolName] ?? {}), workflowUsable: enabled };
          return { ...s, metadata: { ...s.metadata, toolSettings } };
        }),
      );
    } finally {
      setToggling(null);
    }
  };

  const handleConfirm = async () => {
    if (!confirmDialog) return;
    if (confirmDialog.type === 'custom') {
      await performCustomToggle(confirmDialog.id, confirmDialog.enabled);
    } else {
      await performMcpToggle(confirmDialog.id, confirmDialog.toolName, confirmDialog.enabled);
    }
    setConfirmDialog(null);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-bold mb-6">Workflow Tool Settings</h1>
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold mb-2">Workflow Tool Settings</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Control which tools are available as workflow nodes. Disabling a tool here
        hides it from the workflow editor and copilot.
      </p>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab('custom')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'custom'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Custom Tools ({customTools.length})
        </button>
        <button
          onClick={() => setTab('mcp')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'mcp'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          MCP Tools ({mcpServers.reduce((sum, s) => sum + s.liveTools.length, 0)})
        </button>
      </div>

      {/* Custom Tools Tab */}
      {tab === 'custom' && (
        <div className="space-y-1">
          {customTools.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No active custom tools found.
            </p>
          ) : (
            customTools.map(tool => {
              const enabled = getWorkflowUsable(tool);
              const inActiveWf = activeToolNames.has(tool.name);
              return (
                <div
                  key={tool.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm truncate">{tool.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Custom
                    </span>
                    {inActiveWf && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        Active WF
                      </span>
                    )}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={toggling === tool.id}
                      onChange={() => handleCustomToggle(tool, !enabled)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MCP Tools Tab */}
      {tab === 'mcp' && (
        <div className="space-y-6">
          {mcpServers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No MCP servers configured.
            </p>
          ) : (
            mcpServers.map(server => (
              <div key={server.id}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold">{server.displayName}</h3>
                  <span className="text-xs text-muted-foreground">
                    ({server.liveTools.length} tool{server.liveTools.length !== 1 ? 's' : ''})
                  </span>
                  {!server.connected && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Disconnected
                    </span>
                  )}
                </div>
                {server.liveTools.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-2">
                    {server.connected ? 'No tools exposed.' : 'Connect server to see tools.'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {server.liveTools.map(tool => {
                      const enabled = getMcpToolWorkflowUsable(server, tool.name);
                      const qualifiedName = `mcp.${server.name}.${tool.name}`;
                      const inActiveWf = activeToolNames.has(qualifiedName);
                      const key = `${server.id}:${tool.name}`;
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-sm truncate">{tool.name}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              MCP
                            </span>
                            {inActiveWf && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                                Active WF
                              </span>
                            )}
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={toggling === key}
                              onChange={() => handleMcpToggle(server, tool.name, !enabled)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-6 max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-2">Tool in Active Workflow</h2>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-mono">{confirmDialog.toolName}</span> is currently used in one
              or more active workflows. Disabling it will prevent those workflow nodes from
              appearing in the editor, but existing workflows will not be modified.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Disable Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
