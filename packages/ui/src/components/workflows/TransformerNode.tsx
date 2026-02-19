/**
 * TransformerNode — ReactFlow node for data transformation in workflows.
 * Evaluates a JS expression to map, filter, or reshape data.
 * Amber/orange color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { RefreshCw, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface TransformerNodeData extends Record<string, unknown> {
  label: string;
  /** JS expression that transforms input data */
  expression: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
}

export type TransformerNodeType = Node<TransformerNodeData>;

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

function TransformerNodeComponent({ data, selected }: NodeProps<TransformerNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-amber-50 dark:bg-amber-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-amber-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-amber-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <span className="font-medium text-sm text-amber-900 dark:text-amber-100 truncate flex-1">
            {(data.label as string) || 'Transform'}
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

        {/* Expression preview */}
        {data.expression && (
          <p className="text-[10px] text-amber-600/70 dark:text-amber-400/50 mt-1 truncate font-mono">
            {data.expression as string}
          </p>
        )}

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
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-amber-950"
      />
    </div>
  );
}

export const TransformerNode = memo(TransformerNodeComponent);
