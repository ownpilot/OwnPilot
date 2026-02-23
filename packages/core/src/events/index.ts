/**
 * OwnPilot Event System - Public API
 *
 * Unified event and hook system. All event/hook operations go through
 * the EventSystem singleton.
 *
 * NEW API (typed, recommended):
 *   import { getEventSystem } from './events/index.js';
 *   const system = getEventSystem();
 *   system.emit('agent.complete', 'orchestrator', { ... }); // compile-time checked
 *   system.hooks.tap('tool:before-execute', handler);
 *   const scoped = system.scoped('channel', 'my-source');
 *
 * LEGACY API (backward compatible, still works):
 *   import { getEventBus, createEvent, EventTypes } from './events/index.js';
 *   const bus = getEventBus();
 *   bus.emit(createEvent('agent.complete', 'agent', 'orchestrator', data));
 */

// ============================================================================
// New API - Types
// ============================================================================

export type {
  EventCategory,
  TypedEvent,
  EventHandler,
  Unsubscribe,
  HookContext,
  HookHandler,
} from './types.js';

export { deriveCategory } from './types.js';

// ============================================================================
// New API - Event Map
// ============================================================================

export type { EventMap, EventType, EventPayload } from './event-map.js';

// Event data interfaces (re-export for convenience)
export type {
  AgentIterationData,
  AgentCompleteData,
  AgentErrorData,
  AgentToolCallData,
  AgentStepData,
  ToolRegisteredData,
  ToolUnregisteredData,
  ToolExecutedData,
  ResourceCreatedData,
  ResourceUpdatedData,
  ResourceDeletedData,
  PluginStatusData,
  PluginCustomData,
  SystemStartupData,
  SystemShutdownData,
  ChannelMessageEditedData,
  ChannelMessageDeletedData,
  ChannelReactionData,
  GatewayConnectionReadyData,
  GatewayConnectionErrorData,
  GatewayChannelConnectedData,
  GatewayChannelDisconnectedData,
  GatewayChannelStatusData,
  GatewayChannelMessageData,
  GatewayChatMessageData,
  GatewayChatStreamStartData,
  GatewayChatStreamChunkData,
  GatewayChatStreamEndData,
  GatewayChatErrorData,
  GatewayToolStartData,
  GatewayToolEndData,
  GatewayWorkspaceCreatedData,
  GatewayWorkspaceDeletedData,
  GatewaySystemNotificationData,
  GatewaySystemStatusData,
  MemoryCreatedData,
  MemoryUpdatedData,
  MemoryDeletedData,
  ExtensionInstalledData,
  ExtensionUninstalledData,
  ExtensionEnabledData,
  ExtensionDisabledData,
  McpServerConnectedData,
  McpServerDisconnectedData,
} from './event-map.js';

// ============================================================================
// New API - Hook Map
// ============================================================================

export type { HookMap, HookType, HookPayload } from './hook-map.js';

export type {
  ToolBeforeExecuteHookData,
  ToolAfterExecuteHookData,
  PluginBeforeLoadHookData,
  PluginAfterLoadHookData,
  PluginBeforeEnableHookData,
  PluginBeforeDisableHookData,
  PluginBeforeUnloadHookData,
  MessageBeforeProcessHookData,
  MessageAfterProcessHookData,
  AgentBeforeExecuteHookData,
  AgentAfterExecuteHookData,
  ClientChatSendHookData,
  ClientChatStopHookData,
  ClientChatRetryHookData,
  ClientChannelConnectHookData,
  ClientChannelDisconnectHookData,
  ClientChannelSendHookData,
  ClientWorkspaceCreateHookData,
  ClientWorkspaceDeleteHookData,
  ClientAgentConfigureHookData,
} from './hook-map.js';

// ============================================================================
// New API - Interfaces
// ============================================================================

export type { IEventBus } from './event-bus.js';
export type { IHookBus } from './hook-bus.js';
export type { IScopedBus, IScopedHookBus } from './scoped-bus.js';
export type { IEventSystem } from './event-system.js';

