import { useState, useEffect, useMemo } from 'react';
import { useDialog } from '../ConfirmDialog';
import {
  Check,
  AlertCircle,
  Plus,
  Search,
  ChevronDown,
  Power,
  ExternalLink,
  RefreshCw,
  Server,
  Trash,
  Star,
} from '../icons';
import { apiClient, modelConfigsApi, localProvidersApi } from '../../api';
import type {
  ModelCapability,
  MergedModel,
  AvailableProvider,
  CapabilityDef,
  LocalProvider,
  LocalProviderTemplate,
} from '../../api';
import { EditModelModal } from '../EditModelModal';
import { AddLocalProviderDialog } from '../AddLocalProviderDialog';
import { ModelCard } from './constants';

// ============================================================================
// Main Component
// ============================================================================

export function AIModelsTab() {
  const { confirm } = useDialog();
  const [models, setModels] = useState<MergedModel[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AvailableProvider[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDef[]>([]);

  // Local providers
  const [localProviders, setLocalProviders] = useState<LocalProvider[]>([]);
  const [localTemplates, setLocalTemplates] = useState<LocalProviderTemplate[]>([]);
  const [showLocalSection, setShowLocalSection] = useState(true);
  const [showAddLocalDialog, setShowAddLocalDialog] = useState(false);
  const [discoveringLocal, setDiscoveringLocal] = useState<string | null>(null);

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
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoverProvider, setDiscoverProvider] = useState<string>('');

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [modelsData, providersData, capsData, localData, templatesData] = await Promise.all([
        modelConfigsApi.list(),
        modelConfigsApi.availableProviders(),
        modelConfigsApi.capabilities(),
        localProvidersApi.list(),
        localProvidersApi.templates(),
      ]);

      setModels(modelsData);
      setAvailableProviders(providersData);
      setCapabilities(capsData);
      setLocalProviders(localData);
      setLocalTemplates(templatesData);
    } catch {
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
  }, [
    models,
    searchQuery,
    selectedProvider,
    selectedCapability,
    showConfiguredOnly,
    showEnabledOnly,
  ]);

  // Get unique providers from models for filter dropdown
  const uniqueProviders = useMemo(() => {
    const providerMap = new Map<string, { id: string; name: string; isConfigured: boolean }>();
    models.forEach((m) => {
      if (!providerMap.has(m.providerId)) {
        providerMap.set(m.providerId, {
          id: m.providerId,
          name: m.providerName,
          isConfigured: m.isConfigured,
        });
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
      await apiClient.patch(
        `/model-configs/${model.providerId}/${encodeURIComponent(model.modelId)}/toggle`,
        { enabled }
      );

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
    } catch {
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
      await apiClient.put(
        `/model-configs/${model.providerId}/${encodeURIComponent(model.modelId)}`,
        updates
      );

      await loadData(); // Reload to get fresh data
      setEditingModel(null);
      setSuccess('Model updated');
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError('Failed to update model');
    }
  };

  // Handle sync from models.dev
  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const data = await modelConfigsApi.syncApply();
      setSuccess(
        `Synced ${data.stats?.providers ?? 0} providers with ${data.stats?.totalModels ?? 0} models`
      );
      setTimeout(() => setSuccess(null), 3000);
      // Reload data after sync
      await loadData();
    } catch {
      setError('Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle reset and resync (delete all + fresh sync)
  const handleResetSync = async () => {
    if (
      !(await confirm({
        message:
          'This will delete all synced provider configs and resync fresh from models.dev. Protected providers (OpenAI, Anthropic, Google, etc.) will be preserved. Continue?',
        variant: 'danger',
      }))
    ) {
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const data = await modelConfigsApi.syncReset();
      setSuccess(
        `Reset complete! Deleted ${data.stats?.deleted ?? 0}, synced ${data.stats?.synced ?? 0} providers`
      );
      setTimeout(() => setSuccess(null), 5000);
      await loadData();
    } catch {
      setError('Reset sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle discover models from provider's /v1/models endpoint
  const handleDiscoverModels = async (providerId: string) => {
    if (!providerId) return;
    setIsDiscovering(true);
    setError(null);
    try {
      const data = await apiClient.post<{
        newModels?: number;
        models?: unknown[];
        providerName?: string;
      }>(`/model-configs/providers/${providerId}/discover-models`);
      const newCount = data.newModels ?? 0;
      const models = data.models ?? [];
      const providerName = data.providerName ?? providerId;
      setSuccess(
        `Discovered ${models.length} models from ${providerName}${newCount > 0 ? ` (${newCount} new)` : ''}`
      );
      await loadData();
    } catch {
      setError('Failed to discover models. Is the provider running?');
    } finally {
      setIsDiscovering(false);
    }
  };

  // Handle add local provider from template
  const handleAddLocalProvider = async (
    template: LocalProviderTemplate,
    customUrl?: string,
    customApiKey?: string
  ) => {
    setError(null);
    try {
      const data = await localProvidersApi.create({
        name: template.name,
        providerType: template.providerType,
        baseUrl: customUrl || template.baseUrl,
        apiKey: customApiKey || undefined,
        discoveryEndpoint: template.discoveryEndpoint,
      });
      setSuccess(`Added ${template.name} provider. Discovering models...`);
      setShowAddLocalDialog(false);
      await loadData();
      // Auto-discover models after adding provider
      if (data.id) {
        await handleLocalDiscover(data.id);
      }
    } catch {
      setError('Failed to add local provider');
    }
  };

  // Handle discover models for a local provider
  const handleLocalDiscover = async (providerId: string) => {
    setDiscoveringLocal(providerId);
    setError(null);
    try {
      const data = await apiClient.post<Record<string, unknown>>(
        `/local-providers/${providerId}/discover`
      );
      const total = (data.totalModels as number) || 0;
      const newCount = (data.newModels as number) || 0;
      setSuccess(`Discovered ${total} models${newCount > 0 ? ` (${newCount} new)` : ''}`);
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch {
      setError('Failed to discover models. Is the provider running?');
    } finally {
      setDiscoveringLocal(null);
    }
  };

  // Handle delete local provider
  const handleDeleteLocalProvider = async (providerId: string, name: string) => {
    if (
      !(await confirm({
        message: `Delete local provider "${name}" and all its models?`,
        variant: 'danger',
      }))
    )
      return;
    try {
      await apiClient.delete(`/local-providers/${providerId}`);
      setSuccess(`Deleted ${name}`);
      setTimeout(() => setSuccess(null), 2000);
      await loadData();
    } catch {
      setError('Failed to delete provider');
    }
  };

  // Handle toggle local provider
  const handleToggleLocalProvider = async (providerId: string) => {
    try {
      await apiClient.patch(`/local-providers/${providerId}/toggle`);
      await loadData();
    } catch {
      setError('Failed to toggle provider');
    }
  };

  // Handle set default local provider
  const handleSetDefaultLocal = async (providerId: string) => {
    try {
      await apiClient.patch(`/local-providers/${providerId}/set-default`);
      setSuccess('Default provider updated');
      setTimeout(() => setSuccess(null), 2000);
      await loadData();
    } catch {
      setError('Failed to set default provider');
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

      {/* Local AI Providers Section */}
      <div className="border border-success/30 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowLocalSection(!showLocalSection)}
          className="w-full flex items-center justify-between p-4 bg-success/5 hover:bg-success/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-success" />
            <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
              Local AI Providers
            </h3>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {localProviders.length} provider{localProviders.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAddLocalDialog(true);
              }}
              className="px-2.5 py-1 text-xs rounded-lg bg-success text-white hover:bg-success/90 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
            <ChevronDown
              className={`w-4 h-4 text-text-muted transition-transform ${showLocalSection ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        {showLocalSection && (
          <div className="p-4 bg-bg-primary dark:bg-dark-bg-primary">
            {localProviders.length === 0 ? (
              <div className="text-center py-6">
                <Server className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2 opacity-50" />
                <p className="text-sm text-text-muted dark:text-dark-text-muted mb-2">
                  No local providers configured
                </p>
                <button
                  onClick={() => setShowAddLocalDialog(true)}
                  className="text-sm text-success hover:text-success/80"
                >
                  Add LM Studio, Ollama, or other local AI
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {localProviders.map((lp) => (
                  <div
                    key={lp.id}
                    className={`card-elevated p-3 rounded-lg border transition-all ${
                      lp.isEnabled
                        ? 'border-success/30 bg-bg-primary dark:bg-dark-bg-primary'
                        : 'border-border/50 dark:border-dark-border/50 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h5 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
                            {lp.name}
                          </h5>
                          <span className="px-1.5 py-0.5 text-xs rounded bg-success/10 text-success flex-shrink-0">
                            {lp.providerType}
                          </span>
                          {lp.isDefault && (
                            <span className="flex-shrink-0" title="Default provider">
                              <Star className="w-3.5 h-3.5 text-amber-500" />
                            </span>
                          )}
                        </div>
                        <p
                          className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 truncate"
                          title={lp.baseUrl}
                        >
                          {lp.baseUrl}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted dark:text-dark-text-muted">
                        {lp.modelCount} model{lp.modelCount !== 1 ? 's' : ''}
                        {lp.lastDiscoveredAt && (
                          <> &bull; {new Date(lp.lastDiscoveredAt).toLocaleDateString()}</>
                        )}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleLocalDiscover(lp.id)}
                          disabled={discoveringLocal === lp.id}
                          className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted hover:text-success transition-colors disabled:opacity-50"
                          title="Discover models"
                        >
                          <Search
                            className={`w-3.5 h-3.5 ${discoveringLocal === lp.id ? 'animate-pulse' : ''}`}
                          />
                        </button>
                        {!lp.isDefault && (
                          <button
                            onClick={() => handleSetDefaultLocal(lp.id)}
                            className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted hover:text-amber-500 transition-colors"
                            title="Set as default"
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleLocalProvider(lp.id)}
                          className={`p-1 rounded transition-colors ${
                            lp.isEnabled
                              ? 'hover:bg-error/10 text-success hover:text-error'
                              : 'hover:bg-success/10 text-text-muted hover:text-success'
                          }`}
                          title={lp.isEnabled ? 'Disable' : 'Enable'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteLocalProvider(lp.id, lp.name)}
                          className="p-1 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                          title="Delete"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Local Provider Dialog */}
      {showAddLocalDialog && (
        <AddLocalProviderDialog
          templates={localTemplates}
          onAdd={handleAddLocalProvider}
          onClose={() => setShowAddLocalDialog(false)}
        />
      )}

      {/* Header with filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            AI Models
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Showing {filteredModels.length} models &bull; {modelCounts.configured} configured &bull;{' '}
            {modelCounts.total} total
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
                {p.isConfigured ? '✓ ' : ''}
                {p.name}
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
            className="px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5 bg-error/5 border-error/30 text-error hover:bg-error/10 disabled:opacity-50"
            title="Delete all synced configs and resync fresh from models.dev"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Reset
          </button>

          {/* Discover models from local provider */}
          <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border dark:border-dark-border">
            <select
              value={discoverProvider}
              onChange={(e) => setDiscoverProvider(e.target.value)}
              className="px-2 py-2 text-sm rounded-lg border bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
            >
              <option value="">Select provider...</option>
              {uniqueProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleDiscoverModels(discoverProvider)}
              disabled={isDiscovering || !discoverProvider}
              className="px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5 bg-primary/5 border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50 whitespace-nowrap"
              title="Fetch models from provider's /v1/models endpoint (LM Studio, Ollama, etc.)"
            >
              <Search className={`w-4 h-4 ${isDiscovering ? 'animate-pulse' : ''}`} />
              Discover Models
            </button>
          </div>
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
              {availableProviders.filter((p) => p.isConfigured).length} configured &bull;{' '}
              {availableProviders.length} total
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {availableProviders.map((provider) => (
              <div
                key={provider.id}
                className={`card-elevated p-3 rounded-lg border ${
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
                      <span
                        className={`flex-shrink-0 px-1.5 py-0.5 text-xs rounded ${
                          provider.type === 'aggregator'
                            ? 'bg-purple-500/10 text-purple-500'
                            : 'bg-primary/10 text-primary'
                        }`}
                      >
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
