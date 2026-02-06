import { useState, useEffect, useMemo } from 'react';
import { useDialog } from './ConfirmDialog';
import { Check, Image, Volume2, Mic, Eye, Play, Zap, Globe } from './icons';
import { useToast } from './ToastProvider';
import { mediaSettingsApi } from '../api';
import type { CapabilitySettings, ProviderWithStatus } from '../api';

type MediaCapability = 'image_generation' | 'video_generation' | 'vision' | 'tts' | 'stt';
type CategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'vision';

const CAPABILITY_ICONS: Record<MediaCapability, React.ReactNode> = {
  image_generation: <Image className="w-5 h-5" />,
  video_generation: <Play className="w-5 h-5" />,
  vision: <Eye className="w-5 h-5" />,
  tts: <Volume2 className="w-5 h-5" />,
  stt: <Mic className="w-5 h-5" />,
};

const CAPABILITY_CATEGORIES: Record<MediaCapability, CategoryFilter> = {
  image_generation: 'image',
  video_generation: 'video',
  vision: 'vision',
  tts: 'audio',
  stt: 'audio',
};

const CATEGORY_LABELS: Record<CategoryFilter, { label: string; icon: React.ReactNode }> = {
  all: { label: 'All', icon: <Globe className="w-4 h-4" /> },
  image: { label: 'Image', icon: <Image className="w-4 h-4" /> },
  video: { label: 'Video', icon: <Play className="w-4 h-4" /> },
  audio: { label: 'Audio', icon: <Volume2 className="w-4 h-4" /> },
  vision: { label: 'Vision', icon: <Eye className="w-4 h-4" /> },
};

