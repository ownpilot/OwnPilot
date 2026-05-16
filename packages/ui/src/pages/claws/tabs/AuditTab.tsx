import { type Dispatch, type SetStateAction } from 'react';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { CheckCircle2, XCircle } from '../../../components/icons';
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
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          {auditTotal} calls logged
        </p>
        <div className="flex-1" />
        <input
          type="text"
          placeholder="Search tool..."
          className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary w-32"
          onChange={(e) => setAuditFilter(e.target.value)}
        />
        <select
          value={auditFilter.split(':')[0]}
          onChange={(e) => setAuditFilter(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
        >
          <option value="">All</option>
          <option value="claw">Claw</option>
          <option value="cli">CLI</option>
          <option value="browser">Browser</option>
          <option value="coding-agent">Coding</option>
          <option value="web">Web</option>
          <option value="code-exec">Code</option>
          <option value="git">Git</option>
          <option value="filesystem">FS</option>
          <option value="knowledge">KB</option>
        </select>
        <button
          onClick={() => loadAudit(auditFilter || undefined)}
          className="text-xs text-primary hover:underline"
        >
          Refresh
        </button>
      </div>

      {isLoadingAudit ? (
        <LoadingSpinner message="Loading audit log..." />
      ) : auditEntries.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No audit entries yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {auditEntries
            .filter(
              (e) =>
                !auditFilter ||
                e.toolName.toLowerCase().includes(auditFilter.toLowerCase()) ||
                e.category === auditFilter
            )
            .map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-xs"
              >
                {entry.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">
                      {entry.toolName}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${AUDIT_CAT_COLORS[entry.category] ?? AUDIT_CAT_COLORS.tool}`}
                    >
                      {entry.category}
                    </span>
                    <span className="text-text-muted">{`#${entry.cycleNumber}`}</span>
                    <span className="text-text-muted">{formatDuration(entry.durationMs)}</span>
                  </div>
                  {Object.keys(entry.toolArgs).length > 0 && (
                    <p className="text-text-muted dark:text-dark-text-muted mt-0.5 truncate font-mono text-[11px]">
                      {JSON.stringify(entry.toolArgs).slice(0, 100)}
                    </p>
                  )}
                  {!entry.success && entry.toolResult && (
                    <p className="text-red-500 mt-0.5 truncate text-[11px]">
                      {entry.toolResult.slice(0, 80)}
                    </p>
                  )}
                </div>
                <span className="text-text-muted shrink-0 text-[11px]">
                  {timeAgo(entry.executedAt)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
