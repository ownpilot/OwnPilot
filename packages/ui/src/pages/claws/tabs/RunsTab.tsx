import { useState, useMemo } from 'react';
import { clawsApi, type ClawHistoryEntry } from '../../../api/endpoints/claws';
import type { AuditEntry } from './AuditTab';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { CheckCircle2, XCircle } from '../../../components/icons';
import { ignoreError } from '../../../utils/ignore-error';
import { formatDuration, formatCost, timeAgo } from '../utils';

const CYCLE_BAR_COLOR: Record<string, string> = {
  success: 'bg-green-500',
  failed: 'bg-red-500',
  error: 'bg-amber-500',
  escalation: 'bg-purple-500',
  default: 'bg-blue-500',
};

type RunsSubTab = 'history' | 'timeline' | 'audit';

const AUDIT_CAT_COLORS: Record<string, string> = {
  claw: 'bg-primary/10 text-primary',
  cli: 'bg-amber-500/10 text-amber-600',
  browser: 'bg-cyan-500/10 text-cyan-600',
  'coding-agent': 'bg-purple-500/10 text-purple-600',
  web: 'bg-blue-500/10 text-blue-600',
  'code-exec': 'bg-emerald-500/10 text-emerald-600',
  git: 'bg-orange-500/10 text-orange-600',
  filesystem: 'bg-gray-500/10 text-gray-600',
  knowledge: 'bg-pink-500/10 text-pink-600',
  tool: 'bg-gray-500/10 text-gray-500',
};

