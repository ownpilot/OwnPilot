/**
 * WebhookResponseNode — Terminal node that sends an HTTP response back to a webhook caller.
 * Response/reply visual with rose gradient header, large color-coded status code badge,
 * content-type chip, and NO bottom handle (terminal node).
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Send, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface WebhookResponseNodeData extends Record<string, unknown> {
  label: string;
  /** HTTP status code to return */
  statusCode?: number;
  /** Response content type */
  contentType?: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type WebhookResponseNodeType = Node<WebhookResponseNodeData>;

/** Color mapping based on HTTP status code range */
function getStatusCodeStyle(code: number): { bg: string; text: string; ring: string } {
  if (code >= 200 && code < 300) {
    return {
      bg: 'bg-emerald-100 dark:bg-emerald-900/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      ring: 'ring-emerald-300 dark:ring-emerald-700',
    };
  }
  if (code >= 300 && code < 400) {
    return {
      bg: 'bg-blue-100 dark:bg-blue-900/40',
      text: 'text-blue-700 dark:text-blue-300',
      ring: 'ring-blue-300 dark:ring-blue-700',
    };
  }
  if (code >= 400 && code < 500) {
    return {
      bg: 'bg-amber-100 dark:bg-amber-900/40',
      text: 'text-amber-700 dark:text-amber-300',
      ring: 'ring-amber-300 dark:ring-amber-700',
    };
  }
  if (code >= 500) {
    return {
      bg: 'bg-red-100 dark:bg-red-900/40',
      text: 'text-red-700 dark:text-red-300',
      ring: 'ring-red-300 dark:ring-red-700',
    };
  }
  return {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-700 dark:text-gray-300',
    ring: 'ring-gray-300 dark:ring-gray-700',
  };
}

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-rose-300 dark:border-rose-700', bg: '' },
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

function WebhookResponseNodeComponent({ data, selected }: NodeProps<WebhookResponseNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const statusCode = (data.statusCode as number) ?? 200;
  const contentType = (data.contentType as string) ?? '';
  const codeStyle = getStatusCodeStyle(statusCode);

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-rose-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-rose-500 !border-2 !border-white dark:!border-rose-950"
      />

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-rose-500 to-pink-400 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Send className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Webhook Response'}
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
        {/* Large prominent status code badge */}
        <div className="flex items-center justify-center">
          <span
            className={`inline-flex items-center px-3 py-1.5 text-lg font-bold rounded-lg ring-1 ${codeStyle.bg} ${codeStyle.text} ${codeStyle.ring}`}
          >
            {statusCode}
          </span>
        </div>

        {/* Content-Type chip */}
        {contentType && (
          <div className="flex items-center justify-center">
            <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-medium rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
              {contentType}
            </span>
          </div>
        )}

        {/* Reply visual indicator */}
        <div className="flex items-center justify-center gap-1 text-rose-300 dark:text-rose-700">
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M6 3L2 7l4 4" />
            <path d="M2 7h8a4 4 0 0 1 0 8H8" />
          </svg>
          <span className="text-[9px] font-medium text-rose-400 dark:text-rose-500">
            Reply to caller
          </span>
        </div>

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

      {/* No output handle — terminal node */}
    </div>
  );
}

export const WebhookResponseNode = memo(WebhookResponseNodeComponent);
