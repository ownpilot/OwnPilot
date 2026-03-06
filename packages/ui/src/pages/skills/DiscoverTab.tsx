import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, RefreshCw, AlertTriangle } from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/ToastProvider';
import { skillsApi } from '../../api/endpoints/skills';
import { extensionsApi } from '../../api/endpoints/extensions';
import type { NpmSearchPackage } from '../../api/endpoints/skills';
import { DiscoverCard } from './DiscoverCard';

const PAGE_SIZE = 20;

export function DiscoverTab() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NpmSearchPackage[]>([]);
  const [total, setTotal] = useState(0);
  /** True only on initial mount load — shows full-page spinner */
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  /** True while debounced search is in-flight — shows subtle overlay */
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track the latest search request to ignore stale responses */
  const searchSeqRef = useRef(0);

  const doSearch = useCallback(async (q: string, isInitial = false, append = false) => {
    const seq = ++searchSeqRef.current;
    if (isInitial) {
      setIsInitialLoading(true);
    } else if (append) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
    }
    setError(null);
    try {
      const offset = append ? results.length : 0;
      const res = await skillsApi.search(q, PAGE_SIZE, offset);
      if (seq !== searchSeqRef.current) return; // stale
      const pkgs = res.packages ?? [];
      setResults((prev) => (append ? [...prev, ...pkgs] : pkgs));
      setTotal(res.total ?? pkgs.length);
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to search npm registry';
      setError(msg);
    } finally {
      if (seq === searchSeqRef.current) {
        setIsInitialLoading(false);
        setIsSearching(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  const loadInstalled = useCallback(async () => {
    try {
      const data = await extensionsApi.list();
      const names = new Set(
        (data ?? []).flatMap((p) => {
          const npm = (p.manifest as Record<string, unknown>).npm_package;
          return typeof npm === 'string' ? [npm] : [];
        })
      );
      setInstalledNames(names);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    doSearch('', true);
    loadInstalled();
  }, [doSearch, loadInstalled]);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  const handleKeywordClick = (kw: string) => {
    setQuery(kw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(kw);
  };

  const handleRefresh = () => {
    setQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch('', true);
  };

  const handleInstall = async (pkg: NpmSearchPackage) => {
    setInstalling((prev) => new Set([...prev, pkg.name]));
    try {
      await skillsApi.installNpm(pkg.name);
      toast.success(`Installed "${pkg.name}"`);
      setInstalledNames((prev) => new Set([...prev, pkg.name]));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(pkg.name);
        return next;
      });
    }
  };

  const hasMore = results.length < total;

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search npm for AgentSkills.io skills…"
              className="w-full pl-9 pr-4 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isInitialLoading}
            className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors disabled:opacity-50"
            title="Refresh featured"
          >
            <RefreshCw className={`w-4 h-4 ${isInitialLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Sub-header: context line + result count */}
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            {query
              ? `Results for "${query}" from npm registry`
              : 'Featured skills from npm registry'}
          </p>
          {!isInitialLoading && results.length > 0 && (
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {results.length}
              {total > results.length ? ` of ${total}` : ''} package{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-6">
        {isInitialLoading ? (
          <LoadingSpinner message="Loading skills from npm registry…" />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-error" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Failed to load skills
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted max-w-sm">{error}</p>
            </div>
            <button
              onClick={() => doSearch(query, !query)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={Search}
            title={query ? `No results for "${query}"` : 'No featured skills found'}
            description={
              query
                ? 'Try different keywords or clear the search to browse featured skills.'
                : 'The npm registry returned no results. Try searching for a specific skill.'
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Grid — rendered even while isSearching to avoid blank flash */}
            <div
              className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 transition-opacity ${isSearching ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}
            >
              {results.map((pkg) => (
                <DiscoverCard
                  key={pkg.name}
                  pkg={pkg}
                  isInstalled={installedNames.has(pkg.name)}
                  isInstalling={installing.has(pkg.name)}
                  onInstall={() => handleInstall(pkg)}
                  onKeywordClick={handleKeywordClick}
                />
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => doSearch(query, false, true)}
                  disabled={isLoadingMore}
                  className="flex items-center gap-2 px-5 py-2 text-sm border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-50 transition-colors"
                >
                  {isLoadingMore ? (
                    <>
                      <div className="w-4 h-4 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
                      Loading…
                    </>
                  ) : (
                    `Load more (${total - results.length} remaining)`
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
