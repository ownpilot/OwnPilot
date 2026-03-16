/**
 * SwitchNode — ReactFlow node for multi-way branching in workflows.
 * Evaluates an expression and routes to one of N named cases or a default branch.
 * Dynamic output handles are generated based on the configured cases.
 * Fuchsia gradient header with expression code block and colored case chips.
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

/** Rotating chip colors for case labels */
const caseChipColors = [
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
];

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
  const expression = (data.expression as string) ?? '';

  // Build the full list of output handles: each case + default
  const handleLabels = [...cases.map((c) => c.label), 'Default'];
  const handleCount = handleLabels.length;

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[320px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
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

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-fuchsia-500 to-purple-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Shuffle className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Switch'}
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
        {/* Expression in dark code block */}
        {expression && (
          <div className="bg-gray-900 dark:bg-gray-950 rounded px-2 py-1.5 overflow-hidden">
            <p className="text-[10px] text-fuchsia-300 font-mono truncate" title={expression}>
              {expression}
            </p>
          </div>
        )}

        {/* Case chips */}
        {cases.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {cases.map((c, i) => {
              const chipColor = caseChipColors[i % caseChipColors.length];
              const isActive = branchTaken === c.label && status === 'success';
              return (
                <span
                  key={c.label}
                  className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded ${
                    isActive ? 'bg-fuchsia-500 text-white ring-1 ring-fuchsia-400' : chipColor
                  }`}
                >
                  {c.label}
                </span>
              );
            })}
            {/* Default case — shown dimmed */}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium rounded ${
                branchTaken === 'Default' && status === 'success'
                  ? 'bg-fuchsia-500 text-white ring-1 ring-fuchsia-400'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
              }`}
            >
              default
            </span>
          </div>
        )}

        {/* Active branch highlight */}
        {branchTaken && status === 'success' && (
          <div className="flex items-center gap-1 px-2 py-1 bg-fuchsia-50 dark:bg-fuchsia-950/30 rounded">
            <CheckCircle2 className="w-3 h-3 text-fuchsia-500" />
            <span className="text-[9px] font-semibold text-fuchsia-700 dark:text-fuchsia-300">
              Matched: {branchTaken}
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

        {/* Output handle labels */}
        <div className="flex justify-between mt-1 text-[8px] font-medium text-fuchsia-500/60 dark:text-fuchsia-400/40">
          {handleLabels.map((label) => (
            <span
              key={label}
              className={label === 'Default' ? 'text-gray-400 dark:text-gray-600' : ''}
            >
              {label}
            </span>
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
