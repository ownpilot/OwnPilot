/**
 * Slack Channel API (@slack/bolt)
 *
 * Implements ChannelPluginAPI using Slack Bolt framework.
 * Supports Socket Mode for event-driven messaging and
 * thread-aware replies.
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

const log = getLog('Slack');

// ============================================================================
// Types
// ============================================================================

export interface SlackChannelConfig {
  bot_token: string;
  app_token: string;
  signing_secret?: string;
  allowed_channels?: string;
}

// ============================================================================
// Implementation
// ============================================================================

export class SlackChannelAPI implements ChannelPluginAPI {
  private app: any = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: SlackChannelConfig;
  private readonly pluginId: string;
  private allowedChannels: Set<string> = new Set();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as SlackChannelConfig;
    this.pluginId = pluginId;

    if (this.config.allowed_channels) {
      this.config.allowed_channels
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedChannels.add(id));
    }
  }

  // --------------------------------------------------------------------------
  // ChannelPluginAPI
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.status === 'connected') return;
    if (!this.config.bot_token || !this.config.app_token) {
      throw new Error('Slack bot_token and app_token are required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      const { App } = await import('@slack/bolt');

      this.app = new App({
        token: this.config.bot_token,
        appToken: this.config.app_token,
        socketMode: true,
      });

      // Message handler
      this.app.message(async ({ message, say }: any) => {
        // Skip bot messages and subtypes
        if (message.subtype || message.bot_id) return;
        this.handleIncomingMessage(message).catch((err: Error) => {
          log.error('[Slack] Error handling message:', err);
        });
      });

      await this.app.start();

      this.status = 'connected';
      log.info('[Slack] Bot connected via Socket Mode');
      this.emitConnectionEvent('connected');
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.app) {
      throw new Error('Slack bot is not connected');
    }

    const result = await this.app.client.chat.postMessage({
      token: this.config.bot_token,
      channel: message.platformChatId,
      text: message.text,
      ...(message.replyToId
        ? { thread_ts: message.replyToId.includes(':') ? message.replyToId.split(':').pop() : message.replyToId }
        : {}),
    });

    return result.ts ?? '';
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'slack';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    // Slack doesn't have a direct typing indicator API for bots
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    log.warn('[Slack] editMessage not yet supported (requires channel tracking)');
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    log.warn('[Slack] deleteMessage not yet supported (requires channel tracking)');
  }

  // --------------------------------------------------------------------------
  // Private: Message Processing
  // --------------------------------------------------------------------------

  private async handleIncomingMessage(message: any): Promise<void> {
    const channelId = message.channel ?? '';

    // Access control
    if (this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId)) {
      return;
    }

    // Resolve user info
    let displayName = message.user ?? 'Unknown';
    let username: string | undefined;

    try {
      const userInfo = await this.app.client.users.info({
        token: this.config.bot_token,
        user: message.user,
      });
      if (userInfo.user) {
        displayName = userInfo.user.real_name ?? userInfo.user.name ?? displayName;
        username = userInfo.user.name;
      }
    } catch {
      // User info lookup failed, use ID
    }

    const sender: ChannelUser = {
      platformUserId: message.user ?? '',
      platform: 'slack',
      displayName,
      username,
    };

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${message.ts}`,
      channelPluginId: this.pluginId,
      platform: 'slack',
      platformChatId: channelId,
      sender,
      text: message.text ?? '',
      replyToId: message.thread_ts
        ? `${this.pluginId}:${message.thread_ts}`
        : undefined,
      timestamp: new Date(parseFloat(message.ts) * 1000),
      metadata: {
        platformMessageId: message.ts,
        threadTs: message.thread_ts,
        team: message.team,
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
      log.error('[Slack] Failed to emit message event:', err);
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
            platform: 'slack',
            status,
          }
        )
      );
    } catch {
      // EventBus not ready
    }
  }
}
