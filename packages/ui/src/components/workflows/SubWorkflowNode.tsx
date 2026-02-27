/**
 * SubWorkflowNode — ReactFlow node for calling another workflow as a sub-routine.
 * Indigo color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GitBranch, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface SubWorkflowNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  /** ID of the workflow to execute as a sub-workflow */
  subWorkflowId?: string;
  /** Display name of the sub-workflow (for UI convenience) */
  subWorkflowName?: string;
  /** Map variable names → template expressions for passing data into the sub-workflow */
  inputMapping?: Record<string, string>;
  /** Max recursion depth (default: 5) */
  maxDepth?: number;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export type SubWorkflowNodeType = Node<SubWorkflowNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-indigo-300 dark:border-indigo-700', bg: '' },
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

function SubWorkflowNodeComponent({ data, selected }: NodeProps<SubWorkflowNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-indigo-50 dark:bg-indigo-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-indigo-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
            <GitBranch className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <span className="font-medium text-sm text-indigo-900 dark:text-indigo-100 truncate flex-1">
            {(data.label as string) || 'Sub-Workflow'}
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

        {/* Sub-workflow name badge */}
        {data.subWorkflowName && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 truncate">
              {data.subWorkflowName as string}
            </span>
          </div>
        )}

        {/* Description badge */}
        {data.description && !data.subWorkflowName && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 truncate">
              {data.description as string}
            </span>
          </div>
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
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-indigo-950"
      />
    </div>
  );
}

export const SubWorkflowNode = memo(SubWorkflowNodeComponent);
