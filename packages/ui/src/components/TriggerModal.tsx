import { useState, useEffect } from 'react';
import { triggersApi, workflowsApi, apiClient } from '../api';
import type { Trigger, TriggerConfig, TriggerAction, Workflow } from '../api';
import { useModalClose } from '../hooks';

// Simple cron presets for quick selection
export const CRON_PRESETS: Array<{ label: string; cron: string; desc: string }> = [
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
export function validateCron(cron: string): { valid: boolean; error?: string } {
  const trimmed = cron.trim();
  if (!trimmed) return { valid: false, error: 'Cron expression is required' };

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day month weekday), got ${parts.length}`,
    };
  }

  const fieldNames = ['Minute', 'Hour', 'Day', 'Month', 'Weekday'];
  const fieldRanges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];

  for (let i = 0; i < 5; i++) {
    const part = parts[i]!;
    const [min, max] = fieldRanges[i]!;
    const name = fieldNames[i]!;

    if (part === '*') continue;
    if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10);
      if (isNaN(step) || step <= 0)
        return { valid: false, error: `${name}: invalid step "/${part.slice(2)}"` };
      continue;
    }
    // Split on comma for lists, then check each element
    const elements = part.split(',');
    for (const el of elements) {
      if (el.includes('-')) {
        const [a, b] = el.split('-').map(Number);
        if (isNaN(a!) || isNaN(b!))
          return { valid: false, error: `${name}: invalid range "${el}"` };
        if (a! < min! || a! > max! || b! < min! || b! > max!)
          return { valid: false, error: `${name}: ${el} out of range ${min}-${max}` };
      } else {
        const n = parseInt(el, 10);
        if (isNaN(n)) return { valid: false, error: `${name}: "${el}" is not a number` };
        if (n < min! || n > max!)
          return { valid: false, error: `${name}: ${n} out of range ${min}-${max}` };
      }
    }
  }

  return { valid: true };
}

export interface TriggerModalProps {
  trigger: Trigger | null;
  onClose: () => void;
  onSave: () => void;
}

export function TriggerModal({ trigger, onClose, onSave }: TriggerModalProps) {
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
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch workflows when action type is 'workflow'
  useEffect(() => {
    if (actionType === 'workflow') {
      workflowsApi
        .list({ limit: '100' })
        .then((res) => setWorkflows(res.workflows))
        .catch(() => {});
    }
  }, [actionType]);

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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onBackdropClick}
    >
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
                  onChange={(e) => {
                    setCron(e.target.value);
                    setSaveError(null);
                  }}
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
                      onClick={() => {
                        setCron(preset.cron);
                        setSaveError(null);
                      }}
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
                <option value="workflow">Run Workflow</option>
                <option value="notification">Send Notification</option>
                <option value="goal_check">Check Goals</option>
                <option value="memory_summary">Memory Summary</option>
              </select>
            </div>

            {actionType === 'workflow' ? (
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Workflow
                </label>
                <select
                  value={(() => {
                    try {
                      return (
                        ((JSON.parse(actionPayload) as Record<string, unknown>)
                          .workflowId as string) ?? ''
                      );
                    } catch {
                      return '';
                    }
                  })()}
                  onChange={(e) =>
                    setActionPayload(JSON.stringify({ workflowId: e.target.value }, null, 2))
                  }
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select a workflow...</option>
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name} {wf.status === 'inactive' ? '(inactive)' : ''}
                    </option>
                  ))}
                </select>
                {workflows.length === 0 && (
                  <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                    No workflows found. Create one first in the Workflows page.
                  </p>
                )}
              </div>
            ) : (
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
            )}
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
                disabled={
                  !name.trim() || isSaving || (type === 'schedule' && !cronValidation.valid)
                }
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
