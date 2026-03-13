/**
 * CrewMemoryPanel — Crew shared memory viewer with search and category filtering
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { crewsApi } from '../../../api/endpoints/souls';
import type { CrewMemoryEntry } from '../../../api/endpoints/souls';
import { Search, Trash2, RefreshCw, Database, ChevronDown, ChevronRight } from '../../../components/icons';
import { EmptyState } from '../../../components/EmptyState';
import { useDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/ToastProvider';
import { formatTimeAgo } from '../helpers';

interface Props {
  crewId: string;
}

/** Deterministic color for category badges */
const CATEGORY_COLORS = [
  'bg-blue-500/15 text-blue-400',
  'bg-green-500/15 text-green-400',
  'bg-purple-500/15 text-purple-400',
  'bg-amber-500/15 text-amber-400',
  'bg-pink-500/15 text-pink-400',
  'bg-cyan-500/15 text-cyan-400',
  'bg-red-500/15 text-red-400',
  'bg-indigo-500/15 text-indigo-400',
];

function getCategoryColor(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) | 0;
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length]!;
}

export function CrewMemoryPanel({ crewId }: Props) {
  const { confirm } = useDialog();
  const toast = useToast();
  const [entries, setEntries] = useState<CrewMemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMemory = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await crewsApi.getMemory(
        crewId,
        activeCategory ?? undefined,
        searchQuery || undefined,
      );
      setEntries(data.entries);
      setTotal(data.total);
    } catch {
      setEntries([]);
      setTotal(0);
      toast.error('Failed to load crew memory');
    } finally {
      setIsLoading(false);
    }
  }, [crewId, activeCategory, searchQuery]);

  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

  // Debounce search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleDelete = useCallback(
    async (entry: CrewMemoryEntry) => {
      if (
        !(await confirm({
          message: `Delete memory "${entry.title}"? This cannot be undone.`,
          variant: 'danger',
        }))
      )
        return;
      try {
        await crewsApi.deleteMemory(crewId, entry.id);
        toast.success('Memory entry deleted');
        fetchMemory();
      } catch {
        toast.error('Failed to delete memory entry');
      }
    },
    [crewId, confirm, toast, fetchMemory]
  );

  // Extract unique categories from loaded entries
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      if (entry.category) set.add(entry.category);
    }
    return Array.from(set).sort();
  }, [entries]);

  const inputClass =
    'w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="space-y-4">
      {/* Toolbar: search + refresh */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search shared memories..."
            className={`${inputClass} pl-9`}
          />
        </div>
        <button
          onClick={fetchMemory}
          aria-label="Refresh memory"
          className="p-2 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              activeCategory === null
                ? 'bg-primary text-white'
                : 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary border border-border dark:border-dark-border'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                activeCategory === cat
                  ? 'bg-primary text-white'
                  : 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary border border-border dark:border-dark-border'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <RefreshCw className="w-4 h-4 text-text-muted dark:text-dark-text-muted animate-spin" />
          <span className="text-sm text-text-muted dark:text-dark-text-muted">
            Loading memories...
          </span>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No shared memories yet"
          description="Crew agents will store shared knowledge here during their heartbeat cycles."
        />
      ) : (
        <>
          {/* Count */}
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Showing {entries.length} of {total} memor{total === 1 ? 'y' : 'ies'}
          </p>

          {/* Memory list */}
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {entries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="border border-border dark:border-dark-border rounded-lg p-3 hover:shadow-sm transition-shadow"
                >
                  {/* Header row */}
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="mt-0.5 text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary flex-shrink-0"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                          {entry.title}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${getCategoryColor(entry.category)}`}
                        >
                          {entry.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                        <span>by {entry.agentId}</span>
                        <span>&middot;</span>
                        <span>{formatTimeAgo(entry.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(entry)}
                      className="flex-shrink-0 p-1 text-text-muted dark:text-dark-text-muted hover:text-danger transition-colors"
                      aria-label="Delete memory"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Content — truncated or expanded */}
                  <div className="mt-2 ml-5.5">
                    <p
                      className={`text-xs text-text-muted dark:text-dark-text-muted whitespace-pre-wrap ${
                        isExpanded ? '' : 'line-clamp-2'
                      }`}
                    >
                      {entry.content}
                    </p>
                    {!isExpanded && entry.content.length > 150 && (
                      <button
                        onClick={() => setExpandedId(entry.id)}
                        className="text-xs text-primary hover:text-primary-dark mt-0.5 transition-colors"
                      >
                        Show more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
