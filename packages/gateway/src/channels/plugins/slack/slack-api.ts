/**
 * Slack Channel API
 *
 * Implements ChannelPluginAPI using the @slack/web-api library.
 * Connects via Socket Mode for development or Events API for production.
 * Handles message normalization and event emission.
 */

import {
  type ChannelPluginAPI,
  type ChannelConnectionStatus,
  type ChannelPlatform,
  type ChannelOutgoingMessage,
  type ChannelUser,
  type ChannelIncomingMessage,
  type ChannelAttachment,
  ChannelEvents,
  type ChannelMessageReceivedData,
  type ChannelConnectionEventData,
  getEventBus,
  createEvent,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';
import { getErrorMessage } from '../../../routes/helpers.js';
import { MAX_MESSAGE_CHAT_MAP_SIZE } from '../../../config/defaults.js';
import { splitMessage } from '../../utils/message-utils.js';

const log = getLog('Slack');

const SLACK_MAX_LENGTH = 4000; // Slack allows ~40K but for readability we split at 4K

// ============================================================================
// Types
// ============================================================================

interface SlackChannelConfig {
  bot_token: string;
  signing_secret: string;
  app_token?: string;
  allowed_channels?: string;
}

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts: string;
  channel: string;
  thread_ts?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private: string;
    size: number;
  }>;
}

// Webhook handler for Events API
let webhookHandler: {
  signingSecret: string;
  callback: (event: SlackMessageEvent) => Promise<void>;
} | null = null;

export function registerSlackWebhookHandler(
  signingSecret: string,
  callback: (event: SlackMessageEvent) => Promise<void>
): void {
  webhookHandler = { signingSecret, callback };
}

export function unregisterSlackWebhookHandler(): void {
  webhookHandler = null;
}

export function getSlackWebhookHandler() {
  return webhookHandler;
}

// ============================================================================
// Slack API
// ============================================================================

export class SlackChannelAPI implements ChannelPluginAPI {
  private webClient: import('@slack/web-api').WebClient | null = null;
  private socketModeClient: import('@slack/socket-mode').SocketModeClient | null = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: SlackChannelConfig;
  private readonly pluginId: string;
  private allowedChannels: Set<string> = new Set();
  private messageChatMap = new Map<string, string>();
  private botUserId: string | null = null;

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = {
      bot_token: String(config.bot_token ?? ''),
      signing_secret: String(config.signing_secret ?? ''),
      app_token: config.app_token ? String(config.app_token) : undefined,
      allowed_channels: config.allowed_channels ? String(config.allowed_channels) : undefined,
    };
    this.pluginId = pluginId;

