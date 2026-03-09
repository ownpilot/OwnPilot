/**
 * MCP Tool Call Event Bus
 *
 * Enables real-time tracking of tool calls made through the MCP server.
 * When CLI tools (Claude, Gemini, Codex) call OwnPilot tools via MCP,
 * events are emitted here so the chat SSE stream can forward them to the UI.
 *
 * Correlation is done via a `correlationId` query parameter in the MCP URL.
 * Each CLI chat session gets a unique correlationId in its .mcp.json config.
 */

import { EventEmitter } from 'node:events';

// =============================================================================
// Types
// =============================================================================

export interface McpToolEvent {
  type: 'tool_start' | 'tool_end';
  correlationId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  result?: {
    success: boolean;
    preview: string;
    durationMs?: number;
  };
  timestamp: string;
}

// =============================================================================
// Event Bus
// =============================================================================

const bus = new EventEmitter();
bus.setMaxListeners(200);

/**
 * Emit a tool call event from the MCP server.
 */
export function emitMcpToolEvent(event: McpToolEvent): void {
  bus.emit(`tool:${event.correlationId}`, event);
}

/**
 * Subscribe to tool call events for a specific correlation ID.
 * Returns an unsubscribe function.
 */
export function onMcpToolEvents(
  correlationId: string,
  handler: (event: McpToolEvent) => void
): () => void {
  const channel = `tool:${correlationId}`;
  bus.on(channel, handler);
  return () => {
    bus.off(channel, handler);
  };
}
