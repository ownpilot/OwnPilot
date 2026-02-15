import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { triggersApi } from '../api';
import type { Trigger, TriggerAction, TriggerHistoryEntry } from '../api';
import { Zap, Plus, Trash2, Play, Pause, Clock, History, Activity, Power, AlertCircle, CheckCircle2, BarChart } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { TriggerModal } from '../components/TriggerModal';
import { TriggerHistoryModal } from '../components/TriggerHistoryModal';

const typeColors = {
  schedule: 'bg-blue-500/10 text-blue-500',
  event: 'bg-purple-500/10 text-purple-500',
  condition: 'bg-green-500/10 text-green-500',
  webhook: 'bg-orange-500/10 text-orange-500',
};

const typeIcons = {
  schedule: Clock,
  event: Zap,
  condition: History,
  webhook: Zap,
};

const actionTypeLabels: Record<TriggerAction['type'], string> = {
  chat: 'Start Chat',
  tool: 'Run Tool',
  notification: 'Send Notification',
  goal_check: 'Check Goals',
  memory_summary: 'Memory Summary',
};

// ============================================================================
// Relative Time Helper
// ============================================================================

function formatRelativeTime(dateStr: string): { text: string; isSoon: boolean } {
  const now = Date.now();
  const target = new Date(dateStr).getTime();
  const diff = target - now;
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(absDiff / 3600000);
  const days = Math.floor(absDiff / 86400000);

  let text: string;
  if (minutes < 1) text = 'just now';
  else if (minutes < 60) text = `${minutes}m`;
  else if (hours < 24) text = `${hours}h ${minutes % 60}m`;
  else text = `${days}d`;

  if (!isPast) text = `in ${text}`;
  else if (text !== 'just now') text = `${text} ago`;

  return { text, isSoon: !isPast && hours < 1 };
}

// ============================================================================
// Stats & Engine Status Types
// ============================================================================

interface TriggerStats {
  totalTriggers: number;
  enabledTriggers: number;
  totalFires: number;
  successCount: number;
  failureCount: number;
  [key: string]: unknown;
}

