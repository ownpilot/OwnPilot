/**
 * Event Map - Master Event Type Registry
 *
 * Maps every event type string to its payload type for compile-time safety.
 * All event data interfaces are defined here alongside the map.
 *
 * Convention: category.subcategory.action (dot-delimited)
 * The first segment determines the EventCategory.
 *
 * To add new events: add a new entry to EventMap, define the data interface,
 * and the entire system is immediately type-safe.
 */

import type { ToolSource } from '../agent/types.js';
import type {
  ChannelConnectionEventData,
  ChannelMessageReceivedData,
  ChannelMessageSendData,
  ChannelMessageSentData,
  ChannelMessageSendErrorData,
  ChannelUserFirstSeenData,
  ChannelUserVerifiedData,
  ChannelUserBlockedData,
  ChannelUserPendingData,
  ChannelTypingData,
} from '../channels/events.js';

// ============================================================================
// Agent Event Data
// ============================================================================

export interface AgentIterationData {
  agentId: string;
  iteration: number;
}

export interface AgentCompleteData {
  agentId: string;
  response?: string;
  iterationCount: number;
  duration: number;
}

export interface AgentErrorData {
  agentId: string;
  error: string;
  iteration: number;
}

export interface AgentToolCallData {
  agentId: string;
  toolName: string;
  args: unknown;
  duration: number;
  success: boolean;
  error?: string;
}

export interface AgentStepData {
  agentId: string;
  stepType: string;
  content: unknown;
}

// ============================================================================
// Tool Event Data
// ============================================================================

export { type ToolSource };

export interface ToolRegisteredData {
  name: string;
  source: ToolSource;
  pluginId?: string;
}

export interface ToolUnregisteredData {
  name: string;
}

export interface ToolExecutedData {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
  conversationId?: string;
}

// ============================================================================
// Resource Event Data
// ============================================================================

export interface ResourceCreatedData {
  resourceType: string;
  id: string;
  data?: unknown;
}

export interface ResourceUpdatedData {
  resourceType: string;
  id: string;
  changes?: unknown;
}

export interface ResourceDeletedData {
  resourceType: string;
  id: string;
}

// ============================================================================
// Plugin Event Data
// ============================================================================

export interface PluginStatusData {
  pluginId: string;
  oldStatus: string;
  newStatus: string;
}

export interface PluginCustomData {
  pluginId: string;
  event: string;
  data: unknown;
}

// ============================================================================
// System Event Data
// ============================================================================

export interface SystemStartupData {
  version: string;
}

export interface SystemShutdownData {
  reason?: string;
}

// ============================================================================
// Channel Event Data (additional types not in channels/events.ts)
// ============================================================================

export interface ChannelMessageEditedData {
  channelPluginId: string;
  platform: string;
  platformMessageId: string;
  platformChatId: string;
  newText: string;
}

export interface ChannelMessageDeletedData {
  channelPluginId: string;
  platform: string;
  platformMessageId: string;
  platformChatId: string;
}

export interface ChannelReactionData {
  channelPluginId: string;
  platform: string;
  platformMessageId: string;
  platformChatId: string;
  emoji: string;
  platformUserId: string;
}

// ============================================================================
// Gateway Event Data
// ============================================================================

export interface GatewayConnectionReadyData {
  sessionId: string;
}

export interface GatewayConnectionErrorData {
  code: string;
  message: string;
}

export interface GatewayChannelConnectedData {
  channel: {
    id: string;
    type: string;
    name: string;
    status: string;
    connectedAt?: string;
    config?: Record<string, unknown>;
  };
}

export interface GatewayChannelDisconnectedData {
  channelId: string;
  reason?: string;
}

export interface GatewayChannelStatusData {
  channelId: string;
  status: string;
  error?: string;
}

export interface GatewayChannelMessageData {
  message: {
    id: string;
    channelId: string;
    channelType: string;
    senderId: string;
    senderName?: string;
    content: string;
    timestamp: string;
  };
}

