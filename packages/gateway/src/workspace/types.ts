/**
 * Workspace Types
 *
 * Isolated agent sessions with channel associations
 */

import type { ChannelType } from '../ws/types.js';

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Unique workspace identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** User ID who owns this workspace */
  userId?: string;
  /** Associated channel IDs */
  channels: string[];
  /** Agent configuration */
  agent?: WorkspaceAgentConfig;
  /** Workspace settings */
  settings?: WorkspaceSettings;
}

/**
 * Agent configuration for a workspace
 */
export interface WorkspaceAgentConfig {
  /** LLM provider */
  provider: string;
  /** Model name */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** Temperature */
  temperature?: number;
  /** Max tokens */
  maxTokens?: number;
  /** Enabled tools */
  tools?: string[];
}

/**
 * Workspace settings
 */
export interface WorkspaceSettings {
  /** Auto-reply to incoming messages */
  autoReply?: boolean;
  /** Reply delay in ms (to simulate typing) */
  replyDelay?: number;
  /** Max context messages to include */
  maxContextMessages?: number;
  /** Enable conversation memory */
  enableMemory?: boolean;
  /** PII detection enabled */
  piiDetection?: boolean;
  /** Allowed file types for attachments */
  allowedAttachmentTypes?: string[];
}

/**
 * Workspace state
 */
export type WorkspaceState = 'idle' | 'processing' | 'waiting' | 'error';

/**
 * Workspace instance
 */
export interface Workspace {
  /** Configuration */
  readonly config: WorkspaceConfig;
  /** Current state */
  readonly state: WorkspaceState;
  /** Active conversation ID */
  readonly conversationId?: string;
  /** Created timestamp */
  readonly createdAt: Date;
  /** Last activity timestamp */
  readonly lastActivityAt: Date;
  /** Error message if state is error */
  readonly error?: string;
}

/**
 * Conversation message in workspace
 */
export interface WorkspaceMessage {
  /** Message ID */
  id: string;
  /** Role */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** Content */
  content: string;
  /** Source channel ID (for user messages) */
  channelId?: string;
  /** Source channel type */
  channelType?: ChannelType;
  /** Sender info */
  sender?: {
    id: string;
    name?: string;
  };
  /** Timestamp */
  timestamp: Date;
  /** Tool calls (for assistant messages) */
  toolCalls?: WorkspaceToolCall[];
  /** Tool result (for tool messages) */
  toolResult?: unknown;
  /** Attachments */
  attachments?: WorkspaceAttachment[];
}

/**
 * Tool call in workspace
 */
export interface WorkspaceToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: unknown;
  error?: string;
}

/**
 * Attachment in workspace
 */
export interface WorkspaceAttachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  filename?: string;
  mimeType: string;
  size?: number;
  url?: string;
}

/**
 * Workspace events
 */
export interface WorkspaceEvents {
  /** State changed */
  stateChange: (state: WorkspaceState, error?: string) => void;
  /** Message added */
  message: (message: WorkspaceMessage) => void;
  /** Tool execution started */
  toolStart: (toolCall: WorkspaceToolCall) => void;
  /** Tool execution completed */
  toolEnd: (toolCall: WorkspaceToolCall) => void;
  /** Response streaming started */
  streamStart: (messageId: string) => void;
  /** Response chunk received */
  streamChunk: (messageId: string, chunk: string) => void;
  /** Response streaming ended */
  streamEnd: (messageId: string, fullContent: string) => void;
}
