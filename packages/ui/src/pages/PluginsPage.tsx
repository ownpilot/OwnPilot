import { useState, useEffect, useCallback } from 'react';
import {
  Puzzle,
  Power,
  Wrench,
  Shield,
  Lock,
  Check,
  X,
  RefreshCw,
  Settings,
  Globe,
  AlertTriangle,
  Database,
} from '../components/icons';
import { DynamicConfigForm } from '../components/DynamicConfigForm';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ToastProvider';
import { pluginsApi, apiClient } from '../api';
import type { PluginInfo, PluginStats } from '../api';

/** Returns true if icon looks like a URL rather than an emoji/text string */
function isIconUrl(icon: string): boolean {
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('/');
}

/** Render plugin icon — emoji as text, URL as img, fallback to Puzzle */
function PluginIcon({ icon, size = 'sm' }: { icon?: string; size?: 'sm' | 'lg' }) {
  const textSize = size === 'lg' ? 'text-2xl' : 'text-xl';
  const imgSize = size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';
  const fallbackSize = size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  if (!icon) return <Puzzle className={`${fallbackSize} text-primary`} />;

  if (isIconUrl(icon)) {
    return <img src={icon} alt="" className={imgSize} />;
  }

  // Emoji or text icon
  return (
    <span className={textSize} role="img">
      {icon}
    </span>
  );
}