export interface GatewayChatMessageData {
  sessionId: string;
  message: {
    id: string;
    content: string;
    model?: string;
    provider?: string;
    timestamp: string;
  };
}

export interface GatewayChatStreamStartData {
  sessionId: string;
  messageId: string;
}

export interface GatewayChatStreamChunkData {
  sessionId: string;
  messageId: string;
  chunk: string;
}

export interface GatewayChatStreamEndData {
  sessionId: string;
  messageId: string;
  fullContent: string;
}

export interface GatewayChatErrorData {
  sessionId: string;
  error: string;
}

export interface GatewayToolStartData {
  sessionId: string;
  tool: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    status: string;
    startedAt: string;
  };
}

export interface GatewayToolEndData {
  sessionId: string;
  toolId: string;
  result: unknown;
  error?: string;
}

export interface GatewayWorkspaceCreatedData {
  workspace: {
    id: string;
    name: string;
    channels: string[];
    agentId?: string;
    createdAt: string;
  };
}

export interface GatewayWorkspaceDeletedData {
  workspaceId: string;
}

export interface GatewaySystemNotificationData {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  action?: string;
}

export interface GatewaySystemStatusData {
  online: boolean;
  version: string;
  uptime: number;
}

// ============================================================================
// Memory Event Data
// ============================================================================

export interface MemoryCreatedData {
  memoryId: string;
  userId: string;
  content: string;
  type: string;
  needsEmbedding: boolean;
}

export interface MemoryUpdatedData {
  memoryId: string;
  userId: string;
  content?: string;
  needsEmbedding?: boolean;
}

export interface MemoryDeletedData {
  memoryId: string;
  userId: string;
}

// ============================================================================
// Extension Event Data
// ============================================================================

export interface ExtensionInstalledData {
  extensionId: string;
  userId: string;
  name: string;
  format: string;
}

export interface ExtensionUninstalledData {
  extensionId: string;
  userId: string;
}

export interface ExtensionEnabledData {
  extensionId: string;
  userId: string;
  triggers?: number;
}

export interface ExtensionDisabledData {
  extensionId: string;
  userId: string;
  triggerIds?: string[];
}

// ============================================================================
// MCP Event Data
// ============================================================================

export interface McpServerConnectedData {
  serverName: string;
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
}

export interface McpServerDisconnectedData {
  serverName: string;
  reason?: string;
}

// ============================================================================
// Trigger Event Data
// ============================================================================

export interface TriggerFiredData {
  triggerId: string;
  triggerName: string;
  triggerType: 'schedule' | 'condition' | 'event';
  actionType: string;
  manual?: boolean;
}

export interface TriggerSuccessData {
  triggerId: string;
  triggerName: string;
  durationMs: number;
  actionType: string;
  result?: unknown;
}

export interface TriggerFailedData {
  triggerId: string;
  triggerName: string;
  durationMs: number;
  actionType: string;
  error: string;
}

// ============================================================================
// Pulse Event Data
// ============================================================================

export interface PulseStartedData {
  pulseId: string;
  userId: string;
}

export interface PulseStageData {
  pulseId: string;
  stage: 'gathering' | 'evaluating' | 'deciding' | 'reporting';
}

export interface PulseCompletedData {
  pulseId: string;
  userId: string;
  durationMs: number;
  signalsFound: number;
  actionsExecuted: number;
  llmCalled: boolean;
}

// ============================================================================
// Edge Event Data
// ============================================================================

export interface EdgeDeviceRegisteredData {
  deviceId: string;
  name: string;
  type: string;
  userId: string;
}

export interface EdgeDeviceRemovedData {
  deviceId: string;
  userId: string;
}

export interface EdgeDeviceStatusData {
  deviceId: string;
  status: 'online' | 'offline' | 'error';
  userId: string;
}

export interface EdgeTelemetryEventData {
  deviceId: string;
  sensorId: string;
  value: unknown;
  userId: string;
}

