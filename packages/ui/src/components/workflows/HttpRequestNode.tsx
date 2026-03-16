/**
 * HttpRequestNode — ReactFlow node for HTTP requests in workflows.
 * API-focused design with prominent method badge (color-coded),
 * URL preview, and auth type indicator.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Globe, CheckCircle2, XCircle, Activity, AlertCircle, Lock } from '../icons';
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

const methodStyles: Record<string, { bg: string; text: string; headerBg: string }> = {
  GET: {
    bg: 'bg-emerald-500',
    text: 'text-white',
    headerBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
  },
  POST: {
    bg: 'bg-blue-500',
    text: 'text-white',
    headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
  },
  PUT: {
    bg: 'bg-amber-500',
    text: 'text-white',
    headerBg: 'bg-amber-500/10 dark:bg-amber-500/20',
  },
  PATCH: {
    bg: 'bg-indigo-500',
    text: 'text-white',
    headerBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
  },
  DELETE: {
    bg: 'bg-red-500',
    text: 'text-white',
    headerBg: 'bg-red-500/10 dark:bg-red-500/20',
  },
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
    bg: 'bg-blue-500',
    text: 'text-white',
    headerBg: 'bg-blue-500/10 dark:bg-blue-500/20',
  };
  const url = (data.url as string) ?? '';
  const auth = data.auth as Record<string, unknown> | undefined;
  const hasAuth = auth && Object.keys(auth).length > 0;

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[280px] rounded-lg border-2 shadow-sm overflow-hidden
        bg-white dark:bg-gray-900
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

      {/* Header row with method badge */}
      <div className={`px-3 py-2 ${mStyle.headerBg}`}>
        <div className="flex items-center gap-2">
          {/* Large method badge */}
          <span
            className={`px-2 py-0.5 text-[10px] font-extrabold rounded ${mStyle.bg} ${mStyle.text} tracking-wider`}
          >
            {method}
          </span>
          <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate flex-1">
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
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        {/* URL preview */}
        {url && (
          <div className="flex items-center gap-1">
            <Globe className="w-3 h-3 text-orange-400 shrink-0" />
            <p
              className="text-[10px] text-gray-600 dark:text-gray-400 truncate font-mono flex-1"
              title={url}
            >
              {url}
            </p>
          </div>
        )}

        {/* Auth indicator */}
        {hasAuth && (
          <div className="flex items-center gap-1">
            <Lock className="w-2.5 h-2.5 text-amber-500" />
            <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
              Auth configured
            </span>
          </div>
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
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />
    </div>
  );
}

export const HttpRequestNode = memo(HttpRequestNodeComponent);