/** Flatten all unique providers across capabilities */
function getUniqueProviders(settings: CapabilitySettings[]): {
  provider: string;
  displayName: string;
  capabilities: string[];
  isConfigured: boolean;
  apiKeyEnv: string;
}[] {
  const map = new Map<string, {
    provider: string;
    displayName: string;
    capabilities: string[];
    isConfigured: boolean;
    apiKeyEnv: string;
  }>();

  for (const s of settings) {
    for (const p of s.availableProviders) {
      const existing = map.get(p.provider);
      if (existing) {
        if (!existing.capabilities.includes(s.name)) {
          existing.capabilities.push(s.name);
        }
        if (p.isConfigured) existing.isConfigured = true;
      } else {
        map.set(p.provider, {
          provider: p.provider,
          displayName: p.displayName,
          capabilities: [s.name],
          isConfigured: p.isConfigured,
          apiKeyEnv: p.apiKeyEnv,
        });
      }
    }
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Provider Card Component (for the marketplace grid)
// ---------------------------------------------------------------------------
function ProviderCard({
  providerInfo,
  isSelected,
  onClick,
}: {
  providerInfo: {
    provider: string;
    displayName: string;
    capabilities: string[];
    isConfigured: boolean;
    apiKeyEnv: string;
  };
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative p-4 rounded-xl border text-left transition-all hover:shadow-md ${
        isSelected
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
          : providerInfo.isConfigured
            ? 'border-success/30 bg-bg-secondary dark:bg-dark-bg-secondary hover:border-primary/50'
            : 'border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary opacity-60 hover:opacity-80'
      }`}
    >
      {/* Status badge */}
      <div className="absolute top-3 right-3">
        {providerInfo.isConfigured ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-success/10 text-success">
            <Check className="w-3 h-3" />
            Ready
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-text-muted dark:text-dark-text-muted">
            Setup needed
          </span>
        )}
      </div>

      {/* Provider name */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
          {providerInfo.displayName.charAt(0)}
        </div>
        <h4 className="font-semibold text-text-primary dark:text-dark-text-primary text-sm">
          {providerInfo.displayName}
        </h4>
      </div>

      {/* Capability tags */}
      <div className="flex flex-wrap gap-1 mt-2">
        {providerInfo.capabilities.map((cap) => (
          <span
            key={cap}
            className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
          >
            {cap}
          </span>
        ))}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Capability Config Section
// ---------------------------------------------------------------------------
function CapabilityConfig({
  setting,
  isSaving,
  onProviderChange,
  onModelChange,
  onReset,
}: {
  setting: CapabilitySettings;
  isSaving: boolean;
  onProviderChange: (capability: string, providerId: string) => void;
  onModelChange: (capability: string, modelId: string) => void;
  onReset: (capability: string) => void;
}) {
  const configuredProviders = setting.availableProviders.filter((p: ProviderWithStatus) => p.isConfigured);
  const hasConfiguredProviders = configuredProviders.length > 0;

  const currentProviderConfig = setting.availableProviders.find(
    (p: ProviderWithStatus) => p.provider === setting.currentProvider
  );
  const availableModels = currentProviderConfig?.models || [];

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        setting.currentProvider && hasConfiguredProviders
          ? 'border-success/30 bg-success/5'
          : 'border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            {CAPABILITY_ICONS[setting.capability as MediaCapability]}
          </div>
          <div>
            <h4 className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              {setting.name}
              {isSaving && (
                <span className="text-xs text-text-muted dark:text-dark-text-muted animate-pulse">
                  Saving...
                </span>
              )}
            </h4>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
              {setting.description}
            </p>
          </div>
        </div>
        {setting.currentProvider && (
          <button
            onClick={() => onReset(setting.capability)}
            disabled={isSaving}
            className="text-xs text-text-muted hover:text-error transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {!hasConfiguredProviders ? (
        <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
          <p className="text-sm text-warning">
            No providers configured. Add API keys for{' '}
            {setting.availableProviders.map((p: ProviderWithStatus) => p.displayName).join(', ')} in Settings.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
              Provider
            </label>
            <select
              value={setting.currentProvider || ''}
              onChange={(e) => onProviderChange(setting.capability, e.target.value)}
              disabled={isSaving}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            >
              <option value="">Select provider...</option>
              {configuredProviders.map((provider: ProviderWithStatus) => (
                <option key={provider.provider} value={provider.provider}>
                  {provider.displayName}
                </option>
              ))}
            </select>
            {!setting.currentProvider && (
              <p className="mt-1 text-[10px] text-text-muted dark:text-dark-text-muted">
                Using default provider
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
              Model
            </label>
            <select
              value={setting.currentModel || ''}
              onChange={(e) => onModelChange(setting.capability, e.target.value)}
              disabled={isSaving || !setting.currentProvider || availableModels.length === 0}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            >
              {availableModels.length === 0 ? (
                <option value="">Select provider first</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      )}

      {/* Provider status pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {setting.availableProviders.map((provider: ProviderWithStatus) => (
          <span
            key={provider.provider}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              provider.provider === setting.currentProvider
                ? 'bg-primary/15 text-primary font-medium'
                : provider.isConfigured
                  ? 'bg-success/10 text-success'
                  : 'bg-gray-100 dark:bg-gray-800 text-text-muted dark:text-dark-text-muted'
            }`}
          >
            {provider.isConfigured && <Check className="w-3 h-3" />}
            {provider.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function MediaSettingsTab() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [settings, setSettings] = useState<CapabilitySettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingCapability, setSavingCapability] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await mediaSettingsApi.get();
      setSettings(data);
    } catch {
      toast.error('Failed to load media settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProviderChange = async (capability: string, providerId: string) => {
    const capabilitySettings = settings.find((s) => s.capability === capability);
    if (!capabilitySettings) return;

    const provider = capabilitySettings.availableProviders.find((p: ProviderWithStatus) => p.provider === providerId);
    const defaultModel = provider?.models?.find((m) => m.default) || provider?.models?.[0];
    const model = defaultModel?.id || null;

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

    try {
      await mediaSettingsApi.update(capability, { provider, model });
      toast.success('Setting saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save setting';
      toast.error(message);
      await loadSettings();
    } finally {
      setSavingCapability(null);
    }
  };

  const handleReset = async (capability: string) => {
    if (!await confirm({ message: `Reset ${capability} to default?` })) return;

    setSavingCapability(capability);

    try {
      await mediaSettingsApi.reset(capability);
      toast.success('Setting reset');
      await loadSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSavingCapability(null);
    }
  };

  // Derived data
  const uniqueProviders = useMemo(() => getUniqueProviders(settings), [settings]);

  const filteredSettings = useMemo(() => {
    if (activeCategory === 'all') return settings;
    return settings.filter(
      (s) => CAPABILITY_CATEGORIES[s.capability as MediaCapability] === activeCategory
    );
  }, [settings, activeCategory]);

  const configuredCount = uniqueProviders.filter((p) => p.isConfigured).length;

  // Provider detail filter - when a provider card is clicked, show only capabilities for that provider
  const providerFilteredSettings = useMemo(() => {
    if (!selectedProvider) return filteredSettings;
    return filteredSettings.filter((s) =>
      s.availableProviders.some((p: ProviderWithStatus) => p.provider === selectedProvider)
    );
  }, [filteredSettings, selectedProvider]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted dark:text-dark-text-muted">Loading media settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="flex items-center gap-4 p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            {configuredCount} / {uniqueProviders.length} providers ready
          </span>
        </div>
        <div className="h-4 w-px bg-border dark:bg-dark-border" />
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          {settings.length} capabilities available
        </span>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 p-1 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
        {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setActiveCategory(cat);
              setSelectedProvider(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeCategory === cat
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
            }`}
          >
            {CATEGORY_LABELS[cat].icon}
            {CATEGORY_LABELS[cat].label}
          </button>
        ))}
      </div>

      {/* Provider Marketplace Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Providers
          </h3>
          {selectedProvider && (
            <button
              onClick={() => setSelectedProvider(null)}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Show all capabilities
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {uniqueProviders
            .filter((p) => {
              if (activeCategory === 'all') return true;
              // Filter providers that support at least one capability in the current category
              return settings.some(
                (s) =>
                  CAPABILITY_CATEGORIES[s.capability as MediaCapability] === activeCategory &&
                  s.availableProviders.some((ap: ProviderWithStatus) => ap.provider === p.provider)
              );
            })
            .map((p) => (
              <ProviderCard
                key={p.provider}
                providerInfo={p}
                isSelected={selectedProvider === p.provider}
                onClick={() =>
                  setSelectedProvider(selectedProvider === p.provider ? null : p.provider)
                }
              />
            ))}
        </div>
      </div>

      {/* Capability Settings */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
          Capability Configuration
        </h3>
        <div className="space-y-3">
          {providerFilteredSettings.map((setting) => (
            <CapabilityConfig
              key={setting.capability}
              setting={setting}
              isSaving={savingCapability === setting.capability}
              onProviderChange={handleProviderChange}
              onModelChange={handleModelChange}
              onReset={handleReset}
            />
          ))}
        </div>
      </div>

      {/* Help text */}
      <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
          How it works
        </h4>
        <ul className="text-sm text-text-muted dark:text-dark-text-muted space-y-1 list-disc list-inside">
          <li>
            <strong>Image Generation:</strong> Creates images from text (DALL-E, FLUX, Stable
            Diffusion, fal.ai)
          </li>
          <li>
            <strong>Video Generation:</strong> Creates videos from text or images (Runway, Luma,
            fal.ai)
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
          Click a provider card to filter capabilities. Add API keys for providers in{' '}
          <strong>Settings &rarr; Config Center</strong>.
        </p>
      </div>
    </div>
  );
}
