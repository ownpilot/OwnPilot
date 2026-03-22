/**
 * useAgentStatus — WebSocket-based live status tracking for autonomous agents
 */

import { useEffect, useRef } from 'react';
import { useGateway } from '../../../hooks/useWebSocket';

export interface AgentUpdatePayload {
  agentId: string;
  state: string;
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
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const unsubs = [
      subscribe<AgentUpdatePayload>('soul:heartbeat', (payload) =>
        onUpdateRef.current(payload)
      ),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  return { isConnected: status === 'connected' };
}
