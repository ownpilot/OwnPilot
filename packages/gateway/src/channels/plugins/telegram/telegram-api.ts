/**
 * Telegram Channel API (grammy)
 *
 * Implements ChannelPluginAPI using the grammy library.
 * Handles long-polling, message normalization, and event emission.
 */

import { randomUUID } from 'node:crypto';
import { Bot } from 'grammy';
import type { Message, Update } from 'grammy/types';
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

const log = getLog('Telegram');

// ============================================================================
// Types
// ============================================================================

export interface TelegramChannelConfig {
  bot_token: string;
  allowed_users?: string;
  allowed_chats?: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
}

// ============================================================================
// Implementation
// ============================================================================

export class TelegramChannelAPI implements ChannelPluginAPI {
  private bot: Bot | null = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: TelegramChannelConfig;
  private readonly pluginId: string;
  private allowedUsers: Set<string> = new Set();
  private allowedChats: Set<string> = new Set();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as TelegramChannelConfig;
    this.pluginId = pluginId;

    // Parse allowed users/chats from comma-separated strings
    if (this.config.allowed_users) {
      this.config.allowed_users
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedUsers.add(id));
    }
    if (this.config.allowed_chats) {
      this.config.allowed_chats
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedChats.add(id));
    }
  }

  // --------------------------------------------------------------------------
  // ChannelPluginAPI
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.status === 'connected') return;
    if (!this.config.bot_token) {
      throw new Error('Telegram bot_token is required');
    }

    this.status = 'connecting';

    try {
      this.bot = new Bot(this.config.bot_token);

      // Register message handler
      this.bot.on('message', (ctx) => {
        this.handleIncomingMessage(ctx.message).catch((err) => {
          log.error('[Telegram] Error handling message:', err);
        });
      });

      // Handle /start command with welcome
      this.bot.command('start', async (ctx) => {
        await ctx.reply(
          'Welcome to OwnPilot! To verify your identity, generate a token in the OwnPilot web interface and send:\n/connect YOUR_TOKEN'
        );
      });

      // Start long-polling (non-blocking)
      this.bot.start({
        onStart: () => {
          this.status = 'connected';
          log.info('[Telegram] Bot connected and polling');
          this.emitConnectionEvent('connected');
        },
      });

      // Handle errors
      this.bot.catch((err) => {
        log.error('[Telegram] Bot error:', err);
        this.status = 'error';
        this.emitConnectionEvent('error');
      });
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.bot) {
      throw new Error('Telegram bot is not connected');
    }

    const chatId = message.platformChatId;
    const options: Record<string, unknown> = {};

    // Parse mode
    if (this.config.parse_mode) {
      options.parse_mode = this.config.parse_mode;
    }

    // Reply-to
    if (message.replyToId) {
      // replyToId could be "pluginId:messageId" format
      const msgId = message.replyToId.includes(':')
        ? message.replyToId.split(':').pop()
        : message.replyToId;
      if (msgId && !isNaN(Number(msgId))) {
        options.reply_parameters = { message_id: Number(msgId) };
      }
    }

    const sent = await this.bot.api.sendMessage(chatId, message.text, options);
    return String(sent.message_id);
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'telegram';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendChatAction(platformChatId, 'typing').catch(() => {});
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    // editMessage requires chat_id which we don't track per message.
    // This is a known limitation - would need message-to-chat mapping.
    log.warn('[Telegram] editMessage not yet supported (requires chat_id tracking)');
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    log.warn('[Telegram] deleteMessage not yet supported (requires chat_id tracking)');
  }

  async resolveUser(platformUserId: string): Promise<ChannelUser | null> {
    if (!this.bot) return null;
    try {
      // grammy doesn't have getUser, but we can try getChatMember-like approaches
      // For now, return null - user resolution happens through channel_users table
      return null;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Private: Message Processing
  // --------------------------------------------------------------------------

  private async handleIncomingMessage(message: Message): Promise<void> {
    // Skip non-text messages for now (handle attachments in future)
    if (!message.text && !message.caption) return;

    const userId = String(message.from?.id ?? '');
    const chatId = String(message.chat.id);

    // Access control
    if (this.allowedUsers.size > 0 && !this.allowedUsers.has(userId)) {
      return;
    }
    if (this.allowedChats.size > 0 && !this.allowedChats.has(chatId)) {
      return;
    }

    // Build normalized message
    const sender: ChannelUser = {
      platformUserId: userId,
      platform: 'telegram',
      displayName:
        [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') ||
        'Unknown',
      username: message.from?.username,
      isBot: message.from?.is_bot,
    };

    // Collect attachments
    const attachments = this.extractAttachments(message);

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${message.message_id}`,
      channelPluginId: this.pluginId,
      platform: 'telegram',
      platformChatId: chatId,
      sender,
      text: message.text ?? message.caption ?? '',
      attachments: attachments.length > 0 ? attachments : undefined,
      replyToId: message.reply_to_message
        ? `${this.pluginId}:${message.reply_to_message.message_id}`
        : undefined,
      timestamp: new Date(message.date * 1000),
      metadata: {
        platformMessageId: message.message_id,
        chatType: message.chat.type,
        chatTitle: 'title' in message.chat ? message.chat.title : undefined,
      },
    };

    // Emit via EventBus
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
      log.error('[Telegram] Failed to emit message event:', err);
    }
  }

  private extractAttachments(message: Message): ChannelAttachment[] {
    const attachments: ChannelAttachment[] = [];

    if (message.photo && message.photo.length > 0) {
      // Pick largest photo (last in array)
      const largest = message.photo[message.photo.length - 1]!;
      attachments.push({
        type: 'image',
        mimeType: 'image/jpeg',
        filename: `photo_${largest.file_id}.jpg`,
        size: largest.file_size,
      });
    }

    if (message.document) {
      attachments.push({
        type: 'file',
        mimeType: message.document.mime_type ?? 'application/octet-stream',
        filename: message.document.file_name ?? `doc_${message.document.file_id}`,
        size: message.document.file_size,
      });
    }

    if (message.audio) {
      attachments.push({
        type: 'audio',
        mimeType: message.audio.mime_type ?? 'audio/mpeg',
        filename: message.audio.file_name ?? `audio_${message.audio.file_id}`,
        size: message.audio.file_size,
      });
    }

    if (message.video) {
      attachments.push({
        type: 'video',
        mimeType: message.video.mime_type ?? 'video/mp4',
        filename: message.video.file_name ?? `video_${message.video.file_id}`,
        size: message.video.file_size,
      });
    }

    if (message.voice) {
      attachments.push({
        type: 'audio',
        mimeType: message.voice.mime_type ?? 'audio/ogg',
        filename: `voice_${message.voice.file_id}.ogg`,
        size: message.voice.file_size,
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
          'channel' as any,
          this.pluginId,
          {
            channelPluginId: this.pluginId,
            platform: 'telegram',
            status,
          }
        )
      );
    } catch {
      // EventBus not ready
    }
  }
}
