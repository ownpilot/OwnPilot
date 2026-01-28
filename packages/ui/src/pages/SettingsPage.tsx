import { useState, useEffect } from 'react';
import { Settings, Check, AlertCircle, ChevronDown, ChevronRight, Key, Link, Image, Cpu, Server, Container, RefreshCw, ShieldCheck, Shield, XCircle, CheckCircle2, Database, Upload, Download, Trash2, Wrench } from '../components/icons';
import { IntegrationsTab } from '../components/IntegrationsTab';
import { MediaSettingsTab } from '../components/MediaSettingsTab';
import { AIModelsTab } from '../components/AIModelsTab';
import { ProvidersTab } from '../components/ProvidersTab';
import { useTheme } from '../hooks/useTheme';

type SettingsTab = 'api-keys' | 'providers' | 'integrations' | 'media' | 'ai-models' | 'system';

interface ProviderConfig {
  id: string;
  name: string;
  apiKeyEnv: string;
  baseUrl?: string;
  docsUrl?: string;
  models?: { id: string; name: string }[];
  apiKeyPlaceholder?: string;
  color?: string;
}

interface ProviderCategory {
  name: string;
  providers: ProviderConfig[];
}

interface SettingsResponse {
  success: boolean;
  data: {
    configuredProviders: string[];
    demoMode: boolean;
    availableProviders: string[];
    defaultProvider: string | null;
    defaultModel: string | null;
  };
}

interface ProvidersResponse {
  success: boolean;
  data: {
    providers: ProviderConfig[];
    total: number;
  };
}

interface CategoriesResponse {
  success: boolean;
  data: {
    categories: Record<string, string[]>;
    uncategorized: string[];
  };
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  recommended?: boolean;
}

interface ModelsResponse {
  success: boolean;
  data: {
    models: ModelInfo[];
    configuredProviders: string[];
  };
}

interface SandboxStatus {
  dockerAvailable: boolean;
  dockerVersion: string | null;
  codeExecutionEnabled: boolean;
  securityMode: 'strict' | 'relaxed';
}

interface DatabaseStatus {
  type: 'postgres';
  connected: boolean;
  host?: string;
}

interface BackupInfo {
  name: string;
  size: number;
  created: string;
}

interface DatabaseStats {
  database: { size: string; sizeBytes: number };
  tables: { name: string; rowCount: number; size: string }[];
  connections: { active: number; max: number };
  version: string;
}

interface HealthResponse {
  success: boolean;
  data: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    uptime: number;
    database: DatabaseStatus;
    sandbox: SandboxStatus;
  };
}

// Empty fallback - API should always provide providers
const FALLBACK_PROVIDERS: ProviderConfig[] = [];

