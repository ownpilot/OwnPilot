/**
 * HttpRequestNode — ReactFlow node for HTTP requests in workflows.
 * Supports GET, POST, PUT, PATCH, and DELETE methods with configurable
 * URL, headers, query params, body, and auth.
 * Orange color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Globe, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface HttpRequestNodeData extends Record<string, unknown> {
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: string;
  bodyType?: string;
  auth?: Record<string, unknown>;
  maxResponseSize?: number;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
}

export type HttpRequestNodeType = Node<HttpRequestNodeData>;

const methodStyles: Record<string, { bg: string; text: string }> = {
  GET: { bg: 'bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300' },
  POST: { bg: 'bg-blue-500/20', text: 'text-blue-700 dark:text-blue-300' },
  PUT: { bg: 'bg-amber-500/20', text: 'text-amber-700 dark:text-amber-300' },
  PATCH: { bg: 'bg-indigo-500/20', text: 'text-indigo-700 dark:text-indigo-300' },
  DELETE: { bg: 'bg-red-500/20', text: 'text-red-700 dark:text-red-300' },
};

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-orange-300 dark:border-orange-700', bg: '' },
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

function HttpRequestNodeComponent({ data, selected }: NodeProps<HttpRequestNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const method = (data.method as string) ?? 'GET';
  const mStyle = methodStyles[method] ?? {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
  };
  const url = (data.url as string) ?? '';

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-orange-50 dark:bg-orange-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-orange-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
            <Globe className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
          </div>
          <span className="font-medium text-sm text-orange-900 dark:text-orange-100 truncate flex-1">
            {(data.label as string) || 'HTTP Request'}
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

        {/* Method badge + URL preview */}
        <div className="flex items-center gap-1.5 mt-1">
          <span
            className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${mStyle.bg} ${mStyle.text}`}
          >
            {method}
          </span>
          {url && (
            <p className="text-[10px] text-orange-600/70 dark:text-orange-400/50 truncate font-mono flex-1">
              {url}
            </p>
          )}
        </div>

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
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />
    </div>
  );
}

export const HttpRequestNode = memo(HttpRequestNodeComponent);
