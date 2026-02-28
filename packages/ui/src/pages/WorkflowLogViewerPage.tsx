/**
 * Workflow Log Viewer — detailed view of a single execution log.
 * Shows a timeline of node results with resolved args, outputs, errors.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { workflowsApi } from '../api';
import type { WorkflowLog, NodeResult } from '../api';
import { JsonTreeView, ExecutionTimeline } from '../components/workflows';
import {
  ChevronLeft,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Filter,
  BarChart,
  Play,
  RefreshCw,
} from '../components/icons';
import { LoadingSpinner } from '../components/LoadingSpinner';

const statusColors: Record<string, string> = {
  running: 'bg-warning/10 text-warning border-warning/20',
  success: 'bg-success/10 text-success border-success/20',
  error: 'bg-error/10 text-error border-error/20',
  skipped: 'bg-text-muted/10 text-text-muted border-text-muted/20',
  pending: 'bg-text-muted/10 text-text-muted border-text-muted/20',
};

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Activity,
  success: CheckCircle2,
  error: XCircle,
  skipped: AlertCircle,
  pending: Clock,
};

const logStatusColors: Record<string, string> = {
  running: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  cancelled: 'bg-text-muted/10 text-text-muted',
};

function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function WorkflowLogViewerPage() {
  const { logId } = useParams<{ logId: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<WorkflowLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [filterErrors, setFilterErrors] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [isReplaying, setIsReplaying] = useState(false);

  useEffect(() => {
    if (!logId) return;
    (async () => {
      try {
        const data = await workflowsApi.logDetail(logId);
        setLog(data);
      } catch {
        navigate('/workflows');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [logId, navigate]);

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!log) return;
    setExpandedNodes(new Set(Object.keys(log.nodeResults)));
  }, [log]);

  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  // Sort node results by startedAt time
  const sortedResults = useMemo(() => {
    if (!log) return [];
    return Object.entries(log.nodeResults)
      .map(([nodeId, result]) => ({ ...result, nodeId }))
      .sort((a, b) => {
        if (!a.startedAt && !b.startedAt) return 0;
        if (!a.startedAt) return 1;
        if (!b.startedAt) return -1;
        return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      });
  }, [log]);

  const filteredResults = useMemo(
    () => (filterErrors ? sortedResults.filter((r) => r.status === 'error') : sortedResults),
    [sortedResults, filterErrors]
  );

  const errorCount = useMemo(
    () => sortedResults.filter((r) => r.status === 'error').length,
    [sortedResults]
  );

  // Build minimal node list for ExecutionTimeline
  const timelineNodes = useMemo(
    () =>
      sortedResults.map((r) => ({
        id: r.nodeId,
        type: 'tool',
        data: { label: r.nodeId } as Record<string, unknown>,
      })),
    [sortedResults]
  );

  const handleReplay = useCallback(async () => {
    if (!logId || isReplaying) return;
    setIsReplaying(true);
    try {
      const response = await workflowsApi.replayLog(logId);
      // Read the SSE stream to get the new log ID
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let newLogId: string | null = null;
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.type === 'done' && evt.logId) newLogId = evt.logId;
              } catch {
                /* skip non-JSON lines */
              }
            }
          }
        }
      }
      if (newLogId) {
        navigate(`/workflows/logs/${newLogId}`);
      }
    } catch {
      /* replay failed silently — button resets */
    } finally {
      setIsReplaying(false);
    }
  }, [logId, isReplaying, navigate]);

  if (isLoading) {
    return <LoadingSpinner message="Loading execution log..." />;
  }

  if (!log) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <button
          onClick={() => navigate('/workflows')}
          className="p-1.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
          title="Back to Workflows"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
            {log.workflowName ?? 'Deleted Workflow'} — Execution Log
          </h2>
          <div className="flex items-center gap-3 mt-0.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${logStatusColors[log.status]}`}
            >
              {log.status}
            </span>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {formatDuration(log.durationMs)}
            </span>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {new Date(log.startedAt).toLocaleString()}
            </span>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {sortedResults.length} node{sortedResults.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {log.workflowId && (
            <button
              onClick={handleReplay}
              disabled={isReplaying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 rounded-md transition-colors disabled:opacity-50"
              title="Re-run this execution"
            >
              {isReplaying ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Re-run
            </button>
          )}
          {log.workflowId && (
            <button
              onClick={() => navigate(`/workflows/${log.workflowId}`)}
              className="px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
            >
              Open Editor
            </button>
          )}
        </div>
      </header>

      {/* Global error */}
      {log.error && (
        <div className="mx-6 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg text-sm text-error">
          {log.error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border dark:border-dark-border">
        <button
          onClick={expandAll}
          className="px-2.5 py-1 text-xs text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="px-2.5 py-1 text-xs text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          Collapse All
        </button>
        <div className="flex-1" />
        <div className="flex items-center bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md border border-border dark:border-dark-border overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={`px-2.5 py-1 text-xs transition-colors ${
              viewMode === 'list'
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
              viewMode === 'timeline'
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary'
            }`}
          >
            <BarChart className="w-3 h-3" />
            Timeline
          </button>
        </div>
        {errorCount > 0 && (
          <button
            onClick={() => setFilterErrors(!filterErrors)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${
              filterErrors
                ? 'bg-error/10 text-error'
                : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            <Filter className="w-3 h-3" />
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Node Results */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {viewMode === 'timeline' ? (
          <ExecutionTimeline nodeResults={log.nodeResults} nodes={timelineNodes} />
        ) : (
          <div className="space-y-2">
            {filteredResults.map((result) => (
              <NodeResultCard
                key={result.nodeId}
                result={result}
                expanded={expandedNodes.has(result.nodeId)}
                onToggle={() => toggleNode(result.nodeId)}
              />
            ))}

            {filteredResults.length === 0 && (
              <p className="text-center text-sm text-text-muted dark:text-dark-text-muted py-8">
                {filterErrors ? 'No errors found.' : 'No node results recorded.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Node Result Card
// ============================================================================

function NodeResultCard({
  result,
  expanded,
  onToggle,
}: {
  result: NodeResult & { nodeId: string };
  expanded: boolean;
  onToggle: () => void;
}) {
  const StatusIcon = statusIcons[result.status] || Clock;
  const colorCls = statusColors[result.status] || statusColors.pending;

  return (
    <div className={`border rounded-lg overflow-hidden ${colorCls}`}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        <StatusIcon className="w-4 h-4 shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{result.nodeId}</span>
        {result.retryAttempts != null && result.retryAttempts > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] bg-warning/10 text-warning rounded-full">
            {result.retryAttempts} {result.retryAttempts === 1 ? 'retry' : 'retries'}
          </span>
        )}
        <span className="text-xs opacity-70">{formatDuration(result.durationMs)}</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-current/10">
          {/* Timestamps */}
          {(result.startedAt || result.completedAt) && (
            <div className="flex gap-4 pt-2 text-[10px] opacity-70">
              {result.startedAt && (
                <span>Started: {new Date(result.startedAt).toLocaleTimeString()}</span>
              )}
              {result.completedAt && (
                <span>Completed: {new Date(result.completedAt).toLocaleTimeString()}</span>
              )}
            </div>
          )}

          {/* Error */}
          {result.error && (
            <div className="mt-2">
              <div className="text-[10px] font-medium uppercase tracking-wider opacity-70 mb-1">
                Error
              </div>
              <pre className="text-xs p-2 bg-black/5 dark:bg-white/5 rounded overflow-x-auto whitespace-pre-wrap">
                {result.error}
              </pre>
            </div>
          )}

          {/* Resolved Args */}
          {result.resolvedArgs && Object.keys(result.resolvedArgs).length > 0 && (
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider opacity-70 mb-1">
                Resolved Arguments
              </div>
              <div className="text-xs p-2 bg-black/5 dark:bg-white/5 rounded overflow-x-auto">
                <JsonTreeView data={result.resolvedArgs} maxDepth={3} />
              </div>
            </div>
          )}

          {/* Output */}
          {result.output !== undefined && (
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider opacity-70 mb-1">
                Output
              </div>
              <div className="text-xs p-2 bg-black/5 dark:bg-white/5 rounded overflow-x-auto max-h-64 overflow-y-auto">
                {typeof result.output === 'string' ? (
                  <pre className="whitespace-pre-wrap">{result.output}</pre>
                ) : (
                  <JsonTreeView data={result.output} maxDepth={3} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
