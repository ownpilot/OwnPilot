import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import {
  Search, RefreshCw, ExternalLink, Unlink, AlertCircle, Check, Link,
} from '../components/icons';
import { composioApi } from '../api';
import type { ComposioApp, ComposioConnection } from '../api/endpoints/composio';

// =============================================================================
// Status helpers
// =============================================================================

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: 'bg-success/10', text: 'text-success', label: 'Active' },
  INITIATED: { bg: 'bg-warning/10', text: 'text-warning', label: 'Connecting...' },
  EXPIRED: { bg: 'bg-warning/10', text: 'text-warning', label: 'Expired' },
  FAILED: { bg: 'bg-error/10', text: 'text-error', label: 'Failed' },
  INACTIVE: { bg: 'bg-text-muted/10', text: 'text-text-muted', label: 'Inactive' },
};

const FALLBACK_STATUS = { bg: 'bg-text-muted/10', text: 'text-text-muted', label: 'Unknown' };

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? FALLBACK_STATUS;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${style.bg} ${style.text}`}>
      {status === 'ACTIVE' && <Check className="w-3 h-3" />}
      {status === 'FAILED' && <AlertCircle className="w-3 h-3" />}
      {style.label}
    </span>
  );
}

// =============================================================================
// Composio Connected App Card
// =============================================================================

function ConnectedAppCard({
  connection,
  onDisconnect,
  onRefresh,
  isRefreshing,
}: {
  connection: ComposioConnection;
  onDisconnect: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
          {connection.appName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-medium text-text-primary dark:text-dark-text-primary capitalize">
            {connection.appName}
          </div>
          <StatusBadge status={connection.status} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {connection.status === 'EXPIRED' && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
            title="Refresh connection"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
        <button
          onClick={onDisconnect}
          className="p-2 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
          title="Disconnect"
        >
          <Unlink className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Available Composio App Card
// =============================================================================

function AvailableAppCard({
  app,
  isConnecting,
  onConnect,
}: {
  app: ComposioApp;
  isConnecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center text-text-muted dark:text-dark-text-muted text-xs font-semibold">
          {app.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="font-medium text-text-primary dark:text-dark-text-primary text-sm">
          {app.name}
        </div>
      </div>
      {app.description && (
        <p className="text-xs text-text-muted dark:text-dark-text-muted mb-3 line-clamp-2">
          {app.description}
        </p>
      )}
      <button
        onClick={onConnect}
        disabled={isConnecting}
        className="mt-auto flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isConnecting ? (
          <RefreshCw className="w-3 h-3 animate-spin" />
        ) : (
          <Link className="w-3 h-3" />
        )}
        Connect
      </button>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function ConnectedAppsPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const [composioConfigured, setComposioConfigured] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [apps, setApps] = useState<ComposioApp[]>([]);
  const [search, setSearch] = useState('');
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // =========================================================================
  // Data loading
  // =========================================================================

  const loadData = useCallback(async () => {
    try {
      const status = await composioApi.status();
      setComposioConfigured(status.configured);
      if (status.configured) {
        try {
          const [connectionsData, appsData] = await Promise.all([
            composioApi.connections(),
            composioApi.apps(),
          ]);
          setConnections(connectionsData.connections);
          setApps(appsData.apps);
        } catch {
          // Composio data failed but page still works
        }
      }
    } catch {
      toast.error('Failed to load connected apps data');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle OAuth callback redirect
  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected) {
      toast.success(`Successfully connected ${connected}`);
      loadData();
    }
  }, [searchParams, toast, loadData]);

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleConnect = async (appSlug: string) => {
    setConnectingApp(appSlug);
    try {
      const result = await composioApi.connect(appSlug);
      if (result.redirectUrl) {
        window.open(result.redirectUrl, '_blank', 'width=600,height=700');
        toast.success(`OAuth window opened for ${appSlug}. Complete authorization to connect.`);
        setTimeout(() => loadData(), 5000);
        setTimeout(() => loadData(), 15000);
      } else {
        toast.success(`${appSlug} connected (status: ${result.status})`);
        await loadData();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnectingApp(null);
    }
  };

  const handleDisconnect = async (connectionId: string, appName: string) => {
    if (!await confirm({ message: `Disconnect ${appName}? You will need to re-authorize to use it again.`, variant: 'danger' })) {
      return;
    }
    try {
      await composioApi.disconnect(connectionId);
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
      toast.success(`${appName} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  const handleRefresh = async (connectionId: string) => {
    setRefreshingId(connectionId);
    try {
      await composioApi.refresh(connectionId);
      toast.success('Connection refreshed');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh connection');
    } finally {
      setRefreshingId(null);
    }
  };

  // =========================================================================
  // Derived state
  // =========================================================================

  const connectedSlugs = new Set(connections.map((c) => c.appName.toLowerCase()));
  const filteredApps = apps.filter((app) => {
    if (connectedSlugs.has(app.slug.toLowerCase())) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      app.name.toLowerCase().includes(q) ||
      app.slug.toLowerCase().includes(q) ||
      (app.description ?? '').toLowerCase().includes(q)
    );
  });

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-4 pb-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Connected Apps
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Manage 500+ app integrations via Composio
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {!isLoading && (
          <section>
            {/* Not configured warning */}
            {composioConfigured === false && (
              <div className="flex items-start gap-3 p-4 bg-warning/10 border border-warning/20 rounded-xl mb-4">
                <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-text-primary dark:text-dark-text-primary text-sm">
                    Composio API key not configured
                  </div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                    Set your Composio API key in{' '}
                    <a href="/settings/config-center" className="text-primary hover:underline">
                      Config Center
                    </a>{' '}
                    to connect 500+ apps. Get a free key at{' '}
                    <a
                      href="https://composio.dev"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      composio.dev <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                </div>
              </div>
            )}

            {/* Connected Apps */}
            {composioConfigured && connections.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2">
                  Connected ({connections.length})
                </div>
                <div className="space-y-2">
                  {connections.map((conn) => (
                    <ConnectedAppCard
                      key={conn.id}
                      connection={conn}
                      onDisconnect={() => handleDisconnect(conn.id, conn.appName)}
                      onRefresh={() => handleRefresh(conn.id)}
                      isRefreshing={refreshingId === conn.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Available Apps */}
            {composioConfigured && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                    Available Apps
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
                    <input
                      type="text"
                      placeholder="Search apps..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-48 pl-8 pr-3 py-1.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>
                {filteredApps.length === 0 ? (
                  <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
                    {search ? `No apps matching "${search}"` : 'No apps available'}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {filteredApps.slice(0, 50).map((app) => (
                      <AvailableAppCard
                        key={app.slug}
                        app={app}
                        isConnecting={connectingApp === app.slug}
                        onConnect={() => handleConnect(app.slug)}
                      />
                    ))}
                  </div>
                )}
                {filteredApps.length > 50 && (
                  <p className="text-xs text-text-muted dark:text-dark-text-muted text-center mt-3">
                    Showing 50 of {filteredApps.length} apps. Use search to find specific apps.
                  </p>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
