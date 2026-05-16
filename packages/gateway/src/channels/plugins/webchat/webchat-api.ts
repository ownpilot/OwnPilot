/**
 * WebChatChannelAPI
 *
 * Channel API for the embedded web chat widget.
 * Messages flow through WebSocket events:
 *   Inbound:  WS 'webchat:message' -> processIncomingMessage()
 *   Outbound: sendMessage() -> WS 'webchat:response' to specific session
 */

import { randomUUID } from 'node:crypto';
import type {
  ChannelPluginAPI,
  ChannelConnectionStatus,
  ChannelOutgoingMessage,
  ChannelPlatform,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';

const log = getLog('WebChat');

/**
 * Active webchat sessions, keyed by widget-issued sessionId.
 *
 * Browser tabs close without sending a disconnect, so we cannot rely on an
 * explicit removeSession call. Entries expire after IDLE_TIMEOUT_MS since
 * lastSeenAt; a lazy sweep runs on every registerSession call so the map
 * never grows unboundedly even without a separate timer.
 */
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_SESSIONS = 1000;

interface WebChatSession {
  sessionId: string;
  displayName: string;
  connectedAt: Date;
  lastSeenAt: number;
}

const activeSessions = new Map<string, WebChatSession>();

function sweepStaleSessions(now: number): void {
  for (const [id, session] of activeSessions) {
    if (now - session.lastSeenAt > IDLE_TIMEOUT_MS) {
      activeSessions.delete(id);
    }
  }
  // Hard cap as a backstop against a flood of fresh sessions: drop oldest.
  if (activeSessions.size > MAX_SESSIONS) {
    const excess = activeSessions.size - MAX_SESSIONS;
    const iter = activeSessions.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key !== undefined) activeSessions.delete(key);
    }
  }
}

export class WebChatChannelAPI implements ChannelPluginAPI {
  private status: ChannelConnectionStatus = 'disconnected';
  private sendFn: ((sessionId: string, event: string, data: unknown) => void) | null = null;

  constructor(_config: Record<string, unknown>) {
    // webchat needs no external credentials
    void _config;
  }

  async connect(): Promise<void> {
    this.status = 'connected';
    log.info('WebChat channel connected');
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    activeSessions.clear();
    log.info('WebChat channel disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    const messageId = randomUUID();
    const sessionId = message.platformChatId; // platformChatId = webchat sessionId

    if (this.sendFn) {
      this.sendFn(sessionId, 'webchat:response', {
        id: messageId,
        text: message.text,
        timestamp: new Date().toISOString(),
        replyToId: message.replyToId,
      });
    } else {
      log.warn('No sendFn registered, cannot deliver webchat message', { sessionId });
    }

    return messageId;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'webchat';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    if (this.sendFn) {
      this.sendFn(platformChatId, 'webchat:typing', { typing: true });
    }
  }

  /**
   * Register the WebSocket send function.
   * Called by the webchat handler during setup.
   */
  setSendFunction(fn: (sessionId: string, event: string, data: unknown) => void): void {
    this.sendFn = fn;
  }

  /**
   * Register a new webchat session (or refresh lastSeenAt for an existing one).
   * Also sweeps stale entries so the in-memory map cannot grow unbounded.
   */
  registerSession(sessionId: string, displayName: string): void {
    const now = Date.now();
    sweepStaleSessions(now);
    const existing = activeSessions.get(sessionId);
    if (existing) {
      existing.lastSeenAt = now;
      existing.displayName = displayName;
      return;
    }
    activeSessions.set(sessionId, {
      sessionId,
      displayName,
      connectedAt: new Date(now),
      lastSeenAt: now,
    });
    log.info('WebChat session registered', { sessionId, displayName });
  }

  /**
   * Remove a webchat session.
   */
  removeSession(sessionId: string): void {
    activeSessions.delete(sessionId);
    log.info('WebChat session removed', { sessionId });
  }

  /**
   * Get all active sessions (after pruning stale ones).
   */
  getActiveSessions(): Map<string, { sessionId: string; displayName: string; connectedAt: Date }> {
    sweepStaleSessions(Date.now());
    const snapshot = new Map<
      string,
      { sessionId: string; displayName: string; connectedAt: Date }
    >();
    for (const [id, s] of activeSessions) {
      snapshot.set(id, {
        sessionId: s.sessionId,
        displayName: s.displayName,
        connectedAt: s.connectedAt,
      });
    }
    return snapshot;
  }
}
