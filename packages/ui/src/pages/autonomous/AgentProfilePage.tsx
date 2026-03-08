/**
 * AgentProfilePage — deep-dive view for a single autonomous agent
 *
 * Route: /autonomous/agent/:id
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { soulsApi, heartbeatLogsApi, agentMessagesApi, crewsApi } from '../../api/endpoints/souls';
import { agentsApi } from '../../api/endpoints/agents';
import type {
  AgentSoul,
  AgentCrew,
  HeartbeatLog,
  HeartbeatStats,
  AgentMessage,
} from '../../api/endpoints/souls';
import type { AgentDetail } from '../../types';
import { backgroundAgentsApi } from '../../api/endpoints/background-agents';
import type {
  BackgroundAgentConfig,
  BackgroundAgentHistoryEntry,
} from '../../api/endpoints/background-agents';
import {
  ChevronLeft,
  Pause,
  Play,
  AlertCircle,
  Trash2,
  FlaskConical,
} from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import { useDialog } from '../../components/ConfirmDialog';
import { AgentStatusBadge } from './components/AgentStatusBadge';
import { SoulEditor } from './components/SoulEditor';
import type { AgentStatus, ProfileTab } from './types';
import { mapBackgroundState } from './types';
import type { Tool } from './components/ToolSelector';
import {
  OverviewTab,
  MessagesTab,
  ActivityTab,
  BudgetTab,
  ToolsTab,
  TabContent,
} from './profile-tabs';

export function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useDialog();
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isActionInFlight, setIsActionInFlight] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Agent data
  const [soul, setSoul] = useState<AgentSoul | null>(null);
  const [bgAgent, setBgAgent] = useState<BackgroundAgentConfig | null>(null);
  const [agentData, setAgentData] = useState<AgentDetail | null>(null);
  const [stats, setStats] = useState<HeartbeatStats | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatLog[]>([]);
  const [bgHistory, setBgHistory] = useState<BackgroundAgentHistoryEntry[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [crews, setCrews] = useState<AgentCrew[]>([]);

  // Derived
  const isSoul = !!soul;
  const name = soul?.identity.name ?? bgAgent?.name ?? 'Unknown';
  const emoji = soul?.identity.emoji ?? '🤖';
  const role = soul?.identity.role ?? 'Background Agent';
  const status: AgentStatus = bgAgent?.session
    ? mapBackgroundState(bgAgent.session.state)
    : soul?.heartbeat.enabled
      ? 'running'
      : 'idle';
  const crewId = soul?.relationships?.crewId;
  const crewName = crewId ? (crews.find((c) => c.id === crewId)?.name ?? crewId) : undefined;

  // Data loading
  const fetchData = useCallback(async () => {
    if (!id) return;
    setFetchError(null);
    try {
      // First, try to get the soul agent
      let soulData: AgentSoul | null = null;
      let bgAgentData: BackgroundAgentConfig | null = null;

      try {
        soulData = await soulsApi.get(id);
      } catch {
        // Not a soul agent, try background agent
        try {
          bgAgentData = await backgroundAgentsApi.get(id);
        } catch {
          // Neither - will show error below
        }
      }

      // If neither found, show error
      if (!soulData && !bgAgentData) {
        setFetchError('Agent not found. It may have been deleted.');
        setIsLoading(false);
        return;
      }

      setSoul(soulData);
      setBgAgent(bgAgentData);

      const [statsData, heartbeatsData, messagesData, crewsData, bgHistoryData, agentInfo] =
        await Promise.all([
          heartbeatLogsApi.getStats(id).catch(() => null),
          heartbeatLogsApi.listByAgent(id, 20, 0).catch(() => [] as HeartbeatLog[]),
          agentMessagesApi.listByAgent(id, 30, 0).catch(() => [] as AgentMessage[]),
          crewsApi.list().catch(() => null),
          bgAgentData
            ? backgroundAgentsApi.getHistory(id, 20, 0).catch(() => null)
            : Promise.resolve(null),
          agentsApi.get(id).catch(() => null),
        ]);

      if (statsData) setStats(statsData);
      setHeartbeats(heartbeatsData);
      setMessages(messagesData);
      if (crewsData) {
        setCrews(crewsData.items ?? []);
      }
      // Background agent history (only for background agents)
      if (bgHistoryData) {
        setBgHistory(bgHistoryData.entries ?? []);
      } else {
        setBgHistory([]);
      }
      if (agentInfo) {
        setAgentData(agentInfo);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Actions
  const handlePause = useCallback(async () => {
    if (!id || isActionInFlight) return;
    setIsActionInFlight(true);
    try {
      if (bgAgent) {
        await backgroundAgentsApi.pause(id);
      } else if (soul) {
        await soulsApi.update(id, {
          ...soul,
          heartbeat: { ...soul.heartbeat, enabled: false },
        });
      }
      toast.success('Agent paused');
      await fetchData();
    } catch {
      toast.error('Failed to pause');
    } finally {
      setIsActionInFlight(false);
    }
  }, [id, isActionInFlight, bgAgent, soul, toast, fetchData]);

  const handleResume = useCallback(async () => {
    if (!id || isActionInFlight) return;
    setIsActionInFlight(true);
    try {
      if (bgAgent) {
        await backgroundAgentsApi.resume(id);
      } else if (soul) {
        await soulsApi.update(id, {
          ...soul,
          heartbeat: { ...soul.heartbeat, enabled: true },
        });
      }
      toast.success('Agent resumed');
      await fetchData();
    } catch {
      toast.error('Failed to resume');
    } finally {
      setIsActionInFlight(false);
    }
  }, [id, isActionInFlight, bgAgent, soul, toast, fetchData]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (
      !(await confirm({
        message: `Delete "${name}"? This cannot be undone.`,
        variant: 'danger',
      }))
    )
      return;
    try {
      if (bgAgent) {
        await backgroundAgentsApi.delete(id);
      } else {
        await soulsApi.delete(id);
      }
      toast.success('Agent deleted');
      navigate('/autonomous');
    } catch {
      toast.error('Failed to delete agent');
    }
  }, [id, name, bgAgent, confirm, toast, navigate]);

  const handleTestRun = useCallback(async () => {
    if (!id || !soul) return;
    if (!soul.heartbeat.enabled) {
      toast.warning('Agent is paused. Resume before testing.');
      return;
    }
    try {
      const result = await soulsApi.runTest(id);
      toast.success(result.message);
      // Run is complete server-side — refresh immediately
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test run failed');
    }
  }, [id, soul, toast, fetchData]);

  // Tools state
  const [tools, setTools] = useState<Tool[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [blockedTools, setBlockedTools] = useState<string[]>([]);
  const [isToolsLoading, setIsToolsLoading] = useState(false);

  // Load tools when on tools tab
  useEffect(() => {
    if (activeTab === 'tools' && id) {
      setIsToolsLoading(true);
      soulsApi
        .getTools(id)
        .then((data) => {
          setTools(data.tools);
          setAllowedTools(data.allowed);
          setBlockedTools(data.blocked);
        })
        .catch(() => toast.error('Failed to load tools'))
        .finally(() => setIsToolsLoading(false));
    }
  }, [activeTab, id, toast]);

  const handleToolsChange = useCallback(
    async (allowed: string[], blocked: string[]) => {
      if (!id) return;
      try {
        await soulsApi.updateTools(id, { allowed, blocked });
        setAllowedTools(allowed);
        setBlockedTools(blocked);
        toast.success('Tool permissions updated');
      } catch {
        toast.error('Failed to update tools');
      }
    },
    [id, toast]
  );

  const profileTabs: { key: ProfileTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    ...(isSoul ? [{ key: 'soul' as const, label: 'Soul' }] : []),
    ...(isSoul ? [{ key: 'tools' as const, label: 'Tools' }] : []),
    { key: 'messages', label: 'Messages' },
    { key: 'activity', label: 'Activity' },
    { key: 'budget', label: 'Budget' },
  ];

  if (!id) return <Navigate to="/autonomous" replace />;

  if (isLoading) return <LoadingSpinner message="Loading agent..." />;

  if (!soul && !bgAgent) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-center py-16">
        {fetchError ? (
          <>
            <AlertCircle className="w-12 h-12 text-danger mx-auto mb-3" />
            <p className="text-text-primary dark:text-dark-text-primary font-medium">
              Failed to load agent
            </p>
            <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">{fetchError}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors mx-auto"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <p className="text-text-muted dark:text-dark-text-muted">Agent not found.</p>
            <button
              onClick={() => navigate('/autonomous')}
              className="mt-4 flex items-center gap-1 text-sm text-primary hover:text-primary-dark transition-colors mx-auto"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to hub
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/autonomous')}
            aria-label="Back to hub"
            className="p-1.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-3xl">{emoji}</span>
          <div>
            <h1 className="text-xl font-bold text-text-primary dark:text-dark-text-primary flex items-center gap-3">
              {name}
              <AgentStatusBadge status={status} />
            </h1>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {role}
              {crewName && <span className="ml-2 text-primary">Crew: {crewName}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Run Test - for soul agents only */}
          {isSoul && (
            <button
              onClick={handleTestRun}
              disabled={!soul?.heartbeat.enabled}
              title={
                soul?.heartbeat.enabled
                  ? 'Run agent immediately (test heartbeat)'
                  : 'Resume agent to run test'
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FlaskConical className="w-4 h-4" /> Run Test
            </button>
          )}
          {(status === 'running' || status === 'waiting') && (
            <button
              onClick={handlePause}
              disabled={isActionInFlight}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-warning text-warning rounded-lg hover:bg-warning/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Pause className="w-4 h-4" /> {isActionInFlight ? 'Pausing...' : 'Pause'}
            </button>
          )}
          {(status === 'paused' || status === 'idle' || status === 'stopped') && (
            <button
              onClick={handleResume}
              disabled={isActionInFlight}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-success text-success rounded-lg hover:bg-success/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" /> {isActionInFlight ? 'Resuming...' : 'Resume'}
            </button>
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-danger text-danger rounded-lg hover:bg-danger/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border dark:border-dark-border">
        {profileTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content - consistent width container */}
      <div className="w-full min-h-[500px] min-w-[800px]">
        {activeTab === 'overview' && (
          <TabContent>
            <OverviewTab
              agentId={id}
              soul={soul}
              bgAgent={bgAgent}
              agentData={agentData}
              stats={stats}
              heartbeats={heartbeats}
              bgHistory={bgHistory}
              messages={messages}
              onUpdate={fetchData}
            />
          </TabContent>
        )}

        {activeTab === 'soul' && id && (
          <TabContent>
            <SoulEditor agentId={id} />
          </TabContent>
        )}

        {activeTab === 'tools' && id && (
          <TabContent>
            <ToolsTab
              tools={tools}
              allowedTools={allowedTools}
              blockedTools={blockedTools}
              isLoading={isToolsLoading}
              onChange={handleToolsChange}
            />
          </TabContent>
        )}

        {activeTab === 'messages' && id && (
          <TabContent>
            <MessagesTab agentId={id} messages={messages} onRefresh={fetchData} />
          </TabContent>
        )}

        {activeTab === 'activity' && (
          <TabContent>
            <ActivityTab heartbeats={heartbeats} bgHistory={bgHistory} onRefresh={fetchData} />
          </TabContent>
        )}

        {activeTab === 'budget' && (
          <TabContent>
            <BudgetTab soul={soul} bgAgent={bgAgent} stats={stats} />
          </TabContent>
        )}
      </div>
    </div>
  );
}
