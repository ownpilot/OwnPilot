import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { triggersApi, apiClient } from '../api';
import type { Trigger, TriggerConfig, TriggerAction, TriggerHistoryEntry } from '../api';
import { Zap, Plus, Trash2, Play, Pause, Clock, History, Activity, Power, AlertCircle, CheckCircle2, BarChart } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useModalClose } from '../hooks';

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
        <HistoryModal
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

interface TriggerModalProps {
  trigger: Trigger | null;
  onClose: () => void;
  onSave: () => void;
}

// Simple cron presets for quick selection
const CRON_PRESETS: Array<{ label: string; cron: string; desc: string }> = [
  { label: 'Every hour', cron: '0 * * * *', desc: 'At minute 0 of every hour' },
  { label: 'Every morning (8:00)', cron: '0 8 * * *', desc: '8:00 AM daily' },
  { label: 'Every evening (20:00)', cron: '0 20 * * *', desc: '8:00 PM daily' },
  { label: 'Every 15 min', cron: '*/15 * * * *', desc: 'Every 15 minutes' },
  { label: 'Weekdays 9AM', cron: '0 9 * * 1-5', desc: 'Mon-Fri at 9:00 AM' },
  { label: 'Monday 9AM', cron: '0 9 * * 1', desc: 'Every Monday at 9:00 AM' },
];

/**
 * Client-side cron validation: checks format and field ranges
 */
function validateCron(cron: string): { valid: boolean; error?: string } {
  const trimmed = cron.trim();
  if (!trimmed) return { valid: false, error: 'Cron expression is required' };

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: `Expected 5 fields (minute hour day month weekday), got ${parts.length}` };
  }

  const fieldNames = ['Minute', 'Hour', 'Day', 'Month', 'Weekday'];
  const fieldRanges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

  for (let i = 0; i < 5; i++) {
    const part = parts[i]!;
    const [min, max] = fieldRanges[i]!;
    const name = fieldNames[i]!;

    if (part === '*') continue;
    if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10);
      if (isNaN(step) || step <= 0) return { valid: false, error: `${name}: invalid step "/${part.slice(2)}"` };
      continue;
    }
    // Split on comma for lists, then check each element
    const elements = part.split(',');
    for (const el of elements) {
      if (el.includes('-')) {
        const [a, b] = el.split('-').map(Number);
        if (isNaN(a!) || isNaN(b!)) return { valid: false, error: `${name}: invalid range "${el}"` };
        if (a! < min! || a! > max! || b! < min! || b! > max!) return { valid: false, error: `${name}: ${el} out of range ${min}-${max}` };
      } else {
        const n = parseInt(el, 10);
        if (isNaN(n)) return { valid: false, error: `${name}: "${el}" is not a number` };
        if (n < min! || n > max!) return { valid: false, error: `${name}: ${n} out of range ${min}-${max}` };
      }
    }
  }

  return { valid: true };
}

