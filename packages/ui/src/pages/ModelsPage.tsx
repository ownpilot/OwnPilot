/**
 * Models Page
 *
 * Display available AI models from configured providers
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { formatNumber as formatNumberBase } from '../utils/formatters';
import {
  Cpu,
  Check,
  AlertCircle,
  ExternalLink,
  Zap,
  Eye,
  Code,
  MessageSquare,
  Brain,
  Sparkles,
  Gauge,
  Layers,
  BarChart,
  DollarSign,
  Maximize2,
  Home,
  RefreshCw,
} from '../components/icons';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { modelsApi, providersApi } from '../api';
import { PageHomeTab } from '../components/PageHomeTab';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens?: number;
  inputPrice: number;
  outputPrice: number;
  capabilities: string[];
  recommended?: boolean;
}

interface ProviderInfo {
  id: string;
  name: string;
  docsUrl?: string;
  color: string;
  isConfigured: boolean;
  configSource?: 'database' | 'environment' | null;
}

const CAPABILITY_ICONS: Record<string, { icon: typeof Zap; label: string }> = {
  text: { icon: MessageSquare, label: 'Text' },
  vision: { icon: Eye, label: 'Vision' },
  function_calling: { icon: Code, label: 'Tools' },
  reasoning: { icon: Zap, label: 'Reasoning' },
  code: { icon: Code, label: 'Code' },
  audio: { icon: MessageSquare, label: 'Audio' },
};

const formatNumber = (num: number) => formatNumberBase(num, { kDecimals: 0 });

function formatPrice(price: number): string {
  if (price < 0.01) return `$${price.toFixed(4)}`;
  if (price < 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

export function ModelsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  type TabId = 'home' | 'models';
  const TAB_LABELS: Record<TabId, string> = { home: 'Home', models: 'Models' };

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'models'] as string[]).includes(tabParam) ? tabParam : 'home';
  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  // Skip home screen preference
  const SKIP_HOME_KEY = 'ownpilot_skip_home__models';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, checked ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
  }, []);
  useEffect(() => {
    if (skipHome && !tabParam) {
      setTab('models');
    }
  }, [skipHome, tabParam]);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [providerInfo, setProviderInfo] = useState<Record<string, ProviderInfo>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [modelsData, providersData] = await Promise.all([
        modelsApi.list(),
        providersApi.list(),
      ]);

      setModels(modelsData.models as ModelInfo[]);
      setConfiguredProviders(modelsData.configuredProviders);

      const infoMap: Record<string, ProviderInfo> = {};
      for (const provider of providersData.providers) {
        infoMap[provider.id] = provider as ProviderInfo;
      }
      setProviderInfo(infoMap);
    } catch {
      setError('Failed to load models');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter models by provider
  const filteredModels = selectedProvider
    ? models.filter((m) => m.provider === selectedProvider)
    : models;

  // Group models by provider
  const modelsByProvider = filteredModels.reduce<Record<string, ModelInfo[]>>((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider]!.push(model);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            AI Models
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {configuredProviders.length > 0
              ? `${configuredProviders.length} provider${configuredProviders.length > 1 ? 's' : ''} configured`
              : 'Configure API keys in Settings to enable models'}
          </p>
        </div>

        {/* Provider Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted dark:text-dark-text-muted">Filter:</span>
          <select
            value={selectedProvider ?? ''}
            onChange={(e) => setSelectedProvider(e.target.value || null)}
            className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">All Configured ({configuredProviders.length})</option>
            {configuredProviders.map((provider) => (
              <option key={provider} value={provider}>
                {providerInfo[provider]?.name ?? provider}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'models'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Brain, color: 'text-primary bg-primary/10' },
            { icon: Sparkles, color: 'text-violet-500 bg-violet-500/10' },
            { icon: Gauge, color: 'text-emerald-500 bg-emerald-500/10' },
          ]}
          title="AI Model Library"
          subtitle="Browse and manage available AI models across all providers — compare capabilities, costs, and context windows."
          cta={{
            label: 'Browse Models',
            icon: Brain,
            onClick: () => setTab('models'),
          }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={handleSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to Models"
          features={[
            {
              icon: Layers,
              color: 'text-primary bg-primary/10',
              title: 'Provider Catalog',
              description: 'See all models from every configured provider in one place.',
            },
            {
              icon: BarChart,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Model Comparison',
              description: 'Compare context windows, output limits, and capabilities side by side.',
            },
            {
              icon: DollarSign,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Cost Info',
              description: 'View input and output pricing per million tokens for each model.',
            },
            {
              icon: Maximize2,
              color: 'text-amber-500 bg-amber-500/10',
              title: 'Context Windows',
              description: 'Check how much context each model can handle for your use case.',
            },
          ]}
          steps={[
            {
              title: 'Browse available models',
              detail: 'Explore models from all configured providers.',
            },
            { title: 'Compare capabilities', detail: 'Check context size, pricing, and features.' },
            {
              title: 'Select for your agents',
              detail: 'Assign models to agents in the Agents page.',
            },
            { title: 'Monitor usage', detail: 'Track token consumption and costs over time.' },
          ]}
        />
      )}

      {activeTab === 'models' && (
        <>
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <LoadingSpinner message="Loading models..." />
            ) : error ? (
              <EmptyState
                icon={AlertCircle}
                title="Failed to load models"
                description={error}
                variant="card"
                action={{
                  label: 'Try Again',
                  onClick: fetchData,
                  icon: RefreshCw,
                }}
              />
            ) : configuredProviders.length === 0 ? (
              <EmptyState
                icon={Cpu}
                title="No Providers Configured"
                description="Add your API keys in Settings to enable AI models from providers like OpenAI, Anthropic, and more."
                variant="card"
                iconBgColor="bg-primary/10 dark:bg-primary/20"
                iconColor="text-primary"
                action={{
                  label: 'Configure API Keys',
                  onClick: () => window.location.href = '/settings/api-keys',
                }}
              />
            ) : (
              <div className="space-y-8">
                {Object.entries(modelsByProvider).map(([provider, providerModels]) => {
                  const info = providerInfo[provider];
                  const isConfigured = configuredProviders.includes(provider);

                  return (
                    <section key={provider}>
                      {/* Provider Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: `${info?.color ?? '#666'}20` }}
                          >
                            <Cpu className="w-4 h-4" style={{ color: info?.color ?? '#666' }} />
                          </div>
                          <div>
                            <h3 className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                              {info?.name ?? provider}
                              {isConfigured ? (
                                info?.configSource === 'environment' ? (
                                  <span
                                    className="flex items-center gap-1 text-xs text-amber-500"
                                    title="API key set via environment variable"
                                  >
                                    <Check className="w-3 h-3" /> ENV
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-xs text-success">
                                    <Check className="w-3 h-3" /> Configured
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-warning">Not configured</span>
                              )}
                            </h3>
                            <p className="text-xs text-text-muted dark:text-dark-text-muted">
                              {providerModels.length} model{providerModels.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        {info?.docsUrl && (
                          <a
                            href={info.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline flex items-center gap-1"
                          >
                            Documentation <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      {/* Models Grid */}
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {providerModels.map((model) => (
                          <ModelCard key={model.id} model={model} isConfigured={isConfigured} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface ModelCardProps {
  model: ModelInfo;
  isConfigured: boolean;
}

function ModelCard({ model, isConfigured }: ModelCardProps) {
  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        isConfigured
          ? 'bg-bg-secondary dark:bg-dark-bg-secondary border-border dark:border-dark-border hover:border-primary'
          : 'bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 border-border/50 dark:border-dark-border/50 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
            {model.name}
            {model.recommended && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
                Recommended
              </span>
            )}
          </h4>
          <p className="text-xs text-text-muted dark:text-dark-text-muted font-mono">{model.id}</p>
        </div>
      </div>

      {model.description && (
        <p className="text-sm text-text-secondary dark:text-dark-text-secondary mb-3 line-clamp-2">
          {model.description}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div className="p-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
          <span className="text-text-muted dark:text-dark-text-muted block">Context</span>
          <span className="text-text-primary dark:text-dark-text-primary font-medium">
            {formatNumber(model.contextWindow)}
          </span>
        </div>
        <div className="p-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
          <span className="text-text-muted dark:text-dark-text-muted block">Max Output</span>
          <span className="text-text-primary dark:text-dark-text-primary font-medium">
            {model.maxOutputTokens ? formatNumber(model.maxOutputTokens) : 'N/A'}
          </span>
        </div>
      </div>

      {/* Pricing */}
      <div className="flex items-center gap-3 mb-3 text-xs">
        <span className="text-text-muted dark:text-dark-text-muted">
          In:{' '}
          <span className="text-text-primary dark:text-dark-text-primary">
            {formatPrice(model.inputPrice)}/M
          </span>
        </span>
        <span className="text-text-muted dark:text-dark-text-muted">
          Out:{' '}
          <span className="text-text-primary dark:text-dark-text-primary">
            {formatPrice(model.outputPrice)}/M
          </span>
        </span>
      </div>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-1">
        {model.capabilities.slice(0, 4).map((cap) => {
          const capInfo = CAPABILITY_ICONS[cap];
          return (
            <span
              key={cap}
              className="px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded flex items-center gap-1"
              title={capInfo?.label ?? cap}
            >
              {capInfo?.label ?? cap}
            </span>
          );
        })}
        {model.capabilities.length > 4 && (
          <span className="px-2 py-0.5 text-xs text-text-muted dark:text-dark-text-muted">
            +{model.capabilities.length - 4}
          </span>
        )}
      </div>
    </div>
  );
}
