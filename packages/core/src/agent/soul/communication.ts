/**
 * Agent Communication System — Type Definitions
 *
 * Typed message bus for inter-agent communication.
 * Messages are DB-backed with real-time event delivery.
 */

// ============================================================
// MESSAGE TYPES
// ============================================================

export type AgentMessageType =
  | 'task_delegation'
  | 'task_result'
  | 'status_update'
  | 'question'
  | 'feedback'
  | 'alert'
  | 'coordination'
  | 'knowledge_share';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'replied';

// ============================================================
// AGENT MESSAGE
// ============================================================

export interface AgentMessage {
  id: string;
  /** Sender agent ID or 'user' */
  from: string;
  /** Recipient agent ID, 'user', or 'broadcast' */
  to: string;
  type: AgentMessageType;
  subject: string;
  content: string;
  attachments?: AgentAttachment[];
  priority: MessagePriority;
  /** Thread ID for conversation threading */
  threadId?: string;
  /** Whether the recipient should respond */
  requiresResponse: boolean;
  /** Response deadline */
  deadline?: Date;
  status: MessageStatus;
  /** Crew context */
  crewId?: string;
  createdAt: Date;
  readAt?: Date;
}

export interface AgentAttachment {
  type: 'note' | 'task' | 'memory' | 'data' | 'artifact';
  id: string;
  title?: string;
}

// ============================================================
// MESSAGE QUERY OPTIONS
// ============================================================

export interface MessageQueryOptions {
  unreadOnly?: boolean;
  limit?: number;
  types?: AgentMessageType[];
  fromAgent?: string;
}

// ============================================================
// COMMUNICATION BUS INTERFACE
// ============================================================

export interface IAgentCommunicationBus {
  /** Send a message to another agent */
  send(msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt'>): Promise<string>;

  /** Read inbox messages for an agent */
  readInbox(agentId: string, options?: MessageQueryOptions): Promise<AgentMessage[]>;

  /** Broadcast a message to all crew members */
  broadcast(
    crewId: string,
    msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt' | 'to'>
  ): Promise<void>;

  /** Get conversation between two agents */
  getConversation(a1: string, a2: string, limit?: number): Promise<AgentMessage[]>;

  /** Get all messages in a thread */
  getThread(threadId: string): Promise<AgentMessage[]>;

  /** Get unread message count for an agent */
  getUnreadCount(agentId: string): Promise<number>;
}
