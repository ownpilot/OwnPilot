/**
 * Telegram Inline Keyboard Approval Handler
 *
 * Enables tool approval via Telegram inline keyboard buttons.
 * Sends "Approve / Deny" buttons, resolves a Promise on user click or timeout.
 */

import { randomUUID } from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import { getLog } from '../../../services/log.js';
import { escapeHtml } from '../../utils/markdown-telegram.js';

const log = getLog('TelegramApproval');

/** Default timeout for pending approvals (2 minutes). */
const APPROVAL_TIMEOUT_MS = 120_000;
/** Max concurrent pending approvals. */
const MAX_PENDING = 50;

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  chatId: string;
  messageId: number;
  resolved: boolean;
}

const pending = new Map<string, PendingApproval>();

/**
 * Register the callback_query handler on the bot.
 * Must be called once before any approvals are created.
 */
export function registerApprovalHandler(bot: Bot): void {
  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('approve:') && !data.startsWith('deny:')) {
      return next();
    }

    const colonIdx = data.indexOf(':');
    const action = data.slice(0, colonIdx);
    const id = data.slice(colonIdx + 1);
    const entry = pending.get(id);

    if (!entry || entry.resolved) {
      await ctx.answerCallbackQuery({ text: 'This approval has expired.' }).catch(() => {});
      return;
    }

    const approved = action === 'approve';
    entry.resolved = true;
    clearTimeout(entry.timer);
    pending.delete(id);

    // Resolve first — ensure approval decision is delivered even if Telegram API fails
    entry.resolve(approved);

    // Edit the message to show the decision (best effort)
    try {
      await ctx.editMessageText(approved ? '\u2705 Approved' : '\u274c Denied');
    } catch (err) {
      log.debug('Failed to edit approval message', { error: err });
    }

    try {
      await ctx.answerCallbackQuery({
        text: approved ? 'Approved' : 'Denied',
      });
    } catch (err) {
      log.debug('Failed to answer callback query', { error: err });
    }
  });
}

/**
 * Send an inline keyboard approval prompt and wait for user response.
 * Returns true (approved) or false (denied/timeout).
 */
export async function requestTelegramApproval(
  bot: Bot,
  chatId: string,
  params: {
    toolName: string;
    description: string;
    riskLevel?: string;
  }
): Promise<boolean> {
  // Evict oldest if at capacity
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest) {
      const entry = pending.get(oldest)!;
      entry.resolved = true;
      clearTimeout(entry.timer);
      pending.delete(oldest);
      entry.resolve(false);
    }
  }

  const id = randomUUID().slice(0, 8);
  const riskBadge = params.riskLevel === 'high' ? '\u26a0\ufe0f HIGH RISK' : '';

  const text = [
    `\ud83d\udd10 <b>Tool Approval Required</b>`,
    ``,
    `<b>Tool:</b> <code>${escapeHtml(params.toolName)}</code>`,
    params.description ? `<b>Action:</b> ${escapeHtml(truncate(params.description, 500))}` : '',
    riskBadge ? `\n${riskBadge}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const keyboard = new InlineKeyboard()
    .text('\u2705 Approve', `approve:${id}`)
    .text('\u274c Deny', `deny:${id}`);

  let sent;
  try {
    sent = await bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch {
    return false; // Gracefully deny if we cannot reach Telegram
  }

  return new Promise<boolean>((resolve) => {
    const entry: PendingApproval = {
      resolve,
      timer: undefined!,
      chatId,
      messageId: sent.message_id,
      resolved: false,
    };

    entry.timer = setTimeout(() => {
      if (entry.resolved) return;
      entry.resolved = true;
      pending.delete(id);
      resolve(false);

      // Edit message to show timeout
      bot.api
        .editMessageText(
          chatId,
          sent.message_id,
          '\u23f0 Approval timed out — denied automatically.'
        )
        .catch(() => {});
    }, APPROVAL_TIMEOUT_MS);

    pending.set(id, entry);
  });
}

/**
 * Clear all pending approvals (deny them). Called on disconnect.
 */
export function clearPendingApprovals(): void {
  for (const [id, entry] of pending) {
    if (!entry.resolved) {
      entry.resolved = true;
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    pending.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}
