/**
 * ErrorHandlerNode — ReactFlow node for error handling in workflows.
 * Safety/recovery focused design with red gradient header, dashed border,
 * warning-stripe aesthetic, and continueOnSuccess toggle badge.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ShieldAlert, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface ErrorHandlerNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  continueOnSuccess?: boolean;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
}

export type ErrorHandlerNodeType = Node<ErrorHandlerNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-red-300 dark:border-red-700', bg: '' },
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

function ErrorHandlerNodeComponent({ data, selected }: NodeProps<ErrorHandlerNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const continueOnSuccess = data.continueOnSuccess as boolean | undefined;

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 border-dashed shadow-md overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-red-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-red-500 !border-2 !border-white dark:!border-red-950"
      />

      {/* Warning stripe accent at very top */}
      <div
        className="h-1 w-full"
        style={{
          background:
            'repeating-linear-gradient(135deg, #ef4444 0px, #ef4444 4px, #fbbf24 4px, #fbbf24 8px)',
        }}
      />

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-red-500 to-rose-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-white truncate block">
            {(data.label as string) || 'Error Handler'}
          </span>
          <span className="text-[9px] text-red-200/80 font-medium">Global Error Handler</span>
        </div>
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
        {/* Continue on success toggle badge */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-500 dark:text-gray-400">Continue on success:</span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded ${
              continueOnSuccess
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
            }`}
          >
            {continueOnSuccess ? 'ON' : 'OFF'}
          </span>
        </div>

        {/* Description */}
        {data.description && (
          <p
            className="text-[10px] text-gray-500 dark:text-gray-400 truncate"
            title={data.description as string}
          >
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

      {/* Warning stripe accent at bottom */}
      <div
        className="h-1 w-full"
        style={{
          background:
            'repeating-linear-gradient(135deg, #ef4444 0px, #ef4444 4px, #fbbf24 4px, #fbbf24 8px)',
        }}
      />
    </div>
  );
}

export const ErrorHandlerNode = memo(ErrorHandlerNodeComponent);
