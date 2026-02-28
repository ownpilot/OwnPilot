/**
 * WorkflowVersionsPanel — shows version history for a workflow.
 * Users can browse past versions and restore any of them.
 */

import { useState, useEffect, useCallback } from 'react';
import { History, RotateCcw, X, ChevronDown } from '../icons';
import { workflowsApi } from '../../api/endpoints/workflows';
import type { WorkflowVersion } from '../../api/types';

interface WorkflowVersionsPanelProps {
  workflowId: string;
  onRestore: (workflow: {
    nodes: unknown[];
    edges: unknown[];
    variables: Record<string, unknown>;
  }) => void;
  onClose: () => void;
  className?: string;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function WorkflowVersionsPanel({
  workflowId,
  onRestore,
  onClose,
  className = '',
}: WorkflowVersionsPanelProps) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await workflowsApi.versions(workflowId, { limit: '50' });
      setVersions(resp.versions);
      setTotal(resp.total);
      setHasMore(resp.hasMore);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleRestore = useCallback(
    async (version: number) => {
      setRestoringVersion(version);
      try {
        const restored = await workflowsApi.restoreVersion(workflowId, version);
        onRestore({
          nodes: restored.nodes as unknown[],
          edges: restored.edges as unknown[],
          variables: (restored.variables ?? {}) as Record<string, unknown>,
        });
        // Refresh versions list
        await fetchVersions();
      } catch {
        // silently fail
      } finally {
        setRestoringVersion(null);
      }
    },
    [workflowId, onRestore, fetchVersions]
  );

  const handleLoadMore = useCallback(async () => {
    try {
      const resp = await workflowsApi.versions(workflowId, {
        limit: '50',
        offset: String(versions.length),
      });
      setVersions((prev) => [...prev, ...resp.versions]);
      setHasMore(resp.hasMore);
    } catch {
      // silently fail
    }
  }, [workflowId, versions.length]);

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
          <h3 className="text-xs font-semibold text-text-primary dark:text-dark-text-primary">
            Version History
          </h3>
          {total > 0 && (
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">({total})</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-0.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-text-muted dark:text-dark-text-muted">
            Loading versions...
          </div>
        ) : versions.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted dark:text-dark-text-muted">
            No versions yet. Versions are created automatically when you save changes.
          </div>
        ) : (
          <div className="divide-y divide-border dark:divide-dark-border">
            {versions.map((v) => (
              <div
                key={v.id}
                className="px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono font-medium text-text-primary dark:text-dark-text-primary">
                      v{v.version}
                    </span>
                    <span className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                      {formatTimeAgo(v.createdAt)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRestore(v.version)}
                    disabled={restoringVersion !== null}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary hover:text-brand dark:hover:text-dark-brand bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-brand/10 border border-border dark:border-dark-border rounded transition-colors disabled:opacity-50"
                    title={`Restore version ${v.version}`}
                  >
                    <RotateCcw
                      className={`w-2.5 h-2.5 ${restoringVersion === v.version ? 'animate-spin' : ''}`}
                    />
                    {restoringVersion === v.version ? 'Restoring' : 'Restore'}
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted dark:text-dark-text-muted">
                  <span>{(v.nodes as unknown[]).length} nodes</span>
                  <span>{(v.edges as unknown[]).length} edges</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <button
            onClick={handleLoadMore}
            className="w-full py-2 text-xs text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors flex items-center justify-center gap-1"
          >
            <ChevronDown className="w-3 h-3" />
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
