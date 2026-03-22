/**
 * Unified Agent Types
 *
 * Unified agent types for the Autonomous Hub.
 */

import type { AgentSoul, AgentCrew } from '../../api/endpoints/souls';

export type AgentKind = 'soul';

export type AgentStatus =
  | 'running'
  | 'paused'
  | 'idle'
  | 'error'
  | 'stopped'
  | 'starting'
  | 'waiting';

export interface UnifiedAgent {
  id: string;
  kind: AgentKind;
  name: string;
  emoji: string;
  role: string;
  mission: string;
  status: AgentStatus;
  crewId?: string;
  crewName?: string;
  lastActiveAt?: string;
  todayCost: number;
  unreadMessages: number;
  heartbeatEnabled?: boolean;

  // Source data for detail views
  soul?: AgentSoul;
}

export type HubTab = 'home' | 'agents' | 'crews' | 'messages' | 'activity' | 'plans';
export type ProfileTab = 'overview' | 'soul' | 'tools' | 'messages' | 'activity' | 'budget';

/** Build a UnifiedAgent from a soul */
export function fromSoul(soul: AgentSoul, crews: AgentCrew[]): UnifiedAgent {
  const crew = soul.relationships?.crewId
    ? crews.find((c) => c.id === soul.relationships.crewId)
    : undefined;
  return {
    id: soul.agentId,
    kind: 'soul',
    name: soul.identity.name,
    emoji: soul.identity.emoji,
    role: soul.identity.role,
    mission: soul.purpose.mission,
    status: soul.heartbeat.enabled ? 'running' : 'idle',
    crewId: soul.relationships?.crewId,
    crewName: crew?.name,
    lastActiveAt: soul.updatedAt,
    todayCost: 0,
    unreadMessages: 0,
    heartbeatEnabled: soul.heartbeat.enabled,
    soul,
  };
}

