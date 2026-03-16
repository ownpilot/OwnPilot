/**
 * TriggerNode — special ReactFlow node that defines when a workflow starts.
 * Only has an output handle (it's the entry point).
 * Gradient green header with play icon, trigger type badges, and pulsing dot.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Play, Clock, Zap, AlertCircle, Globe } from '../icons';
import { CRON_PRESETS } from '../TriggerModal';

export interface TriggerNodeData extends Record<string, unknown> {
  triggerType: 'manual' | 'schedule' | 'event' | 'condition' | 'webhook';
  label: string;
  // Schedule
  cron?: string;
  timezone?: string;
  // Event
  eventType?: string;
  filters?: Record<string, unknown>;
  // Condition
  condition?: string;
  threshold?: number;
  checkInterval?: number;
  // Webhook
  webhookPath?: string;
  webhookSecret?: string;
  // Linked trigger in DB (set after save)
  triggerId?: string;
  // Runtime status
  executionStatus?: string;
}

export type TriggerNodeType = Node<TriggerNodeData>;

const triggerIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  manual: Play,
  schedule: Clock,
  event: Zap,
  condition: AlertCircle,
  webhook: Globe,
};

const triggerBadgeStyles: Record<string, { bg: string; text: string }> = {
  manual: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/50',
    text: 'text-emerald-800 dark:text-emerald-200',
  },
  schedule: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-200' },
  event: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-200' },
  condition: {
    bg: 'bg-orange-100 dark:bg-orange-900/50',
    text: 'text-orange-800 dark:text-orange-200',
  },
  webhook: {
    bg: 'bg-violet-100 dark:bg-violet-900/50',
    text: 'text-violet-800 dark:text-violet-200',
  },
};

function TriggerNodeComponent({ data, selected }: NodeProps<TriggerNodeType>) {
  const Icon = triggerIcons[data.triggerType as string] ?? Play;
  const triggerType = (data.triggerType as string) ?? 'manual';
  const badgeStyle = triggerBadgeStyles[triggerType] ?? {
    bg: 'bg-emerald-100 dark:bg-emerald-900/50',
    text: 'text-emerald-800 dark:text-emerald-200',
  };
  const isRunning = data.executionStatus === 'running';

  // Cron label
  const cronLabel =
    triggerType === 'schedule' && data.cron
      ? (CRON_PRESETS.find((p) => p.cron === data.cron)?.label ?? null)
      : null;

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-xl border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
        border-emerald-400 dark:border-emerald-500
        ${selected ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}
        transition-all duration-200
      `}
    >
      {/* Gradient Green Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Trigger'}
        </span>
        {/* Pulsing dot when running */}
        {isRunning && (
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        {/* Trigger Type Badge */}
        <span
          className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wide ${badgeStyle.bg} ${badgeStyle.text}`}
        >
          {triggerType}
        </span>

        {/* Schedule details */}
        {triggerType === 'schedule' && data.cron && (
          <div>
            <p className="text-[10px] font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 inline-block">
              {data.cron as string}
            </p>
            {cronLabel && (
              <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{cronLabel}</p>
            )}
          </div>
        )}

        {/* Event details */}
        {triggerType === 'event' && data.eventType && (
          <p className="text-[10px] text-gray-600 dark:text-gray-400 truncate">
            {data.eventType as string}
          </p>
        )}

        {/* Webhook path */}
        {triggerType === 'webhook' && (
          <p className="text-[10px] font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 truncate">
            {(data.webhookPath as string) ?? '/hooks/...'}
          </p>
        )}

        {/* Condition details */}
        {triggerType === 'condition' && data.condition && (
          <p className="text-[10px] font-mono text-gray-600 dark:text-gray-400 truncate">
            {data.condition as string}
            {data.threshold ? ` (${data.threshold})` : ''}
          </p>
        )}

        {/* Manual hint */}
        {triggerType === 'manual' && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Click to run</p>
        )}
      </div>

      {/* Output Handle only — trigger is the start node */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-white dark:!border-violet-950"
      />
    </div>
  );
}

export const TriggerNode = memo(TriggerNodeComponent);
