/**
 * AI Provider Setup Wizard
 *
 * Steps: Choose Provider → Enter API Key → Test Connection → Set Default → Complete
 */

import { useState, useEffect, useMemo } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { providersApi, settingsApi } from '../../api';
import type { ProviderInfo, ProviderConfig } from '../../types';
import { Check, ExternalLink, AlertTriangle } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'provider', label: 'Provider' },
  { id: 'api-key', label: 'API Key' },
  { id: 'test', label: 'Test' },
  { id: 'default', label: 'Default' },
  { id: 'done', label: 'Complete' },
];

// Popular providers shown first
const POPULAR = ['anthropic', 'openai', 'google', 'groq', 'openrouter', 'together'];

export function AIProviderWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [providers, setProviders] = useState<(ProviderInfo | ProviderConfig)[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; models: { id: string; name: string }[]; error?: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [setAsDefault, setSetAsDefault] = useState(true);

  // Load providers on mount
  useEffect(() => {
    providersApi.list().then((data) => {
      // Sort: popular first, then alphabetical
      const sorted = [...data.providers].sort((a, b) => {
        const aIdx = POPULAR.indexOf(a.id);
        const bIdx = POPULAR.indexOf(b.id);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
      setProviders(sorted);
    }).catch(() => {});
  }, []);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedProvider),
    [providers, selectedProvider],
  );

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0: return !!selectedProvider;
      case 1: return apiKey.trim().length >= 8;
      case 2: return testResult?.ok === true;
      case 3: return true;
      default: return false;
    }
  }, [step, selectedProvider, apiKey, testResult]);

  const handleNext = async () => {
    if (step === 1) {
      // Save key + test connection
      setIsProcessing(true);
      setTestResult(null);
      try {
        await settingsApi.saveApiKey(selectedProvider!, apiKey.trim());
        const result = await providersApi.models(selectedProvider!);
        setTestResult({ ok: true, models: result.models });
        if (result.models.length > 0) {
          setSelectedModel(result.models[0]!.id);
        }
        setStep(2);
      } catch (err) {
        setTestResult({ ok: false, models: [], error: err instanceof Error ? err.message : 'Connection failed' });
        setStep(2);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (step === 3) {
      // Set defaults
      if (setAsDefault && selectedProvider) {
        setIsProcessing(true);
        try {
          await settingsApi.setDefaultProvider(selectedProvider);
          if (selectedModel) {
            await settingsApi.setDefaultModel(selectedModel);
          }
        } catch {
          // Non-critical
        } finally {
          setIsProcessing(false);
        }
      }
      setStep(4);
      return;
    }

    setStep(step + 1);
  };

  return (
    <WizardShell
      title="AI Provider Setup"
      description="Connect an AI provider to power your assistant"
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
      {/* Step 0: Choose Provider */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose a Provider
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Select the AI provider you want to connect. You can add more later.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {providers.map((p) => {
              const isConfigured = 'isConfigured' in p && p.isConfigured;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    selectedProvider === p.id
                      ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                      : 'border-border dark:border-dark-border hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {p.name}
                    </span>
                    {isConfigured && (
                      <span className="text-xs text-success flex items-center gap-1">
                        <Check className="w-3 h-3" /> Configured
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-muted dark:text-dark-text-muted mt-1 block">
                    {p.apiKeyEnv}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 1: Enter API Key */}
      {step === 1 && selected && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Enter API Key
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Paste your <strong>{selected.name}</strong> API key below.
          </p>

          <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={'apiKeyPlaceholder' in selected ? (selected.apiKeyPlaceholder ?? 'sk-...') : 'sk-...'}
            className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            autoFocus
          />

          {selected.docsUrl && (
            <a
              href={selected.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-3"
            >
              Get your API key
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Step 2: Test Connection */}
      {step === 2 && (
        <div className="text-center py-8">
          {!testResult && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Testing connection...</p>
            </div>
          )}

          {testResult?.ok && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Connection Successful
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Found {testResult.models.length} available model{testResult.models.length !== 1 ? 's' : ''}.
              </p>
            </div>
          )}

          {testResult && !testResult.ok && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Connection Failed
              </h3>
              <p className="text-sm text-error max-w-md">{testResult.error}</p>
              <button
                onClick={() => { setStep(1); setTestResult(null); }}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Set Default */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Set as Default
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Configure this provider as your default for all conversations.
          </p>

          <label className="flex items-center gap-3 p-4 rounded-lg border border-border dark:border-dark-border cursor-pointer">
            <input
              type="checkbox"
              checked={setAsDefault}
              onChange={(e) => setSetAsDefault(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <div>
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                Set {selected?.name} as default provider
              </span>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                New conversations will use this provider by default.
              </p>
            </div>
          </label>

          {setAsDefault && testResult?.models && testResult.models.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Default Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm"
              >
                {testResult.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
            <Check className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            Provider Configured!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            <strong>{selected?.name}</strong> is ready to use
            {selectedModel ? ` with ${selectedModel} as your default model` : ''}.
          </p>
          <div className="flex justify-center gap-3">
            <a
              href="/"
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Go to Chat
            </a>
          </div>
        </div>
      )}
    </WizardShell>
  );
}