export function RunsTab({
  clawId,
  history,
  historyTotal,
  isLoadingHistory,
  loadHistory,
  auditEntries,
  auditTotal,
  auditFilter,
  setAuditFilter,
  isLoadingAudit,
  loadAudit,
}: {
  clawId: string;
  history: ClawHistoryEntry[];
  historyTotal: number;
  isLoadingHistory: boolean;
  loadHistory: () => void;
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditFilter: string;
  setAuditFilter: (f: string) => void;
  isLoadingAudit: boolean;
  loadAudit: (filter?: string) => void;
}) {
  const [subTab, setSubTab] = useState<RunsSubTab>('history');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

  // Audit state
  const [auditSearch, setAuditSearch] = useState('');
  const [expandedAudit, setExpandedAudit] = useState<Set<string>>(new Set());

  const filteredHistory = useMemo(() => {
    let items =
      historyFilter === 'all'
        ? history
        : history.filter((e) => (historyFilter === 'success' ? e.success : !e.success));
    if (historySearch) {
      const q = historySearch.toLowerCase();
      items = items.filter(
        (e) =>
          e.outputMessage?.toLowerCase().includes(q) ||
          e.error?.toLowerCase().includes(q) ||
          String(e.cycleNumber).includes(q)
      );
    }
    return items;
  }, [history, historyFilter, historySearch]);

  const historyStats = useMemo(() => {
    if (history.length === 0) return null;
    const totalCost = history.reduce((s, e) => s + (e.costUsd ?? 0), 0);
    const totalDuration = history.reduce((s, e) => s + e.durationMs, 0);
    const successCount = history.filter((e) => e.success).length;
    const failCount = history.length - successCount;
    return {
      totalCost,
      avgDuration: Math.round(totalDuration / history.length),
      successRate: ((successCount / history.length) * 100).toFixed(1) + '%',
      failCount,
    };
  }, [history]);

  const filteredAudit = useMemo(() => {
    if (!auditSearch && !auditFilter) return auditEntries;
    const q = auditSearch.toLowerCase();
    return auditEntries.filter((e) => {
      if (auditFilter && e.category !== auditFilter) return false;
      if (q && !e.toolName.toLowerCase().includes(q) && !e.toolResult.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [auditEntries, auditFilter, auditSearch]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of auditEntries) {
      counts[e.category] = (counts[e.category] ?? 0) + 1;
    }
    return counts;
  }, [auditEntries]);

  const maxDuration = Math.max(...history.map((e) => e.durationMs), 1);

  const downloadAuditJson = () => {
    const blob = new Blob([JSON.stringify(filteredAudit, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claw-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [isExportingTrajectory, setIsExportingTrajectory] = useState(false);
  const exportTrajectory = async () => {
    setIsExportingTrajectory(true);
    try {
      const { trajectory } = await clawsApi.exportTrajectory(clawId);
      const blob = new Blob([JSON.stringify(trajectory, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claw-trajectory-${clawId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExportingTrajectory(false);
    }
  };

  const copyEntry = (entry: AuditEntry) => {
    ignoreError(
      navigator.clipboard.writeText(
        JSON.stringify(
          { tool: entry.toolName, args: entry.toolArgs, result: entry.toolResult },
          null,
          2
        )
      ),
      'clipboard.copyEntry'
    );
  };

  return (
    <div className="space-y-3">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 border-b border-border dark:border-dark-border pb-2">
        {(['history', 'timeline', 'audit'] as RunsSubTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setSubTab(s)}
            className={`px-3 py-1 text-xs font-medium rounded ${
              subTab === s
                ? 'bg-primary/10 text-primary'
                : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* History sub-tab */}
      {subTab === 'history' && (
        <>
          {historyStats && (
            <div className="grid grid-cols-4 gap-2">
              {[
                {
                  label: 'Total Cost',
                  value: formatCost(historyStats.totalCost),
                  color: 'text-green-400',
                },
                {
                  label: 'Avg Duration',
                  value: formatDuration(historyStats.avgDuration),
                  color: 'text-blue-400',
                },
                {
                  label: 'Success Rate',
                  value: historyStats.successRate,
                  color: 'text-emerald-400',
                },
                {
                  label: 'Failed',
                  value: String(historyStats.failCount),
                  color: historyStats.failCount > 0 ? 'text-red-400' : 'text-text-muted',
                },
              ].map((s) => (
                <div key={s.label} className="bg-[#1a1a1a] rounded p-2 text-center">
                  <p className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search cycles..."
              className="flex-1 px-2 py-1 text-xs rounded bg-[#1a1a1a] border border-gray-700 text-gray-300 font-mono placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
            />
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as typeof historyFilter)}
              className="px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-400 font-mono focus:outline-none focus:border-gray-500"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            <span className="text-[10px] text-gray-500 font-mono">
              {filteredHistory.length}
              {historySearch || historyFilter !== 'all' ? `/${history.length}` : ''}
            </span>
            <button
              onClick={exportTrajectory}
              disabled={isExportingTrajectory || history.length === 0}
              title="Export run history as a ShareGPT-format trajectory (for eval / fine-tuning)"
              className="px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-400 font-mono hover:border-gray-500 disabled:opacity-50"
            >
              {isExportingTrajectory ? 'Exporting…' : 'Export ShareGPT'}
            </button>
          </div>
          {isLoadingHistory ? (
            <LoadingSpinner message="Loading history..." />
          ) : filteredHistory.length === 0 ? (
            <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
              {history.length === 0 ? 'No cycles yet.' : 'No cycles match the current filter.'}
            </p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {[...filteredHistory].reverse().map((entry) => {
                const isExpanded = expandedCycle === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="rounded border border-border dark:border-dark-border overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedCycle(isExpanded ? null : entry.id)}
                      className="w-full flex items-center gap-2 p-2 hover:bg-white/5 transition-colors"
                    >
                      {entry.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      )}
                      <span className="text-xs font-mono font-medium text-text-secondary dark:text-dark-text-secondary">
                        #{entry.cycleNumber}
                      </span>
                      <span className="text-xs text-text-muted">{timeAgo(entry.executedAt)}</span>
                      <span className="text-xs text-text-muted">
                        {formatDuration(entry.durationMs)}
                      </span>
                      {entry.costUsd != null && (
                        <span className="text-xs text-green-400 font-mono">
                          {formatCost(entry.costUsd)}
                        </span>
                      )}
                      {entry.toolCalls.length > 0 && (
                        <span className="text-[10px] text-gray-500">
                          {entry.toolCalls.length} tools
                        </span>
                      )}
                      <div className="flex-1" />
                      <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-1 border-t border-[#1a1a1a] bg-[#0d0d0d] space-y-2">
                        <pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-32 overflow-y-auto">
                          {entry.outputMessage?.slice(0, 1000) || '(no output)'}
                          {entry.outputMessage && entry.outputMessage.length > 1000 ? '\n...' : ''}
                        </pre>
                        {entry.error && (
                          <div>
                            <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">
                              Error
                            </p>
                            <pre className="text-[11px] text-red-300 font-mono whitespace-pre-wrap bg-red-500/5 rounded p-2">
                              {entry.error}
                            </pre>
                          </div>
                        )}
                        {entry.toolCalls.length > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                              Tool calls ({entry.toolCalls.length})
                            </p>
                            <div className="space-y-1">
                              {entry.toolCalls.slice(0, 15).map((tc, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2 text-[11px] font-mono"
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${tc.success ? 'bg-green-500' : 'bg-red-500'}`}
                                  />
                                  <span className="text-blue-400 shrink-0">{tc.tool}</span>
                                  <span className={tc.success ? 'text-green-500' : 'text-red-400'}>
                                    {tc.success ? 'OK' : 'FAIL'}
                                  </span>
                                  <span className="text-gray-500">
                                    {formatDuration(tc.durationMs ?? 0)}
                                  </span>
                                </div>
                              ))}
                              {entry.toolCalls.length > 15 && (
                                <p className="text-[10px] text-gray-600 pl-4">
                                  +{entry.toolCalls.length - 15} more
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Timeline sub-tab */}
      {subTab === 'timeline' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {historyTotal} cycles — bar width = relative duration
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
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {[...history].reverse().map((entry) => {
                const barWidth = Math.max((entry.durationMs / maxDuration) * 100, 4);
                const color =
                  CYCLE_BAR_COLOR[entry.error ? 'error' : entry.success ? 'success' : 'failed'];
                return (
                  <div key={entry.id} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-text-muted dark:text-dark-text-muted shrink-0 font-mono">
                      #{entry.cycleNumber}
                    </span>
                    <div className="flex-1 h-3 rounded-full bg-border dark:bg-dark-border overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-text-muted dark:text-dark-text-muted font-mono">
                      {formatDuration(entry.durationMs)}
                    </span>
                    {entry.costUsd != null && (
                      <span className="w-16 text-right text-green-400 font-mono">
                        {formatCost(entry.costUsd)}
                      </span>
                    )}
                    <span className="w-12 text-right text-gray-600 font-mono">
                      {timeAgo(entry.executedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Audit sub-tab */}
      {subTab === 'audit' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Search tool, result..."
              className="flex-1 min-w-[140px] px-2 py-1 text-xs rounded bg-[#1a1a1a] border border-gray-700 text-gray-300 font-mono placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
            />
            <select
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-400 font-mono focus:outline-none focus:border-gray-500"
            >
              <option value="">All categories</option>
              {Object.keys(catCounts).map((c) => (
                <option key={c} value={c}>
                  {c} ({catCounts[c]})
                </option>
              ))}
            </select>
            <span className="text-[10px] text-gray-500 font-mono">{auditTotal} entries</span>
            <button
              onClick={() => loadAudit(auditFilter || undefined)}
              className="text-xs text-primary hover:underline"
            >
              Refresh
            </button>
            <button
              onClick={downloadAuditJson}
              className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700 hover:text-gray-300"
              title="Download JSON"
            >
              ↓
            </button>
          </div>

          {isLoadingAudit ? (
            <LoadingSpinner message="Loading audit..." />
          ) : filteredAudit.length === 0 ? (
            <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
              {auditEntries.length === 0
                ? 'No audit entries yet.'
                : 'No entries match the current filter.'}
            </p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {filteredAudit.map((entry) => {
                const isExpanded = expandedAudit.has(entry.id);
                return (
                  <div
                    key={entry.id}
                    className="rounded border border-border dark:border-dark-border overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setExpandedAudit((prev) => {
                          const next = new Set(prev);
                          if (isExpanded) next.delete(entry.id);
                          else next.add(entry.id);
                          return next;
                        });
                      }}
                      className="w-full flex items-start gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
                    >
                      <div className="mt-0.5 shrink-0">
                        {entry.success ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary text-xs">
                            {entry.toolName}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${AUDIT_CAT_COLORS[entry.category] ?? AUDIT_CAT_COLORS.tool}`}
                          >
                            {entry.category}
                          </span>
                          <span className="text-[10px] text-text-muted font-mono">
                            #{entry.cycleNumber}
                          </span>
                          <span className="text-[10px] text-text-muted font-mono">
                            {formatDuration(entry.durationMs)}
                          </span>
                        </div>
                        {!entry.success && entry.toolResult && (
                          <p className="text-red-400 mt-0.5 truncate font-mono text-[11px]">
                            {entry.toolResult.slice(0, 120)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-text-muted">
                          {timeAgo(entry.executedAt)}
                        </span>
                        <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-3 pt-1 border-t border-[#1a1a1a] bg-[#0d0d0d] space-y-2">
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                            Args
                          </span>
                          <button
                            onClick={() => copyEntry(entry)}
                            className="text-[10px] text-gray-600 hover:text-gray-400 font-mono"
                            title="Copy"
                          >
                            📋
                          </button>
                        </div>
                        <pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-32 overflow-y-auto">
                          {Object.keys(entry.toolArgs).length > 0
                            ? JSON.stringify(entry.toolArgs, null, 2)
                            : '(no args)'}
                        </pre>
                        {entry.toolResult && (
                          <>
                            <div className="flex items-center gap-2 pt-1">
                              <span
                                className={`text-[10px] uppercase tracking-wider ${entry.success ? 'text-gray-500' : 'text-red-400'}`}
                              >
                                {entry.success ? 'Result' : 'Error'}
                              </span>
                            </div>
                            <pre
                              className={`text-[11px] font-mono whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-32 overflow-y-auto ${
                                entry.success ? 'text-gray-400' : 'text-red-300 bg-red-500/5'
                              }`}
                            >
                              {entry.toolResult.slice(0, 500)}
                              {entry.toolResult.length > 500 ? '\n...' : ''}
                            </pre>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
