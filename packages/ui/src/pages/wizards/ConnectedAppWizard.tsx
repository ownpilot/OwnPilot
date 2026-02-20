/**
 * Connected App (Composio) Wizard
 *
 * Steps: Check Status → Browse Apps → Connect → Verify → Complete
 */

import { useState, useEffect, useMemo } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { composioApi } from '../../api';
import type { ComposioApp } from '../../api/endpoints/composio';
import { Check, AlertTriangle, Link, Search } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'check', label: 'Check' },
  { id: 'browse', label: 'Browse' },
  { id: 'connect', label: 'Connect' },
  { id: 'verify', label: 'Verify' },
  { id: 'done', label: 'Complete' },
];

export function ConnectedAppWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [configMessage, setConfigMessage] = useState('');
  const [apps, setApps] = useState<ComposioApp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApp, setSelectedApp] = useState<ComposioApp | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    ok: boolean;
    redirectUrl?: string | null;
    connectionId?: string;
    error?: string;
  } | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; status?: string; error?: string } | null>(null);

  // Check Composio status on mount
  useEffect(() => {
    composioApi.status().then((res) => {
      setConfigured(res.configured);
      setConfigMessage(res.message);
    }).catch(() => {
      setConfigured(false);
      setConfigMessage('Unable to check Composio status');
    });
  }, []);

  // Load apps when moving to browse step
  useEffect(() => {
    if (step === 1 && apps.length === 0) {
      composioApi.apps().then((res) => setApps(res.apps)).catch(() => {});
    }
  }, [step, apps.length]);

  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return apps;
    const q = searchQuery.toLowerCase();
    return apps.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.slug.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q),
    );
  }, [apps, searchQuery]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0: return configured === true;
      case 1: return !!selectedApp;
      case 2: return connectionResult?.ok === true;
      case 3: return verifyResult?.ok === true;
      default: return false;
    }
  }, [step, configured, selectedApp, connectionResult, verifyResult]);

  const handleNext = async () => {
    if (step === 1) {
      // Initiate connection
      setIsProcessing(true);
      setConnectionResult(null);
      try {
        const res = await composioApi.connect(selectedApp!.slug);
        setConnectionResult({
          ok: true,
          redirectUrl: res.redirectUrl,
          connectionId: res.connectionId,
        });
        // If there's a redirect URL, open it
        if (res.redirectUrl) {
          window.open(res.redirectUrl, '_blank');
        }
        setStep(2);
      } catch (err) {
        setConnectionResult({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
        setStep(2);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (step === 2) {
      // Verify connection
      setIsProcessing(true);
      setVerifyResult(null);
      try {
        if (connectionResult?.connectionId) {
          const conn = await composioApi.getConnection(connectionResult.connectionId);
          setVerifyResult({
            ok: conn.status === 'ACTIVE',
            status: conn.status,
          });
        } else {
          setVerifyResult({ ok: false, error: 'No connection ID' });
        }
        setStep(3);
      } catch (err) {
        setVerifyResult({ ok: false, error: err instanceof Error ? err.message : 'Verification failed' });
        setStep(3);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    setStep(step + 1);
  };

  return (
    <WizardShell
      title="Connect an App"
      description="Link a third-party app via OAuth for AI tool access"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => setStep(Math.max(0, step - 1))}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Check Status */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Composio Configuration
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Connected Apps use Composio to manage OAuth integrations with third-party services.
          </p>

          {configured === null && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
              <svg className="w-5 h-5 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-text-muted dark:text-dark-text-muted">Checking Composio status...</span>
            </div>
          )}

          {configured === true && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-success/5 border border-success/30">
              <Check className="w-5 h-5 text-success flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">Composio is configured</span>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">{configMessage}</p>
              </div>
            </div>
          )}

          {configured === false && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/5 border border-warning/30">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">Composio not configured</span>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  {configMessage || 'Set up your Composio API key in Settings > Config Center to enable connected apps.'}
                </p>
                <a
                  href="/settings/config-center"
                  className="inline-flex items-center text-xs text-primary hover:underline mt-2"
                >
                  Open Config Center
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Browse Apps */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose an App
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Select the service you want to connect.
          </p>

          <div className="relative mb-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps..."
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 border border-border dark:border-dark-border rounded-lg p-2">
            {filteredApps.map((app) => (
              <button
                key={app.slug}
                onClick={() => setSelectedApp(app)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-3 ${
                  selectedApp?.slug === app.slug
                    ? 'bg-primary/10 border border-primary'
                    : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                }`}
              >
                {app.logo ? (
                  <img src={app.logo} alt="" className="w-6 h-6 rounded flex-shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                    {app.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{app.name}</span>
                  {app.description && (
                    <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">{app.description}</p>
                  )}
                </div>
              </button>
            ))}
            {filteredApps.length === 0 && (
              <p className="text-sm text-text-muted dark:text-dark-text-muted p-3 text-center">
                {apps.length === 0 ? 'Loading apps...' : 'No apps match your search'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Connect */}
      {step === 2 && (
        <div className="text-center py-8">
          {!connectionResult && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Initiating connection...</p>
            </div>
          )}

          {connectionResult?.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Link className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                OAuth Flow Started
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                {connectionResult.redirectUrl
                  ? 'A new tab should have opened for authentication. Complete the sign-in there, then click Next to verify.'
                  : 'Connection initiated. Click Next to verify the status.'}
              </p>
              {connectionResult.redirectUrl && (
                <a
                  href={connectionResult.redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Open sign-in page manually
                </a>
              )}
            </>
          )}

          {connectionResult && !connectionResult.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-error/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Connection Failed
              </h3>
              <p className="text-sm text-error max-w-md mx-auto">{connectionResult.error}</p>
              <button
                onClick={() => { setStep(1); setConnectionResult(null); }}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 3: Verify */}
      {step === 3 && (
        <div className="text-center py-8">
          {!verifyResult && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Verifying connection...</p>
            </div>
          )}

          {verifyResult?.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Connected!
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                <strong>{selectedApp?.name}</strong> is now active. Status: {verifyResult.status}
              </p>
            </>
          )}

          {verifyResult && !verifyResult.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-warning/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-warning" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Not Connected Yet
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Status: {verifyResult.status || verifyResult.error}
                <br />
                The OAuth flow may not be complete. Complete sign-in and try again.
              </p>
              <button
                onClick={() => { setStep(2); setVerifyResult(null); }}
                className="text-sm text-primary hover:underline"
              >
                Go back to retry
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
            <Link className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            App Connected!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            <strong>{selectedApp?.name}</strong> is now linked. Your AI can use its tools in conversations.
          </p>
          <a
            href="/settings/connected-apps"
            className="inline-flex px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            View Connected Apps
          </a>
        </div>
      )}
    </WizardShell>
  );
}
