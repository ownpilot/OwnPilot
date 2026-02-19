/**
 * TriggerNode — special ReactFlow node that defines when a workflow starts.
 * Only has an output handle (it's the entry point). Distinct violet style.
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
}

export type TriggerNodeType = Node<TriggerNodeData>;

const triggerIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  manual: Play,
  schedule: Clock,
  event: Zap,
  condition: AlertCircle,
  webhook: Globe,
};

/** Human-readable summary of the trigger config */
function triggerSummary(data: TriggerNodeData): string {
  switch (data.triggerType) {
    case 'manual':
      return 'Click to run';
    case 'schedule': {
      const preset = CRON_PRESETS.find((p) => p.cron === data.cron);
      return preset ? preset.label : data.cron ?? 'No schedule';
    }
    case 'event':
      return data.eventType ?? 'No event type';
    case 'condition':
      return data.condition
        ? `${data.condition}${data.threshold ? ` (${data.threshold})` : ''}`
        : 'No condition';
    case 'webhook':
      return data.webhookPath ?? '/hooks/...';
    default:
      return '';
  }
}

function TriggerNodeComponent({ data, selected }: NodeProps<TriggerNodeType>) {
  const Icon = triggerIcons[data.triggerType as string] ?? Play;

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[240px] rounded-xl border-2 shadow-sm
        bg-violet-50 dark:bg-violet-950/30
        border-violet-400 dark:border-violet-500
        ${selected ? 'ring-2 ring-violet-500 ring-offset-1' : ''}
        transition-all duration-200
      `}
    >
      {/* Content */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
          </div>
          <span className="font-medium text-sm text-violet-900 dark:text-violet-100 truncate flex-1">
            {(data.label as string) || 'Trigger'}
          </span>
        </div>

        <p className="text-xs text-violet-600 dark:text-violet-400 mt-1 truncate">
          {triggerSummary(data as TriggerNodeData)}
        </p>
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
