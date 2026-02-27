/**
 * SwitchNode — ReactFlow node for multi-way branching in workflows.
 * Evaluates an expression and routes to one of N named cases or a default branch.
 * Dynamic output handles are generated based on the configured cases.
 * Fuchsia color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Shuffle, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface SwitchNodeData extends Record<string, unknown> {
  label: string;
  /** Expression to evaluate for switch routing */
  expression: string;
  cases: Array<{ label: string; value: string }>;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  /** Which case label was matched during execution */
  branchTaken?: string;
}

export type SwitchNodeType = Node<SwitchNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-fuchsia-300 dark:border-fuchsia-700', bg: '' },
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

function SwitchNodeComponent({ data, selected }: NodeProps<SwitchNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const branchTaken = data.branchTaken as string | undefined;
  const cases = (data.cases as Array<{ label: string; value: string }>) ?? [];

  // Build the full list of output handles: each case + default
  const handleLabels = [...cases.map((c) => c.label), 'Default'];
  const handleCount = handleLabels.length;

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[320px] rounded-lg border-2 shadow-sm
        bg-fuchsia-50 dark:bg-fuchsia-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-fuchsia-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-fuchsia-500 !border-2 !border-white dark:!border-fuchsia-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-fuchsia-500/20 flex items-center justify-center shrink-0">
            <Shuffle className="w-3.5 h-3.5 text-fuchsia-600 dark:text-fuchsia-400" />
          </div>
          <span className="font-medium text-sm text-fuchsia-900 dark:text-fuchsia-100 truncate flex-1">
            {(data.label as string) || 'Switch'}
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

        {/* Expression preview */}
        {data.expression && (
          <p className="text-[10px] text-fuchsia-600/70 dark:text-fuchsia-400/50 mt-1 truncate font-mono">
            {data.expression as string}
          </p>
        )}

        {/* Branch taken indicator */}
        {branchTaken && status === 'success' && (
          <div className="mt-1">
            <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300">
              {branchTaken}
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

        {/* Output handle labels */}
        <div className="flex justify-between mt-2 text-[9px] text-fuchsia-600/60 dark:text-fuchsia-400/40">
          {handleLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      {/* Dynamic Output Handles — one per case + default, evenly spaced */}
      {handleLabels.map((label, index) => {
        const position = ((index + 1) / (handleCount + 1)) * 100;
        const isDefault = label === 'Default';
        return (
          <Handle
            key={label}
            type="source"
            position={Position.Bottom}
            id={isDefault ? 'default' : label}
            className={`!w-3 !h-3 !border-2 !border-white dark:!border-fuchsia-950 ${
              isDefault ? '!bg-gray-400' : '!bg-fuchsia-500'
            }`}
            style={{ left: `${position}%` }}
          />
        );
      })}
    </div>
  );
}

export const SwitchNode = memo(SwitchNodeComponent);
