/**
 * AutonomousHubPage — Command Center for all autonomous agents
 *
 * Consolidates: SoulEditorPage, CrewDashboardPage, AgentCommsPage,
 * HeartbeatLogPage, BackgroundAgentsPage into a single unified hub.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Bot, Users, MessageSquare, Heart, Sparkles, BookOpen } from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { crewsApi } from '../../api/endpoints/souls';
import type { CrewTemplate } from '../../api/endpoints/souls';
import { backgroundAgentsApi } from '../../api/endpoints/background-agents';
import { soulsApi } from '../../api/endpoints/souls';
import { useAgents } from './hooks/useAgents';
import { useAgentStatus } from './hooks/useAgentStatus';
import type { HubTab } from './types';
import { useToast } from '../../components/ToastProvider';

// Tab components
import { AgentCard } from './components/AgentCard';
import { GlobalStatusBar } from './components/GlobalStatusBar';
import { CrewSection } from './components/CrewSection';
import { CommsPanel } from './components/CommsPanel';
import { ActivityFeed } from './components/ActivityFeed';
import { CreateAgentWizard } from './components/CreateAgentWizard';
import { AIChatCreator } from './components/AIChatCreator';

const TABS: { key: HubTab; label: string; icon: typeof Bot }[] = [
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'crews', label: 'Crews', icon: Users },
  { key: 'messages', label: 'Messages', icon: MessageSquare },
  { key: 'activity', label: 'Activity', icon: Heart },
];

export function AutonomousHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as HubTab | null;
  const [activeTab, setActiveTab] = useState<HubTab>(tabParam || 'agents');
  const [showWizard, setShowWizard] = useState(false);
  const [showAICreator, setShowAICreator] = useState(false);
  const [templates, setTemplates] = useState<CrewTemplate[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const toast = useToast();

  const { agents, crews, isLoading, refresh } = useAgents();

  // Fetch templates for wizard
  useEffect(() => {
    crewsApi
      .getTemplates()
      .then(setTemplates)
      .catch(() => {});
  }, []);

  // WebSocket live updates for background agents
  useAgentStatus(
    useCallback(() => {
      // Refresh on any status update
      refresh();
    }, [refresh])
  );

  // Tab switching with URL
  const handleTabChange = useCallback(
    (tab: HubTab) => {
      setActiveTab(tab);
      setSearchParams(tab === 'agents' ? {} : { tab });
    },
    [setSearchParams]
  );

  // Agent actions
  const handlePause = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      try {
        if (agent.kind === 'background') {
          await backgroundAgentsApi.pause(agentId);
        } else if (agent.soul) {
          await soulsApi.update(agentId, {
            ...agent.soul,
            heartbeat: { ...agent.soul.heartbeat, enabled: false },
          });
        }
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
      if (!agent) return;
      try {
        if (agent.kind === 'background') {
          await backgroundAgentsApi.resume(agentId);
        } else if (agent.soul) {
          await soulsApi.update(agentId, {
            ...agent.soul,
            heartbeat: { ...agent.soul.heartbeat, enabled: true },
          });
        }
        toast.success('Agent resumed');
        refresh();
      } catch {
        toast.error('Failed to resume agent');
      }
    },
    [agents, toast, refresh]
  );

  // Filtered agents
  const filteredAgents = agents.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (kindFilter !== 'all' && a.kind !== kindFilter) return false;
    return true;
  });

  if (isLoading) return <LoadingSpinner message="Loading autonomous agents..." />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            Autonomous Agents
          </h1>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-0.5">
            Your agents work on your behalf — monitoring, researching, and completing tasks around
            the clock.
          </p>
          <div className="mt-1">
            <GlobalStatusBar agents={agents} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border dark:border-dark-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              <Icon className="w-4 h-4" />
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
      {activeTab === 'agents' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs rounded-lg border border-border dark:border-dark-border bg-surface dark:bg-dark-surface text-text-primary dark:text-dark-text-primary px-2 py-1.5"
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="paused">Paused</option>
              <option value="idle">Idle</option>
              <option value="error">Error</option>
              <option value="stopped">Stopped</option>
            </select>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="text-xs rounded-lg border border-border dark:border-dark-border bg-surface dark:bg-dark-surface text-text-primary dark:text-dark-text-primary px-2 py-1.5"
            >
              <option value="all">All Types</option>
              <option value="soul">Soul Agents</option>
              <option value="background">Background Agents</option>
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
                  {agents.length === 0 ? 'Create your first agent' : 'No agents match your filters'}
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
                    onClick={() => setShowWizard(true)}
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
                    onClick={() => setShowWizard(true)}
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
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'crews' && <CrewSection crews={crews} onRefresh={refresh} />}

      {activeTab === 'messages' && <CommsPanel agents={agents} />}

      {activeTab === 'activity' && <ActivityFeed agents={agents} />}

      {/* Create wizard modal */}
      {showWizard && (
        <CreateAgentWizard
          templates={templates}
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
    </div>
  );
}
