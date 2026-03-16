/**
 * MapNode — Maps/transforms each item in a collection using an expression.
 * Transform visual with sky gradient header, expression in dark code block,
 * "item -> result" flow indicator, and array brackets visual.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Repeat, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface MapNodeData extends Record<string, unknown> {
  label: string;
  /** JS expression applied to each item */
  expression?: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type MapNodeType = Node<MapNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-sky-300 dark:border-sky-700', bg: '' },
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

function MapNodeComponent({ data, selected }: NodeProps<MapNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const expression = (data.expression as string) ?? '';

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-sky-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-sky-500 !border-2 !border-white dark:!border-sky-950"
      />

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-sky-500 to-blue-400 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Repeat className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Map'}
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
        {/* Array brackets flow visual: [ ] -> [ ] */}
        <div className="flex items-center justify-center gap-1.5 text-sky-400 dark:text-sky-600">
          <span className="text-lg font-bold font-mono">[</span>
          <span className="text-[9px] text-sky-500 dark:text-sky-400 italic">item</span>
          <span className="text-lg font-bold font-mono">]</span>
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 8h10M10 5l3 3-3 3" />
          </svg>
          <span className="text-lg font-bold font-mono">[</span>
          <span className="text-[9px] text-sky-500 dark:text-sky-400 italic">result</span>
          <span className="text-lg font-bold font-mono">]</span>
        </div>

        {/* Expression in dark code block */}
        {expression && (
          <div className="bg-gray-900 dark:bg-gray-950 rounded px-2 py-1.5 overflow-hidden">
            <p className="text-[10px] text-sky-300 font-mono truncate" title={expression}>
              {expression}
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
        className="!w-3 !h-3 !bg-sky-500 !border-2 !border-white dark:!border-sky-950"
      />
    </div>
  );
}

export const MapNode = memo(MapNodeComponent);
