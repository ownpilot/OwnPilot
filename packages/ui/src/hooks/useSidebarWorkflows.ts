/**
 * useSidebarWorkflows — fetches the 5 most recent workflows for sidebar display.
 *
 * Fires workflowsApi.list({ limit: '5' }) on mount.
 * Cancellation-safe: ignores results if component unmounts before response.
 */
import { useState, useEffect } from 'react';
import { workflowsApi } from '../api';
import type { Workflow } from '../api/types';

export interface SidebarWorkflowsState {
  workflows: Workflow[];
  isLoading: boolean;
  error: string | null;
}

export function useSidebarWorkflows(): SidebarWorkflowsState {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    workflowsApi
      .list({ limit: '5' })
      .then((res) => {
        if (!cancelled) setWorkflows(res.workflows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load workflows');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { workflows, isLoading, error };
}