// Helper to format uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('api-keys');
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

  // System status
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null);
  const [systemVersion, setSystemVersion] = useState<string>('');
  const [systemUptime, setSystemUptime] = useState<number>(0);
  const [isLoadingSystem, setIsLoadingSystem] = useState(false);

  // Database operations state
  const [dbOperationRunning, setDbOperationRunning] = useState(false);
  const [dbOperationType, setDbOperationType] = useState<string>('');
  const [dbOperationOutput, setDbOperationOutput] = useState<string[]>([]);
  const [dbOperationResult, setDbOperationResult] = useState<'success' | 'failure' | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);

  // Theme hook
  const { theme, setTheme } = useTheme();

  // Load settings on mount
  useEffect(() => {
    loadData();
    loadSystemStatus();
  }, []);

  const loadSystemStatus = async () => {
    setIsLoadingSystem(true);
    try {
      const [healthRes, dbStatusRes, statsRes] = await Promise.all([
        fetch('/api/v1/health'),
        fetch('/api/v1/database/status'),
        fetch('/api/v1/database/stats').catch(() => null),
      ]);

      const healthData: HealthResponse = await healthRes.json();
      if (healthData.success && healthData.data) {
        setSandboxStatus(healthData.data.sandbox);
        setDatabaseStatus(healthData.data.database);
        setSystemVersion(healthData.data.version);
        setSystemUptime(healthData.data.uptime);
      }

      const dbStatusData = await dbStatusRes.json();
      if (dbStatusData.success && dbStatusData.data) {
        setBackups(dbStatusData.data.backups || []);
      }

      if (statsRes) {
        const statsData = await statsRes.json();
        if (statsData.success && statsData.data) {
          setDbStats(statsData.data);
        }
      }
    } catch (err) {
      console.error('Failed to load system status:', err);
    } finally {
      setIsLoadingSystem(false);
    }
  };

  // Generic database operation handler
  const runDbOperation = async (
    endpoint: string,
    operationType: string,
    body: Record<string, unknown> = {}
  ) => {
    setDbOperationRunning(true);
    setDbOperationType(operationType);
    setDbOperationOutput([]);
    setDbOperationResult(null);

    try {
      const res = await fetch(`/api/v1/database/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.success) {
        setDbOperationOutput([data.error?.message || `${operationType} failed to start`]);
        setDbOperationResult('failure');
        setDbOperationRunning(false);
        return;
      }

      setDbOperationOutput([`${operationType} started...`]);

      // Poll for status
      const pollStatus = async () => {
        const statusRes = await fetch('/api/v1/database/operation/status');
        const statusData = await statusRes.json();

        if (statusData.success && statusData.data) {
          setDbOperationOutput(statusData.data.output || []);

          if (!statusData.data.isRunning) {
            setDbOperationResult(statusData.data.lastResult || 'failure');
            setDbOperationRunning(false);
            loadSystemStatus(); // Refresh
            return;
          }

          setTimeout(pollStatus, 1000);
        }
      };

      setTimeout(pollStatus, 1000);
    } catch (err) {
      console.error(`${operationType} error:`, err);
      setDbOperationOutput([`Failed to start ${operationType.toLowerCase()}`]);
      setDbOperationResult('failure');
      setDbOperationRunning(false);
    }
  };

  const createBackup = () => runDbOperation('backup', 'Backup', { format: 'sql' });
  const runMaintenance = (type: string) => runDbOperation('maintenance', `Maintenance (${type})`, { type });
  const restoreBackup = (filename: string) => runDbOperation('restore', 'Restore', { filename });

  const deleteBackup = async (filename: string) => {
    if (!confirm(`Delete backup "${filename}"?`)) return;

    try {
      const res = await fetch(`/api/v1/database/backup/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        loadSystemStatus();
      } else {
        alert(data.error?.message || 'Failed to delete backup');
      }
    } catch (err) {
      console.error('Delete backup error:', err);
      alert('Failed to delete backup');
    }
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const loadData = async () => {
    try {
      // Load settings, providers, categories, and models in parallel
      const [settingsRes, providersRes, categoriesRes, modelsRes] = await Promise.all([
        fetch('/api/v1/settings'),
        fetch('/api/v1/providers'),
        fetch('/api/v1/providers/categories'),
        fetch('/api/v1/models'),
      ]);

      const settingsData: SettingsResponse = await settingsRes.json();
      if (settingsData.success) {
        setConfiguredProviders(settingsData.data.configuredProviders);
        // Set default provider from settings or first configured
        if (settingsData.data.defaultProvider) {
          setDefaultProvider(settingsData.data.defaultProvider);
        } else if (settingsData.data.configuredProviders.length > 0) {
          setDefaultProvider(settingsData.data.configuredProviders[0]);
        }
        if (settingsData.data.defaultModel) {
          setDefaultModel(settingsData.data.defaultModel);
        }
      }

      const providersData: ProvidersResponse = await providersRes.json();
      if (providersData.success && providersData.data.providers.length > 0) {
        setProviders(providersData.data.providers);
      } else {
        setProviders(FALLBACK_PROVIDERS);
      }

      const categoriesData: CategoriesResponse = await categoriesRes.json();
      if (categoriesData.success) {
        setCategories(categoriesData.data.categories);
        setUncategorized(categoriesData.data.uncategorized);
      }

      const modelsData: ModelsResponse = await modelsRes.json();
      if (modelsData.success) {
        setModels(modelsData.data.models);
        // Set default model from first model of default provider if not set
        if (!settingsData.data?.defaultModel && modelsData.data.models.length > 0) {
          const providerToUse = settingsData.data?.defaultProvider || settingsData.data?.configuredProviders?.[0];
          if (providerToUse) {
            const firstModel = modelsData.data.models.find((m) => m.provider === providerToUse);
            if (firstModel) {
              setDefaultModel(firstModel.id);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load data:', err);
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
          const response = await fetch('/api/v1/settings/api-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, apiKey }),
          });

          if (!response.ok) {
            throw new Error(`Failed to save ${provider} API key`);
          }

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
      console.error('Failed to save settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDefaultProviderChange = async (providerId: string) => {
    setDefaultProvider(providerId);

    // Save to backend
    try {
      const response = await fetch('/api/v1/settings/default-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });

      if (!response.ok) {
        throw new Error('Failed to save default provider');
      }

      // Update default model to first model of this provider
      const providerModels = models.filter((m) => m.provider === providerId);
      if (providerModels.length > 0) {
        const recommended = providerModels.find((m) => m.recommended);
        const newModel = recommended?.id ?? providerModels[0].id;
        setDefaultModel(newModel);
        await handleDefaultModelChange(newModel);
      }
    } catch (err) {
      console.error('Failed to save default provider:', err);
      setError('Failed to save default provider');
    }
  };

  const handleDefaultModelChange = async (modelId: string) => {
    setDefaultModel(modelId);

    // Save to backend
    try {
      await fetch('/api/v1/settings/default-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      });
    } catch (err) {
      console.error('Failed to save default model:', err);
    }
  };

  const handleDeleteKey = async (providerId: string) => {
    if (!confirm(`Are you sure you want to remove the ${providerId} API key?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/settings/api-keys/${providerId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete ${providerId} API key`);
      }

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
          await handleDefaultProviderChange(remaining[0]);
        } else {
          setDefaultProvider('');
          setDefaultModel('');
        }
      }
    } catch (err) {
      console.error('Failed to delete API key:', err);
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
    return providers.find((p) => p.id === id);
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
    const hasNewValue = apiKeys[provider.id] && apiKeys[provider.id].trim();

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

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'api-keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
    { id: 'providers', label: 'Providers', icon: <Server className="w-4 h-4" /> },
    { id: 'ai-models', label: 'AI Models', icon: <Cpu className="w-4 h-4" /> },
    { id: 'integrations', label: 'Integrations', icon: <Link className="w-4 h-4" /> },
    { id: 'media', label: 'Media Settings', icon: <Image className="w-4 h-4" /> },
    { id: 'system', label: 'System', icon: <Container className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-6 pt-4 border-b border-border dark:border-dark-border">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Settings
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Configure your AI gateway with 80+ providers
          </p>
        </div>

        {/* Tab Navigation */}
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-bg-primary dark:bg-dark-bg-primary text-primary border-b-2 border-primary -mb-px'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* AI Models Tab */}
        {activeTab === 'ai-models' && <AIModelsTab />}

        {/* Providers Tab */}
        {activeTab === 'providers' && <ProvidersTab />}

        {/* Integrations Tab */}
        {activeTab === 'integrations' && <IntegrationsTab />}

        {/* Media Settings Tab */}
        {activeTab === 'media' && <MediaSettingsTab />}

        {/* System Tab */}
        {activeTab === 'system' && (
          <div className="max-w-2xl space-y-6">
            {/* Docker Sandbox Status */}
            <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                  <Container className="w-5 h-5" />
                  Docker Sandbox Status
                </h3>
                <button
                  onClick={loadSystemStatus}
                  disabled={isLoadingSystem}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingSystem ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {isLoadingSystem ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
                </div>
              ) : sandboxStatus ? (
                <div className="space-y-4">
                  {/* Docker Available */}
                  <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <div className="flex items-center gap-3">
                      {sandboxStatus.dockerAvailable ? (
                        <CheckCircle2 className="w-5 h-5 text-success" />
                      ) : (
                        <XCircle className="w-5 h-5 text-error" />
                      )}
                      <div>
                        <p className="font-medium text-text-primary dark:text-dark-text-primary">
                          Docker
                        </p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted">
                          Container runtime for code isolation
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-medium ${sandboxStatus.dockerAvailable ? 'text-success' : 'text-error'}`}>
                      {sandboxStatus.dockerAvailable ? 'Available' : 'Not Available'}
                    </span>
                  </div>

                  {/* Docker Version */}
                  {sandboxStatus.dockerAvailable && sandboxStatus.dockerVersion && (
                    <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Server className="w-5 h-5 text-info" />
                        <div>
                          <p className="font-medium text-text-primary dark:text-dark-text-primary">
                            Docker Version
                          </p>
                          <p className="text-sm text-text-muted dark:text-dark-text-muted">
                            Installed Docker engine version
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-mono text-text-secondary dark:text-dark-text-secondary">
                        v{sandboxStatus.dockerVersion}
                      </span>
                    </div>
                  )}

                  {/* Code Execution */}
                  <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <div className="flex items-center gap-3">
                      {sandboxStatus.codeExecutionEnabled ? (
                        <CheckCircle2 className="w-5 h-5 text-success" />
                      ) : (
                        <XCircle className="w-5 h-5 text-error" />
                      )}
                      <div>
                        <p className="font-medium text-text-primary dark:text-dark-text-primary">
                          Code Execution
                        </p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted">
                          Python, JavaScript, Shell execution in sandbox
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-medium ${sandboxStatus.codeExecutionEnabled ? 'text-success' : 'text-error'}`}>
                      {sandboxStatus.codeExecutionEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>

                  {/* Security Mode */}
                  <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <div className="flex items-center gap-3">
                      {sandboxStatus.securityMode === 'strict' ? (
                        <ShieldCheck className="w-5 h-5 text-success" />
                      ) : (
                        <Shield className="w-5 h-5 text-warning" />
                      )}
                      <div>
                        <p className="font-medium text-text-primary dark:text-dark-text-primary">
                          Security Mode
                        </p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted">
                          {sandboxStatus.securityMode === 'strict'
                            ? 'Full isolation with --no-new-privileges'
                            : 'Relaxed mode (some flags disabled)'}
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-medium ${sandboxStatus.securityMode === 'strict' ? 'text-success' : 'text-warning'}`}>
                      {sandboxStatus.securityMode === 'strict' ? 'Strict' : 'Relaxed'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
                  <p>Unable to load sandbox status</p>
                </div>
              )}

              {/* Docker Not Available Warning */}
              {sandboxStatus && !sandboxStatus.dockerAvailable && (
                <div className="mt-4 p-4 bg-error/10 border border-error/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-error">Docker Required for Code Execution</p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                        Code execution tools (execute_python, execute_javascript, execute_shell) require Docker for security isolation.
                        Without Docker, all code execution is disabled.
                      </p>
                      <a
                        href="https://docs.docker.com/get-docker/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
                      >
                        Install Docker
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Database Status */}
            <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
                <Database className="w-5 h-5" />
                Database
              </h3>

              {databaseStatus ? (
                <div className="space-y-4">
                  {/* Database Type & Stats */}
                  <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <div className="flex items-center gap-3">
                      <Database className="w-5 h-5 text-info" />
                      <div>
                        <p className="font-medium text-text-primary dark:text-dark-text-primary">
                          PostgreSQL Database
                        </p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted">
                          {dbStats ? `${dbStats.database.size} • ${dbStats.tables.length} tables` : 'Production-ready relational database'}
                        </p>
                      </div>
                    </div>
                    <span className="px-3 py-1 text-sm font-medium rounded-full bg-info/10 text-info">
                      PostgreSQL
                    </span>
                  </div>

                  {/* Connection Status */}
                  <div className="flex items-center justify-between p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <div className="flex items-center gap-3">
                      {databaseStatus.connected ? (
                        <CheckCircle2 className="w-5 h-5 text-success" />
                      ) : (
                        <XCircle className="w-5 h-5 text-error" />
                      )}
                      <div>
                        <p className="font-medium text-text-primary dark:text-dark-text-primary">
                          Connection Status
                        </p>
                        <p className="text-sm text-text-muted dark:text-dark-text-muted">
                          {databaseStatus.host ? `Host: ${databaseStatus.host}` : 'Connecting...'}
                          {dbStats && ` • ${dbStats.connections.active}/${dbStats.connections.max} connections`}
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-medium ${databaseStatus.connected ? 'text-success' : 'text-error'}`}>
                      {databaseStatus.connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>

                  {/* Connection Help */}
                  {!databaseStatus.connected && (
                    <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-warning">Database Not Connected</p>
                          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                            Make sure PostgreSQL is running and configured correctly.
                          </p>
                          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-2">
                            Start PostgreSQL with: <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">docker compose -f docker-compose.db.yml up -d</code>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Backup & Maintenance */}
                  {databaseStatus.connected && (
                    <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Download className="w-5 h-5 text-primary" />
                          <div>
                            <p className="font-medium text-text-primary dark:text-dark-text-primary">Backup & Maintenance</p>
                            <p className="text-sm text-text-muted dark:text-dark-text-muted">Create backups and optimize database</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={createBackup}
                            disabled={dbOperationRunning}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                          >
                            {dbOperationRunning && dbOperationType === 'Backup' ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                            Backup
                          </button>
                          <button
                            onClick={() => runMaintenance('vacuum')}
                            disabled={dbOperationRunning}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary disabled:opacity-50 transition-colors"
                            title="VACUUM - reclaim storage"
                          >
                            {dbOperationRunning && dbOperationType.includes('vacuum') ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Wrench className="w-4 h-4" />
                            )}
                            Optimize
                          </button>
                        </div>
                      </div>

                      {/* Backups List */}
                      {backups.length > 0 && (
                        <div className="border-t border-border dark:border-dark-border pt-4">
                          <p className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                            Available Backups ({backups.length})
                          </p>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {backups.map((backup) => (
                              <div key={backup.name} className="flex items-center justify-between p-2 bg-bg-primary dark:bg-dark-bg-primary rounded-lg">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-mono text-text-primary dark:text-dark-text-primary truncate">{backup.name}</p>
                                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                                    {formatSize(backup.size)} • {new Date(backup.created).toLocaleString()}
                                  </p>
                                </div>
                                <div className="flex gap-1 ml-2">
                                  <button
                                    onClick={() => restoreBackup(backup.name)}
                                    disabled={dbOperationRunning}
                                    className="p-1.5 text-primary hover:bg-primary/10 rounded disabled:opacity-50"
                                    title="Restore this backup"
                                  >
                                    <Upload className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => deleteBackup(backup.name)}
                                    disabled={dbOperationRunning}
                                    className="p-1.5 text-error hover:bg-error/10 rounded disabled:opacity-50"
                                    title="Delete this backup"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Operation Output */}
                      {dbOperationOutput.length > 0 && (
                        <div className="border-t border-border dark:border-dark-border pt-4">
                          <div className="p-3 bg-bg-primary dark:bg-dark-bg-primary rounded-lg max-h-32 overflow-y-auto">
                            <pre className="text-xs font-mono text-text-muted dark:text-dark-text-muted whitespace-pre-wrap">
                              {dbOperationOutput.join('\n')}
                            </pre>
                          </div>
                        </div>
                      )}

                      {/* Operation Result */}
                      {dbOperationResult && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg ${
                          dbOperationResult === 'success'
                            ? 'bg-success/10 text-success'
                            : 'bg-error/10 text-error'
                        }`}>
                          {dbOperationResult === 'success' ? (
                            <>
                              <CheckCircle2 className="w-4 h-4" />
                              <span className="text-sm font-medium">{dbOperationType} completed successfully!</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-4 h-4" />
                              <span className="text-sm font-medium">{dbOperationType} failed. Check output above.</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
                  <p>Unable to load database status</p>
                </div>
              )}
            </section>

            {/* System Information */}
            <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
                System Information
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">Version</p>
                  <p className="font-mono text-text-primary dark:text-dark-text-primary">
                    {systemVersion || 'Unknown'}
                  </p>
                </div>
                <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">Uptime</p>
                  <p className="font-mono text-text-primary dark:text-dark-text-primary">
                    {systemUptime > 0 ? formatUptime(systemUptime) : 'Unknown'}
                  </p>
                </div>
              </div>
            </section>

            {/* Security Information */}
            <section className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Sandbox Security
              </h3>
              <div className="space-y-3 text-sm text-text-muted dark:text-dark-text-muted">
                <p>
                  <strong className="text-text-secondary dark:text-dark-text-secondary">Network Isolation:</strong>{' '}
                  Code runs with <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">--network=none</code>, preventing all network access
                </p>
                <p>
                  <strong className="text-text-secondary dark:text-dark-text-secondary">Resource Limits:</strong>{' '}
                  Memory (256MB), CPU (1 core), processes (100 max), execution time (30s)
                </p>
                <p>
                  <strong className="text-text-secondary dark:text-dark-text-secondary">Filesystem:</strong>{' '}
                  Read-only root filesystem with isolated <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">/sandbox</code> directory
                </p>
                <p>
                  <strong className="text-text-secondary dark:text-dark-text-secondary">User Isolation:</strong>{' '}
                  Runs as nobody user (UID 65534) with no host information leakage
                </p>
                <p>
                  <strong className="text-text-secondary dark:text-dark-text-secondary">Capabilities:</strong>{' '}
                  All Linux capabilities dropped, privilege escalation blocked
                </p>
              </div>
            </section>
          </div>
        )}

        {/* API Keys Tab */}
        {activeTab === 'api-keys' && (isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading settings...</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-8">
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

            {/* Appearance */}
            <section>
              <h3 className="text-base font-medium text-text-primary dark:text-dark-text-primary mb-4">
                Appearance
              </h3>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Theme
                </label>
                <div className="flex gap-2">
                  {(['system', 'light', 'dark'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => setTheme(option)}
                      className={`px-4 py-2 rounded-lg capitalize transition-colors ${
                        theme === option
                          ? 'bg-primary text-white'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
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
        ))}
      </div>
    </div>
  );
}
