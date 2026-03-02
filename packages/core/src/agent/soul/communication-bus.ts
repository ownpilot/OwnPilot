/**
 * Agent Communication Bus
 *
 * DB-backed message bus for inter-agent communication.
 * Uses EventBus for real-time notifications.
 */

import type {
  AgentMessage,
  AgentMessageType,
  IAgentCommunicationBus,
  MessageQueryOptions,
} from './communication.js';

/**
 * Repository interface the bus depends on.
 * Implemented by gateway's AgentMessageRepository.
 */
export interface IAgentMessageRepository {
  create(message: AgentMessage): Promise<void>;
  findForAgent(
    agentId: string,
    options: {
      unreadOnly?: boolean;
      limit?: number;
      types?: AgentMessageType[];
      fromAgent?: string;
    }
  ): Promise<AgentMessage[]>;
  markAsRead(ids: string[]): Promise<void>;
  getCrewMembers(crewId: string): Promise<string[]>;
  findConversation(a1: string, a2: string, limit: number): Promise<AgentMessage[]>;
  findByThread(threadId: string): Promise<AgentMessage[]>;
  countUnread(agentId: string): Promise<number>;
  countToday(crewId: string): Promise<number>;
}

/**
 * Event bus interface (subset of IEventSystem).
 */
export interface ICommunicationEventBus {
  emit(event: string, payload: unknown): void;
}

/**
 * Communication bus for inter-agent messaging.
 */
export class AgentCommunicationBus implements IAgentCommunicationBus {
  constructor(
    private messageRepo: IAgentMessageRepository,
    private eventBus: ICommunicationEventBus
  ) {}

  /** Send a message to another agent. Returns the message ID. */
  async send(msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const message: AgentMessage = {
      ...msg,
      id: crypto.randomUUID(),
      status: 'sent',
      createdAt: new Date(),
    };
    await this.messageRepo.create(message);

    this.eventBus.emit('soul.message.sent', {
      messageId: message.id,
      from: message.from,
      to: message.to,
      type: message.type,
      subject: message.subject,
    });

    return message.id;
  }

  /** Read inbox messages for an agent. Marks them as read. */
  async readInbox(agentId: string, options?: MessageQueryOptions): Promise<AgentMessage[]> {
    const messages = await this.messageRepo.findForAgent(agentId, {
      unreadOnly: options?.unreadOnly ?? true,
      limit: options?.limit ?? 20,
      types: options?.types,
      fromAgent: options?.fromAgent,
    });

    if (messages.length > 0) {
      await this.messageRepo.markAsRead(messages.map((m) => m.id));
    }

    return messages;
  }

  /** Broadcast a message to all crew members (except sender). */
  async broadcast(
    crewId: string,
    msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt' | 'to'>
  ): Promise<void> {
    const members = await this.messageRepo.getCrewMembers(crewId);
    for (const memberId of members) {
      if (memberId !== msg.from) {
        await this.send({ ...msg, to: memberId, crewId });
      }
    }
  }

  /** Get conversation between two agents. */
  async getConversation(a1: string, a2: string, limit = 50): Promise<AgentMessage[]> {
    return this.messageRepo.findConversation(a1, a2, limit);
  }

  /** Get all messages in a thread. */
  async getThread(threadId: string): Promise<AgentMessage[]> {
    return this.messageRepo.findByThread(threadId);
  }

  /** Get unread message count for an agent. */
  async getUnreadCount(agentId: string): Promise<number> {
    return this.messageRepo.countUnread(agentId);
  }
}
