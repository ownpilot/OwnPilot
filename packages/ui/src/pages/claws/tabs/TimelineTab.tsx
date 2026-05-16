import { useState } from 'react';
import type { ClawHistoryEntry } from '../../../api/endpoints/claws';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { formatDuration, formatCost } from '../utils';

const CYCLE_BAR_COLOR: Record<string, string> = {
  success: 'bg-green-500',
  failed: 'bg-red-500',
  error: 'bg-amber-500',
  escalation: 'bg-purple-500',
  default: 'bg-blue-500',
};

export function TimelineTab({
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
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
  const maxDuration = Math.max(...history.map((e) => e.durationMs), 1);
  const now = Date.now();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          {historyTotal} cycles — width = relative duration
        </p>
        <button onClick={loadHistory} className="text-xs text-primary hover:underline">
          Refresh
        </button>
      </div>

      {isLoadingHistory ? (
        <LoadingSpinner message="Loading..." />
      ) : history.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No cycles yet.
        </p>
      ) : (
        <div className="space-y-1">
          {history.map((entry) => {
            const barWidth = Math.round((entry.durationMs / maxDuration) * 100);
            const colorKey = entry.error
              ? entry.entryType === 'escalation'
                ? 'escalation'
                : 'error'
              : entry.success
                ? 'success'
                : 'failed';
            const isExpanded = expandedCycle === entry.id;
            const ageMs = now - new Date(entry.executedAt).getTime();
            const ageLabel =
              ageMs < 60_000
                ? 'now'
                : ageMs < 3_600_000
                  ? `${Math.floor(ageMs / 60_000)}m`
                  : `${Math.floor(ageMs / 3_600_000)}h`;

            return (
              <div
                key={entry.id}
                className="border border-border dark:border-dark-border rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => setExpandedCycle(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-2 p-2.5 hover:bg-primary/5 transition-colors"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        colorKey === 'success'
                          ? '#22c55e'
                          : colorKey === 'error'
                            ? '#f59e0b'
                            : colorKey === 'failed'
                              ? '#ef4444'
                              : colorKey === 'escalation'
                                ? '#a855f7'
                                : '#3b82f6',
                    }}
                  />
                  <div className="flex-1 h-5 bg-[#1a1a1a] rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${CYCLE_BAR_COLOR[colorKey] ?? CYCLE_BAR_COLOR.default}`}
                      style={{ width: `${barWidth}%`, opacity: 0.8 }}
                    />
                  </div>
                  <span className="text-xs font-mono text-gray-400 w-12 shrink-0">
                    #{entry.cycleNumber}
                  </span>
                  <span className="text-xs font-mono text-green-400 w-16 shrink-0">
                    {formatCost(entry.costUsd ?? 0)}
                  </span>
                  <span className="text-xs font-mono text-gray-500 w-16 shrink-0">
                    {formatDuration(entry.durationMs)}
                  </span>
                  <span className="text-xs text-gray-600 w-10 shrink-0">{ageLabel}</span>
                  <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#1a1a1a] bg-[#0d0d0d]">
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3 text-xs font-mono">
                      <div className="bg-[#161616] rounded p-1.5">
                        <span className="text-gray-500">Cycle</span>
                        <p className="text-gray-300 font-medium">{entry.cycleNumber}</p>
                      </div>
                      <div className="bg-[#161616] rounded p-1.5">
                        <span className="text-gray-500">Duration</span>
                        <p className="text-gray-300 font-medium">
                          {formatDuration(entry.durationMs)}
                        </p>
                      </div>
                      <div className="bg-[#161616] rounded p-1.5">
                        <span className="text-gray-500">Cost</span>
                        <p className="text-gray-300 font-medium">
                          {formatCost(entry.costUsd ?? 0)}
                        </p>
                      </div>
                      <div className="bg-[#161616] rounded p-1.5">
                        <span className="text-gray-500">Tools</span>
                        <p className="text-gray-300 font-medium">{entry.toolCalls.length}</p>
                      </div>
                      {entry.tokensUsed && (
                        <>
                          <div className="bg-[#161616] rounded p-1.5">
                            <span className="text-gray-500">Prompt</span>
                            <p className="text-gray-300 font-medium">{entry.tokensUsed.prompt}</p>
                          </div>
                          <div className="bg-[#161616] rounded p-1.5">
                            <span className="text-gray-500">Completion</span>
                            <p className="text-gray-300 font-medium">
                              {entry.tokensUsed.completion}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                    {entry.outputMessage && (
                      <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-1">Output</p>
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-32 overflow-y-auto">
                          {entry.outputMessage.slice(0, 1000)}
                          {entry.outputMessage.length > 1000 ? '...' : ''}
                        </pre>
                      </div>
                    )}
                    {entry.error && (
                      <div className="mt-2">
                        <p className="text-xs text-red-400 mb-1">Error</p>
                        <p className="text-xs text-red-300/70 font-mono">{entry.error}</p>
                      </div>
                    )}
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">
                        Tool calls ({entry.toolCalls.length})
                      </p>
                      <div className="space-y-1">
                        {entry.toolCalls.slice(0, 20).map((tc, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs font-mono">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${tc.success ? 'bg-green-500' : 'bg-red-500'}`}
                            />
                            <span className="text-blue-400 shrink-0">{tc.tool}</span>
                            <span className={tc.success ? 'text-green-500' : 'text-red-500'}>
                              {tc.success ? 'OK' : 'FAIL'}
                            </span>
                            <span className="text-gray-500">
                              {formatDuration(tc.durationMs ?? 0)}
                            </span>
                            {tc.args && Object.keys(tc.args).length > 0 && (
                              <span className="text-gray-600 truncate">
                                {JSON.stringify(tc.args).slice(0, 40)}
                              </span>
                            )}
                          </div>
                        ))}
                        {entry.toolCalls.length > 20 && (
                          <p className="text-xs text-gray-600 pl-4">
                            +{entry.toolCalls.length - 20} more
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
