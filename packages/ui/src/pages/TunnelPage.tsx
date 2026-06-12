/**
 * TunnelPage — Cloudflare Tunnel management UI
 *
 * 3-step wizard:
 *   configure → starting → active
 * plus error and stopped states.
 */

import { useState, useEffect, useCallback } from 'react';
import { Copy, RefreshCw, ExternalLink, Shield, Wifi, WifiOff } from 'lucide-react';
import { tunnelApi } from '../api';
import type { TunnelStatus } from '../api';
import { useTunnelSubscription } from '../hooks/useTunnelSubscription';
import { ignoreError } from '../utils/ignore-error';

type WizardState = 'configure' | 'starting' | 'active' | 'stopped' | 'error';

export function TunnelPage() {
  // Wizard state
  const [wizardState, setWizardState] = useState<WizardState>('configure');

  // Config form
  const [port, setPort] = useState('8080');
  const [password, setPassword] = useState('');
  const [hostname, setHostname] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tunnel state
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStatusUpdate = useCallback(
    (data: {
      status: string;
      url?: string | null;
      error?: string | null;
      startedAt?: string | null;
    }) => {
      const s = data as TunnelStatus;
      setStatus(s);
      if (s.status === 'running' && s.url) {
        setUrl(s.url);
        setWizardState('active');
      } else if (s.status === 'stopped') {
        setWizardState('stopped');
        setUrl(null);
      } else if (s.status === 'error') {
        setErrorMsg(s.error ?? 'Unknown error');
        setWizardState('error');
      } else if (s.status === 'starting') {
        setWizardState('starting');
      }
    },
    []
  );

  const handleUrlUpdate = useCallback((newUrl: string) => {
    setUrl(newUrl);
  }, []);

  useTunnelSubscription(handleStatusUpdate, handleUrlUpdate);

  // Load initial status
  const loadStatus = useCallback(async () => {
    try {
      const s = await tunnelApi.getStatus();
      setStatus(s);
      if (s.status === 'running' && s.url) {
        setUrl(s.url);
        setWizardState('active');
        if (s.startedAt) {
          setPort(s.url.match(/:(\d+)\//)?.[1] ?? '8080');
        }
      } else if (s.status === 'stopped') {
        setWizardState('stopped');
      } else if (s.status === 'error') {
        setErrorMsg(s.error ?? 'Unknown error');
        setWizardState('error');
      }
    } catch {
      // Gateway may not have tunnel service initialized yet
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleStart = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    setWizardState('starting');

    try {
      await tunnelApi.configure({ port: parseInt(port, 10), hostname: hostname || undefined });
      const result = await tunnelApi.start(password || undefined);
      if (result.url) {
        setUrl(result.url);
        setWizardState('active');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setWizardState('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = async () => {
    try {
      await tunnelApi.stop();
      setWizardState('stopped');
      setUrl(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyUrl = () => {
    if (url) ignoreError(navigator.clipboard.writeText(url), 'clipboard.copyTunnelUrl');
  };

  // ---- Render helpers ----

  function StatusBadge({ state }: { state: WizardState }) {
    const config: Record<WizardState, { label: string; color: string; icon: React.ReactNode }> = {
      configure: {
        label: 'Not Connected',
        color: 'text-text-muted',
        icon: <WifiOff className="w-4 h-4" />,
      },
      starting: {
        label: 'Connecting...',
        color: 'text-blue-500',
        icon: <RefreshCw className="w-4 h-4 animate-spin" />,
      },
      active: { label: 'Connected', color: 'text-emerald-500', icon: <Wifi className="w-4 h-4" /> },
      stopped: {
        label: 'Stopped',
        color: 'text-text-muted',
        icon: <WifiOff className="w-4 h-4" />,
      },
      error: { label: 'Error', color: 'text-red-500', icon: <WifiOff className="w-4 h-4" /> },
    };
    const c = config[state];
    return (
      <div className={`flex items-center gap-2 ${c.color}`}>
        {c.icon}
        <span className="text-sm font-medium">{c.label}</span>
      </div>
    );
  }

  // ---- Configure Step ----

  function ConfigureStep() {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card-elevated p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <ExternalLink className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
                Cloudflare Tunnel
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Expose your gateway to the internet without port forwarding
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Local Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:border-primary"
                placeholder="8080"
                min="1"
                max="65535"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                The port your OwnPilot gateway is running on
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Password <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:border-primary"
                  placeholder="Leave empty for no authentication"
                />
                <Shield className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
              </div>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                Enables Basic Auth — browser will prompt for credentials
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Custom Hostname <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:border-primary"
                placeholder="tunnel.example.com"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                Requires Cloudflare account with a configured DNS zone
              </p>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleStart}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              Start Tunnel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Starting Step ----

  function StartingStep() {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card-elevated p-8 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
          <h2 className="text-lg font-bold text-text-primary dark:text-dark-text-primary mb-2">
            Starting Tunnel...
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Launching cloudflared process. This takes about 10–20 seconds.
          </p>
          <StatusBadge state="starting" />
        </div>
      </div>
    );
  }

  // ---- Active Step ----

  function ActiveStep() {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="card-elevated p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
              Tunnel Active
            </h2>
            <StatusBadge state="active" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
              <ExternalLink className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-muted dark:text-dark-text-muted mb-0.5">
                  Public URL
                </p>
                <p className="text-sm font-mono text-text-primary dark:text-dark-text-primary truncate break-all">
                  {url}
                </p>
              </div>
              <button
                onClick={handleCopyUrl}
                className="p-1.5 rounded-lg hover:bg-bg-primary/10 text-text-muted hover:text-primary transition-colors flex-shrink-0"
                title="Copy URL"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>

            {status?.startedAt && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted text-center">
                Started {new Date(status.startedAt).toLocaleString()}
              </p>
            )}
          </div>

          {password && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                <Shield className="w-4 h-4 inline mr-1" />
                Basic Auth is enabled — use <strong>op:{password}</strong> to authenticate
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleStop}
            className="flex-1 px-4 py-2 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 text-sm font-medium hover:bg-red-500/20 transition-colors"
          >
            Stop Tunnel
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Open URL
            </a>
          )}
        </div>
      </div>
    );
  }

  // ---- Error Step ----

  function ErrorStep() {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card-elevated p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
                Tunnel Error
              </h2>
              <StatusBadge state="error" />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-red-500/10 mb-4">
            <p className="text-sm text-red-500">{errorMsg}</p>
          </div>

          <p className="text-xs text-text-muted dark:text-dark-text-muted mb-4">
            Make sure cloudflared is installed on your system. You can download it from{' '}
            <a
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Cloudflare's documentation
            </a>
            .
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => setWizardState('configure')}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Stopped Step ----

  function StoppedStep() {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card-elevated p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-text-muted" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
                Tunnel Stopped
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Your gateway is not accessible from the internet
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setWizardState('configure')}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Start Tunnel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Main render ----

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
          Cloudflare Tunnel
        </h1>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-0.5">
          Expose your OwnPilot gateway to the internet
        </p>
      </div>

      {wizardState === 'configure' && <ConfigureStep />}
      {wizardState === 'starting' && <StartingStep />}
      {wizardState === 'active' && <ActiveStep />}
      {wizardState === 'stopped' && <StoppedStep />}
      {wizardState === 'error' && <ErrorStep />}
    </div>
  );
}
