/**
 * Background Agents Page
 *
 * Dashboard for managing persistent, long-running autonomous agents.
 * Card grid layout with status indicators, controls, and cycle history.
 */

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import {
  RefreshCw,
  Plus,
  Play,
  Pause,
  StopCircle,
  Trash2,
  Clock,
  Send,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Repeat,
} from '../components/icons';
import { EmptyState } from '../components/EmptyState';
import { backgroundAgentsApi } from '../api/endpoints/background-agents';
import type {
  BackgroundAgentConfig,
  BackgroundAgentState,
  BackgroundAgentHistoryEntry,
  BackgroundAgentMode,
  CreateBackgroundAgentInput,
} from '../api/endpoints/background-agents';
import { useGateway } from '../hooks/useWebSocket';

// =============================================================================
// Constants
// =============================================================================

const STATE_COLORS: Record<BackgroundAgentState, string> = {
  starting: 'bg-yellow-500',
  running: 'bg-green-500',
  paused: 'bg-blue-500',
  waiting: 'bg-yellow-500',
  completed: 'bg-gray-400 dark:bg-gray-600',
  failed: 'bg-red-500',
  stopped: 'bg-gray-400 dark:bg-gray-600',
};

const STATE_LABELS: Record<BackgroundAgentState, string> = {
  starting: 'Starting',
  running: 'Running',
  paused: 'Paused',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

const MODE_LABELS: Record<BackgroundAgentMode, string> = {
  continuous: 'Continuous',
  interval: 'Interval',
  event: 'Event-Driven',
};

// =============================================================================
// Page Component
// =============================================================================

export function BackgroundAgentsPage() {
  const toast = useToast();
  const { subscribe } = useGateway();

  const [agents, setAgents] = useState<BackgroundAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [history, setHistory] = useState<BackgroundAgentHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [messageInput, setMessageInput] = useState('');

  // ---------- Data Loading ----------

  const loadAgents = useCallback(async () => {
    try {
      const data = await backgroundAgentsApi.list();
      setAgents(data);
    } catch (err) {
      toast.error('Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadHistory = useCallback(async (agentId: string) => {
    try {
      const data = await backgroundAgentsApi.getHistory(agentId, 20, 0);
      setHistory(data.entries);
      setHistoryTotal(data.total);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (selectedId) loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  // ---------- WebSocket Updates ----------

  useEffect(() => {
    const unsub = subscribe<{
      agentId: string;
      state: BackgroundAgentState;
      cyclesCompleted: number;
      totalToolCalls: number;
      lastCycleAt: string | null;
      lastCycleDurationMs: number | null;
      lastCycleError: string | null;
    }>('background-agent:update', (payload) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === payload.agentId
            ? {
                ...a,
                session: a.session
                  ? {
                      ...a.session,
                      state: payload.state,
                      cyclesCompleted: payload.cyclesCompleted,
                      totalToolCalls: payload.totalToolCalls,
                      lastCycleAt: payload.lastCycleAt,
                      lastCycleDurationMs: payload.lastCycleDurationMs,
                      lastCycleError: payload.lastCycleError,
                    }
                  : null,
              }
            : a
        )
      );
      // Refresh history if viewing this agent
      if (selectedId === payload.agentId) {
        loadHistory(payload.agentId);
      }
    });
    return unsub;
  }, [subscribe, selectedId, loadHistory]);

  // ---------- Actions ----------

  const handleStart = async (id: string) => {
    try {
      await backgroundAgentsApi.start(id);
      toast.success('Agent started');
      loadAgents();
    } catch (err) {
      toast.error('Failed to start agent');
    }
  };

  const handlePause = async (id: string) => {
    try {
      await backgroundAgentsApi.pause(id);
      toast.success('Agent paused');
      loadAgents();
    } catch (err) {
      toast.error('Failed to pause agent');
    }
  };

  const handleResume = async (id: string) => {
    try {
      await backgroundAgentsApi.resume(id);
      toast.success('Agent resumed');
      loadAgents();
    } catch (err) {
      toast.error('Failed to resume agent');
    }
  };

  const handleStop = async (id: string) => {
    try {
      await backgroundAgentsApi.stop(id);
      toast.success('Agent stopped');
      loadAgents();
    } catch (err) {
      toast.error('Failed to stop agent');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this background agent? This cannot be undone.')) return;
    try {
      await backgroundAgentsApi.delete(id);
      toast.success('Agent deleted');
      if (selectedId === id) setSelectedId(null);
      loadAgents();
    } catch (err) {
      toast.error('Failed to delete agent');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedId || !messageInput.trim()) return;
    try {
      await backgroundAgentsApi.sendMessage(selectedId, messageInput.trim());
      setMessageInput('');
      toast.success('Message sent');
    } catch (err) {
      toast.error('Failed to send message');
    }
  };

  const handleCreate = async (input: CreateBackgroundAgentInput) => {
    try {
      await backgroundAgentsApi.create(input);
      toast.success('Agent created');
      setShowCreateDialog(false);
      loadAgents();
    } catch (err) {
      toast.error('Failed to create agent');
    }
  };

  // ---------- Selected Agent ----------

  const selectedAgent = agents.find((a) => a.id === selectedId);
  const isActive = (state?: BackgroundAgentState) =>
    state === 'running' || state === 'waiting' || state === 'starting';

  // ---------- Render ----------

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Repeat className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Background Agents</h1>
          <span className="text-xs text-text-muted">({agents.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAgents}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            New Agent
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Agent List */}
        <div className="w-80 border-r border-border overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title="No background agents"
              description="Create autonomous agents that run continuously in the background"
              action={{ label: 'Create Agent', onClick: () => setShowCreateDialog(true) }}
            />
          ) : (
            <div className="p-2 space-y-1">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedId === agent.id
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-surface-hover border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{agent.name}</span>
                    <StateBadge state={agent.session?.state} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <span className="px-1.5 py-0.5 rounded bg-surface-hover text-text-muted">
                      {MODE_LABELS[agent.mode]}
                    </span>
                    {agent.session && (
                      <>
                        <span>{agent.session.cyclesCompleted} cycles</span>
                        <span>{agent.session.totalToolCalls} tools</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="flex-1 overflow-y-auto">
          {selectedAgent ? (
            <AgentDetail
              agent={selectedAgent}
              history={history}
              historyTotal={historyTotal}
              messageInput={messageInput}
              onMessageChange={setMessageInput}
              onSendMessage={handleSendMessage}
              onStart={() => handleStart(selectedAgent.id)}
              onPause={() => handlePause(selectedAgent.id)}
              onResume={() => handleResume(selectedAgent.id)}
              onStop={() => handleStop(selectedAgent.id)}
              onDelete={() => handleDelete(selectedAgent.id)}
              isActive={isActive(selectedAgent.session?.state)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Select an agent to view details
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <CreateAgentDialog onClose={() => setShowCreateDialog(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

function StateBadge({ state }: { state?: BackgroundAgentState }) {
  if (!state) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        Idle
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-text-muted">
      <span
        className={`w-1.5 h-1.5 rounded-full ${STATE_COLORS[state]} ${
          state === 'running' || state === 'starting' ? 'animate-pulse' : ''
        }`}
      />
      {STATE_LABELS[state]}
    </span>
  );
}

function AgentDetail({
  agent,
  history,
  historyTotal,
  messageInput,
  onMessageChange,
  onSendMessage,
  onStart,
  onPause,
  onResume,
  onStop,
  onDelete,
  isActive,
}: {
  agent: BackgroundAgentConfig;
  history: BackgroundAgentHistoryEntry[];
  historyTotal: number;
  messageInput: string;
  onMessageChange: (v: string) => void;
  onSendMessage: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDelete: () => void;
  isActive: boolean;
}) {
  const [showMission, setShowMission] = useState(false);
  const s = agent.session;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{agent.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <StateBadge state={s?.state} />
            <span className="text-xs text-text-muted px-1.5 py-0.5 rounded bg-surface-hover">
              {MODE_LABELS[agent.mode]}
            </span>
            {agent.intervalMs && (
              <span className="text-xs text-text-muted">
                every {Math.round(agent.intervalMs / 60000)}m
              </span>
            )}
            {agent.provider && (
              <span className="text-xs text-text-muted px-1.5 py-0.5 rounded bg-surface-hover">
                {agent.provider}
                {agent.model ? ` / ${agent.model}` : ''}
              </span>
            )}
            <span className="text-xs text-text-muted">by {agent.createdBy}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isActive && s?.state !== 'paused' && (
            <button
              onClick={onStart}
              className="p-1.5 rounded hover:bg-green-500/10 text-green-500"
              title="Start"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {isActive && (
            <button
              onClick={onPause}
              className="p-1.5 rounded hover:bg-blue-500/10 text-blue-500"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {s?.state === 'paused' && (
            <button
              onClick={onResume}
              className="p-1.5 rounded hover:bg-green-500/10 text-green-500"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {(isActive || s?.state === 'paused') && (
            <button
              onClick={onStop}
              className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
              title="Stop"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mission (collapsible) */}
      <button
        onClick={() => setShowMission(!showMission)}
        className="flex items-center gap-1 text-xs text-text-muted hover:text-text"
      >
        {showMission ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Mission
      </button>
      {showMission && (
        <div className="bg-surface rounded-lg p-3 text-sm text-text-muted whitespace-pre-wrap border border-border">
          {agent.mission}
        </div>
      )}

      {/* Stats */}
      {s && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Cycles" value={s.cyclesCompleted} />
          <StatCard label="Tool Calls" value={s.totalToolCalls} />
          <StatCard label="Cost" value={`$${s.totalCostUsd.toFixed(4)}`} />
          <StatCard label="Last Cycle" value={s.lastCycleAt ? formatTimeAgo(s.lastCycleAt) : '-'} />
        </div>
      )}

      {/* Last Error */}
      {s?.lastCycleError && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <span className="text-sm text-red-400">{s.lastCycleError}</span>
        </div>
      )}

      {/* Send Message */}
      {isActive && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={messageInput}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSendMessage()}
            placeholder="Send a message to this agent..."
            className="flex-1 px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
          />
          <button
            onClick={onSendMessage}
            disabled={!messageInput.trim()}
            className="p-2 rounded-lg bg-primary text-white disabled:opacity-50 hover:bg-primary/90"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Cycle History */}
      <div>
        <h3 className="text-sm font-medium mb-2">Cycle History ({historyTotal})</h3>
        {history.length === 0 ? (
          <p className="text-xs text-text-muted">No cycles yet</p>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <CycleEntry key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface rounded-lg p-3 border border-border">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function CycleEntry({ entry }: { entry: BackgroundAgentHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2.5 text-left"
      >
        {entry.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
        )}
        <span className="text-xs font-medium">Cycle {entry.cycleNumber}</span>
        <span className="text-[11px] text-text-muted">
          {entry.toolCalls.length} tools, {entry.durationMs}ms
        </span>
        {entry.tokensUsed && (
          <span className="text-[11px] text-text-muted">
            {entry.tokensUsed.prompt + entry.tokensUsed.completion} tokens
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-muted flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTimeAgo(entry.executedAt)}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-text-muted" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-muted" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          {entry.outputMessage && (
            <div className="text-xs text-text-muted whitespace-pre-wrap max-h-32 overflow-y-auto">
              {entry.outputMessage}
            </div>
          )}
          {entry.error && <div className="text-xs text-red-400">{entry.error}</div>}
          {entry.toolCalls.length > 0 && (
            <div className="space-y-1">
              {entry.toolCalls.map((tc, i) => (
                <div key={i} className="text-[11px] font-mono text-text-muted">
                  {tc.tool}({Object.keys(tc.args).join(', ')}) — {tc.duration}ms
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Create Agent Dialog
// =============================================================================

function CreateAgentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateBackgroundAgentInput) => void;
}) {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [mode, setMode] = useState<BackgroundAgentMode>('interval');
  const [intervalMin, setIntervalMin] = useState(5);
  const [stopCondition, setStopCondition] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !mission.trim()) return;
    onCreate({
      name: name.trim(),
      mission: mission.trim(),
      mode,
      interval_ms: mode === 'interval' ? intervalMin * 60_000 : undefined,
      stop_condition: stopCondition.trim() || undefined,
      provider: provider.trim() || undefined,
      model: model.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-lg p-6 border border-border dark:border-dark-border">
        <h2 className="text-lg font-semibold mb-4">Create Background Agent</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Goal Monitor, Email Summarizer"
              className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Mission</label>
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="Describe what this agent should do..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as BackgroundAgentMode)}
              className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
            >
              <option value="interval">Interval (run periodically)</option>
              <option value="continuous">Continuous (fast loop)</option>
              <option value="event">Event-driven (reactive)</option>
            </select>
          </div>

          {mode === 'interval' && (
            <div>
              <label className="block text-sm font-medium mb-1">Interval (minutes)</label>
              <input
                type="number"
                value={intervalMin}
                onChange={(e) => setIntervalMin(Number(e.target.value))}
                min={1}
                max={1440}
                className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Provider <span className="text-text-muted">(optional)</span>
              </label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Auto (system default)"
                className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Model <span className="text-text-muted">(optional)</span>
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Auto (system default)"
                className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Stop Condition <span className="text-text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={stopCondition}
              onChange={(e) => setStopCondition(e.target.value)}
              placeholder='e.g., max_cycles:100 (or agent says "MISSION_COMPLETE")'
              className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text rounded-lg hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !mission.trim()}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              Create & Start
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
