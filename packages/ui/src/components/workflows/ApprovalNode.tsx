/**
 * ApprovalNode — ReactFlow node for human approval gates in workflows.
 * Pauses execution and waits for manual approval/rejection.
 * Amber/yellow color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ShieldCheck, CheckCircle2, XCircle, Activity, AlertCircle, Clock } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface ApprovalNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  /** Message shown to the approver */
  approvalMessage?: string;
  /** Optional timeout in minutes — auto-reject if not approved in time */
  timeoutMinutes?: number;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type ApprovalNodeType = Node<ApprovalNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-amber-300 dark:border-amber-700', bg: '' },
  running: { border: 'border-warning', bg: 'bg-warning/5' },
  success: { border: 'border-success', bg: 'bg-success/5' },
  error: { border: 'border-error', bg: 'bg-error/5' },
  skipped: { border: 'border-text-muted/50', bg: 'bg-text-muted/5' },
};

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Clock,
  success: CheckCircle2,
  error: XCircle,
  skipped: AlertCircle,
};

function ApprovalNodeComponent({ data, selected }: NodeProps<ApprovalNodeType>) {
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
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <span className="font-medium text-sm text-amber-900 dark:text-amber-100 truncate flex-1">
            {(data.label as string) || 'Approval Gate'}
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

        {/* Description badge */}
        {data.approvalMessage && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 truncate">
              {data.approvalMessage as string}
            </span>
          </div>
        )}

        {/* Timeout badge */}
        {data.timeoutMinutes && (
          <div className="flex items-center gap-1 mt-1">
            <Activity className="w-2.5 h-2.5 text-amber-500" />
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              {data.timeoutMinutes as number}min timeout
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
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-amber-950"
      />
    </div>
  );
}

export const ApprovalNode = memo(ApprovalNodeComponent);
