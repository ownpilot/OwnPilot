/**
 * LlmNode — ReactFlow node for LLM calls within a workflow.
 * Most prominent node type with gradient header, model chips,
 * temperature meter, and prompt previews.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Brain, CheckCircle2, XCircle, Activity, AlertCircle, Sparkles } from '../icons';
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
  /** Response format: 'text' (default) or 'json' (auto-parsed) */
  responseFormat?: 'text' | 'json';
  /** Multi-turn context messages before the main userMessage */
  conversationMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
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
  const temperature = data.temperature as number | undefined;
  const systemPrompt = (data.systemPrompt as string) ?? '';
  const userMessage = (data.userMessage as string) ?? '';
  const provider = (data.provider as string) ?? '';
  const model = (data.model as string) ?? '';

  // Temperature meter: map 0-2 range to percentage
  const tempPercent = temperature != null ? Math.min((temperature / 2) * 100, 100) : null;
  const tempColor =
    temperature != null
      ? temperature < 0.4
        ? 'bg-blue-400'
        : temperature < 0.8
          ? 'bg-indigo-500'
          : temperature < 1.2
            ? 'bg-amber-500'
            : 'bg-red-500'
      : '';

  return (
    <div
      className={`
        relative min-w-[220px] max-w-[300px] rounded-lg border-2 shadow-md overflow-hidden
        bg-white dark:bg-gray-900
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

      {/* Gradient Header Bar */}
      <div className="bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Brain className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-white truncate flex-1">
          {(data.label as string) || 'LLM'}
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
        {/* Provider + Model Chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {provider && provider !== 'default' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
              <Sparkles className="w-2.5 h-2.5" />
              {provider}
            </span>
          )}
          {model && model !== 'default' && (
            <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300 truncate max-w-[160px]">
              {model}
            </span>
          )}
          {(!provider || provider === 'default') && (!model || model === 'default') && (
            <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              Auto (default)
            </span>
          )}
        </div>

        {/* Temperature Mini Meter */}
        {tempPercent != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-indigo-500/70 dark:text-indigo-400/60 w-8 shrink-0">
              Temp
            </span>
            <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${tempColor}`}
                style={{ width: `${tempPercent}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-indigo-600 dark:text-indigo-400 w-6 text-right">
              {temperature!.toFixed(1)}
            </span>
          </div>
        )}

        {/* JSON badge */}
        {data.responseFormat === 'json' && (
          <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-500 text-white uppercase tracking-wider">
            JSON
          </span>
        )}

        {/* System prompt preview */}
        {systemPrompt && (
          <p
            className="text-[10px] text-gray-400 dark:text-gray-500 italic truncate"
            title={systemPrompt}
          >
            {systemPrompt.slice(0, 60)}
            {systemPrompt.length > 60 ? '...' : ''}
          </p>
        )}

        {/* User message preview */}
        {userMessage && (
          <p className="text-[10px] text-gray-600 dark:text-gray-400 truncate" title={userMessage}>
            {userMessage.slice(0, 60)}
            {userMessage.length > 60 ? '...' : ''}
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
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-indigo-950"
      />
    </div>
  );
}

export const LlmNode = memo(LlmNodeComponent);
