/**
 * API Error Hook
 *
 * Connects ApiError handling to the toast notification system.
 * Returns a handler function that can be called in catch blocks.
 *
 * Usage:
 *   const handleError = useApiError();
 *   try { await someApi.call(); }
 *   catch (err) { handleError(err, 'Loading providers'); }
 */

import { useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { ApiError } from '../api';

export function useApiError() {
  const toast = useToast();

  return useCallback(
    (error: unknown, context?: string) => {
      // Don't toast abort errors — user intentionally cancelled
      if (error instanceof Error && error.name === 'AbortError') return;

      if (error instanceof ApiError) {
        toast.error(error.message, context);
      } else if (error instanceof Error) {
        toast.error(error.message, context ?? 'Unexpected Error');
      } else {
        toast.error('An unexpected error occurred', context);
      }
    },
    [toast],
  );
}
