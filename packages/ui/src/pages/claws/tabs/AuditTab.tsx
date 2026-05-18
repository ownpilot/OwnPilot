import { type Dispatch, type SetStateAction, useState, useMemo } from 'react';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { CheckCircle2, XCircle } from '../../../components/icons';
import { ignoreError } from '../../../utils/ignore-error';
import { formatDuration, timeAgo } from '../utils';

export interface AuditEntry {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  success: boolean;
  durationMs: number;
  category: string;
  cycleNumber: number;
  executedAt: string;
}

const AUDIT_CAT_COLORS: Record<string, string> = {
  claw: 'bg-primary/10 text-primary',
  cli: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  browser: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  'coding-agent': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  web: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'code-exec': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  git: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  filesystem: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  knowledge: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  tool: 'bg-gray-500/10 text-gray-500',
};

export function AuditTab({
  auditEntries,
  auditTotal,
  auditFilter,
  setAuditFilter,
  isLoadingAudit,
  loadAudit,
}: {
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditFilter: string;
  setAuditFilter: Dispatch<SetStateAction<string>>;
  isLoadingAudit: boolean;
  loadAudit: (cat?: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [successFilter, setSuccessFilter] = useState<'' | 'success' | 'failed'>('');

  const filteredEntries = useMemo(() => {
    return auditEntries.filter((e) => {
      if (successFilter === 'success' && !e.success) return false;
      if (successFilter === 'failed' && e.success) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !e.toolName.toLowerCase().includes(q) &&
          !e.category.toLowerCase().includes(q) &&
          !e.toolResult.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [auditEntries, successFilter, searchQuery]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of auditEntries) {
      counts[e.category] = (counts[e.category] ?? 0) + 1;
    }
    return counts;
  }, [auditEntries]);

  const uniqueCats = Object.keys(catCounts);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(filteredEntries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claw-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted shrink-0">
          {auditTotal} calls logged
        </p>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tool, category, result..."
          className="flex-1 min-w-[160px] px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-300 font-mono placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
        />
        <select
          value={successFilter}
          onChange={(e) => setSuccessFilter(e.target.value as typeof successFilter)}
          className="px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-400 font-mono focus:outline-none focus:border-gray-500"
        >
          <option value="">All</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={auditFilter}
          onChange={(e) => setAuditFilter(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-700 bg-[#1a1a1a] text-gray-400 font-mono focus:outline-none focus:border-gray-500"
        >
          <option value="">All categories</option>
          {uniqueCats.map((c) => (
            <option key={c} value={c}>
              {c} ({catCounts[c]})
            </option>
          ))}
        </select>
        <button
          onClick={() => loadAudit(auditFilter || undefined)}
          className="text-xs text-primary hover:underline shrink-0"
        >
          Refresh
        </button>
        <button
          onClick={downloadJson}
          className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700 hover:text-gray-300 shrink-0"
          title="Download JSON"
        >
          ↓
        </button>
      </div>

      {/* Category pills */}
      {uniqueCats.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {uniqueCats.map((c) => (
            <button
              key={c}
              onClick={() => setAuditFilter(auditFilter === c ? '' : c)}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                auditFilter === c
                  ? `${AUDIT_CAT_COLORS[c] ?? 'bg-gray-500/10 text-gray-500'} border-transparent`
                  : 'text-gray-500 border-gray-700 hover:border-gray-500'
              }`}
            >
              {c}: {catCounts[c]}
            </button>
          ))}
        </div>
      )}

      {isLoadingAudit ? (
        <LoadingSpinner message="Loading audit log..." />
      ) : filteredEntries.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          {auditEntries.length === 0
            ? 'No audit entries yet.'
            : 'No entries match the current filter.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filteredEntries.map((entry) => {
            const isExpanded = expanded.has(entry.id);
            return (
              <div
                key={entry.id}
                className="rounded-lg border border-border dark:border-dark-border overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(entry.id)}
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
                    <span className="text-[11px] text-text-muted shrink-0">
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
                    <pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-40 overflow-y-auto">
                      {Object.keys(entry.toolArgs).length > 0
                        ? JSON.stringify(entry.toolArgs, null, 2)
                        : '(no args)'}
                    </pre>
                    {!entry.success && (
                      <>
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-red-400 uppercase tracking-wider">
                            Error
                          </span>
                        </div>
                        <pre className="text-[11px] text-red-300 font-mono whitespace-pre-wrap bg-red-500/5 rounded p-2 max-h-32 overflow-y-auto">
                          {entry.toolResult || '(no result)'}
                        </pre>
                      </>
                    )}
                    {entry.success && entry.toolResult && (
                      <>
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                            Result
                          </span>
                        </div>
                        <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-32 overflow-y-auto">
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
    </div>
  );
}
