/**
 * ProvidersTab Component
 *
 * Manages AI providers - enable/disable, configure baseUrl, type overrides
 * These settings survive models.dev sync
 */

import { useState, useEffect, useCallback } from 'react';
import { useDialog } from './ConfirmDialog';
import { Check, Server, Edit2, Save, X, ExternalLink, Search, Trash, AlertCircle } from './icons';
import { useToast } from './ToastProvider';
import { localProviderManagementApi, providersApi } from '../api';
import type { ProviderInfo, UserOverride } from '../types';

// Provider type options - must match ProviderType in configs/types.ts
const PROVIDER_TYPES = [
  { value: 'openai-compatible', label: 'OpenAI Compatible (Most Providers)' },
  { value: 'openai', label: 'OpenAI (Native)' },
  { value: 'anthropic', label: 'Anthropic (Native)' },
  { value: 'google', label: 'Google Gemini (Native)' },
];

const CLI_REMOVAL_INFO: Record<
  string,
  { packageName: string; binary: string; uninstallCommand: string }
> = {
  'claude-cli': {
    packageName: '@anthropic-ai/claude-code',
    binary: 'claude',
    uninstallCommand: 'npm uninstall -g @anthropic-ai/claude-code',
  },
  'codex-cli': {
    packageName: '@openai/codex',
    binary: 'codex',
    uninstallCommand: 'npm uninstall -g @openai/codex',
  },
  'gemini-cli': {
    packageName: '@google/gemini-cli',
    binary: 'gemini',
    uninstallCommand: 'npm uninstall -g @google/gemini-cli',
  },
};

