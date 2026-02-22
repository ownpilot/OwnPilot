/**
 * LlmNode — ReactFlow node for LLM calls within a workflow.
 * Takes upstream data as context, calls an AI provider, outputs the response.
 * Distinct blue/indigo style to differentiate from tool (neutral) and trigger (violet) nodes.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Brain, CheckCircle2, XCircle, Activity, AlertCircle, AlertTriangle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface LlmNodeData extends Record<string, unknown> {
  /** Display label */
  label: string;
  /** AI provider id: 'openai', 'anthropic', 'google', etc. */
  provider: string;
  /** Model name, e.g. 'gpt-4o', 'claude-sonnet-4-5-20250514' */
  model: string;
  /** System prompt / instruction */
  systemPrompt?: string;
  /** User message template (supports {{nodeId.output}} expressions) */
  userMessage: string;
  /** Sampling temperature */
  temperature?: number;
  /** Max output tokens */
  maxTokens?: number;
  /** Optional custom API key (overrides stored key) */
  apiKey?: string;
  /** Optional custom base URL (for self-hosted / proxy) */
  baseUrl?: string;
  /** Runtime execution state */
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
}

export type LlmNodeType = Node<LlmNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-indigo-300 dark:border-indigo-700', bg: '' },
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

function LlmNodeComponent({ data, selected }: NodeProps<LlmNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[260px] rounded-lg border-2 shadow-sm
        bg-indigo-50 dark:bg-indigo-950/30
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-indigo-950"
      />

      {/* Content */}
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
            <Brain className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <span className="font-medium text-sm text-indigo-900 dark:text-indigo-100 truncate flex-1">
            {(data.label as string) || 'LLM'}
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

        {/* Provider + model summary */}
        <div className="flex items-center gap-1 mt-1">
          {!(data.provider as string) && (
            <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
          )}
          <p className="text-xs text-indigo-600 dark:text-indigo-400 truncate">
            {(data.provider as string) || 'No provider'}
            {data.model ? ` / ${data.model}` : ''}
          </p>
        </div>

        {/* System prompt preview */}
        {data.systemPrompt && (
          <p className="text-[10px] text-indigo-500/70 dark:text-indigo-400/50 mt-0.5 truncate">
            {data.systemPrompt as string}
          </p>
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
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-indigo-950"
      />
    </div>
  );
}

export const LlmNode = memo(LlmNodeComponent);
