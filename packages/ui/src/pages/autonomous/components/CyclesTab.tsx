/**
 * CyclesTab — operator view of recent heartbeat cycles for a soul.
 *
 * Lists cycles from `GET /souls/:agentId/logs` with timestamp, duration,
 * cost, task and tool-call counts. Clicking a row fetches the cycle
 * detail (`GET /souls/:agentId/logs/:logId`) and shows the per-tool
 * audit trail — operators use this to debug what a soul actually did.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { soulsApi } from '../../../api/endpoints/souls';
import { useToast } from '../../../components/ToastProvider';

interface Props {
  agentId: string;
}

interface CycleSummary {
  id: string;
  timestamp: string;
  durationMs: number;
  cost: number;
  tasksRun: number;
  tasksFailed: number;
  toolCallsCount: number;
}

interface CycleDetail {
  id: string;
  agentId: string;
  soulVersion: number;
  timestamp: string;
  durationMs: number;
  cost: number;
  tokenUsage: { input: number; output: number };
  tasksRun: Array<{ id: string; name: string }>;
  tasksSkipped: Array<{ id: string; reason?: string }>;
  tasksFailed: Array<{ id: string; error?: string }>;
  toolCalls: Array<{
    taskId: string;
    tool: string;
    argsPreview?: string;
    durationMs: number;
    success: boolean;
    errorPreview?: string;
  }>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '—';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function CyclesTab({ agentId }: Props) {
  const toast = useToast();
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, CycleDetail | 'loading' | 'error'>>(
    {}
  );

  const fetchCycles = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await soulsApi.getLogs(agentId, 25, 0);
      setCycles(data.logs);
    } catch {
      setCycles([]);
      toast.error('Failed to load heartbeat cycles');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, toast]);

  useEffect(() => {
    fetchCycles();
  }, [fetchCycles]);

  const toggleRow = useCallback(
    async (logId: string) => {
      if (expandedId === logId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(logId);
      if (detailById[logId] && detailById[logId] !== 'error') return;
      setDetailById((prev) => ({ ...prev, [logId]: 'loading' }));
      try {
        const detail = await soulsApi.getLogDetail(agentId, logId);
        setDetailById((prev) => ({ ...prev, [logId]: detail }));
      } catch {
        setDetailById((prev) => ({ ...prev, [logId]: 'error' }));
      }
    },
    [agentId, detailById, expandedId]
  );

  if (isLoading) {
    return (
      <p className="text-sm text-text-muted dark:text-dark-text-muted py-8 text-center">
        Loading cycles...
      </p>
    );
  }

  if (!cycles || cycles.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          No heartbeat cycles recorded yet.
        </p>
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
          Run the soul or wait for the next scheduled heartbeat.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          {cycles.length} most recent {cycles.length === 1 ? 'cycle' : 'cycles'}. Click a row to
          inspect tool calls.
        </p>
        <button
          onClick={fetchCycles}
          className="text-xs text-primary hover:underline"
          aria-label="Refresh cycles"
        >
          Refresh
        </button>
      </div>
      <div className="border border-border dark:border-dark-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-bg-secondary dark:bg-dark-bg-secondary text-text-muted dark:text-dark-text-muted">
            <tr>
              <th className="text-left px-3 py-2">When</th>
              <th className="text-right px-3 py-2">Duration</th>
              <th className="text-right px-3 py-2">Cost</th>
              <th className="text-right px-3 py-2">Tasks</th>
              <th className="text-right px-3 py-2">Failed</th>
              <th className="text-right px-3 py-2">Tools</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => {
              const expanded = expandedId === c.id;
              const detail = detailById[c.id];
              const failed = c.tasksFailed > 0;
              return (
                <Fragment key={c.id}>
                  <tr
                    onClick={() => toggleRow(c.id)}
                    className={`border-t border-border dark:border-dark-border cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary ${
                      expanded ? 'bg-bg-secondary dark:bg-dark-bg-secondary' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-text-primary dark:text-dark-text-primary">
                      {new Date(c.timestamp).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-dark-text-primary">
                      {formatDuration(c.durationMs)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-dark-text-primary">
                      {formatCost(c.cost)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-dark-text-primary">
                      {c.tasksRun}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        failed
                          ? 'text-danger font-medium'
                          : 'text-text-muted dark:text-dark-text-muted'
                      }`}
                    >
                      {c.tasksFailed}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-dark-text-primary">
                      {c.toolCallsCount}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-3 bg-bg-primary dark:bg-dark-bg-primary border-t border-border dark:border-dark-border"
                      >
                        <CycleDetailView detail={detail} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CycleDetailView({ detail }: { detail: CycleDetail | 'loading' | 'error' | undefined }) {
  if (!detail || detail === 'loading') {
    return (
      <p className="text-xs text-text-muted dark:text-dark-text-muted">Loading cycle detail...</p>
    );
  }
  if (detail === 'error') {
    return <p className="text-xs text-danger">Failed to load cycle detail.</p>;
  }

  // Group tool calls by taskId for readability
  const calls = detail.toolCalls;
  const taskNames = new Map(detail.tasksRun.map((t) => [t.id, t.name]));
  for (const t of detail.tasksFailed) taskNames.set(t.id, t.id);
  const grouped = new Map<string, typeof calls>();
  for (const call of calls) {
    const list = grouped.get(call.taskId) ?? [];
    list.push(call);
    grouped.set(call.taskId, list);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-text-muted dark:text-dark-text-muted">
        <span>
          Soul version: <strong>{detail.soulVersion}</strong>
        </span>
        <span>
          Tokens: <strong>{detail.tokenUsage.input + detail.tokenUsage.output}</strong> (in{' '}
          {detail.tokenUsage.input} / out {detail.tokenUsage.output})
        </span>
        {detail.tasksFailed.length > 0 && (
          <span className="text-danger">
            Failures: <strong>{detail.tasksFailed.length}</strong>
          </span>
        )}
      </div>

      {detail.tasksFailed.length > 0 && (
        <div className="border border-danger/30 rounded p-2 bg-danger/5">
          <p className="text-xs font-medium text-danger mb-1">Failed tasks</p>
          <ul className="text-xs text-text-primary dark:text-dark-text-primary space-y-0.5">
            {detail.tasksFailed.map((t) => (
              <li key={t.id}>
                <span className="font-mono">{t.id}</span>
                {t.error && <span className="text-danger ml-2">— {t.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {calls.length === 0 ? (
        <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
          No tool calls recorded for this cycle.
        </p>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([taskId, taskCalls]) => (
            <div key={taskId}>
              <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                {taskNames.get(taskId) ?? taskId}{' '}
                <span className="text-text-muted dark:text-dark-text-muted font-normal">
                  ({taskCalls.length} {taskCalls.length === 1 ? 'call' : 'calls'})
                </span>
              </p>
              <ul className="space-y-1">
                {taskCalls.map((call, idx) => (
                  <li
                    key={`${call.tool}-${idx}`}
                    className={`text-xs border rounded p-2 ${
                      call.success
                        ? 'border-border dark:border-dark-border'
                        : 'border-danger/40 bg-danger/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">
                        {call.tool}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        {formatDuration(call.durationMs)}{' '}
                        {call.success ? '✓' : <span className="text-danger">✗</span>}
                      </span>
                    </div>
                    {call.argsPreview && (
                      <pre className="mt-1 font-mono text-[10px] text-text-muted dark:text-dark-text-muted whitespace-pre-wrap break-all">
                        {call.argsPreview}
                      </pre>
                    )}
                    {call.errorPreview && (
                      <pre className="mt-1 font-mono text-[10px] text-danger whitespace-pre-wrap break-all">
                        {call.errorPreview}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
