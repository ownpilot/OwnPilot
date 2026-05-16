import { useState } from 'react';
import type { ClawHistoryEntry } from '../../../api/endpoints/claws';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { CheckCircle2, XCircle } from '../../../components/icons';
import { formatDuration, formatCost, timeAgo } from '../utils';

export function HistoryTab({
  history,
  historyTotal,
  isLoadingHistory,
  loadHistory,
}: {
  history: ClawHistoryEntry[];
  historyTotal: number;
  isLoadingHistory: boolean;
  loadHistory: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');

  const filtered =
    filter === 'all'
      ? history
      : history.filter((e) => (filter === 'success' ? e.success : !e.success));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          {historyTotal} total cycles
        </p>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
          <button onClick={loadHistory} className="text-xs text-primary hover:underline">
            Refresh
          </button>
        </div>
      </div>

      {isLoadingHistory ? (
        <LoadingSpinner message="Loading..." />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No cycles yet.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border"
            >
              <div className="flex items-center gap-2 mb-1">
                {entry.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
                <span className="text-xs font-mono font-medium text-text-primary">
                  Cycle {entry.cycleNumber}
                </span>
                <span className="text-xs text-text-muted">{formatDuration(entry.durationMs)}</span>
                {entry.costUsd !== undefined && (
                  <span className="text-xs text-green-500">{formatCost(entry.costUsd)}</span>
                )}
                <span className="text-xs text-text-muted">{entry.toolCalls.length} tools</span>
                {entry.entryType === 'escalation' && (
                  <span className="text-[10px] bg-purple-500/10 text-purple-600 px-1.5 py-0.5 rounded">
                    escalation
                  </span>
                )}
                <div className="flex-1" />
                <span className="text-xs text-text-muted">{timeAgo(entry.executedAt)}</span>
              </div>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary line-clamp-2 font-mono mt-1">
                {entry.error ?? entry.outputMessage.slice(0, 200)}
              </p>
              {entry.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {entry.toolCalls.slice(0, 8).map((tc, i) => (
                    <span
                      key={i}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${tc.success ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}
                    >
                      {tc.tool}
                    </span>
                  ))}
                  {entry.toolCalls.length > 8 && (
                    <span className="text-[10px] text-text-muted">
                      +{entry.toolCalls.length - 8} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