function TriggerModal({ trigger, onClose, onSave }: TriggerModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [name, setName] = useState(trigger?.name ?? '');
  const [description, setDescription] = useState(trigger?.description ?? '');
  const [type, setType] = useState<Trigger['type']>(trigger?.type ?? 'schedule');
  const [cron, setCron] = useState(trigger?.config.cron ?? '0 8 * * *');
  const [eventType, setEventType] = useState(trigger?.config.eventType ?? '');
  const [condition, setCondition] = useState(trigger?.config.condition ?? '');
  const [threshold, setThreshold] = useState(trigger?.config.threshold ?? 0);
  const [webhookPath, setWebhookPath] = useState(trigger?.config.webhookPath ?? '');
  const [actionType, setActionType] = useState<TriggerAction['type']>(
    trigger?.action.type ?? 'chat'
  );
  const [actionPayload, setActionPayload] = useState(
    JSON.stringify(trigger?.action.payload ?? {}, null, 2)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Cron validation
  const cronValidation = type === 'schedule' ? validateCron(cron) : { valid: true };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaveError(null);

    // Client-side cron validation
    if (type === 'schedule' && !cronValidation.valid) {
      setSaveError(cronValidation.error ?? 'Invalid cron expression');
      return;
    }

    setIsSaving(true);
    try {
      const config: TriggerConfig = {};
      if (type === 'schedule') {
        config.cron = cron.trim();
      } else if (type === 'event') {
        config.eventType = eventType;
      } else if (type === 'condition') {
        config.condition = condition;
        if (threshold > 0) config.threshold = threshold;
      } else if (type === 'webhook') {
        config.webhookPath = webhookPath;
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(actionPayload);
      } catch {
        // If not valid JSON, wrap as message
        if (actionPayload.trim()) {
          payload = { message: actionPayload.trim() };
        }
      }

      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        config,
        action: {
          type: actionType,
          payload,
        },
        enabled: trigger?.enabled ?? true,
      };

      if (trigger) {
        await triggersApi.update(trigger.id, body);
      } else {
        await apiClient.post('/triggers', body);
      }
      onSave();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save trigger');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {trigger ? 'Edit Trigger' : 'Create Trigger'}
            </h3>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Morning Briefing"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this trigger do?"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Trigger Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as Trigger['type'])}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="schedule">Schedule (Cron)</option>
                <option value="event">Event</option>
                <option value="condition">Condition</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>

            {type === 'schedule' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Cron Expression
                </label>
                <input
                  type="text"
                  value={cron}
                  onChange={(e) => { setCron(e.target.value); setSaveError(null); }}
                  placeholder="0 8 * * *"
                  className={`w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 ${
                    cron.trim() && !cronValidation.valid
                      ? 'border-error focus:ring-error/50'
                      : 'border-border dark:border-dark-border focus:ring-primary/50'
                  }`}
                />
                {cron.trim() && !cronValidation.valid ? (
                  <p className="mt-1 text-xs text-error">{cronValidation.error}</p>
                ) : (
                  <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                    Format: minute hour day month weekday (e.g., "0 8 * * *" = 8:00 AM daily)
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.cron}
                      type="button"
                      onClick={() => { setCron(preset.cron); setSaveError(null); }}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        cron === preset.cron
                          ? 'bg-primary/20 border-primary text-primary'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:border-primary/50'
                      }`}
                      title={preset.desc}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {type === 'event' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Event Type
                </label>
                <input
                  type="text"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  placeholder="e.g., file_created, goal_completed"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}

            {type === 'condition' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Condition
                  </label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">Select condition...</option>
                    <option value="stale_goals">Stale Goals</option>
                    <option value="upcoming_deadline">Upcoming Deadline</option>
                    <option value="memory_threshold">Memory Threshold</option>
                    <option value="low_progress">Low Progress</option>
                    <option value="no_activity">No Activity</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Threshold
                  </label>
                  <input
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    placeholder="0"
                    min={0}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                    {condition === 'stale_goals' && 'Days since last update (default: 3)'}
                    {condition === 'upcoming_deadline' && 'Days until deadline (default: 7)'}
                    {condition === 'memory_threshold' && 'Memory count threshold (default: 100)'}
                    {condition === 'low_progress' && 'Progress percentage below (default: 20)'}
                    {!condition && 'Depends on the condition type'}
                  </p>
                </div>
              </div>
            )}

            {type === 'webhook' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Webhook Path
                </label>
                <input
                  type="text"
                  value={webhookPath}
                  onChange={(e) => setWebhookPath(e.target.value)}
                  placeholder="/hooks/my-trigger"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Action Type
              </label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as TriggerAction['type'])}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="chat">Start Chat</option>
                <option value="tool">Run Tool</option>
                <option value="notification">Send Notification</option>
                <option value="goal_check">Check Goals</option>
                <option value="memory_summary">Memory Summary</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Action Payload
              </label>
              <textarea
                value={actionPayload}
                onChange={(e) => setActionPayload(e.target.value)}
                placeholder={
                  actionType === 'chat'
                    ? 'Message to send to the AI'
                    : 'JSON payload for the action'
                }
                rows={3}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono text-sm"
              />
            </div>
          </div>

          <div className="p-4 border-t border-border dark:border-dark-border">
            {saveError && (
              <div className="mb-3 p-2 bg-error/10 border border-error/30 rounded-lg text-sm text-error">
                {saveError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || isSaving || (type === 'schedule' && !cronValidation.valid)}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : trigger ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface HistoryModalProps {
  history: TriggerHistoryEntry[];
  onClose: () => void;
}

function HistoryModal({ history, onClose }: HistoryModalProps) {
  const { onBackdropClick } = useModalClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Trigger History
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {history.length === 0 ? (
            <p className="text-text-muted dark:text-dark-text-muted text-center">
              No history yet
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-text-primary dark:text-dark-text-primary">
                      {new Date(entry.firedAt).toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.durationMs != null && (
                        <span className="text-xs text-text-muted dark:text-dark-text-muted">
                          {entry.durationMs}ms
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          entry.status === 'success'
                            ? 'bg-success/10 text-success'
                            : entry.status === 'failure'
                            ? 'bg-error/10 text-error'
                            : 'bg-text-muted/10 text-text-muted'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  </div>
                  {entry.error && (
                    <p className="mt-1 text-xs text-error">{entry.error}</p>
                  )}
                  {entry.result != null && (
                    <pre className="mt-2 text-xs text-text-muted dark:text-dark-text-muted overflow-x-auto">
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
