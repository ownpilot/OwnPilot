/**
 * useAgents — merges soul-based and background agents into a unified list
 */

import { useState, useEffect, useCallback } from 'react';
import { soulsApi, crewsApi } from '../../../api/endpoints/souls';
import type { AgentSoul, AgentCrew } from '../../../api/endpoints/souls';
import { backgroundAgentsApi } from '../../../api/endpoints/background-agents';
import type { BackgroundAgentConfig } from '../../../api/endpoints/background-agents';
import { fromSoul, fromBackground } from '../types';
import type { UnifiedAgent } from '../types';

export interface UseAgentsResult {
  agents: UnifiedAgent[];
  souls: AgentSoul[];
  backgroundAgents: BackgroundAgentConfig[];
  crews: AgentCrew[];
  isLoading: boolean;
  refresh: () => void;
}

export function useAgents(): UseAgentsResult {
  const [souls, setSouls] = useState<AgentSoul[]>([]);
  const [backgroundAgents, setBackgroundAgents] = useState<BackgroundAgentConfig[]>([]);
  const [crews, setCrews] = useState<AgentCrew[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [soulsData, bgData, crewsData] = await Promise.allSettled([
        soulsApi.list(),
        backgroundAgentsApi.list(),
        crewsApi.list(),
      ]);

      if (soulsData.status === 'fulfilled') setSouls(soulsData.value.items);
      if (bgData.status === 'fulfilled') setBackgroundAgents(bgData.value);
      if (crewsData.status === 'fulfilled') setCrews(crewsData.value.items);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Merge into unified agent list, deduplicate by ID
  const agents: UnifiedAgent[] = [];
  const soulAgentIds = new Set<string>();

  for (const soul of souls) {
    soulAgentIds.add(soul.agentId);
    agents.push(fromSoul(soul, crews));
  }

  for (const bg of backgroundAgents) {
    if (!soulAgentIds.has(bg.id)) {
      agents.push(fromBackground(bg));
    }
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
    backgroundAgents,
    crews,
    isLoading,
    refresh: fetchAll,
  };
}
