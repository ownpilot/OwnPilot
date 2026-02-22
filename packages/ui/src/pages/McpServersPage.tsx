import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import {
  Server,
  Terminal,
  Globe,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  Check,
  AlertCircle,
  Zap,
  X,
  ChevronDown,
  ChevronRight,
  Folder,
  Code,
  Search,
  Database,
  FileText,
  Download,
  Copy,
  Eye,
  BookOpen,
  Link,
  Wrench,
} from '../components/icons';
import { mcpApi } from '../api';
import type {
  McpServer,
  McpServerTool,
  McpServerInfo,
  CreateMcpServerInput,
} from '../api/endpoints/mcp';

// =============================================================================
// OwnPilot MCP Server Section
// =============================================================================

function OwnPilotServerSection() {
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    mcpApi
      .serverInfo()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(label);
        toast.success(`Copied ${label}`);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        toast.error('Failed to copy');
      }
    },
    [toast]
  );

  if (loading) {
    return (
      <div className="border border-border dark:border-dark-border rounded-xl bg-bg-primary dark:bg-dark-bg-primary p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-48" />
          <div className="h-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-96" />
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="border border-error/30 rounded-xl bg-error/5 p-4 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-error shrink-0" />
        <span className="text-sm text-error">{error ?? 'Failed to load MCP server info'}</span>
      </div>
    );
  }

  return (
    <div className="border border-border dark:border-dark-border rounded-xl bg-bg-primary dark:bg-dark-bg-primary overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border dark:border-dark-border bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Server className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
                OwnPilot MCP Server
              </h2>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                Expose OwnPilot tools to external AI clients via MCP protocol
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-success/10 text-success font-medium">
              <Check className="w-3 h-3" />
              Active
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
              <Wrench className="w-3 h-3" />
              {info.tools.count} tools
            </span>
          </div>
        </div>
      </div>

      {/* Endpoint URL */}
      <div className="px-5 py-3 border-b border-border dark:border-dark-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1 block">
              Endpoint URL
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-1.5 text-sm font-mono rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary truncate">
                {info.server.endpoint}
              </code>
              <button
                onClick={() => copyToClipboard(info.server.endpoint, 'endpoint URL')}
                className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors shrink-0"
                title="Copy URL"
              >
                {copied === 'endpoint URL' ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <div className="text-right shrink-0">
            <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1 block">
              Protocol
            </label>
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary">
              <Globe className="w-3 h-3" />
              Streamable HTTP
            </span>
          </div>
        </div>
      </div>

      {/* Quick Setup Tabs */}
      <div className="px-5 py-3 border-b border-border dark:border-dark-border">
        <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 block">
          Quick Setup — Copy config for your AI client
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(info.configSnippets).map(([key, snippet]) => (
            <button
              key={key}
              onClick={() => setActiveSnippet(activeSnippet === key ? null : key)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                activeSnippet === key
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:border-primary/40 hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        {activeSnippet && info.configSnippets[activeSnippet] && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {info.configSnippets[activeSnippet]!.description}
            </p>
            <div className="relative">
              <pre className="px-3 py-2.5 text-xs font-mono rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary overflow-x-auto">
                {JSON.stringify(info.configSnippets[activeSnippet]!.config, null, 2)}
              </pre>
              <button
                onClick={() =>
                  copyToClipboard(
                    JSON.stringify(info.configSnippets[activeSnippet]!.config, null, 2),
                    `${info.configSnippets[activeSnippet]!.label} config`
                  )
                }
                className="absolute top-2 right-2 p-1.5 rounded-md bg-bg-tertiary/80 dark:bg-dark-bg-tertiary/80 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
                title="Copy config"
              >
                {copied === `${info.configSnippets[activeSnippet]!.label} config` ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Exposed Tools */}
      <div className="px-5 py-3">
        <button
          onClick={() => setShowTools(!showTools)}
          className="flex items-center gap-2 text-xs font-medium text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors w-full"
        >
          {showTools ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <Eye className="w-3.5 h-3.5" />
          View Exposed Tools ({info.tools.count})
        </button>
        {showTools && (
          <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
            {info.tools.items.map((tool) => (
              <div
                key={tool.qualifiedName}
                className="px-3 py-1.5 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-sm flex items-start gap-2"
              >
                <span className="font-medium text-text-primary dark:text-dark-text-primary whitespace-nowrap shrink-0">
                  {tool.name}
                </span>
                {tool.description && (
                  <span className="text-text-muted dark:text-dark-text-muted text-xs line-clamp-1">
                    {tool.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage Guide */}
      <details className="border-t border-border dark:border-dark-border">
        <summary className="px-5 py-3 flex items-center gap-2 text-xs font-medium text-text-muted dark:text-dark-text-muted cursor-pointer hover:text-text-primary dark:hover:text-dark-text-primary select-none">
          <BookOpen className="w-3.5 h-3.5" />
          Usage Guide
        </summary>
        <div className="px-5 pb-4 text-xs text-text-secondary dark:text-dark-text-secondary space-y-3">
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              What is MCP?
            </h4>
            <p>
              Model Context Protocol (MCP) is an open standard that lets AI applications discover
              and use tools from external servers. OwnPilot exposes all its tools via MCP, so any
              MCP-compatible AI client can use OwnPilot's capabilities (file management, web search,
              code execution, task management, etc).
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              How it works
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>OwnPilot runs a Streamable HTTP server at the endpoint URL shown above</li>
              <li>
                MCP clients connect and discover available tools via{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  tools/list
                </code>
              </li>
              <li>
                Clients call tools via{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  tools/call
                </code>{' '}
                with JSON arguments
              </li>
              <li>Results are returned as structured content (text, images, etc.)</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Claude Desktop Setup
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>Open Claude Desktop settings</li>
              <li>
                Go to <strong>Developer</strong> &rarr; <strong>Edit Config</strong>
              </li>
              <li>
                Add the OwnPilot config to the{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  mcpServers
                </code>{' '}
                section
              </li>
              <li>Restart Claude Desktop &mdash; OwnPilot tools will appear in the tool picker</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Cursor / Windsurf Setup
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>
                Create{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  .cursor/mcp.json
                </code>{' '}
                in your project root (or via Cursor settings)
              </li>
              <li>Add the OwnPilot config snippet</li>
              <li>Restart the editor &mdash; tools available in Composer</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Claude Code Setup
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>
                Create{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  .mcp.json
                </code>{' '}
                in your project root (per-project) or{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  ~/.claude/mcp.json
                </code>{' '}
                (global)
              </li>
              <li>Add the OwnPilot config snippet</li>
              <li>Restart Claude Code &mdash; tools available automatically</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Security Notes
            </h4>
            <ul className="list-disc list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>The MCP server runs on the same port as OwnPilot's API</li>
              <li>Tools execute with the same permissions as OwnPilot</li>
              <li>For remote access, use a reverse proxy with authentication</li>
              <li>
                The server is stateful per-session but ephemeral &mdash; no state persisted between
                restarts
              </li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}

// =============================================================================
// Status helpers
// =============================================================================

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  connected: { bg: 'bg-success/10', text: 'text-success', label: 'Connected' },
  connecting: { bg: 'bg-warning/10', text: 'text-warning', label: 'Connecting...' },
  disconnected: {
    bg: 'bg-text-muted/10',
    text: 'text-text-muted dark:text-dark-text-muted',
    label: 'Disconnected',
  },
  error: { bg: 'bg-error/10', text: 'text-error', label: 'Error' },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.disconnected!;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${style!.bg} ${style!.text}`}
    >
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
  name: '',
  displayName: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
  enabled: true,
  autoConnect: true,
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
      name: 'filesystem',
      displayName: 'Filesystem',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-filesystem\n.',
      env: '',
      url: '',
      headers: '',
      enabled: true,
      autoConnect: true,
    },
  },
  {
    name: 'github',
    displayName: 'GitHub',
    description: 'Manage repos, issues, PRs, and branches on GitHub',
    icon: Code,
    npmPackage: '@modelcontextprotocol/server-github',
    form: {
      name: 'github',
      displayName: 'GitHub',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-github',
      env: '{"GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"}',
      url: '',
      headers: '',
      enabled: true,
      autoConnect: false,
    },
  },
  {
    name: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web and local search via Brave Search API',
    icon: Search,
    npmPackage: '@modelcontextprotocol/server-brave-search',
    form: {
      name: 'brave-search',
      displayName: 'Brave Search',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-brave-search',
      env: '{"BRAVE_API_KEY": "your-api-key-here"}',
      url: '',
      headers: '',
      enabled: true,
      autoConnect: false,
    },
  },
  {
    name: 'fetch',
    displayName: 'Fetch',
    description: 'Fetch and extract content from web pages and URLs',
    icon: Download,
    npmPackage: '@modelcontextprotocol/server-fetch',
    form: {
      name: 'fetch',
      displayName: 'Fetch',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-fetch',
      env: '',
      url: '',
      headers: '',
      enabled: true,
      autoConnect: true,
    },
  },
  {
    name: 'memory',
    displayName: 'Memory',
    description: 'Persistent knowledge graph for long-term AI memory',
    icon: Database,
    npmPackage: '@modelcontextprotocol/server-memory',
    form: {
      name: 'memory',
      displayName: 'Memory',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-memory',
      env: '',
      url: '',
      headers: '',
      enabled: true,
      autoConnect: true,
    },
  },
  {
    name: 'sequential-thinking',
    displayName: 'Sequential Thinking',
    description: 'Dynamic problem-solving through structured thought sequences',
    icon: FileText,
    npmPackage: '@modelcontextprotocol/server-sequential-thinking',
    form: {
      name: 'sequential-thinking',
      displayName: 'Sequential Thinking',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-sequential-thinking',
      env: '',
      url: '',
      headers: '',
      enabled: true,
      autoConnect: true,
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
  const set = (k: keyof ServerFormData, v: unknown) => setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          {title}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Name (slug)
            </label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value.replace(/[^a-z0-9_-]/g, ''))}
              placeholder="filesystem"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Display Name
            </label>
            <input
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="Filesystem Server"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
            Transport
          </label>
          <select
            value={form.transport}
            onChange={(e) => set('transport', e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
          >
            <option value="stdio">stdio (local process)</option>
            <option value="sse">SSE (remote server)</option>
            <option value="streamable-http">Streamable HTTP (remote server)</option>
          </select>
        </div>

        {form.transport === 'stdio' ? (
          <>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Command
              </label>
              <input
                value={form.command}
                onChange={(e) => set('command', e.target.value)}
                placeholder="npx"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Arguments (one per line)
              </label>
              <textarea
                value={form.args}
                onChange={(e) => set('args', e.target.value)}
                rows={3}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/tmp'}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Environment Variables (JSON, optional)
              </label>
              <input
                value={form.env}
                onChange={(e) => set('env', e.target.value)}
                placeholder='{"NODE_ENV": "production"}'
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary font-mono"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                URL
              </label>
              <input
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="http://localhost:3001/mcp"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Headers (JSON, optional)
              </label>
              <input
                value={form.headers}
                onChange={(e) => set('headers', e.target.value)}
                placeholder='{"Authorization": "Bearer ..."}'
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary font-mono"
              />
            </div>
          </>
        )}

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="rounded"
            />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={form.autoConnect}
              onChange={(e) => set('autoConnect', e.target.checked)}
              className="rounded"
            />
            Auto-connect on startup
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={!form.name || !form.displayName}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
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
    mcpApi
      .tools(serverId)
      .then((r) => setTools(r.tools))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, [serverId]);

  if (loading)
    return (
      <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">Loading tools...</div>
    );
  if (tools.length === 0)
    return (
      <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">
        No tools available
      </div>
    );

  return (
    <div className="space-y-1 py-2">
      {tools.map((tool) => (
        <div
          key={tool.name}
          className="px-3 py-1.5 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-sm"
        >
          <span className="font-medium text-text-primary dark:text-dark-text-primary">
            {tool.name}
          </span>
          {tool.description && (
            <span className="ml-2 text-text-muted dark:text-dark-text-muted text-xs">
              {tool.description}
            </span>
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
          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            {preset.displayName}
          </span>
          {alreadyAdded && (
            <span className="text-xs text-text-muted dark:text-dark-text-muted">(added)</span>
          )}
        </div>
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 line-clamp-2">
          {preset.description}
        </p>
        <p className="text-[10px] text-text-muted/60 dark:text-dark-text-muted/60 mt-1 font-mono truncate">
          {preset.npmPackage}
        </p>
      </div>
      {!alreadyAdded && (
        <Plus className="w-4 h-4 text-text-muted dark:text-dark-text-muted shrink-0 mt-1" />
      )}
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
            <span className="font-medium text-text-primary dark:text-dark-text-primary truncate">
              {server.displayName}
            </span>
            <TransportBadge transport={server.transport} />
            <StatusBadge status={server.status} />
          </div>
          <div className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            {server.transport === 'stdio'
              ? `${server.command} ${(server.args ?? []).join(' ')}`
              : (server.url ?? 'No URL configured')}
            {isConnected && server.toolCount > 0 && ` — ${server.toolCount} tools`}
          </div>
          {server.status === 'error' && server.errorMessage && (
            <div className="text-xs text-error mt-1 truncate">{server.errorMessage}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isConnected && (
            <button
              onClick={() => setExpanded(!expanded)}
              title="Show tools"
              className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          {isConnected ? (
            <button
              onClick={onDisconnect}
              title="Disconnect"
              disabled={connecting}
              className="p-1.5 rounded-lg hover:bg-error/10 text-text-muted hover:text-error dark:text-dark-text-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onConnect}
              title="Connect"
              disabled={connecting}
              className="p-1.5 rounded-lg hover:bg-success/10 text-text-muted hover:text-success dark:text-dark-text-muted transition-colors disabled:opacity-50"
            >
              {connecting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={onEdit}
            title="Edit"
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1.5 rounded-lg hover:bg-error/10 text-text-muted hover:text-error dark:text-dark-text-muted transition-colors"
          >
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
  const [showForm, setShowForm] = useState<{
    mode: 'add' | 'edit';
    server?: McpServer;
    preset?: ServerFormData;
  } | null>(null);
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

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

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
    const ok = await confirm({
      message: `Delete "${server.displayName}"? This will disconnect and remove the server configuration.`,
      variant: 'danger',
    });
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
      env: form.env
        ? (() => {
            try {
              return JSON.parse(form.env);
            } catch {
              return undefined;
            }
          })()
        : undefined,
      url: form.transport !== 'stdio' ? form.url : undefined,
      headers: form.headers
        ? (() => {
            try {
              return JSON.parse(form.headers);
            } catch {
              return undefined;
            }
          })()
        : undefined,
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
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary">
          MCP Integration
        </h1>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
          Use OwnPilot as an MCP server for external AI clients, or connect to external MCP servers
          for additional tools.
        </p>
      </div>

      {/* Section 1: OwnPilot as MCP Server */}
      <OwnPilotServerSection />

      {/* Section 2: External MCP Servers (Client) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
              External MCP Servers
            </h2>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
              Connect to external MCP servers to add tools to OwnPilot
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchServers}
              className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowForm({ mode: 'add' })}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Server
            </button>
          </div>
        </div>

        {/* Server List */}
        {loading ? (
          <div className="text-center text-text-muted dark:text-dark-text-muted py-8">
            Loading...
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-8 space-y-2 border border-dashed border-border dark:border-dark-border rounded-xl">
            <Link className="w-8 h-8 mx-auto text-text-muted dark:text-dark-text-muted opacity-40" />
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              No external MCP servers configured
            </p>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Add an MCP server or use a preset below
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
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
        <div className="space-y-3 pt-2">
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Quick Add — Popular MCP Servers
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MCP_PRESETS.map((preset) => (
              <PresetCard
                key={preset.name}
                preset={preset}
                alreadyAdded={servers.some((s) => s.name === preset.name)}
                onAdd={() => setShowForm({ mode: 'add', preset: preset.form })}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Add/Edit Dialog */}
      {showForm && (
        <ServerFormDialog
          title={showForm.mode === 'edit' ? 'Edit MCP Server' : 'Add MCP Server'}
          initial={
            showForm.server ? serverToForm(showForm.server) : (showForm.preset ?? EMPTY_FORM)
          }
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(null)}
        />
      )}
    </div>
  );
}
