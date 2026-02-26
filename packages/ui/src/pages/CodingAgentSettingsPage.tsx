/**
 * Coding Agent Settings Page
 *
 * Provider configuration: install status, API keys, version info,
 * test connectivity. Accessible at /settings/coding-agents.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Terminal,
  Key,
  ExternalLink,
  Play,
  AlertCircle,
  Plus,
  Trash2,
} from '../components/icons';
import { codingAgentsApi, cliProvidersApi } from '../api';
import type { CodingAgentStatus, CodingAgentTestResult, CliProviderRecord } from '../api/endpoints/coding-agents';

// =============================================================================
// Provider metadata
// =============================================================================

interface ProviderMeta {
  icon: string;
  description: string;
  installCommand: string;
  docsUrl: string;
  docsLabel: string;
  authInfo: string;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  'claude-code': {
    icon: 'C',
    description: 'Anthropic Claude Code — complex multi-file changes and refactoring.',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    docsUrl: 'https://console.anthropic.com',
    docsLabel: 'console.anthropic.com',
    authInfo: 'Claude Pro subscription or API key (ANTHROPIC_API_KEY)',
  },
  codex: {
    icon: 'O',
    description: 'OpenAI Codex CLI — code generation and test writing.',
    installCommand: 'npm i -g @openai/codex',
    docsUrl: 'https://platform.openai.com',
    docsLabel: 'platform.openai.com',
    authInfo: 'ChatGPT Plus subscription or API key (CODEX_API_KEY)',
  },
  'gemini-cli': {
    icon: 'G',
    description: 'Google Gemini CLI — code analysis and explanation.',
    installCommand: 'npm i -g @google/gemini-cli',
    docsUrl: 'https://aistudio.google.com',
    docsLabel: 'aistudio.google.com',
    authInfo: 'Google account login or API key (GEMINI_API_KEY)',
  },
};

const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  codex: 'bg-green-500/20 text-green-600 dark:text-green-400',
  'gemini-cli': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
};

// =============================================================================
// Main Component
// =============================================================================

export function CodingAgentSettingsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState<CodingAgentStatus[]>([]);
  const [customProviders, setCustomProviders] = useState<CliProviderRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, CodingAgentTestResult>>({});
  const [showAddProvider, setShowAddProvider] = useState(false);

  const fetchStatuses = useCallback(async () => {
    try {
      setIsLoading(true);
      const [statusData, providersData] = await Promise.all([
        codingAgentsApi.status(),
        cliProvidersApi.list().catch(() => []),
      ]);
      setStatuses(statusData);
      setCustomProviders(providersData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load provider status');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  const handleDeleteCustomProvider = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Delete custom provider "${name}"?`)) return;
      try {
        await cliProvidersApi.delete(id);
        setCustomProviders((prev) => prev.filter((p) => p.id !== id));
        toast.success(`Deleted provider "${name}"`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete provider');
      }
    },
    [toast]
  );

  const handleTestCustomProvider = useCallback(
    async (provider: CliProviderRecord) => {
      setTestingProvider(provider.id);
      try {
        const result = await cliProvidersApi.test(provider.id);
        if (result.installed) {
          toast.success(`${provider.displayName}: ${result.version ?? 'installed'}`);
        } else {
          toast.warning(`${provider.displayName}: binary "${provider.binary}" not found`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Test failed');
      } finally {
        setTestingProvider(null);
      }
    },
    [toast]
  );

  const handleTest = useCallback(
    async (provider: string) => {
      setTestingProvider(provider);
      try {
        const result = await codingAgentsApi.test(provider);
        setTestResults((prev) => ({ ...prev, [provider]: result }));
        if (result.available) {
          toast.success(`${provider} is ready`);
        } else {
          toast.warning(`${provider} test failed — check installation`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Test failed');
      } finally {
        setTestingProvider(null);
      }
    },
    [toast]
  );

  const installedCount = statuses.filter((s) => s.installed).length;

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Coding Agent Providers
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {installedCount} of {statuses.length} providers installed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatuses}
            disabled={isLoading}
            className="p-2 rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => navigate('/coding-agents')}
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5"
          >
            <Terminal className="w-4 h-4" />
            Open Terminal Sessions
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-600 dark:text-blue-400 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <strong>No API key required!</strong> All providers support subscription-based login
          (Claude Pro, ChatGPT Plus, Google account). API keys are optional — the CLI will prompt
          you to authenticate on first use in interactive mode.
        </div>
      </div>

      {/* Provider cards */}
      <div className="space-y-4">
        {statuses.map((status) => (
          <ProviderCard
            key={status.provider}
            status={status}
            testResult={testResults[status.provider]}
            testing={testingProvider === status.provider}
            onTest={() => handleTest(status.provider)}
          />
        ))}

        {statuses.length === 0 && !isLoading && (
          <div className="text-center py-12 text-text-muted dark:text-dark-text-muted">
            <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No providers found</p>
            <p className="text-xs mt-1">Restart the gateway to detect installed CLIs</p>
          </div>
        )}
      </div>

      {/* Custom CLI Providers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
              Custom CLI Providers
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Register any CLI tool as a coding agent provider
            </p>
          </div>
          <button
            onClick={() => setShowAddProvider(true)}
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Provider
          </button>
        </div>

        {customProviders.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted">
            <p className="text-sm">No custom providers registered</p>
            <p className="text-xs mt-1">Add tools like ESLint, Prettier, Docker, pytest, etc.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {customProviders.map((cp) => (
              <CustomProviderCard
                key={cp.id}
                provider={cp}
                testing={testingProvider === cp.id}
                onTest={() => handleTestCustomProvider(cp)}
                onDelete={() => handleDeleteCustomProvider(cp.id, cp.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Provider Modal */}
      {showAddProvider && (
        <AddProviderModal
          onClose={() => setShowAddProvider(false)}
          onCreated={(p) => {
            setCustomProviders((prev) => [...prev, p]);
            setShowAddProvider(false);
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Provider Card
// =============================================================================

function ProviderCard({
  status,
  testResult,
  testing,
  onTest,
}: {
  status: CodingAgentStatus;
  testResult?: CodingAgentTestResult;
  testing: boolean;
  onTest: () => void;
}) {
  const meta = PROVIDER_META[status.provider];
  const color = PROVIDER_COLORS[status.provider] ?? 'bg-gray-500/20 text-gray-500';

  return (
    <div className="p-4 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0 ${color}`}
        >
          {meta?.icon ?? '?'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              {status.displayName}
            </h3>
            {status.installed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Installed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-error/10 text-error">
                <XCircle className="w-2.5 h-2.5" />
                Not Installed
              </span>
            )}
            {status.configured && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                <Key className="w-2.5 h-2.5" />
                API Key
              </span>
            )}
          </div>

          <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
            {meta?.description}
          </p>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {status.version && (
              <div className="text-text-muted dark:text-dark-text-muted">
                Version: <span className="font-mono text-text-primary dark:text-dark-text-primary">{status.version}</span>
              </div>
            )}
            <div className="text-text-muted dark:text-dark-text-muted">
              PTY: {status.ptyAvailable ? (
                <span className="text-success">Available</span>
              ) : (
                <span className="text-error">Unavailable</span>
              )}
            </div>
            {meta?.authInfo && (
              <div className="col-span-2 text-text-muted dark:text-dark-text-muted">
                Auth: {meta.authInfo}
              </div>
            )}
          </div>

          {/* Install command (if not installed) */}
          {!status.installed && meta?.installCommand && (
            <div className="mt-3 p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
              <p className="text-[10px] text-text-muted dark:text-dark-text-muted mb-1">
                Install with:
              </p>
              <code className="text-xs font-mono text-text-primary dark:text-dark-text-primary select-all">
                {meta.installCommand}
              </code>
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={`mt-2 p-2 rounded-lg text-xs ${
                testResult.available
                  ? 'bg-success/10 text-success'
                  : 'bg-error/10 text-error'
              }`}
            >
              {testResult.available
                ? 'Test passed — provider is ready to use'
                : 'Test failed — provider is not available'}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onTest}
            disabled={testing || !status.installed}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            {testing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Test
          </button>
          {meta?.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Docs
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Custom Provider Card
// =============================================================================

function CustomProviderCard({
  provider,
  testing,
  onTest,
  onDelete,
}: {
  provider: CliProviderRecord;
  testing: boolean;
  onTest: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="p-4 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0 bg-purple-500/20 text-purple-600 dark:text-purple-400">
          {provider.icon ?? provider.displayName.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              {provider.displayName}
            </h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400">
              custom:{provider.name}
            </span>
            {!provider.isActive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-500/10 text-gray-500">
                Disabled
              </span>
            )}
          </div>

          {provider.description && (
            <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
              {provider.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted dark:text-dark-text-muted">
            <div>
              Binary: <span className="font-mono text-text-primary dark:text-dark-text-primary">{provider.binary}</span>
            </div>
            <div>Category: {provider.category}</div>
            {provider.authMethod !== 'none' && (
              <div>Auth: {provider.authMethod === 'config_center' ? 'Config Center' : 'Env Var'}</div>
            )}
            {provider.promptTemplate && (
              <div className="col-span-2">Has prompt template</div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onTest}
            disabled={testing}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            {testing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Test
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-error border border-error/30 hover:bg-error/10 transition-colors inline-flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Add Provider Modal
// =============================================================================

function AddProviderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (provider: CliProviderRecord) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [binary, setBinary] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !displayName || !binary) return;
    setCreating(true);
    try {
      const provider = await cliProvidersApi.create({
        name,
        display_name: displayName,
        binary,
        description: description || undefined,
        category: category || undefined,
        prompt_template: promptTemplate || undefined,
      });
      toast.success(`Provider "${displayName}" created`);
      onCreated(provider);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create provider');
    } finally {
      setCreating(false);
    }
  };

  // Auto-generate name from display name
  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val);
    if (!name || name === displayNameToSlug(displayName)) {
      setName(displayNameToSlug(val));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">
            Register Custom CLI Provider
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  placeholder="My Tool"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  ID (slug) *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-tool"
                  pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[10px] text-text-muted dark:text-dark-text-muted mt-0.5">
                  Used as custom:{name || '...'}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Binary *
              </label>
              <input
                type="text"
                value={binary}
                onChange={(e) => setBinary(e.target.value)}
                placeholder="eslint, docker, pytest, etc."
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this tool does..."
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="general">General</option>
                  <option value="linter">Linter</option>
                  <option value="formatter">Formatter</option>
                  <option value="testing">Testing</option>
                  <option value="build">Build</option>
                  <option value="devops">DevOps</option>
                  <option value="ai">AI</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Prompt Template
              </label>
              <textarea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder="{prompt} — use {prompt}, {cwd}, {model} placeholders. Leave empty to pass prompt as single argument."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name || !displayName || !binary || creating}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {creating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Create Provider
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function displayNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
