/**
 * ForEachNode — ReactFlow node for iterating over arrays in workflows.
 * Processes each item through the "Each" body subgraph, collects results via "Done" handle.
 * Sky/cyan color theme to distinguish from other node types.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { RefreshCw, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface ForEachNodeData extends Record<string, unknown> {
  label: string;
  arrayExpression: string;
  itemVariable?: string;
  maxIterations?: number;
  onError?: 'stop' | 'continue';
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  /** Runtime: current iteration during execution */
  currentIteration?: number;
  /** Runtime: total items being iterated */
  totalIterations?: number;
}

export type ForEachNodeType = Node<ForEachNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-sky-300 dark:border-sky-700', bg: '' },
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

function ForEachNodeComponent({ data, selected }: NodeProps<ForEachNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const currentIter = data.currentIteration as number | undefined;
  const totalIter = data.totalIterations as number | undefined;

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-sky-50 dark:bg-sky-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-sky-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-sky-500 !border-2 !border-white dark:!border-sky-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0">
            <RefreshCw className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          </div>
          <span className="font-medium text-sm text-sky-900 dark:text-sky-100 truncate flex-1">
            {(data.label as string) || 'ForEach'}
          </span>
          {StatusIcon && (
            <StatusIcon className={`w-4 h-4 shrink-0 ${
              status === 'success' ? 'text-success' :
              status === 'error' ? 'text-error' :
              status === 'running' ? 'text-warning' :
              'text-text-muted'
            }`} />
          )}
        </div>

        {/* Array expression preview */}
        {!!data.arrayExpression && (
          <p className="text-[10px] text-sky-600/70 dark:text-sky-400/50 mt-1 truncate font-mono">
            {data.arrayExpression as string}
          </p>
        )}

        {/* Item variable alias */}
        {!!data.itemVariable && (
          <p className="text-[10px] text-sky-600/50 dark:text-sky-400/40 mt-0.5 truncate">
            as <span className="font-mono">{String(data.itemVariable)}</span>
          </p>
        )}

        {/* Iteration progress during execution */}
        {status === 'running' && currentIter != null && totalIter != null && totalIter > 0 && (
          <div className="mt-1.5">
            <div className="flex items-center justify-between text-[9px] text-sky-700 dark:text-sky-300 mb-0.5">
              <span>{(currentIter as number) + 1}/{totalIter}</span>
            </div>
            <div className="w-full h-1 bg-sky-200 dark:bg-sky-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all duration-300"
                style={{ width: `${(((currentIter as number) + 1) / (totalIter as number)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Completed iteration count */}
        {status === 'success' && !!data.executionOutput && (
          <div className="mt-1">
            <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded bg-sky-500/20 text-sky-700 dark:text-sky-300">
              {(data.executionOutput as { count?: number })?.count ?? 0} items
            </span>
          </div>
        )}

        {/* Error message */}
        {status === 'error' && !!data.executionError && (
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

        {/* Output handle labels */}
        <div className="flex justify-between mt-2 text-[9px] text-sky-600/60 dark:text-sky-400/40">
          <span>Each</span>
          <span>Done</span>
        </div>
      </div>

      {/* Each Output Handle (left) — connects to body subgraph */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="each"
        className="!w-3 !h-3 !bg-sky-500 !border-2 !border-white dark:!border-sky-950"
        style={{ left: '30%' }}
      />

      {/* Done Output Handle (right) — connects to post-loop nodes */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="done"
        className="!w-3 !h-3 !bg-sky-400 !border-2 !border-white dark:!border-sky-950"
        style={{ left: '70%' }}
      />
    </div>
  );
}

export const ForEachNode = memo(ForEachNodeComponent);
