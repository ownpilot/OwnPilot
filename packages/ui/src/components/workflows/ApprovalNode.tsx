/**
 * ApprovalNode — ReactFlow node for human approval gates in workflows.
 * Human-in-the-loop gate with amber-to-yellow gradient header,
 * "Requires Approval" badge, timeout countdown, and pulsing amber state.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ShieldCheck, CheckCircle2, XCircle, AlertCircle, Clock } from '../icons';
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
  const timeout = data.timeoutMinutes as number | undefined;
  const message = (data.approvalMessage as string) ?? '';

  return (
    <div
      className={`
        relative min-w-[210px] max-w-[300px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
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

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-amber-500 to-yellow-400 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1 drop-shadow-sm">
          {(data.label as string) || 'Approval Gate'}
        </span>
        {StatusIcon && (
          <StatusIcon
            className={`w-4 h-4 shrink-0 ${
              status === 'success'
                ? 'text-emerald-200'
                : status === 'error'
                  ? 'text-red-200'
                  : status === 'running'
                    ? 'text-white'
                    : 'text-white/60'
            }`}
          />
        )}
      </div>

      {/* Body Content */}
      <div className="px-3 py-2 space-y-2">
        {/* "Requires Approval" large badge */}
        <div className="flex items-center justify-center">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider ${
              status === 'running'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse ring-2 ring-amber-300 dark:ring-amber-600'
                : status === 'success'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : status === 'error'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
            }`}
          >
            {/* Stamp icon */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 1a1 1 0 0 1 1 1v3.586l1.707-1.707a1 1 0 0 1 1.414 1.414L8.414 7H10a1 1 0 1 1 0 2H6a1 1 0 1 1 0-2h1.586L5.879 5.293a1 1 0 0 1 1.414-1.414L9 5.586V2a1 1 0 0 1 1-1h0zM2 11a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2z" />
            </svg>
            {status === 'running' ? 'Awaiting Approval' : 'Requires Approval'}
          </span>
        </div>

        {/* Timeout countdown badge */}
        {timeout != null && timeout > 0 && (
          <div className="flex items-center justify-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {timeout}m timeout
            </span>
          </div>
        )}

        {/* Message preview */}
        {message && (
          <p
            className="text-[10px] text-gray-500 dark:text-gray-400 italic truncate"
            title={message}
          >
            &ldquo;{message.slice(0, 60)}
            {message.length > 60 ? '...' : ''}&rdquo;
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
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-amber-950"
      />
    </div>
  );
}

export const ApprovalNode = memo(ApprovalNodeComponent);
