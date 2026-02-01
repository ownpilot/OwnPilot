/**
 * Hook Map - Master Hook Type Registry
 *
 * Maps every hook type string to its context data type for compile-time safety.
 * Hooks are interceptable, sequential operations - unlike fire-and-forget events.
 *
 * Convention: category:action (colon-delimited, distinguishing from dot-delimited events)
 * e.g. 'tool:before-execute', 'plugin:before-load', 'client:chat:send'
 */

import type { ToolSource, ToolTrustLevel } from '../agent/types.js';

// ============================================================================
// Tool Hooks (replaces ToolMiddleware before/after)
// ============================================================================

export interface ToolBeforeExecuteHookData {
  toolName: string;
  args: Record<string, unknown>;
  conversationId?: string;
  userId?: string;
  source?: ToolSource;
  trustLevel?: ToolTrustLevel;
  pluginId?: string;
}

export interface ToolAfterExecuteHookData {
  toolName: string;
  args: Record<string, unknown>;
  result: {
    content: unknown;
    isError?: boolean;
    metadata?: Record<string, unknown>;
  };
  conversationId?: string;
  userId?: string;
  source?: ToolSource;
  trustLevel?: ToolTrustLevel;
  pluginId?: string;
}

// ============================================================================
// Plugin Lifecycle Hooks
// ============================================================================

export interface PluginBeforeLoadHookData {
  pluginId: string;
  manifest: unknown;
}

export interface PluginAfterLoadHookData {
  pluginId: string;
  success: boolean;
  error?: string;
}

export interface PluginBeforeEnableHookData {
  pluginId: string;
}

export interface PluginBeforeDisableHookData {
  pluginId: string;
}

export interface PluginBeforeUnloadHookData {
  pluginId: string;
}

// ============================================================================
// Message Processing Hooks
// ============================================================================

export interface MessageBeforeProcessHookData {
  content: string;
  channelId?: string;
  senderId?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageAfterProcessHookData {
  content: string;
  response?: string;
  channelId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Agent Hooks
// ============================================================================

export interface AgentBeforeExecuteHookData {
  agentId: string;
  userMessage: string;
  systemPrompt: string;
}

export interface AgentAfterExecuteHookData {
  agentId: string;
  response?: string;
  error?: string;
}

// ============================================================================
// Client Event Hooks (replaces ClientEventHandler)
// ============================================================================

export interface ClientChatSendHookData {
  content: string;
  channelId?: string;
  replyToId?: string;
  workspaceId?: string;
  sessionId?: string;
  response?: unknown;
}

export interface ClientChatStopHookData {
  messageId?: string;
  sessionId?: string;
}

export interface ClientChatRetryHookData {
  messageId: string;
  sessionId?: string;
}

export interface ClientChannelConnectHookData {
  type: string;
  config: Record<string, unknown>;
  sessionId?: string;
}

export interface ClientChannelDisconnectHookData {
  channelId: string;
  sessionId?: string;
}

export interface ClientChannelSendHookData {
  message: {
    channelId: string;
    content: string;
    replyToId?: string;
    metadata?: Record<string, unknown>;
  };
  sessionId?: string;
}

export interface ClientWorkspaceCreateHookData {
  name: string;
  channels?: string[];
  sessionId?: string;
  response?: unknown;
}

export interface ClientWorkspaceDeleteHookData {
  workspaceId: string;
  sessionId?: string;
}

export interface ClientAgentConfigureHookData {
  provider: string;
  model: string;
  systemPrompt?: string;
  sessionId?: string;
}

// ============================================================================
// Master Hook Map
// ============================================================================

/**
 * Maps every hook type string to its context data type.
 * This provides compile-time type safety for tap() and call() methods.
 */
export interface HookMap {
  // --- Tool Hooks ---
  'tool:before-execute': ToolBeforeExecuteHookData;
  'tool:after-execute': ToolAfterExecuteHookData;

  // --- Plugin Lifecycle Hooks ---
  'plugin:before-load': PluginBeforeLoadHookData;
  'plugin:after-load': PluginAfterLoadHookData;
  'plugin:before-enable': PluginBeforeEnableHookData;
  'plugin:before-disable': PluginBeforeDisableHookData;
  'plugin:before-unload': PluginBeforeUnloadHookData;

  // --- Message Processing Hooks ---
  'message:before-process': MessageBeforeProcessHookData;
  'message:after-process': MessageAfterProcessHookData;

  // --- Agent Hooks ---
  'agent:before-execute': AgentBeforeExecuteHookData;
  'agent:after-execute': AgentAfterExecuteHookData;

  // --- Client Event Hooks ---
  'client:chat:send': ClientChatSendHookData;
  'client:chat:stop': ClientChatStopHookData;
  'client:chat:retry': ClientChatRetryHookData;
  'client:channel:connect': ClientChannelConnectHookData;
  'client:channel:disconnect': ClientChannelDisconnectHookData;
  'client:channel:send': ClientChannelSendHookData;
  'client:workspace:create': ClientWorkspaceCreateHookData;
  'client:workspace:delete': ClientWorkspaceDeleteHookData;
  'client:agent:configure': ClientAgentConfigureHookData;
}

// ============================================================================
// Helper Types
// ============================================================================

/** All registered hook type strings */
export type HookType = keyof HookMap;

/** Get the payload type for a given hook type */
export type HookPayload<K extends HookType> = HookMap[K];
