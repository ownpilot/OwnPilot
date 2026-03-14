/**
 * SubWorkflowNode — ReactFlow node for calling another workflow as a sub-routine.
 * Nested flow visual with indigo-to-blue gradient header, workflow name,
 * depth badge, input mapping preview, and nested-squares icon.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GitBranch, CheckCircle2, XCircle, Activity, AlertCircle, Layers } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface SubWorkflowNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  /** ID of the workflow to execute as a sub-workflow */
  subWorkflowId?: string;
  /** Display name of the sub-workflow (for UI convenience) */
  subWorkflowName?: string;
  /** Map variable names -> template expressions for passing data into the sub-workflow */
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
  const inputMapping = data.inputMapping as Record<string, string> | undefined;
  const mappingEntries = inputMapping ? Object.entries(inputMapping).slice(0, 3) : [];
  const maxDepth = (data.maxDepth as number) ?? 5;

  return (
    <div
      className={`
        relative min-w-[220px] max-w-[300px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
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

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <GitBranch className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Sub-Workflow'}
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
        {/* Workflow name with nested-squares icon */}
        {data.subWorkflowName && (
          <div className="flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-indigo-400 shrink-0" />
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 truncate">
              {data.subWorkflowName as string}
            </span>
          </div>
        )}

        {/* Depth badge */}
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            Depth: {maxDepth}
          </span>
          {data.retryCount != null && (data.retryCount as number) > 0 && (
            <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {data.retryCount as number}x retry
            </span>
          )}
        </div>

        {/* Input mapping preview */}
        {mappingEntries.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 space-y-0.5">
            {mappingEntries.map(([key, val]) => (
              <div key={key} className="flex items-center gap-1 text-[9px] font-mono truncate">
                <span className="text-indigo-600 dark:text-indigo-400">{key}</span>
                <span className="text-gray-400">{'→'}</span>
                <span className="text-gray-500 dark:text-gray-400 truncate">{val}</span>
              </div>
            ))}
            {inputMapping && Object.keys(inputMapping).length > 3 && (
              <span className="text-[8px] text-gray-400">
                +{Object.keys(inputMapping).length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Description fallback */}
        {data.description && !data.subWorkflowName && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
            {data.description as string}
          </p>
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
