/**
 * BulkActionsBar — the multi-select action bar and its run progress/results.
 *
 * Split out of ClawsPage.tsx. Every value it renders comes from useClawActions,
 * so the two move together: the bar is the UI for the state that hook owns.
 */

import { Play, Pause, Square, Trash2 } from '../../components/icons';

type BulkOp = 'stop' | 'delete' | 'start' | 'pause';

interface BulkActionsBarProps {
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  bulkOp: BulkOp | null;
  bulkResults: Array<{ id: string; ok: boolean; name: string }>;
  bulkStart: () => void;
  bulkPause: () => void;
  bulkStop: () => void;
  bulkDelete: () => void;
}

export function BulkActionsBar({
  selectedIds,
  setSelectedIds,
  bulkOp,
  bulkResults,
  bulkStart,
  bulkPause,
  bulkStop,
  bulkDelete,
}: BulkActionsBarProps) {
  return (
    <>
      {/* Bulk Actions (when items selected) */}
      {selectedIds.size > 0 && !bulkOp && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={bulkStart}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-green-500/10 text-green-600 hover:bg-green-500/20"
          >
            <Play className="w-3 h-3" /> Start All
          </button>
          <button
            onClick={bulkPause}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
          >
            <Pause className="w-3 h-3" /> Pause All
          </button>
          <button
            onClick={bulkStop}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
          >
            <Square className="w-3 h-3" /> Stop All
          </button>
          <button
            onClick={bulkDelete}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20"
          >
            <Trash2 className="w-3 h-3" /> Delete All
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      )}

      {/* Bulk Op Progress/Results */}
      {bulkOp && (
        <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              {bulkOp === 'start'
                ? 'Starting claws...'
                : bulkOp === 'pause'
                  ? 'Pausing claws...'
                  : bulkOp === 'stop'
                    ? 'Stopping claws...'
                    : 'Deleting claws...'}
            </span>
            <span className="text-xs text-text-muted">
              {bulkResults.filter((r) => r.ok).length}/{bulkResults.length} done
            </span>
          </div>
          <div className="w-full bg-border dark:bg-dark-border rounded-full h-1.5">
            <div
              className="bg-primary rounded-full h-1.5 transition-all"
              style={{
                width: `${(bulkResults.filter((r) => r.ok).length / Math.max(bulkResults.length, 1)) * 100}%`,
              }}
            />
          </div>
          <div className="space-y-1">
            {bulkResults.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                {r.ok ? (
                  <span className="text-green-500">✓</span>
                ) : (
                  <span className="text-red-500">✗</span>
                )}
                <span className="text-text-secondary dark:text-dark-text-secondary truncate">
                  {r.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
