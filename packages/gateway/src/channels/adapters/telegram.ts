/**
 * Telegram Channel Adapter
 *
 * Uses Telegram Bot API for communication
 */

import type { IncomingMessage, OutgoingMessage, Attachment } from '../../ws/types.js';
import type { TelegramConfig, ChannelSender } from '../types.js';
import { BaseChannelAdapter } from '../base-adapter.js';

/**
 * Telegram API response wrapper
 */
interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * Telegram Update object
 */
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Telegram Message object
 */
interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  audio?: TelegramAudio;
  video?: TelegramVideo;
  voice?: TelegramVoice;
}

/**
 * Telegram User object
 */
interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram Chat object
 */
interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Telegram file objects
 */
interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

/**
 * Bot info returned from Telegram getMe API
 */
export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
  isBot: boolean;
}

/**
 * Telegram Channel Adapter
 */
export class TelegramAdapter extends BaseChannelAdapter {
  private readonly botToken: string;
  private readonly apiBase: string;
  private readonly allowedUsers: Set<number>;
  private readonly allowedChats: Set<number>;
  private readonly parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' | undefined;
  private pollingTimer: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;
  private isPolling = false;
  private _botInfo: TelegramBotInfo | null = null;

  constructor(config: TelegramConfig) {
    super(config);
    this.botToken = config.botToken;
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
    this.allowedUsers = new Set(config.allowedUsers ?? []);
    this.allowedChats = new Set(config.allowedChats ?? []);
    this.parseMode = config.parseMode ?? 'Markdown'; // Default to Markdown
  }

