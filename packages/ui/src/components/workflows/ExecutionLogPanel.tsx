/**
 * ExecutionLogPanel — live execution log shown in the workflow editor
 * during and after workflow runs. Displays per-node events with status,
 * timing, output, and errors.
 */

import { useEffect, useRef, useState } from 'react';
import type { WorkflowProgressEvent } from '../../api/types/workflows';

/** Entry in the execution log — enriched from SSE progress events */
export interface ExecutionLogEntry {
  id: number;
  timestamp: Date;
  type: WorkflowProgressEvent['type'];
  nodeId?: string;
  nodeLabel?: string;
  toolName?: string;
  status?: string;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: string;
}
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Terminal,
  X,
  Maximize2,
  Minimize2,
} from '../icons';

// ============================================================================
// Types
// ============================================================================

interface ExecutionLogPanelProps {
  entries: ExecutionLogEntry[];
  isExecuting: boolean;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const statusConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  success: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
  error: { icon: XCircle, color: 'text-error', bg: 'bg-error/10' },
  running: { icon: Activity, color: 'text-warning', bg: 'bg-warning/10' },
  pending: { icon: Clock, color: 'text-text-muted dark:text-dark-text-muted', bg: 'bg-text-muted/10' },
  skipped: { icon: AlertCircle, color: 'text-text-muted dark:text-dark-text-muted', bg: 'bg-text-muted/10' },
};

