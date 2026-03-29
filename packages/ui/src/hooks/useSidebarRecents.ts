/**
 * useSidebarRecents — fetches the 6 most recent conversations for sidebar display.
 *
 * Fires chatApi.listHistory({ limit: 6 }) on mount.
 * Cancellation-safe: ignores results if component unmounts before response.
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../api';
import type { Conversation } from '../api/types';

export interface SidebarRecentsState {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | null;
}

export function useSidebarRecents(): SidebarRecentsState {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    chatApi
      .listHistory({ limit: 6 })
      .then((res) => {
        if (!cancelled) setConversations(res.conversations);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load recents');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search]);

  return { conversations, isLoading, error };
}
