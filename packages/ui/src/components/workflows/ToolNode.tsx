/**
 * ToolNode — ReactFlow node for tool execution in workflows.
 * Clean utility look with colored left border strip, monospace tool name,
 * and args count badge.
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Activity,
  Server,
  Sparkles,
  Puzzle,
  Zap,
  BookOpen,
} from '../icons';
import type { NodeExecutionStatus } from '../../api/types';

// ============================================================================
// Tool source detection & visual config
// ============================================================================

type ToolSource = 'core' | 'mcp' | 'custom' | 'plugin' | 'ext' | 'skill';

function detectToolSource(name: string): ToolSource {
  if (name.startsWith('mcp.')) return 'mcp';
  if (name.startsWith('custom.')) return 'custom';
  if (name.startsWith('plugin.')) return 'plugin';
  if (name.startsWith('ext.')) return 'ext';
  if (name.startsWith('skill.')) return 'skill';
  return 'core';
}

const SOURCE_CONFIG: Record<
  ToolSource,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    strip: string;
    badge: string;
    accent: string;
    ring: string;
    iconColor: string;
    nameColor: string;
  }
> = {
  core: {
    label: 'Core',
    icon: Wrench,
    strip: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    accent: 'border-blue-300 dark:border-blue-700',
    ring: 'ring-blue-500',
    iconColor: 'text-blue-500',
    nameColor: 'text-blue-600 dark:text-blue-400',
  },
  mcp: {
    label: 'MCP',
    icon: Server,
    strip: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    accent: 'border-emerald-300 dark:border-emerald-700',
    ring: 'ring-emerald-500',
    iconColor: 'text-emerald-500',
    nameColor: 'text-emerald-600 dark:text-emerald-400',
  },
  custom: {
    label: 'Custom',
    icon: Sparkles,
    strip: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    accent: 'border-amber-300 dark:border-amber-700',
    ring: 'ring-amber-500',
    iconColor: 'text-amber-500',
    nameColor: 'text-amber-600 dark:text-amber-400',
  },
  plugin: {
    label: 'Plugin',
    icon: Puzzle,
    strip: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    accent: 'border-purple-300 dark:border-purple-700',
    ring: 'ring-purple-500',
    iconColor: 'text-purple-500',
    nameColor: 'text-purple-600 dark:text-purple-400',
  },
  ext: {
    label: 'Extension',
    icon: Zap,
    strip: 'bg-teal-500',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    accent: 'border-teal-300 dark:border-teal-700',
    ring: 'ring-teal-500',
    iconColor: 'text-teal-500',
    nameColor: 'text-teal-600 dark:text-teal-400',
  },
  skill: {
    label: 'Skill',
    icon: BookOpen,
    strip: 'bg-rose-500',
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    accent: 'border-rose-300 dark:border-rose-700',
    ring: 'ring-rose-500',
    iconColor: 'text-rose-500',
    nameColor: 'text-rose-600 dark:text-rose-400',
  },
};

// Extended data type with runtime execution state.
// Index signature required by ReactFlow's Node<Record<string, unknown>> constraint.
export interface ToolNodeData extends Record<string, unknown> {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionDuration?: number;
  executionOutput?: unknown;
  resolvedArgs?: Record<string, unknown>;
}

/** ReactFlow Node typed with ToolNodeData */
export type ToolNodeType = Node<ToolNodeData>;

const statusStyles: Record<NodeExecutionStatus, { border: string; bg: string }> = {
  pending: { border: 'border-border dark:border-dark-border', bg: '' },
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

function ToolNodeComponent({ data, selected }: NodeProps<ToolNodeType>) {
  const status = (data.executionStatus as NodeExecutionStatus | undefined) ?? 'pending';
  const style = statusStyles[status];
  const StatusIcon = statusIcons[status];
  const toolName = (data.toolName as string) ?? '';
  const toolArgs = data.toolArgs as Record<string, unknown> | undefined;
  const argsCount = toolArgs ? Object.keys(toolArgs).length : 0;

  // Detect tool source and get visual config
  const source = detectToolSource(toolName);
  const cfg = SOURCE_CONFIG[source];
  const SourceIcon = cfg.icon;

  // Split tool name into namespace prefix and base name
  const dotIndex = toolName.lastIndexOf('.');
  const namespace = dotIndex > 0 ? toolName.slice(0, dotIndex + 1) : '';
  const baseName = dotIndex > 0 ? toolName.slice(dotIndex + 1) : toolName;

  // Extract middle namespace for MCP/plugin (e.g. mcp.github.list → "github")
  const parts = toolName.split('.');
  const serverName = parts.length >= 3 ? parts[1] : undefined;

  return (
    <div
      className={`
        relative min-w-[170px] max-w-[280px] rounded-lg border shadow-sm overflow-hidden
        bg-white dark:bg-gray-900
        ${status !== 'pending' ? style.border : cfg.accent} ${style.bg}
        ${selected ? `ring-2 ${cfg.ring} ring-offset-1` : ''}
        ${status === 'running' ? 'animate-pulse' : ''}
        transition-all duration-200
      `}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className={`!w-3 !h-3 !border-2 !border-white dark:!border-gray-900 ${cfg.strip.replace('bg-', '!bg-')}`}
      />

      {/* Source-colored left accent strip */}
      <div className="flex">
        <div className={`w-1.5 shrink-0 ${cfg.strip}`} />

        {/* Content */}
        <div className="px-3 py-2 flex-1 min-w-0">
          {/* Header: source icon + label + status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${cfg.strip}/20`}
            >
              <SourceIcon className={`w-3 h-3 ${cfg.iconColor}`} />
            </div>
            <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate flex-1">
              {(data.label as string) || baseName}
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

          {/* Source badge + server/plugin name */}
          <div className="flex items-center gap-1 mt-1.5">
            <span
              className={`inline-block px-1.5 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider ${cfg.badge}`}
            >
              {cfg.label}
            </span>
            {serverName && (
              <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 truncate max-w-[120px]">
                {serverName}
              </span>
            )}
          </div>

          {/* Tool name in monospace with dimmed namespace */}
          {toolName && (
            <p className="text-[10px] font-mono mt-1 truncate" title={toolName}>
              <span className="text-gray-400 dark:text-gray-600">{namespace}</span>
              <span className={cfg.nameColor}>{baseName}</span>
            </p>
          )}

          {/* Args count badge + description row */}
          <div className="flex items-center gap-1.5 mt-1">
            {argsCount > 0 && (
              <span
                className={`inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded ${cfg.badge}`}
              >
                {argsCount} arg{argsCount > 1 ? 's' : ''}
              </span>
            )}
            {data.description && (
              <p className="text-[10px] text-text-secondary dark:text-dark-text-secondary truncate flex-1">
                {data.description as string}
              </p>
            )}
          </div>

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
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={`!w-3 !h-3 !border-2 !border-white dark:!border-gray-900 ${cfg.strip.replace('bg-', '!bg-')}`}
      />
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
