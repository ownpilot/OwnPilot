/**
 * AggregateNode — Aggregates collection data (sum, count, avg, etc.) in workflows.
 * Statistics visual with large operation badge, field name display,
 * and chart-like icon area.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BarChart3, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface AggregateNodeData extends Record<string, unknown> {
  label: string;
  /** Collection expression to aggregate */
  arrayExpression?: string;
  /** Aggregation operation */
  operation?: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'groupBy' | 'flatten' | 'unique';
  /** Field name to aggregate on */
  field?: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type AggregateNodeType = Node<AggregateNodeData>;

const operationColors: Record<string, { bg: string; text: string }> = {
  sum: { bg: 'bg-amber-500', text: 'text-white' },
  count: { bg: 'bg-blue-500', text: 'text-white' },
  avg: { bg: 'bg-violet-500', text: 'text-white' },
  min: { bg: 'bg-emerald-500', text: 'text-white' },
  max: { bg: 'bg-red-500', text: 'text-white' },
  groupBy: { bg: 'bg-indigo-500', text: 'text-white' },
  flatten: { bg: 'bg-teal-500', text: 'text-white' },
  unique: { bg: 'bg-pink-500', text: 'text-white' },
};

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-amber-300 dark:border-amber-700', bg: '' },
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

function AggregateNodeComponent({ data, selected }: NodeProps<AggregateNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const operation = (data.operation as string) ?? '';
  const opStyle = operationColors[operation] ?? { bg: 'bg-amber-500', text: 'text-white' };
  const field = (data.field as string) ?? '';

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-amber-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-amber-950"
      />

      {/* Header with chart icon area */}
      <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/30">
        <div className="flex items-center gap-2">
          {/* Chart-like icon area */}
          <div className="w-7 h-7 rounded bg-amber-500/15 flex items-end justify-center gap-px pb-1 shrink-0">
            <div className="w-1 h-2 bg-amber-400 rounded-t" />
            <div className="w-1 h-3.5 bg-amber-500 rounded-t" />
            <div className="w-1 h-2.5 bg-amber-400 rounded-t" />
            <div className="w-1 h-4 bg-amber-600 rounded-t" />
          </div>
          <span className="font-medium text-sm text-amber-900 dark:text-amber-100 truncate flex-1">
            {(data.label as string) || 'Aggregate'}
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
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        {/* Large operation badge */}
        {operation && (
          <span
            className={`inline-block px-2.5 py-1 text-[11px] font-extrabold rounded uppercase tracking-wider ${opStyle.bg} ${opStyle.text}`}
          >
            {operation}
          </span>
        )}

        {/* Field name */}
        {field && (
          <div className="flex items-center gap-1">
            <BarChart3 className="w-2.5 h-2.5 text-amber-400" />
            <p className="text-[10px] text-amber-700 dark:text-amber-300 font-mono truncate">
              {field}
            </p>
          </div>
        )}

        {/* Error message */}
        {status === 'error' && data.executionError && (
          <p className="text-xs text-error truncate" title={data.executionError as string}>
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

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-amber-950"
      />
    </div>
  );
}

export const AggregateNode = memo(AggregateNodeComponent);
