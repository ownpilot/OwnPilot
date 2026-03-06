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
import { providersApi } from '../../api/endpoints/providers';
import type {
  BackgroundAgentConfig,
  BackgroundAgentHistoryEntry,
} from '../../api/endpoints/background-agents';
import {
  ChevronLeft,
  Pause,
  Play,
  MessageSquare,
  Heart,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Trash2,
  FlaskConical,
  Cpu,
  Settings2,
  Check,
  X,
} from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import { useDialog } from '../../components/ConfirmDialog';
import { AgentStatusBadge } from './components/AgentStatusBadge';
import { SoulEditor } from './components/SoulEditor';
import { ToolSelector } from './components/ToolSelector';
import type { AgentStatus, ProfileTab } from './types';
import { mapBackgroundState } from './types';
import { formatTimeAgo, formatCost, formatDuration } from './helpers';
import type { Tool } from './components/ToolSelector';

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

// =============================================================================
// Tab Components
// =============================================================================

function OverviewTab({
  agentId,
  soul,
  bgAgent,
  agentData,
  stats,
  heartbeats,
  bgHistory,
  messages,
  onUpdate,
}: {
  agentId: string;
  soul: AgentSoul | null;
  bgAgent: BackgroundAgentConfig | null;
  agentData: AgentDetail | null;
  stats: HeartbeatStats | null;
  heartbeats: HeartbeatLog[];
  bgHistory: BackgroundAgentHistoryEntry[];
  messages: AgentMessage[];
  onUpdate: () => void;
}) {
  const toast = useToast();
  const [isEditingProvider, setIsEditingProvider] = useState(false);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  // Helper functions to safely get provider/model with fallback to 'default'
  const getSafeProvider = () => agentData?.provider || 'default';
  const getSafeModel = () => agentData?.model || 'default';
  const getSoulFallbackProviderId = () => {
    if (!soul?.provider || typeof soul.provider === 'string') return '';
    return soul.provider.fallbackProviderId || '';
  };
  const getSoulFallbackModelId = () => {
    if (!soul?.provider || typeof soul.provider === 'string') return '';
    return soul.provider.fallbackModelId || '';
  };

  const [editProvider, setEditProvider] = useState(getSafeProvider());
  const [editModel, setEditModel] = useState(getSafeModel());
  const [editFallbackProvider, setEditFallbackProvider] = useState(getSoulFallbackProviderId());
  const [editFallbackModel, setEditFallbackModel] = useState(getSoulFallbackModelId());
  const [fallbackModels, setFallbackModels] = useState<{ id: string; name: string }[]>([]);

  // Load providers when editing
  useEffect(() => {
    if (isEditingProvider) {
      providersApi
        .list()
        .then((data) => {
          const list = data.providers.map((p) => ({ id: p.id, name: p.name }));
          setProviders(list);
        })
        .catch(() => toast.error('Failed to load providers'));
    }
  }, [isEditingProvider]);

  // Load models when provider changes
  useEffect(() => {
    if (editProvider) {
      providersApi
        .models(editProvider)
        .then((data) => {
          setModels(data.models);
        })
        .catch(() => toast.error('Failed to load models'));
    }
  }, [editProvider]);

  // Load fallback models when fallback provider changes
  useEffect(() => {
    if (editFallbackProvider) {
      providersApi
        .models(editFallbackProvider)
        .then((data) => {
          setFallbackModels(data.models);
        })
        .catch(() => toast.error('Failed to load fallback models'));
    }
  }, [editFallbackProvider]);

  const handleSaveProvider = async () => {
    try {
      // Ensure we have valid values - fallback to 'default' if empty
      const providerToSave = editProvider || 'default';
      const modelToSave = editModel || 'default';

      if (bgAgent) {
        // Update background agent provider/model
        await backgroundAgentsApi.update(agentId, {
          provider: providerToSave,
          model: modelToSave,
        });
      } else if (soul) {
        // Update soul agent via agents API (main agent record)
        await agentsApi.update(agentId, {
          provider: providerToSave,
          model: modelToSave,
        });

        // Update soul provider configuration
        await soulsApi.update(soul.agentId, {
          provider: {
            providerId: providerToSave,
            modelId: modelToSave,
            fallbackProviderId: editFallbackProvider || undefined,
            fallbackModelId: editFallbackModel || undefined,
          },
        });
      } else {
        toast.error('Agent data not available');
        return;
      }

      toast.success('Provider configuration updated');
      setIsEditingProvider(false);
      onUpdate();
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={soul ? 'Heartbeat Cycles' : 'Completed Cycles'}
          value={String(
            stats?.totalCycles ?? bgAgent?.session?.cyclesCompleted ?? heartbeats.length
          )}
        />
        <StatCard
          label="Success Rate"
          value={
            stats
              ? `${((1 - stats.failureRate) * 100).toFixed(0)}%`
              : bgHistory.length > 0
                ? `${((bgHistory.filter((e) => e.success).length / bgHistory.length) * 100).toFixed(0)}%`
                : '—'
          }
        />
        <StatCard
          label="Total Cost"
          value={
            stats
              ? formatCost(stats.totalCost)
              : bgAgent?.session
                ? formatCost(bgAgent.session.totalCostUsd)
                : '$0.00'
          }
        />
        <StatCard label="Messages" value={String(messages.length)} />
      </div>

      {/* Agent info */}
      <div className="border border-border dark:border-dark-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
          Agent Info
        </h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <InfoRow label="Type" value={soul ? 'Soul Agent' : 'Background Agent'} />
          {soul && (
            <>
              <InfoRow label="Soul Version" value={`v${soul.evolution.version}`} />
              <InfoRow label="Autonomy Level" value={String(soul.autonomy.level)} />
              <InfoRow
                label="Heartbeat"
                value={soul.heartbeat.enabled ? soul.heartbeat.interval : 'Disabled'}
              />
              <InfoRow label="Mission" value={soul.purpose.mission} />
              <InfoRow
                label="Skills"
                value={
                  soul.skillAccess?.allowed?.length
                    ? `${soul.skillAccess.allowed.length} skill${soul.skillAccess.allowed.length !== 1 ? 's' : ''} enabled`
                    : 'No skills enabled'
                }
              />
            </>
          )}
          {bgAgent && (
            <>
              <InfoRow label="Mode" value={bgAgent.mode} />
              <InfoRow label="Cycles" value={String(bgAgent.session?.cyclesCompleted ?? 0)} />
              <InfoRow label="Tool Calls" value={String(bgAgent.session?.totalToolCalls ?? 0)} />
              <InfoRow label="Mission" value={bgAgent.mission} />
              <InfoRow label="Created" value={new Date(bgAgent.createdAt).toLocaleDateString()} />
              {bgAgent.session?.lastCycleAt && (
                <InfoRow label="Last Cycle" value={formatTimeAgo(bgAgent.session.lastCycleAt)} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Provider / Model Configuration */}
      <div className="border border-border dark:border-dark-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            Provider & Model
          </h3>
          {agentData && !isEditingProvider && (
            <button
              onClick={() => {
                // Use safe getters to handle undefined/null values
                setEditProvider(getSafeProvider());
                setEditModel(getSafeModel());
                setEditFallbackProvider(getSoulFallbackProviderId());
                setEditFallbackModel(getSoulFallbackModelId());
                setIsEditingProvider(true);
              }}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" /> Edit
            </button>
          )}
        </div>

        {agentData ? (
          isEditingProvider ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                    Provider
                  </label>
                  <select
                    value={editProvider}
                    onChange={(e) => {
                      setEditProvider(e.target.value);
                      setEditModel(''); // Reset model when provider changes
                    }}
                    className="w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select provider...</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                    Model
                  </label>
                  <select
                    value={editModel}
                    onChange={(e) => setEditModel(e.target.value)}
                    disabled={!editProvider || models.length === 0}
                    className="w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  >
                    <option value="">Select model...</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Fallback Configuration */}
              {soul && (
                <div className="border-t border-border dark:border-dark-border pt-3 mt-3">
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
                    Fallback Configuration (used if primary provider fails)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                        Fallback Provider
                      </label>
                      <select
                        value={editFallbackProvider}
                        onChange={(e) => {
                          setEditFallbackProvider(e.target.value);
                          setEditFallbackModel('');
                        }}
                        className="w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">None (optional)</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                        Fallback Model
                      </label>
                      <select
                        value={editFallbackModel}
                        onChange={(e) => setEditFallbackModel(e.target.value)}
                        disabled={!editFallbackProvider || fallbackModels.length === 0}
                        className="w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="">Select model...</option>
                        {fallbackModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSaveProvider}
                  disabled={!editProvider || !editModel}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button
                  onClick={() => setIsEditingProvider(false)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border dark:border-dark-border text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded-lg"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <InfoRow label="Provider" value={agentData.provider || 'Default'} />
                <InfoRow label="Model" value={agentData.model || 'Default'} />
              </div>
              {getSoulFallbackProviderId() && (
                <div className="mt-2 pt-2 border-t border-border dark:border-dark-border">
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">
                    Fallback:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <InfoRow label="Provider" value={getSoulFallbackProviderId() || 'None'} />
                    <InfoRow label="Model" value={getSoulFallbackModelId() || 'Default'} />
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Agent data not available. Provider and model information is loaded from the main agent
            configuration.
          </p>
        )}
      </div>

      {/* Recent heartbeats */}
      {heartbeats.length > 0 && (
        <div className="border border-border dark:border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
            Recent Heartbeats
          </h3>
          <div className="space-y-2">
            {heartbeats.slice(0, 5).map((hb) => (
              <div
                key={hb.id}
                className="text-xs flex items-center gap-2 text-text-muted dark:text-dark-text-muted"
              >
                <Heart
                  className={`w-3 h-3 ${
                    hb.tasksFailed.length > 0 ? 'text-danger' : 'text-success'
                  }`}
                />
                <span>
                  {hb.tasksRun.length} tasks · {formatDuration(hb.durationMs)} ·{' '}
                  {formatCost(hb.cost)}
                </span>
                <span className="ml-auto">{formatTimeAgo(hb.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent background cycles */}
      {bgHistory.length > 0 && (
        <div className="border border-border dark:border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
            Recent Cycles
          </h3>
          <div className="space-y-2">
            {bgHistory.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="text-xs flex items-center gap-2 text-text-muted dark:text-dark-text-muted"
              >
                {entry.success ? (
                  <CheckCircle2 className="w-3 h-3 text-success" />
                ) : (
                  <AlertCircle className="w-3 h-3 text-danger" />
                )}
                <span>
                  Cycle #{entry.cycleNumber} · {entry.toolCalls.length} tool calls ·{' '}
                  {formatDuration(entry.durationMs)}
                  {entry.costUsd != null && ` · ${formatCost(entry.costUsd)}`}
                </span>
                <span className="ml-auto">{formatTimeAgo(entry.executedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MessagesTab({
  agentId,
  messages,
  onRefresh,
}: {
  agentId: string;
  messages: AgentMessage[];
  onRefresh: () => void;
}) {
  const toast = useToast();
  const [composeTo, setComposeTo] = useState('');
  const [composeContent, setComposeContent] = useState('');

  const handleSend = useCallback(async () => {
    if (!composeTo.trim() || !composeContent.trim()) return;
    try {
      await agentMessagesApi.send({
        from: agentId,
        to: composeTo,
        content: composeContent,
        type: 'coordination',
      });
      toast.success('Message sent');
      setComposeTo('');
      setComposeContent('');
      onRefresh();
    } catch {
      toast.error('Failed to send');
    }
  }, [agentId, composeTo, composeContent, toast, onRefresh]);

  const inputClass =
    'w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="space-y-4">
      {/* Compose */}
      <div className="border border-border dark:border-dark-border rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
          Send Message
        </h3>
        <input
          type="text"
          value={composeTo}
          onChange={(e) => setComposeTo(e.target.value)}
          placeholder="Recipient agent ID..."
          className={inputClass}
        />
        <textarea
          value={composeContent}
          onChange={(e) => setComposeContent(e.target.value)}
          placeholder="Message..."
          rows={2}
          className={inputClass}
        />
        <button
          onClick={handleSend}
          disabled={!composeTo || !composeContent}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </div>

      {/* Message list */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
          Messages ({messages.length})
        </h3>
        <button
          onClick={onRefresh}
          aria-label="Refresh messages"
          className="text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
          No messages yet.
        </p>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="border border-border dark:border-dark-border rounded-lg p-3 text-xs"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3 h-3 text-primary" />
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {msg.from === agentId ? `→ ${msg.to}` : `← ${msg.from}`}
                </span>
                <span className="text-text-muted dark:text-dark-text-muted">{msg.type}</span>
                <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                  {formatTimeAgo(msg.createdAt)}
                </span>
              </div>
              {msg.subject && (
                <p className="font-medium text-text-primary dark:text-dark-text-primary mt-1">
                  {msg.subject}
                </p>
              )}
              <p className="text-text-muted dark:text-dark-text-muted mt-0.5">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityTab({
  heartbeats,
  bgHistory,
  onRefresh,
}: {
  heartbeats: HeartbeatLog[];
  bgHistory: BackgroundAgentHistoryEntry[];
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const hasHeartbeats = heartbeats.length > 0;
  const hasBgHistory = bgHistory.length > 0;
  const isEmpty = !hasHeartbeats && !hasBgHistory;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
          Activity History
        </h3>
        <button
          onClick={onRefresh}
          aria-label="Refresh activity"
          className="text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isEmpty ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
          No activity history yet.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Heartbeat entries */}
          {hasHeartbeats && (
            <>
              <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                Heartbeat Cycles ({heartbeats.length})
              </h4>
              {heartbeats.map((hb) => {
                const hasFailed = hb.tasksFailed.length > 0;
                return (
                  <div
                    key={hb.id}
                    className="border border-border dark:border-dark-border rounded-lg p-3 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {hasFailed ? (
                        <AlertCircle className="w-3.5 h-3.5 text-danger" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      )}
                      <span className="font-medium text-text-primary dark:text-dark-text-primary">
                        {hb.tasksRun.length} task{hb.tasksRun.length !== 1 ? 's' : ''} run
                      </span>
                      {hasFailed && (
                        <span className="text-danger">{hb.tasksFailed.length} failed</span>
                      )}
                      <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                        {formatDuration(hb.durationMs)} · {formatCost(hb.cost)} ·{' '}
                        {formatTimeAgo(hb.createdAt)}
                      </span>
                    </div>
                    {hb.tasksRun.length > 0 && (
                      <div className="mt-1 pl-5 flex flex-wrap gap-1">
                        {hb.tasksRun.map((t) => (
                          <span
                            key={t.id}
                            className="px-2 py-0.5 rounded bg-success/10 text-success"
                          >
                            {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {hb.tasksFailed.length > 0 && (
                      <div className="mt-1 pl-5">
                        {hb.tasksFailed.map((t) => (
                          <p key={t.id} className="text-danger">
                            {t.id}: {t.error || 'failed'}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Background agent cycle entries */}
          {hasBgHistory && (
            <>
              <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider mt-4">
                Background Cycles ({bgHistory.length})
              </h4>
              {bgHistory.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="border border-border dark:border-dark-border rounded-lg p-3 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {entry.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-danger" />
                      )}
                      <span className="font-medium text-text-primary dark:text-dark-text-primary">
                        Cycle #{entry.cycleNumber}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        {entry.turns} turn{entry.turns !== 1 ? 's' : ''} · {entry.toolCalls.length}{' '}
                        tool call{entry.toolCalls.length !== 1 ? 's' : ''}
                      </span>
                      {!entry.success && entry.error && (
                        <span className="text-danger truncate max-w-40">{entry.error}</span>
                      )}
                      <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                        {formatDuration(entry.durationMs)}
                        {entry.costUsd != null && ` · ${formatCost(entry.costUsd)}`} ·{' '}
                        {formatTimeAgo(entry.executedAt)}
                      </span>
                      {entry.toolCalls.length > 0 && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="text-primary hover:text-primary-dark transition-colors"
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      )}
                    </div>
                    {entry.outputMessage && (
                      <p className="mt-1 pl-5 text-text-muted dark:text-dark-text-muted line-clamp-2">
                        {entry.outputMessage}
                      </p>
                    )}
                    {isExpanded && entry.toolCalls.length > 0 && (
                      <div className="mt-2 pl-5 space-y-1">
                        {entry.toolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-text-muted dark:text-dark-text-muted"
                          >
                            <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">
                              {tc.tool}
                            </span>
                            <span>{formatDuration(tc.duration)}</span>
                          </div>
                        ))}
                        {entry.tokensUsed && (
                          <div className="pt-1 text-text-muted dark:text-dark-text-muted">
                            Tokens: {entry.tokensUsed.prompt}in / {entry.tokensUsed.completion}out
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BudgetTab({
  soul,
  bgAgent,
  stats,
}: {
  soul: AgentSoul | null;
  bgAgent: BackgroundAgentConfig | null;
  stats: HeartbeatStats | null;
}) {
  const totalCost = stats?.totalCost ?? bgAgent?.session?.totalCostUsd ?? 0;
  const dailyLimit = soul?.autonomy.maxCostPerDay ?? bgAgent?.limits.totalBudgetUsd ?? 0;
  const monthlyLimit = soul?.autonomy.maxCostPerMonth ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Spent" value={formatCost(totalCost)} />
        <StatCard
          label="Daily Limit"
          value={dailyLimit > 0 ? formatCost(dailyLimit) : 'No limit'}
        />
        <StatCard
          label="Monthly Limit"
          value={monthlyLimit > 0 ? formatCost(monthlyLimit) : 'No limit'}
        />
      </div>

      {/* Budget bar */}
      {dailyLimit > 0 && (
        <div className="border border-border dark:border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
            Daily Budget Usage
          </h3>
          <div className="w-full bg-bg-secondary dark:bg-dark-bg-secondary rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                totalCost / dailyLimit > 0.8
                  ? 'bg-danger'
                  : totalCost / dailyLimit > 0.5
                    ? 'bg-warning'
                    : 'bg-success'
              }`}
              style={{ width: `${Math.min((totalCost / dailyLimit) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
            {formatCost(totalCost)} / {formatCost(dailyLimit)} (
            {((totalCost / dailyLimit) * 100).toFixed(0)}%)
          </p>
        </div>
      )}

      {/* Budget settings */}
      {soul && (
        <div className="border border-border dark:border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
            Budget Configuration
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <InfoRow label="Per Cycle" value={formatCost(soul.autonomy.maxCostPerCycle)} />
            <InfoRow label="Per Day" value={formatCost(soul.autonomy.maxCostPerDay)} />
            <InfoRow label="Per Month" value={formatCost(soul.autonomy.maxCostPerMonth)} />
            <InfoRow
              label="Pause on Budget"
              value={soul.autonomy.pauseOnBudgetExceeded ? 'Yes' : 'No'}
            />
            <InfoRow
              label="Pause on Errors"
              value={`After ${soul.autonomy.pauseOnConsecutiveErrors} consecutive`}
            />
            <InfoRow
              label="Notify on Pause"
              value={soul.autonomy.notifyUserOnPause ? 'Yes' : 'No'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Shared helpers
// =============================================================================

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border dark:border-dark-border rounded-lg p-4 text-center">
      <div className="text-xl font-bold text-text-primary dark:text-dark-text-primary">{value}</div>
      <div className="text-xs text-text-muted dark:text-dark-text-muted mt-1">{label}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-text-muted dark:text-dark-text-muted">{label}</span>
      <span className="text-text-primary dark:text-dark-text-primary">{value}</span>
    </>
  );
}

function TabContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full min-w-[800px] max-w-4xl py-4 animate-in fade-in duration-200">
      {children}
    </div>
  );
}

function ToolsTab({
  tools,
  allowedTools,
  blockedTools,
  isLoading,
  onChange,
}: {
  tools: Tool[];
  allowedTools: string[];
  blockedTools: string[];
  isLoading: boolean;
  onChange: (allowed: string[], blocked: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Tool Permissions
          </h3>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            Control which tools this agent can access. Blocked tools are restricted, allowed tools
            are explicitly permitted, and neutral tools follow default behavior.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center">
          <LoadingSpinner message="Loading tools..." />
        </div>
      ) : tools.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
          No tools available.
        </p>
      ) : (
        <ToolSelector
          availableTools={tools.map((t) => ({
            name: t.name,
            description: t.description,
            category: t.category,
            provider: t.provider,
          }))}
          allowedTools={allowedTools}
          blockedTools={blockedTools}
          onChange={onChange}
        />
      )}
    </div>
  );
}
