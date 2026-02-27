/**
 * DelayNode — ReactFlow node for timed delays in workflows.
 * Pauses execution for a configurable duration in seconds, minutes, or hours.
 * Rose color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Clock, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface DelayNodeData extends Record<string, unknown> {
  label: string;
  /** Numeric duration value as a string */
  duration: string;
  unit: 'seconds' | 'minutes' | 'hours';
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
}

export type DelayNodeType = Node<DelayNodeData>;

const unitSuffixes: Record<string, string> = {
  seconds: 's',
  minutes: 'm',
  hours: 'h',
};

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-rose-300 dark:border-rose-700', bg: '' },
  running: { border: 'border-warning', bg: 'bg-warning/5' },
  success: { border: 'border-success', bg: 'bg-success/5' },
  error: { border: 'border-error', bg: 'bg-error/5' },
  skipped: { border: 'border-text-muted/50', bg: 'bg-text-muted/5' },
};

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Activity,
  success: CheckCircle2,
  error: XCircle,
  skipped: AlertCircle,
};

function DelayNodeComponent({ data, selected }: NodeProps<DelayNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const duration = (data.duration as string) ?? '0';
  const unit = (data.unit as string) ?? 'seconds';
  const suffix = unitSuffixes[unit] ?? unit;

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-rose-50 dark:bg-rose-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-rose-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-rose-500 !border-2 !border-white dark:!border-rose-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
            <Clock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          </div>
          <span className="font-medium text-sm text-rose-900 dark:text-rose-100 truncate flex-1">
            {(data.label as string) || 'Delay'}
          </span>
          {StatusIcon && (
            <StatusIcon
              className={`w-4 h-4 shrink-0 ${
                status === 'success'
                  ? 'text-success'
                  : status === 'error'
                    ? 'text-error'
                    : status === 'running'
                      ? 'text-warning'
                      : 'text-text-muted'
              }`}
            />
          )}
        </div>

        {/* Duration badge */}
        <div className="flex items-center gap-1.5 mt-1">
          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-500/20 text-rose-700 dark:text-rose-300">
            {duration}{suffix}
          </span>
        </div>

        {/* Error message */}
        {status === 'error' && data.executionError && (
          <p className="text-xs text-error mt-1 truncate" title={data.executionError as string}>
            {data.executionError as string}
          </p>
        )}

        {/* Duration */}
        {data.executionDuration != null && (
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted mt-1">
            {(data.executionDuration as number) < 1000
              ? `${data.executionDuration}ms`
              : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
          </p>
        )}
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-rose-500 !border-2 !border-white dark:!border-rose-950"
      />
    </div>
  );
}

export const DelayNode = memo(DelayNodeComponent);
