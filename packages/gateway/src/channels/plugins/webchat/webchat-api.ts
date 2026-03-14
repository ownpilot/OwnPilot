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

/** Active webchat sessions mapped by sessionId */
const activeSessions = new Map<
  string,
  {
    sessionId: string;
    displayName: string;
    connectedAt: Date;
  }
>();

export class WebChatChannelAPI implements ChannelPluginAPI {
  private status: ChannelConnectionStatus = 'disconnected';
  private sendFn: ((sessionId: string, event: string, data: unknown) => void) | null = null;

  constructor(_config: Record<string, unknown>) { // webchat needs no external credentials
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
   * Register a new webchat session.
   */
  registerSession(sessionId: string, displayName: string): void {
    activeSessions.set(sessionId, {
      sessionId,
      displayName,
      connectedAt: new Date(),
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
   * Get all active sessions.
   */
  getActiveSessions(): Map<
    string,
    { sessionId: string; displayName: string; connectedAt: Date }
  > {
    return new Map(activeSessions);
  }
}
