/**
 * FilterNode — Filters data based on a condition expression in workflows.
 * Data filtering visual with prominent funnel icon, condition preview
 * in monospace code block, and in/out flow indicator.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Filter, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface FilterNodeData extends Record<string, unknown> {
  label: string;
  /** Condition expression to filter by */
  condition?: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type FilterNodeType = Node<FilterNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-emerald-300 dark:border-emerald-700', bg: '' },
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

function FilterNodeComponent({ data, selected }: NodeProps<FilterNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const condition = (data.condition as string) ?? '';

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white dark:!border-emerald-950"
      />

      {/* Header with prominent funnel */}
      <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2">
          {/* Large funnel icon area */}
          <div className="w-7 h-7 rounded bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Filter className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <span className="font-medium text-sm text-emerald-900 dark:text-emerald-100 truncate flex-1">
            {(data.label as string) || 'Filter'}
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
        {/* Flow indicator */}
        <div className="flex items-center gap-1 text-[9px]">
          <span className="text-gray-400 dark:text-gray-500">in</span>
          <div className="flex-1 border-t border-dashed border-emerald-300 dark:border-emerald-700 relative">
            <span className="absolute left-1/2 -translate-x-1/2 -top-1.5 text-emerald-500">
              &#x25B6;
            </span>
          </div>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">out</span>
        </div>

        {/* Condition preview in code block */}
        {condition && (
          <div className="bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 overflow-hidden">
            <p
              className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono truncate"
              title={condition}
            >
              {condition}
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
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white dark:!border-emerald-950"
      />
    </div>
  );
}

export const FilterNode = memo(FilterNodeComponent);
