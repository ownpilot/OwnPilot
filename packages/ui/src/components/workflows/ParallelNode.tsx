/**
 * ParallelNode — Executes multiple branches simultaneously.
 * Teal color theme, multiple output handles.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Columns, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface ParallelNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  /** Number of parallel branches (2-10) */
  branchCount?: number;
  /** Optional labels for each branch */
  branchLabels?: string[];
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type ParallelNodeType = Node<ParallelNodeData>;

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

function ParallelNodeComponent({ data, selected }: NodeProps<ParallelNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const count = (data.branchCount as number) || 2;
  const labels = (data.branchLabels as string[]) ?? [];

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-sm
        bg-teal-50 dark:bg-teal-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-teal-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-teal-950"
      />

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
            <Columns className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          </div>
          <span className="font-medium text-sm text-teal-900 dark:text-teal-100 truncate flex-1">
            {(data.label as string) || 'Parallel'}
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

        <div className="flex items-center gap-1.5 mt-1">
          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-teal-500/20 text-teal-700 dark:text-teal-300">
            {count} branches
          </span>
        </div>

        {status === 'error' && data.executionError && (
          <p className="text-xs text-error mt-1 truncate" title={data.executionError as string}>
            {data.executionError as string}
          </p>
        )}

        {data.executionDuration != null && (
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted mt-1">
            {(data.executionDuration as number) < 1000
              ? `${data.executionDuration}ms`
              : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
          </p>
        )}
      </div>

      {/* Multiple output handles — one per branch */}
      {Array.from({ length: count }).map((_, i) => (
        <Handle
          key={`branch-${i}`}
          type="source"
          position={Position.Bottom}
          id={`branch-${i}`}
          className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-teal-950"
          style={{
            left: `${((i + 1) / (count + 1)) * 100}%`,
          }}
          title={labels[i] ?? `Branch ${i}`}
        />
      ))}
    </div>
  );
}

export const ParallelNode = memo(ParallelNodeComponent);
