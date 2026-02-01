/**
 * LINE Channel API (@line/bot-sdk)
 *
 * Implements ChannelPluginAPI using LINE Messaging API.
 * Webhook-based messaging with Flex Message support
 * and reply token handling.
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

const log = getLog('Line');

// ============================================================================
// Types
// ============================================================================

export interface LINEChannelConfig {
  channel_access_token: string;
  channel_secret: string;
  webhook_port?: number;
}

// ============================================================================
// Implementation
// ============================================================================

export class LINEChannelAPI implements ChannelPluginAPI {
  private client: any = null;
  private server: any = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: LINEChannelConfig;
  private readonly pluginId: string;
  // Map to store recent reply tokens (LINE requires reply tokens for replies)
  private replyTokens: Map<string, string> = new Map();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as LINEChannelConfig;
    this.pluginId = pluginId;
  }

  // --------------------------------------------------------------------------
  // ChannelPluginAPI
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.status === 'connected') return;
    if (!this.config.channel_access_token || !this.config.channel_secret) {
      throw new Error('LINE channel_access_token and channel_secret are required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      const line = await import('@line/bot-sdk');

      const lineConfig = {
        channelAccessToken: this.config.channel_access_token,
        channelSecret: this.config.channel_secret,
      };

      this.client = new line.messagingApi.MessagingApiClient({
        channelAccessToken: this.config.channel_access_token,
      });

      // Create webhook handler
      const middleware = line.middleware(lineConfig);
      const http = await import('node:http');
      const port = this.config.webhook_port ?? 3100;

      this.server = http.createServer(async (req: any, res: any) => {
        if (req.method === 'POST' && req.url === '/webhook') {
          // Collect body
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            try {
              const parsed = JSON.parse(body.toString());
              this.handleWebhookEvents(parsed.events ?? []);
              res.writeHead(200);
              res.end('OK');
            } catch {
              res.writeHead(400);
              res.end('Bad Request');
            }
          });
        } else {
          res.writeHead(200);
          res.end('OK');
        }
      });

      this.server.listen(port, () => {
        this.status = 'connected';
        log.info(`[LINE] Webhook server listening on port ${port}`);
        this.emitConnectionEvent('connected');
      });
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.client = null;
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.client) {
      throw new Error('LINE client is not connected');
    }

    // Try reply token first (LINE prefers reply over push)
    const replyToken = this.replyTokens.get(message.platformChatId);
    if (replyToken) {
      this.replyTokens.delete(message.platformChatId);
      try {
        await this.client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: message.text }],
        });
        return `reply:${replyToken}`;
      } catch {
        // Reply token may have expired, fall through to push
      }
    }

    // Push message
    await this.client.pushMessage({
      to: message.platformChatId,
      messages: [{ type: 'text', text: message.text }],
    });
    return `push:${message.platformChatId}:${Date.now()}`;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'line';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    // LINE doesn't have a typing indicator API
  }

  // --------------------------------------------------------------------------
  // Private: Webhook Processing
  // --------------------------------------------------------------------------

  private handleWebhookEvents(events: any[]): void {
    for (const event of events) {
      if (event.type !== 'message' || event.message.type !== 'text') continue;

      // Store reply token for this user (short-lived)
      const userId = event.source.userId ?? '';
      this.replyTokens.set(userId, event.replyToken);

      // Clear expired tokens after 25 seconds (LINE tokens expire ~30s)
      setTimeout(() => {
        if (this.replyTokens.get(userId) === event.replyToken) {
          this.replyTokens.delete(userId);
        }
      }, 25000);

      this.handleIncomingMessage(event).catch((err) => {
        log.error('[LINE] Error handling message:', err);
      });
    }
  }

  private async handleIncomingMessage(event: any): Promise<void> {
    const userId = event.source.userId ?? '';
    const groupId = event.source.groupId ?? event.source.roomId ?? '';
    const chatId = groupId || userId;

    let displayName = userId;
    try {
      if (this.client && userId) {
        const profile = await this.client.getProfile(userId);
        displayName = profile.displayName ?? userId;
      }
    } catch {
      // Profile lookup failed
    }

    const sender: ChannelUser = {
      platformUserId: userId,
      platform: 'line',
      displayName,
    };

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${event.message.id}`,
      channelPluginId: this.pluginId,
      platform: 'line',
      platformChatId: chatId,
      sender,
      text: event.message.text ?? '',
      timestamp: new Date(event.timestamp),
      metadata: {
        platformMessageId: event.message.id,
        replyToken: event.replyToken,
        sourceType: event.source.type,
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
      log.error('[LINE] Failed to emit message event:', err);
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
            platform: 'line',
            status,
          }
        )
      );
    } catch {
      // EventBus not ready
    }
  }
}
