/**
 * ProviderAuthPanel — OAuth 2.0 device-code sign-in for LLM providers.
 *
 * Lists every catalog provider, shows which can do OAuth, and surfaces
 * a sign-in button that drives the RFC 8628 device-code flow:
 *
 *   1. Click "Sign in" → gateway returns user_code + verification URL.
 *   2. Panel pops the URL in a new tab AND displays the user_code so the
 *      user can paste it on the verification page.
 *   3. Panel polls the gateway every `intervalSec` (server-recommended)
 *      until success / denial / expiry.
 *   4. On success the provider's `storedMethod` flips to oauth2_device_code
 *      and the "Sign in" button becomes "Sign out".
 *
 * Token values never cross the network back to the browser — only the
 * method label is reported.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  providerAuthApi,
  type DeviceFlowStart,
  type ProviderAuthInfo,
  type ProviderOAuthOverride,
} from '../../api/endpoints/providerAuth';
import { useToast } from '../../components/ToastProvider';
import { Check, ExternalLink, Key, LogOut, RefreshCw, Settings } from '../../components/icons';

type FlowState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | {
      kind: 'awaiting';
      start: DeviceFlowStart;
      provider: string;
      intervalSec: number;
      expiresAtMs: number;
    }
  | { kind: 'polling'; provider: string };

interface ConfigDialogState {
  provider: string;
  form: ProviderOAuthOverride;
  saving: boolean;
}

export function ProviderAuthPanel() {
  const toast = useToast();
  const [entries, setEntries] = useState<ProviderAuthInfo[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [flow, setFlow] = useState<FlowState>({ kind: 'idle' });
  const [showOnlyOAuth, setShowOnlyOAuth] = useState(true);
  const [configDialog, setConfigDialog] = useState<ConfigDialogState | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await providerAuthApi.listProviders();
      setEntries(data.providers);
    } catch {
      toast.error('Failed to load provider auth state');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const cancelPollTimer = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => () => cancelPollTimer(), []);

  const pollOnce = useCallback(
    async (provider: string, intervalSec: number, expiresAtMs: number) => {
      if (Date.now() > expiresAtMs) {
        toast.error('Device code expired before authorization completed');
        setFlow({ kind: 'idle' });
        await fetchEntries();
        return;
      }

      try {
        const result = await providerAuthApi.pollDeviceFlow(provider);
        if (result.status === 'success') {
          toast.success(`Signed in to ${provider}`);
          setFlow({ kind: 'idle' });
          await fetchEntries();
          return;
        }
        if (result.status === 'pending') {
          const nextInterval = result.intervalSec ?? intervalSec;
          pollTimerRef.current = window.setTimeout(() => {
            pollOnce(provider, nextInterval, expiresAtMs);
          }, nextInterval * 1000);
          return;
        }
        if (result.status === 'expired') {
          toast.error('Device code expired');
        } else if (result.status === 'denied') {
          toast.error(`Sign-in denied${result.reason ? `: ${result.reason}` : ''}`);
        } else {
          toast.error(`Sign-in failed${result.reason ? `: ${result.reason}` : ''}`);
        }
        setFlow({ kind: 'idle' });
        await fetchEntries();
      } catch {
        toast.error('Polling failed');
        setFlow({ kind: 'idle' });
      }
    },
    [fetchEntries, toast]
  );

  const openConfigDialog = useCallback(async (provider: string) => {
    setConfigDialog({ provider, form: {}, saving: false });
    try {
      const { override } = await providerAuthApi.getConfig(provider);
      setConfigDialog((prev) =>
        prev && prev.provider === provider
          ? { provider, form: override ?? {}, saving: false }
          : prev
      );
    } catch {
      // Empty form is fine — user can fill it in fresh.
    }
  }, []);

  const updateConfigField = useCallback(
    (field: keyof ProviderOAuthOverride, value: string | string[] | undefined) => {
      setConfigDialog((prev) =>
        prev ? { ...prev, form: { ...prev.form, [field]: value } } : prev
      );
    },
    []
  );

  const handleConfigSave = useCallback(async () => {
    if (!configDialog) return;
    setConfigDialog((prev) => (prev ? { ...prev, saving: true } : prev));
    try {
      await providerAuthApi.setConfig(configDialog.provider, configDialog.form);
      toast.success(`Saved OAuth config for ${configDialog.provider}`);
      setConfigDialog(null);
      await fetchEntries();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save config';
      toast.error(message);
      setConfigDialog((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  }, [configDialog, fetchEntries, toast]);

  const handleConfigClear = useCallback(async () => {
    if (!configDialog) return;
    try {
      await providerAuthApi.clearConfig(configDialog.provider);
      toast.success(`Cleared OAuth config for ${configDialog.provider}`);
      setConfigDialog(null);
      await fetchEntries();
    } catch {
      toast.error('Failed to clear config');
    }
  }, [configDialog, fetchEntries, toast]);

  const handleStart = useCallback(
    async (provider: string) => {
      cancelPollTimer();
      setFlow({ kind: 'starting' });
      try {
        const start = await providerAuthApi.startDeviceFlow(provider);
        const expiresAtMs = Date.now() + start.expiresIn * 1000;
        setFlow({
          kind: 'awaiting',
          start,
          provider,
          intervalSec: start.interval,
          expiresAtMs,
        });
        // Pop the verification URL automatically so the user doesn't have
        // to copy it. Prefer the "complete" variant which embeds user_code.
        const target = start.verificationUriComplete ?? start.verificationUri;
        window.open(target, '_blank', 'noopener,noreferrer');
        pollTimerRef.current = window.setTimeout(() => {
          pollOnce(provider, start.interval, expiresAtMs);
        }, start.interval * 1000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start sign-in';
        toast.error(message);
        setFlow({ kind: 'idle' });
      }
    },
    [pollOnce, toast]
  );

  const handleCancel = useCallback(() => {
    cancelPollTimer();
    setFlow({ kind: 'idle' });
  }, []);

  const handleSignOut = useCallback(
    async (provider: string) => {
      try {
        await providerAuthApi.signOut(provider);
        toast.success(`Signed out of ${provider}`);
        await fetchEntries();
      } catch {
        toast.error('Sign-out failed');
      }
    },
    [fetchEntries, toast]
  );

  if (isLoading) {
    return (
      <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
        Loading providers...
      </p>
    );
  }

  const visible = (entries ?? []).filter((e) => (showOnlyOAuth ? e.oauthCapable : true));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Sign in with your provider account to use models without an API key. The token is stored
          gateway-side and refreshed automatically.
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted dark:text-dark-text-muted flex items-center gap-1">
            <input
              type="checkbox"
              checked={showOnlyOAuth}
              onChange={(e) => setShowOnlyOAuth(e.target.checked)}
            />
            OAuth-capable only
          </label>
          <button
            onClick={fetchEntries}
            className="text-xs text-primary hover:underline flex items-center gap-1"
            aria-label="Refresh provider list"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {flow.kind === 'awaiting' && (
        <div className="border border-primary rounded-lg p-4 bg-primary/5 space-y-2">
          <p className="text-sm font-medium">Awaiting authorization for {flow.provider}</p>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Enter this code on the verification page:
          </p>
          <p className="font-mono text-2xl tracking-widest text-text-primary dark:text-dark-text-primary">
            {flow.start.userCode}
          </p>
          <div className="flex items-center gap-2 text-xs">
            <a
              href={flow.start.verificationUriComplete ?? flow.start.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Open verification page
            </a>
            <span>·</span>
            <button
              onClick={handleCancel}
              className="text-text-muted dark:text-dark-text-muted hover:text-danger"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          {showOnlyOAuth ? 'No OAuth-capable providers configured yet.' : 'No providers found.'}
        </p>
      ) : (
        <ul className="divide-y divide-border dark:divide-dark-border border border-border dark:border-dark-border rounded-lg overflow-hidden">
          {visible.map((entry) => {
            const isSignedIn = entry.storedMethod !== undefined;
            const isOAuth =
              entry.storedMethod === 'oauth2_device_code' || entry.storedMethod === 'oauth2_pkce';
            const busy =
              (flow.kind === 'starting' || flow.kind === 'awaiting') &&
              flow.kind === 'awaiting' &&
              flow.provider === entry.provider;
            return (
              <li
                key={entry.provider}
                className="px-3 py-2 flex items-center gap-3 text-sm hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {entry.provider}
                    </span>
                    {entry.oauthCapable && (
                      <span className="text-xs text-primary border border-primary/40 rounded px-1.5">
                        OAuth
                      </span>
                    )}
                    {isSignedIn && (
                      <span className="text-xs text-success flex items-center gap-0.5">
                        <Check className="w-3 h-3" />
                        {entry.storedMethod}
                      </span>
                    )}
                  </div>
                  {entry.expiresAt && (
                    <div className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                      Token expires {new Date(entry.expiresAt).toLocaleString()}
                    </div>
                  )}
                </div>

                {entry.oauthCapable && !isOAuth && entry.oauthReady && (
                  <button
                    onClick={() => handleStart(entry.provider)}
                    disabled={busy || flow.kind === 'awaiting' || flow.kind === 'starting'}
                    className="px-2 py-1 text-xs rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50 flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    Sign in
                  </button>
                )}
                {entry.oauthCapable && !isOAuth && !entry.oauthReady && (
                  <span
                    className="text-xs text-warning border border-warning/40 rounded px-1.5"
                    title="Catalog declares OAuth but missing required fields — click Configure to add your own OAuth app credentials"
                  >
                    Needs config
                  </span>
                )}
                {isSignedIn && (
                  <button
                    onClick={() => handleSignOut(entry.provider)}
                    className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border hover:bg-danger/10 hover:text-danger flex items-center gap-1"
                  >
                    <LogOut className="w-3 h-3" />
                    Sign out
                  </button>
                )}
                <button
                  onClick={() => openConfigDialog(entry.provider)}
                  className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary flex items-center gap-1"
                  title="Configure OAuth app (deviceCodeUrl, clientId, scopes...)"
                >
                  <Settings className="w-3 h-3" />
                  Configure
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {configDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !configDialog.saving && setConfigDialog(null)}
        >
          <div
            className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg p-5 max-w-lg w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              OAuth app config — {configDialog.provider}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Bring your own OAuth app. Empty fields fall back to the built-in catalog values.
              Required for sign-in: device code URL, token URL, and client ID.
            </p>
            <div className="space-y-2 text-xs">
              {[
                {
                  key: 'deviceCodeUrl' as const,
                  label: 'Device code URL',
                  ph: 'https://github.com/login/device/code',
                },
                {
                  key: 'tokenUrl' as const,
                  label: 'Token URL',
                  ph: 'https://github.com/login/oauth/access_token',
                },
                {
                  key: 'authorizationUrl' as const,
                  label: 'Authorization URL (PKCE only)',
                  ph: '',
                },
                { key: 'clientId' as const, label: 'Client ID', ph: 'your-app-client-id' },
              ].map((field) => (
                <label key={field.key} className="block">
                  <span className="block text-text-muted dark:text-dark-text-muted mb-0.5">
                    {field.label}
                  </span>
                  <input
                    type="text"
                    value={configDialog.form[field.key] ?? ''}
                    placeholder={field.ph}
                    onChange={(e) => updateConfigField(field.key, e.target.value || undefined)}
                    className="w-full px-2 py-1 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
                  />
                </label>
              ))}
              <label className="block">
                <span className="block text-text-muted dark:text-dark-text-muted mb-0.5">
                  Scopes (space-separated)
                </span>
                <input
                  type="text"
                  value={configDialog.form.scopes?.join(' ') ?? ''}
                  placeholder="read:user models"
                  onChange={(e) => {
                    const parts = e.target.value
                      .split(/\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    updateConfigField('scopes', parts.length > 0 ? parts : undefined);
                  }}
                  className="w-full px-2 py-1 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
                />
              </label>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <button
                onClick={handleConfigClear}
                disabled={configDialog.saving}
                className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border hover:bg-danger/10 hover:text-danger disabled:opacity-50"
              >
                Clear override
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfigDialog(null)}
                  disabled={configDialog.saving}
                  className="px-3 py-1 text-xs rounded border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfigSave}
                  disabled={configDialog.saving}
                  className="px-3 py-1 text-xs rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {configDialog.saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
