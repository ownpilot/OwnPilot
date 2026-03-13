/**
 * Agent Soul System — Barrel Export
 *
 * Provides persistent identity, heartbeat automation,
 * inter-agent communication, soul evolution, and crew management.
 */

// Types
export type {
  AgentSoul,
  SoulIdentity,
  SoulVoice,
  SoulPurpose,
  SoulAutonomy,
  ClawModeConfig,
  SoulHeartbeat,
  QuietHours,
  HeartbeatTask,
  HeartbeatOutput,
  SoulRelationships,
  SoulEvolution,
  SoulFeedback,
  SoulBootSequence,
  HeartbeatResult,
  HeartbeatTaskResult,
  AgentCrew,
  CrewCoordinationPattern,
  CrewStatus,
  CrewMember,
  CrewStatusReport,
  CrewAgentStatus,
  SoulVersion,
} from './types.js';

// Communication Types
export type {
  AgentMessageType,
  MessagePriority,
  MessageStatus,
  AgentMessage,
  AgentAttachment,
  MessageQueryOptions,
  IAgentCommunicationBus,
} from './communication.js';

// Builder
export { buildSoulPrompt, estimateSoulTokens } from './builder.js';
export type { SoulMemoryRef } from './builder.js';

// Communication Bus
export { AgentCommunicationBus } from './communication-bus.js';
export type { IAgentMessageRepository, ICommunicationEventBus } from './communication-bus.js';

// Budget Tracker
export { BudgetTracker } from './budget-tracker.js';
export type { IBudgetDatabase } from './budget-tracker.js';

// Heartbeat Runner
export { HeartbeatRunner } from './heartbeat-runner.js';
export type { IHeartbeatAgentEngine, IHeartbeatEventBus } from './heartbeat-runner.js';

// Evolution Engine
export { SoulEvolutionEngine } from './evolution.js';
export type {
  ISoulRepository,
  IHeartbeatLogRepository,
  HeartbeatLogEntry,
  IReflectionEngine,
} from './evolution.js';

// Crew Manager
export { CrewManager } from './crew-manager.js';
export type { ICrewRepository, IAgentRepository, ITriggerRepository } from './crew-manager.js';

// Crew Orchestrator
export { buildCrewContextSection, COORDINATION_GUIDANCE } from './crew-orchestrator.js';
export type { CrewMemberInfo, CrewContextInfo } from './crew-orchestrator.js';

// Templates
export { getCrewTemplate, listCrewTemplates } from './templates/index.js';
export type { CrewTemplate, AgentSoulTemplate } from './templates/index.js';
