import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { PageHomeTab } from '../components/PageHomeTab';
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
  Link,
  Home,
  Puzzle,
  Activity,
  Layers,
} from '../components/icons';
import { mcpApi } from '../api';
import { useSkipHome } from '../hooks/useSkipHome';
import type {
  McpServer,
  McpServerTool,
  CreateMcpServerInput,
  McpPreset,
  InstallMcpPresetInput,
} from '../api/endpoints/mcp';

// =============================================================================
import { OwnPilotServerSection } from './McpServersPage.OwnPilotSection';

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

// Preset list itself is fetched from GET /mcp/presets (server-side catalog).
// Local map only assigns an icon per category for the card visualization.
const PRESET_CATEGORY_ICON: Record<
  McpPreset['category'],
  React.ComponentType<{ className?: string }>
> = {
  browser: Globe,
  filesystem: Folder,
  web: Download,
  memory: Database,
  devtools: Code,
  reasoning: FileText,
};

function presetIcon(preset: McpPreset): React.ComponentType<{ className?: string }> {
  return PRESET_CATEGORY_ICON[preset.category] ?? Server;
}

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
  const Icon = presetIcon(preset);
  const commandLine = `${preset.command} ${preset.args.join(' ')}`;
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
          {commandLine}
        </p>
      </div>
      {!alreadyAdded && (
        <Plus className="w-4 h-4 text-text-muted dark:text-dark-text-muted shrink-0 mt-1" />
      )}
    </button>
  );
}

// =============================================================================
// Preset Install Dialog
// =============================================================================

