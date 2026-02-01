import { useState, useEffect } from 'react';
import { useDialog } from './ConfirmDialog';
import { Check, AlertCircle, Image, Volume2, Mic, Eye } from './icons';
import { mediaSettingsApi } from '../api';

interface ProviderWithStatus {
  id: string;
  name: string;
  models: string[];
  voices?: string[];
  isConfigured: boolean;
  apiKeyName: string;
}

interface CapabilitySettings {
  capability: string;
  name: string;
  description: string;
  currentProvider: string | null;
  currentModel: string | null;
  availableProviders: ProviderWithStatus[];
}

type MediaCapability = 'image_generation' | 'vision' | 'tts' | 'stt';

const CAPABILITY_ICONS: Record<MediaCapability, React.ReactNode> = {
  image_generation: <Image className="w-5 h-5" />,
  vision: <Eye className="w-5 h-5" />,
  tts: <Volume2 className="w-5 h-5" />,
  stt: <Mic className="w-5 h-5" />,
};

export function MediaSettingsTab() {
  const { confirm } = useDialog();
  const [settings, setSettings] = useState<CapabilitySettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCapability, setSavingCapability] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await mediaSettingsApi.get();
      setSettings(data as unknown as CapabilitySettings[]);
    } catch (err) {
      console.error('Failed to load media settings:', err);
      setError('Failed to load media settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProviderChange = async (capability: string, providerId: string) => {
    // Find the capability settings
    const capabilitySettings = settings.find((s) => s.capability === capability);
    if (!capabilitySettings) return;

    // Find the provider to get its first model
    const provider = capabilitySettings.availableProviders.find((p) => p.id === providerId);
    const model = provider?.models[0] || null;

    // Optimistically update UI
    setSettings((prev) =>
      prev.map((s) =>
        s.capability === capability ? { ...s, currentProvider: providerId, currentModel: model } : s
      )
    );

    await saveCapabilitySetting(capability, providerId, model);
  };

  const handleModelChange = async (capability: string, modelId: string) => {
    const capabilitySettings = settings.find((s) => s.capability === capability);
    if (!capabilitySettings || !capabilitySettings.currentProvider) return;

    // Optimistically update UI
    setSettings((prev) =>
      prev.map((s) => (s.capability === capability ? { ...s, currentModel: modelId } : s))
    );

    await saveCapabilitySetting(capability, capabilitySettings.currentProvider, modelId);
  };

  const saveCapabilitySetting = async (
    capability: string,
    provider: string,
    model: string | null
  ) => {
    setSavingCapability(capability);
    setSaved(null);
    setError(null);

    try {
      // TODO: migrate to mediaSettingsApi.update(capability, { provider, model }) once endpoint is added
      const res = await fetch(`/api/v1/media-settings/${capability}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to save setting');
        // Reload to revert optimistic update
        await loadSettings();
      } else {
        setSaved(capability);
        setTimeout(() => setSaved(null), 2000);
      }
    } catch (err) {
      setError('Failed to save setting');
      await loadSettings();
    } finally {
      setSavingCapability(null);
    }
  };

  const handleReset = async (capability: string) => {
    if (!await confirm({ message: `Reset ${capability} to default?` })) return;

    setSavingCapability(capability);

    try {
      // TODO: migrate to mediaSettingsApi.reset(capability) once endpoint is added
      const res = await fetch(`/api/v1/media-settings/${capability}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadSettings();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to reset');
      }
    } catch (err) {
      setError('Failed to reset setting');
    } finally {
      setSavingCapability(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted dark:text-dark-text-muted">Loading media settings...</p>
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

      {/* Info banner */}
      <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
        <p className="text-sm text-text-primary dark:text-dark-text-primary">
          Configure which AI providers to use for different media capabilities. Only providers with
          configured API keys are available for selection.
        </p>
      </div>

      {/* Capability Settings */}
      <div className="space-y-4">
        {settings.map((setting) => {
          const configuredProviders = setting.availableProviders.filter((p) => p.isConfigured);
          const hasConfiguredProviders = configuredProviders.length > 0;
          const isSaving = savingCapability === setting.capability;
          const isSaved = saved === setting.capability;

          // Get models for current provider
          const currentProviderConfig = setting.availableProviders.find(
            (p) => p.id === setting.currentProvider
          );
          const availableModels = currentProviderConfig?.models || [];

          return (
            <div
              key={setting.capability}
              className={`p-4 rounded-lg border ${
                setting.currentProvider && hasConfiguredProviders
                  ? 'border-success/30 bg-success/5'
                  : 'border-border dark:border-dark-border'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg text-primary">
                    {CAPABILITY_ICONS[setting.capability as MediaCapability]}
                  </div>
                  <div>
                    <h4 className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                      {setting.name}
                      {isSaving && (
                        <span className="text-xs text-text-muted dark:text-dark-text-muted">
                          Saving...
                        </span>
                      )}
                      {isSaved && (
                        <span className="text-xs text-success flex items-center gap-1">
                          <Check className="w-3 h-3" /> Saved
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {setting.description}
                    </p>
                  </div>
                </div>
                {setting.currentProvider && (
                  <button
                    onClick={() => handleReset(setting.capability)}
                    disabled={isSaving}
                    className="text-xs text-text-muted hover:text-error"
                  >
                    Reset
                  </button>
                )}
              </div>

              {!hasConfiguredProviders ? (
                <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                  <p className="text-sm text-warning">
                    No providers configured. Add API keys for{' '}
                    {setting.availableProviders.map((p) => p.name).join(', ')} in the API Keys tab.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                      Provider
                    </label>
                    <select
                      value={setting.currentProvider || ''}
                      onChange={(e) => handleProviderChange(setting.capability, e.target.value)}
                      disabled={isSaving}
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                    >
                      <option value="">Select provider...</option>
                      {configuredProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                    {!setting.currentProvider && (
                      <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                        Using default provider
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                      Model
                    </label>
                    <select
                      value={setting.currentModel || ''}
                      onChange={(e) => handleModelChange(setting.capability, e.target.value)}
                      disabled={isSaving || !setting.currentProvider || availableModels.length === 0}
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                    >
                      {availableModels.length === 0 ? (
                        <option value="">Select provider first</option>
                      ) : (
                        availableModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              )}

              {/* Provider status indicators */}
              <div className="mt-3 flex flex-wrap gap-2">
                {setting.availableProviders.map((provider) => (
                  <span
                    key={provider.id}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                      provider.isConfigured
                        ? 'bg-success/10 text-success'
                        : 'bg-gray-100 dark:bg-gray-800 text-text-muted dark:text-dark-text-muted'
                    }`}
                  >
                    {provider.isConfigured && <Check className="w-3 h-3" />}
                    {provider.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Help text */}
      <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
          How it works
        </h4>
        <ul className="text-sm text-text-muted dark:text-dark-text-muted space-y-1 list-disc list-inside">
          <li>
            <strong>Image Generation:</strong> Creates images from text descriptions (DALL-E, FLUX,
            Imagen)
          </li>
          <li>
            <strong>Vision:</strong> Analyzes images, extracts text (OCR), answers questions about
            images
          </li>
          <li>
            <strong>Text-to-Speech:</strong> Converts text to spoken audio
          </li>
          <li>
            <strong>Speech-to-Text:</strong> Transcribes audio files to text
          </li>
        </ul>
        <p className="mt-3 text-sm text-text-muted dark:text-dark-text-muted">
          If no provider is selected, the system will use the default AI provider for that
          capability.
        </p>
      </div>
    </div>
  );
}
