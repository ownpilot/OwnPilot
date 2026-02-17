/**
 * Discord Channel API (discord.js)
 *
 * Implements ChannelPluginAPI using discord.js v14.
 * Handles WebSocket connection, message normalization, and event emission.
 *
 * Behavior:
 * - In guild channels: only responds to messages that @mention the bot
 * - In DMs: responds to all messages
 * - Access control via guild_ids and allowed_channels config fields
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

// ============================================================================
// Types
// ============================================================================

export interface DiscordChannelConfig {
  bot_token: string;
  /** Comma-separated guild IDs to allow. Empty = all guilds. */
  guild_ids?: string;
  /** Comma-separated channel IDs to allow. Empty = all channels. */
  allowed_channels?: string;
}

// ============================================================================
// Implementation
// ============================================================================

export class DiscordChannelAPI implements ChannelPluginAPI {
  private client: import('discord.js').Client | null = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: DiscordChannelConfig;
  private readonly pluginId: string;
  private allowedGuilds = new Set<string>();
  private allowedChannels = new Set<string>();
  /** Maps platformMessageId → channelId for recent outgoing messages (edit/delete support) */
  private messageChatMap = new Map<string, string>();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as DiscordChannelConfig;
    this.pluginId = pluginId;

    if (this.config.guild_ids) {
      this.config.guild_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedGuilds.add(id));
    }
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
    if (!this.config.bot_token) {
      throw new Error('Discord bot_token is required');
    }

    // Clean up existing client
    if (this.client) {
      try { this.client.destroy(); } catch { /* already destroyed */ }
      this.client = null;
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      const { Client, GatewayIntentBits } = await import('discord.js');

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      this.client.on('messageCreate', (message) => {
        if (message.author.bot) return;
        this.handleIncomingMessage(message).catch((err) => {
          log.error('Error handling message:', err);
        });
      });

      this.client.on('error', (err) => {
        log.error('Client error:', err);
        this.status = 'error';
        this.emitConnectionEvent('error');
      });

      // Login and wait for ready
      await this.client.login(this.config.bot_token);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Discord login timed out (30s)')),
          30_000,
        );
        this.client!.once('ready', () => {
          clearTimeout(timeout);
          this.status = 'connected';
          log.info(`Bot connected as ${this.client!.user?.tag}`);
          this.emitConnectionEvent('connected');
          resolve();
        });
      });
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.client) throw new Error('Discord client is not connected');

    const channel = await this.client.channels.fetch(message.platformChatId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Discord channel ${message.platformChatId} not found or not text-based`);
    }

    const parts = splitMessage(message.text, PLATFORM_MESSAGE_LIMITS.discord ?? 2000);
    let lastMessageId = '';

    for (let i = 0; i < parts.length; i++) {
      const sendOptions: Record<string, unknown> = { content: parts[i] };

      // Reply to specific message (first part only)
      if (i === 0 && message.replyToId) {
        const discordMsgId = message.replyToId.includes(':')
          ? message.replyToId.split(':').pop()
          : message.replyToId;
        if (discordMsgId) {
          sendOptions.reply = { messageReference: discordMsgId };
        }
      }

      const sent = await (channel as { send(opts: Record<string, unknown>): Promise<{ id: string }> }).send(sendOptions);
      lastMessageId = sent.id;

      // Track for edit/delete
      if (this.messageChatMap.size >= MAX_MESSAGE_CHAT_MAP_SIZE) {
        const oldest = this.messageChatMap.keys().next().value;
        if (oldest) this.messageChatMap.delete(oldest);
      }
      this.messageChatMap.set(lastMessageId, message.platformChatId);

      // Small delay between split messages
      if (parts.length > 1 && i < parts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
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

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(platformChatId);
      if (channel?.isTextBased()) {
        await (channel as { sendTyping(): Promise<void> }).sendTyping();
      }
    } catch (err) {
      log.debug('Typing indicator failed', { channelId: platformChatId, error: err });
    }
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    if (!this.client) throw new Error('Discord client is not connected');
    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) {
      log.warn('editMessage: no channelId found', { platformMessageId });
      return;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = await (channel as any).messages.fetch(platformMessageId);
      await msg.edit(newText);
    } catch (err) {
      log.warn('editMessage failed', { platformMessageId, error: getErrorMessage(err) });
    }
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    if (!this.client) throw new Error('Discord client is not connected');
    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) {
      log.warn('deleteMessage: no channelId found', { platformMessageId });
      return;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = await (channel as any).messages.fetch(platformMessageId);
      await msg.delete();
      this.messageChatMap.delete(platformMessageId);
    } catch (err) {
      log.warn('deleteMessage failed', { platformMessageId, error: getErrorMessage(err) });
    }
  }

  async reactToMessage(platformMessageId: string, emoji: string): Promise<void> {
    if (!this.client) return;
    const channelId = this.messageChatMap.get(platformMessageId);
    if (!channelId) return;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = await (channel as any).messages.fetch(platformMessageId);
      await msg.react(emoji);
    } catch (err) {
      log.debug('React failed', { platformMessageId, error: err });
    }
  }

  async resolveUser(platformUserId: string): Promise<ChannelUser | null> {
    if (!this.client) return null;
    try {
      const user = await this.client.users.fetch(platformUserId);
      return {
        platformUserId: user.id,
        platform: 'discord',
        displayName: user.displayName ?? user.username,
        username: user.username,
        avatarUrl: user.avatarURL() ?? undefined,
        isBot: user.bot,
      };
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Private: Message Processing
  // --------------------------------------------------------------------------

  private async handleIncomingMessage(message: import('discord.js').Message): Promise<void> {
    if (!message.content && message.attachments.size === 0) return;

    const userId = message.author.id;
    const channelId = message.channelId;
    const guildId = message.guildId;

    // Access control: guild whitelist
    if (guildId && this.allowedGuilds.size > 0 && !this.allowedGuilds.has(guildId)) return;

    // Access control: channel whitelist
    if (this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId)) return;

    // In guild channels, only respond to messages that mention the bot
    const isDM = !guildId;
    const mentionsBot = this.client?.user && message.mentions.has(this.client.user);
    if (!isDM && !mentionsBot) return;

    // Strip bot mention from text
    let text = message.content;
    if (this.client?.user) {
      text = text.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
    }

    const sender: ChannelUser = {
      platformUserId: userId,
      platform: 'discord',
      displayName:
        message.member?.displayName ??
        message.author.displayName ??
        message.author.username,
      username: message.author.username,
      avatarUrl: message.author.avatarURL() ?? undefined,
      isBot: message.author.bot,
    };

    const attachments = this.extractAttachments(message);

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${message.id}`,
      channelPluginId: this.pluginId,
      platform: 'discord',
      platformChatId: channelId,
      sender,
      text: text || '(attachment)',
      attachments: attachments.length > 0 ? attachments : undefined,
      replyToId: message.reference?.messageId
        ? `${this.pluginId}:${message.reference.messageId}`
        : undefined,
      timestamp: message.createdAt,
      metadata: {
        platformMessageId: message.id,
        guildId,
        guildName: message.guild?.name,
        channelName: 'name' in message.channel ? (message.channel as { name: string }).name : undefined,
        isDM,
      },
    };

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel',
          this.pluginId,
          { message: normalized },
        ),
      );
    } catch (err) {
      log.error('Failed to emit message event:', err);
    }
  }

  private extractAttachments(message: import('discord.js').Message): ChannelAttachment[] {
    const attachments: ChannelAttachment[] = [];
    for (const [, attachment] of message.attachments) {
      const type = attachment.contentType?.startsWith('image/')
        ? 'image'
        : attachment.contentType?.startsWith('audio/')
          ? 'audio'
          : attachment.contentType?.startsWith('video/')
            ? 'video'
            : 'file';
      attachments.push({
        type,
        url: attachment.url,
        mimeType: attachment.contentType ?? 'application/octet-stream',
        filename: attachment.name ?? undefined,
        size: attachment.size,
      });
    }
    return attachments;
  }

  // --------------------------------------------------------------------------
  // Private: Event Helpers
  // --------------------------------------------------------------------------

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
          'channel',
          this.pluginId,
          {
            channelPluginId: this.pluginId,
            platform: 'discord',
            status,
          },
        ),
      );
    } catch {
      // EventBus not ready
    }
  }
}
