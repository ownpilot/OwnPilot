/**
 * ParallelNode — Executes multiple branches simultaneously.
 * Fan-out visual with teal gradient header, large branch count badge,
 * branch label chips, and visual fan-out indicator.
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
        relative min-w-[220px] max-w-[300px] rounded-lg border-2 shadow-md overflow-hidden
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
      <div className="bg-gradient-to-r from-teal-500 to-emerald-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Columns className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Parallel'}
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
      <div className="px-3 py-2 space-y-2">
        {/* Large branch count badge */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-lg font-bold">
            {count}
          </span>
          <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">
            parallel branches
          </span>
        </div>

        {/* Fan-out visual indicator */}
        <div className="flex items-center justify-center gap-0.5 py-1">
          <div className="w-4 h-0.5 bg-teal-300 dark:bg-teal-700 rounded" />
          <svg
            className="w-5 h-4 text-teal-400 dark:text-teal-600"
            viewBox="0 0 20 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M10 2 L3 14" />
            <path d="M10 2 L10 14" />
            <path d="M10 2 L17 14" />
          </svg>
          <div className="w-4 h-0.5 bg-teal-300 dark:bg-teal-700 rounded" />
        </div>

        {/* Branch label chips */}
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {labels.slice(0, count).map((lbl, i) => (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium rounded bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
              >
                {lbl}
              </span>
            ))}
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

        {/* Bottom handle index labels */}
        <div className="flex justify-between text-[8px] font-mono text-teal-500/60 dark:text-teal-400/40">
          {Array.from({ length: count }).map((_, i) => (
            <span key={i}>{labels[i] ?? `#${i}`}</span>
          ))}
        </div>
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
