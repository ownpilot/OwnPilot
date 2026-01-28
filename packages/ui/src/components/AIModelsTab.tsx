import { useState, useEffect, useMemo } from 'react';
import {
  Check,
  AlertCircle,
  Settings,
  Plus,
  Search,
  ChevronDown,
  Power,
  Edit,
  ExternalLink,
  Cpu,
  Eye,
  Image,
  Code,
  MessageSquare,
  Zap,
  Volume2,
  RefreshCw,
  Brain,
} from './icons';

// ============================================================================
// Types
// ============================================================================

type ModelCapability =
  | 'chat'
  | 'code'
  | 'vision'
  | 'function_calling'
  | 'json_mode'
  | 'streaming'
  | 'embeddings'
  | 'image_generation'
  | 'audio'
  | 'reasoning';

interface MergedModel {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled: boolean;
  isCustom: boolean;
  hasOverride: boolean;
  isConfigured: boolean; // API key is set for this provider
  source: 'builtin' | 'aggregator' | 'custom';
}

interface AvailableProvider {
  id: string;
  name: string;
  type: 'builtin' | 'aggregator';
  description?: string;
  apiBase?: string;
  apiKeyEnv: string;
  docsUrl?: string;
  modelCount: number;
  isEnabled: boolean;
  isConfigured: boolean; // API key is set
}

interface CapabilityDef {
  id: ModelCapability;
  name: string;
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const CAPABILITY_ICONS: Record<ModelCapability, React.ReactNode> = {
  chat: <MessageSquare className="w-3.5 h-3.5" />,
  code: <Code className="w-3.5 h-3.5" />,
  vision: <Eye className="w-3.5 h-3.5" />,
  function_calling: <Settings className="w-3.5 h-3.5" />,
  json_mode: <Cpu className="w-3.5 h-3.5" />,
  streaming: <RefreshCw className="w-3.5 h-3.5" />,
  embeddings: <Zap className="w-3.5 h-3.5" />,
  image_generation: <Image className="w-3.5 h-3.5" />,
  audio: <Volume2 className="w-3.5 h-3.5" />,
  reasoning: <Brain className="w-3.5 h-3.5" />,
};

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  chat: 'Chat',
  code: 'Code',
  vision: 'Vision',
  function_calling: 'Tools',
  json_mode: 'JSON',
  streaming: 'Stream',
  embeddings: 'Embed',
  image_generation: 'Image',
  audio: 'Audio',
  reasoning: 'Think',
};

const SOURCE_COLORS = {
  builtin: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  aggregator: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  custom: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

// ============================================================================
// Components
// ============================================================================

function CapabilityBadge({ capability }: { capability: ModelCapability }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary"
      title={capability}
    >
      {CAPABILITY_ICONS[capability]}
      {CAPABILITY_LABELS[capability]}
    </span>
  );
}

function PricingDisplay({
  pricingInput,
  pricingOutput,
  pricingPerRequest,
}: {
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
}) {
  if (pricingPerRequest !== undefined) {
    return (
      <span className="text-xs text-text-muted dark:text-dark-text-muted">
        ${pricingPerRequest.toFixed(3)}/req
      </span>
    );
  }

  if (pricingInput !== undefined || pricingOutput !== undefined) {
    return (
      <span className="text-xs text-text-muted dark:text-dark-text-muted">
        ${pricingInput?.toFixed(2) || '?'}/${pricingOutput?.toFixed(2) || '?'} /1M
      </span>
    );
  }

  return null;
}

