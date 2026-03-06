/**
 * Agent Communication Bus
 *
 * DB-backed message bus for inter-agent communication.
 * Uses EventBus for real-time notifications.
 *
 * AGENT-HIGH-004: Rate limiting added to prevent message flooding.
 */

import { getLog } from '../../services/get-log.js';
import type {
  AgentMessage,
  AgentMessageType,
  IAgentCommunicationBus,
  MessageQueryOptions,
} from './communication.js';

const log = getLog('AgentCommunicationBus');

// Rate limiting constants
const DEFAULT_MAX_MESSAGES_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Rate limit tracking for agents */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

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
  // Rate limiting state (agentId -> rate limit entry)
  private rateLimits = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private messageRepo: IAgentMessageRepository,
    private eventBus: ICommunicationEventBus,
    private maxMessagesPerMinute = DEFAULT_MAX_MESSAGES_PER_MINUTE
  ) {
    // Evict expired rate-limit entries every 5 minutes to prevent unbounded map growth
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [agentId, entry] of this.rateLimits) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
          this.rateLimits.delete(agentId);
        }
      }
    }, 5 * 60_000);
    this.cleanupTimer.unref?.(); // Don't prevent process exit
  }

  /** Stop the background cleanup timer. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.rateLimits.clear();
  }

  /** Send a message to another agent. Returns the message ID. */
  async send(msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt'>): Promise<string> {
    // AGENT-HIGH-004: Rate limiting check
    this.checkRateLimit(msg.from);

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

  /** Broadcast a message to all crew members (except sender). Returns per-member delivery result. */
  async broadcast(
    crewId: string,
    msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt' | 'to'>
  ): Promise<{ delivered: string[]; failed: string[] }> {
    const members = await this.messageRepo.getCrewMembers(crewId);
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const memberId of members) {
      if (memberId !== msg.from) {
        try {
          await this.send({ ...msg, to: memberId, crewId });
          delivered.push(memberId);
        } catch (err) {
          // Log but continue — broadcast should reach all reachable members
          const message = err instanceof Error ? err.message : String(err);
          log.warn(`broadcast to ${memberId} failed: ${message}`);
          failed.push(memberId);
        }
      }
    }
    if (failed.length > 0) {
      log.warn(
        `broadcast for crew ${crewId} had ${failed.length}/${members.length - 1} failed deliveries`
      );
    }
    return { delivered, failed };
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

  /**
   * Check rate limit for an agent.
   * Throws if rate limit is exceeded.
   * AGENT-HIGH-004: Rate limiting to prevent message flooding.
   */
  private checkRateLimit(agentId: string): void {
    const now = Date.now();
    const entry = this.rateLimits.get(agentId);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      // New window or expired window
      this.rateLimits.set(agentId, { count: 1, windowStart: now });
      return;
    }

    if (entry.count >= this.maxMessagesPerMinute) {
      throw new Error(
        `Rate limit exceeded: Agent ${agentId} can only send ${this.maxMessagesPerMinute} messages per minute`
      );
    }

    entry.count++;
  }

  /**
   * Reset rate limit for an agent (useful for testing or manual reset).
   */
  resetRateLimit(agentId: string): void {
    this.rateLimits.delete(agentId);
  }

  /**
   * Get current rate limit status for an agent.
   */
  getRateLimitStatus(
    agentId: string
  ): { count: number; remaining: number; resetInMs: number } | null {
    const entry = this.rateLimits.get(agentId);
    if (!entry) return null;

    const now = Date.now();
    const resetInMs = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - entry.windowStart));

    return {
      count: entry.count,
      remaining: Math.max(0, this.maxMessagesPerMinute - entry.count),
      resetInMs,
    };
  }
}
