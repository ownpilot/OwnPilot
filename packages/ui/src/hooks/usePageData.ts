/**
 * usePageData — shared page-level data fetching hook.
 *
 * Replaces the hand-rolled `useState(isLoading) + useState(error) + useEffect`
 * fetch block that most pages duplicate. Handles:
 *   - loading / error state
 *   - stale-response protection (a refetch or dep change invalidates any
 *     in-flight request's result)
 *   - manual refetch (with optional silent mode for background refreshes)
 *   - imperative cache patching after local mutations via `setData`
 *
 * Usage:
 *   const { data, isLoading, error, refetch, setData } = usePageData(
 *     () => costsApi.getSummary(period),
 *     [period],
 *     { errorMessage: 'Failed to fetch cost data' }
 *   );
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction, DependencyList } from 'react';

export interface UsePageDataOptions {
  /**
   * Fixed user-facing message to expose in `error` instead of the thrown
   * error's own message (most pages show a stable string in the UI).
   */
  errorMessage?: string;
  /**
   * When false, the fetch is skipped entirely (e.g. while a prerequisite id
   * is still unknown). Defaults to true.
   */
  enabled?: boolean;
}

export interface UsePageDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /**
   * Re-run the fetcher. Pass `{ silent: true }` to refresh in the background
   * without flipping `isLoading` (avoids spinner flash on poll/refresh).
   */
  refetch: (opts?: { silent?: boolean }) => Promise<void>;
  /** Patch the cached data after a local mutation (e.g. a successful save). */
  setData: Dispatch<SetStateAction<T | null>>;
}

export function usePageData<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList = [],
  options: UsePageDataOptions = {}
): UsePageDataResult<T> {
  const { errorMessage, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest fetcher/errorMessage in refs so the load function stays
  // stable and only `deps` (plus refetch calls) trigger new requests.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorMessageRef = useRef(errorMessage);
  errorMessageRef.current = errorMessage;

  // Generation counter: each load bumps it; a response only lands if it is
  // still the newest request. Covers both unmount and dep-change races.
  const generationRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const generation = ++generationRef.current;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (generationRef.current !== generation) return;
      setData(result);
    } catch (err) {
      if (generationRef.current !== generation) return;
      const message = errorMessageRef.current ?? (err instanceof Error ? err.message : String(err));
      setError(message);
    } finally {
      if (generationRef.current === generation && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    void load(false);
    return () => {
      // Invalidate any in-flight request when deps change or the page unmounts.
      generationRef.current++;
    };
    // Caller-supplied dep list drives refetching (spread is intentional).
  }, [enabled, load, ...deps]);

  const refetch = useCallback((opts?: { silent?: boolean }) => load(opts?.silent ?? false), [load]);

  return { data, isLoading, error, refetch, setData };
}
