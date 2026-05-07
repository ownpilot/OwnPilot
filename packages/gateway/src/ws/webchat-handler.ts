/**
 * WebChat WebSocket Handler
 *
 * Bridges WebSocket 'webchat:*' events to the channel system.
 * Listens for incoming webchat messages and routes them through
 * ChannelServiceImpl.processIncomingMessage().
 */

import { randomUUID } from 'node:crypto';
import type { ChannelIncomingMessage } from '@ownpilot/core';
import { getChannelService } from '@ownpilot/core';
import type { WebChatChannelAPI } from '../channels/plugins/webchat/webchat-api.js';
import { getChannelServiceImpl } from '../channels/service-impl.js';
import { sessionManager } from './session.js';
// Lazy-imported to break circular dependency: ws/webchat-handler.ts ↔ ws/server.ts
import { getLog } from '../services/log.js';

const log = getLog('WebChatHandler');

/** Shape of an incoming webchat WS message */
interface WebChatMessagePayload {
  text: string;
  sessionId: string;
  displayName?: string;
  replyToId?: string;
}

/**
 * Initialize the webchat WebSocket handler.
 * Call this after the channel service and webchat plugin are initialized.
 */
export function initWebChatHandler(): void {
  // Get the webchat channel API from the channel service
  const channelService = getChannelService();
  const api = channelService.getChannel('channel.webchat') as WebChatChannelAPI | undefined;

  if (!api) {
    log.warn('WebChat plugin not found, skipping handler initialization');
    return;
  }

  // Wire the send function: sends a WS message to a specific session
  api.setSendFunction(async (sessionId: string, event: string, data: unknown) => {
    const session = sessionManager.get(sessionId);
    if (session) {
      // Use sessionManager.send for typed events that exist in ServerEvents,
      // otherwise fall back to raw JSON via broadcast with sessionId filtering
      sessionManager.send(
        sessionId,
        event as keyof import('./types.js').ServerEvents,
        data as never
      );
    } else {
      // Fallback: broadcast to all (widget will filter by sessionId)
      sessionManager.broadcast(
        event as keyof import('./types.js').ServerEvents,
        { ...(data as Record<string, unknown>), sessionId } as never
      );
    }
  });

  log.info('WebChat handler initialized');
}

/**
 * Handle an incoming webchat message from WebSocket.
 * Called from the WS event system when a 'webchat:message' event arrives.
 */
export async function handleWebChatMessage(
  payload: WebChatMessagePayload,
  wsSessionId: string
): Promise<void> {
  const { text, sessionId, displayName = 'Web Visitor', replyToId } = payload;

  if (!text?.trim()) {
    log.debug('Empty webchat message ignored', { sessionId });
    return;
  }

  // Get webchat API and register/update session
  const channelService = getChannelService();
  const api = channelService.getChannel('channel.webchat') as WebChatChannelAPI | undefined;
  if (api) {
    api.registerSession(sessionId || wsSessionId, displayName);
  }

  const effectiveSessionId = sessionId || wsSessionId;
  const messageId = `channel.webchat:${randomUUID()}`;

  const incomingMessage: ChannelIncomingMessage = {
    id: messageId,
    channelPluginId: 'channel.webchat',
    platform: 'webchat',
    platformChatId: effectiveSessionId,
    sender: {
      platformUserId: effectiveSessionId,
      platform: 'webchat',
      displayName,
    },
    text: text.trim(),
    replyToId,
    timestamp: new Date(),
    metadata: {
      source: 'webchat-widget',
      wsSessionId,
    },
  };

  try {
    const serviceImpl = getChannelServiceImpl();
    if (serviceImpl) {
      await serviceImpl.processIncomingMessage(incomingMessage);
    } else {
      log.error('ChannelServiceImpl not available, cannot process webchat message');
    }
  } catch (error) {
    log.error('Failed to process webchat message', { error, sessionId: effectiveSessionId });
  }
}
