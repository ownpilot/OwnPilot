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
  'channel:qr': { channelId: string; qr: string };
  'channel:status': { channelId: string; status: ChannelStatus; error?: string; botInfo?: { username?: string; firstName?: string } | null };
  'channel:message': {
    id: string;
    channelId: string;
    channelType: string;
    sender: string;
    content: string;
    timestamp: string;
    direction: 'incoming' | 'outgoing';
  };
  'channel:message:sent': { channelId: string; messageId: string };
  'channel:message:error': { channelId: string; error: string };

  // Chat events
  'chat:message': { sessionId: string; message: AssistantMessage };
  'chat:stream:start': { sessionId: string; messageId: string };
  'chat:stream:chunk': { sessionId: string; messageId: string; chunk: string };
  'chat:stream:end': { sessionId: string; messageId: string; fullContent: string };
  'chat:error': { sessionId: string; error: string };
  'chat:history:updated': {
    conversationId: string;
    title: string | null;
    source: string;
    messageCount: number;
  };

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

  // Trigger events
  'trigger:executed': {
    triggerId: string;
    triggerName: string;
    status: 'success' | 'failure' | 'skipped';
    durationMs?: number;
    error?: string;
    manual?: boolean;
  };

  // Data change events (personal data CRUD)
  'data:changed': {
    entity:
      | 'task'
      | 'note'
      | 'bookmark'
      | 'contact'
      | 'calendar'
      | 'expense'
      | 'goal'
      | 'memory'
      | 'plan'
      | 'trigger'
      | 'heartbeat'
      | 'custom_tool'
      | 'custom_table'
      | 'custom_record'
      | 'config_service'
      | 'workspace'
      | 'plugin'
      | 'pomodoro'
      | 'habit'
      | 'capture'
      | 'agent'
      | 'extension'
      | 'local_provider'
      | 'model_config'
      | 'model_provider'
      | 'channel'
      | 'conversation'
      | 'mcp_server'
      | 'workflow';
    action: 'created' | 'updated' | 'deleted';
    id?: string;
    count?: number;
  };

  // Pulse events
  'pulse:activity': {
    status: 'started' | 'stage' | 'completed' | 'error';
    stage: string;
    pulseId: string | null;
    startedAt: number | null;
    signalsFound?: number;
    actionsExecuted?: number;
    durationMs?: number;
    error?: string;
  };

  // Debug events
  'debug:entry': {
    timestamp: string;
    type:
      | 'request'
      | 'response'
      | 'tool_call'
      | 'tool_result'
      | 'error'
      | 'retry'
      | 'sandbox_execution';
    provider?: string;
    model?: string;
    data: unknown;
    duration?: number;
  };

  // System events
  'system:notification': {
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    action?: string;
    source?: string;
  };
  'system:status': { online: boolean; version: string; uptime: number };

  // Coding Agent session events
  'coding-agent:session:created': {
    session: {
      id: string;
      provider: string;
      displayName: string;
      state: string;
      mode: string;
      prompt: string;
      startedAt: string;
      userId: string;
    };
  };
  'coding-agent:session:output': { sessionId: string; data: string };
  'coding-agent:session:state': { sessionId: string; state: string };
  'coding-agent:session:exit': { sessionId: string; exitCode: number; signal?: number };
  'coding-agent:session:error': { sessionId: string; error: string };

  // Workflow approval events
  'approval:required': { approvalId: string; workflowId: string; nodeId: string };
  'approval:decided': { approvalId: string; status: 'approved' | 'rejected' };

  // Background agent state events
  'background-agent:update': {
    agentId: string;
    state: string;
    cyclesCompleted: number;
    totalToolCalls: number;
    lastCycleAt?: string;
    lastCycleDurationMs?: number;
    lastCycleError?: string;
  };

  // EventBus bridge events
  'event:subscribed': { pattern: string; success: boolean; error?: string };
  'event:unsubscribed': { pattern: string };
  'event:message': { type: string; source: string; data: unknown; timestamp: string };
  'event:publish:ack': { type: string };
  'event:publish:error': { type: string; error: string };
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

  // Coding Agent terminal input
  'coding-agent:input': { sessionId: string; data: string };
  'coding-agent:resize': { sessionId: string; cols: number; rows: number };
  'coding-agent:subscribe': { sessionId: string };

  // EventBus bridge events
  'event:subscribe': { pattern: string };
  'event:unsubscribe': { pattern: string };
  'event:publish': { type: string; data: unknown };
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
