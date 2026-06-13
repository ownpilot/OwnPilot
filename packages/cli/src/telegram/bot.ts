/**
 * Telegram bot integration using Grammy
 */

import type { Context } from 'grammy';
import { Bot, webhookCallback } from 'grammy';
import { getLog } from '@ownpilot/core/services';
import type { TelegramConfig, IncomingMessage, OutgoingMessage } from './types.js';

const log = getLog('Telegram');

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<TelegramConfig> = {
  maxMessageLength: 4096,
  // Default to plain text so an LLM that emits literal `<` (e.g. "5 < 10",
  // JSX snippets, `<thinking>` tags) does not cause Telegram to return
  // 400 'can't parse entities' on every reply. Callers that genuinely need
  // formatting must opt-in by setting parseMode explicitly AND escaping
  // user-controlled substrings themselves.
  parseMode: undefined,
};

/**
 * Telegram bot handler
 */
export class TelegramBot {
  readonly type = 'telegram';
  private bot: Bot<Context>;
  private config: TelegramConfig;
  private messageHandler?: (message: IncomingMessage) => Promise<void>;
  private isRunning = false;

  constructor(config: TelegramConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as TelegramConfig;
    this.bot = new Bot(this.config.botToken);
    this.setupHandlers();
  }

  /**
   * Check if bot is ready
   */
  isReady(): boolean {
    return Boolean(this.config.botToken) && this.config.enabled;
  }

  /**
   * Setup message handlers
   */
  private setupHandlers(): void {
    // IMPORTANT: command handlers MUST be registered BEFORE the catch-all
    // `bot.on('message:text')` below. grammy runs middleware in registration
    // order and does not auto-call next() for these single-argument handlers,
    // so a message:text handler registered first would consume "/start" etc.
    // (commands are text messages too) and the command handlers would never
    // fire — the bot would reply to "/start" with an AI response instead of the
    // welcome text. Same gotcha already fixed in the gateway Telegram plugin.

    // Handle /start command
    this.bot.command('start', async (ctx) => {
      if (!this.isUserAllowed(ctx)) {
        await ctx.reply('Sorry, you are not authorized to use this bot.');
        return;
      }

      await ctx.reply(
        'Welcome to OwnPilot Bot! 🤖\n\n' +
          'I am your AI assistant. Send me a message and I will help you.\n\n' +
          'Commands:\n' +
          '/start - Show this welcome message\n' +
          '/help - Get help\n' +
          '/reset - Start a new conversation'
      );
    });

    // Handle /help command
    this.bot.command('help', async (ctx) => {
      if (!this.isUserAllowed(ctx)) return;

      await ctx.reply(
        'OwnPilot Bot Help\n\n' +
          'Just send me a message and I will respond using AI.\n\n' +
          'Tips:\n' +
          '• Be specific in your questions\n' +
          '• Use /reset to start fresh\n' +
          '• Long responses may be split into multiple messages'
      );
    });

    // Handle /reset command
    this.bot.command('reset', async (ctx) => {
      if (!this.isUserAllowed(ctx)) return;

      // In a real implementation, this would reset the agent conversation
      await ctx.reply('Conversation reset. Send me a new message to start fresh!');
    });

    // Catch-all text handler — registered AFTER the commands (see note above) so
    // it only sees non-command messages.
    this.bot.on('message:text', async (ctx) => {
      // Check if user is allowed
      if (!this.isUserAllowed(ctx)) {
        return;
      }

      const incoming = this.parseIncomingMessage(ctx);
      if (this.messageHandler) {
        try {
          await this.messageHandler(incoming);
        } catch (err) {
          log.error('Error handling Telegram message', err);
          await ctx.reply('Sorry, I encountered an error processing your message.');
        }
      }
    });

    // Error handling
    this.bot.catch((err) => {
      log.error('Telegram bot error', err);
    });
  }