  /**
   * Connect to Telegram (start polling)
   */
  async connect(): Promise<void> {
    this.setStatus('connecting');

    try {
      // Verify bot token and get bot info
      const me = await this.callApi<TelegramUser>('getMe');

      // Store bot info for later use
      this._botInfo = {
        id: me.id,
        username: me.username ?? 'unknown',
        firstName: me.first_name,
        isBot: me.is_bot,
      };

      console.log(`[telegram:${this.id}] Connected as @${this._botInfo.username} (ID: ${this._botInfo.id})`);

      this.setStatus('connected');
      this.startPolling();
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'Connection failed');
      throw error;
    }
  }

  /**
   * Get bot info (username, id, etc.)
   */
  get botInfo(): TelegramBotInfo | null {
    return this._botInfo;
  }

  /**
   * Disconnect from Telegram (stop polling)
   */
  async disconnect(): Promise<void> {
    this.stopPolling();
    this.setStatus('disconnected');
    this.cleanup();
  }

  /**
   * Send a message
   */
  async sendMessage(message: OutgoingMessage): Promise<string> {
    // Try to get chatId from channelId format "adapterId:chatId", or from metadata.chatId
    let chatId: number;
    try {
      chatId = this.parseChatId(message.channelId);
    } catch {
      // Fallback: check metadata.chatId
      const metaChatId = message.metadata?.chatId;
      if (metaChatId) {
        chatId = typeof metaChatId === 'number' ? metaChatId : parseInt(String(metaChatId), 10);
      } else {
        throw new Error(
          `No Telegram chat ID found. Provide chatId in the request body or metadata. ` +
          `channelId was: "${message.channelId}"`
        );
      }
      if (isNaN(chatId)) {
        throw new Error(`Invalid chatId value: "${metaChatId}"`);
      }
    }

    const params: Record<string, unknown> = {
      chat_id: chatId,
      text: message.content,
      ...(this.parseMode && { parse_mode: this.parseMode }),
    };

    // Parse replyToId - can be "chatId:messageId" format or just "messageId"
    // Also check metadata for messageId as fallback
    if (message.replyToId) {
      const messageId = this.parseMessageId(message.replyToId);
      if (messageId > 0) {
        params.reply_to_message_id = messageId;
      }
    } else if (message.metadata?.messageId) {
      // Use messageId from metadata as fallback
      const messageId = typeof message.metadata.messageId === 'number'
        ? message.metadata.messageId
        : parseInt(String(message.metadata.messageId), 10);
      if (messageId > 0) {
        params.reply_to_message_id = messageId;
      }
    }

    try {
      const result = await this.callApi<TelegramMessage>('sendMessage', params);
      console.log(`[telegram:${this.id}] Sent message ${result.message_id} to chat ${chatId}`);
      return result.message_id.toString();
    } catch (error) {
      console.error(`[telegram:${this.id}] Failed to send message to chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Parse message ID from various formats
   * Handles: "chatId:messageId", "messageId", or metadata
   */
  private parseMessageId(idString: string): number {
    // If it contains ":", take the last part (messageId)
    if (idString.includes(':')) {
      const parts = idString.split(':');
      const messageIdStr = parts[parts.length - 1];
      return parseInt(messageIdStr ?? '0', 10);
    }
    // Otherwise parse directly
    return parseInt(idString, 10);
  }

  /**
   * Send typing indicator
   */
  override async sendTyping(chatId: string): Promise<void> {
    await this.callApi('sendChatAction', {
      chat_id: this.parseChatId(chatId),
      action: 'typing',
    });
  }

  /**
   * Edit a message
   */
  override async editMessage(messageId: string, content: string): Promise<void> {
    // Note: Telegram requires chat_id for editing, we need to track this
    throw new Error('Edit requires chat_id tracking - not yet implemented');
  }

  /**
   * Delete a message
   */
  override async deleteMessage(messageId: string): Promise<void> {
    // Note: Telegram requires chat_id for deletion
    throw new Error('Delete requires chat_id tracking - not yet implemented');
  }

  /**
   * Get sender info
   */
  override async getSenderInfo(senderId: string): Promise<ChannelSender | null> {
    try {
      // Telegram doesn't have a direct getUserInfo API
      // We'd need to cache user info from messages
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Start polling for updates
   */
  private startPolling(): void {
    if (this.isPolling) return;

    this.isPolling = true;
    this.poll();
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    this.isPolling = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Poll for updates
   */
  private async poll(): Promise<void> {
    if (!this.isPolling) return;

    try {
      const updates = await this.callApi<TelegramUpdate[]>('getUpdates', {
        offset: this.lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      });

      for (const update of updates) {
        this.lastUpdateId = update.update_id;
        await this.handleUpdate(update);
      }
    } catch (error) {
      console.error(`[telegram:${this.id}] Polling error:`, error);

      // If we're still connected, try to reconnect
      if (this._status === 'connected') {
        this.setStatus('reconnecting');
        await this.handleReconnect();
        return;
      }
    }

    // Continue polling
    if (this.isPolling) {
      this.pollingTimer = setTimeout(() => this.poll(), 100);
    }
  }

  /**
   * Handle an update
   */
  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message ?? update.edited_message;

    if (message) {
      // Check if sender/chat is allowed
      if (!this.isAllowed(message)) {
        console.log(
          `[telegram:${this.id}] Ignoring message from unauthorized user/chat: ${message.from?.id}/${message.chat.id}`
        );
        return;
      }

      // Handle /start command with a welcome message
      if (message.text?.startsWith('/start')) {
        await this.handleStartCommand(message);
        return;
      }

      const incomingMessage = this.convertMessage(message);
      this.emit('message', incomingMessage);
    }

    if (update.callback_query) {
      // Handle callback queries (button clicks)
      console.log(`[telegram:${this.id}] Callback query:`, update.callback_query.data);
    }
  }

  /**
   * Handle /start command
   */
  private async handleStartCommand(message: TelegramMessage): Promise<void> {
    const senderName = this.formatSenderName(message.from);
    const welcomeMessage = `Merhaba ${senderName}! 👋

OwnPilot AI asistanına hoş geldiniz.

Bana herhangi bir soru sorabilir veya yardım isteyebilirsiniz. Mesajlarınız AI tarafından işlenecek ve size cevap verilecektir.

Nasıl yardımcı olabilirim?`;

    try {
      await this.callApi('sendMessage', {
        chat_id: message.chat.id,
        text: welcomeMessage,
      });
      console.log(`[telegram:${this.id}] Sent welcome message to ${senderName} (chat: ${message.chat.id})`);
    } catch (error) {
      console.error(`[telegram:${this.id}] Failed to send welcome message:`, error);
    }
  }

  /**
   * Check if a message is from an allowed user/chat
   */
  private isAllowed(message: TelegramMessage): boolean {
    // If no restrictions, allow all
    if (this.allowedUsers.size === 0 && this.allowedChats.size === 0) {
      return true;
    }

    // Check user
    if (message.from && this.allowedUsers.has(message.from.id)) {
      return true;
    }

    // Check chat
    if (this.allowedChats.has(message.chat.id)) {
      return true;
    }

    return false;
  }

  /**
   * Convert Telegram message to IncomingMessage
   */
  private convertMessage(message: TelegramMessage): IncomingMessage {
    const attachments: Attachment[] = [];

    // Handle photos
    if (message.photo && message.photo.length > 0) {
      // Get largest photo
      const photo = message.photo[message.photo.length - 1];
      if (photo) {
        attachments.push({
          type: 'image',
          mimeType: 'image/jpeg',
          url: `telegram://file/${photo.file_id}`,
          size: photo.file_size,
        });
      }
    }

    // Handle documents
    if (message.document) {
      attachments.push({
        type: 'file',
        mimeType: message.document.mime_type ?? 'application/octet-stream',
        url: `telegram://file/${message.document.file_id}`,
        filename: message.document.file_name,
        size: message.document.file_size,
      });
    }

    // Handle audio
    if (message.audio) {
      attachments.push({
        type: 'audio',
        mimeType: message.audio.mime_type ?? 'audio/mpeg',
        url: `telegram://file/${message.audio.file_id}`,
        filename: message.audio.file_name,
        size: message.audio.file_size,
      });
    }

    // Handle video
    if (message.video) {
      attachments.push({
        type: 'video',
        mimeType: message.video.mime_type ?? 'video/mp4',
        url: `telegram://file/${message.video.file_id}`,
        filename: message.video.file_name,
        size: message.video.file_size,
      });
    }

    // Handle voice
    if (message.voice) {
      attachments.push({
        type: 'audio',
        mimeType: message.voice.mime_type ?? 'audio/ogg',
        url: `telegram://file/${message.voice.file_id}`,
        size: message.voice.file_size,
      });
    }

    return {
      id: `${message.chat.id}:${message.message_id}`,
      // Use format "adapterId:chatId" so sendMessage can extract the chat ID
      channelId: `${this.id}:${message.chat.id}`,
      channelType: 'telegram',
      senderId: message.from?.id.toString() ?? 'unknown',
      senderName: this.formatSenderName(message.from),
      content: message.text ?? message.caption ?? '',
      timestamp: new Date(message.date * 1000),
      replyToId: message.reply_to_message
        ? message.reply_to_message.message_id.toString()
        : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        chatId: message.chat.id,
        chatType: message.chat.type,
        chatTitle: message.chat.title,
        messageId: message.message_id,
      },
    };
  }

  /**
   * Format sender name
   */
  private formatSenderName(user?: TelegramUser): string {
    if (!user) return 'Unknown';

    const parts = [user.first_name];
    if (user.last_name) parts.push(user.last_name);

    return parts.join(' ');
  }

  /**
   * Parse chat ID from channel ID
   * Handles formats: "adapterId:chatId", "chatId", or numeric chatId
   */
  private parseChatId(channelId: string): number {
    // Channel ID format: "adapterId:chatId" or just "chatId"
    // Always take the last part as chat ID
    const parts = channelId.split(':');
    const chatIdStr = parts[parts.length - 1];
    const chatId = parseInt(chatIdStr ?? '0', 10);

    if (isNaN(chatId) || chatId === 0) {
      throw new Error(
        `Invalid Telegram chat ID from channelId "${channelId}". ` +
        `Please provide a chatId in the request body (e.g., { "chatId": 123456789 }).`
      );
    }

    return chatId;
  }

  /**
   * Call Telegram API
   */
  private async callApi<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.apiBase}/${method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: params ? JSON.stringify(params) : undefined,
    });

    const data = (await response.json()) as TelegramResponse<T>;

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description} (${data.error_code})`);
    }

    return data.result!;
  }
}

/**
 * Factory function for Telegram adapter
 */
export function createTelegramAdapter(config: TelegramConfig): TelegramAdapter {
  return new TelegramAdapter(config);
}
