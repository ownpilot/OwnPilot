/**
 * AI Provider Setup Wizard
 *
 * Steps: Choose Provider → Enter API Key → Test Connection → Set Default → Complete
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import {
  WizardPasswordInput,
  WizardLoadingView,
  WizardSuccessView,
  WizardErrorView,
  useWizardKeyboard,
} from '../../components/wizard';
import { providersApi, settingsApi } from '../../api';
import { silentCatch } from '../../utils/ignore-error';
import type { ProviderInfo, ProviderConfig } from '../../types';
import { Check, ExternalLink, Search } from '../../components/icons';

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

const POPULAR = ['anthropic', 'openai', 'google', 'groq', 'openrouter', 'together'];

export function AIProviderWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [providers, setProviders] = useState<(ProviderInfo | ProviderConfig)[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    models: { id: string; name: string }[];
    error?: string;
  } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [setAsDefault, setSetAsDefault] = useState(true);

  useEffect(() => {
    providersApi
      .list()
      .then((data) => {
        const sorted = [...data.providers].sort((a, b) => {
          const aIdx = POPULAR.indexOf(a.id);
          const bIdx = POPULAR.indexOf(b.id);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
          return a.name.localeCompare(b.name);
        });
        setProviders(sorted);
      })
      .catch(silentCatch('aiProvider.list'));
  }, []);

  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return providers;
    const q = searchQuery.toLowerCase();
    return providers.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [providers, searchQuery]);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedProvider),
    [providers, selectedProvider]
  );

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return !!selectedProvider;
      case 1:
        return apiKey.trim().length >= 8;
      case 2:
        return testResult?.ok === true;
      case 3:
        return true;
      default:
        return false;
    }
  }, [step, selectedProvider, apiKey, testResult]);

  const handleNext = async () => {
    if (step === 1) {
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
        setTestResult({
          ok: false,
          models: [],
          error: err instanceof Error ? err.message : 'Connection failed',
        });
        setStep(2);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (step === 3) {
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

  useWizardKeyboard({ canGoNext, onNext: handleNext, onCancel, isProcessing });

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
      onStepClick={setStep}
    >
      {/* Step 0: Choose Provider */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose a Provider
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Select the AI provider you want to connect. You can add more later.
          </p>

          {providers.length > 6 && (
            <div className="relative mb-4">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search providers..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {filteredProviders.map((p) => {
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
                  <span className="text-xs text-text-muted dark:text-dark-text-muted mt-1 block font-mono">
                    {p.apiKeyEnv}
                  </span>
                </button>
              );
            })}
            {filteredProviders.length === 0 && (
              <p className="col-span-full text-center py-8 text-sm text-text-muted">
                No providers match your search
              </p>
            )}
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
            Paste your <strong>{selected.name}</strong> API key below. It is stored encrypted on
            your machine.
          </p>

          <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
            API Key
          </label>
          <WizardPasswordInput
            value={apiKey}
            onChange={setApiKey}
            placeholder={
              'apiKeyPlaceholder' in selected ? (selected.apiKeyPlaceholder ?? 'sk-...') : 'sk-...'
            }
            autoFocus
            onEnter={() => canGoNext && handleNext()}
          />

          <div className="flex items-center justify-between mt-3">
            {selected.docsUrl && (
              <a
                href={selected.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Get your API key
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <span className="text-[11px] text-text-muted">
              {apiKey.length > 0 && `${apiKey.length} chars`}
            </span>
          </div>
        </div>
      )}

      {/* Step 2: Test Connection */}
      {step === 2 && (
        <>
          {!testResult && <WizardLoadingView label="Testing connection..." />}
          {testResult?.ok && (
            <WizardSuccessView
              title="Connection Successful"
              subtitle={
                <>
                  Found <strong>{testResult.models.length}</strong> available model
                  {testResult.models.length !== 1 ? 's' : ''}.
                </>
              }
            />
          )}
          {testResult && !testResult.ok && (
            <WizardErrorView
              title="Connection Failed"
              message={testResult.error}
              onRetry={() => {
                setStep(1);
                setTestResult(null);
              }}
            />
          )}
        </>
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
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted mt-1">
                You can change this anytime in Settings.
              </p>
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
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Go to Chat
            </button>
            <button
              onClick={() => navigate('/settings/providers')}
              className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            >
              Provider Settings
            </button>
          </div>
        </div>
      )}
    </WizardShell>
  );
}
