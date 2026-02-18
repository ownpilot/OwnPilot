import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import {
  Server, Terminal, Globe, RefreshCw, Plus, Trash2, Edit2, Check,
  AlertCircle, Zap, X, ChevronDown, ChevronRight,
  Folder, Code, Search, Database, FileText, Download,
} from '../components/icons';
import { mcpApi } from '../api';
import type { McpServer, McpServerTool, CreateMcpServerInput } from '../api/endpoints/mcp';

// =============================================================================
// Status helpers
// =============================================================================

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  connected: { bg: 'bg-success/10', text: 'text-success', label: 'Connected' },
  connecting: { bg: 'bg-warning/10', text: 'text-warning', label: 'Connecting...' },
  disconnected: { bg: 'bg-text-muted/10', text: 'text-text-muted dark:text-dark-text-muted', label: 'Disconnected' },
  error: { bg: 'bg-error/10', text: 'text-error', label: 'Error' },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.disconnected!;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${style!.bg} ${style!.text}`}>
      {status === 'connected' && <Check className="w-3 h-3" />}
      {status === 'error' && <AlertCircle className="w-3 h-3" />}
      {style!.label}
    </span>
  );
}

function TransportBadge({ transport }: { transport: string }) {
  const label = transport === 'stdio' ? 'stdio' : transport === 'sse' ? 'SSE' : 'HTTP';
  const Icon = transport === 'stdio' ? Terminal : Globe;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

// =============================================================================
// Add/Edit Dialog
// =============================================================================

interface ServerFormData {
  name: string;
  displayName: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  enabled: boolean;
  autoConnect: boolean;
}

const EMPTY_FORM: ServerFormData = {
  name: '', displayName: '', transport: 'stdio',
  command: '', args: '', env: '', url: '', headers: '',
  enabled: true, autoConnect: true,
};

// =============================================================================
// Popular MCP Server Presets
// =============================================================================

interface McpPreset {
  name: string;
  displayName: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  npmPackage: string;
  form: ServerFormData;
}

const MCP_PRESETS: McpPreset[] = [
  {
    name: 'filesystem',
    displayName: 'Filesystem',
    description: 'Read, write, and manage local files and directories',
    icon: Folder,
    npmPackage: '@modelcontextprotocol/server-filesystem',
    form: {
      name: 'filesystem', displayName: 'Filesystem', transport: 'stdio',
      command: 'npx', args: '-y\n@modelcontextprotocol/server-filesystem\n.',
      env: '', url: '', headers: '', enabled: true, autoConnect: true,
    },
  },
  {
    name: 'github',
    displayName: 'GitHub',
    description: 'Manage repos, issues, PRs, and branches on GitHub',
    icon: Code,
    npmPackage: '@modelcontextprotocol/server-github',
    form: {
      name: 'github', displayName: 'GitHub', transport: 'stdio',
      command: 'npx', args: '-y\n@modelcontextprotocol/server-github',
      env: '{"GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"}', url: '', headers: '',
      enabled: true, autoConnect: false,
    },
  },
  {
    name: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web and local search via Brave Search API',
    icon: Search,
    npmPackage: '@modelcontextprotocol/server-brave-search',
    form: {
      name: 'brave-search', displayName: 'Brave Search', transport: 'stdio',
      command: 'npx', args: '-y\n@modelcontextprotocol/server-brave-search',
      env: '{"BRAVE_API_KEY": "your-api-key-here"}', url: '', headers: '',
      enabled: true, autoConnect: false,
    },
  },
  {
    name: 'fetch',
    displayName: 'Fetch',
    description: 'Fetch and extract content from web pages and URLs',
    icon: Download,
    npmPackage: '@modelcontextprotocol/server-fetch',
    form: {
      name: 'fetch', displayName: 'Fetch', transport: 'stdio',
      command: 'npx', args: '-y\n@modelcontextprotocol/server-fetch',
      env: '', url: '', headers: '', enabled: true, autoConnect: true,
    },
  },
  {
    name: 'memory',
    displayName: 'Memory',
    description: 'Persistent knowledge graph for long-term AI memory',
    icon: Database,
    npmPackage: '@modelcontextprotocol/server-memory',
    form: {
      name: 'memory', displayName: 'Memory', transport: 'stdio',
      command: 'npx', args: '-y\n@modelcontextprotocol/server-memory',
      env: '', url: '', headers: '', enabled: true, autoConnect: true,
    },
  },
  {
    name: 'sequential-thinking',
    displayName: 'Sequential Thinking',
    description: 'Dynamic problem-solving through structured thought sequences',
    icon: FileText,
    npmPackage: '@modelcontextprotocol/server-sequential-thinking',
    form: {
      name: 'sequential-thinking', displayName: 'Sequential Thinking', transport: 'stdio',
      command: 'npx', args: '-y\n@modelcontextprotocol/server-sequential-thinking',
      env: '', url: '', headers: '', enabled: true, autoConnect: true,
    },
  },
];

function ServerFormDialog({
  initial,
  title,
  onSubmit,
  onCancel,
}: {
  initial: ServerFormData;
  title: string;
  onSubmit: (data: ServerFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof ServerFormData, v: unknown) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">{title}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Name (slug)</label>
            <input value={form.name} onChange={e => set('name', e.target.value.replace(/[^a-z0-9_-]/g, ''))}
              placeholder="filesystem" className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Display Name</label>
            <input value={form.displayName} onChange={e => set('displayName', e.target.value)}
              placeholder="Filesystem Server" className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Transport</label>
          <select value={form.transport} onChange={e => set('transport', e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary">
            <option value="stdio">stdio (local process)</option>
            <option value="sse">SSE (remote server)</option>
            <option value="streamable-http">Streamable HTTP (remote server)</option>
          </select>
        </div>

        {form.transport === 'stdio' ? (
          <>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Command</label>
              <input value={form.command} onChange={e => set('command', e.target.value)}
                placeholder="npx" className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Arguments (one per line)</label>
              <textarea value={form.args} onChange={e => set('args', e.target.value)} rows={3}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Environment Variables (JSON, optional)</label>
              <input value={form.env} onChange={e => set('env', e.target.value)}
                placeholder='{"NODE_ENV": "production"}' className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary font-mono" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">URL</label>
              <input value={form.url} onChange={e => set('url', e.target.value)}
                placeholder="http://localhost:3001/mcp" className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Headers (JSON, optional)</label>
              <input value={form.headers} onChange={e => set('headers', e.target.value)}
                placeholder='{"Authorization": "Bearer ..."}' className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary font-mono" />
            </div>
          </>
        )}

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} className="rounded" />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary cursor-pointer">
            <input type="checkbox" checked={form.autoConnect} onChange={e => set('autoConnect', e.target.checked)} className="rounded" />
            Auto-connect on startup
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors">
            Cancel
          </button>
          <button onClick={() => onSubmit(form)} disabled={!form.name || !form.displayName}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Tool Viewer
// =============================================================================

function ToolList({ serverId }: { serverId: string }) {
  const [tools, setTools] = useState<McpServerTool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mcpApi.tools(serverId)
      .then(r => setTools(r.tools))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, [serverId]);

  if (loading) return <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">Loading tools...</div>;
  if (tools.length === 0) return <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">No tools available</div>;

  return (
    <div className="space-y-1 py-2">
      {tools.map(tool => (
        <div key={tool.name} className="px-3 py-1.5 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-sm">
          <span className="font-medium text-text-primary dark:text-dark-text-primary">{tool.name}</span>
          {tool.description && (
            <span className="ml-2 text-text-muted dark:text-dark-text-muted text-xs">{tool.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Preset Card
// =============================================================================

function PresetCard({
  preset,
  alreadyAdded,
  onAdd,
}: {
  preset: McpPreset;
  alreadyAdded: boolean;
  onAdd: () => void;
}) {
  const Icon = preset.icon;
  return (
    <button
      onClick={onAdd}
      disabled={alreadyAdded}
      className="flex items-start gap-3 p-3 rounded-xl border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary hover:border-primary/50 dark:hover:border-primary/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border dark:disabled:hover:border-dark-border w-full"
    >
      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{preset.displayName}</span>
          {alreadyAdded && (
            <span className="text-xs text-text-muted dark:text-dark-text-muted">(added)</span>
          )}
        </div>
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 line-clamp-2">{preset.description}</p>
        <p className="text-[10px] text-text-muted/60 dark:text-dark-text-muted/60 mt-1 font-mono truncate">{preset.npmPackage}</p>
      </div>
      {!alreadyAdded && <Plus className="w-4 h-4 text-text-muted dark:text-dark-text-muted shrink-0 mt-1" />}
    </button>
  );
}

// =============================================================================
// Server Card
// =============================================================================

function ServerCard({
  server,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  connecting,
}: {
  server: McpServer;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  connecting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConnected = server.connected || server.status === 'connected';

  return (
    <div className="border border-border dark:border-dark-border rounded-xl bg-bg-primary dark:bg-dark-bg-primary overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <Server className="w-5 h-5 text-text-muted dark:text-dark-text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary dark:text-dark-text-primary truncate">{server.displayName}</span>
            <TransportBadge transport={server.transport} />
            <StatusBadge status={server.status} />
          </div>
          <div className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            {server.transport === 'stdio'
              ? `${server.command} ${(server.args ?? []).join(' ')}`
              : server.url ?? 'No URL configured'}
            {isConnected && server.toolCount > 0 && ` — ${server.toolCount} tools`}
          </div>
          {server.status === 'error' && server.errorMessage && (
            <div className="text-xs text-error mt-1 truncate">{server.errorMessage}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isConnected && (
            <button onClick={() => setExpanded(!expanded)} title="Show tools"
              className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
          {isConnected ? (
            <button onClick={onDisconnect} title="Disconnect" disabled={connecting}
              className="p-1.5 rounded-lg hover:bg-error/10 text-text-muted hover:text-error dark:text-dark-text-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={onConnect} title="Connect" disabled={connecting}
              className="p-1.5 rounded-lg hover:bg-success/10 text-text-muted hover:text-success dark:text-dark-text-muted transition-colors disabled:opacity-50">
              {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            </button>
          )}
          <button onClick={onEdit} title="Edit"
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors">
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={onDelete} title="Delete"
            className="p-1.5 rounded-lg hover:bg-error/10 text-text-muted hover:text-error dark:text-dark-text-muted transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {expanded && isConnected && (
        <div className="border-t border-border dark:border-dark-border px-4">
          <ToolList serverId={server.id} />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState<{ mode: 'add' | 'edit'; server?: McpServer; preset?: ServerFormData } | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const { confirm } = useDialog();
  const toast = useToast();

  const fetchServers = useCallback(async () => {
    try {
      const result = await mcpApi.list();
      setServers(result.servers);
    } catch {
      toast.error('Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleConnect = async (server: McpServer) => {
    setConnectingId(server.id);
    try {
      const result = await mcpApi.connect(server.id);
      toast.success(`Connected to ${server.displayName} — ${result.toolCount} tools`);
      fetchServers();
    } catch (err) {
      toast.error(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`);
      fetchServers();
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (server: McpServer) => {
    try {
      await mcpApi.disconnect(server.id);
      toast.success(`Disconnected from ${server.displayName}`);
      fetchServers();
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  const handleDelete = async (server: McpServer) => {
    const ok = await confirm({ message: `Delete "${server.displayName}"? This will disconnect and remove the server configuration.`, variant: 'danger' });
    if (!ok) return;
    try {
      await mcpApi.delete(server.id);
      toast.success(`Deleted ${server.displayName}`);
      fetchServers();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleSubmit = async (form: ServerFormData) => {
    const data: CreateMcpServerInput = {
      name: form.name,
      displayName: form.displayName,
      transport: form.transport,
      command: form.transport === 'stdio' ? form.command : undefined,
      args: form.transport === 'stdio' ? form.args.split('\n').filter(Boolean) : undefined,
      env: form.env ? (() => { try { return JSON.parse(form.env); } catch { return undefined; } })() : undefined,
      url: form.transport !== 'stdio' ? form.url : undefined,
      headers: form.headers ? (() => { try { return JSON.parse(form.headers); } catch { return undefined; } })() : undefined,
      enabled: form.enabled,
      autoConnect: form.autoConnect,
    };

    try {
      if (showForm?.mode === 'edit' && showForm.server) {
        await mcpApi.update(showForm.server.id, data);
        toast.success('Server updated');
      } else {
        await mcpApi.create(data);
        toast.success('Server added');
      }
      setShowForm(null);
      fetchServers();
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const serverToForm = (s: McpServer): ServerFormData => ({
    name: s.name,
    displayName: s.displayName,
    transport: s.transport,
    command: s.command ?? '',
    args: (s.args ?? []).join('\n'),
    env: Object.keys(s.env ?? {}).length > 0 ? JSON.stringify(s.env) : '',
    url: s.url ?? '',
    headers: Object.keys(s.headers ?? {}).length > 0 ? JSON.stringify(s.headers) : '',
    enabled: s.enabled,
    autoConnect: s.autoConnect,
  });

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary">MCP Servers</h1>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
            Connect to external MCP servers to extend OwnPilot with additional tools.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchServers}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowForm({ mode: 'add' })}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors">
            <Plus className="w-4 h-4" />
            Add Server
          </button>
        </div>
      </div>

      {/* Server List */}
      {loading ? (
        <div className="text-center text-text-muted dark:text-dark-text-muted py-12">Loading...</div>
      ) : servers.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <Server className="w-12 h-12 mx-auto text-text-muted dark:text-dark-text-muted opacity-40" />
          <p className="text-text-muted dark:text-dark-text-muted">No MCP servers configured</p>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Add an MCP server to extend OwnPilot with external tools.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              onConnect={() => handleConnect(server)}
              onDisconnect={() => handleDisconnect(server)}
              onEdit={() => setShowForm({ mode: 'edit', server })}
              onDelete={() => handleDelete(server)}
              connecting={connectingId === server.id}
            />
          ))}
        </div>
      )}

      {/* Quick Add — Popular MCP Servers */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">Quick Add — Popular MCP Servers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MCP_PRESETS.map(preset => (
            <PresetCard
              key={preset.name}
              preset={preset}
              alreadyAdded={servers.some(s => s.name === preset.name)}
              onAdd={() => setShowForm({ mode: 'add', preset: preset.form })}
            />
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="text-xs text-text-muted dark:text-dark-text-muted space-y-1 pt-4 border-t border-border dark:border-dark-border">
        <p>MCP (Model Context Protocol) lets you connect OwnPilot to external tool servers.</p>
        <p>Tools from connected servers appear in the AI's tool catalog with <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">mcp.servername.</code> prefix.</p>
      </div>

      {/* Add/Edit Dialog */}
      {showForm && (
        <ServerFormDialog
          title={showForm.mode === 'edit' ? 'Edit MCP Server' : 'Add MCP Server'}
          initial={showForm.server ? serverToForm(showForm.server) : showForm.preset ?? EMPTY_FORM}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(null)}
        />
      )}
    </div>
  );
}