export interface EdgeCommandSentData {
  commandId: string;
  deviceId: string;
  commandType: string;
  userId: string;
}

export interface EdgeCommandCompletedData {
  commandId: string;
  deviceId: string;
  status: string;
  userId: string;
}

// ============================================================================
// Chat Event Data
// ============================================================================

export interface ChatCompletedData {
  userId: string;
  conversationId: string;
  messageLength: number;
  responseLength: number;
  toolCallsUsed: number;
}

// ============================================================================
// Soul Event Data
// ============================================================================

export interface SoulCreatedData {
  soulId: string;
  agentId: string;
  name: string;
}

export interface SoulUpdatedData {
  soulId: string;
  agentId: string;
  version: number;
}

export interface SoulDeletedData {
  soulId: string;
  agentId: string;
}

export interface SoulHeartbeatCompletedData {
  agentId: string;
  soulVersion: number;
  tasksRun: number;
  tasksFailed: number;
  cost: number;
}

export interface SoulMessageSentData {
  messageId: string;
  from: string;
  to: string;
  type: string;
  subject: string;
}

export interface SoulCrewDeployedData {
  crewId: string;
  templateId: string;
  agentCount: number;
}

export interface SoulCrewStatusChangedData {
  crewId: string;
  status: string;
}

// --- Crew Task Events ---
export interface CrewTaskCreatedData {
  crewId: string;
  taskId: string;
  taskName: string;
  priority: string;
  delegatedTo: string;
  createdBy: string;
}

export interface CrewTaskClaimedData {
  crewId: string;
  taskId: string;
  taskName: string;
  claimedBy: string;
}

export interface CrewTaskCompletedData {
  crewId: string;
  taskId: string;
  taskName: string;
  submittedBy: string;
  result?: string;
}

export interface CrewTaskFailedData {
  crewId: string;
  taskId: string;
  taskName: string;
  submittedBy: string;
  result?: string;
}

// --- Audit Events ---
// Forensic / security-relevant operations. Emitted for incident response,
// not for normal application flow. Subscribers: audit log writer, alerting.

export interface AuditAuthLoginFailedData {
  ip: string;
  attempts: number;
  lockedOut: boolean;
}

export interface AuditAuthLoginSucceededData {
  ip: string;
}

export interface AuditAuthLogoutData {
  ip: string;
}

export interface AuditAuthPasswordChangedData {
  ip: string;
}

export interface AuditAuthPasswordSetData {
  ip: string;
}

export interface AuditAuthPasswordRemovedData {
  ip: string;
}

export interface AuditSecurityPrivescBlockedData {
  reason: string;
  ip: string;
}

export interface AuditExtensionInstalledData {
  ip: string;
  extensionId: string;
  source: string;
  userId: string;
}

export interface AuditExtensionUninstalledData {
  ip: string;
  extensionId: string;
  userId: string;
}

export interface AuditExtensionEnabledData {
  ip: string;
  extensionId: string;
  userId: string;
}

export interface AuditExtensionDisabledData {
  ip: string;
  extensionId: string;
  userId: string;
}

export interface AuditPluginEnabledData {
  ip: string;
  pluginId: string;
  pluginName: string;
  permissions: string[];
}

export interface AuditPluginDisabledData {
  ip: string;
  pluginId: string;
  pluginName: string;
}

export interface AuditPluginConfigChangedData {
  ip: string;
  pluginId: string;
  pluginName: string;
  /** Key names only — values are NOT logged (may contain secrets). */
  changedKeys: string[];
}

export interface AuditDatabaseBackupStartedData {
  ip: string;
}

export interface AuditDatabaseRestoreStartedData {
  ip: string;
  filename: string;
}

export interface AuditDatabaseBackupDeletedData {
  ip: string;
  filename: string;
}

// --- Claw Events ---
// Autonomous claw runtime communication channel.

export interface ClawOutputData {
  clawId: string;
  /** Optional fields — present for message vs report variants */
  message?: string;
  /** Free-form urgency string set by the caller; common values 'low'/'medium'/'high'. */
  urgency?: string;
  type?: 'report';
  title?: string;
  summary?: string;
  artifactId?: string;
  timestamp: string;
}

