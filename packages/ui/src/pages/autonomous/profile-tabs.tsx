/**
 * AgentProfilePage Tab Components
 *
 * Extracted from AgentProfilePage.tsx for maintainability.
 * Contains: OverviewTab, MessagesTab, ActivityTab, BudgetTab, ToolsTab,
 * and shared helpers (StatCard, InfoRow, TabContent).
 */

import { useState, useEffect, useCallback } from 'react';
import { soulsApi, agentMessagesApi } from '../../api/endpoints/souls';
import { agentsApi } from '../../api/endpoints/agents';
import type {
  AgentSoul,
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
  Heart,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Settings2,
  Check,
  X,
  MessageSquare,
} from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import { ToolSelector } from './components/ToolSelector';
import { formatTimeAgo, formatCost, formatDuration } from './helpers';
import type { Tool } from './components/ToolSelector';

// =============================================================================
// Shared helpers
// =============================================================================

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border dark:border-dark-border rounded-lg p-4 text-center">
      <div className="text-xl font-bold text-text-primary dark:text-dark-text-primary">{value}</div>
      <div className="text-xs text-text-muted dark:text-dark-text-muted mt-1">{label}</div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-text-muted dark:text-dark-text-muted">{label}</span>
      <span className="text-text-primary dark:text-dark-text-primary">{value}</span>
    </>
  );
}

export function TabContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full min-w-[800px] max-w-4xl py-4 animate-in fade-in duration-200">
      {children}
    </div>
  );
}

// =============================================================================
// OverviewTab
// =============================================================================

export function OverviewTab({
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

// =============================================================================
// MessagesTab
// =============================================================================

export function MessagesTab({
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

// =============================================================================
// ActivityTab
// =============================================================================

export function ActivityTab({
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

// =============================================================================
// BudgetTab
// =============================================================================

export function BudgetTab({
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
// ToolsTab
// =============================================================================

export function ToolsTab({
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
