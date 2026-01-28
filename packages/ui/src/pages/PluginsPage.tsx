import { useState, useEffect } from 'react';
import { Puzzle, Power, Wrench, Shield, Lock, Check, X, RefreshCw } from '../components/icons';
import type { ApiResponse } from '../types';

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  status: 'installed' | 'enabled' | 'disabled' | 'error' | 'updating';
  capabilities: string[];
  permissions: string[];
  grantedPermissions: string[];
  toolCount: number;
  tools: string[];
  handlerCount: number;
  icon?: string;
  docs?: string;
  installedAt: string;
  updatedAt: string;
}

interface PluginStats {
  total: number;
  enabled: number;
  disabled: number;
  error: number;
  totalTools: number;
  totalHandlers: number;
  byCapability: Record<string, number>;
  byPermission: Record<string, number>;
}

const CAPABILITY_LABELS: Record<string, { label: string; color: string }> = {
  tools: { label: 'Tools', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  handlers: { label: 'Handlers', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400' },
  storage: { label: 'Storage', color: 'bg-amber-500/20 text-amber-600 dark:text-amber-400' },
  scheduled: { label: 'Scheduled', color: 'bg-green-500/20 text-green-600 dark:text-green-400' },
  notifications: { label: 'Notifications', color: 'bg-pink-500/20 text-pink-600 dark:text-pink-400' },
  ui: { label: 'UI', color: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400' },
  integrations: { label: 'Integrations', color: 'bg-orange-500/20 text-orange-600 dark:text-orange-400' },
};

const STATUS_COLORS: Record<string, string> = {
  enabled: 'bg-success/20 text-success',
  disabled: 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted',
  error: 'bg-error/20 text-error',
  installed: 'bg-primary/20 text-primary',
  updating: 'bg-warning/20 text-warning',
};

export function PluginsPage() {
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
      const response = await fetch('/api/v1/plugins');
      const data: ApiResponse<PluginInfo[]> = await response.json();
      if (data.success && data.data) {
        setPlugins(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch plugins:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/v1/plugins/stats');
      const data: ApiResponse<PluginStats> = await response.json();
      if (data.success && data.data) {
        setStats(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch plugin stats:', err);
    }
  };

  const togglePlugin = async (plugin: PluginInfo) => {
    const action = plugin.status === 'enabled' ? 'disable' : 'enable';
    try {
      const response = await fetch(`/api/v1/plugins/${plugin.id}/${action}`, {
        method: 'POST',
      });
      const data: ApiResponse = await response.json();
      if (data.success) {
        fetchPlugins();
        fetchStats();
      }
    } catch (err) {
      console.error(`Failed to ${action} plugin:`, err);
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
              <span className="font-medium text-text-primary dark:text-dark-text-primary">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-text-muted dark:text-dark-text-muted">Enabled:</span>
              <span className="font-medium text-success">{stats.enabled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="text-text-muted dark:text-dark-text-muted">Disabled:</span>
              <span className="font-medium text-text-secondary dark:text-dark-text-secondary">{stats.disabled}</span>
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
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading plugins...</p>
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Puzzle className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              No plugins {filter !== 'all' ? filter : 'installed'}
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted">
              {filter === 'all'
                ? 'Install plugins to extend your AI assistant.'
                : `No ${filter} plugins found.`}
            </p>
          </div>
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

  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-start justify-between mb-3">
        <button onClick={onClick} className="flex items-start gap-3 text-left flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {plugin.icon ? (
              <img src={plugin.icon} alt="" className="w-6 h-6" />
            ) : (
              <Puzzle className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
              {plugin.name}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              v{plugin.version}
            </p>
          </div>
        </button>
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

      <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3">
        {plugin.description}
      </p>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {plugin.capabilities.map((cap) => {
          const capInfo = CAPABILITY_LABELS[cap] || { label: cap, color: 'bg-gray-500/20 text-gray-600' };
          return (
            <span
              key={cap}
              className={`px-2 py-0.5 text-xs rounded-full ${capInfo.color}`}
            >
              {capInfo.label}
            </span>
          );
        })}
      </div>

      {/* Status & Stats */}
      <div className="flex items-center justify-between text-xs">
        <span className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[plugin.status] || STATUS_COLORS.disabled}`}>
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
              {plugin.grantedPermissions.length}/{plugin.permissions.length}
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
}

function PluginDetailModal({ plugin, onClose, onToggle }: PluginDetailModalProps) {
  const isEnabled = plugin.status === 'enabled';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                {plugin.icon ? (
                  <img src={plugin.icon} alt="" className="w-8 h-8" />
                ) : (
                  <Puzzle className="w-6 h-6 text-primary" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                  {plugin.name}
                </h3>
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  v{plugin.version}
                  {plugin.author && ` by ${plugin.author.name}`}
                </p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm ${STATUS_COLORS[plugin.status] || STATUS_COLORS.disabled}`}>
              {plugin.status}
            </span>
          </div>
          <p className="mt-4 text-text-secondary dark:text-dark-text-secondary">
            {plugin.description}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Capabilities */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Capabilities
            </h4>
            <div className="flex flex-wrap gap-2">
              {plugin.capabilities.map((cap) => {
                const capInfo = CAPABILITY_LABELS[cap] || { label: cap, color: 'bg-gray-500/20 text-gray-600' };
                return (
                  <span
                    key={cap}
                    className={`px-3 py-1 text-sm rounded-full ${capInfo.color}`}
                  >
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

          {/* Permissions */}
          {plugin.permissions.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Permissions
              </h4>
              <div className="space-y-2">
                {plugin.permissions.map((perm) => {
                  const isGranted = plugin.grantedPermissions.includes(perm);
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
                  {new Date(plugin.updatedAt).toLocaleDateString()}
                </p>
              </div>
              {plugin.author?.email && (
                <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <span className="text-text-muted dark:text-dark-text-muted">Author Email</span>
                  <p className="text-text-primary dark:text-dark-text-primary truncate">
                    {plugin.author.email}
                  </p>
                </div>
              )}
              {plugin.docs && (
                <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <span className="text-text-muted dark:text-dark-text-muted">Documentation</span>
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
