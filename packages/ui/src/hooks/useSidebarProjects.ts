/**
 * useSidebarProjects — fetches the 5 most recent file workspaces (projects) for sidebar display.
 *
 * Fires fileWorkspacesApi.list() on mount and takes the first 5.
 * Cancellation-safe: ignores results if component unmounts before response.
 */
import { useState, useEffect } from 'react';
import { fileWorkspacesApi } from '../api';
import type { FileWorkspaceInfo } from '../api/types';

export interface SidebarProjectsState {
  projects: FileWorkspaceInfo[];
  isLoading: boolean;
  error: string | null;
}

export function useSidebarProjects(): SidebarProjectsState {
  const [projects, setProjects] = useState<FileWorkspaceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fileWorkspacesApi
      .list()
      .then((res) => {
        if (!cancelled) setProjects(res.workspaces.slice(0, 5));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load projects');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, isLoading, error };
}
