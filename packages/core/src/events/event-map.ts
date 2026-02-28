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
}

// ============================================================================
// Background Agent Event Data
// ============================================================================

export interface BackgroundAgentStartedData {
  agentId: string;
  userId: string;
  name: string;
}

export interface BackgroundAgentCycleStartData {
  agentId: string;
  cycleNumber: number;
}

export interface BackgroundAgentCycleCompleteData {
  agentId: string;
  cycleNumber: number;
  success: boolean;
  toolCallsCount: number;
  durationMs: number;
  outputPreview: string;
}

export interface BackgroundAgentStoppedData {
  agentId: string;
  userId: string;
  reason: 'user' | 'completed' | 'failed' | 'budget_exceeded';
}

export interface BackgroundAgentErrorData {
  agentId: string;
  error: string;
  cycleNumber: number;
}

export interface BackgroundAgentPausedData {
  agentId: string;
}

export interface BackgroundAgentResumedData {
  agentId: string;
}

export interface BackgroundAgentMessageData {
  agentId: string;
  from: string;
  content: string;
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

  // --- Background Agent Events ---
  'background-agent.started': BackgroundAgentStartedData;
  'background-agent.cycle.start': BackgroundAgentCycleStartData;
  'background-agent.cycle.complete': BackgroundAgentCycleCompleteData;
  'background-agent.stopped': BackgroundAgentStoppedData;
  'background-agent.error': BackgroundAgentErrorData;
  'background-agent.paused': BackgroundAgentPausedData;
  'background-agent.resumed': BackgroundAgentResumedData;
  'background-agent.message': BackgroundAgentMessageData;
}

// ============================================================================
// Helper Types
// ============================================================================

/** All registered event type strings */
export type EventType = keyof EventMap;

/** Get the payload type for a given event type */
export type EventPayload<K extends EventType> = EventMap[K];
