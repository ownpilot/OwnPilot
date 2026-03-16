/**
 * MergeNode — Waits for multiple incoming branches to complete before continuing.
 * Convergence visual with teal gradient header, mode badge,
 * and converging arrows indicator. Compact layout.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GitMerge, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface MergeNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  /** Merge mode: 'waitAll' waits for all, 'firstCompleted' uses first result */
  mode?: 'waitAll' | 'firstCompleted';
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type MergeNodeType = Node<MergeNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-teal-300 dark:border-teal-700', bg: '' },
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

function MergeNodeComponent({ data, selected }: NodeProps<MergeNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const mode = (data.mode as string) || 'waitAll';

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-teal-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-teal-950"
      />

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-teal-600 to-teal-400 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <GitMerge className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Merge'}
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
      <div className="px-3 py-2 space-y-1.5">
        {/* Converging arrows visual */}
        <div className="flex items-center justify-center py-1">
          <svg
            className="w-10 h-5 text-teal-400 dark:text-teal-600"
            viewBox="0 0 40 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M5 2 L20 16" />
            <path d="M20 2 L20 16" />
            <path d="M35 2 L20 16" />
            <circle cx="20" cy="16" r="2" fill="currentColor" stroke="none" />
          </svg>
        </div>

        {/* Mode badge */}
        <div className="flex items-center justify-center">
          <span
            className={`inline-flex items-center px-2 py-0.5 text-[9px] font-bold rounded-full uppercase tracking-wider ${
              mode === 'waitAll'
                ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
            }`}
          >
            {mode === 'waitAll' ? 'Wait All' : 'First Completed'}
          </span>
        </div>

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

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-teal-950"
      />
    </div>
  );
}

export const MergeNode = memo(MergeNodeComponent);