const eventLabels: Record<string, string> = {
  started: 'Workflow started',
  node_start: 'Node started',
  node_complete: 'Node completed',
  node_error: 'Node error',
  node_retry: 'Retrying node',
  done: 'Workflow finished',
  error: 'Workflow error',
  foreach_iteration_start: 'ForEach iteration started',
  foreach_iteration_complete: 'ForEach iteration completed',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

// ============================================================================
// Component
// ============================================================================

export function ExecutionLogPanel({ entries, isExecuting, onClose }: ExecutionLogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [isMaximized, setIsMaximized] = useState(false);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const toggleEntry = (id: number) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Summary stats
  const nodeCompletes = entries.filter((e) => e.type === 'node_complete');
  const successCount = nodeCompletes.filter((e) => e.status === 'success').length;
  const errorCount = entries.filter((e) => e.type === 'node_error').length;
  const skippedCount = nodeCompletes.filter((e) => e.status === 'skipped').length;
  const doneEntry = entries.find((e) => e.type === 'done');

  return (
    <div
      className={`flex flex-col border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${
        isMaximized ? 'absolute inset-0 z-50' : ''
      }`}
      style={isMaximized ? undefined : { height: '280px', minHeight: '120px' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary shrink-0">
        <Terminal className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-text-primary dark:text-dark-text-primary">
          Execution Log
        </span>

        {isExecuting && (
          <span className="flex items-center gap-1.5 text-xs text-warning">
            <Activity className="w-3 h-3 animate-pulse" />
            Running...
          </span>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 ml-2 text-[10px]">
          {successCount > 0 && (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="w-3 h-3" />
              {successCount}
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-error">
              <XCircle className="w-3 h-3" />
              {errorCount}
            </span>
          )}
          {skippedCount > 0 && (
            <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
              <AlertCircle className="w-3 h-3" />
              {skippedCount} skipped
            </span>
          )}
          {doneEntry?.durationMs != null && (
            <span className="text-text-muted dark:text-dark-text-muted">
              Total: {formatDuration(doneEntry.durationMs)}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setIsMaximized(!isMaximized)}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
          title={isMaximized ? 'Minimize' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
          title="Close log panel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-xs"
      >
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
            Waiting for execution events...
          </div>
        ) : (
          entries.map((entry) => (
            <LogEntryRow
              key={entry.id}
              entry={entry}
              expanded={expandedEntries.has(entry.id)}
              onToggle={() => toggleEntry(entry.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Log Entry Row
// ============================================================================

function LogEntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ExecutionLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails =
    entry.output !== undefined || entry.error || (entry.resolvedArgs && Object.keys(entry.resolvedArgs).length > 0);

  const isNodeEvent = entry.type.startsWith('node_') || entry.type.startsWith('foreach_');
  const statusKey = entry.type === 'node_error' ? 'error' : entry.type === 'node_start' ? 'running' : (entry.status ?? 'pending');
  const defaultConfig = { icon: Clock, color: 'text-text-muted dark:text-dark-text-muted', bg: 'bg-text-muted/10' };
  const config = statusConfig[statusKey] ?? defaultConfig;
  const StatusIcon = config.icon;

  // Event-level styling
  const isWorkflowEvent = entry.type === 'started' || entry.type === 'done' || entry.type === 'error';
  const rowBg = entry.type === 'node_error' || entry.type === 'error'
    ? 'bg-error/5'
    : entry.type === 'done'
      ? 'bg-success/5'
      : '';

  return (
    <div className={`border-b border-border/50 dark:border-dark-border/50 ${rowBg}`}>
      <div
        className={`flex items-center gap-2 px-4 py-1.5 ${hasDetails ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5' : ''} transition-colors`}
        onClick={hasDetails ? onToggle : undefined}
      >
        {/* Timestamp */}
        <span className="text-text-muted dark:text-dark-text-muted w-[65px] shrink-0">
          {formatTime(entry.timestamp)}
        </span>

        {/* Status icon */}
        <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${config.color}`} />

        {/* Event description */}
        <span className={`flex-1 min-w-0 ${isWorkflowEvent ? 'font-semibold' : ''} text-text-primary dark:text-dark-text-primary`}>
          {isNodeEvent && entry.nodeLabel ? (
            <>
              <span className={config.color}>{eventLabels[entry.type] ?? entry.type}</span>
              <span className="mx-1.5 text-text-muted dark:text-dark-text-muted">&mdash;</span>
              <span className="font-medium">{entry.nodeLabel}</span>
              {entry.toolName && (
                <span className="ml-1.5 text-text-muted dark:text-dark-text-muted">
                  ({entry.toolName})
                </span>
              )}
            </>
          ) : (
            <span className={isWorkflowEvent ? config.color : ''}>
              {eventLabels[entry.type] ?? entry.type}
              {entry.logStatus && entry.type === 'done' && (
                <span className="ml-1.5">({entry.logStatus})</span>
              )}
            </span>
          )}
        </span>

        {/* Duration */}
        {entry.durationMs != null && (
          <span className="text-text-muted dark:text-dark-text-muted shrink-0">
            {formatDuration(entry.durationMs)}
          </span>
        )}

        {/* Status badge */}
        {entry.status && isNodeEvent && entry.type === 'node_complete' && (
          <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${config.bg} ${config.color} shrink-0`}>
            {entry.status}
          </span>
        )}

        {/* Expand indicator */}
        {hasDetails && (
          <span className="text-text-muted dark:text-dark-text-muted shrink-0">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="px-4 pb-2 ml-[65px] pl-6 space-y-2">
          {/* Error */}
          {entry.error && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-error mb-0.5">Error</div>
              <pre className="text-xs text-error bg-error/5 rounded p-2 whitespace-pre-wrap overflow-x-auto">
                {entry.error}
              </pre>
            </div>
          )}

          {/* Resolved Args */}
          {entry.resolvedArgs && Object.keys(entry.resolvedArgs).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-dark-text-muted mb-0.5">
                Arguments
              </div>
              <pre className="text-xs bg-black/5 dark:bg-white/5 rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto text-text-secondary dark:text-dark-text-secondary">
                {JSON.stringify(entry.resolvedArgs, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {entry.output !== undefined && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-dark-text-muted mb-0.5">
                Output
              </div>
              <pre className="text-xs bg-black/5 dark:bg-white/5 rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-40 overflow-y-auto text-text-secondary dark:text-dark-text-secondary">
                {formatOutput(entry.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
