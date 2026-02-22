/**
 * SessionService Implementation
 *
 * In-memory session store with support for all session sources.
 * Channel sessions are matched by (userId, channelPluginId, platformChatId)
 * for getOrCreate(), enabling conversation continuity.
 *
 * Future: DB persistence for channel sessions can be layered on top.
 */

import { randomUUID } from 'node:crypto';
import type {
  ISessionService,
  Session,
  CreateSessionInput,
  SessionSource,
} from '@ownpilot/core';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../config/defaults.js';

// ============================================================================
// Implementation
// ============================================================================

/** Default interval for automatic cleanup of stale sessions (15 minutes). */
const CLEANUP_INTERVAL_MS = 15 * MS_PER_MINUTE;
/** Default max age for inactive sessions before cleanup (1 hour). */
const STALE_SESSION_MAX_AGE_MS = MS_PER_HOUR;
/** Max age for active sessions with no activity before forced eviction (24 hours). */
const ACTIVE_SESSION_MAX_AGE_MS = 24 * MS_PER_HOUR;

export class SessionService implements ISessionService {
  private readonly sessions = new Map<string, Session>();

  /**
   * Channel session index: "pluginId:chatId" → sessionId
   * Used for fast lookup in getByChannel() and getOrCreate().
   */
  private readonly channelIndex = new Map<string, string>();

  /** Periodic cleanup timer to evict stale closed sessions. */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup(STALE_SESSION_MAX_AGE_MS);
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** Stop the automatic cleanup timer (for graceful shutdown). */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  create(input: CreateSessionInput): Session {
    const session: Session = {
      id: randomUUID(),
      userId: input.userId,
      source: input.source,
      conversationId: null,
      channelPluginId: input.channelPluginId,
      platformChatId: input.platformChatId,
      isActive: true,
      metadata: { ...input.metadata },
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.sessions.set(session.id, session);

    if (input.channelPluginId && input.platformChatId) {
      const key = this.channelKey(input.channelPluginId, input.platformChatId);
      this.channelIndex.set(key, session.id);
    }

    return session;
  }

  get(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return null;
    return session;
  }

  getOrCreate(input: CreateSessionInput): Session {
    // For channel sessions, try to find an existing active session
    if (input.source === 'channel' && input.channelPluginId && input.platformChatId) {
      const existing = this.getByChannel(input.channelPluginId, input.platformChatId);
      if (existing) {
        this.touch(existing.id);
        return existing;
      }
    }

    return this.create(input);
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.isActive) {
      (session as { lastActivityAt: Date }).lastActivityAt = new Date();
    }
  }

  linkConversation(sessionId: string, conversationId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      (session as { conversationId: string | null }).conversationId = conversationId;
    }
  }

  setMetadata(sessionId: string, key: string, value: unknown): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      (session.metadata as Record<string, unknown>)[key] = value;
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    (session as { isActive: boolean }).isActive = false;

    // Clean up channel index
    if (session.channelPluginId && session.platformChatId) {
      const key = this.channelKey(session.channelPluginId, session.platformChatId);
      this.channelIndex.delete(key);
    }
  }

  getByUser(userId: string): Session[] {
    const result: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.isActive) {
        result.push(session);
      }
    }
    return result;
  }

  getByChannel(channelPluginId: string, platformChatId: string): Session | null {
    const key = this.channelKey(channelPluginId, platformChatId);
    const sessionId = this.channelIndex.get(key);
    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      this.channelIndex.delete(key);
      return null;
    }
    return session;
  }

  getActiveSessions(): Session[] {
    const result: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.isActive) {
        result.push(session);
      }
    }
    return result;
  }

  getStats(): Record<SessionSource, number> {
    const stats: Record<SessionSource, number> = {
      web: 0,
      api: 0,
      channel: 0,
      scheduler: 0,
      system: 0,
    };
    for (const session of this.sessions.values()) {
      if (session.isActive) {
        stats[session.source]++;
      }
    }
    return stats;
  }

  /**
   * Remove inactive sessions older than maxAge (ms).
   * Returns the number of sessions cleaned up.
   */
  cleanup(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    const activeCutoff = Date.now() - ACTIVE_SESSION_MAX_AGE_MS;
    let removed = 0;

    for (const [id, session] of this.sessions) {
      const lastActivity = session.lastActivityAt.getTime();
      const shouldRemove =
        (!session.isActive && lastActivity < cutoff) ||
        (session.isActive && lastActivity < activeCutoff);

      if (shouldRemove) {
        // Clean up channel index entry before removing session
        if (session.channelPluginId && session.platformChatId) {
          const key = this.channelKey(session.channelPluginId, session.platformChatId);
          this.channelIndex.delete(key);
        }
        this.sessions.delete(id);
        removed++;
      }
    }

    return removed;
  }

  private channelKey(pluginId: string, chatId: string): string {
    return `${pluginId}\0${chatId}`;
  }
}

/**
 * Create a new SessionService instance.
 */
export function createSessionService(): SessionService {
  return new SessionService();
}