const CAPABILITY_LABELS: Record<string, { label: string; color: string }> = {
  tools: { label: 'Tools', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  handlers: { label: 'Handlers', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400' },
  storage: { label: 'Storage', color: 'bg-amber-500/20 text-amber-600 dark:text-amber-400' },
  scheduled: { label: 'Scheduled', color: 'bg-green-500/20 text-green-600 dark:text-green-400' },
  notifications: {
    label: 'Notifications',
    color: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
  },
  ui: { label: 'UI', color: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400' },
  integrations: {
    label: 'Integrations',
    color: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  },
};

const STATUS_COLORS: Record<string, string> = {
  enabled: 'bg-success/20 text-success',
  disabled: 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted',
  error: 'bg-error/20 text-error',
  installed: 'bg-primary/20 text-primary',
  updating: 'bg-warning/20 text-warning',
};

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  communication: 'bg-green-500/20 text-green-600 dark:text-green-400',
  utilities: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
  data: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  integrations: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  integration: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  channel: 'bg-teal-500/20 text-teal-600 dark:text-teal-400',
  media: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
  developer: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  lifestyle: 'bg-rose-500/20 text-rose-600 dark:text-rose-400',
  other: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
};

export function PluginsPage() {
  const toast = useToast();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [stats, setStats] = useState<PluginStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  useEffect(() => {
    fetchPlugins();
    fetchStats();
  }, []);

  const fetchPlugins = async () => {
    try {
      const data = await pluginsApi.list();
      setPlugins(Array.isArray(data) ? data : []);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await pluginsApi.stats();
      setStats(data);
    } catch {
      // API client handles error reporting
    }
  };

  const togglePlugin = async (plugin: PluginInfo) => {
    const action = plugin.status === 'enabled' ? 'disable' : 'enable';
    try {
      await apiClient.post<void>(`/plugins/${plugin.id}/${action}`);
      toast.success(action === 'enable' ? 'Plugin enabled' : 'Plugin disabled');
      fetchPlugins();
      fetchStats();
    } catch {
      // API client handles error reporting
    }
  };

  const filteredPlugins = plugins.filter((p) => {
    if (filter === 'enabled') return p.status === 'enabled';
    if (filter === 'disabled') return p.status === 'disabled';
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Plugins
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Extend your AI assistant with plugins
          </p>
        </div>
        <button
          onClick={() => {
            setIsLoading(true);
            fetchPlugins();
            fetchStats();
          }}
          className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div className="px-6 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-text-muted dark:text-dark-text-muted">Total:</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                {stats.total}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-text-muted dark:text-dark-text-muted">Enabled:</span>
              <span className="font-medium text-success">{stats.enabled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="text-text-muted dark:text-dark-text-muted">Disabled:</span>
              <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
                {stats.disabled}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" />
              <span className="text-text-muted dark:text-dark-text-muted">Tools:</span>
              <span className="font-medium text-primary">{stats.totalTools}</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border">
        <div className="flex gap-2">
          {(['all', 'enabled', 'disabled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingSpinner message="Loading plugins..." />
        ) : filteredPlugins.length === 0 ? (
          <EmptyState
            icon={Puzzle}
            title={`No plugins ${filter !== 'all' ? filter : 'installed'}`}
            description={
              filter === 'all'
                ? 'Install plugins to extend your AI assistant.'
                : `No ${filter} plugins found.`
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPlugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onToggle={() => togglePlugin(plugin)}
                onClick={() => setSelectedPlugin(plugin)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Plugin Detail Modal */}
      {selectedPlugin && (
        <PluginDetailModal
          plugin={selectedPlugin}
          onClose={() => setSelectedPlugin(null)}
          onToggle={() => togglePlugin(selectedPlugin)}
          onPluginUpdated={fetchPlugins}
        />
      )}
    </div>
  );
}

interface PluginCardProps {
  plugin: PluginInfo;
  onToggle: () => void;
  onClick: () => void;
}

function PluginCard({ plugin, onToggle, onClick }: PluginCardProps) {
  const isEnabled = plugin.status === 'enabled';
  const categoryColor = plugin.category
    ? CATEGORY_COLORS[plugin.category] || CATEGORY_COLORS.other
    : null;

  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-start justify-between mb-3">
        <button onClick={onClick} className="flex items-start gap-3 text-left flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <PluginIcon icon={plugin.icon} size="sm" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
              {plugin.name}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">v{plugin.version}</p>
          </div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {plugin.hasSettings && (
            <span title="Has configurable settings">
              <Settings className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
            </span>
          )}
          {plugin.hasUnconfiguredServices && (
            <span
              className="w-2 h-2 rounded-full bg-warning shrink-0"
              title="Has unconfigured services"
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`p-2 rounded-lg transition-colors ${
              isEnabled
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted hover:bg-bg-primary dark:hover:bg-dark-bg-primary'
            }`}
            title={isEnabled ? 'Disable plugin' : 'Enable plugin'}
          >
            <Power className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3">
        {plugin.description}
      </p>

      {/* Category & Capabilities */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {categoryColor && plugin.category && (
          <span className={`px-2 py-0.5 text-xs rounded-full ${categoryColor}`}>
            {plugin.category.charAt(0).toUpperCase() + plugin.category.slice(1)}
          </span>
        )}
        {plugin.capabilities.map((cap) => {
          const capInfo = CAPABILITY_LABELS[cap] || {
            label: cap,
            color: 'bg-gray-500/20 text-gray-600',
          };
          return (
            <span key={cap} className={`px-2 py-0.5 text-xs rounded-full ${capInfo.color}`}>
              {capInfo.label}
            </span>
          );
        })}
      </div>

      {/* Status & Stats */}
      <div className="flex items-center justify-between text-xs">
        <span
          className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[plugin.status] || STATUS_COLORS.disabled}`}
        >
          {plugin.status}
        </span>
        <div className="flex items-center gap-3 text-text-muted dark:text-dark-text-muted">
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {plugin.toolCount}
          </span>
          {plugin.permissions.length > 0 && (
            <span className="flex items-center gap-1">
              <Lock className="w-3 h-3" />
              {plugin.grantedPermissions?.length ?? 0}/{plugin.permissions.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface PluginDetailModalProps {
  plugin: PluginInfo;
  onClose: () => void;
  onToggle: () => void;
  onPluginUpdated: () => void;
}

function PluginDetailModal({ plugin, onClose, onToggle, onPluginUpdated }: PluginDetailModalProps) {
  const isEnabled = plugin.status === 'enabled';
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'services'>('overview');

  // Settings state
  const [settingsValues, setSettingsValues] = useState<Record<string, unknown>>({});
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showSettingsTab = plugin.hasSettings;
  const showServicesTab = (plugin.requiredServices?.length ?? 0) > 0;

  // Plugin-owned database tables
  const [pluginTables, setPluginTables] = useState<
    Array<{
      name: string;
      displayName: string;
      recordCount: number;
      columns: Array<{ name: string }>;
    }>
  >([]);

  // Fetch plugin-owned tables
  useEffect(() => {
    if (plugin) {
      apiClient
        .get<
          Array<{
            name: string;
            displayName: string;
            recordCount: number;
            columns: Array<{ name: string }>;
          }>
        >(`/custom-data/tables/by-plugin/${plugin.id}`)
        .then((data) => {
          setPluginTables(data);
        })
        .catch(() => setPluginTables([]));
    }
  }, [plugin.id]);

  // Initialize settings values when modal opens or plugin changes
  useEffect(() => {
    if (plugin) {
      setSettingsValues(plugin.settings ?? {});
      setSettingsMessage(null);
    }
  }, [plugin.id]);

  // Reset to overview tab if the current tab is no longer available
  useEffect(() => {
    if (activeTab === 'settings' && !showSettingsTab) {
      setActiveTab('overview');
    }
    if (activeTab === 'services' && !showServicesTab) {
      setActiveTab('overview');
    }
  }, [activeTab, showSettingsTab, showServicesTab]);

  const handleSaveSettings = useCallback(async () => {
    setIsSavingSettings(true);
    setSettingsMessage(null);
    try {
      await apiClient.put<void>(`/plugins/${plugin.id}/settings`, { settings: settingsValues });
      setSettingsMessage({ type: 'success', text: 'Settings saved successfully.' });
      onPluginUpdated();
    } catch {
      setSettingsMessage({ type: 'error', text: 'An error occurred while saving settings.' });
    } finally {
      setIsSavingSettings(false);
    }
  }, [plugin.id, settingsValues, onPluginUpdated]);

  const handleResetSettings = useCallback(() => {
    setSettingsValues({});
    setSettingsMessage(null);
  }, []);

  const categoryColor = plugin.category
    ? CATEGORY_COLORS[plugin.category] || CATEGORY_COLORS.other
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <PluginIcon icon={plugin.icon} size="lg" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                    {plugin.name}
                  </h3>
                  {categoryColor && plugin.category && (
                    <span className={`px-2 py-0.5 text-xs rounded-full ${categoryColor}`}>
                      {plugin.category.charAt(0).toUpperCase() + plugin.category.slice(1)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  v{plugin.version}
                  {plugin.author && ` by ${plugin.author.name}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {plugin.hasUnconfiguredServices && (
                <span title="Has unconfigured services">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                </span>
              )}
              <span
                className={`px-3 py-1 rounded-full text-sm ${STATUS_COLORS[plugin.status] || STATUS_COLORS.disabled}`}
              >
                {plugin.status}
              </span>
            </div>
          </div>
          <p className="mt-4 text-text-secondary dark:text-dark-text-secondary">
            {plugin.description}
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-border dark:border-dark-border">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            Overview
          </button>
          {showSettingsTab && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'settings'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
          )}
          {showServicesTab && (
            <button
              onClick={() => setActiveTab('services')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'services'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Services
              {plugin.hasUnconfiguredServices && (
                <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              )}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="p-6 space-y-6">
              {/* Capabilities */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Capabilities
                </h4>
                <div className="flex flex-wrap gap-2">
                  {plugin.capabilities.map((cap) => {
                    const capInfo = CAPABILITY_LABELS[cap] || {
                      label: cap,
                      color: 'bg-gray-500/20 text-gray-600',
                    };
                    return (
                      <span key={cap} className={`px-3 py-1 text-sm rounded-full ${capInfo.color}`}>
                        {capInfo.label}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Tools */}
              {plugin.tools.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                    Tools ({plugin.toolCount})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {plugin.tools.map((tool) => (
                      <span
                        key={tool}
                        className="px-3 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary rounded-lg"
                      >
                        <Wrench className="w-3 h-3 inline mr-1.5" />
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Database Tables */}
              {pluginTables.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Database Tables ({pluginTables.length})
                  </h4>
                  <div className="space-y-2">
                    {pluginTables.map((t) => (
                      <div
                        key={t.name}
                        className="flex items-center justify-between p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <Lock className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
                          <span className="text-sm text-text-primary dark:text-dark-text-primary font-medium">
                            {t.displayName}
                          </span>
                          <span className="text-xs text-text-muted dark:text-dark-text-muted">
                            ({t.name})
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted">
                          <span>{t.columns?.length ?? 0} cols</span>
                          <span>{t.recordCount ?? 0} records</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Permissions */}
              {plugin.permissions.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Permissions
                  </h4>
                  <div className="space-y-2">
                    {plugin.permissions.map((perm) => {
                      const isGranted = (plugin.grantedPermissions ?? []).includes(perm);
                      return (
                        <div
                          key={perm}
                          className="flex items-center justify-between p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                        >
                          <span className="text-sm text-text-primary dark:text-dark-text-primary">
                            {perm.replace(/_/g, ' ')}
                          </span>
                          {isGranted ? (
                            <span className="flex items-center gap-1 text-xs text-success">
                              <Check className="w-4 h-4" />
                              Granted
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-text-muted dark:text-dark-text-muted">
                              <X className="w-4 h-4" />
                              Not granted
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Details
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <span className="text-text-muted dark:text-dark-text-muted">Installed</span>
                    <p className="text-text-primary dark:text-dark-text-primary">
                      {new Date(plugin.installedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <span className="text-text-muted dark:text-dark-text-muted">Updated</span>
                    <p className="text-text-primary dark:text-dark-text-primary">
                      {new Date(plugin.updatedAt ?? plugin.installedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {plugin.author?.email && (
                    <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                      <span className="text-text-muted dark:text-dark-text-muted">
                        Author Email
                      </span>
                      <p className="text-text-primary dark:text-dark-text-primary truncate">
                        {plugin.author.email}
                      </p>
                    </div>
                  )}
                  {plugin.docs && (
                    <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                      <span className="text-text-muted dark:text-dark-text-muted">
                        Documentation
                      </span>
                      <a
                        href={plugin.docs}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block"
                      >
                        View Docs
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && plugin.pluginConfigSchema && (
            <div className="p-4 space-y-4">
              <DynamicConfigForm
                schema={plugin.pluginConfigSchema}
                values={settingsValues}
                onChange={setSettingsValues}
              />
              <div className="flex items-center gap-3 pt-4 border-t border-border dark:border-dark-border">
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isSavingSettings ? 'Saving...' : 'Save Settings'}
                </button>
                <button
                  onClick={handleResetSettings}
                  className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary border border-border dark:border-dark-border rounded-lg transition-colors"
                >
                  Reset to Defaults
                </button>
                {settingsMessage && (
                  <span
                    className={`text-sm ${settingsMessage.type === 'success' ? 'text-success' : 'text-error'}`}
                  >
                    {settingsMessage.text}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Settings Tab - no schema fallback */}
          {activeTab === 'settings' && !plugin.pluginConfigSchema && (
            <div className="p-6">
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                This plugin reports configurable settings, but no configuration schema is available.
              </p>
            </div>
          )}

          {/* Services Tab */}
          {activeTab === 'services' && plugin.requiredServices && (
            <div className="p-4 space-y-3">
              {plugin.requiredServices.length === 0 ? (
                <p className="text-text-muted dark:text-dark-text-muted text-sm">
                  This plugin has no external service requirements.
                </p>
              ) : (
                <>
                  {plugin.requiredServices.map((svc) => (
                    <div
                      key={svc.name}
                      className="flex items-center justify-between p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            svc.isConfigured ? 'bg-success' : 'bg-warning'
                          }`}
                        />
                        <div>
                          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                            {svc.displayName}
                          </p>
                          <p className="text-xs text-text-muted dark:text-dark-text-muted">
                            {svc.name}
                          </p>
                        </div>
                      </div>
                      <a
                        href="/settings/config-center"
                        className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        Configure
                      </a>
                    </div>
                  ))}
                  {plugin.requiredServices.every((s) => s.isConfigured) && (
                    <p className="text-sm text-success mt-2">
                      All required services are configured.
                    </p>
                  )}
                  {plugin.requiredServices.some((s) => !s.isConfigured) && (
                    <p className="text-sm text-warning mt-2">
                      Some services need configuration in Config Center.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-between">
          <button
            onClick={onToggle}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              isEnabled
                ? 'bg-error/10 text-error hover:bg-error/20'
                : 'bg-success/10 text-success hover:bg-success/20'
            }`}
          >
            <Power className="w-4 h-4" />
            {isEnabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