  /**
   * Check if user is allowed to use the bot.
   *
   * Fail-CLOSED semantics: if the operator passed a whitelist (any defined
   * array), only listed IDs pass — even when the array is empty. The
   * previous `length > 0` guard fell open if `--users abc,def` (all
   * NaN-filtered to `[]`) was supplied, accidentally exposing the bot
   * to every Telegram user.
   */
  private isUserAllowed(ctx: Context): boolean {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (this.config.allowedUserIds !== undefined) {
      if (!userId || !this.config.allowedUserIds.includes(userId)) {
        return false;
      }
    }

    if (this.config.allowedChatIds !== undefined) {
      if (!chatId || !this.config.allowedChatIds.includes(chatId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse incoming Telegram message to common format
   */
  private parseIncomingMessage(ctx: Context): IncomingMessage {
    return {
      id: String(ctx.message?.message_id ?? ''),
      channel: 'telegram',
      userId: String(ctx.from?.id ?? ''),
      username: ctx.from?.username,
      chatId: String(ctx.chat?.id ?? ''),
      text: ctx.message?.text ?? '',
      timestamp: new Date((ctx.message?.date ?? 0) * 1000),
      raw: ctx.message,
    };
  }

  /**
   * Start the bot (long polling)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    if (!this.isReady()) {
      throw new Error('Telegram bot is not properly configured');
    }

    // Get bot info before marking as running
    const botInfo = await this.bot.api.getMe();
    log.info(`Starting Telegram bot: @${botInfo.username}`);

    // Start long polling
    await this.bot.start({
      onStart: () => {
        this.isRunning = true;
        log.info('Telegram bot started successfully');
      },
    });
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    await this.bot.stop();
    log.info('Telegram bot stopped');
  }

  /**
   * Send a message
   */
  async sendMessage(message: OutgoingMessage): Promise<void> {
    const chatId = Number(message.chatId);
    if (!Number.isFinite(chatId)) {
      throw new Error(`Invalid chatId: ${message.chatId}`);
    }
    const text = message.text;
    const parseMode = message.parseMode ?? this.config.parseMode;
    // Clamp maxLength to a positive value. A misconfigured `0` (or negative)
    // would otherwise drive splitMessage into an infinite loop on its
    // `splitIndex = 0 → slice(0)` path.
    const maxLength = Math.max(1, this.config.maxMessageLength ?? 4096);

    // Split long messages
    const parts = this.splitMessage(text, maxLength);

    const failures: Array<{ partIndex: number; error: string }> = [];
    for (let i = 0; i < parts.length; i++) {
      const partText = parts[i];
      if (!partText) continue;

      try {
        await this.bot.api.sendMessage(chatId, partText, {
          parse_mode: parseMode,
          reply_to_message_id:
            i === 0 && message.replyToMessageId ? Number(message.replyToMessageId) : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ partIndex: i + 1, error: message });
        log.error(`Failed to send message part ${i + 1}/${parts.length}`, {
          chatId,
          error: message,
        });
      }

      // Small delay between split messages
      if (parts.length > 1 && i < parts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Aggregate all failures into the thrown error. The previous code only
    // surfaced the last failure, so the caller couldn't tell partial
    // delivery (part 1 succeeded, part 2 failed) from total failure — both
    // looked like "one error".
    if (failures.length > 0) {
      const total = parts.filter(Boolean).length;
      const summary = failures.map((f) => `part ${f.partIndex}: ${f.error}`).join('; ');
      throw new Error(
        `Telegram sendMessage failed for ${failures.length}/${total} parts — ${summary}`
      );
    }
  }

  /**
   * Split long message into parts
   */
  private splitMessage(text: string, maxLength: number): string[] {
    // Defense-in-depth: callers should already clamp, but a `0` here would
    // make `splitIndex = 0 → slice(0)` loop forever.
    if (!Number.isFinite(maxLength) || maxLength < 1) {
      maxLength = 4096;
    }
    if (text.length <= maxLength) {
      return [text];
    }

    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        parts.push(remaining);
        break;
      }

      // Try to split at newline or space
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        splitIndex = maxLength;
      }

      parts.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return parts;
  }

  /**
   * Set message handler
   */
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Get webhook callback for Express/Hono
   */
  getWebhookCallback(): (req: Request) => Promise<Response> {
    return webhookCallback(this.bot, 'std/http');
  }

  /**
   * Set webhook URL.
   *
   * The full URL frequently carries a secret token (query string or
   * path segment). We log only the origin + pathname so the secret
   * does not land in stdout, file logs, or shipped log aggregations.
   */
  async setWebhook(url: string): Promise<void> {
    await this.bot.api.setWebhook(url);
    try {
      const parsed = new URL(url);
      log.info(`Telegram webhook set to: ${parsed.origin}${parsed.pathname}`);
    } catch {
      // Should not happen — caller already validated the URL — but if
      // it does, log a redacted value rather than the raw input.
      log.info('Telegram webhook set (URL redacted)');
    }
  }

  /**
   * Delete webhook (for switching to long polling)
   */
  async deleteWebhook(): Promise<void> {
    await this.bot.api.deleteWebhook();
    log.info('Telegram webhook deleted');
  }
}

/**
 * Create a Telegram bot instance
 */
export function createTelegramBot(config: TelegramConfig): TelegramBot {
  return new TelegramBot(config);
}