function PresetInstallDialog({
  preset,
  onInstall,
  onCancel,
  submitting,
}: {
  preset: McpPreset;
  onInstall: (input: InstallMcpPresetInput) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(preset.defaultName);
  const [extraArgs, setExtraArgs] = useState('');
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [autoConnect, setAutoConnect] = useState(true);

  const missingRequired = preset.env
    .filter((e) => e.required)
    .filter((e) => !envValues[e.name]?.trim())
    .map((e) => e.name);

  const handleSubmit = () => {
    if (missingRequired.length > 0) return;
    const parsedExtra = extraArgs
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onInstall({
      name: name.trim() || undefined,
      extraArgs: parsedExtra.length > 0 ? parsedExtra : undefined,
      env: Object.fromEntries(
        Object.entries(envValues).filter(([, v]) => typeof v === 'string' && v.length > 0)
      ),
      autoConnect,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Install {preset.displayName}
            </h2>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
              {preset.description}
            </p>
          </div>
          <a
            href={preset.homepage}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline shrink-0 mt-1"
          >
            docs ↗
          </a>
        </div>

        <div className="text-xs px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className="text-text-muted dark:text-dark-text-muted">{preset.installHint}</p>
        </div>

        {preset.warning && (
          <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
            <div className="flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{preset.warning}</p>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
            Server name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
            placeholder={preset.defaultName}
          />
        </div>

        {preset.env.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              Environment variables
            </div>
            {preset.env.map((envVar) => (
              <div key={envVar.name} className="space-y-1">
                <label className="text-xs text-text-primary dark:text-dark-text-primary flex items-center gap-1.5">
                  <span className="font-mono">{envVar.name}</span>
                  {envVar.required && <span className="text-red-500">*</span>}
                  {envVar.kind === 'secret' && (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted dark:text-dark-text-muted">
                      secret
                    </span>
                  )}
                </label>
                <input
                  type={envVar.kind === 'secret' ? 'password' : 'text'}
                  value={envValues[envVar.name] ?? ''}
                  onChange={(e) =>
                    setEnvValues((prev) => ({ ...prev, [envVar.name]: e.target.value }))
                  }
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary font-mono"
                  placeholder={envVar.required ? 'required' : 'optional'}
                />
                <p className="text-[11px] text-text-muted dark:text-dark-text-muted">
                  {envVar.description}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
            Extra args (one per line, appended to baseline)
          </label>
          <textarea
            value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary font-mono"
            placeholder="/Users/me/projects"
            rows={3}
          />
          <p className="text-[11px] text-text-muted dark:text-dark-text-muted font-mono">
            base: {preset.command} {preset.args.join(' ')}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-text-primary dark:text-dark-text-primary">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
          />
          Connect automatically on server start
        </label>

        {missingRequired.length > 0 && (
          <p className="text-xs text-red-500">Missing required: {missingRequired.join(', ')}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-lg border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || missingRequired.length > 0}
            className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>
    </div>
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

type TabId = 'home' | 'servers';

const TAB_LABELS: Record<TabId, string> = {
  home: 'Home',
  servers: 'Servers',
};

export function McpServersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam || 'home');

  useEffect(() => {
    const urlTab = (searchParams.get('tab') as TabId | null) || 'home';
    setActiveTab(urlTab);
  }, [searchParams]);

  const setTab = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      setSearchParams(tab === 'home' ? {} : { tab });
    },
    [setSearchParams]
  );

  const { skipHome, onSkipHomeChange } = useSkipHome({
    pageName: 'mcpservers',
    defaultTab: 'servers',
    onNavigate: (tab) => setTab(tab as TabId),
  });

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState<{
    mode: 'add' | 'edit';
    server?: McpServer;
    preset?: ServerFormData;
  } | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [presetInstall, setPresetInstall] = useState<McpPreset | null>(null);
  const [installing, setInstalling] = useState(false);
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

  useEffect(() => {
    // Preset catalog is auxiliary — failure leaves the section empty but
    // doesn't block manual server config.
    mcpApi
      .presets()
      .then((result) => setPresets(result.presets))
      .catch((err: unknown) => {
        console.warn(
          '[mcp-presets] catalog fetch failed:',
          err instanceof Error ? err.message : err
        );
      });
  }, []);

  const handleInstallPreset = async (preset: McpPreset, input: InstallMcpPresetInput) => {
    setInstalling(true);
    try {
      const result = await mcpApi.installPreset(preset.id, input);
      toast.success(`Installed ${result.preset.displayName}`);
      setPresetInstall(null);
      fetchServers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to install preset';
      toast.error(msg);
    } finally {
      setInstalling(false);
    }
  };

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
    <div className="flex flex-col h-full">
      {/* Page Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            MCP Integration
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Use OwnPilot as an MCP server for external AI clients, or connect to external MCP
            servers for additional tools.
          </p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'servers'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Home tab */}
      {activeTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Server, color: 'text-primary bg-primary/10' },
            { icon: Globe, color: 'text-emerald-500 bg-emerald-500/10' },
            { icon: Puzzle, color: 'text-violet-500 bg-violet-500/10' },
          ]}
          title="Connect to MCP Servers"
          subtitle="Model Context Protocol servers extend your AI with external tools and data sources — databases, APIs, file systems, and more."
          cta={{ label: 'Manage Servers', icon: Server, onClick: () => setTab('servers') }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={onSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to Servers"
          features={[
            {
              icon: Globe,
              color: 'text-blue-500 bg-blue-500/10',
              title: 'Protocol Standard',
              description:
                'Built on the open Model Context Protocol standard for AI-tool interoperability.',
            },
            {
              icon: Search,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Tool Discovery',
              description: 'Automatically discover and register tools from connected MCP servers.',
            },
            {
              icon: Layers,
              color: 'text-orange-500 bg-orange-500/10',
              title: 'Multiple Transports',
              description:
                'SSE, stdio, HTTP, WebSocket — connect using the transport that fits your setup.',
            },
            {
              icon: Activity,
              color: 'text-purple-500 bg-purple-500/10',
              title: 'Live Connection',
              description: 'Monitor server connections in real time with automatic reconnection.',
            },
          ]}
          steps={[
            { title: 'Add a server URL', detail: 'Enter the MCP server endpoint to connect.' },
            {
              title: 'AI discovers available tools',
              detail: 'Your AI automatically detects tools the server provides.',
            },
            {
              title: 'Use tools in conversations',
              detail: 'Reference discovered tools naturally in your chats.',
            },
            {
              title: 'Monitor connections',
              detail: 'Track connection status and health in real time.',
            },
          ]}
          quickActions={[
            {
              label: 'Manage Servers',
              icon: Server,
              description: 'Add, edit, and monitor your MCP server connections.',
              onClick: () => setTab('servers'),
            },
          ]}
          infoBox={{
            icon: Globe,
            color: 'blue',
            title: 'About MCP',
            description:
              'The Model Context Protocol is an open standard for connecting AI to external tools and data. Servers advertise capabilities and your AI calls them on demand.',
          }}
        />
      )}

      {/* Servers tab */}
      {activeTab === 'servers' && (
        <div className="max-w-3xl mx-auto p-6 space-y-8 flex-1 overflow-y-auto w-full">
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

            {/* Quick Add — Popular MCP Servers (server-side catalog) */}
            {presets.length > 0 && (
              <div className="space-y-3 pt-2">
                <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Quick Add — Popular MCP Servers
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {presets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      alreadyAdded={servers.some((s) => s.name === preset.defaultName)}
                      onAdd={() => setPresetInstall(preset)}
                    />
                  ))}
                </div>
              </div>
            )}
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

          {/* Preset Install Dialog */}
          {presetInstall && (
            <PresetInstallDialog
              preset={presetInstall}
              submitting={installing}
              onInstall={(input) => handleInstallPreset(presetInstall, input)}
              onCancel={() => (installing ? undefined : setPresetInstall(null))}
            />
          )}
        </div>
      )}
    </div>
  );
}
