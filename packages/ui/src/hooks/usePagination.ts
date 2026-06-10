/**
 * usePagination — shared offset/limit pagination state.
 *
 * Replaces the per-page `useState(page) + useState(pageSize)` pattern and
 * centralizes the offset arithmetic. `params` matches the gateway's
 * `?limit=&offset=` query convention.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface UsePaginationResult {
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
  /** Row offset of the current page (`page * pageSize`). */
  offset: number;
  /** Ready-to-spread query params for gateway list endpoints. */
  params: { limit: number; offset: number };
  /** Jump back to the first page (call after filters change). */
  resetPage: () => void;
}

export function usePagination(initialSize = 50): UsePaginationResult {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);

  const offset = page * pageSize;
  const params = useMemo(() => ({ limit: pageSize, offset }), [pageSize, offset]);
  const resetPage = useCallback(() => setPage(0), []);

  return { page, setPage, pageSize, setPageSize, offset, params, resetPage };
}
