/**
 * WebSocket Gateway Types
 *
 * Central control plane for real-time communication
 */

/**
 * Session representing a connected client
 */
export interface Session {
  readonly id: string;
  readonly userId?: string;
  readonly connectedAt: Date;
  readonly lastActivityAt: Date;
  readonly channels: Set<string>;
  readonly metadata: Record<string, unknown>;
}

/**
 * Channel platform identifier.
 * Open string type — channels are now dynamic plugins.
 */
export type ChannelType = string;

/**
 * Channel connection status
 */
export type ChannelStatus = string;

/**
 * Channel info
 */
export interface Channel {
  readonly id: string;
  readonly type: ChannelType;
  readonly name: string;
  readonly status: ChannelStatus;
  readonly connectedAt?: Date;
  readonly error?: string;
  readonly config: Record<string, unknown>;
}

/**
 * Channel message (incoming or outgoing) broadcast via WebSocket
 */
export interface IncomingMessage {
  readonly id: string;
  readonly channelId: string;
  readonly channelType: ChannelType;
  readonly senderId: string;
  readonly senderName?: string;
  readonly content: string;
  readonly timestamp: Date | string;
  readonly direction?: 'incoming' | 'outgoing';
  readonly replyToId?: string;
  readonly attachments?: Attachment[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Outgoing message to a channel
 */
export interface OutgoingMessage {
  readonly channelId: string;
  readonly content: string;
  readonly replyToId?: string;
  readonly attachments?: Attachment[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Message attachment
 */
export interface Attachment {
  readonly type: 'image' | 'file' | 'audio' | 'video';
  readonly url?: string;
  readonly data?: Uint8Array;
  readonly mimeType: string;
  readonly filename?: string;
  readonly size?: number;
}

/**
 * Tool execution info
 */
export interface ToolExecution {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly status: 'pending' | 'running' | 'success' | 'error';
  readonly result?: unknown;
  readonly error?: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
}

/**
 * Agent state
 */
export type AgentState = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';

/**
 * Agent info
 */
export interface AgentInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly state: AgentState;
  readonly currentTask?: string;
}

/**
 * Workspace info
 */
export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly channels: string[];
  readonly agentId?: string;
  readonly createdAt: Date;
}

/**
 * Gateway events (server to client)
 */
export interface ServerEvents {
  // Connection events
  'connection:ready': { sessionId: string };
  'connection:error': { code: string; message: string };
  'connection:ping': { timestamp: number };

  // Channel events
  'channel:connected': { channel: Channel };
  'channel:disconnected': { channelId: string; reason?: string };
  'channel:status': { channelId: string; status: ChannelStatus; error?: string };
  'channel:message': { message: IncomingMessage };
  'channel:message:sent': { channelId: string; messageId: string };
  'channel:message:error': { channelId: string; error: string };

  // Chat events
  'chat:message': { sessionId: string; message: AssistantMessage };
  'chat:stream:start': { sessionId: string; messageId: string };
  'chat:stream:chunk': { sessionId: string; messageId: string; chunk: string };
  'chat:stream:end': { sessionId: string; messageId: string; fullContent: string };
  'chat:error': { sessionId: string; error: string };
  'chat:history:updated': { conversationId: string; title: string | null; source: string; messageCount: number };

  // Agent events
  'agent:state': { agentId: string; state: AgentState; task?: string };
  'agent:thinking': { agentId: string; thought: string };
  'agent:response': { agentId: string; message: AssistantMessage };

  // Tool events
  'tool:start': { sessionId: string; tool: ToolExecution };
  'tool:progress': { sessionId: string; toolId: string; progress: number; message?: string };
  'tool:end': { sessionId: string; toolId: string; result: unknown; error?: string };

  // Workspace events
  'workspace:created': { workspace: WorkspaceInfo };
  'workspace:updated': { workspace: WorkspaceInfo };
  'workspace:deleted': { workspaceId: string };

  // System events
  'system:notification': { type: 'info' | 'warning' | 'error' | 'success'; message: string; action?: string };
  'system:status': { online: boolean; version: string; uptime: number };
}

/**
 * Client events (client to server)
 */
export interface ClientEvents {
  // Chat
  'chat:send': { content: string; channelId?: string; replyToId?: string; workspaceId?: string };
  'chat:stop': { messageId?: string };
  'chat:retry': { messageId: string };

  // Channel management
  'channel:connect': { type: ChannelType; config: Record<string, unknown> };
  'channel:disconnect': { channelId: string };
  'channel:subscribe': { channelId: string };
  'channel:unsubscribe': { channelId: string };
  'channel:send': { message: OutgoingMessage };
  'channel:list': Record<string, never>;

  // Workspace
  'workspace:create': { name: string; channels?: string[] };
  'workspace:switch': { workspaceId: string };
  'workspace:delete': { workspaceId: string };
  'workspace:list': Record<string, never>;

  // Agent
  'agent:configure': { provider: string; model: string; systemPrompt?: string };
  'agent:stop': Record<string, never>;

  // Tool
  'tool:cancel': { toolId: string };

  // Session
  'session:ping': Record<string, never>;
  'session:pong': { timestamp: number };
}

/**
 * Assistant message
 */
export interface AssistantMessage {
  readonly id: string;
  readonly content: string;
  readonly toolCalls?: ToolExecution[];
  readonly model?: string;
  readonly provider?: string;
  readonly timestamp: Date;
}

/**
 * WebSocket message wrapper
 */
export interface WSMessage<T = unknown> {
  readonly type: string;
  readonly payload: T;
  readonly timestamp: string;
  readonly correlationId?: string;
}
