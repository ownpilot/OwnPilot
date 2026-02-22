/**
 * Telegram Channel API (grammy)
 *
 * Implements ChannelPluginAPI using the grammy library.
 * Supports both long-polling (default) and webhook mode.
 * Handles message normalization, and event emission.
 */

import { randomBytes } from 'node:crypto';
import { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import {
  registerApprovalHandler,
  requestTelegramApproval,
  clearPendingApprovals,
} from './approval-handler.js';
import { TelegramProgressManager } from './progress-manager.js';
import { downloadTelegramAttachments } from './file-handler.js';
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
import { markdownToTelegramHtml } from '../../utils/markdown-telegram.js';

const log = getLog('Telegram');

/** Detect Telegram "can't parse entities" errors so we can retry as plain text. */
function isParseEntityError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("can't parse entities") || msg.includes("can't find end of the entity");
}

// ============================================================================
// Types
// ============================================================================

export interface TelegramChannelConfig {
  bot_token: string;
  allowed_users?: string;
  allowed_chats?: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  /** Public HTTPS base URL for webhook mode. Empty/undefined = polling mode. */
  webhook_url?: string;
  /** Secret token for webhook URL path. Auto-generated if webhook_url is set but this is empty. */
  webhook_secret?: string;
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
  /** Maps platformMessageId → chatId for recent outgoing messages (edit/delete support) */
  private messageChatMap = new Map<string, string>();
  /** True when connected via webhook (vs polling). Used by disconnect() for cleanup. */
  private webhookMode = false;

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
    if (this.status === 'connected' || this.status === 'connecting') return;
    if (!this.config.bot_token) {
      throw new Error('Telegram bot_token is required');
    }

    // Clean up any existing bot instance (e.g. reconnecting after error)
    if (this.bot) {
      try {
        this.bot.stop();
      } catch {
        /* already stopped */
      }
      this.bot = null;
    }
    this.webhookMode = false;

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      this.bot = new Bot(this.config.bot_token);

      // Register inline keyboard approval handler
      registerApprovalHandler(this.bot);

      // ── Command handlers (MUST be registered BEFORE bot.on('message')!) ──
      // Grammy's middleware chain is sequential: if bot.on('message') runs first
      // and never calls next(), command handlers are never reached.
      // By registering commands first, /start etc. match and handle, while
      // non-command messages fall through via Grammy's pass() to the generic handler.

      // Handle /start command with welcome
      this.bot.command('start', async (ctx) => {
        await ctx.reply(
          'Welcome to OwnPilot! To verify your identity, generate a token in the OwnPilot web interface and send:\n/connect YOUR_TOKEN'
        );
      });

      // /model — Set or show the preferred AI model
      this.bot.command('model', async (ctx) => {
        const args = (ctx.message?.text ?? '').split(' ').slice(1).join(' ').trim();
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? '');

        try {
          const { channelUsersRepo } = await import('../../../db/repositories/channel-users.js');
          const { channelSessionsRepo } =
            await import('../../../db/repositories/channel-sessions.js');

          const user = await channelUsersRepo.findByPlatform('telegram', userId);
          if (!user) {
            await ctx.reply('Please verify your identity first with /connect YOUR_TOKEN');
            return;
          }

          const session = await channelSessionsRepo.findActive(user.id, this.pluginId, chatId);
          if (!session) {
            await ctx.reply('No active session. Send a message first to start one.');
            return;
          }

          if (!args) {
            const current = (session.context?.preferredModel as string) || 'default';
            await ctx.reply(
              `Current model: <code>${current}</code>\n\nUsage: /model &lt;name&gt;\nExamples:\n/model gpt-4o\n/model claude-sonnet-4-5-20250514\n/model default`,
              { parse_mode: 'HTML' }
            );
            return;
          }

          const modelName = args === 'default' ? undefined : args;
          await channelSessionsRepo.updateContext(session.id, {
            preferredModel: modelName ?? null,
          });
          await ctx.reply(
            modelName
              ? `\u2705 Model set to <code>${modelName}</code>`
              : '\u2705 Model reset to default',
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          log.error('[Telegram] /model command error:', err);
          await ctx.reply('Failed to update model preference.');
        }
      });

