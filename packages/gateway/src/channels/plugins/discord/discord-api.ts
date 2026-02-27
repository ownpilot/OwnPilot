/**
 * Discord Channel API
 *
 * Implements ChannelPluginAPI using the discord.js library.
 * Supports bot connections via WebSocket Gateway with Intents.
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
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from '../../utils/message-utils.js';

const log = getLog('Discord');

const DISCORD_MAX_LENGTH = PLATFORM_MESSAGE_LIMITS.discord ?? 2000;

// ============================================================================
// Types
// ============================================================================

interface DiscordChannelConfig {
  bot_token: string;
  application_id?: string;
  allowed_guilds?: string;
  allowed_channels?: string;
}

// ============================================================================
// Discord API
// ============================================================================

export class DiscordChannelAPI implements ChannelPluginAPI {
  private client: import('discord.js').Client | null = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: DiscordChannelConfig;
  private readonly pluginId: string;
  private allowedGuilds: Set<string> = new Set();
  private allowedChannels: Set<string> = new Set();
  private messageChatMap = new Map<string, string>();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = {
      bot_token: String(config.bot_token ?? ''),
      application_id: config.application_id ? String(config.application_id) : undefined,
      allowed_guilds: config.allowed_guilds ? String(config.allowed_guilds) : undefined,
      allowed_channels: config.allowed_channels ? String(config.allowed_channels) : undefined,
    };
    this.pluginId = pluginId;

    if (this.config.allowed_guilds) {
      for (const id of this.config.allowed_guilds.split(',')) {
        const trimmed = id.trim();
        if (trimmed) this.allowedGuilds.add(trimmed);
      }
    }
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
      throw new Error('Discord bot token is required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      // Dynamic import to avoid requiring discord.js as hard dependency
      const { Client, GatewayIntentBits, Partials } = await import('discord.js');

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      // Ready event
      this.client.once('ready', () => {
        this.status = 'connected';
        this.emitConnectionEvent('connected');
        const user = this.client?.user;
        log.info(
          `Discord bot connected as ${user?.tag ?? 'unknown'} (${user?.id ?? 'no-id'})`
        );
      });

      // Message handler
      this.client.on('messageCreate', (message) => {
        // Ignore bot's own messages
        if (message.author.bot) return;

        // Guild filter
        if (message.guild && this.allowedGuilds.size > 0) {
          if (!this.allowedGuilds.has(message.guild.id)) return;
        }

        // Channel filter
        if (this.allowedChannels.size > 0) {
          if (!this.allowedChannels.has(message.channel.id)) return;
        }

        this.handleIncomingMessage(message).catch((err) => {
          log.error('Failed to handle Discord message:', err);
        });
      });

      // Error handler
      this.client.on('error', (error) => {
        log.error('Discord client error:', error);
        this.status = 'error';
        this.emitConnectionEvent('error');
      });

      // Disconnection handler
      this.client.on('shardDisconnect', () => {
        log.warn('Discord client disconnected');
        this.status = 'disconnected';
        this.emitConnectionEvent('disconnected');
      });

      // Reconnection handler
      this.client.on('shardReconnecting', () => {
        log.info('Discord client reconnecting...');
        this.status = 'reconnecting';
        this.emitConnectionEvent('reconnecting');
      });

      this.client.on('shardResume', () => {
        log.info('Discord client resumed');
        this.status = 'connected';
        this.emitConnectionEvent('connected');
      });

      await this.client.login(this.config.bot_token);
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw new Error(`Failed to connect Discord bot: ${getErrorMessage(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;

    try {
      this.client.destroy();
      this.client = null;
      this.status = 'disconnected';
      this.emitConnectionEvent('disconnected');
      log.info('Discord bot disconnected');
    } catch (error) {
      log.error('Error disconnecting Discord bot:', error);
      this.status = 'disconnected';
      this.emitConnectionEvent('disconnected');
    }
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.client) throw new Error('Discord client not connected');

    const channel = await this.client.channels.fetch(message.platformChatId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Cannot send to channel ${message.platformChatId}`);
    }

    // We checked `'send' in channel` above — cast to the sendable subset
    const textChannel = channel as import('discord.js').TextChannel;
    const parts = splitMessage(message.text, DISCORD_MAX_LENGTH);
    let lastMessageId = '';

    for (let i = 0; i < parts.length; i++) {
      const options: import('discord.js').MessageCreateOptions = {
        content: parts[i],
      };

      // Reply to a specific message (first part only)
      if (i === 0 && message.replyToId) {
        options.reply = { messageReference: message.replyToId };
      }

      const sent = await textChannel.send(options);
      lastMessageId = sent.id;

      // Track for edit/delete
      this.trackMessage(sent.id, message.platformChatId);

      // Small delay between split messages
      if (i < parts.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return lastMessageId;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'discord';
  }

  // ==========================================================================
  // ChannelPluginAPI — Optional
  // ==========================================================================

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(platformChatId);
      if (channel && 'sendTyping' in channel) {
        await (channel as unknown as { sendTyping(): Promise<void> }).sendTyping();
      }
    } catch {
      // Non-fatal
    }
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    if (!this.client) return;

    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) {
      log.warn(`Cannot edit Discord message ${platformMessageId}: channel not tracked`);
      return;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const textChannel = channel as import('discord.js').TextBasedChannel & {
          messages: import('discord.js').MessageManager;
        };
        const msg = await textChannel.messages.fetch(platformMessageId);
        await msg.edit(newText);
      }
    } catch (error) {
      log.warn(`Failed to edit Discord message: ${getErrorMessage(error)}`);
    }
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    if (!this.client) return;

    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) {
      log.warn(`Cannot delete Discord message ${platformMessageId}: channel not tracked`);
      return;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const textChannel = channel as import('discord.js').TextBasedChannel & {
          messages: import('discord.js').MessageManager;
        };
        const msg = await textChannel.messages.fetch(platformMessageId);
        await msg.delete();
      }
      this.messageChatMap.delete(platformMessageId);
    } catch (error) {
      log.warn(`Failed to delete Discord message: ${getErrorMessage(error)}`);
    }
  }

  async reactToMessage(platformMessageId: string, emoji: string): Promise<void> {
    if (!this.client) return;

    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const textChannel = channel as import('discord.js').TextBasedChannel & {
          messages: import('discord.js').MessageManager;
        };
        const msg = await textChannel.messages.fetch(platformMessageId);
        await msg.react(emoji);
      }
    } catch (error) {
      log.warn(`Failed to react to Discord message: ${getErrorMessage(error)}`);
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
  // Private — Message Processing
  // ==========================================================================

  private async handleIncomingMessage(
    message: import('discord.js').Message
  ): Promise<void> {
    const sender: ChannelUser = {
      platformUserId: message.author.id,
      platform: 'discord',
      displayName:
        message.member?.displayName ?? message.author.displayName ?? message.author.username,
      username: message.author.username,
      avatarUrl: message.author.displayAvatarURL() ?? undefined,
      isBot: message.author.bot,
    };

    // Extract attachments
    const attachments = this.extractAttachments(message);

    // Build text content (include embeds as text if no direct content)
    let text = message.content ?? '';
    if (!text && message.embeds.length > 0) {
      text = message.embeds
        .map((e) => [e.title, e.description].filter(Boolean).join(': '))
        .join('\n');
    }

    const channelMessage: ChannelIncomingMessage = {
      id: `${this.pluginId}:${message.id}`,
      channelPluginId: this.pluginId,
      platform: 'discord',
      platformChatId: message.channel.id,
      sender,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyToId: message.reference?.messageId
        ? `${this.pluginId}:${message.reference.messageId}`
        : undefined,
      timestamp: message.createdAt,
      metadata: {
        platformMessageId: message.id,
        guildId: message.guild?.id,
        guildName: message.guild?.name,
        channelName:
          'name' in message.channel ? (message.channel as { name: string }).name : undefined,
        isDM: message.channel.isDMBased(),
      },
    };

    // Track message for edit/delete
    this.trackMessage(message.id, message.channel.id);

    // Emit event
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
      log.error('Failed to emit Discord message event:', err);
    }
  }

  private extractAttachments(message: import('discord.js').Message): ChannelAttachment[] {
    const result: ChannelAttachment[] = [];

    for (const attachment of message.attachments.values()) {
      let type: ChannelAttachment['type'] = 'file';
      const contentType = attachment.contentType ?? '';

      if (contentType.startsWith('image/')) type = 'image';
      else if (contentType.startsWith('audio/')) type = 'audio';
      else if (contentType.startsWith('video/')) type = 'video';

      result.push({
        type,
        url: attachment.url,
        mimeType: contentType || 'application/octet-stream',
        filename: attachment.name ?? undefined,
        size: attachment.size ?? undefined,
      });
    }

    return result;
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
          platform: 'discord',
          status,
        })
      );
    } catch {
      // EventBus may not be ready during early boot
    }
  }
}
