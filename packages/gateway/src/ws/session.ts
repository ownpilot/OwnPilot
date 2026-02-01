/**
 * Session Manager
 *
 * Manages WebSocket client sessions.
 * Delegates session lifecycle to ISessionService (when available)
 * while keeping WebSocket-specific state (sockets, broadcast, WS channel subscriptions).
 */

import type { WebSocket } from 'ws';
import type { Session, WSMessage, ServerEvents } from './types.js';
import { getLog } from '../services/log.js';

const log = getLog('SessionManager');
import {
  hasServiceRegistry,
  getServiceRegistry,
  Services,
  type ISessionService,
} from '@ownpilot/core';

/**
 * Extended session with WebSocket reference
 */
interface ManagedSession extends Session {
  socket: WebSocket;
}

/**
 * Try to get ISessionService from the registry (returns null if unavailable).
 */
function tryGetSessionService(): ISessionService | null {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.Session);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Session manager for WebSocket connections
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private socketToSession = new WeakMap<WebSocket, string>();

  /**
   * Create a new session for a WebSocket connection.
   * Also registers in ISessionService (source: 'web') if available.
   */
  create(socket: WebSocket, userId?: string): Session {
    const svc = tryGetSessionService();
    let id: string;
    let now: Date;

    if (svc) {
      const unified = svc.create({ userId: userId ?? 'default', source: 'web' });
      id = unified.id;
      now = unified.createdAt;
    } else {
      id = crypto.randomUUID();
      now = new Date();
    }

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
    tryGetSessionService()?.touch(sessionId);
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
    tryGetSessionService()?.setMetadata(sessionId, key, value);
  }

  /**
   * Remove a session. Also closes it in ISessionService.
   */
  remove(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.socketToSession.delete(session.socket);
      this.sessions.delete(sessionId);
      tryGetSessionService()?.close(sessionId);
      return true;
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
    const svc = tryGetSessionService();

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > maxIdleMs) {
        try {
          session.socket.close(4000, 'Session timeout');
        } catch {
          // Socket may already be closed — continue cleanup
        }
        this.sessions.delete(id);
        try {
          svc?.close(id);
        } catch (error) {
          log.debug('Session service close failed', { sessionId: id, error });
        }
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
