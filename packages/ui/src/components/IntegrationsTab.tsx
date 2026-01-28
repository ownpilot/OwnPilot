import { useState, useEffect } from 'react';
import { Check, AlertCircle, ExternalLink, Trash2, RefreshCw, Link, Unlink } from './icons';

interface Integration {
  id: string;
  provider: string;
  service: string;
  email?: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  scopes: string[];
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface AvailableIntegration {
  provider: string;
  service: string;
  name: string;
  description: string;
  icon: string;
  requiredConfig: string[];
  isConfigured: boolean;
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [available, setAvailable] = useState<AvailableIntegration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig>({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configStatus, setConfigStatus] = useState<{
    configured: boolean;
    redirectUri?: string;
  } | null>(null);

  useEffect(() => {
    loadData();
    checkOAuthStatus();
  }, []);

  const loadData = async () => {
    try {
      const [integrationsRes, availableRes] = await Promise.all([
        fetch('/api/v1/integrations'),
        fetch('/api/v1/integrations/available'),
      ]);

      const integrationsData = await integrationsRes.json();
      if (integrationsData.success) {
        setIntegrations(integrationsData.data);
      }

      const availableData = await availableRes.json();
      if (availableData.success) {
        setAvailable(availableData.data);
      }
    } catch (err) {
      console.error('Failed to load integrations:', err);
      setError('Failed to load integrations');
    } finally {
      setIsLoading(false);
    }
  };

  const checkOAuthStatus = async () => {
    try {
      const res = await fetch('/api/v1/auth/status');
      const data = await res.json();
      if (data.success) {
        setConfigStatus(data.data.google);
      }
    } catch (err) {
      console.error('Failed to check OAuth status:', err);
    }
  };

  const handleConnect = (provider: string, service: string) => {
    // Redirect to OAuth flow
    const returnUrl = encodeURIComponent(window.location.pathname + '?tab=integrations');
    window.location.href = `/api/v1/auth/${provider}/start?service=${service}&returnUrl=${returnUrl}`;
  };

  const handleDisconnect = async (integrationId: string) => {
    if (!confirm('Are you sure you want to disconnect this integration?')) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/integrations/${integrationId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setIntegrations((prev) => prev.filter((i) => i.id !== integrationId));
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to disconnect');
      }
    } catch (err) {
      setError('Failed to disconnect integration');
    }
  };

  const handleSync = async (integrationId: string) => {
    setSyncingId(integrationId);
    try {
      const res = await fetch(`/api/v1/integrations/${integrationId}/sync`, {
        method: 'POST',
      });

      if (res.ok) {
        await loadData();
      } else {
        const data = await res.json();
        setError(data.error || 'Sync failed');
      }
    } catch (err) {
      setError('Failed to sync integration');
    } finally {
      setSyncingId(null);
    }
  };

  const handleSaveOAuthConfig = async () => {
    if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
      setError('Client ID and Client Secret are required');
      return;
    }

    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/v1/auth/config/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(oauthConfig),
      });

      if (res.ok) {
        setShowConfig(false);
        setOauthConfig({ clientId: '', clientSecret: '', redirectUri: '' });
        await checkOAuthStatus();
        await loadData();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save configuration');
      }
    } catch (err) {
      setError('Failed to save OAuth configuration');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleDeleteOAuthConfig = async () => {
    if (!confirm('Are you sure you want to remove the Google OAuth configuration?')) {
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/config/google', {
        method: 'DELETE',
      });

      if (res.ok) {
        await checkOAuthStatus();
        await loadData();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to remove configuration');
      }
    } catch (err) {
      setError('Failed to remove OAuth configuration');
    }
  };

  const getStatusBadge = (status: Integration['status']) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-success/10 text-success rounded-full">
            <Check className="w-3 h-3" /> Active
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning rounded-full">
            <AlertCircle className="w-3 h-3" /> Expired
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-error/10 text-error rounded-full">
            <AlertCircle className="w-3 h-3" /> Error
          </span>
        );
      case 'revoked':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-500/10 text-gray-500 rounded-full">
            Revoked
          </span>
        );
    }
  };

  const getServiceIcon = (service: string) => {
    switch (service) {
      case 'gmail':
        return '📧';
      case 'calendar':
        return '📅';
      case 'drive':
        return '📁';
      default:
        return '🔗';
    }
  };

  const isServiceConnected = (provider: string, service: string) => {
    return integrations.some(
      (i) => i.provider === provider && i.service === service && i.status === 'active'
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted dark:text-dark-text-muted">Loading integrations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error message */}
      {error && (
        <div className="p-4 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-error/60 hover:text-error"
          >
            &times;
          </button>
        </div>
      )}

      {/* OAuth Configuration Section */}
      <section className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary">
              Google OAuth Configuration
            </h3>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Required to connect Gmail, Calendar, and Drive
            </p>
          </div>
          {configStatus?.configured ? (
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
              onClick={() => setShowConfig(!showConfig)}
              className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark transition-colors"
            >
              Configure
            </button>
          )}
        </div>

        {showConfig && (
          <div className="space-y-4 pt-4 border-t border-border dark:border-dark-border">
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
                onChange={(e) =>
                  setOauthConfig((prev) => ({ ...prev, clientSecret: e.target.value }))
                }
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
                onChange={(e) =>
                  setOauthConfig((prev) => ({ ...prev, redirectUri: e.target.value }))
                }
                placeholder={configStatus?.redirectUri || 'Auto-detected'}
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
                className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {isSavingConfig ? 'Saving...' : 'Save Configuration'}
              </button>
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary text-sm rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Google Cloud Console <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Connected Integrations */}
      {integrations.length > 0 && (
        <section>
          <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
            Connected Integrations
          </h3>
          <div className="space-y-3">
            {integrations.map((integration) => (
              <div
                key={integration.id}
                className={`p-4 rounded-lg border ${
                  integration.status === 'active'
                    ? 'border-success/30 bg-success/5'
                    : integration.status === 'error'
                      ? 'border-error/30 bg-error/5'
                      : 'border-warning/30 bg-warning/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getServiceIcon(integration.service)}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary dark:text-dark-text-primary capitalize">
                          {integration.service}
                        </span>
                        {getStatusBadge(integration.status)}
                      </div>
                      {integration.email && (
                        <p className="text-sm text-text-muted dark:text-dark-text-muted">
                          {integration.email}
                        </p>
                      )}
                      {integration.errorMessage && (
                        <p className="text-sm text-error">{integration.errorMessage}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSync(integration.id)}
                      disabled={syncingId === integration.id}
                      className="p-2 text-text-muted dark:text-dark-text-muted hover:text-primary rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-50"
                      title="Sync / Refresh Token"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${syncingId === integration.id ? 'animate-spin' : ''}`}
                      />
                    </button>
                    <button
                      onClick={() => handleDisconnect(integration.id)}
                      className="p-2 text-text-muted dark:text-dark-text-muted hover:text-error rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                      title="Disconnect"
                    >
                      <Unlink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Available Integrations */}
      <section>
        <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
          Available Integrations
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          {available.map((integration) => {
            const isConnected = isServiceConnected(integration.provider, integration.service);

            return (
              <div
                key={`${integration.provider}-${integration.service}`}
                className={`p-4 rounded-lg border ${
                  isConnected
                    ? 'border-success/30 bg-success/5'
                    : 'border-border dark:border-dark-border'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-1">{getServiceIcon(integration.service)}</span>
                    <div>
                      <h4 className="font-medium text-text-primary dark:text-dark-text-primary">
                        {integration.name}
                      </h4>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        {integration.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {isConnected ? (
                    <span className="text-xs text-success flex items-center gap-1">
                      <Check className="w-3 h-3" /> Connected
                    </span>
                  ) : integration.isConfigured ? (
                    <button
                      onClick={() => handleConnect(integration.provider, integration.service)}
                      className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark transition-colors flex items-center gap-1"
                    >
                      <Link className="w-3 h-3" /> Connect
                    </button>
                  ) : (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      Configure OAuth first
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