export function TriggersPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<Trigger['type'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<TriggerHistoryEntry[]>([]);

  // New state for enhanced features
  const [activeTab, setActiveTab] = useState<'triggers' | 'activity'>('triggers');
  const [stats, setStats] = useState<TriggerStats | null>(null);
  const [engineRunning, setEngineRunning] = useState<boolean | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [globalHistory, setGlobalHistory] = useState<TriggerHistoryEntry[]>([]);
  const [globalHistoryLoading, setGlobalHistoryLoading] = useState(false);
  const [dueTriggerIds, setDueTriggerIds] = useState<Set<string>>(new Set());
  const activityRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch triggers
  const fetchTriggers = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (typeFilter !== 'all') {
        params.type = typeFilter;
      }

      const data = await triggersApi.list(params);
      setTriggers(data.triggers);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const data = await triggersApi.stats();
      setStats(data as TriggerStats);
    } catch {
      // Stats are non-critical
    }
  }, []);

  // Fetch engine status
  const fetchEngineStatus = useCallback(async () => {
    try {
      const data = await triggersApi.engineStatus();
      setEngineRunning(data.running);
    } catch {
      // Engine status is non-critical
    }
  }, []);

  // Fetch due triggers
  const fetchDueTriggers = useCallback(async () => {
    try {
      const data = await triggersApi.due();
      setDueTriggerIds(new Set(data.triggers.map((t: Trigger) => t.id)));
    } catch {
      // Due triggers are non-critical
    }
  }, []);

  // Fetch global history
  const fetchGlobalHistory = useCallback(async () => {
    setGlobalHistoryLoading(true);
    try {
      const data = await triggersApi.globalHistory(50);
      setGlobalHistory(data.history);
    } catch {
      // Global history is non-critical
    } finally {
      setGlobalHistoryLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTriggers();
    fetchStats();
    fetchEngineStatus();
    fetchDueTriggers();
  }, [fetchTriggers, fetchStats, fetchEngineStatus, fetchDueTriggers]);

  // Auto-refresh activity tab every 30s
  useEffect(() => {
    if (activeTab === 'activity') {
      fetchGlobalHistory();
      activityRefreshRef.current = setInterval(() => {
        fetchGlobalHistory();
      }, 30000);
    }
    return () => {
      if (activityRefreshRef.current) {
        clearInterval(activityRefreshRef.current);
        activityRefreshRef.current = null;
      }
    };
  }, [activeTab, fetchGlobalHistory]);

  const fetchHistory = useCallback(async (triggerId: string) => {
    try {
      const data = await triggersApi.history(triggerId);
      setHistory(data.history);
      setShowHistory(triggerId);
    } catch {
      // API client handles error reporting
    }
  }, []);

  const handleDelete = useCallback(async (triggerId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this trigger?', variant: 'danger' })) return;

    try {
      await triggersApi.delete(triggerId);
      toast.success('Trigger deleted');
      fetchTriggers();
      fetchStats();
    } catch {
      // API client handles error reporting
    }
  }, [confirm, toast, fetchTriggers, fetchStats]);

  const handleToggle = useCallback(async (triggerId: string, enabled: boolean) => {
    try {
      await triggersApi.update(triggerId, { enabled });
      toast.success(enabled ? 'Trigger enabled' : 'Trigger disabled');
      fetchTriggers();
      fetchStats();
    } catch {
      // API client handles error reporting
    }
  }, [toast, fetchTriggers, fetchStats]);

  const handleFireNow = useCallback(async (triggerId: string) => {
    try {
      await triggersApi.fire(triggerId);
      toast.success('Trigger fired');
      fetchTriggers();
      fetchStats();
    } catch {
      // API client handles error reporting
    }
  }, [toast, fetchTriggers, fetchStats]);

  const handleEngineToggle = useCallback(async () => {
    setEngineLoading(true);
    try {
      if (engineRunning) {
        const data = await triggersApi.engineStop();
        setEngineRunning(data.running);
        toast.success(data.message);
      } else {
        const data = await triggersApi.engineStart();
        setEngineRunning(data.running);
        toast.success(data.message);
      }
    } catch {
      toast.error('Failed to toggle engine');
    } finally {
      setEngineLoading(false);
    }
  }, [engineRunning, toast]);

  const enabledCount = useMemo(() => triggers.filter((t) => t.enabled).length, [triggers]);
  const scheduleCount = useMemo(() => triggers.filter((t) => t.type === 'schedule').length, [triggers]);

  const successRate = useMemo(() => {
    if (!stats) return null;
    const total = (stats.successCount ?? 0) + (stats.failureCount ?? 0);
    if (total === 0) return null;
    return Math.round(((stats.successCount ?? 0) / total) * 100);
  }, [stats]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Triggers
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {enabledCount} enabled, {scheduleCount} scheduled
            </p>
          </div>

          {/* Engine Status Indicator */}
          {engineRunning !== null && (
            <button
              onClick={handleEngineToggle}
              disabled={engineLoading}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                engineRunning
                  ? 'bg-success/10 text-success hover:bg-success/20'
                  : 'bg-error/10 text-error hover:bg-error/20'
              } ${engineLoading ? 'opacity-50 cursor-wait' : ''}`}
              title={engineRunning ? 'Engine running - click to stop' : 'Engine stopped - click to start'}
            >
              <span className={`w-2 h-2 rounded-full ${engineRunning ? 'bg-success animate-pulse' : 'bg-error'}`} />
              <Power className="w-3 h-3" />
              {engineLoading ? 'Loading...' : engineRunning ? 'Engine Running' : 'Engine Stopped'}
            </button>
          )}
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Trigger
        </button>
      </header>

      {/* Stats Dashboard */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4 border-b border-border dark:border-dark-border">
          <StatCard
            icon={<Zap className="w-4 h-4 text-primary" />}
            label="Total"
            value={stats.totalTriggers ?? triggers.length}
          />
          <StatCard
            icon={<CheckCircle2 className="w-4 h-4 text-success" />}
            label="Enabled"
            value={stats.enabledTriggers ?? enabledCount}
          />
          <StatCard
            icon={<BarChart className="w-4 h-4 text-info" />}
            label="Total Fires"
            value={stats.totalFires ?? 0}
          />
          <StatCard
            icon={<Activity className="w-4 h-4 text-warning" />}
            label="Success Rate"
            value={successRate !== null ? `${successRate}%` : 'N/A'}
          />
        </div>
      )}

      {/* Tab bar: Triggers | Activity */}
      <div className="flex gap-0 px-6 border-b border-border dark:border-dark-border">
        <button
          onClick={() => setActiveTab('triggers')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'triggers'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
          }`}
        >
          Triggers
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'activity'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Activity
        </button>
      </div>

      {/* Filters (only for triggers tab) */}
      {activeTab === 'triggers' && (
        <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border">
          {(['all', 'schedule', 'event', 'condition', 'webhook'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                typeFilter === type
                  ? 'bg-primary text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {activeTab === 'triggers' ? (
          // Triggers List
          isLoading ? (
            <LoadingSpinner message="Loading triggers..." />
          ) : triggers.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No triggers yet"
              description="Triggers let the AI act proactively based on schedules, events, or conditions."
              action={{ label: 'Create Trigger', onClick: () => setShowCreateModal(true), icon: Plus }}
            />
          ) : (
            <div className="space-y-3">
              {triggers.map((trigger) => (
                <TriggerItem
                  key={trigger.id}
                  trigger={trigger}
                  isDue={dueTriggerIds.has(trigger.id)}
                  onEdit={() => setEditingTrigger(trigger)}
                  onDelete={() => handleDelete(trigger.id)}
                  onToggle={(enabled) => handleToggle(trigger.id, enabled)}
                  onFireNow={() => handleFireNow(trigger.id)}
                  onViewHistory={() => fetchHistory(trigger.id)}
                />
              ))}
            </div>
          )
        ) : (
          // Activity Tab - Global History
          <ActivityLog history={globalHistory} loading={globalHistoryLoading} triggers={triggers} />
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingTrigger) && (
        <TriggerModal
          trigger={editingTrigger}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTrigger(null);
          }}
          onSave={() => {
            toast.success(editingTrigger ? 'Trigger updated' : 'Trigger created');
            setShowCreateModal(false);
            setEditingTrigger(null);
            fetchTriggers();
            fetchStats();
          }}
        />
      )}

      {/* History Modal */}
      {showHistory && (
        <TriggerHistoryModal
          history={history}
          onClose={() => setShowHistory(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Stat Card
// ============================================================================

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
      <div className="p-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
        {icon}
      </div>
      <div>
        <p className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">{value}</p>
        <p className="text-xs text-text-muted dark:text-dark-text-muted">{label}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Activity Log
// ============================================================================

function ActivityLog({ history, loading, triggers }: { history: TriggerHistoryEntry[]; loading: boolean; triggers: Trigger[] }) {
  const triggerMap = useMemo(() => {
    const map = new Map<string, string>();
    triggers.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [triggers]);

  if (loading && history.length === 0) {
    return <LoadingSpinner message="Loading activity..." />;
  }

  if (history.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Trigger execution history will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          System-wide execution log (auto-refreshes every 30s)
        </p>
        {loading && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted animate-pulse">Refreshing...</span>
        )}
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[1fr_140px_80px_80px_1fr] gap-2 px-3 py-2 text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
        <span>Trigger</span>
        <span>Fired At</span>
        <span>Status</span>
        <span>Duration</span>
        <span>Result / Error</span>
      </div>

      {history.map((entry) => {
        const triggerName = triggerMap.get(entry.triggerId) ?? entry.triggerId.slice(0, 8);

        return (
          <div
            key={entry.id}
            className="grid grid-cols-[1fr_140px_80px_80px_1fr] gap-2 px-3 py-2.5 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg items-center text-sm"
          >
            <span className="text-text-primary dark:text-dark-text-primary font-medium truncate">
              {triggerName}
            </span>
            <span className="text-text-muted dark:text-dark-text-muted text-xs">
              {new Date(entry.firedAt).toLocaleString()}
            </span>
            <span
              className={`px-2 py-0.5 text-xs rounded-full text-center ${
                entry.status === 'success'
                  ? 'bg-success/10 text-success'
                  : entry.status === 'failure'
                  ? 'bg-error/10 text-error'
                  : 'bg-text-muted/10 text-text-muted'
              }`}
            >
              {entry.status}
            </span>
            <span className="text-text-muted dark:text-dark-text-muted text-xs">
              {entry.durationMs != null ? `${entry.durationMs}ms` : '-'}
            </span>
            <span className="text-xs text-text-muted dark:text-dark-text-muted truncate">
              {entry.error ? (
                <span className="text-error">{entry.error}</span>
              ) : entry.result != null ? (
                typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result).slice(0, 80)
              ) : (
                '-'
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Trigger Item (enhanced with due badge + relative time)
// ============================================================================

interface TriggerItemProps {
  trigger: Trigger;
  isDue?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onFireNow: () => void;
  onViewHistory: () => void;
}

function TriggerItem({ trigger, isDue, onEdit, onDelete, onToggle, onFireNow, onViewHistory }: TriggerItemProps) {
  const TypeIcon = typeIcons[trigger.type];
  const nextFireInfo = trigger.nextFire ? formatRelativeTime(trigger.nextFire) : null;

  return (
    <div
      className={`card-elevated card-hover flex items-start gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg ${
        !trigger.enabled ? 'opacity-60' : ''
      }`}
    >
      <TypeIcon className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-text-primary dark:text-dark-text-primary">
            {trigger.name}
          </span>
          <span className={`px-2 py-0.5 text-xs rounded-full ${typeColors[trigger.type]}`}>
            {trigger.type}
          </span>
          <span className="px-2 py-0.5 text-xs rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
            {actionTypeLabels[trigger.action.type]}
          </span>
          {isDue && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-warning/10 text-warning flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Due Now
            </span>
          )}
          {trigger.fireCount > 0 && (
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {trigger.fireCount}x fired
            </span>
          )}
        </div>

        {trigger.description && (
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary mb-1">
            {trigger.description}
          </p>
        )}

        <div className="text-sm text-text-muted dark:text-dark-text-muted">
          {trigger.type === 'schedule' && trigger.config.cron && (
            <span>Cron: {trigger.config.cron}</span>
          )}
          {trigger.type === 'event' && trigger.config.eventType && (
            <span>Event: {trigger.config.eventType}</span>
          )}
          {trigger.type === 'condition' && trigger.config.condition && (
            <span>Condition: {trigger.config.condition}</span>
          )}
          {trigger.type === 'webhook' && trigger.config.webhookPath && (
            <span>Path: {trigger.config.webhookPath}</span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
          {trigger.lastFired && (
            <span>Last: {new Date(trigger.lastFired).toLocaleString()}</span>
          )}
          {trigger.nextFire && nextFireInfo && (
            <span className={nextFireInfo.isSoon ? 'text-warning font-medium' : ''}>
              Next: {nextFireInfo.text} ({new Date(trigger.nextFire).toLocaleTimeString()})
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onViewHistory}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          title="View history"
          aria-label="View trigger history"
        >
          <History className="w-4 h-4" />
        </button>
        <button
          onClick={onFireNow}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
          title="Fire now"
          aria-label="Fire trigger now"
        >
          <Play className="w-4 h-4" />
        </button>
        <button
          onClick={() => onToggle(!trigger.enabled)}
          className={`p-1 transition-colors ${
            trigger.enabled
              ? 'text-success hover:text-warning'
              : 'text-text-muted dark:text-dark-text-muted hover:text-success'
          }`}
          title={trigger.enabled ? 'Disable' : 'Enable'}
          aria-label={trigger.enabled ? 'Disable trigger' : 'Enable trigger'}
        >
          {trigger.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
          aria-label="Delete trigger"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

