import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsApi } from '../api';

interface SetupStep {
  id: string;
  title: string;
  description: string;
}

const SETUP_STEPS: SetupStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to OwnPilot',
    description: 'Your privacy-first personal AI assistant. Let\'s get you started in 2 simple steps.',
  },
  {
    id: 'api-key',
    title: 'Connect an AI Provider',
    description: 'You need an API key from at least one AI provider to start chatting.',
  },
  {
    id: 'ready',
    title: 'You\'re Ready!',
    description: 'Start chatting with your AI assistant. Type anything in the chat box below.',
  },
];

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', models: 'GPT-4o, GPT-4o-mini', url: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', models: 'Claude 3.5, Claude 3', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google AI', models: 'Gemini 2.0, Gemini 1.5', url: 'https://aistudio.google.com/apikey' },
  { id: 'groq', name: 'Groq', models: 'Llama 3.3, Mixtral (Free)', url: 'https://console.groq.com/keys' },
];

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const navigate = useNavigate();

  // Check if any provider is already configured
  useEffect(() => {
    settingsApi.getProviders()
      .then(data => {
        if (data.providers?.length > 0) {
          // Already has providers, skip to ready
          setProviderConfigured(true);
          setStep(2);
        }
      })
      .catch(() => {
        // Can't check, show wizard from start
      });
  }, []);

  const handleSaveApiKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await settingsApi.saveApiKey(selectedProvider, apiKey.trim());
      setProviderConfigured(true);
      setStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection error. Is the server running?');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = () => {
    localStorage.setItem('ownpilot-setup-complete', 'true');
    onComplete();
  };

  const handleSkip = () => {
    navigate('/settings/api-keys');
    handleComplete();
  };

  const currentStep = SETUP_STEPS[step];
  if (!currentStep) return null;

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-lg w-full mx-auto p-8">
        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {SETUP_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-primary' : 'bg-border dark:bg-dark-border'
              }`}
            />
          ))}
        </div>

        {/* Step Content */}
        <h2 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary mb-2">
          {currentStep.title}
        </h2>
        <p className="text-text-secondary dark:text-dark-text-secondary mb-8">
          {currentStep.description}
        </p>

        {/* Step: Welcome */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <span className="font-medium">Chat</span>
                <p className="text-text-muted dark:text-dark-text-muted text-xs mt-1">Ask anything, get smart answers</p>
              </div>
              <div className="p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <span className="font-medium">Tasks & Notes</span>
                <p className="text-text-muted dark:text-dark-text-muted text-xs mt-1">Manage via chat commands</p>
              </div>
              <div className="p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <span className="font-medium">148+ Tools</span>
                <p className="text-text-muted dark:text-dark-text-muted text-xs mt-1">Auto-discovered by AI</p>
              </div>
              <div className="p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <span className="font-medium">Privacy-First</span>
                <p className="text-text-muted dark:text-dark-text-muted text-xs mt-1">All data stays on your machine</p>
              </div>
            </div>
            <button
              onClick={() => setStep(1)}
              className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step: API Key */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Provider Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                Choose a provider:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className={`p-3 rounded-lg border text-left text-sm transition-colors ${
                      selectedProvider === p.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/50'
                    }`}
                  >
                    <span className="font-medium">{p.name}</span>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">{p.models}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* API Key Input */}
            {selectedProvider && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    API Key:
                  </label>
                  <a
                    href={PROVIDERS.find(p => p.id === selectedProvider)?.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Get API key &rarr;
                  </a>
                </div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-... or paste your key"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-error">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSaveApiKey}
                disabled={!selectedProvider || !apiKey.trim() || saving}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save & Continue'}
              </button>
              <button
                onClick={handleSkip}
                className="px-4 py-2.5 text-text-secondary dark:text-dark-text-secondary rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors text-sm"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Step: Ready */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-success/10 border border-success/20">
              <p className="text-sm text-success font-medium">
                {providerConfigured
                  ? 'AI provider is configured and ready!'
                  : 'Setup complete!'}
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                Try asking: "What can you help me with?" or "Create a task for tomorrow"
              </p>
            </div>
            <button
              onClick={handleComplete}
              className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Start Chatting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
