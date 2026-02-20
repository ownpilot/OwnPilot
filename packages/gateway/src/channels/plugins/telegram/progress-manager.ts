/**
 * Telegram Progress Manager
 *
 * Manages a single editable "progress" message in Telegram.
 * Sends "Thinking..." initially, updates with tool progress,
 * and replaces with the final response — resulting in one clean message.
 *
 * Throttles edits to avoid Telegram rate limits (min 3 seconds between edits).
 */

import type { Bot } from 'grammy';
import { getLog } from '../../../services/log.js';
import { markdownToTelegramHtml } from '../../utils/markdown-telegram.js';
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from '../../utils/message-utils.js';

const log = getLog('TelegramProgress');

/** Minimum interval between message edits (Telegram rate limit safety). */
const MIN_EDIT_INTERVAL_MS = 3_000;

export class TelegramProgressManager {
  private readonly bot: Bot;
  private readonly chatId: string;
  private readonly parseMode: string | undefined;
  private messageId: number | null = null;
  private lastEditTime = 0;
  private pendingText: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(bot: Bot, chatId: string, parseMode?: string) {
    this.bot = bot;
    this.chatId = chatId;
    this.parseMode = parseMode;
  }

  /**
   * Send the initial progress message ("Thinking...").
   * Returns the platform message ID.
   */
  async start(initialText = '\ud83e\udd14 Thinking...'): Promise<string> {
    try {
      const sent = await this.bot.api.sendMessage(this.chatId, initialText);
      this.messageId = sent.message_id;
      this.lastEditTime = Date.now();
      return String(sent.message_id);
    } catch (err) {
      log.warn('Failed to send initial progress message', { error: err });
      return '';
    }
  }

  /**
   * Update the progress message text (throttled).
   * If called within the throttle window, the latest text is queued.
   */
  update(text: string): void {
    if (this.finished || !this.messageId) return;

    const now = Date.now();
    const elapsed = now - this.lastEditTime;

    if (elapsed >= MIN_EDIT_INTERVAL_MS) {
      this.doEdit(text);
    } else {
      // Queue the update for when throttle window opens
      this.pendingText = text;
      if (!this.pendingTimer) {
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          if (this.pendingText && !this.finished) {
            this.doEdit(this.pendingText);
            this.pendingText = null;
          }
        }, MIN_EDIT_INTERVAL_MS - elapsed);
      }
    }
  }

  /**
   * Replace the progress message with the final response.
   * If the response is too long, sends additional messages.
   * Returns the last platform message ID.
   */
  async finish(finalText: string): Promise<string> {
    this.finished = true;

    // Cancel any pending throttled update
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingText = null;

    // Guard against empty text (Telegram rejects empty messages)
    const text = finalText.trim() || '(empty response)';

    if (!this.messageId) {
      // Progress message was never sent — fall back to regular send
      return this.sendFresh(text);
    }

    // Convert Markdown → Telegram HTML
    let htmlText = text;
    if (this.parseMode === 'HTML') {
      htmlText = markdownToTelegramHtml(text);
    }

    const parts = splitMessage(htmlText, PLATFORM_MESSAGE_LIMITS.telegram!);

    // Edit the first part into the existing progress message
    try {
      const options: Record<string, unknown> = {};
      if (this.parseMode) options.parse_mode = this.parseMode;
      await this.bot.api.editMessageText(this.chatId, this.messageId, parts[0]!, options);
    } catch (err) {
      log.debug('Failed to edit progress → final message, sending fresh', { error: err });
      // If edit fails (e.g. text unchanged), send as new message
      return this.sendFresh(text);
    }

    let lastId = String(this.messageId);

    // Send remaining parts as new messages
    for (let i = 1; i < parts.length; i++) {
      try {
        const options: Record<string, unknown> = {};
        if (this.parseMode) options.parse_mode = this.parseMode;
        const sent = await this.bot.api.sendMessage(this.chatId, parts[i]!, options);
        lastId = String(sent.message_id);
        if (parts.length > 2 && i < parts.length - 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (err) {
        log.warn('Failed to send overflow message part', { part: i, error: err });
      }
    }

    return lastId;
  }

  /**
   * Cancel the progress message (edit to "Cancelled").
   */
  async cancel(): Promise<void> {
    this.finished = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.messageId) {
      try {
        await this.bot.api.editMessageText(
          this.chatId,
          this.messageId,
          '\u26a0\ufe0f Processing cancelled.',
        );
      } catch { /* best effort */ }
    }
  }

  /** Get the progress message ID (for messageChatMap tracking). */
  getMessageId(): number | null {
    return this.messageId;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private doEdit(text: string): void {
    if (!this.messageId || this.finished) return;
    this.lastEditTime = Date.now();
    this.bot.api.editMessageText(this.chatId, this.messageId, text).catch((err) => {
      log.debug('Progress edit failed', { error: err });
    });
  }

  private async sendFresh(text: string): Promise<string> {
    let htmlText = text;
    if (this.parseMode === 'HTML') {
      htmlText = markdownToTelegramHtml(text);
    }
    const parts = splitMessage(htmlText, PLATFORM_MESSAGE_LIMITS.telegram!);
    let lastId = '';
    for (const part of parts) {
      try {
        const options: Record<string, unknown> = {};
        if (this.parseMode) options.parse_mode = this.parseMode;
        const sent = await this.bot.api.sendMessage(this.chatId, part, options);
        lastId = String(sent.message_id);
      } catch (err) {
        log.warn('Failed to send fresh message', { error: err });
      }
    }
    return lastId;
  }
}