    if (this.config.allowed_channels) {
      for (const id of this.config.allowed_channels.split(',')) {
        const trimmed = id.trim();
        if (trimmed) this.allowedChannels.add(trimmed);
      }
    }
  }

  // ==========================================================================
  // ChannelPluginAPI — Required
  // ==========================================================================

  async connect(): Promise<void> {
    if (!this.config.bot_token) {
      throw new Error('Slack bot token is required');
    }
    if (!this.config.signing_secret) {
      throw new Error('Slack signing secret is required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      // Dynamic imports to avoid hard dependency
      const { WebClient } = await import('@slack/web-api');
      this.webClient = new WebClient(this.config.bot_token);

      // Verify credentials by testing auth
      const authResult = await this.webClient.auth.test();
      if (!authResult.ok) {
        throw new Error('Slack auth test failed');
      }
      this.botUserId = authResult.user_id as string;

      // If app_token is provided, use Socket Mode (development)
      if (this.config.app_token) {
        await this.connectSocketMode();
      } else {
        // Events API mode — register webhook handler
        registerSlackWebhookHandler(
          this.config.signing_secret,
          (event) => this.handleSlackEvent(event)
        );
      }

      this.status = 'connected';
      this.emitConnectionEvent('connected');
      log.info(`Slack bot connected as ${authResult.user ?? 'unknown'} (${this.botUserId})`);
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw new Error(`Failed to connect Slack bot: ${getErrorMessage(error)}`);
    }
  }

  private async connectSocketMode(): Promise<void> {
    const { SocketModeClient } = await import('@slack/socket-mode');
    this.socketModeClient = new SocketModeClient({
      appToken: this.config.app_token!,
    });

    this.socketModeClient.on('message', async ({ event, ack }) => {
      await ack();
      if (event.type === 'message' && !event.subtype) {
        await this.handleSlackEvent(event as SlackMessageEvent);
      }
    });

    this.socketModeClient.on('disconnect', () => {
      log.warn('Slack Socket Mode disconnected');
      this.status = 'disconnected';
      this.emitConnectionEvent('disconnected');
    });

    await this.socketModeClient.start();
    log.info('Slack Socket Mode connected');
  }

  async disconnect(): Promise<void> {
    unregisterSlackWebhookHandler();

    if (this.socketModeClient) {
      await this.socketModeClient.disconnect();
      this.socketModeClient = null;
    }

    this.webClient = null;
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
    log.info('Slack bot disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.webClient) throw new Error('Slack client not connected');

    const parts = splitMessage(message.text, SLACK_MAX_LENGTH);
    let lastTs = '';

    for (let i = 0; i < parts.length; i++) {
      const options: {
        channel: string;
        text: string;
        thread_ts?: string;
      } = {
        channel: message.platformChatId,
        text: parts[i]!,
      };

      // Reply in thread if replyToId is provided (Slack uses thread_ts)
      if (i === 0 && message.replyToId) {
        options.thread_ts = message.replyToId;
      }

      const result = await this.webClient.chat.postMessage(options);
      lastTs = (result.ts as string) ?? '';

      if (lastTs) {
        this.trackMessage(lastTs, message.platformChatId);
      }

      // Small delay between split messages
      if (i < parts.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return lastTs;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'slack';
  }

  // ==========================================================================
  // ChannelPluginAPI — Optional
  // ==========================================================================

  async sendTyping(platformChatId: string): Promise<void> {
    // Slack doesn't have a direct typing indicator API for bots
    // This is a no-op
    void platformChatId;
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    if (!this.webClient) return;

    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) {
      log.warn(`Cannot edit Slack message ${platformMessageId}: channel not tracked`);
      return;
    }

    try {
      await this.webClient.chat.update({
        channel: channelId,
        ts: platformMessageId,
        text: newText,
      });
    } catch (error) {
      log.warn(`Failed to edit Slack message: ${getErrorMessage(error)}`);
    }
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    if (!this.webClient) return;

    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) {
      log.warn(`Cannot delete Slack message ${platformMessageId}: channel not tracked`);
      return;
    }

    try {
      await this.webClient.chat.delete({
        channel: channelId,
        ts: platformMessageId,
      });
      this.messageChatMap.delete(platformMessageId);
    } catch (error) {
      log.warn(`Failed to delete Slack message: ${getErrorMessage(error)}`);
    }
  }

  async reactToMessage(platformMessageId: string, emoji: string): Promise<void> {
    if (!this.webClient) return;

    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) return;

    try {
      await this.webClient.reactions.add({
        channel: channelId,
        timestamp: platformMessageId,
        name: emoji.replace(/:/g, ''), // Slack expects emoji name without colons
      });
    } catch (error) {
      log.warn(`Failed to react to Slack message: ${getErrorMessage(error)}`);
    }
  }

  // ==========================================================================
  // Message Tracking
  // ==========================================================================

  trackMessage(platformMessageId: string, channelId: string): void {
    if (this.messageChatMap.size >= MAX_MESSAGE_CHAT_MAP_SIZE) {
      const first = this.messageChatMap.keys().next().value;
      if (first !== undefined) this.messageChatMap.delete(first);
    }
    this.messageChatMap.set(platformMessageId, channelId);
  }

  // ==========================================================================
  // Private — Event Handling
  // ==========================================================================

  private async handleSlackEvent(event: SlackMessageEvent): Promise<void> {
    // Ignore bot's own messages
    if (event.user === this.botUserId) return;
    // Ignore subtypes (join, leave, etc.)
    if (event.subtype) return;

    // Channel filter
    if (this.allowedChannels.size > 0) {
      if (!this.allowedChannels.has(event.channel)) return;
    }

    // Resolve user info
    let sender: ChannelUser;
    try {
      sender = await this.resolveSlackUser(event.user ?? 'unknown');
    } catch {
      sender = {
        platformUserId: event.user ?? 'unknown',
        platform: 'slack',
        displayName: event.user ?? 'Unknown',
      };
    }

    // Extract attachments from files
    const attachments = this.extractAttachments(event);

    const channelMessage: ChannelIncomingMessage = {
      id: `${this.pluginId}:${event.ts}`,
      channelPluginId: this.pluginId,
      platform: 'slack',
      platformChatId: event.channel,
      sender,
      text: event.text ?? (attachments.length > 0 ? '[Attachment]' : ''),
      attachments: attachments.length > 0 ? attachments : undefined,
      replyToId: event.thread_ts ? `${this.pluginId}:${event.thread_ts}` : undefined,
      timestamp: new Date(parseFloat(event.ts) * 1000),
      metadata: {
        platformMessageId: event.ts,
        threadTs: event.thread_ts,
      },
    };

    this.trackMessage(event.ts, event.channel);

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel',
          this.pluginId,
          { message: channelMessage }
        )
      );
    } catch (err) {
      log.error('Failed to emit Slack message event:', err);
    }
  }

  private async resolveSlackUser(userId: string): Promise<ChannelUser> {
    if (!this.webClient) {
      return { platformUserId: userId, platform: 'slack', displayName: userId };
    }

    const result = await this.webClient.users.info({ user: userId });
    const user = result.user as
      | {
          id: string;
          real_name?: string;
          name?: string;
          profile?: { display_name?: string; image_48?: string };
          is_bot?: boolean;
        }
      | undefined;

    return {
      platformUserId: userId,
      platform: 'slack',
      displayName:
        user?.profile?.display_name || user?.real_name || user?.name || userId,
      username: user?.name,
      avatarUrl: user?.profile?.image_48,
      isBot: user?.is_bot,
    };
  }

  private extractAttachments(event: SlackMessageEvent): ChannelAttachment[] {
    if (!event.files) return [];

    return event.files.map((file) => {
      let type: ChannelAttachment['type'] = 'file';
      if (file.mimetype.startsWith('image/')) type = 'image';
      else if (file.mimetype.startsWith('audio/')) type = 'audio';
      else if (file.mimetype.startsWith('video/')) type = 'video';

      return {
        type,
        url: file.url_private,
        mimeType: file.mimetype,
        filename: file.name,
        size: file.size,
      };
    });
  }

  // ==========================================================================
  // Private — Connection Events
  // ==========================================================================

  private emitConnectionEvent(status: ChannelConnectionStatus): void {
    try {
      const eventBus = getEventBus();
      const eventName =
        status === 'connecting'
          ? ChannelEvents.CONNECTING
          : status === 'connected'
            ? ChannelEvents.CONNECTED
            : status === 'reconnecting'
              ? ChannelEvents.RECONNECTING
              : status === 'error'
                ? ChannelEvents.ERROR
                : ChannelEvents.DISCONNECTED;

      eventBus.emit(
        createEvent<ChannelConnectionEventData>(eventName, 'channel', this.pluginId, {
          channelPluginId: this.pluginId,
          platform: 'slack',
          status,
        })
      );
    } catch {
      // EventBus may not be ready during early boot
    }
  }
}