// ============================================================================
// New API - Singleton
// ============================================================================

export { getEventSystem, resetEventSystem } from './event-system.js';

// ============================================================================
// Legacy API - Backward Compatibility
// ============================================================================

import type { EventCategory, TypedEvent, EventHandler } from './types.js';
import type { IEventBus } from './event-bus.js';
import { getEventSystem, resetEventSystem } from './event-system.js';

// Re-export ToolSource for backward compat (was exported from old index.ts)
export type { ToolSource } from '../agent/types.js';

/**
 * Event type constants (preserved from old API).
 */
export const EventTypes = {
  // Agent
  AGENT_ITERATION: 'agent.iteration',
  AGENT_COMPLETE: 'agent.complete',
  AGENT_ERROR: 'agent.error',
  AGENT_TOOL_CALL: 'agent.tool_call',
  AGENT_STEP: 'agent.step',

  // Tool
  TOOL_REGISTERED: 'tool.registered',
  TOOL_UNREGISTERED: 'tool.unregistered',
  TOOL_EXECUTED: 'tool.executed',

  // Resource
  RESOURCE_CREATED: 'resource.created',
  RESOURCE_UPDATED: 'resource.updated',
  RESOURCE_DELETED: 'resource.deleted',

  // Plugin
  PLUGIN_STATUS: 'plugin.status',
  PLUGIN_CUSTOM: 'plugin.custom',

  // System
  SYSTEM_STARTUP: 'system.startup',
  SYSTEM_SHUTDOWN: 'system.shutdown',
} as const;

/**
 * Legacy IEventBus interface (preserved for backward compat).
 * This is the OLD interface shape where emit() takes a TypedEvent object.
 */
export interface ILegacyEventBus {
  emit<T>(event: TypedEvent<T>): void;
  on<T = unknown>(type: string, handler: EventHandler<T>): () => void;
  off(type: string, handler: EventHandler): void;
  onCategory(category: EventCategory, handler: EventHandler): () => void;
  onPattern(pattern: string, handler: EventHandler): () => void;
  clear(): void;
}

/**
 * Backward-compatible wrapper that presents the old IEventBus interface
 * while delegating to the new EventSystem.
 */
class LegacyEventBusWrapper implements ILegacyEventBus {
  constructor(private readonly system: IEventBus) {}

  emit<T>(event: TypedEvent<T>): void {
    this.system.emitRaw(event);
  }

  on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    return this.system.onAny(type, handler as EventHandler);
  }

  off(type: string, handler: EventHandler): void {
    this.system.off(type, handler);
  }

  onCategory(category: EventCategory, handler: EventHandler): () => void {
    return this.system.onCategory(category, handler);
  }

  onPattern(pattern: string, handler: EventHandler): () => void {
    return this.system.onPattern(pattern, handler);
  }

  clear(): void {
    this.system.clear();
  }
}

let legacyWrapper: LegacyEventBusWrapper | null = null;

/**
 * Get the global EventBus singleton (LEGACY API).
 *
 * Returns a backward-compatible wrapper that presents the old interface
 * where emit() takes a TypedEvent object. Internally delegates to the
 * new EventSystem.
 *
 * For new code, use getEventSystem() instead.
 */
export function getEventBus(): ILegacyEventBus {
  if (!legacyWrapper) {
    legacyWrapper = new LegacyEventBusWrapper(getEventSystem());
  }
  return legacyWrapper;
}

/**
 * Reset the global EventBus (LEGACY API).
 * For new code, use resetEventSystem() instead.
 */
export function resetEventBus(): void {
  resetEventSystem();
  legacyWrapper = null;
}

/**
 * Create a TypedEvent object (LEGACY API).
 * For new code, use system.emit(type, source, data) directly.
 */
export function createEvent<T>(
  type: string,
  category: EventCategory,
  source: string,
  data: T
): TypedEvent<T> {
  return {
    type,
    category,
    timestamp: new Date().toISOString(),
    source,
    data,
  };
}
