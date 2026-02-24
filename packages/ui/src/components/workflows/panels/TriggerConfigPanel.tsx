/**
 * Trigger Config Panel — configuration for trigger-type workflow nodes.
 * Supports manual, schedule (cron), event, condition, and webhook trigger types.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, Play } from '../../icons';
import type { TriggerNodeData } from '../TriggerNode';
import { CRON_PRESETS, validateCron } from '../../TriggerModal';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS } from '../NodeConfigPanel';

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual (click to run)' },
  { value: 'schedule', label: 'Schedule (cron)' },
  { value: 'event', label: 'Event' },
  { value: 'condition', label: 'Condition' },
  { value: 'webhook', label: 'Webhook' },
] as const;

const CONDITION_OPTIONS = [
  { value: 'stale_goals', label: 'Stale Goals' },
  { value: 'upcoming_deadline', label: 'Upcoming Deadline' },
  { value: 'memory_threshold', label: 'Memory Threshold' },
  { value: 'low_progress', label: 'Low Progress' },
  { value: 'no_activity', label: 'No Activity' },
];

export function TriggerConfigPanel({
  node,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as TriggerNodeData;

  const [label, setLabel] = useState(data.label ?? 'Trigger');
  const [triggerType, setTriggerType] = useState(data.triggerType ?? 'manual');
  const [cron, setCron] = useState(data.cron ?? '0 8 * * *');
  const [eventType, setEventType] = useState(data.eventType ?? '');
  const [condition, setCondition] = useState(data.condition ?? '');
  const [threshold, setThreshold] = useState(data.threshold ?? 0);
  const [webhookPath, setWebhookPath] = useState(data.webhookPath ?? '');

  // Reset on node change
  useEffect(() => {
    setLabel(data.label ?? 'Trigger');
    setTriggerType(data.triggerType ?? 'manual');
    setCron(data.cron ?? '0 8 * * *');
    setEventType(data.eventType ?? '');
    setCondition(data.condition ?? '');
    setThreshold(data.threshold ?? 0);
    setWebhookPath(data.webhookPath ?? '');
  }, [node.id]);

  // Push updates to parent
  const pushUpdate = useCallback(
    (partial: Partial<TriggerNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  const cronValidation = triggerType === 'schedule' ? validateCron(cron) : { valid: true };

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
          <Play className="w-3 h-3 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Trigger'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Config */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              if (label !== data.label) pushUpdate({ label });
            }}
            className={INPUT_CLS}
          />
        </div>

        {/* Trigger Type */}
        <div>
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
            When to run
          </label>
          <select
            value={triggerType}
            onChange={(e) => {
              const tt = e.target.value as TriggerNodeData['triggerType'];
              setTriggerType(tt);
              pushUpdate({ triggerType: tt });
            }}
            className={INPUT_CLS}
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Schedule config */}
        {triggerType === 'schedule' && (
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Cron Expression
              </label>
              <input
                type="text"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                onBlur={() => {
                  if (cronValidation.valid) pushUpdate({ cron });
                }}
                placeholder="0 8 * * *"
                className={`${INPUT_CLS} font-mono ${cron.trim() && !cronValidation.valid ? '!border-error !ring-error' : ''}`}
              />
              {cron.trim() && !cronValidation.valid ? (
                <p className="mt-1 text-[10px] text-error">{cronValidation.error}</p>
              ) : (
                <p className="mt-1 text-[10px] text-text-muted">minute hour day month weekday</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.cron}
                  type="button"
                  onClick={() => {
                    setCron(preset.cron);
                    pushUpdate({ cron: preset.cron });
                  }}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    cron === preset.cron
                      ? 'bg-violet-500/20 border-violet-400 text-violet-600 dark:text-violet-400'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-violet-400/50'
                  }`}
                  title={preset.desc}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Event config */}
        {triggerType === 'event' && (
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Event Type
            </label>
            <input
              type="text"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              onBlur={() => pushUpdate({ eventType })}
              placeholder="e.g., file_created, goal_completed"
              className={INPUT_CLS}
            />
          </div>
        )}

        {/* Condition config */}
        {triggerType === 'condition' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Condition
              </label>
              <select
                value={condition}
                onChange={(e) => {
                  setCondition(e.target.value);
                  pushUpdate({ condition: e.target.value });
                }}
                className={INPUT_CLS}
              >
                <option value="">Select condition...</option>
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Threshold
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                onBlur={() => pushUpdate({ threshold })}
                min={0}
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        {/* Webhook config */}
        {triggerType === 'webhook' && (
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Webhook Path
            </label>
            <input
              type="text"
              value={webhookPath}
              onChange={(e) => setWebhookPath(e.target.value)}
              onBlur={() => pushUpdate({ webhookPath })}
              placeholder="/hooks/my-trigger"
              className={INPUT_CLS}
            />
          </div>
        )}

        {/* Linked trigger info */}
        {data.triggerId && (
          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              Linked trigger: {data.triggerId}
            </span>
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="p-3 border-t border-border dark:border-dark-border">
        <button
          onClick={() => onDelete(node.id)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Trigger
        </button>
      </div>
    </div>
  );
}
