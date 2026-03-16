/**
 * CodeNode — ReactFlow node for inline code execution in workflows.
 * Developer-focused design with dark terminal-like header,
 * language badge, and code preview in monospace.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Terminal, CheckCircle2, XCircle, Activity, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

export interface CodeNodeData extends Record<string, unknown> {
  label: string;
  language: 'javascript' | 'python' | 'shell';
  /** The script source code */
  code: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
}

export type CodeNodeType = Node<CodeNodeData>;

const languageConfig: Record<string, { label: string; color: string; bg: string }> = {
  javascript: { label: 'JS', color: 'text-amber-300', bg: 'bg-amber-500/20' },
  python: { label: 'PY', color: 'text-blue-300', bg: 'bg-blue-500/20' },
  shell: { label: 'SH', color: 'text-emerald-300', bg: 'bg-emerald-500/20' },
};

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-teal-300 dark:border-teal-700', bg: '' },
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

function CodeNodeComponent({ data, selected }: NodeProps<CodeNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const lang = (data.language as string) ?? 'javascript';
  const langConf = languageConfig[lang] ?? {
    label: lang.toUpperCase(),
    color: 'text-gray-300',
    bg: 'bg-gray-500/20',
  };
  const code = (data.code as string) ?? '';

  // First 2 non-empty lines of code for preview
  const codeLines = code
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 2);

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[280px] rounded-lg border-2 shadow-sm overflow-hidden
        bg-white dark:bg-gray-900
        ${style.border} ${style.bg}
        ${selected ? 'ring-2 ring-teal-500 ring-offset-1' : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-teal-950"
      />

      {/* Dark terminal-like header */}
      <div className="bg-gray-900 dark:bg-gray-950 px-3 py-2 flex items-center gap-2">
        {/* Terminal window dots */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
        </div>
        <Terminal className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="font-medium text-sm text-gray-200 truncate flex-1">
          {(data.label as string) || 'Code'}
        </span>
        {/* Language badge */}
        <span
          className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${langConf.bg} ${langConf.color}`}
        >
          {langConf.label}
        </span>
        {StatusIcon && (
          <StatusIcon
            className={`w-4 h-4 shrink-0 ${
              status === 'success'
                ? 'text-emerald-400'
                : status === 'error'
                  ? 'text-red-400'
                  : status === 'running'
                    ? 'text-amber-400'
                    : 'text-gray-500'
            }`}
          />
        )}
      </div>

      {/* Code preview in terminal style */}
      {codeLines.length > 0 && (
        <div className="bg-gray-850 dark:bg-gray-900 border-t border-gray-800 px-3 py-1.5">
          {codeLines.map((line, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[9px] text-gray-600 font-mono select-none w-3 text-right shrink-0">
                {i + 1}
              </span>
              <p className="text-[10px] text-teal-300 dark:text-teal-400 font-mono truncate flex-1">
                {line}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Footer area */}
      <div className="px-3 py-1.5">
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
        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-teal-950"
      />
    </div>
  );
}

export const CodeNode = memo(CodeNodeComponent);