export interface ClawUpdateData {
  clawId: string;
  status?: string;
  cycle?: number;
  [key: string]: unknown;
}

// ============================================================================
// Agentic Event Data
// ============================================================================

export interface AgenticStepStartData {
  stepIndex: number;
  executorKind: string;
  capabilityId: string;
}

export interface AgenticStepCompleteData {
  stepIndex: number;
  executorKind: string;
  capabilityId: string;
  durationMs: number;
  costUsd?: number;
  error?: string;
}

export interface AgenticStepFailData {
  stepIndex: number;
  executorKind: string;
  capabilityId: string;
  durationMs: number;
  error: string;
}

// ============================================================================
// Master Event Map
// ============================================================================

/**
 * Maps every event type string to its payload type.
 * This provides compile-time type safety for emit() and on() calls.
 */
export interface EventMap {
  // --- Agent Events ---
  'agent.iteration': AgentIterationData;
  'agent.complete': AgentCompleteData;
  'agent.error': AgentErrorData;
  'agent.tool_call': AgentToolCallData;
  'agent.step': AgentStepData;

  // --- Tool Events ---
  'tool.registered': ToolRegisteredData;
  'tool.unregistered': ToolUnregisteredData;
  'tool.executed': ToolExecutedData;

  // --- Resource Events ---
  'resource.created': ResourceCreatedData;
  'resource.updated': ResourceUpdatedData;
  'resource.deleted': ResourceDeletedData;

  // --- Plugin Events ---
  'plugin.status': PluginStatusData;
  'plugin.custom': PluginCustomData;

  // --- System Events ---
  'system.startup': SystemStartupData;
  'system.shutdown': SystemShutdownData;

  // --- Channel Events ---
  'channel.connecting': ChannelConnectionEventData;
  'channel.connected': ChannelConnectionEventData;
  'channel.disconnected': ChannelConnectionEventData;
  'channel.reconnecting': ChannelConnectionEventData;
  'channel.error': ChannelConnectionEventData;
  'channel.message.received': ChannelMessageReceivedData;
  'channel.message.send': ChannelMessageSendData;
  'channel.message.sent': ChannelMessageSentData;
  'channel.message.send_error': ChannelMessageSendErrorData;
  'channel.message.edited': ChannelMessageEditedData;
  'channel.message.deleted': ChannelMessageDeletedData;
  'channel.user.first_seen': ChannelUserFirstSeenData;
  'channel.user.verified': ChannelUserVerifiedData;
  'channel.user.blocked': ChannelUserBlockedData;
  'channel.user.unblocked': ChannelUserBlockedData;
  'channel.user.pending': ChannelUserPendingData;
  'channel.typing': ChannelTypingData;
  'channel.reaction.added': ChannelReactionData;

  // --- Memory Events ---
  'memory.created': MemoryCreatedData;
  'memory.updated': MemoryUpdatedData;
  'memory.deleted': MemoryDeletedData;

  // --- Extension Events ---
  'extension.installed': ExtensionInstalledData;
  'extension.uninstalled': ExtensionUninstalledData;
  'extension.enabled': ExtensionEnabledData;
  'extension.disabled': ExtensionDisabledData;

  // --- MCP Events ---
  'mcp.server.connected': McpServerConnectedData;
  'mcp.server.disconnected': McpServerDisconnectedData;