export function ProvidersTab() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterConfigured, setFilterConfigured] = useState<'all' | 'configured' | 'unconfigured'>(
    'all'
  );

  // Edit modal state
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    baseUrl: string;
    providerType: string;
    isEnabled: boolean;
    notes: string;
  }>({
    baseUrl: '',
    providerType: '',
    isEnabled: true,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [cliRemovalProviderId, setCliRemovalProviderId] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      setIsLoading(true);
      const { providers: list } = await providersApi.list();
      setProviders(list as ProviderInfo[]);
    } catch {
      toast.error('Failed to load providers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleToggle = async (providerId: string, enabled: boolean) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    try {
      if (provider.transport === 'local') {
        await localProviderManagementApi.toggle(providerId, enabled);
        await fetchProviders();
      } else if (provider.transport === 'cli') {
        await providersApi.toggle(providerId, enabled);
        await fetchProviders();
      } else {
        await providersApi.toggle(providerId, enabled);
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId ? { ...p, isEnabled: enabled, hasOverride: true } : p
          )
        );
      }
      toast.success(enabled ? 'Provider enabled' : 'Provider disabled');
    } catch {
      toast.error('Failed to toggle provider');
    }
  };

  const handleEdit = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    if (provider.transport === 'cli') {
      showCliProviderWarning(provider.name);
      return;
    }

    if (provider.transport === 'local') {
      window.location.href = '/models';
      return;
    }

    // Fetch current config
    try {
      const data = await providersApi.getConfig(providerId);
      const override: UserOverride = data.userOverride || ({} as UserOverride);
      const baseConfig = data.baseConfig || {};
      setEditForm({
        baseUrl: override.baseUrl || (baseConfig as Record<string, string>).baseUrl || '',
        providerType: override.providerType || (baseConfig as Record<string, string>).type || '',
        isEnabled: override.isEnabled !== false,
        notes: override.notes || '',
      });
      setEditingProvider(providerId);
    } catch {
      toast.error('Failed to load provider config');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingProvider) return;
    setSaving(true);
    try {
      await providersApi.updateConfig(editingProvider, {
        baseUrl: editForm.baseUrl || undefined,
        providerType: editForm.providerType || undefined,
        isEnabled: editForm.isEnabled,
        notes: editForm.notes || undefined,
      });
      // Refresh providers
      await fetchProviders();
      setEditingProvider(null);
      toast.success('Provider config saved');
    } catch {
      toast.error('Failed to save provider config');
    } finally {
      setSaving(false);
    }
  };

  const handleResetOverride = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    if (provider.transport === 'cli') {
      try {
        await providersApi.resetConfig(providerId);
        await fetchProviders();
        toast.success('CLI provider restored in OwnPilot');
      } catch {
        toast.error('Failed to restore CLI provider');
      }
      return;
    }

    if (provider.transport === 'local') {
      toast.warning('Local providers do not have override reset here. Manage them from AI Models.');
      return;
    }

    if (!(await confirm({ message: 'Reset this provider to default settings?' }))) return;
    try {
      await providersApi.resetConfig(providerId);
      await fetchProviders();
      setEditingProvider(null);
      toast.success('Provider reset to default');
    } catch {
      toast.error('Failed to reset provider config');
    }
  };

  const handleDeleteLocalProvider = async (providerId: string, providerName: string) => {
    if (
      !(await confirm({
        message: `Delete local provider "${providerName}" and all its models?`,
        variant: 'danger',
      }))
    ) {
      return;
    }

    try {
      await localProviderManagementApi.delete(providerId);
      await fetchProviders();
      toast.success('Local provider deleted');
    } catch {
      toast.error('Failed to delete local provider');
    }
  };

  const showCliProviderWarning = (providerName: string) => {
    toast.warning(
      `${providerName} bir CLI runtime provider. Ayrıntılı config düzenlenemez; sadece OwnPilot içinde kaldırabilir veya sistemden uninstall edebilirsin.`
    );
  };

  // Filter and search providers
  const filteredProviders = providers.filter((p) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!p.id.toLowerCase().includes(query) && !p.name.toLowerCase().includes(query)) {
        return false;
      }
    }
    // Configured filter
    if (filterConfigured === 'configured' && !p.isConfigured) return false;
    if (filterConfigured === 'unconfigured' && p.isConfigured) return false;
    return true;
  });

  // Group by provider type/status
  const cliProviders = filteredProviders.filter((p) => p.transport === 'cli');
  const manageableProviders = filteredProviders.filter((p) => p.transport !== 'cli');
  const configuredProviders = manageableProviders.filter((p) => p.isConfigured);
  const unconfiguredProviders = manageableProviders.filter((p) => !p.isConfigured);
  const cliRemovalProvider = cliRemovalProviderId
    ? providers.find((p) => p.id === cliRemovalProviderId && p.transport === 'cli')
    : null;
  const cliRemovalInfo = cliRemovalProvider ? CLI_REMOVAL_INFO[cliRemovalProvider.id] : null;

  const renderProviderCard = (provider: ProviderInfo) => {
    const isDisabled = !provider.isEnabled;
    const isCliProvider = provider.transport === 'cli';
    const isLocalProvider = provider.transport === 'local';
    const configuredLabel = isCliProvider ? 'Ready' : isLocalProvider ? 'Local' : 'API Key';

    return (
      <div
        key={provider.id}
        className={`p-4 rounded-lg border transition-all ${
          isDisabled
            ? 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 opacity-60'
            : provider.isConfigured
              ? 'border-green-500/30 bg-green-50 dark:bg-green-900/10'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: provider.color || '#666' }}
              />
              <h4 className="font-medium text-gray-900 dark:text-white truncate">
                {provider.name}
              </h4>
              {provider.isConfigured && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <Check className="w-3 h-3" />
                  {configuredLabel}
                </span>
              )}
              {isCliProvider && (
                <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded">
                  CLI
                </span>
              )}
              {isLocalProvider && (
                <span className="text-xs px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded">
                  Local
                </span>
              )}
              {provider.hasOverride && (
                <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                  Override
                </span>
              )}
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p className="flex items-center gap-1">
                <Server className="w-3 h-3" />
                <span className="font-mono">{provider.type}</span>
              </p>
              {provider.baseUrl && (
                <p className="font-mono truncate" title={provider.baseUrl}>
                  {provider.baseUrl}
                </p>
              )}
              {isCliProvider && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                  <p className="flex items-start gap-1.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Bu provider yüklü CLI&apos;dan otomatik gelir. Bu sayfadan edit, toggle veya
                      silme desteklenmez.
                    </span>
                  </p>
                  <p className="mt-1">
                    API key gerekiyorsa <a href="/settings/api-keys" className="text-primary hover:underline">API Keys</a> sayfasından girin. Bu karttan OwnPilot içinde kaldırabilir, tamamen kaldırmak için uninstall bilgisini açabilirsin.
                  </p>
                </div>
              )}
              {isLocalProvider && (
                <p>
                  Local providers are managed in <a href="/models" className="text-primary hover:underline">AI Models</a>.
                </p>
              )}
              <p className="flex items-center gap-2">
                <span>{provider.modelCount} models</span>
                {provider.features.vision && <span className="text-purple-500">👁 Vision</span>}
                {provider.features.toolUse && <span className="text-blue-500">🔧 Tools</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleToggle(provider.id, !provider.isEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                provider.isEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
              title={
                isCliProvider
                  ? provider.isEnabled
                    ? 'Remove from OwnPilot'
                    : 'Show in OwnPilot again'
                  : provider.isEnabled
                    ? 'Enabled - Click to disable'
                    : 'Disabled - Click to enable'
              }
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  provider.isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>

            {!isCliProvider && !isLocalProvider && (
              <button
                onClick={() => handleEdit(provider.id)}
                className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                title="Edit provider settings"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}

            {isCliProvider && (
              <>
                <button
                  onClick={() => showCliProviderWarning(provider.name)}
                  className="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors"
                  title="CLI provider limitations"
                >
                  <AlertCircle className="w-4 h-4" />
                </button>
                <a
                  href="/settings/api-keys"
                  className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                  title="Manage CLI API keys"
                >
                  <Edit2 className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setCliRemovalProviderId(provider.id)}
                  className="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Uninstall this CLI provider"
                >
                  <Trash className="w-4 h-4" />
                </button>
              </>
            )}

            {isLocalProvider && (
              <>
                <a
                  href="/models"
                  className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                  title="Manage local provider in AI Models"
                >
                  <Edit2 className="w-4 h-4" />
                </a>
                <button
                  onClick={() => handleDeleteLocalProvider(provider.id, provider.name)}
                  className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Delete local provider"
                >
                  <Trash className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Docs link */}
            {provider.docsUrl && (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-gray-500 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                title="View documentation"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading providers...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Providers</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure provider settings like endpoint URLs and types. These settings survive
          models.dev sync.
        </p>
      </div>

      {cliProviders.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {cliProviders.length} CLI provider otomatik algılandı. Bunlar bu sayfadan
              ayrıntılı düzenlenemez. Ama OwnPilot içinden gizleyebilir veya tamamen kaldırmak
              için ilgili CLI&apos;ı sistemden kaldırabilirsin; API key gerekiyorsa
              {' '}
              <a href="/settings/api-keys" className="underline underline-offset-2">
                API Keys
              </a>
              {' '}
              sayfasını kullanın.
            </span>
          </p>
        </div>
      )}

      {cliProviders.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            CLI Runtime Providers ({cliProviders.length})
          </h4>
          <div className="grid gap-3 md:grid-cols-2">{cliProviders.map(renderProviderCard)}</div>
        </section>
      )}

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search providers..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'configured', 'unconfigured'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setFilterConfigured(filter)}
              className={`px-3 py-2 text-sm rounded-lg capitalize transition-colors ${
                filterConfigured === filter
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{providers.length}</p>
          <p className="text-sm text-gray-500">Total Providers</p>
        </div>
        <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {providers.filter((p) => p.isConfigured).length}
          </p>
          <p className="text-sm text-gray-500">Configured</p>
        </div>
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {providers.filter((p) => p.hasOverride).length}
          </p>
          <p className="text-sm text-gray-500">With Overrides</p>
        </div>
      </div>

      {/* Configured providers */}
      {configuredProviders.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Configured Providers ({configuredProviders.length})
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            {configuredProviders.map(renderProviderCard)}
          </div>
        </section>
      )}

      {/* Unconfigured providers */}
      {unconfiguredProviders.length > 0 && filterConfigured !== 'configured' && (
        <section>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Other Providers ({unconfiguredProviders.length})
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            {unconfiguredProviders.map(renderProviderCard)}
          </div>
        </section>
      )}

      {filteredProviders.length === 0 && (
        <div className="text-center py-12 text-gray-500">No providers match your search.</div>
      )}

      {cliRemovalProvider && cliRemovalInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Remove CLI Provider: {cliRemovalProvider.name}
                </h3>
                <button
                  onClick={() => setCliRemovalProviderId(null)}
                  className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
                <p>
                  Bu provider sistemde kurulu <span className="font-mono">{cliRemovalInfo.binary}</span>
                  {' '}binary&apos;sinden otomatik algılanıyor. Tamamen kaldırmak için aşağıdaki komutu
                  kullan.
                </p>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white mb-2">Kaldırma komutu</p>
                  <pre className="rounded-lg bg-gray-100 dark:bg-gray-900 px-3 py-3 overflow-x-auto text-xs font-mono text-gray-900 dark:text-gray-100">
                    {cliRemovalInfo.uninstallCommand}
                  </pre>
                </div>
                <div className="space-y-1">
                  <p>Alternatif olarak `{cliRemovalInfo.binary}` binary&apos;sini `PATH` dışına alabilirsin.</p>
                  <p>Ardından gateway&apos;i yeniden başlat. Provider listeden otomatik düşer.</p>
                  <p>OwnPilot içinde sadece gizlemek istiyorsan bu karttaki toggle&apos;ı kapatman yeterli.</p>
                  <p>
                    API key kullanıyorsan silmek için{' '}
                    <a href="/settings/api-keys" className="text-primary hover:underline">
                      API Keys
                    </a>{' '}
                    sayfasını kullan.
                  </p>
                </div>
              </div>

              <div className="flex justify-end mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setCliRemovalProviderId(null)}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal - HTTP providers only */}
      {editingProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Edit Provider: {providers.find((p) => p.id === editingProvider)?.name}
                </h3>
                <button
                  onClick={() => setEditingProvider(null)}
                  className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Provider Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Provider Type
                  </label>
                  <select
                    value={editForm.providerType}
                    onChange={(e) => setEditForm((f) => ({ ...f, providerType: e.target.value }))}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {PROVIDER_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Determines which API client is used for requests
                  </p>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={editForm.baseUrl}
                    onChange={(e) => setEditForm((f) => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    API endpoint for this provider (leave empty to use default)
                  </p>
                </div>

                {/* Enabled toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Enabled
                    </label>
                    <p className="text-xs text-gray-500">
                      Disabled providers won&apos;t appear in model selection
                    </p>
                  </div>
                  <button
                    onClick={() => setEditForm((f) => ({ ...f, isEnabled: !f.isEnabled }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      editForm.isEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        editForm.isEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional notes about this configuration..."
                    rows={2}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => handleResetOverride(editingProvider)}
                  className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                >
                  Reset to Default
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingProvider(null)}
                    className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