      // /new — Start a new conversation
      this.bot.command('new', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? '');
        try {
          const { channelUsersRepo } = await import('../../../db/repositories/channel-users.js');
          const { channelSessionsRepo } =
            await import('../../../db/repositories/channel-sessions.js');
          const user = await channelUsersRepo.findByPlatform('telegram', userId);
          if (!user) {
            await ctx.reply('Please verify first with /connect YOUR_TOKEN');
            return;
          }
          const session = await channelSessionsRepo.findActive(user.id, this.pluginId, chatId);
          if (session) {
            await channelSessionsRepo.deactivate(session.id);
          }
          await ctx.reply(
            '\u2728 New conversation started. Your next message begins a fresh session.'
          );
        } catch (err) {
          log.error('[Telegram] /new command error:', err);
          await ctx.reply('Failed to start new conversation.');
        }
      });

      // /clear — Clear conversation history
      this.bot.command('clear', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? '');
        try {
          const { channelUsersRepo } = await import('../../../db/repositories/channel-users.js');
          const { channelSessionsRepo } =
            await import('../../../db/repositories/channel-sessions.js');
          const user = await channelUsersRepo.findByPlatform('telegram', userId);
          if (!user) {
            await ctx.reply('Please verify first with /connect YOUR_TOKEN');
            return;
          }
          const session = await channelSessionsRepo.findActive(user.id, this.pluginId, chatId);
          if (session) {
            // Deactivate current session so next message starts fresh
            await channelSessionsRepo.deactivate(session.id);
            await ctx.reply(
              '\ud83d\uddd1\ufe0f Conversation cleared. Your next message starts a fresh session.'
            );
          } else {
            await ctx.reply('No active conversation to clear.');
          }
        } catch (err) {
          log.error('[Telegram] /clear command error:', err);
          await ctx.reply('Failed to clear history.');
        }
      });

      // /history — Show conversation summary
      this.bot.command('history', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? '');
        try {
          const { channelUsersRepo } = await import('../../../db/repositories/channel-users.js');
          const { channelSessionsRepo } =
            await import('../../../db/repositories/channel-sessions.js');
          const user = await channelUsersRepo.findByPlatform('telegram', userId);
          if (!user) {
            await ctx.reply('Please verify first with /connect YOUR_TOKEN');
            return;
          }
          const session = await channelSessionsRepo.findActive(user.id, this.pluginId, chatId);
          if (!session) {
            await ctx.reply('No active session.');
            return;
          }

          const startedAgo = session.createdAt
            ? Math.round((Date.now() - session.createdAt.getTime()) / 60000)
            : 0;

          const lastMsgAgo = session.lastMessageAt
            ? Math.round((Date.now() - session.lastMessageAt.getTime()) / 60000)
            : null;

          await ctx.reply(
            `<b>Session Info</b>\n\n` +
              `Conversation: ${session.conversationId ? 'Active' : 'None'}\n` +
              `Started: ${startedAgo < 60 ? `${startedAgo}m ago` : `${Math.round(startedAgo / 60)}h ago`}\n` +
              (lastMsgAgo !== null
                ? `Last message: ${lastMsgAgo < 60 ? `${lastMsgAgo}m ago` : `${Math.round(lastMsgAgo / 60)}h ago`}\n`
                : '') +
              `Model: <code>${(session.context?.preferredModel as string) || 'default'}</code>`,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          log.error('[Telegram] /history command error:', err);
          await ctx.reply('Failed to get history.');
        }
      });

      // /status — Show current bot and session status
      this.bot.command('status', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? '');
        try {
          const { channelUsersRepo } = await import('../../../db/repositories/channel-users.js');
          const { channelSessionsRepo } =
            await import('../../../db/repositories/channel-sessions.js');
          const user = await channelUsersRepo.findByPlatform('telegram', userId);

          const session = user
            ? await channelSessionsRepo.findActive(user.id, this.pluginId, chatId)
            : null;

          const model = (session?.context?.preferredModel as string) || 'default';
          const verified = user?.isVerified ? '\u2705 Verified' : '\u274c Not verified';

          const lines = [
            '<b>OwnPilot Status</b>\n',
            `Status: \ud83d\udfe2 Connected`,
            `Bot: @${this.bot?.botInfo?.username ?? 'unknown'}`,
            `Verification: ${verified}`,
            `Model: <code>${model}</code>`,
            session?.conversationId ? `Session: Active` : 'Session: None',
          ];

          await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
        } catch (err) {
          log.error('[Telegram] /status command error:', err);
          await ctx.reply('Failed to get status.');
        }
      });

      // ── Generic message handler (AFTER all commands) ──
      // Non-command messages fall through the command filters above and land here.
      this.bot.on('message', (ctx) => {
        this.handleIncomingMessage(ctx.message).catch((err) => {
          log.error('[Telegram] Error handling message:', err);
        });
      });

      // Install error handler
      this.bot.catch((err) => {
        log.error('[Telegram] Bot error:', err);
        this.status = 'error';
        this.emitConnectionEvent('error');
      });

      if (this.config.webhook_url) {
        // === WEBHOOK MODE ===
        // Auto-generate secret if not provided
        if (!this.config.webhook_secret) {
          this.config.webhook_secret = randomBytes(32).toString('hex');
        }

        // Initialize bot info without starting polling
        await this.bot.init();

        // Register the webhook callback handler for the route
        const { registerWebhookHandler } = await import('./webhook.js');
        registerWebhookHandler(this.bot, this.config.webhook_secret);

        // Tell Telegram to send updates to our webhook URL
        const webhookUrl = `${this.config.webhook_url.replace(/\/$/, '')}/webhooks/telegram/${this.config.webhook_secret}`;
        await this.bot.api.setWebhook(webhookUrl);

        this.webhookMode = true;
        this.status = 'connected';
        log.info('[Telegram] Bot connected via webhook', {
          url: webhookUrl.replace(/\/[^/]+$/, '/***'),
        });
        this.emitConnectionEvent('connected');
      } else {
        // === POLLING MODE (default) ===
        this.bot
          .start({
            onStart: () => {
              this.status = 'connected';
              log.info('[Telegram] Bot connected and polling');
              this.emitConnectionEvent('connected');
            },
          })
          .catch((err) => {
            log.error('[Telegram] Bot polling crashed:', err);
            this.status = 'error';
            this.emitConnectionEvent('error');
          });
      }
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Deny all pending approvals before stopping
    clearPendingApprovals();

    if (this.bot) {
      // In webhook mode, deregister the webhook from Telegram and cleanup handler
      if (this.webhookMode) {
        try {
          await this.bot.api.deleteWebhook();
        } catch (err) {
          log.warn('[Telegram] Failed to delete webhook:', getErrorMessage(err));
        }
        try {
          const { unregisterWebhookHandler } = await import('./webhook.js');
          unregisterWebhookHandler();
        } catch {
          /* best effort */
        }
      }
      this.bot.stop();
      this.bot = null;
    }
    this.webhookMode = false;
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.bot) {
      throw new Error('Telegram bot is not connected');
    }

    const chatId = message.platformChatId;

    // Convert Markdown → Telegram HTML when parse_mode is HTML
    let textToSend = message.text;
    if (this.config.parse_mode === 'HTML') {
      textToSend = markdownToTelegramHtml(message.text);
    }

    const parts = splitMessage(textToSend, PLATFORM_MESSAGE_LIMITS.telegram!);
    let lastMessageId = '';

    for (let i = 0; i < parts.length; i++) {
      const options: Record<string, unknown> = {};

      // Parse mode
      if (this.config.parse_mode) {
        options.parse_mode = this.config.parse_mode;
      }

      // Only first part gets reply_parameters
      if (i === 0 && message.replyToId) {
        const msgId = message.replyToId.includes(':')
          ? message.replyToId.split(':').pop()
          : message.replyToId;
        if (msgId && !Number.isNaN(Number(msgId))) {
          options.reply_parameters = { message_id: Number(msgId) };
        }
      }

      let sent;
      try {
        sent = await this.bot.api.sendMessage(chatId, parts[i]!, options);
      } catch (err) {
        // If Telegram rejects the formatting, retry as plain text
        if (options.parse_mode && isParseEntityError(err)) {
          log.warn('[Telegram] Parse entity error, retrying without parse_mode', {
            parseMode: options.parse_mode,
            error: getErrorMessage(err),
          });
          const { parse_mode: _, ...plainOptions } = options;
          sent = await this.bot.api.sendMessage(chatId, parts[i]!, plainOptions);
        } else {
          throw err;
        }
      }
      lastMessageId = String(sent.message_id);
      // Evict oldest entries if map is at capacity
      if (this.messageChatMap.size >= MAX_MESSAGE_CHAT_MAP_SIZE) {
        const oldest = this.messageChatMap.keys().next().value;
        if (oldest) this.messageChatMap.delete(oldest);
      }
      this.messageChatMap.set(lastMessageId, chatId);

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
    return 'telegram';
  }

  /** Get bot info (username, first name) after connection. */
  getBotInfo(): { username?: string; firstName?: string } | null {
    if (!this.bot) return null;
    try {
      const info = this.bot.botInfo;
      return { username: info.username, firstName: info.first_name };
    } catch {
      return null;
    }
  }

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendChatAction(platformChatId, 'typing').catch((err: unknown) => {
      log.debug('[Telegram] Typing indicator failed', { chatId: platformChatId, error: err });
    });
  }

  async editMessage(platformMessageId: string, newText: string): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = this.messageChatMap.get(platformMessageId);
    if (!chatId) {
      log.warn('[Telegram] editMessage: no chatId found for message', { platformMessageId });
      return;
    }
    const options: Record<string, unknown> = {};
    if (this.config.parse_mode) options.parse_mode = this.config.parse_mode;
    await this.bot.api.editMessageText(chatId, Number(platformMessageId), newText, options);
  }

  async deleteMessage(platformMessageId: string): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = this.messageChatMap.get(platformMessageId);
    if (!chatId) {
      log.warn('[Telegram] deleteMessage: no chatId found for message', { platformMessageId });
      return;
    }
    await this.bot.api.deleteMessage(chatId, Number(platformMessageId));
    this.messageChatMap.delete(platformMessageId);
  }

  /**
   * Create a progress manager for a given chat.
   * Used by ChannelServiceImpl to show tool execution progress.
   */
  createProgressManager(chatId: string): TelegramProgressManager | null {
    if (!this.bot) return null;
    return new TelegramProgressManager(this.bot, chatId, this.config.parse_mode);
  }

  /**
   * Track a message ID → chatId mapping (for edit/delete support).
   */
  trackMessage(platformMessageId: string, chatId: string): void {
    if (this.messageChatMap.size >= MAX_MESSAGE_CHAT_MAP_SIZE) {
      const oldest = this.messageChatMap.keys().next().value;
      if (oldest) this.messageChatMap.delete(oldest);
    }
    this.messageChatMap.set(platformMessageId, chatId);
  }

  /**
   * Request tool approval from the user via inline keyboard buttons.
   * Returns true if approved, false if denied or timed out.
   */
  async requestApproval(
    chatId: string,
    params: { toolName: string; description: string; riskLevel?: string }
  ): Promise<boolean> {
    if (!this.bot) return false;
    return requestTelegramApproval(this.bot, chatId, params);
  }

  async resolveUser(_platformUserId: string): Promise<ChannelUser | null> {
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
    // Accept text, captions, or messages with media attachments
    const hasMedia = !!(
      message.photo ||
      message.document ||
      message.audio ||
      message.voice ||
      message.video
    );
    if (!message.text && !message.caption && !hasMedia) return;

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
        [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'Unknown',
      username: message.from?.username,
      isBot: message.from?.is_bot,
    };

    // Download and process attachments (with actual file data)
    let attachments: ChannelAttachment[] = [];
    if (hasMedia && this.bot) {
      try {
        attachments = await downloadTelegramAttachments(this.bot, message);
      } catch (err) {
        log.warn('[Telegram] Failed to download attachments, using metadata only', { error: err });
        attachments = this.extractAttachments(message);
      }
    } else {
      attachments = this.extractAttachments(message);
    }

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
          'channel',
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
        createEvent<ChannelConnectionEventData>(eventName, 'channel', this.pluginId, {
          channelPluginId: this.pluginId,
          platform: 'telegram',
          status,
        })
      );
    } catch {
      // EventBus not ready
    }
  }
}
