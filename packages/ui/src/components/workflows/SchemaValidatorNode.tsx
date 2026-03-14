/**
 * SchemaValidatorNode — Validates data against a JSON schema in workflows.
 * Orange color theme.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Shield, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface SchemaValidatorNodeData extends Record<string, unknown> {
  label: string;
  /** JSON schema definition */
  schema?: string;
  /** Whether strict mode is enabled (no additional properties allowed) */
  strict?: boolean;
  /** Number of required fields in the schema */
  requiredFields?: number;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  outputAlias?: string;
}

export type SchemaValidatorNodeType = Node<SchemaValidatorNodeData>;

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

function SchemaValidatorNodeComponent({ data, selected }: NodeProps<SchemaValidatorNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];

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
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
            <Shield className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
          </div>
          <span className="font-medium text-sm text-orange-900 dark:text-orange-100 truncate flex-1">
            {(data.label as string) || 'Schema Validator'}
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

        <div className="flex items-center gap-1.5 mt-1">
          {data.strict && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-orange-500/20 text-orange-700 dark:text-orange-300 uppercase">
              strict
            </span>
          )}
          {data.requiredFields != null && (data.requiredFields as number) > 0 && (
            <span className="text-[10px] text-orange-600/70 dark:text-orange-400/50">
              {data.requiredFields as number} required field{(data.requiredFields as number) !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {status === 'error' && data.executionError && (
          <p className="text-xs text-error mt-1 truncate" title={data.executionError as string}>
            {data.executionError as string}
          </p>
        )}

        {data.executionDuration != null && (
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted mt-1">
            {(data.executionDuration as number) < 1000
              ? `${data.executionDuration}ms`
              : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-orange-950"
      />
    </div>
  );
}

export const SchemaValidatorNode = memo(SchemaValidatorNodeComponent);
