/**
 * Discord Channel Adapter
 *
 * Uses Discord.js for bot communication
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  type Message as DiscordMessage,
  type TextChannel,
  type DMChannel,
  type NewsChannel,
  type User as DiscordUser,
  type Guild,
  type OmitPartialGroupDMChannel,
} from 'discord.js';
import type { IncomingMessage, OutgoingMessage, Attachment } from '../../ws/types.js';
import type { DiscordConfig, ChannelSender } from '../types.js';
import { BaseChannelAdapter } from '../base-adapter.js';

/**
 * Type for text-based channels that support sending messages
 */
type SendableChannel = TextChannel | DMChannel | NewsChannel;

/**
 * Discord Channel Adapter
 */
export class DiscordAdapter extends BaseChannelAdapter {
  private readonly botToken: string;
  private readonly applicationId: string;
  private readonly allowedGuilds: Set<string>;
  private readonly allowedChannels: Set<string>;
  private readonly allowDMs: boolean;
  private client: Client | null = null;

  constructor(config: DiscordConfig) {
    super(config);
    this.botToken = config.botToken;
    this.applicationId = config.applicationId;
    this.allowedGuilds = new Set(config.allowedGuilds ?? []);
    this.allowedChannels = new Set(config.allowedChannels ?? []);
    this.allowDMs = config.allowDMs ?? true;
  }

  /**
   * Connect to Discord
   */
  async connect(): Promise<void> {
    this.setStatus('connecting');

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.GuildMessageReactions,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      // Setup event handlers
      this.setupEventHandlers();

      // Login
      await this.client.login(this.botToken);

      // Wait for ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Discord connection timeout'));
        }, 30000);

        this.client!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      console.log(`[discord:${this.id}] Connected as ${this.client.user?.tag}`);
      this.setStatus('connected');
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'Connection failed');
      throw error;
    }
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.setStatus('disconnected');
    this.cleanup();
  }

  /**
   * Send a message
   */
  async sendMessage(message: OutgoingMessage): Promise<string> {
    if (!this.client) {
      throw new Error('Discord client not connected');
    }

    const channel = await this.resolveChannel(message.channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${message.channelId}`);
    }

    const options: {
      content: string;
      reply?: { messageReference: string };
    } = {
      content: message.content,
    };

    if (message.replyToId) {
      options.reply = { messageReference: message.replyToId };
    }

    const sent = await channel.send(options);
    return sent.id;
  }

  /**
   * Send typing indicator
   */
  override async sendTyping(chatId: string): Promise<void> {
    if (!this.client) return;

    const channel = await this.resolveChannel(chatId);
    if (channel && 'sendTyping' in channel) {
      await channel.sendTyping();
    }
  }

  /**
   * Edit a message
   */
  override async editMessage(messageId: string, content: string): Promise<void> {
    // Note: Would need channel ID to edit. For now, throw.
    throw new Error('Edit requires channel ID tracking - use message metadata');
  }

  /**
   * Delete a message
   */
  override async deleteMessage(messageId: string): Promise<void> {
    // Note: Would need channel ID to delete
    throw new Error('Delete requires channel ID tracking - use message metadata');
  }

  /**
   * React to a message
   */
  override async reactToMessage(messageId: string, emoji: string): Promise<void> {
    // Note: Would need channel ID and message reference
    throw new Error('React requires channel ID tracking - use message metadata');
  }

  /**
   * Get sender info
   */
  override async getSenderInfo(senderId: string): Promise<ChannelSender | null> {
    if (!this.client) return null;

    try {
      const user = await this.client.users.fetch(senderId);
      return {
        id: user.id,
        name: user.displayName || user.username,
        username: user.username,
        avatarUrl: user.displayAvatarURL(),
        isBot: user.bot,
      };
    } catch {
      return null;
    }
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // Message received
    this.client.on('messageCreate', async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Check if message is allowed
      if (!this.isMessageAllowed(message)) return;

      const incomingMessage = this.convertMessage(message);
      this.emit('message', incomingMessage);
    });

    // Disconnection
    this.client.on('disconnect', () => {
      console.log(`[discord:${this.id}] Disconnected`);
      this.setStatus('disconnected');
      this.handleReconnect();
    });

    // Error
    this.client.on('error', (error) => {
      console.error(`[discord:${this.id}] Error:`, error);
      this.emit('error', error);
    });

    // Rate limit warning
    this.client.on('rateLimit', (info) => {
      console.warn(`[discord:${this.id}] Rate limited:`, info);
    });
  }

  /**
   * Check if a message should be processed
   */
  private isMessageAllowed(message: DiscordMessage): boolean {
    // Check DMs
    if (!message.guild) {
      return this.allowDMs;
    }

    // Check guild restrictions
    if (this.allowedGuilds.size > 0 && !this.allowedGuilds.has(message.guild.id)) {
      return false;
    }

    // Check channel restrictions
    if (this.allowedChannels.size > 0 && !this.allowedChannels.has(message.channel.id)) {
      return false;
    }

    return true;
  }

  /**
   * Convert Discord message to IncomingMessage
   */
  private convertMessage(message: OmitPartialGroupDMChannel<DiscordMessage<boolean>>): IncomingMessage {
    const attachments: Attachment[] = message.attachments.map((att) => ({
      type: this.getAttachmentType(att.contentType ?? ''),
      mimeType: att.contentType ?? 'application/octet-stream',
      url: att.url,
      filename: att.name ?? undefined,
      size: att.size,
    }));

    return {
      id: message.id,
      channelId: this.id,
      channelType: 'discord',
      senderId: message.author.id,
      senderName: message.member?.displayName ?? message.author.displayName ?? message.author.username,
      content: message.content,
      timestamp: message.createdAt,
      replyToId: message.reference?.messageId ?? undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        guildId: message.guild?.id,
        guildName: message.guild?.name,
        channelId: message.channel.id,
        channelName: 'name' in message.channel ? message.channel.name : 'DM',
        isDM: !message.guild,
        authorId: message.author.id,
        authorUsername: message.author.username,
      },
    };
  }

  /**
   * Get attachment type from MIME type
   */
  private getAttachmentType(mimeType: string): Attachment['type'] {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'file';
  }

  /**
   * Resolve a channel ID to a Discord channel
   */
  private async resolveChannel(channelId: string): Promise<SendableChannel | null> {
    if (!this.client) return null;

    try {
      // Channel ID might be in format "guildId:channelId" or just "channelId"
      const parts = channelId.split(':');
      const discordChannelId = parts.length > 1 ? parts[1]! : parts[0]!;

      const channel = await this.client.channels.fetch(discordChannelId);

      if (channel && this.isSendableChannel(channel)) {
        return channel;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Type guard for sendable channels
   */
  private isSendableChannel(channel: unknown): channel is SendableChannel {
    return (
      channel !== null &&
      typeof channel === 'object' &&
      'send' in channel &&
      typeof (channel as { send: unknown }).send === 'function'
    );
  }
}

/**
 * Factory function for Discord adapter
 */
export function createDiscordAdapter(config: DiscordConfig): DiscordAdapter {
  return new DiscordAdapter(config);
}
