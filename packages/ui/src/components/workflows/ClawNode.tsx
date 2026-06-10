/**
 * ClawNode — spawns an ephemeral autonomous Claw agent as a workflow step.
 * Orange-themed card with bot icon, mission preview, and mode/sandbox badges.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Bot, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface ClawNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  /** Claw display name (supports {{templates}}) */
  name?: string;
  /** Mission statement (supports {{templates}}) */
  mission?: string;
  mode?: 'single-shot' | 'continuous' | 'interval' | 'event';
  sandbox?: 'auto' | 'docker' | 'local';
  /** Wait for the claw to finish before continuing (default: true for single-shot) */
  waitForCompletion?: boolean;
  /** Max wait time in ms (default: 600000 = 10 min) */
  timeoutMs?: number;
  provider?: string;
  model?: string;
  codingAgentProvider?: string;
  skills?: string[];
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type ClawNodeType = Node<ClawNodeData>;

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

function ClawNodeComponent({ data, selected }: NodeProps<ClawNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const mission = (data.mission as string) ?? '';
  const mode = (data.mode as string) ?? 'single-shot';
  const sandbox = (data.sandbox as string) ?? 'auto';

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border shadow-sm overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-orange-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />

      {/* Gradient header */}
      <div className="px-3 py-2 bg-gradient-to-r from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate block">
              {(data.label as string) || (data.name as string) || 'Claw Agent'}
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wide bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
                {mode}
              </span>
              <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                {sandbox}
              </span>
            </div>
          </div>
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

      {/* Mission preview */}
      {mission && (
        <div className="px-3 py-2">
          <p className="text-[10px] text-gray-600 dark:text-gray-400 line-clamp-2" title={mission}>
            {mission}
          </p>
        </div>
      )}

      {/* Error message */}
      {status === 'error' && data.executionError && (
        <div className="px-3 pb-2">
          <p className="text-xs text-error truncate" title={data.executionError as string}>
            {data.executionError as string}
          </p>
        </div>
      )}

      {/* Duration */}
      {data.executionDuration != null && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            {(data.executionDuration as number) < 1000
              ? `${data.executionDuration}ms`
              : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
          </p>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />
    </div>
  );
}

export const ClawNode = memo(ClawNodeComponent);
