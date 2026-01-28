import { useState, useEffect, useCallback } from 'react';
import { Zap, Plus, Trash2, Play, Pause, Clock, History } from '../components/icons';

interface TriggerConfig {
  cron?: string;
  event?: string;
  condition?: string;
  webhookPath?: string;
  [key: string]: unknown;
}

interface TriggerAction {
  type: 'chat' | 'tool' | 'notification' | 'goal_check';
  payload: unknown;
}

interface Trigger {
  id: string;
  type: 'schedule' | 'event' | 'condition' | 'webhook';
  name: string;
  config: TriggerConfig;
  action: TriggerAction;
  enabled: boolean;
  lastFired?: string;
  nextFire?: string;
  createdAt: string;
  updatedAt: string;
}

interface TriggerHistoryEntry {
  id: string;
  triggerId: string;
  firedAt: string;
  result?: Record<string, unknown>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

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

const actionTypeLabels = {
  chat: 'Start Chat',
  tool: 'Run Tool',
  notification: 'Send Notification',
  goal_check: 'Check Goals',
};

export function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<Trigger['type'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<TriggerHistoryEntry[]>([]);

  const fetchTriggers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') {
        params.append('type', typeFilter);
      }

      const response = await fetch(`/api/v1/triggers?${params}`);
      const data: ApiResponse<{ triggers: Trigger[] }> = await response.json();
      if (data.success && data.data) {
        setTriggers(data.data.triggers);
      }
    } catch (err) {
      console.error('Failed to fetch triggers:', err);
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    fetchTriggers();
  }, [fetchTriggers]);

  const fetchHistory = async (triggerId: string) => {
    try {
      const response = await fetch(`/api/v1/triggers/${triggerId}/history`);
      const data: ApiResponse<{ history: TriggerHistoryEntry[] }> = await response.json();
      if (data.success && data.data) {
        setHistory(data.data.history);
        setShowHistory(triggerId);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const handleDelete = async (triggerId: string) => {
    if (!confirm('Are you sure you want to delete this trigger?')) return;

    try {
      const response = await fetch(`/api/v1/triggers/${triggerId}`, {
        method: 'DELETE',
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchTriggers();
      }
    } catch (err) {
      console.error('Failed to delete trigger:', err);
    }
  };

  const handleToggle = async (triggerId: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/v1/triggers/${triggerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchTriggers();
      }
    } catch (err) {
      console.error('Failed to toggle trigger:', err);
    }
  };

  const handleFireNow = async (triggerId: string) => {
    try {
      const response = await fetch(`/api/v1/triggers/${triggerId}/fire`, {
        method: 'POST',
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchTriggers();
      }
    } catch (err) {
      console.error('Failed to fire trigger:', err);
    }
  };

  const enabledCount = triggers.filter((t) => t.enabled).length;
  const scheduleCount = triggers.filter((t) => t.type === 'schedule').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Triggers
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {enabledCount} enabled, {scheduleCount} scheduled
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Trigger
        </button>
      </header>

      {/* Filters */}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading triggers...</p>
          </div>
        ) : triggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Zap className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              No triggers yet
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted mb-4 text-center max-w-md">
              Triggers let the AI act proactively based on schedules, events, or conditions.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Trigger
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {triggers.map((trigger) => (
              <TriggerItem
                key={trigger.id}
                trigger={trigger}
                onEdit={() => setEditingTrigger(trigger)}
                onDelete={() => handleDelete(trigger.id)}
                onToggle={(enabled) => handleToggle(trigger.id, enabled)}
                onFireNow={() => handleFireNow(trigger.id)}
                onViewHistory={() => fetchHistory(trigger.id)}
              />
            ))}
          </div>
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
            setShowCreateModal(false);
            setEditingTrigger(null);
            fetchTriggers();
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

interface TriggerItemProps {
  trigger: Trigger;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onFireNow: () => void;
  onViewHistory: () => void;
}

function TriggerItem({ trigger, onEdit, onDelete, onToggle, onFireNow, onViewHistory }: TriggerItemProps) {
  const TypeIcon = typeIcons[trigger.type];

  return (
    <div
      className={`flex items-start gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors ${
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
        </div>

        <div className="text-sm text-text-muted dark:text-dark-text-muted">
          {trigger.type === 'schedule' && trigger.config.cron && (
            <span>Cron: {trigger.config.cron}</span>
          )}
          {trigger.type === 'event' && trigger.config.event && (
            <span>Event: {trigger.config.event}</span>
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
          {trigger.nextFire && (
            <span>Next: {new Date(trigger.nextFire).toLocaleString()}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onViewHistory}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          title="View history"
        >
          <History className="w-4 h-4" />
        </button>
        <button
          onClick={onFireNow}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
          title="Fire now"
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
        >
          {trigger.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
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

function TriggerModal({ trigger, onClose, onSave }: TriggerModalProps) {
  const [name, setName] = useState(trigger?.name ?? '');
  const [type, setType] = useState<Trigger['type']>(trigger?.type ?? 'schedule');
  const [cron, setCron] = useState(trigger?.config.cron ?? '0 8 * * *');
  const [event, setEvent] = useState(trigger?.config.event ?? '');
  const [condition, setCondition] = useState(trigger?.config.condition ?? '');
  const [actionType, setActionType] = useState<TriggerAction['type']>(
    trigger?.action.type ?? 'chat'
  );
  const [actionPayload, setActionPayload] = useState(
    typeof trigger?.action.payload === 'string'
      ? trigger.action.payload
      : JSON.stringify(trigger?.action.payload ?? '', null, 2)
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const config: TriggerConfig = {};
      if (type === 'schedule') {
        config.cron = cron;
      } else if (type === 'event') {
        config.event = event;
      } else if (type === 'condition') {
        config.condition = condition;
      }

      let payload: unknown = actionPayload;
      try {
        payload = JSON.parse(actionPayload);
      } catch {
        // Keep as string if not valid JSON
      }

      const body = {
        name: name.trim(),
        type,
        config,
        action: {
          type: actionType,
          payload,
        },
        enabled: trigger?.enabled ?? true,
      };

      const url = trigger ? `/api/v1/triggers/${trigger.id}` : '/api/v1/triggers';
      const method = trigger ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.success) {
        onSave();
      }
    } catch (err) {
      console.error('Failed to save trigger:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 8 * * *"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                  Format: minute hour day month weekday (e.g., "0 8 * * *" = 8:00 AM daily)
                </p>
              </div>
            )}

            {type === 'event' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Event Name
                </label>
                <input
                  type="text"
                  value={event}
                  onChange={(e) => setEvent(e.target.value)}
                  placeholder="e.g., file_created, goal_completed"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}

            {type === 'condition' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Condition
                </label>
                <input
                  type="text"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="e.g., stale_goals > 3"
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

          <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : trigger ? 'Save' : 'Create'}
            </button>
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
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
                  <div className="text-sm text-text-primary dark:text-dark-text-primary">
                    {new Date(entry.firedAt).toLocaleString()}
                  </div>
                  {entry.result && (
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
