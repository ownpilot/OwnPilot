/**
 * AgentProfilePage — deep-dive view for a single autonomous agent
 *
 * Route: /autonomous/agent/:id
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { soulsApi, heartbeatLogsApi, agentMessagesApi } from '../../api/endpoints/souls';
import type {
  AgentSoul,
  HeartbeatLog,
  HeartbeatStats,
  AgentMessage,
} from '../../api/endpoints/souls';
import { backgroundAgentsApi } from '../../api/endpoints/background-agents';
import type { BackgroundAgentConfig } from '../../api/endpoints/background-agents';
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
} from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import { AgentStatusBadge } from './components/AgentStatusBadge';
import { SoulEditor } from './components/SoulEditor';
import type { AgentStatus, ProfileTab } from './types';
import { mapBackgroundState } from './types';
import { formatTimeAgo, formatCost, formatDuration } from './helpers';

export function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [isLoading, setIsLoading] = useState(true);

  // Agent data
  const [soul, setSoul] = useState<AgentSoul | null>(null);
  const [bgAgent, setBgAgent] = useState<BackgroundAgentConfig | null>(null);
  const [stats, setStats] = useState<HeartbeatStats | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatLog[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);

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
  const crewName = soul?.relationships?.crewId;

  // Data loading
  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const results = await Promise.allSettled([
        soulsApi.get(id),
        backgroundAgentsApi.get(id).catch(() => null),
        heartbeatLogsApi.getStats(id),
        heartbeatLogsApi.listByAgent(id, 20, 0),
        agentMessagesApi.listByAgent(id, 30, 0),
      ]);

      if (results[0].status === 'fulfilled') setSoul(results[0].value);
      if (results[1].status === 'fulfilled' && results[1].value)
        setBgAgent(results[1].value as BackgroundAgentConfig);
      if (results[2].status === 'fulfilled') setStats(results[2].value as HeartbeatStats);
      if (results[3].status === 'fulfilled') {
        const hbData = results[3].value;
        setHeartbeats(Array.isArray(hbData) ? hbData : []);
      }
      if (results[4].status === 'fulfilled') {
        const msgData = results[4].value;
        setMessages(Array.isArray(msgData) ? msgData : []);
      }
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Actions
  const handlePause = useCallback(async () => {
    if (!id) return;
    try {
      if (bgAgent) {
        await backgroundAgentsApi.pause(id);
      } else if (soul) {
        await soulsApi.update(id, {
          ...soul,
          heartbeat: { ...soul.heartbeat, enabled: false },
        } as unknown as Record<string, unknown>);
      }
      toast.success('Agent paused');
      fetchData();
    } catch {
      toast.error('Failed to pause');
    }
  }, [id, bgAgent, soul, toast, fetchData]);

  const handleResume = useCallback(async () => {
    if (!id) return;
    try {
      if (bgAgent) {
        await backgroundAgentsApi.resume(id);
      } else if (soul) {
        await soulsApi.update(id, {
          ...soul,
          heartbeat: { ...soul.heartbeat, enabled: true },
        } as unknown as Record<string, unknown>);
      }
      toast.success('Agent resumed');
      fetchData();
    } catch {
      toast.error('Failed to resume');
    }
  }, [id, bgAgent, soul, toast, fetchData]);

  const profileTabs: { key: ProfileTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    ...(isSoul ? [{ key: 'soul' as const, label: 'Soul' }] : []),
    { key: 'messages', label: 'Messages' },
    { key: 'activity', label: 'Activity' },
    { key: 'budget', label: 'Budget' },
  ];

  if (isLoading) return <LoadingSpinner message="Loading agent..." />;

  if (!soul && !bgAgent) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-center py-16">
        <p className="text-text-muted dark:text-dark-text-muted">Agent not found.</p>
        <button
          onClick={() => navigate('/autonomous')}
          className="mt-4 text-sm text-primary hover:text-primary-dark"
        >
          ← Back to hub
        </button>
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
          {(status === 'running' || status === 'waiting') && (
            <button
              onClick={handlePause}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-warning text-warning rounded-lg hover:bg-warning/10 transition-colors"
            >
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}
          {(status === 'paused' || status === 'idle' || status === 'stopped') && (
            <button
              onClick={handleResume}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-success text-success rounded-lg hover:bg-success/10 transition-colors"
            >
              <Play className="w-4 h-4" /> Resume
            </button>
          )}
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

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          soul={soul}
          bgAgent={bgAgent}
          stats={stats}
          heartbeats={heartbeats}
          messages={messages}
        />
      )}

      {activeTab === 'soul' && id && <SoulEditor agentId={id} />}

      {activeTab === 'messages' && id && (
        <MessagesTab agentId={id} messages={messages} onRefresh={fetchData} />
      )}

      {activeTab === 'activity' && <ActivityTab heartbeats={heartbeats} onRefresh={fetchData} />}

      {activeTab === 'budget' && <BudgetTab soul={soul} bgAgent={bgAgent} stats={stats} />}
    </div>
  );
}

// =============================================================================
// Tab Components
// =============================================================================

function OverviewTab({
  soul,
  bgAgent,
  stats,
  heartbeats,
  messages,
}: {
  soul: AgentSoul | null;
  bgAgent: BackgroundAgentConfig | null;
  stats: HeartbeatStats | null;
  heartbeats: HeartbeatLog[];
  messages: AgentMessage[];
}) {
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Heartbeat Cycles"
          value={String(stats?.totalCycles ?? heartbeats.length)}
        />
        <StatCard
          label="Success Rate"
          value={stats ? `${((1 - stats.failureRate) * 100).toFixed(0)}%` : '—'}
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
            </>
          )}
          {bgAgent && (
            <>
              <InfoRow label="Mode" value={bgAgent.mode} />
              <InfoRow label="Cycles" value={String(bgAgent.session?.cyclesCompleted ?? 0)} />
              <InfoRow label="Mission" value={bgAgent.mission} />
              <InfoRow label="Created" value={new Date(bgAgent.createdAt).toLocaleDateString()} />
            </>
          )}
        </div>
      </div>

      {/* Recent activity */}
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
    'w-full rounded-lg border border-border dark:border-dark-border bg-surface dark:bg-dark-surface text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

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
          className="text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
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
  onRefresh,
}: {
  heartbeats: HeartbeatLog[];
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
          Heartbeat History ({heartbeats.length})
        </h3>
        <button
          onClick={onRefresh}
          className="text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {heartbeats.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-8">
          No heartbeat history yet.
        </p>
      ) : (
        <div className="space-y-2">
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
                  {hasFailed && <span className="text-danger">{hb.tasksFailed.length} failed</span>}
                  <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                    {formatDuration(hb.durationMs)} · {formatCost(hb.cost)} ·{' '}
                    {formatTimeAgo(hb.createdAt)}
                  </span>
                </div>
                {hb.tasksRun.length > 0 && (
                  <div className="mt-1 pl-5 flex flex-wrap gap-1">
                    {hb.tasksRun.map((t) => (
                      <span key={t.id} className="px-2 py-0.5 rounded bg-success/10 text-success">
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
    <div className="space-y-6">
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
          <div className="w-full bg-surface dark:bg-dark-surface rounded-full h-3 overflow-hidden">
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
