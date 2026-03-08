/**
 * Coding Agent Settings Page
 *
 * Provider configuration: install status, API keys, version info,
 * test connectivity. Per-provider permissions, skills, budgets.
 * Accessible at /settings/coding-agents.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import { RefreshCw, Terminal, Shield, Puzzle, DollarSign, Lock } from '../components/icons';
import { codingAgentsApi } from '../api';
import type { CodingAgentStatus, CodingAgentTestResult } from '../api/endpoints/coding-agents';
import {
  ProvidersTab,
  PermissionsTab,
  SkillsTab,
  BudgetTab,
  SecurityTab,
} from './coding-agent-settings-tabs';

type SettingsTab = 'providers' | 'permissions' | 'skills' | 'budget' | 'security';

export function CodingAgentSettingsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
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
  const providerNames = statuses.map((s) => s.provider);

  const tabs: {
    id: SettingsTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'providers', label: 'Providers', icon: Terminal },
    { id: 'permissions', label: 'Permissions', icon: Shield },
    { id: 'skills', label: 'Skills', icon: Puzzle },
    { id: 'budget', label: 'Budget', icon: DollarSign },
    { id: 'security', label: 'Security', icon: Lock },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Coding Agent Settings
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border dark:border-dark-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'providers' && (
        <ProvidersTab
          statuses={statuses}
          testResults={testResults}
          testingProvider={testingProvider}
          isLoading={isLoading}
          onTest={handleTest}
        />
      )}
      {activeTab === 'permissions' && <PermissionsTab providers={providerNames} />}
      {activeTab === 'skills' && <SkillsTab providers={providerNames} />}
      {activeTab === 'budget' && <BudgetTab providers={providerNames} />}
      {activeTab === 'security' && <SecurityTab />}
    </div>
  );
}
