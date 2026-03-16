/**
 * DataStoreNode — Key-value data store operations in workflows.
 * Database/storage look with cyan gradient header, color-coded operation badges,
 * monospace key display, and dimmed namespace prefix.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Database, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface DataStoreNodeData extends Record<string, unknown> {
  label: string;
  /** Store operation to perform */
  operation?: 'get' | 'set' | 'delete' | 'list' | 'has';
  /** Key name for the operation */
  key?: string;
  /** Namespace to scope keys */
  namespace?: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type DataStoreNodeType = Node<DataStoreNodeData>;

/** Per-operation badge colors */
const operationStyles: Record<string, { bg: string; text: string }> = {
  get: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  set: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  delete: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
  list: { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-700 dark:text-violet-300' },
  has: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
};

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-cyan-300 dark:border-cyan-700', bg: '' },
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

function DataStoreNodeComponent({ data, selected }: NodeProps<DataStoreNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const operation = (data.operation as string) ?? '';
  const opStyle = operationStyles[operation] ?? {
    bg: 'bg-cyan-100 dark:bg-cyan-900/40',
    text: 'text-cyan-700 dark:text-cyan-300',
  };

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-cyan-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-white dark:!border-cyan-950"
      />

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-cyan-500 to-sky-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Database className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Data Store'}
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
        {/* Cylinder visual + operation badge */}
        <div className="flex items-center gap-2">
          {/* Mini cylinder icon */}
          <svg
            className="w-5 h-6 text-cyan-300 dark:text-cyan-700 shrink-0"
            viewBox="0 0 20 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <ellipse cx="10" cy="5" rx="8" ry="3" />
            <path d="M2 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <ellipse cx="10" cy="12" rx="8" ry="2" strokeDasharray="3 2" opacity="0.4" />
          </svg>
          {operation && (
            <span
              className={`px-2 py-0.5 text-[10px] font-extrabold rounded uppercase tracking-wider ${opStyle.bg} ${opStyle.text}`}
            >
              {operation}
            </span>
          )}
        </div>

        {/* Key in monospace with namespace prefix */}
        {(data.key || data.namespace) && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 overflow-hidden">
            <p className="text-[10px] font-mono truncate">
              {data.namespace && (
                <span className="text-gray-400 dark:text-gray-500">
                  {data.namespace as string}/
                </span>
              )}
              <span className="text-cyan-700 dark:text-cyan-300 font-semibold">
                {(data.key as string) ?? ''}
              </span>
            </p>
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
        className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-white dark:!border-cyan-950"
      />
    </div>
  );
}

export const DataStoreNode = memo(DataStoreNodeComponent);
