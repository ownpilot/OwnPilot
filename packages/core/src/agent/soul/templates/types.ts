/**
 * Crew Template Types
 */

import type {
  SoulIdentity,
  SoulPurpose,
  SoulHeartbeat,
  SoulRelationships,
  CrewCoordinationPattern,
} from '../types.js';

/**
 * Template for a single agent within a crew.
 */
export interface AgentSoulTemplate {
  identity: SoulIdentity;
  purpose: SoulPurpose;
  heartbeat: SoulHeartbeat;
  relationships: Omit<SoulRelationships, 'crewId'>;
}

/**
 * Crew template defining a pre-configured set of collaborating agents.
 */
export interface CrewTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  coordinationPattern: CrewCoordinationPattern;
  agents: AgentSoulTemplate[];
  tags: string[];
}
