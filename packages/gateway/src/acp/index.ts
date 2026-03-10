/**
 * ACP (Agent Client Protocol) Module
 *
 * Provides OwnPilot's ACP client for communicating with CLI coding agents
 * (Claude Code, Gemini CLI, Codex) via the standardized ACP protocol.
 */

export { AcpClient } from './acp-client.js';
export { createAcpClientHandler } from './acp-handlers.js';
export { mapSessionNotification, mapSessionUpdate, type MappedAcpEvent } from './acp-event-mapper.js';
export { isAcpSupported, buildAcpArgs, getAcpBinary } from './acp-provider-support.js';
export type {
  AcpConnectionState,
  AcpSession,
  AcpToolCall,
  AcpToolCallContent,
  AcpToolCallLocation,
  AcpPlan,
  AcpPlanEntry,
  AcpEventType,
  AcpEventBase,
  AcpToolCallEvent,
  AcpToolUpdateEvent,
  AcpPlanEvent,
  AcpMessageEvent,
  AcpThoughtEvent,
  AcpCompleteEvent,
  AcpPermissionRequestEvent,
  AcpClientOptions,
  AcpMcpServerConfig,
  AcpPermissionResponse,
} from './types.js';
