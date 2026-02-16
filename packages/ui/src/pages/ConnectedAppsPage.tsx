import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import {
  Search, RefreshCw, ExternalLink, Unlink, AlertCircle, Check, Link, Trash2,
} from '../components/icons';
import { composioApi, integrationsApi, authApi } from '../api';
import type { ComposioApp, ComposioConnection } from '../api/endpoints/composio';
import type { Integration, AvailableIntegration, OAuthConfig } from '../types';

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

/** Map Google OAuth statuses to the shared status key format */
function normalizeGoogleStatus(status: Integration['status']): string {
  switch (status) {
    case 'active': return 'ACTIVE';
    case 'expired': return 'EXPIRED';
    case 'error': return 'FAILED';
    case 'revoked': return 'INACTIVE';
    default: return 'INACTIVE';
  }
}

const SERVICE_ICONS: Record<string, string> = {
  gmail: '\u{1F4E7}',
  calendar: '\u{1F4C5}',
  drive: '\u{1F4C1}',
};

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
// Google Connected Service Card
// =============================================================================

function GoogleServiceCard({
  integration,
  onDisconnect,
  onSync,
  isSyncing,
}: {
  integration: Integration;
  onDisconnect: () => void;
  onSync: () => void;
  isSyncing: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-lg">
          {SERVICE_ICONS[integration.service] ?? '\u{1F517}'}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary dark:text-dark-text-primary capitalize">
              {integration.service}
            </span>
            <StatusBadge status={normalizeGoogleStatus(integration.status)} />
          </div>
          {integration.email && (
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {integration.email}
            </p>
          )}
          {integration.errorMessage && (
            <p className="text-xs text-error">{integration.errorMessage}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="p-2 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          title="Sync / Refresh token"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>
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

  // -- Composio state --
  const [composioConfigured, setComposioConfigured] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [apps, setApps] = useState<ComposioApp[]>([]);
  const [search, setSearch] = useState('');
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // -- Google OAuth state --
  const [googleIntegrations, setGoogleIntegrations] = useState<Integration[]>([]);
  const [googleAvailable, setGoogleAvailable] = useState<AvailableIntegration[]>([]);
  const [googleConfigStatus, setGoogleConfigStatus] = useState<{ configured: boolean; redirectUri?: string } | null>(null);
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig>({ clientId: '', clientSecret: '', redirectUri: '' });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // -- Shared state --
  const [isLoading, setIsLoading] = useState(true);

  // =========================================================================
  // Data loading
  // =========================================================================

  const loadData = useCallback(async () => {
    try {
      // Load Google and Composio data in parallel
      const [composioStatus, integrationsList, availableList, authStatus] = await Promise.allSettled([
        composioApi.status(),
        integrationsApi.list(),
        integrationsApi.available(),
        authApi.status(),
      ]);

      // Composio
      if (composioStatus.status === 'fulfilled') {
        setComposioConfigured(composioStatus.value.configured);
        if (composioStatus.value.configured) {
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
      }

      // Google
      if (integrationsList.status === 'fulfilled') setGoogleIntegrations(integrationsList.value);
      if (availableList.status === 'fulfilled') setGoogleAvailable(availableList.value);
      if (authStatus.status === 'fulfilled') setGoogleConfigStatus(authStatus.value.google);
    } catch {
      toast.error('Failed to load connected apps data');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle OAuth callback redirect (Composio or Google)
  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthSuccess = searchParams.get('oauth_success');
    if (connected) {
      toast.success(`Successfully connected ${connected}`);
      loadData();
    }
    if (oauthSuccess) {
      toast.success(`Successfully connected ${oauthSuccess}`);
      loadData();
    }
  }, [searchParams, toast, loadData]);

  // =========================================================================
  // Google OAuth handlers
  // =========================================================================

  const handleSaveOAuthConfig = async () => {
    if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
      toast.error('Client ID and Client Secret are required');
      return;
    }
    setIsSavingConfig(true);
    try {
      await authApi.saveGoogleConfig(oauthConfig);
      setShowGoogleConfig(false);
      setOauthConfig({ clientId: '', clientSecret: '', redirectUri: '' });
      toast.success('OAuth configuration saved');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save OAuth configuration');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleDeleteOAuthConfig = async () => {
    if (!await confirm({ message: 'Remove Google OAuth configuration? All connected Google services will stop working.', variant: 'danger' })) {
      return;
    }
    try {
      await authApi.deleteGoogleConfig();
      toast.success('OAuth configuration removed');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove OAuth configuration');
    }
  };

  const handleGoogleConnect = (provider: string, service: string) => {
    const returnUrl = '/settings/connected-apps';
    window.location.href = authApi.startUrl(provider, service, returnUrl);
  };

  const handleGoogleDisconnect = async (integrationId: string, service: string) => {
    if (!await confirm({ message: `Disconnect ${service}? You will need to re-authorize to use it again.`, variant: 'danger' })) {
      return;
    }
    try {
      await integrationsApi.delete(integrationId);
      setGoogleIntegrations((prev) => prev.filter((i) => i.id !== integrationId));
      toast.success(`${service} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  const handleGoogleSync = async (integrationId: string) => {
    setSyncingId(integrationId);
    try {
      await integrationsApi.sync(integrationId);
      toast.success('Token refreshed');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync');
    } finally {
      setSyncingId(null);
    }
  };

  // =========================================================================
  // Composio handlers
  // =========================================================================

  const handleComposioConnect = async (appSlug: string) => {
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

  const handleComposioDisconnect = async (connectionId: string, appName: string) => {
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

  const handleComposioRefresh = async (connectionId: string) => {
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

  const googleConnectedServices = new Set(
    googleIntegrations.filter((i) => i.status === 'active').map((i) => `${i.provider}:${i.service}`),
  );
  const googleUnconnected = googleAvailable.filter(
    (a) => !googleConnectedServices.has(`${a.provider}:${a.service}`),
  );

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
              Manage Google services and 500+ Composio app integrations
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

        {/* ================================================================= */}
        {/* Google Services Section                                           */}
        {/* ================================================================= */}
        {!isLoading && (
          <section>
            <h3 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider mb-4">
              Google Services
            </h3>

            {/* OAuth Configuration Card */}
            <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text-primary dark:text-dark-text-primary text-sm">
                    Google OAuth Configuration
                  </div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    Required to connect Gmail, Calendar, and Drive
                  </p>
                </div>
                {googleConfigStatus?.configured ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-success flex items-center gap-1">
                      <Check className="w-3 h-3" /> Configured
                    </span>
                    <button
                      onClick={handleDeleteOAuthConfig}
                      className="p-1.5 text-error/60 hover:text-error rounded"
                      title="Remove configuration"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowGoogleConfig(!showGoogleConfig)}
                    className="px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    Configure
                  </button>
                )}
              </div>

              {showGoogleConfig && (
                <div className="space-y-4 pt-4 mt-4 border-t border-border dark:border-dark-border">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                      Client ID
                    </label>
                    <input
                      type="text"
                      value={oauthConfig.clientId}
                      onChange={(e) => setOauthConfig((prev) => ({ ...prev, clientId: e.target.value }))}
                      placeholder="123456789-xxxxx.apps.googleusercontent.com"
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                      Client Secret
                    </label>
                    <input
                      type="password"
                      value={oauthConfig.clientSecret}
                      onChange={(e) => setOauthConfig((prev) => ({ ...prev, clientSecret: e.target.value }))}
                      placeholder="GOCSPX-xxxxxxxxxxxxx"
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                      Redirect URI (optional)
                    </label>
                    <input
                      type="text"
                      value={oauthConfig.redirectUri}
                      onChange={(e) => setOauthConfig((prev) => ({ ...prev, redirectUri: e.target.value }))}
                      placeholder={googleConfigStatus?.redirectUri || 'Auto-detected'}
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                      Add this URL to your Google Cloud Console authorized redirect URIs
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveOAuthConfig}
                      disabled={isSavingConfig}
                      className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                    </button>
                    <button
                      onClick={() => setShowGoogleConfig(false)}
                      className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary text-sm rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                    >
                      Cancel
                    </button>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Google Cloud Console <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Connected Google Services */}
            {googleIntegrations.length > 0 && (
              <div className="space-y-2 mb-4">
                {googleIntegrations.map((integration) => (
                  <GoogleServiceCard
                    key={integration.id}
                    integration={integration}
                    onDisconnect={() => handleGoogleDisconnect(integration.id, integration.service)}
                    onSync={() => handleGoogleSync(integration.id)}
                    isSyncing={syncingId === integration.id}
                  />
                ))}
              </div>
            )}

            {/* Available Google Services */}
            {googleConfigStatus?.configured && googleUnconnected.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {googleUnconnected.map((avail) => (
                  <div
                    key={`${avail.provider}-${avail.service}`}
                    className="flex flex-col p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg">{SERVICE_ICONS[avail.service] ?? '\u{1F517}'}</span>
                      <div className="font-medium text-text-primary dark:text-dark-text-primary text-sm">
                        {avail.name}
                      </div>
                    </div>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mb-3 line-clamp-2">
                      {avail.description}
                    </p>
                    <button
                      onClick={() => handleGoogleConnect(avail.provider, avail.service)}
                      className="mt-auto flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      <Link className="w-3 h-3" />
                      Connect
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!googleConfigStatus?.configured && !showGoogleConfig && googleIntegrations.length === 0 && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Configure Google OAuth above to connect Gmail, Calendar, and Drive.
              </p>
            )}
          </section>
        )}

        {/* ================================================================= */}
        {/* Composio Apps Section                                             */}
        {/* ================================================================= */}
        {!isLoading && (
          <section>
            <h3 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider mb-4">
              Composio Apps
            </h3>

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

            {/* Connected Composio Apps */}
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
                      onDisconnect={() => handleComposioDisconnect(conn.id, conn.appName)}
                      onRefresh={() => handleComposioRefresh(conn.id)}
                      isRefreshing={refreshingId === conn.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Available Composio Apps */}
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
                        onConnect={() => handleComposioConnect(app.slug)}
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
