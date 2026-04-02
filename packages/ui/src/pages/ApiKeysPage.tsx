import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Settings,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Key,
  Lock,
  Shield,
  BarChart,
  RefreshCw,
  Gauge,
  Home,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { settingsApi, providersApi, modelsApi, localProvidersApi } from '../api';
import type { ProviderConfig, LocalProviderInfo, ModelInfo } from '../types';
import { PageHomeTab } from '../components/PageHomeTab';
import { EmptyState } from '../components/EmptyState';

type TabId = 'home' | 'keys';
const TAB_LABELS: Record<TabId, string> = { home: 'Home', keys: 'API Keys' };

interface ProviderCategory {
  name: string;
  providers: ProviderConfig[];
}

// Empty fallback - API should always provide providers
const FALLBACK_PROVIDERS: ProviderConfig[] = [];

export function ApiKeysPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) || 'home';
  const setActiveTab = (t: TabId) => setSearchParams(t === 'home' ? {} : { tab: t });

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:apikeys:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Save skip home preference
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  // Auto-redirect to keys if skipHome is enabled and on home tab
  useEffect(() => {
    if (skipHome && activeTab === 'home') {
      setActiveTab('keys');
    }
  }, [skipHome, activeTab]);

  const { confirm } = useDialog();
  const toast = useToast();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [uncategorized, setUncategorized] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
      setError(null);
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

      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDefaultProviderChange = async (providerId: string) => {
    setDefaultProvider(providerId);

    // Save to backend
    try {
      await settingsApi.setDefaultProvider(providerId);
      toast.success('Default provider updated');

      // Update default model to first model of this provider
      const providerModels = models.filter((m) => m.provider === providerId);
      if (providerModels.length > 0) {
        const recommended = providerModels.find((m) => m.recommended);
        const newModel = recommended?.id ?? providerModels[0]!.id;
        setDefaultModel(newModel);
        await handleDefaultModelChange(newModel);
      }
    } catch {
      toast.error('Failed to save default provider');
    }
  };

  const handleDefaultModelChange = async (modelId: string) => {
    setDefaultModel(modelId);

    // Save to backend
    try {
      await settingsApi.setDefaultModel(modelId);
      toast.success('Default model updated');
    } catch {
      toast.error('Failed to save default model');
    }
  };

  const handleDeleteKey = async (providerId: string) => {
    if (
      !(await confirm({
        message: `Are you sure you want to remove the ${providerId} API key?`,
        variant: 'danger',
      }))
    ) {
      return;
    }

    try {
      await settingsApi.deleteApiKey(providerId);
      toast.success('API key deleted');

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
      toast.error(err instanceof Error ? err.message : 'Failed to delete API key');
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
      return (
        provider &&
        (provider.id.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query))
      );
    });
  };

  // Group providers by category for display
  const getCategorizedProviders = (): ProviderCategory[] => {
    const result: ProviderCategory[] = [];

    // If no categories loaded, show all providers as "All Providers"
    if (!categories || Object.keys(categories).length === 0) {
      if (providers.length > 0) {
        const filtered = filterProviders(providers.map((p) => p.id));
        if (filtered.length > 0) {
          result.push({
            name: 'All Providers',
            providers: filtered
              .map((id) => getProviderById(id))
              .filter(Boolean) as ProviderConfig[],
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
            providers: filtered
              .map((id) => getProviderById(id))
              .filter(Boolean) as ProviderConfig[],
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
          isConfigured ? 'border-success/30 bg-success/5' : 'border-border dark:border-dark-border'
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
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            API Keys
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Configure API keys for 80+ AI providers
          </p>
        </div>
      </header>

      {/* URL-based tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'keys'] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {t === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Home Tab */}
      {activeTab === 'home' && (
        <div className="flex-1 overflow-y-auto p-6">
          <PageHomeTab
            heroIcons={[
              { icon: Key, color: 'text-primary bg-primary/10' },
              { icon: Lock, color: 'text-violet-500 bg-violet-500/10' },
              { icon: Shield, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Manage API Keys"
            subtitle="Create and manage API keys for programmatic access to your OwnPilot instance. Each key has scoped permissions and usage tracking."
            cta={{ label: 'Manage Keys', icon: Key, onClick: () => setActiveTab('keys') }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to API Keys"
            features={[
              {
                icon: Lock,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Scoped Permissions',
                description: 'Each API key can be restricted to specific actions and resources.',
              },
              {
                icon: BarChart,
                color: 'text-blue-500 bg-blue-500/10',
                title: 'Usage Tracking',
                description: 'Monitor how each key is being used with detailed analytics.',
              },
              {
                icon: RefreshCw,
                color: 'text-green-500 bg-green-500/10',
                title: 'Key Rotation',
                description: 'Rotate keys regularly to maintain security best practices.',
              },
              {
                icon: Gauge,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Rate Limiting',
                description: 'Set per-key rate limits to prevent abuse and control costs.',
              },
            ]}
            steps={[
              {
                title: 'Generate a new key',
                detail: 'Create an API key with a descriptive name for easy identification.',
              },
              {
                title: 'Set permission scope',
                detail: 'Choose which APIs and resources the key can access.',
              },
              {
                title: 'Use in your applications',
                detail: 'Add the key to your application headers for authenticated requests.',
              },
              {
                title: 'Monitor usage & rotate',
                detail: 'Track usage patterns and rotate keys periodically for security.',
              },
            ]}
          />
        </div>
      )}

      {/* Keys Tab */}
      {activeTab === 'keys' && (
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <LoadingSpinner message="Loading settings..." />
          ) : (
            <div className="space-y-8">
              {/* Error message */}
              {error && (
                <EmptyState
                  icon={AlertCircle}
                  title="Failed to load provider list"
                  description={error}
                  variant="card"
                  iconBgColor="bg-red-500/10 dark:bg-red-500/20"
                  iconColor="text-red-500"
                  action={{
                    label: 'Try Again',
                    onClick: loadData,
                    icon: RefreshCw,
                  }}
                />
              )}

              {/* Status banner */}
              {configuredProviders.length === 0 && (
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                  <p className="text-sm text-warning">
                    <strong>Demo Mode:</strong> No API keys configured. Add at least one API key to
                    use AI features.
                  </p>
                </div>
              )}

              {/* Configured providers summary */}
              {configuredProviders.length > 0 && (
                <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
                  <p className="text-sm text-success">
                    <strong>
                      {configuredProviders.length} provider
                      {configuredProviders.length > 1 ? 's' : ''} configured:
                    </strong>{' '}
                    {configuredProviders.slice(0, 5).join(', ')}
                    {configuredProviders.length > 5 &&
                      ` and ${configuredProviders.length - 5} more`}
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
                  Configure API keys for your preferred AI providers. Keys are stored locally and
                  encrypted.
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
                    <div
                      key={category.name}
                      className="border border-border dark:border-dark-border rounded-lg overflow-hidden"
                    >
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
                          {
                            category.providers.filter((p) => configuredProviders.includes(p.id))
                              .length
                          }{' '}
                          configured
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
                  and encrypted with AES-256-GCM. All conversations can be encrypted and stored
                  locally. You maintain full control over your data.
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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
