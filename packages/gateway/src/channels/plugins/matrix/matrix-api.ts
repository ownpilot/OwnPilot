/**
 * Matrix Channel API (matrix-js-sdk)
 *
 * Implements ChannelPluginAPI using the Matrix Client-Server API.
 * Supports room management, E2EE (optional), and federation.
 */

import {
  type ChannelPluginAPI,
  type ChannelConnectionStatus,
  type ChannelPlatform,
  type ChannelOutgoingMessage,
  type ChannelUser,
  type ChannelIncomingMessage,
  ChannelEvents,
  type ChannelMessageReceivedData,
  type ChannelConnectionEventData,
  getEventBus,
  createEvent,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';

const log = getLog('Matrix');

// ============================================================================
// Types
// ============================================================================

export interface MatrixChannelConfig {
  homeserver_url: string;
  access_token: string;
  user_id: string;
  allowed_rooms?: string;
  enable_encryption?: boolean;
}

// ============================================================================
// Implementation
// ============================================================================

export class MatrixChannelAPI implements ChannelPluginAPI {
  private client: any = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: MatrixChannelConfig;
  private readonly pluginId: string;
  private allowedRooms: Set<string> = new Set();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as MatrixChannelConfig;
    this.pluginId = pluginId;

    if (this.config.allowed_rooms) {
      this.config.allowed_rooms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedRooms.add(id));
    }
  }

  // --------------------------------------------------------------------------
  // ChannelPluginAPI
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.status === 'connected') return;
    if (!this.config.homeserver_url || !this.config.access_token) {
      throw new Error('Matrix homeserver_url and access_token are required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      const sdk = await import('matrix-js-sdk');

      this.client = sdk.createClient({
        baseUrl: this.config.homeserver_url,
        accessToken: this.config.access_token,
        userId: this.config.user_id,
      });

      // Room timeline handler
      this.client.on('Room.timeline', (event: any, room: any) => {
        // Skip non-message events and own messages
        if (event.getType() !== 'm.room.message') return;
        if (event.getSender() === this.config.user_id) return;

        this.handleIncomingMessage(event, room).catch((err: Error) => {
          log.error('[Matrix] Error handling message:', err);
        });
      });

      // Sync state handler
      this.client.on('sync', (state: string) => {
        if (state === 'PREPARED') {
          this.status = 'connected';
          log.info('[Matrix] Client synced and connected');
          this.emitConnectionEvent('connected');
        } else if (state === 'ERROR') {
          this.status = 'error';
          this.emitConnectionEvent('error');
        } else if (state === 'RECONNECTING') {
          this.status = 'reconnecting';
          this.emitConnectionEvent('reconnecting');
        }
      });

      await this.client.startClient({ initialSyncLimit: 0 });
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      this.client = null;
    }
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.client) {
      throw new Error('Matrix client is not connected');
    }

    const content: Record<string, unknown> = {
      msgtype: 'm.text',
      body: message.text,
    };

    // Reply threading
    if (message.replyToId) {
      const eventId = message.replyToId.includes(':')
        ? message.replyToId.split(':').pop()
        : message.replyToId;
      content['m.relates_to'] = {
        'm.in_reply_to': { event_id: eventId },
      };
    }

    const result = await this.client.sendEvent(
      message.platformChatId,
      'm.room.message',
      content
    );

    return result.event_id ?? '';
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'matrix';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.client) return;
    await this.client
      .sendTyping(platformChatId, true, 5000)
      .catch(() => {});
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    log.warn('[Matrix] editMessage not yet supported');
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    log.warn('[Matrix] deleteMessage not yet supported');
  }

  // --------------------------------------------------------------------------
  // Private: Message Processing
  // --------------------------------------------------------------------------

  private async handleIncomingMessage(event: any, room: any): Promise<void> {
    const roomId = room.roomId ?? '';

    // Access control
    if (this.allowedRooms.size > 0 && !this.allowedRooms.has(roomId)) {
      return;
    }

    const senderId = event.getSender() ?? '';
    const content = event.getContent();
    const text = content.body ?? '';

    if (!text) return;

    // Try to get display name
    let displayName = senderId;
    try {
      const member = room.getMember(senderId);
      if (member) {
        displayName = member.name ?? senderId;
      }
    } catch {
      // Use sender ID
    }

    const sender: ChannelUser = {
      platformUserId: senderId,
      platform: 'matrix',
      displayName,
      avatarUrl: room.getMember(senderId)?.getAvatarUrl?.(
        this.config.homeserver_url,
        48,
        48,
        'crop',
        false
      ),
    };

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${event.getId()}`,
      channelPluginId: this.pluginId,
      platform: 'matrix',
      platformChatId: roomId,
      sender,
      text,
      timestamp: new Date(event.getTs()),
      metadata: {
        platformMessageId: event.getId(),
        roomName: room.name,
        msgtype: content.msgtype,
      },
    };

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel' as any,
          this.pluginId,
          { message: normalized }
        )
      );
    } catch (err) {
      log.error('[Matrix] Failed to emit message event:', err);
    }
  }

  private emitConnectionEvent(status: ChannelConnectionStatus): void {
    try {
      const eventBus = getEventBus();
      const eventName =
        status === 'connected'
          ? ChannelEvents.CONNECTED
          : status === 'connecting'
            ? ChannelEvents.CONNECTING
            : status === 'reconnecting'
              ? ChannelEvents.RECONNECTING
              : status === 'error'
                ? ChannelEvents.ERROR
                : ChannelEvents.DISCONNECTED;

      eventBus.emit(
        createEvent<ChannelConnectionEventData>(
          eventName,
          'channel' as any,
          this.pluginId,
          {
            channelPluginId: this.pluginId,
            platform: 'matrix',
            status,
          }
        )
      );
    } catch {
      // EventBus not ready
    }
  }
}
