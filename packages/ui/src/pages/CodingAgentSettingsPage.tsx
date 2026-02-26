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
} from '../components/icons';
import { codingAgentsApi } from '../api';
import type { CodingAgentStatus, CodingAgentTestResult } from '../api/endpoints/coding-agents';

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
  const [isLoading, setIsLoading] = useState(true);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, CodingAgentTestResult>>({});

  const fetchStatuses = useCallback(async () => {
    try {
      setIsLoading(true);
      const statusData = await codingAgentsApi.status();
      setStatuses(statusData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load provider status');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

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

