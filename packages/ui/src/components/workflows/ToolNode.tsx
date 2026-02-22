/**
 * Custom ReactFlow node for tool execution in workflows.
 * Displays tool name, label, and execution status with color-coded borders.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CheckCircle2, XCircle, AlertCircle, Activity } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

// Extended data type with runtime execution state.
// Index signature required by ReactFlow's Node<Record<string, unknown>> constraint.
export interface ToolNodeData extends Record<string, unknown> {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  resolvedArgs?: Record<string, unknown>;
}

/** ReactFlow Node typed with ToolNodeData */
export type ToolNodeType = Node<ToolNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-border dark:border-dark-border', bg: '' },
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

function ToolNodeComponent({ data, selected }: NodeProps<ToolNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-bg-secondary dark:bg-dark-bg-secondary
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-primary ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-dark-bg-secondary"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header: label + status icon */}
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate flex-1">
            {(data.label as string) || (data.toolName as string)}
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

        {/* Tool name (if different from label) */}
        {data.label && data.label !== data.toolName && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 truncate">
            {data.toolName as string}
          </p>
        )}

        {/* Description */}
        {data.description && (
          <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1 line-clamp-2">
            {data.description as string}
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
        className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-dark-bg-secondary"
      />
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
