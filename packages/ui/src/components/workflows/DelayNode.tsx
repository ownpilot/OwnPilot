/**
 * DelayNode — ReactFlow node for timed delays in workflows.
 * Time-focused design with gradient rose-to-pink header, large duration
 * display, unit badge, and pulsing clock indicator when running.
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

const unitLabels: Record<string, string> = {
  seconds: 'SEC',
  minutes: 'MIN',
  hours: 'HRS',
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
  const unitLabel = unitLabels[unit] ?? unit.toUpperCase();

  // Determine if the duration is large (> 60 minutes)
  const numericDuration = parseFloat(duration) || 0;
  const isLargeDuration =
    (unit === 'hours' && numericDuration >= 1) || (unit === 'minutes' && numericDuration > 60);

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
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

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-rose-500 to-pink-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Clock className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Delay'}
        </span>
        {StatusIcon && (
          <StatusIcon
            className={`w-4 h-4 shrink-0 ${
              status === 'success'
                ? 'text-emerald-200'
                : status === 'error'
                  ? 'text-red-200'
                  : status === 'running'
                    ? 'text-amber-200'
                    : 'text-white/60'
            }`}
          />
        )}
      </div>

      {/* Body Content */}
      <div className="px-3 py-3 space-y-2">
        {/* Large Duration Display */}
        <div className="flex items-center justify-center gap-2">
          {/* Pulsing clock indicator when running */}
          <div
            className={`w-8 h-8 rounded-full border-2 border-rose-300 dark:border-rose-600 flex items-center justify-center ${
              status === 'running' ? 'animate-spin' : ''
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                status === 'running'
                  ? 'bg-amber-400 animate-pulse'
                  : status === 'success'
                    ? 'bg-emerald-400'
                    : 'bg-rose-400'
              }`}
            />
          </div>
          <span className="text-2xl font-bold text-rose-700 dark:text-rose-300 tracking-tight">
            {duration}
            <span className="text-lg font-semibold text-rose-400 dark:text-rose-500 ml-0.5">
              {suffix}
            </span>
          </span>
        </div>

        {/* Unit Badge */}
        <div className="flex items-center justify-center gap-1.5">
          <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 uppercase tracking-wider">
            {unitLabel}
          </span>
          {isLargeDuration && (
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              Max: 1 hour
            </span>
          )}
        </div>

        {/* Error message */}
        {status === 'error' && data.executionError && (
          <p className="text-xs text-error mt-1 truncate" title={data.executionError as string}>
            {data.executionError as string}
          </p>
        )}

        {/* Duration */}
        {data.executionDuration != null && (
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
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
