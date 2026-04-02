/**
 * Wizards Page — Setup Wizard Launcher
 *
 * Card grid showing available setup wizards with completion status.
 * Each card links to a step-by-step wizard flow.
 */

import { useSearchParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  Key,
  Telegram,
  Wrench,
  Check,
  Sparkles,
  Bot,
  Code,
  GitBranch,
  Target,
  Zap,
  Link,
  ListChecks,
  Settings,
  Home,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';

// ============================================================================
// Wizard Definitions
// ============================================================================

interface WizardDef {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  time: string;
  color: string;
}

const WIZARDS: WizardDef[] = [
  {
    id: 'ai-provider',
    title: 'AI Provider Setup',
    description: 'Connect an AI provider like OpenAI or Anthropic and set your default model.',
    icon: Key,
    time: '~2 min',
    color: 'text-blue-500',
  },
  {
    id: 'telegram',
    title: 'Telegram Channel',
    description: 'Connect a Telegram bot so you can chat with your AI from your phone.',
    icon: Telegram,
    time: '~3 min',
    color: 'text-sky-500',
  },
  {
    id: 'mcp-server',
    title: 'MCP Server',
    description: 'Add an MCP server to extend your AI with external tools and services.',
    icon: Wrench,
    time: '~2 min',
    color: 'text-purple-500',
  },
  {
    id: 'agent',
    title: 'Create AI Agent',
    description: 'Build a custom AI agent with its own personality, model, and tool access.',
    icon: Bot,
    time: '~3 min',
    color: 'text-emerald-500',
  },
  {
    id: 'custom-tool',
    title: 'Custom Tool',
    description: 'Write a JavaScript tool that your AI can call during conversations.',
    icon: Code,
    time: '~5 min',
    color: 'text-orange-500',
  },
  {
    id: 'workflow',
    title: 'Create Workflow',
    description: 'Build an automation workflow with connected steps and AI-powered actions.',
    icon: GitBranch,
    time: '~3 min',
    color: 'text-indigo-500',
  },
  {
    id: 'goal',
    title: 'Set a Goal',
    description: 'Define a personal or professional goal and break it into actionable steps.',
    icon: Target,
    time: '~2 min',
    color: 'text-rose-500',
  },
  {
    id: 'trigger',
    title: 'Create Trigger',
    description: 'Set up scheduled or event-based automation that fires actions automatically.',
    icon: Zap,
    time: '~2 min',
    color: 'text-amber-500',
  },
  {
    id: 'connected-app',
    title: 'Connect an App',
    description: 'Link a third-party service like Google, GitHub, or Slack via OAuth.',
    icon: Link,
    time: '~3 min',
    color: 'text-teal-500',
  },
];

function isCompleted(wizardId: string): boolean {
  return localStorage.getItem(`ownpilot-wizard-${wizardId}`) === 'true';
}

// ============================================================================
// Component
// ============================================================================

export function WizardsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  type TabId = 'home' | 'wizards';
  const TAB_LABELS: Record<TabId, string> = { home: 'Home', wizards: 'Wizards' };

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'wizards'] as string[]).includes(tabParam) ? tabParam : 'home';

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:wizards:skipHome';
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

  // Auto-redirect to wizards if skipHome is enabled and no explicit tab param
  useEffect(() => {
    if (skipHome && !tabParam) {
      const params = new URLSearchParams(searchParams);
      params.set('tab', 'wizards');
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [skipHome, tabParam, searchParams, navigate]);

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  const completedCount = WIZARDS.filter((w) => isCompleted(w.id)).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Setup Wizards
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {completedCount} of {WIZARDS.length} wizards completed
          </p>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'wizards'] as TabId[]).map((tab) => (
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
            { icon: Sparkles, color: 'text-primary bg-primary/10' },
            { icon: ListChecks, color: 'text-violet-500 bg-violet-500/10' },
            { icon: Settings, color: 'text-emerald-500 bg-emerald-500/10' },
          ]}
          title="Setup Wizards"
          subtitle="Guided step-by-step wizards to help you configure features, connect services, and get started quickly."
          cta={{
            label: 'View Wizards',
            icon: Sparkles,
            onClick: () => setTab('wizards'),
          }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={handleSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to Wizards"
          features={[
            {
              icon: ListChecks,
              color: 'text-primary bg-primary/10',
              title: 'Step-by-Step',
              description: 'Follow guided steps to configure each feature correctly.',
            },
            {
              icon: Settings,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Auto-Configuration',
              description: 'Wizards handle complex setup so you do not have to.',
            },
            {
              icon: Sparkles,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Smart Defaults',
              description: 'Sensible defaults are pre-filled to get you started faster.',
            },
            {
              icon: Zap,
              color: 'text-amber-500 bg-amber-500/10',
              title: 'Quick Setup',
              description: 'Most wizards take just 2-3 minutes to complete.',
            },
          ]}
          steps={[
            { title: 'Choose a wizard', detail: 'Pick the feature you want to set up.' },
            { title: 'Follow guided steps', detail: 'Each wizard walks you through the process.' },
            { title: 'Review configuration', detail: 'Confirm your settings before applying.' },
            { title: 'Apply settings', detail: 'The wizard applies everything automatically.' },
          ]}
        />
      )}

      {activeTab === 'wizards' && (
        <>
          <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl mx-auto">
              {WIZARDS.map((w) => {
                const completed = isCompleted(w.id);
                const Icon = w.icon;
                return (
                  <button
                    key={w.id}
                    onClick={() => navigate(`/wizards/${w.id}`)}
                    className="group text-left p-6 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary hover:border-primary/50 dark:hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    {/* Icon + Badge */}
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className={`p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary ${w.color}`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      {completed && (
                        <span className="flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full">
                          <Check className="w-3 h-3" />
                          Done
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary mb-1 group-hover:text-primary transition-colors">
                      {w.title}
                    </h3>

                    {/* Description */}
                    <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4 line-clamp-2">
                      {w.description}
                    </p>

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted dark:text-dark-text-muted">
                        {w.time}
                      </span>
                      <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        {completed ? 'Run Again' : 'Start'} &rarr;
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
