/**
 * AutonomousHubPage — Command Center for all autonomous agents
 *
 * Consolidates: SoulEditorPage, CrewDashboardPage, AgentCommsPage,
 * HeartbeatLogPage into a single unified hub.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Bot,
  Users,
  MessageSquare,
  Heart,
  Sparkles,
  BookOpen,
  Search,
  Info,
  ListChecks,
  Home,
  Brain,
  DollarSign,
  Activity,
} from '../../components/icons';
import { PageHomeTab } from '../../components/PageHomeTab';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { crewsApi, soulsApi } from '../../api/endpoints/souls';
import type { CrewTemplate } from '../../api/endpoints/souls';
import { useAgents } from './hooks/useAgents';
import { useAgentStatus } from './hooks/useAgentStatus';
import type { HubTab } from './types';
import { useToast } from '../../components/ToastProvider';
import { useDialog } from '../../components/ConfirmDialog';

// Tab components
import { PlansTab } from './components/PlansTab';
import { AgentCard } from './components/AgentCard';
import { GlobalStatusBar } from './components/GlobalStatusBar';
import { CrewSection } from './components/CrewSection';
import { CommsPanel } from './components/CommsPanel';
import { ActivityFeed } from './components/ActivityFeed';
import { CreateAgentWizard } from './components/CreateAgentWizard';
import { AIChatCreator } from './components/AIChatCreator';
import { HelpPanel } from './components/HelpPanel';

const TABS: { key: HubTab; label: string; icon: typeof Bot }[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'crews', label: 'Crews', icon: Users },
  { key: 'plans', label: 'Plans', icon: ListChecks },
  { key: 'messages', label: 'Messages', icon: MessageSquare },
  { key: 'activity', label: 'Activity', icon: Heart },
];

export function AutonomousHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as HubTab | null;
  const [activeTab, setActiveTab] = useState<HubTab>(tabParam || 'home');
  const [showWizard, setShowWizard] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState<'type' | 'templates'>('type');
  const [showAICreator, setShowAICreator] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [templates, setTemplates] = useState<CrewTemplate[]>([]);
  const [activityRefreshTrigger, setActivityRefreshTrigger] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();
  const { confirm } = useDialog();

  const { agents, crews, isLoading, isRefreshing, error: loadError, refresh } = useAgents();

  // Sync tab state with URL on back/forward navigation
  useEffect(() => {
    const urlTab = (searchParams.get('tab') as HubTab | null) || 'home';
    setActiveTab(urlTab);
  }, [searchParams]);

  // Fetch templates for wizard
  useEffect(() => {
    crewsApi
      .getTemplates()
      .then(setTemplates)
      .catch(() => {
        toast.error('Failed to load crew templates');
      });
  }, []);

  // WebSocket live updates for autonomous agents
  const { isConnected } = useAgentStatus(
    useCallback(() => {
      // Refresh on any status update
      refresh();
    }, [refresh])
  );

  // Tab switching with URL
  const handleTabChange = useCallback(
    (tab: HubTab) => {
      setActiveTab(tab);
      setSearchParams(tab === 'home' ? {} : { tab });
    },
    [setSearchParams]
  );

  // Skip home screen preference
  const SKIP_HOME_KEY = 'ownpilot_skip_home__autonomous_hub';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, checked ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
  }, []);
  useEffect(() => {
    if (skipHome && !tabParam) {
      handleTabChange('agents');
    }
  }, [skipHome, tabParam, handleTabChange]);

  // Agent actions
  const handlePause = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent?.soul) return;
      try {
        await soulsApi.update(agentId, {
          ...agent.soul,
          heartbeat: { ...agent.soul.heartbeat, enabled: false },
        });
        toast.success('Agent paused');
        refresh();
      } catch {
        toast.error('Failed to pause agent');
      }
    },
    [agents, toast, refresh]
  );

  const handleResume = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent?.soul) return;
      try {
        await soulsApi.update(agentId, {
          ...agent.soul,
          heartbeat: { ...agent.soul.heartbeat, enabled: true },
        });
        toast.success('Agent resumed');
        refresh();
      } catch {
        toast.error('Failed to resume agent');
      }
    },
    [agents, toast, refresh]
  );

  const handleDelete = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      if (
        !(await confirm({
          message: `Delete "${agent.name}"? This cannot be undone.`,
          variant: 'danger',
        }))
      )
        return;
      try {
        await soulsApi.delete(agentId);
        toast.success('Agent deleted');
        refresh();
      } catch {
        toast.error('Failed to delete agent');
      }
    },
    [agents, confirm, toast, refresh]
  );

  const handleTestRun = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      if (!agent.heartbeatEnabled) {
        toast.warning('Agent is paused. Resume before testing.');
        return;
      }
      try {
        const result = await soulsApi.runTest(agentId);
        toast.success(result.message);
        // Refresh agent list and activity feed immediately (run already completed server-side)
        refresh();
        setActivityRefreshTrigger((n) => n + 1);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Test run failed');
      }
    },
    [agents, toast, refresh]
  );

  // Filtered agents
  const filteredAgents = agents.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (kindFilter !== 'all' && a.kind !== kindFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.mission.toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (isLoading) return <LoadingSpinner message="Loading autonomous agents..." />;

  return (
    <div className="flex flex-col h-full">
      {/* Error banner */}
      {loadError && (
        <div className="flex items-center gap-3 px-4 py-3 mx-6 mt-4 bg-danger/10 border border-danger/30 rounded-lg">
          <span className="text-sm text-danger font-medium">{loadError}</span>
          <button
            onClick={refresh}
            className="ml-auto text-xs text-danger hover:text-danger/80 transition-colors underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Autonomous Agents
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Your agents work on your behalf — monitoring, researching, and completing tasks around
            the clock.
          </p>
          <div className="mt-1">
            <GlobalStatusBar
              agents={agents}
              isRefreshing={isRefreshing}
              isConnected={isConnected}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-2 px-3 py-2 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded-lg transition-colors"
            title="Help & Documentation"
          >
            <Info className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowAICreator(true)}
            className="flex items-center gap-2 px-4 py-2 border border-primary text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            AI Create
          </button>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Agent
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.key === 'agents' && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full ml-1">
                  {agents.length}
                </span>
              )}
              {tab.key === 'crews' && crews.length > 0 && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full ml-1">
                  {crews.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'home' && (
          <PageHomeTab
            heroIcons={[
              { icon: Bot, color: 'text-primary bg-primary/10' },
              { icon: Brain, color: 'text-violet-500 bg-violet-500/10' },
              { icon: Users, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Command Your Autonomous Agents"
            subtitle="Create AI agents that work independently — with their own goals, tools, budgets, and crew coordination."
            cta={{ label: 'View Agents', icon: Bot, onClick: () => handleTabChange('agents') }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Agents"
            features={[
              {
                icon: Bot,
                color: 'text-primary bg-primary/10',
                title: 'Independent Agents',
                description:
                  'Create agents that run on their own schedule — monitoring, researching, and completing tasks autonomously.',
              },
              {
                icon: Users,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Crew Collaboration',
                description:
                  'Organize agents into crews for coordinated multi-agent workflows and task delegation.',
              },
              {
                icon: DollarSign,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Budget Control',
                description:
                  'Set spending limits per agent and monitor API costs to keep your autonomous operations within budget.',
              },
              {
                icon: Activity,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Activity Monitoring',
                description:
                  'Track every heartbeat, message, and action across all your agents in real time.',
              },
            ]}
            steps={[
              {
                title: 'Create an agent',
                detail: 'Use templates, AI chat, or manual setup to define your agent.',
              },
              {
                title: 'Assign tools & budget',
                detail: 'Give your agent the tools it needs and set spending limits.',
              },
              {
                title: 'Let it work autonomously',
                detail: 'Your agent runs on a schedule, completing tasks on its own.',
              },
              {
                title: 'Monitor activity & messages',
                detail: 'Review logs, messages, and results from the activity feed.',
              },
            ]}
            quickActions={[
              {
                icon: Bot,
                label: 'View Agents',
                description: 'Browse and manage all agents',
                onClick: () => handleTabChange('agents'),
              },
              {
                icon: Users,
                label: 'Manage Crews',
                description: 'Organize agents into teams',
                onClick: () => handleTabChange('crews'),
              },
              {
                icon: ListChecks,
                label: 'Browse Plans',
                description: 'View autonomous execution plans',
                onClick: () => handleTabChange('plans'),
              },
              {
                icon: MessageSquare,
                label: 'View Messages',
                description: 'Read inter-agent communications',
                onClick: () => handleTabChange('messages'),
              },
              {
                icon: Activity,
                label: 'Activity Log',
                description: 'Monitor real-time agent activity',
                onClick: () => handleTabChange('activity'),
              },
            ]}
          />
        )}

        {activeTab === 'agents' && (
          <div className="p-6 max-w-6xl mx-auto space-y-4 min-w-[800px]">
            {/* Search + Filters */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search agents..."
                  className="text-xs rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary pl-8 pr-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-2 py-1.5"
              >
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="starting">Starting</option>
                <option value="waiting">Waiting</option>
                <option value="paused">Paused</option>
                <option value="idle">Idle</option>
                <option value="error">Error</option>
                <option value="stopped">Stopped</option>
              </select>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                className="text-xs rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-2 py-1.5"
              >
                <option value="all">All Types</option>
                <option value="soul">Soul Agents</option>
              </select>
              <span className="text-xs text-text-muted dark:text-dark-text-muted ml-auto">
                {filteredAgents.length} agent{filteredAgents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Agent grid */}
            {filteredAgents.length === 0 ? (
              <div className="text-center py-12 space-y-6">
                <div>
                  <Bot className="w-12 h-12 text-text-muted dark:text-dark-text-muted mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary">
                    {agents.length === 0
                      ? 'Create your first agent'
                      : 'No agents match your filters'}
                  </h3>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 max-w-md mx-auto">
                    {agents.length === 0
                      ? 'Agents run autonomously on a schedule — scanning news, summarizing data, tracking goals, and more. Choose how to get started:'
                      : 'Try adjusting the status or type filters above.'}
                  </p>
                </div>
                {agents.length === 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button
                      onClick={() => {
                        setWizardInitialStep('templates');
                        setShowWizard(true);
                      }}
                      className="flex items-center gap-2 px-5 py-3 border border-border dark:border-dark-border rounded-xl hover:border-primary hover:bg-primary/5 transition-colors w-full sm:w-auto"
                    >
                      <BookOpen className="w-5 h-5 text-primary" />
                      <div className="text-left">
                        <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                          Browse Templates
                        </div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted">
                          Pick from 16+ ready-made agents
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => setShowAICreator(true)}
                      className="flex items-center gap-2 px-5 py-3 border border-border dark:border-dark-border rounded-xl hover:border-primary hover:bg-primary/5 transition-colors w-full sm:w-auto"
                    >
                      <Sparkles className="w-5 h-5 text-primary" />
                      <div className="text-left">
                        <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                          Chat with AI
                        </div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted">
                          Describe what you need in plain words
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setWizardInitialStep('type');
                        setShowWizard(true);
                      }}
                      className="flex items-center gap-2 px-5 py-3 border border-border dark:border-dark-border rounded-xl hover:border-primary hover:bg-primary/5 transition-colors w-full sm:w-auto"
                    >
                      <Plus className="w-5 h-5 text-primary" />
                      <div className="text-left">
                        <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                          Create Manually
                        </div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted">
                          Full control over every setting
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onPause={handlePause}
                    onResume={handleResume}
                    onDelete={handleDelete}
                    onTestRun={handleTestRun}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'crews' && (
          <div className="p-6 max-w-6xl mx-auto w-full min-h-[400px] min-w-[800px]">
            <CrewSection crews={crews} templates={templates} onRefresh={refresh} />
          </div>
        )}

        {activeTab === 'plans' && (
          <div className="p-6 max-w-6xl mx-auto w-full min-h-[400px] min-w-[800px]">
            <PlansTab />
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="p-6 max-w-6xl mx-auto w-full min-h-[400px] min-w-[800px]">
            <CommsPanel agents={agents} />
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="p-6 max-w-6xl mx-auto w-full min-h-[400px] min-w-[800px]">
            <ActivityFeed agents={agents} refreshTrigger={activityRefreshTrigger} />
          </div>
        )}
      </div>

      {/* Create wizard modal */}
      {showWizard && (
        <CreateAgentWizard
          templates={templates}
          initialStep={wizardInitialStep}
          onClose={() => setShowWizard(false)}
          onCreated={refresh}
        />
      )}

      {/* AI Chat Creator modal */}
      {showAICreator && (
        <AIChatCreator
          onClose={() => setShowAICreator(false)}
          onCreated={() => {
            setShowAICreator(false);
            refresh();
          }}
        />
      )}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}
