/**
 * Session Manager
 *
 * Manages WebSocket client sessions
 */

import type { WebSocket } from 'ws';
import type { Session, WSMessage, ServerEvents } from './types.js';

/**
 * Extended session with WebSocket reference
 */
interface ManagedSession extends Session {
  socket: WebSocket;
}

/**
 * Session manager for WebSocket connections
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private socketToSession = new WeakMap<WebSocket, string>();

  /**
   * Create a new session for a WebSocket connection
   */
  create(socket: WebSocket, userId?: string): Session {
    const id = crypto.randomUUID();
    const now = new Date();

    const session: ManagedSession = {
      id,
      userId,
      connectedAt: now,
      lastActivityAt: now,
      channels: new Set(),
      metadata: {},
      socket,
    };

    this.sessions.set(id, session);
    this.socketToSession.set(socket, id);

    return this.toPublicSession(session);
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.toPublicSession(session) : undefined;
  }

  /**
   * Get session by WebSocket
   */
  getBySocket(socket: WebSocket): Session | undefined {
    const sessionId = this.socketToSession.get(socket);
    return sessionId ? this.get(sessionId) : undefined;
  }

  /**
   * Update session activity timestamp
   */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      (session as { lastActivityAt: Date }).lastActivityAt = new Date();
    }
  }

  /**
   * Subscribe session to a channel
   */
  subscribeToChannel(sessionId: string, channelId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.channels.add(channelId);
      return true;
    }
    return false;
  }

  /**
   * Unsubscribe session from a channel
   */
  unsubscribeFromChannel(sessionId: string, channelId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      return session.channels.delete(channelId);
    }
    return false;
  }

  /**
   * Set session metadata
   */
  setMetadata(sessionId: string, key: string, value: unknown): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      (session.metadata as Record<string, unknown>)[key] = value;
    }
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.socketToSession.delete(session.socket);
      return this.sessions.delete(sessionId);
    }
    return false;
  }

  /**
   * Remove session by WebSocket
   */
  removeBySocket(socket: WebSocket): boolean {
    const sessionId = this.socketToSession.get(socket);
    if (sessionId) {
      return this.remove(sessionId);
    }
    return false;
  }

  /**
   * Send message to a specific session
   */
  send<K extends keyof ServerEvents>(
    sessionId: string,
    event: K,
    payload: ServerEvents[K]
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (session && session.socket.readyState === 1) {
      const message: WSMessage<ServerEvents[K]> = {
        type: event,
        payload,
        timestamp: new Date().toISOString(),
      };
      session.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Broadcast to all sessions
   */
  broadcast<K extends keyof ServerEvents>(
    event: K,
    payload: ServerEvents[K]
  ): number {
    let count = 0;
    const message: WSMessage<ServerEvents[K]> = {
      type: event,
      payload,
      timestamp: new Date().toISOString(),
    };
    const data = JSON.stringify(message);

    for (const session of this.sessions.values()) {
      if (session.socket.readyState === 1) {
        session.socket.send(data);
        count++;
      }
    }

    return count;
  }

  /**
   * Broadcast to sessions subscribed to a channel
   */
  broadcastToChannel<K extends keyof ServerEvents>(
    channelId: string,
    event: K,
    payload: ServerEvents[K]
  ): number {
    let count = 0;
    const message: WSMessage<ServerEvents[K]> = {
      type: event,
      payload,
      timestamp: new Date().toISOString(),
    };
    const data = JSON.stringify(message);

    for (const session of this.sessions.values()) {
      if (session.channels.has(channelId) && session.socket.readyState === 1) {
        session.socket.send(data);
        count++;
      }
    }

    return count;
  }

  /**
   * Get all active sessions
   */
  getAll(): Session[] {
    return Array.from(this.sessions.values()).map(this.toPublicSession);
  }

  /**
   * Get session count
   */
  get count(): number {
    return this.sessions.size;
  }

  /**
   * Get sessions subscribed to a channel
   */
  getChannelSubscribers(channelId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.channels.has(channelId))
      .map(this.toPublicSession);
  }

  /**
   * Clean up stale sessions (no activity for given duration)
   */
  cleanup(maxIdleMs: number): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > maxIdleMs) {
        session.socket.close(4000, 'Session timeout');
        this.sessions.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Convert managed session to public session (without socket reference)
   */
  private toPublicSession(session: ManagedSession): Session {
    return {
      id: session.id,
      userId: session.userId,
      connectedAt: session.connectedAt,
      lastActivityAt: session.lastActivityAt,
      channels: session.channels,
      metadata: session.metadata,
    };
  }
}

/**
 * Global session manager instance
 */
export const sessionManager = new SessionManager();
