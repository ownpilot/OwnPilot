import { useState, useEffect } from 'react';
import { Settings, Check, AlertCircle, ChevronDown, ChevronRight, Key } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { settingsApi, providersApi, modelsApi, localProvidersApi } from '../api';
import type { ProviderConfig, LocalProviderInfo, ModelInfo } from '../types';

interface ProviderCategory {
  name: string;
  providers: ProviderConfig[];
}


// Empty fallback - API should always provide providers
const FALLBACK_PROVIDERS: ProviderConfig[] = [];

export function ApiKeysPage() {
  const { confirm } = useDialog();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [uncategorized, setUncategorized] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Popular']));
  const [searchQuery, setSearchQuery] = useState('');

  // Default provider/model state
  const [defaultProvider, setDefaultProvider] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [localProviderInfos, setLocalProviderInfos] = useState<LocalProviderInfo[]>([]);

  // Load settings on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load settings, providers, categories, and models in parallel
      const [settingsData, providersData, categoriesData, modelsData] = await Promise.all([
        settingsApi.get(),
        providersApi.list(),
        providersApi.categories(),
        modelsApi.list(),
      ]);

      setConfiguredProviders(settingsData.configuredProviders);
      setLocalProviderInfos((settingsData.localProviders ?? []) as LocalProviderInfo[]);
      // Set default provider from settings or first configured
      if (settingsData.defaultProvider) {
        setDefaultProvider(settingsData.defaultProvider);
      } else if (settingsData.configuredProviders.length > 0) {
        setDefaultProvider(settingsData.configuredProviders[0]!);
      }
      if (settingsData.defaultModel) {
        setDefaultModel(settingsData.defaultModel);
      }

      if (providersData.providers.length > 0) {
        setProviders(providersData.providers as ProviderConfig[]);
      } else {
        setProviders(FALLBACK_PROVIDERS);
      }

      setCategories(categoriesData.categories);
      setUncategorized(categoriesData.uncategorized);

      const allModels: ModelInfo[] = modelsData.models ?? [];

      // Also load local provider models
      const localProvs = (settingsData.localProviders ?? []) as LocalProviderInfo[];
      for (const lp of localProvs) {
        try {
          const lpModelsData = await localProvidersApi.models(lp.id);
          if (Array.isArray(lpModelsData)) {
            for (const lm of lpModelsData) {
              allModels.push({
                id: lm.modelId,
                name: lm.displayName || lm.modelId,
                provider: lp.id,
              });
            }
          }
        } catch {
          // Skip if local provider is unreachable
        }
      }

      setModels(allModels);
      // Set default model from first model of default provider if not set
      if (!settingsData.defaultModel && allModels.length > 0) {
        const providerToUse = settingsData.defaultProvider || settingsData.configuredProviders?.[0];
        if (providerToUse) {
          const firstModel = allModels.find((m) => m.provider === providerToUse);
          if (firstModel) {
            setDefaultModel(firstModel.id);
          }
        }
      }
    } catch {
      setProviders(FALLBACK_PROVIDERS);
      setError('Failed to load provider list. Using defaults.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateApiKey = (providerId: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [providerId]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    setError(null);

    try {
      const newConfigured = [...configuredProviders];

      // Send API keys to backend
      for (const [provider, apiKey] of Object.entries(apiKeys)) {
        if (apiKey && apiKey.trim()) {
          await settingsApi.saveApiKey(provider, apiKey);

          // Add to configured list if not already there
          if (!newConfigured.includes(provider)) {
            newConfigured.push(provider);
          }
        }
      }

      // Update configured providers
      setConfiguredProviders(newConfigured);

      // Clear input fields after successful save
      setApiKeys({});

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDefaultProviderChange = async (providerId: string) => {
    setDefaultProvider(providerId);

    // Save to backend
    try {
      await settingsApi.setDefaultProvider(providerId);

      // Update default model to first model of this provider
      const providerModels = models.filter((m) => m.provider === providerId);
      if (providerModels.length > 0) {
        const recommended = providerModels.find((m) => m.recommended);
        const newModel = recommended?.id ?? providerModels[0]!.id;
        setDefaultModel(newModel);
        await handleDefaultModelChange(newModel);
      }
    } catch {
      setError('Failed to save default provider');
    }
  };

  const handleDefaultModelChange = async (modelId: string) => {
    setDefaultModel(modelId);

    // Save to backend
    try {
      await settingsApi.setDefaultModel(modelId);
    } catch {
      // API client handles error reporting
    }
  };

  const handleDeleteKey = async (providerId: string) => {
    if (!await confirm({ message: `Are you sure you want to remove the ${providerId} API key?`, variant: 'danger' })) {
      return;
    }

    try {
      await settingsApi.deleteApiKey(providerId);

      // Remove from configured list
      setConfiguredProviders((prev) => prev.filter((p) => p !== providerId));

      // Clear from input if any
      setApiKeys((prev) => {
        const updated = { ...prev };
        delete updated[providerId];
        return updated;
      });

      // If this was the default provider, clear it
      if (defaultProvider === providerId) {
        const remaining = configuredProviders.filter((p) => p !== providerId);
        if (remaining.length > 0) {
          await handleDefaultProviderChange(remaining[0]!);
        } else {
          setDefaultProvider('');
          setDefaultModel('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete API key');
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getProviderById = (id: string): ProviderConfig | undefined => {
    const remote = providers.find((p) => p.id === id);
    if (remote) return remote;
    // Check local providers
    const local = localProviderInfos.find((lp) => lp.id === id);
    if (local) return { id: local.id, name: `${local.name} (Local)`, apiKeyEnv: '' };
    return undefined;
  };

  const getProviderPlaceholder = (provider: ProviderConfig): string => {
    // Use API-provided placeholder if available
    if (provider.apiKeyPlaceholder) {
      return provider.apiKeyPlaceholder;
    }
    // Fallback to generic placeholder
    return `your-${provider.id}-api-key`;
  };

  const getProviderDocsUrl = (provider: ProviderConfig): string => {
    return provider.docsUrl || `https://${provider.id}.com`;
  };

  // Filter providers by search
  const filterProviders = (providerIds: string[]): string[] => {
    if (!searchQuery.trim()) return providerIds;
    const query = searchQuery.toLowerCase();
    return providerIds.filter((id) => {
      const provider = getProviderById(id);
      return provider && (
        provider.id.toLowerCase().includes(query) ||
        provider.name.toLowerCase().includes(query)
      );
    });
  };

  // Group providers by category for display
  const getCategorizedProviders = (): ProviderCategory[] => {
    const result: ProviderCategory[] = [];

    // If no categories loaded, show all providers as "All Providers"
    if (!categories || Object.keys(categories).length === 0) {
      if (providers.length > 0) {
        const filtered = filterProviders(providers.map(p => p.id));
        if (filtered.length > 0) {
          result.push({
            name: 'All Providers',
            providers: filtered.map((id) => getProviderById(id)).filter(Boolean) as ProviderConfig[],
          });
        }
      }
      return result;
    }

    // Standard category order (matches PROVIDER_CATEGORIES in providers.ts)
    const categoryOrder = [
      'Popular',
      'Cloud Platforms',
      'Inference Providers',
      'Search & Research',
      'Chinese Providers',
      'Development Tools',
      'Aggregators & Routers',
      'Specialized',
      'Enterprise',
      'Other',
    ];

    for (const categoryName of categoryOrder) {
      const providerIds = categories[categoryName];
      if (providerIds && providerIds.length > 0) {
        const filtered = filterProviders(providerIds);
        if (filtered.length > 0) {
          result.push({
            name: categoryName,
            providers: filtered.map((id) => getProviderById(id)).filter(Boolean) as ProviderConfig[],
          });
        }
      }
    }

    // Add uncategorized if any
    if (uncategorized && uncategorized.length > 0) {
      const filtered = filterProviders(uncategorized);
      if (filtered.length > 0) {
        result.push({
          name: 'Other Providers',
          providers: filtered.map((id) => getProviderById(id)).filter(Boolean) as ProviderConfig[],
        });
      }
    }

    return result;
  };

  const renderProviderCard = (provider: ProviderConfig) => {
    const isConfigured = configuredProviders.includes(provider.id);
    const hasNewValue = apiKeys[provider.id] && apiKeys[provider.id]!.trim();

    return (
      <div
        key={provider.id}
        className={`p-4 rounded-lg border ${
          isConfigured
            ? 'border-success/30 bg-success/5'
            : 'border-border dark:border-dark-border'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary flex items-center gap-2">
            {provider.name}
            {isConfigured && (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="w-3 h-3" /> Configured
              </span>
            )}
          </label>
          {isConfigured && (
            <button
              onClick={() => handleDeleteKey(provider.id)}
              className="text-xs text-error hover:underline"
            >
              Remove
            </button>
          )}
        </div>
        <input
          type="password"
          value={apiKeys[provider.id] || ''}
          onChange={(e) => updateApiKey(provider.id, e.target.value)}
          placeholder={isConfigured ? '••••••••••••••••' : getProviderPlaceholder(provider)}
          className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
          {isConfigured && !hasNewValue ? (
            'Enter a new key to update'
          ) : (
            <>
              Get your API key from{' '}
              <a
                href={getProviderDocsUrl(provider)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {provider.name} Docs
              </a>
            </>
          )}
        </p>
      </div>
    );
  };

  // Get models for the selected default provider
  const providerModels = models.filter((m) => m.provider === defaultProvider);

  const categorizedProviders = getCategorizedProviders();

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-4 pb-4 border-b border-border dark:border-dark-border">
        <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
          <Key className="w-5 h-5" />
          API Keys
        </h2>
        <p className="text-sm text-text-muted dark:text-dark-text-muted">Configure API keys for 80+ AI providers</p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingSpinner message="Loading settings..." />
        ) : (
          <div className="space-y-8">
            {/* Error message */}
            {error && (
              <div className="p-4 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {/* Status banner */}
            {configuredProviders.length === 0 && (
              <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                <p className="text-sm text-warning">
                  <strong>Demo Mode:</strong> No API keys configured. Add at least one API key to use AI features.
                </p>
              </div>
            )}

            {/* Configured providers summary */}
            {configuredProviders.length > 0 && (
              <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
                <p className="text-sm text-success">
                  <strong>{configuredProviders.length} provider{configuredProviders.length > 1 ? 's' : ''} configured:</strong>{' '}
                  {configuredProviders.slice(0, 5).join(', ')}
                  {configuredProviders.length > 5 && ` and ${configuredProviders.length - 5} more`}
                </p>
              </div>
            )}

            {/* Default Provider & Model Selection */}
            {configuredProviders.length > 0 && (
              <section className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
                  Default AI Settings
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                      Default Provider
                    </label>
                    <select
                      value={defaultProvider}
                      onChange={(e) => handleDefaultProviderChange(e.target.value)}
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      {configuredProviders.map((id) => {
                        const provider = getProviderById(id);
                        return (
                          <option key={id} value={id}>
                            {provider?.name || id}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                      Default Model
                    </label>
                    <select
                      value={defaultModel}
                      onChange={(e) => handleDefaultModelChange(e.target.value)}
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      {providerModels.length > 0 ? (
                        providerModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} {model.recommended ? '(Recommended)' : ''}
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>
                          No models available
                        </option>
                      )}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted">
                  These settings are used as defaults when starting a new chat.
                </p>
              </section>
            )}

            {/* API Keys */}
            <section>
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5" />
                API Keys ({providers.length} providers available)
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Configure API keys for your preferred AI providers. Keys are stored locally and encrypted.
              </p>

              {/* Search */}
              <div className="mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search providers..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Categorized providers */}
              <div className="space-y-4">
                {categorizedProviders.map((category) => (
                  <div key={category.name} className="border border-border dark:border-dark-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleCategory(category.name)}
                      className="w-full px-4 py-3 bg-bg-secondary dark:bg-dark-bg-secondary flex items-center justify-between text-left hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                    >
                      <span className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                        {expandedCategories.has(category.name) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        {category.name}
                        <span className="text-xs text-text-muted dark:text-dark-text-muted font-normal">
                          ({category.providers.length} providers)
                        </span>
                      </span>
                      <span className="text-xs text-success">
                        {category.providers.filter((p) => configuredProviders.includes(p.id)).length} configured
                      </span>
                    </button>
                    {expandedCategories.has(category.name) && (
                      <div className="p-4 space-y-4 bg-bg-primary dark:bg-dark-bg-primary">
                        {category.providers.map(renderProviderCard)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Privacy Notice */}
            <section className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Privacy First
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                OwnPilot is designed with privacy at its core. Your API keys are stored locally
                and encrypted with AES-256-GCM. All conversations can be encrypted and stored locally.
                You maintain full control over your data.
              </p>
            </section>

            {/* Save Button */}
            <div className="flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={isSaving || Object.keys(apiKeys).length === 0}
                className="px-6 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save API Keys'}
              </button>
              {saved && (
                <span className="text-sm text-success">Settings saved successfully!</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
