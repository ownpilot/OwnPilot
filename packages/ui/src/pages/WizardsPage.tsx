/**
 * Wizards Page — Setup Wizard Launcher
 *
 * Card grid showing available setup wizards with completion status,
 * category filters, search, and pre-flight requirement chips.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSkipHome } from '../hooks/useSkipHome';
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
  Cpu,
  Database,
  Layers,
  Search,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';
import { providersApi, composioApi, edgeApi } from '../api';
import { silentCatch } from '../utils/ignore-error';
import { isAiAvailableSync, isAiAvailable } from './wizards/ai-helper';

// ============================================================================
// Wizard Definitions
// ============================================================================

type Category = 'setup' | 'channels' | 'agents' | 'automation' | 'personal' | 'data';
type Requirement = 'ai-provider' | 'composio' | 'mqtt';

interface WizardDef {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  time: string;
  color: string;
  category: Category;
  requires?: Requirement[];
}

const CATEGORY_LABELS: Record<Category, string> = {
  setup: 'Setup',
  channels: 'Channels',
  agents: 'Agents',
  automation: 'Automation',
  personal: 'Personal',
  data: 'Data & Plugins',
};

const WIZARDS: WizardDef[] = [
  {
    id: 'ai-provider',
    title: 'AI Provider Setup',
    description: 'Connect an AI provider like OpenAI or Anthropic and set your default model.',
    icon: Key,
    time: '~2 min',
    color: 'text-blue-500',
    category: 'setup',
  },
  {
    id: 'mcp-server',
    title: 'MCP Server',
    description: 'Add an MCP server to extend your AI with external tools and services.',
    icon: Wrench,
    time: '~2 min',
    color: 'text-purple-500',
    category: 'setup',
  },
  {
    id: 'plugin',
    title: 'Activate a Plugin',
    description: 'Browse installed plugins and enable the ones you need.',
    icon: Settings,
    time: '~1 min',
    color: 'text-slate-500',
    category: 'setup',
  },
  {
    id: 'skill',
    title: 'Install a Skill',
    description: 'Search npm for OwnPilot skills and add them to your AI.',
    icon: Layers,
    time: '~2 min',
    color: 'text-cyan-500',
    category: 'setup',
  },
  {
    id: 'telegram',
    title: 'Telegram Channel',
    description: 'Connect a Telegram bot so you can chat with your AI from your phone.',
    icon: Telegram,
    time: '~3 min',
    color: 'text-sky-500',
    category: 'channels',
  },
  {
    id: 'channel',
    title: 'Connect a Channel',
    description: 'Set up Discord, Slack, WhatsApp, Email, SMS, Matrix, or WebChat.',
    icon: Link,
    time: '~3 min',
    color: 'text-blue-600',
    category: 'channels',
  },
  {
    id: 'connected-app',
    title: 'Connect an App',
    description: 'Link a third-party service like Google, GitHub, or Slack via OAuth.',
    icon: Link,
    time: '~3 min',
    color: 'text-teal-500',
    category: 'channels',
    requires: ['composio'],
  },
  {
    id: 'agent',
    title: 'Create AI Agent',
    description: 'Build a custom AI agent with its own personality, model, and tool access.',
    icon: Bot,
    time: '~3 min',
    color: 'text-emerald-500',
    category: 'agents',
    requires: ['ai-provider'],
  },
  {
    id: 'claw',
    title: 'Create a Claw',
    description:
      'An autonomous agent that runs on its own — continuous, scheduled, or event-driven.',
    icon: Sparkles,
    time: '~4 min',
    color: 'text-fuchsia-500',
    category: 'agents',
    requires: ['ai-provider'],
  },
  {
    id: 'custom-tool',
    title: 'Custom Tool',
    description: 'Write a JavaScript tool that your AI can call during conversations.',
    icon: Code,
    time: '~5 min',
    color: 'text-orange-500',
    category: 'agents',
  },
  {
    id: 'workflow',
    title: 'Create Workflow',
    description: 'Build an automation workflow with connected steps and AI-powered actions.',
    icon: GitBranch,
    time: '~3 min',
    color: 'text-indigo-500',
    category: 'automation',
  },
  {
    id: 'trigger',
    title: 'Create Trigger',
    description: 'Set up scheduled or event-based automation that fires actions automatically.',
    icon: Zap,
    time: '~2 min',
    color: 'text-amber-500',
    category: 'automation',
  },
  {
    id: 'goal',
    title: 'Set a Goal',
    description: 'Define a personal or professional goal and break it into actionable steps.',
    icon: Target,
    time: '~2 min',
    color: 'text-rose-500',
    category: 'personal',
  },
  {
    id: 'habit',
    title: 'Track a Habit',
    description: 'Build a habit with streaks, daily targets, and reminders.',
    icon: ListChecks,
    time: '~2 min',
    color: 'text-pink-500',
    category: 'personal',
  },
  {
    id: 'edge-device',
    title: 'Pair Edge Device',
    description: 'Register an IoT device via MQTT with sensors and actuators.',
    icon: Cpu,
    time: '~3 min',
    color: 'text-lime-600',
    category: 'data',
    requires: ['mqtt'],
  },
  {
    id: 'backup',
    title: 'Backup & Restore',
    description: 'Snapshot your data, export to JSON, or restore from a previous export.',
    icon: Database,
    time: '~2 min',
    color: 'text-yellow-600',
    category: 'data',
  },
];

function isCompleted(wizardId: string): boolean {
  return localStorage.getItem(`ownpilot-wizard-${wizardId}`) === 'true';
}

function hasDraft(wizardId: string): boolean {
  return localStorage.getItem(`ownpilot-wizard-draft:${wizardId}`) !== null;
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

  const { skipHome, onSkipHomeChange } = useSkipHome({
    pageName: 'wizards',
    defaultTab: 'wizards',
  });

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  // ---- Filters ----
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');

  // ---- Requirement availability ----
  const [aiReady, setAiReady] = useState<boolean | undefined>(isAiAvailableSync());
  const [composioReady, setComposioReady] = useState<boolean | undefined>(undefined);
  const [mqttReady, setMqttReady] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (aiReady === undefined) {
      isAiAvailable().then(setAiReady);
    }
    providersApi
      .list()
      .then((d) => {
        const anyConfigured = d.providers.some((p) => 'isConfigured' in p && p.isConfigured);
        setAiReady((prev) => prev || anyConfigured);
      })
      .catch(silentCatch('wiz.providers'));
    composioApi
      .status()
      .then((s) => setComposioReady(s.configured))
      .catch(() => setComposioReady(false));
    edgeApi
      .getMqttStatus()
      .then((s) => setMqttReady(s.connected))
      .catch(() => setMqttReady(false));
  }, []);

  const reqStatus: Record<Requirement, boolean | undefined> = {
    'ai-provider': aiReady,
    composio: composioReady,
    mqtt: mqttReady,
  };

  const REQ_LABEL: Record<Requirement, string> = {
    'ai-provider': 'AI provider',
    composio: 'Composio',
    mqtt: 'MQTT',
  };

  const completedCount = WIZARDS.filter((w) => isCompleted(w.id)).length;
  const draftCount = WIZARDS.filter((w) => hasDraft(w.id)).length;

  const filtered = useMemo(() => {
    let list = WIZARDS;
    if (activeCategory !== 'all') list = list.filter((w) => w.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (w) =>
          w.title.toLowerCase().includes(q) ||
          w.description.toLowerCase().includes(q) ||
          w.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, activeCategory]);

  // Group filtered wizards by category for display
  const grouped = useMemo(() => {
    const map: Record<Category, WizardDef[]> = {
      setup: [],
      channels: [],
      agents: [],
      automation: [],
      personal: [],
      data: [],
    };
    for (const w of filtered) map[w.category].push(w);
    return map;
  }, [filtered]);

  const categoryCounts = useMemo(() => {
    const c: Record<Category | 'all', number> = {
      all: WIZARDS.length,
      setup: 0,
      channels: 0,
      agents: 0,
      automation: 0,
      personal: 0,
      data: 0,
    };
    for (const w of WIZARDS) c[w.category] += 1;
    return c;
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Setup Wizards
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {completedCount} of {WIZARDS.length} completed
            {draftCount > 0 && ` · ${draftCount} in progress`}
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
          subtitle="Guided step-by-step wizards to configure features, connect services, and get started quickly."
          cta={{
            label: 'View Wizards',
            icon: Sparkles,
            onClick: () => setTab('wizards'),
          }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={onSkipHomeChange}
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
              title: 'AI-Assisted',
              description: 'Many wizards have AI suggestions when a provider is connected.',
            },
            {
              icon: Zap,
              color: 'text-amber-500 bg-amber-500/10',
              title: 'Quick Setup',
              description: 'Most wizards take just 2-3 minutes to complete.',
            },
          ]}
          steps={[
            { title: 'Pick a category', detail: 'Filter wizards by Setup, Channels, Agents...' },
            { title: 'Follow guided steps', detail: 'Each wizard walks you through the process.' },
            { title: 'Review configuration', detail: 'Confirm your settings before applying.' },
            { title: 'Apply settings', detail: 'The wizard applies everything automatically.' },
          ]}
        />
      )}

      {activeTab === 'wizards' && (
        <div className="flex-1 overflow-y-auto animate-fade-in-up">
          {/* Search + category filter */}
          <div className="px-6 pt-4 pb-2 sticky top-0 z-10 bg-bg-primary dark:bg-dark-bg-primary border-b border-border dark:border-dark-border">
            <div className="max-w-5xl mx-auto space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search wizards..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  ['all', 'setup', 'channels', 'agents', 'automation', 'personal', 'data'] as const
                ).map((c) => (
                  <button
                    key={c}
                    onClick={() => setActiveCategory(c)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      activeCategory === c
                        ? 'border-primary bg-primary text-white'
                        : 'border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:border-primary/40'
                    }`}
                  >
                    {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
                    <span className="ml-1.5 opacity-60">{categoryCounts[c]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Grouped grid */}
          <div className="p-6 max-w-5xl mx-auto">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-sm text-text-muted">
                No wizards match your search.
              </div>
            )}

            {(['setup', 'channels', 'agents', 'automation', 'personal', 'data'] as Category[]).map(
              (cat) => {
                const items = grouped[cat];
                if (items.length === 0) return null;
                return (
                  <section key={cat} className="mb-8 last:mb-0">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                      {CATEGORY_LABELS[cat]}
                      <span className="ml-2 text-text-muted/60 font-normal normal-case">
                        {items.length}
                      </span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {items.map((w) => {
                        const completed = isCompleted(w.id);
                        const hasDraftSaved = hasDraft(w.id);
                        const Icon = w.icon;
                        const unmetReqs = (w.requires ?? []).filter((r) => reqStatus[r] === false);
                        return (
                          <button
                            key={w.id}
                            onClick={() => navigate(`/wizards/${w.id}`)}
                            className="group text-left p-5 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary hover:border-primary/50 dark:hover:border-primary/50 hover:shadow-md transition-all flex flex-col h-full"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div
                                className={`p-2.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary ${w.color}`}
                              >
                                <Icon className="w-5 h-5" />
                              </div>
                              <div className="flex items-center gap-1.5">
                                {hasDraftSaved && !completed && (
                                  <span className="flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                                    Draft
                                  </span>
                                )}
                                {completed && (
                                  <span className="flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full">
                                    <Check className="w-3 h-3" />
                                    Done
                                  </span>
                                )}
                              </div>
                            </div>

                            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-1 group-hover:text-primary transition-colors">
                              {w.title}
                            </h3>
                            <p className="text-xs text-text-muted dark:text-dark-text-muted mb-3 line-clamp-2 flex-1">
                              {w.description}
                            </p>

                            {unmetReqs.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {unmetReqs.map((r) => (
                                  <span
                                    key={r}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning"
                                    title={`This wizard works best when ${REQ_LABEL[r]} is configured.`}
                                  >
                                    needs {REQ_LABEL[r]}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center justify-between mt-auto">
                              <span className="text-[11px] text-text-muted">{w.time}</span>
                              <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                                {hasDraftSaved ? 'Continue' : completed ? 'Run Again' : 'Start'} →
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}
