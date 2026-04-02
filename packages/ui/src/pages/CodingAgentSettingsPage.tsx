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
import {
  RefreshCw,
  Terminal,
  Shield,
  Puzzle,
  DollarSign,
  Lock,
  Home,
  Layers,
  BookOpen,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';
import { codingAgentsApi } from '../api';
import type { CodingAgentStatus, CodingAgentTestResult } from '../api/endpoints/coding-agents';
import {
  ProvidersTab,
  PermissionsTab,
  SkillsTab,
  BudgetTab,
  SecurityTab,
} from './coding-agent-settings-tabs';

type SettingsTab = 'home' | 'providers' | 'permissions' | 'skills' | 'budget' | 'security';

export function CodingAgentSettingsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>('home');

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:codingagentsettings:skipHome';
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

  // Auto-redirect to providers if skipHome is enabled
  useEffect(() => {
    if (skipHome) {
      setActiveTab('providers');
    }
  }, [skipHome]);
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
    { id: 'home', label: 'Home', icon: Home },
    { id: 'providers', label: 'Providers', icon: Terminal },
    { id: 'permissions', label: 'Permissions', icon: Shield },
    { id: 'skills', label: 'Skills', icon: Puzzle },
    { id: 'budget', label: 'Budget', icon: DollarSign },
    { id: 'security', label: 'Security', icon: Lock },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
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
      </header>

      {/* Tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'home' && (
          <PageHomeTab
            heroIcons={[
              { icon: Terminal, color: 'text-primary bg-primary/10' },
              { icon: Shield, color: 'text-violet-500 bg-violet-500/10' },
              { icon: DollarSign, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Configure Coding Agents"
            subtitle="Set up providers, permissions, skills, budgets, and security rules for your AI coding assistants."
            cta={{
              label: 'View Providers',
              icon: Terminal,
              onClick: () => setActiveTab('providers'),
            }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Providers"
            features={[
              {
                icon: Layers,
                color: 'text-primary bg-primary/10',
                title: 'Provider Setup',
                description: 'Install and configure coding agent providers.',
              },
              {
                icon: Lock,
                color: 'text-orange-500 bg-orange-500/10',
                title: 'Permission Control',
                description: 'Set boundaries for what agents can do.',
              },
              {
                icon: BookOpen,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Skill Packs',
                description: 'Enable relevant skill packs for your agents.',
              },
              {
                icon: DollarSign,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Budget Limits',
                description: 'Control spending and usage limits.',
              },
            ]}
            steps={[
              { title: 'Add coding providers', detail: 'Install and configure agent backends.' },
              {
                title: 'Set permission boundaries',
                detail: 'Define what actions agents can take.',
              },
              { title: 'Enable relevant skills', detail: 'Choose skill packs for your workflow.' },
              {
                title: 'Configure budget & security',
                detail: 'Set spending limits and security rules.',
              },
            ]}
            quickActions={[
              {
                icon: Terminal,
                label: 'Providers',
                description: 'Manage coding agent providers.',
                onClick: () => setActiveTab('providers'),
              },
              {
                icon: Shield,
                label: 'Permissions',
                description: 'Configure agent permissions.',
                onClick: () => setActiveTab('permissions'),
              },
              {
                icon: Puzzle,
                label: 'Skills',
                description: 'Manage skill packs.',
                onClick: () => setActiveTab('skills'),
              },
              {
                icon: DollarSign,
                label: 'Budget',
                description: 'Set budget and usage limits.',
                onClick: () => setActiveTab('budget'),
              },
              {
                icon: Lock,
                label: 'Security',
                description: 'Configure security rules.',
                onClick: () => setActiveTab('security'),
              },
            ]}
          />
        )}
        {activeTab !== 'home' && (
          <div className="p-6 max-w-3xl mx-auto w-full space-y-6">
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
        )}
      </div>
    </div>
  );
}
