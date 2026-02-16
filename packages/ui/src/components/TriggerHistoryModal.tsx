import { useState, useCallback, useEffect } from 'react';
import type { TriggerHistoryEntry, TriggerHistoryStatus, TriggerHistoryParams } from '../api';
import { triggersApi } from '../api';
import { useModalClose } from '../hooks';
import { ChevronDown, ChevronRight, ChevronLeft } from './icons';
import { LoadingSpinner } from './LoadingSpinner';

export interface TriggerHistoryModalProps {
  triggerId: string;
  triggerName: string;
  history: TriggerHistoryEntry[];
  onClose: () => void;
}

const PAGE_SIZE = 20;

export function TriggerHistoryModal({ triggerId, triggerName, history: initialHistory, onClose }: TriggerHistoryModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [history, setHistory] = useState<TriggerHistoryEntry[]>(initialHistory);
  const [total, setTotal] = useState(initialHistory.length);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<TriggerHistoryStatus | undefined>();
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showTo = Math.min((page + 1) * PAGE_SIZE, total);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params: TriggerHistoryParams = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      const data = await triggersApi.history(triggerId, params);
      setHistory(data.history);
      setTotal(data.total);
    } catch {
      // Error handled by API client
    } finally {
      setLoading(false);
    }
  }, [triggerId, page, statusFilter]);

  // Re-fetch when page or filter changes (skip initial render)
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized) {
      fetchHistory();
    } else {
      setInitialized(true);
    }
  }, [fetchHistory, initialized]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            History: {triggerName}
          </h3>

          {/* Status filter chips */}
          <div className="flex items-center gap-2 mt-3">
            {(['success', 'failure', 'skipped'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(statusFilter === s ? undefined : s); setPage(0); }}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  statusFilter === s
                    ? s === 'success' ? 'bg-success text-white' : s === 'failure' ? 'bg-error text-white' : 'bg-text-muted text-white'
                    : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            {statusFilter && (
              <button
                onClick={() => { setStatusFilter(undefined); setPage(0); }}
                className="text-xs text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && history.length === 0 ? (
            <LoadingSpinner message="Loading history..." />
          ) : history.length === 0 ? (
            <p className="text-text-muted dark:text-dark-text-muted text-center">
              {statusFilter ? 'No entries match this filter.' : 'No history yet'}
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
                  >
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-text-muted dark:text-dark-text-muted">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </span>
                        <span className="text-sm text-text-primary dark:text-dark-text-primary">
                          {new Date(entry.firedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.durationMs != null && (
                          <span className="text-xs text-text-muted dark:text-dark-text-muted">
                            {entry.durationMs}ms
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            entry.status === 'success'
                              ? 'bg-success/10 text-success'
                              : entry.status === 'failure'
                              ? 'bg-error/10 text-error'
                              : 'bg-text-muted/10 text-text-muted'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-border dark:border-dark-border">
                        {entry.error && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-error mb-1">Error</p>
                            <pre className="text-xs text-error/80 bg-error/5 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                              {entry.error}
                            </pre>
                          </div>
                        )}
                        {entry.result != null && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Result</p>
                            <pre className="text-xs text-text-secondary dark:text-dark-text-secondary bg-bg-tertiary dark:bg-dark-bg-tertiary p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                              {typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result, null, 2)}
                            </pre>
                          </div>
                        )}
                        {!entry.error && entry.result == null && (
                          <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted italic">No additional details.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with pagination */}
        <div className="p-4 border-t border-border dark:border-dark-border flex items-center justify-between">
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            {total > 0 ? `${showFrom}–${showTo} of ${total}` : '0 entries'}
          </span>
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <>
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-text-secondary dark:text-dark-text-secondary">
                  {page + 1}/{totalPages}
                </span>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="ml-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
