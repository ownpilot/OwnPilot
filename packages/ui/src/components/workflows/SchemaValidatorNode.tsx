/**
 * SchemaValidatorNode — Validates data against a JSON schema in workflows.
 * Validation/check visual with orange gradient header, strict mode badge,
 * required fields count, schema preview, and check/X visual.
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

/** Try to extract first 3 property names from a JSON schema string */
function extractSchemaProperties(schema: string): string[] {
  try {
    const parsed = JSON.parse(schema);
    if (parsed.properties) {
      return Object.keys(parsed.properties).slice(0, 3);
    }
  } catch {
    // not valid JSON
  }
  return [];
}

function SchemaValidatorNodeComponent({ data, selected }: NodeProps<SchemaValidatorNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const isStrict = data.strict as boolean | undefined;
  const requiredCount = (data.requiredFields as number) ?? 0;
  const schema = (data.schema as string) ?? '';
  const properties = extractSchemaProperties(schema);

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-md overflow-hidden
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

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Shield className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'Schema Validator'}
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
        {/* Badge row: strict + required */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isStrict && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 uppercase tracking-wider">
              Strict
            </span>
          )}
          {requiredCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
              {requiredCount} required
            </span>
          )}
        </div>

        {/* Schema property preview */}
        {properties.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5 space-y-0.5">
            {properties.map((prop) => (
              <div key={prop} className="flex items-center gap-1.5 text-[9px]">
                <span className="text-orange-400">{'{'}</span>
                <span className="font-mono text-orange-700 dark:text-orange-300">{prop}</span>
                <span className="text-orange-400">{'}'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Validation pass/fail visual */}
        {status === 'success' && (
          <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30 rounded">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
              Validation passed
            </span>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-950/30 rounded">
            <XCircle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[9px] font-semibold text-red-700 dark:text-red-300">
              Validation failed
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

export const SchemaValidatorNode = memo(SchemaValidatorNodeComponent);