function ModelCard({
  model,
  onToggle,
  onEdit,
  isToggling,
}: {
  model: MergedModel;
  onToggle: (model: MergedModel, enabled: boolean) => void;
  onEdit: (model: MergedModel) => void;
  isToggling: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-lg border transition-all ${
        model.isEnabled && model.isConfigured
          ? 'border-success/30 bg-bg-primary dark:bg-dark-bg-primary'
          : model.isEnabled
            ? 'border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary'
            : 'border-border/50 dark:border-dark-border/50 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {model.isConfigured && (
              <span title="API key configured">
                <Check className="w-4 h-4 text-success shrink-0" />
              </span>
            )}
            <h4
              className="font-medium text-text-primary dark:text-dark-text-primary truncate"
              title={model.modelId}
            >
              {model.displayName}
            </h4>
            <span className={`px-1.5 py-0.5 text-xs rounded ${SOURCE_COLORS[model.source]}`}>
              {model.source}
            </span>
            {model.hasOverride && !model.isCustom && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                modified
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-2">
            {model.providerName} &bull; {model.modelId}
          </p>

          {/* Capabilities */}
          <div className="flex flex-wrap gap-1 mb-2">
            {model.capabilities.slice(0, 6).map((cap) => (
              <CapabilityBadge key={cap} capability={cap} />
            ))}
            {model.capabilities.length > 6 && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted">
                +{model.capabilities.length - 6}
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted">
            {model.contextWindow && <span>{(model.contextWindow / 1000).toFixed(0)}K ctx</span>}
            {model.maxOutput && <span>{(model.maxOutput / 1000).toFixed(0)}K out</span>}
            <PricingDisplay
              pricingInput={model.pricingInput}
              pricingOutput={model.pricingOutput}
              pricingPerRequest={model.pricingPerRequest}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(model)}
            className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
            title="Edit"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => onToggle(model, !model.isEnabled)}
            disabled={isToggling}
            className={`p-1.5 rounded transition-colors ${
              model.isEnabled
                ? 'hover:bg-error/10 text-success hover:text-error'
                : 'hover:bg-success/10 text-text-muted hover:text-success'
            } disabled:opacity-50`}
            title={model.isEnabled ? 'Disable' : 'Enable'}
          >
            <Power className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AIModelsTab() {
  const [models, setModels] = useState<MergedModel[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AvailableProvider[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDef[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedCapability, setSelectedCapability] = useState<ModelCapability | 'all'>('all');
  const [showConfiguredOnly, setShowConfiguredOnly] = useState(true); // Default to showing configured only
  const [showEnabledOnly, setShowEnabledOnly] = useState(false);
  const [showProvidersPanel, setShowProvidersPanel] = useState(false);

  // Modal state
  const [editingModel, setEditingModel] = useState<MergedModel | null>(null);
  const [togglingModel, setTogglingModel] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [modelsRes, providersRes, capsRes] = await Promise.all([
        fetch('/api/v1/model-configs'),
        fetch('/api/v1/model-configs/providers/available'),
        fetch('/api/v1/model-configs/capabilities/list'),
      ]);

      const [modelsData, providersData, capsData] = await Promise.all([
        modelsRes.json(),
        providersRes.json(),
        capsRes.json(),
      ]);

      if (modelsData.success) setModels(modelsData.data);
      if (providersData.success) setAvailableProviders(providersData.data);
      if (capsData.success) setCapabilities(capsData.data);
    } catch (err) {
      console.error('Failed to load model configs:', err);
      setError('Failed to load model configurations');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter models
  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      // Configured filter (API key set) - most important filter
      if (showConfiguredOnly && !model.isConfigured) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          model.modelId.toLowerCase().includes(query) ||
          model.displayName.toLowerCase().includes(query) ||
          model.providerName.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Provider filter
      if (selectedProvider !== 'all' && model.providerId !== selectedProvider) {
        return false;
      }

      // Capability filter
      if (selectedCapability !== 'all' && !model.capabilities.includes(selectedCapability)) {
        return false;
      }

      // Enabled filter
      if (showEnabledOnly && !model.isEnabled) {
        return false;
      }

      return true;
    });
  }, [models, searchQuery, selectedProvider, selectedCapability, showConfiguredOnly, showEnabledOnly]);

  // Get unique providers from models for filter dropdown
  const uniqueProviders = useMemo(() => {
    const providerMap = new Map<string, { id: string; name: string; isConfigured: boolean }>();
    models.forEach((m) => {
      if (!providerMap.has(m.providerId)) {
        providerMap.set(m.providerId, { id: m.providerId, name: m.providerName, isConfigured: m.isConfigured });
      }
    });
    // Sort: configured first, then by name
    return Array.from(providerMap.values()).sort((a, b) => {
      if (a.isConfigured !== b.isConfigured) return a.isConfigured ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [models]);

  // Get counts for display
  const modelCounts = useMemo(() => {
    const configured = models.filter((m) => m.isConfigured).length;
    const enabled = models.filter((m) => m.isEnabled).length;
    return { total: models.length, configured, enabled };
  }, [models]);

  // Handle toggle model
  const handleToggleModel = async (model: MergedModel, enabled: boolean) => {
    const key = `${model.providerId}/${model.modelId}`;
    setTogglingModel(key);
    setError(null);

    try {
      const res = await fetch(
        `/api/v1/model-configs/${model.providerId}/${encodeURIComponent(model.modelId)}/toggle`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }
      );

      const data = await res.json();

      if (data.success) {
        // Update local state
        setModels((prev) =>
          prev.map((m) =>
            m.providerId === model.providerId && m.modelId === model.modelId
              ? { ...m, isEnabled: enabled }
              : m
          )
        );
        setSuccess(`Model ${enabled ? 'enabled' : 'disabled'}`);
        setTimeout(() => setSuccess(null), 2000);
      } else {
        setError(data.error || 'Failed to toggle model');
      }
    } catch (err) {
      setError('Failed to toggle model');
    } finally {
      setTogglingModel(null);
    }
  };

  // Handle edit model
  const handleEditModel = (model: MergedModel) => {
    setEditingModel(model);
  };

  // Handle save edit
  const handleSaveEdit = async (
    model: MergedModel,
    updates: {
      displayName?: string;
      capabilities?: ModelCapability[];
      pricingInput?: number;
      pricingOutput?: number;
      contextWindow?: number;
      maxOutput?: number;
      isEnabled?: boolean;
    }
  ) => {
    setError(null);

    try {
      const res = await fetch(
        `/api/v1/model-configs/${model.providerId}/${encodeURIComponent(model.modelId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      );

      const data = await res.json();

      if (data.success) {
        await loadData(); // Reload to get fresh data
        setEditingModel(null);
        setSuccess('Model updated');
        setTimeout(() => setSuccess(null), 2000);
      } else {
        setError(data.error || 'Failed to update model');
      }
    } catch (err) {
      setError('Failed to update model');
    }
  };

  // Handle sync from models.dev
  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/model-configs/sync/apply', {
        method: 'POST',
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(`Synced ${data.stats?.providers || 0} providers with ${data.stats?.totalModels || 0} models`);
        setTimeout(() => setSuccess(null), 3000);
        // Reload data after sync
        await loadData();
      } else {
        setError(data.error || 'Sync failed');
      }
    } catch (err) {
      setError('Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle reset and resync (delete all + fresh sync)
  const handleResetSync = async () => {
    if (!confirm('This will delete all synced provider configs and resync fresh from models.dev. Protected providers (OpenAI, Anthropic, Google, etc.) will be preserved. Continue?')) {
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/model-configs/sync/reset', {
        method: 'POST',
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(`Reset complete! Deleted ${data.stats?.deleted || 0}, synced ${data.stats?.synced || 0} providers`);
        setTimeout(() => setSuccess(null), 5000);
        await loadData();
      } else {
        setError(data.error || 'Reset failed');
      }
    } catch (err) {
      setError('Reset sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted dark:text-dark-text-muted">Loading AI models...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error/Success messages */}
      {error && (
        <div className="p-4 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-error/60 hover:text-error">
            &times;
          </button>
        </div>
      )}

      {success && (
        <div className="p-4 bg-success/10 border border-success/20 rounded-lg flex items-center gap-2 text-success">
          <Check className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* Header with filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            AI Models
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Showing {filteredModels.length} models &bull; {modelCounts.configured} configured &bull; {modelCounts.total} total
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Provider filter */}
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Providers</option>
            {uniqueProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.isConfigured ? '✓ ' : ''}{p.name}
              </option>
            ))}
          </select>

          {/* Capability filter */}
          <select
            value={selectedCapability}
            onChange={(e) => setSelectedCapability(e.target.value as ModelCapability | 'all')}
            className="px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Capabilities</option>
            {capabilities.map((cap) => (
              <option key={cap.id} value={cap.id}>
                {cap.name}
              </option>
            ))}
          </select>

          {/* Configured only toggle (API key set) */}
          <button
            onClick={() => setShowConfiguredOnly(!showConfiguredOnly)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
              showConfiguredOnly
                ? 'bg-success text-white border-success'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary'
            }`}
            title="Show only models with API keys configured"
          >
            Configured
          </button>

          {/* Enabled only toggle */}
          <button
            onClick={() => setShowEnabledOnly(!showEnabledOnly)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
              showEnabledOnly
                ? 'bg-primary text-white border-primary'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary'
            }`}
          >
            Enabled
          </button>

          {/* Providers panel toggle */}
          <button
            onClick={() => setShowProvidersPanel(!showProvidersPanel)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5 ${
              showProvidersPanel
                ? 'bg-primary text-white border-primary'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary'
            }`}
          >
            <Plus className="w-4 h-4" />
            Providers
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showProvidersPanel ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Sync button */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary disabled:opacity-50"
            title="Sync models from models.dev (updates existing configs)"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync
          </button>

          {/* Reset & Resync button */}
          <button
            onClick={handleResetSync}
            disabled={isSyncing}
            className="px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50"
            title="Delete all synced configs and resync fresh from models.dev"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Reset
          </button>
        </div>
      </div>

      {/* Providers panel (collapsible) */}
      {showProvidersPanel && (
        <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-text-primary dark:text-dark-text-primary">
              Available Providers
            </h4>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {availableProviders.filter((p) => p.isConfigured).length} configured &bull; {availableProviders.length} total
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {availableProviders.map((provider) => (
              <div
                key={provider.id}
                className={`p-3 rounded-lg border ${
                  provider.isConfigured
                    ? 'border-success/30 bg-success/5'
                    : 'border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h5 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
                        {provider.name}
                      </h5>
                      <span className={`flex-shrink-0 px-1.5 py-0.5 text-xs rounded ${
                        provider.type === 'aggregator'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {provider.type}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                      {provider.modelCount} models
                      {provider.description && <> &bull; {provider.description}</>}
                    </p>
                  </div>
                  {provider.isConfigured ? (
                    <span className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-success/10 text-success flex items-center gap-1">
                      <Check className="w-3 h-3" /> Ready
                    </span>
                  ) : (
                    <span className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted">
                      No key
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <code className="px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary font-mono">
                    {provider.apiKeyEnv}
                  </code>
                  {provider.docsUrl && (
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 ml-auto"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Docs
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models grid */}
      {filteredModels.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-muted dark:text-dark-text-muted">
            {models.length === 0
              ? 'No models available. Add API keys in the API Keys tab.'
              : showConfiguredOnly
                ? 'No configured models. Add API keys in the API Keys tab or turn off the "Configured" filter to see all models.'
                : 'No models match your filters.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredModels.map((model) => (
            <ModelCard
              key={`${model.providerId}/${model.modelId}`}
              model={model}
              onToggle={handleToggleModel}
              onEdit={handleEditModel}
              isToggling={togglingModel === `${model.providerId}/${model.modelId}`}
            />
          ))}
        </div>
      )}

      {/* Edit Model Modal */}
      {editingModel && (
        <EditModelModal
          model={editingModel}
          capabilities={capabilities}
          onSave={handleSaveEdit}
          onClose={() => setEditingModel(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Edit Model Modal
// ============================================================================

function EditModelModal({
  model,
  capabilities,
  onSave,
  onClose,
}: {
  model: MergedModel;
  capabilities: CapabilityDef[];
  onSave: (model: MergedModel, updates: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(model.displayName);
  const [selectedCaps, setSelectedCaps] = useState<Set<ModelCapability>>(
    new Set(model.capabilities)
  );
  const [pricingInput, setPricingInput] = useState(model.pricingInput?.toString() || '');
  const [pricingOutput, setPricingOutput] = useState(model.pricingOutput?.toString() || '');
  const [contextWindow, setContextWindow] = useState(model.contextWindow?.toString() || '');
  const [maxOutput, setMaxOutput] = useState(model.maxOutput?.toString() || '');
  const [isEnabled, setIsEnabled] = useState(model.isEnabled);
  const [isSaving, setIsSaving] = useState(false);

  const toggleCapability = (cap: ModelCapability) => {
    setSelectedCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
      } else {
        next.add(cap);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(model, {
      displayName: displayName || undefined,
      capabilities: Array.from(selectedCaps),
      pricingInput: pricingInput ? parseFloat(pricingInput) : undefined,
      pricingOutput: pricingOutput ? parseFloat(pricingOutput) : undefined,
      contextWindow: contextWindow ? parseInt(contextWindow) : undefined,
      maxOutput: maxOutput ? parseInt(maxOutput) : undefined,
      isEnabled,
    });
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Edit Model
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {model.providerName} / {model.modelId}
          </p>
        </div>

        <div className="p-6 space-y-4">
          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={model.modelId}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Capabilities
            </label>
            <div className="flex flex-wrap gap-2">
              {capabilities.map((cap) => (
                <button
                  key={cap.id}
                  onClick={() => toggleCapability(cap.id)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                    selectedCaps.has(cap.id)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary'
                  }`}
                  title={cap.description}
                >
                  {CAPABILITY_ICONS[cap.id]}
                  {cap.name}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Input Price ($/1M)
              </label>
              <input
                type="number"
                step="0.01"
                value={pricingInput}
                onChange={(e) => setPricingInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Output Price ($/1M)
              </label>
              <input
                type="number"
                step="0.01"
                value={pricingOutput}
                onChange={(e) => setPricingOutput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Context Window
              </label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="128000"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Max Output
              </label>
              <input
                type="number"
                value={maxOutput}
                onChange={(e) => setMaxOutput(e.target.value)}
                placeholder="16384"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium text-text-primary dark:text-dark-text-primary">Enabled</p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Model is available for use
              </p>
            </div>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                isEnabled ? 'bg-success' : 'bg-bg-tertiary dark:bg-dark-bg-tertiary'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  isEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="p-6 border-t border-border dark:border-dark-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
