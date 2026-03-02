/**
 * useAgentStatus — WebSocket-based live status tracking for background agents
 */

import { useEffect, useCallback } from 'react';
import { useGateway } from '../../../hooks/useWebSocket';
import type { BackgroundAgentState } from '../../../api/endpoints/background-agents';

export interface AgentUpdatePayload {
  agentId: string;
  state: BackgroundAgentState;
  cyclesCompleted: number;
  totalToolCalls: number;
  lastCycleAt: string | null;
  lastCycleDurationMs: number | null;
  lastCycleError: string | null;
}

export function useAgentStatus(onUpdate: (payload: AgentUpdatePayload) => void): {
  isConnected: boolean;
} {
  const { subscribe, status } = useGateway();

  const stableOnUpdate = useCallback(onUpdate, [onUpdate]);

  useEffect(() => {
    const unsub = subscribe<AgentUpdatePayload>('background-agent:update', stableOnUpdate);
    return unsub;
  }, [subscribe, stableOnUpdate]);

  return { isConnected: status === 'connected' };
}