  // --- Gateway Events ---
  'gateway.connection.ready': GatewayConnectionReadyData;
  'gateway.connection.error': GatewayConnectionErrorData;
  'gateway.channel.connected': GatewayChannelConnectedData;
  'gateway.channel.disconnected': GatewayChannelDisconnectedData;
  'gateway.channel.status': GatewayChannelStatusData;
  'gateway.channel.message': GatewayChannelMessageData;
  'gateway.chat.message': GatewayChatMessageData;
  'gateway.chat.stream.start': GatewayChatStreamStartData;
  'gateway.chat.stream.chunk': GatewayChatStreamChunkData;
  'gateway.chat.stream.end': GatewayChatStreamEndData;
  'gateway.chat.error': GatewayChatErrorData;
  'gateway.tool.start': GatewayToolStartData;
  'gateway.tool.end': GatewayToolEndData;
  'gateway.workspace.created': GatewayWorkspaceCreatedData;
  'gateway.workspace.deleted': GatewayWorkspaceDeletedData;
  'gateway.system.notification': GatewaySystemNotificationData;
  'gateway.system.status': GatewaySystemStatusData;

  // --- Trigger Events ---
  'trigger.fired': TriggerFiredData;
  'trigger.success': TriggerSuccessData;
  'trigger.failed': TriggerFailedData;

  // --- Pulse Events ---
  'pulse.started': PulseStartedData;
  'pulse.stage': PulseStageData;
  'pulse.completed': PulseCompletedData;

  // --- Edge Events ---
  'edge.device.registered': EdgeDeviceRegisteredData;
  'edge.device.removed': EdgeDeviceRemovedData;
  'edge.device.status': EdgeDeviceStatusData;
  'edge.telemetry': EdgeTelemetryEventData;
  'edge.command.sent': EdgeCommandSentData;
  'edge.command.completed': EdgeCommandCompletedData;

  // --- Chat Events ---
  'chat.completed': ChatCompletedData;

  // --- Soul Events ---
  'soul.created': SoulCreatedData;
  'soul.updated': SoulUpdatedData;
  'soul.deleted': SoulDeletedData;
  'soul.heartbeat.completed': SoulHeartbeatCompletedData;
  'soul.message.sent': SoulMessageSentData;
  'soul.crew.deployed': SoulCrewDeployedData;
  'soul.crew.status_changed': SoulCrewStatusChangedData;

  // --- Crew Task Events ---
  'crew.task.created': CrewTaskCreatedData;
  'crew.task.claimed': CrewTaskClaimedData;
  'crew.task.completed': CrewTaskCompletedData;
  'crew.task.failed': CrewTaskFailedData;

  // --- Audit Events ---
  'audit.auth.loginFailed': AuditAuthLoginFailedData;
  'audit.auth.loginSucceeded': AuditAuthLoginSucceededData;
  'audit.auth.logout': AuditAuthLogoutData;
  'audit.auth.passwordChanged': AuditAuthPasswordChangedData;
  'audit.auth.passwordSet': AuditAuthPasswordSetData;
  'audit.auth.passwordRemoved': AuditAuthPasswordRemovedData;
  'audit.security.privesc_blocked': AuditSecurityPrivescBlockedData;
  'audit.extension.installed': AuditExtensionInstalledData;
  'audit.extension.uninstalled': AuditExtensionUninstalledData;
  'audit.extension.enabled': AuditExtensionEnabledData;
  'audit.extension.disabled': AuditExtensionDisabledData;
  'audit.plugin.enabled': AuditPluginEnabledData;
  'audit.plugin.disabled': AuditPluginDisabledData;
  'audit.plugin.configChanged': AuditPluginConfigChangedData;
  'audit.database.backupStarted': AuditDatabaseBackupStartedData;
  'audit.database.restoreStarted': AuditDatabaseRestoreStartedData;
  'audit.database.backupDeleted': AuditDatabaseBackupDeletedData;

  // --- Claw Events ---
  'claw.output': ClawOutputData;
  'claw.update': ClawUpdateData;

  // --- Agentic Events ---
  'agentic.step.start': AgenticStepStartData;
  'agentic.step.complete': AgenticStepCompleteData;
  'agentic.step.fail': AgenticStepFailData;
}

// ============================================================================
// Helper Types
// ============================================================================

/** All registered event type strings */
export type EventType = keyof EventMap;

/** Get the payload type for a given event type */
export type EventPayload<K extends EventType> = EventMap[K];
