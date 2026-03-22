/**
 * useAgents — loads soul-based agents into a unified list
 */

import { useState, useEffect, useCallback } from 'react';
import { soulsApi, crewsApi } from '../../../api/endpoints/souls';
import type { AgentSoul, AgentCrew } from '../../../api/endpoints/souls';
import { fromSoul } from '../types';
import type { UnifiedAgent } from '../types';

export interface UseAgentsResult {
  agents: UnifiedAgent[];
  souls: AgentSoul[];
  crews: AgentCrew[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAgents(): UseAgentsResult {
  const [souls, setSouls] = useState<AgentSoul[]>([]);
  const [crews, setCrews] = useState<AgentCrew[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [soulsData, crewsData] = await Promise.allSettled([
        soulsApi.list(),
        crewsApi.list(),
      ]);

      if (soulsData.status === 'fulfilled') setSouls(soulsData.value.items);
      if (crewsData.status === 'fulfilled') setCrews(crewsData.value.items);

      const failures: string[] = [];
      if (soulsData.status === 'rejected') failures.push('souls');
      if (crewsData.status === 'rejected') failures.push('crews');
      setError(failures.length > 0 ? `Failed to load: ${failures.join(', ')}` : null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Build unified agent list from souls
  const agents: UnifiedAgent[] = [];

  for (const soul of souls) {
    agents.push(fromSoul(soul, crews));
  }

  // Sort: running first, then by name
  agents.sort((a, b) => {
    const statusOrder: Record<string, number> = {
      running: 0,
      starting: 1,
      waiting: 2,
      paused: 3,
      idle: 4,
      error: 5,
      stopped: 6,
    };
    const diff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  return {
    agents,
    souls,
    crews,
    isLoading,
    isRefreshing,
    error,
    refresh: fetchAll,
  };
}
