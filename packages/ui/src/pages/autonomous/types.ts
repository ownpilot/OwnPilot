/**
 * Unified Agent Types
 *
 * Merges soul-based agents and background agents into a single
 * type for the Autonomous Hub.
 */

import type { AgentSoul, AgentCrew } from '../../api/endpoints/souls';
import type {
  BackgroundAgentConfig,
  BackgroundAgentState,
} from '../../api/endpoints/background-agents';

export type AgentKind = 'soul' | 'background';

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
  backgroundAgent?: BackgroundAgentConfig;
}

export type HubTab = 'agents' | 'crews' | 'messages' | 'activity';
export type ProfileTab = 'overview' | 'soul' | 'messages' | 'activity' | 'budget';

/** Map background agent state to unified agent status */
export function mapBackgroundState(state: BackgroundAgentState): AgentStatus {
  const map: Record<BackgroundAgentState, AgentStatus> = {
    starting: 'starting',
    running: 'running',
    paused: 'paused',
    waiting: 'waiting',
    completed: 'idle',
    failed: 'error',
    stopped: 'stopped',
  };
  return map[state] || 'idle';
}

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
    todayCost: 0,
    unreadMessages: 0,
    heartbeatEnabled: soul.heartbeat.enabled,
    soul,
  };
}

/** Build a UnifiedAgent from a background agent config */
export function fromBackground(bg: BackgroundAgentConfig): UnifiedAgent {
  return {
    id: bg.id,
    kind: 'background',
    name: bg.name,
    emoji: '🤖',
    role: 'Background Agent',
    mission: bg.mission,
    status: bg.session ? mapBackgroundState(bg.session.state) : 'stopped',
    lastActiveAt: bg.session?.lastCycleAt ?? undefined,
    todayCost: bg.session?.totalCostUsd ?? 0,
    unreadMessages: 0,
    backgroundAgent: bg,
  };
}
