/**
 * Telegram Channel Normalizer
 *
 * Handles Telegram-specific message formatting:
 * - Incoming: HTML entity decoding, /command stripping
 * - Outgoing: Internal tag stripping, entity decoding, message splitting at 4096 chars
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';
import type { ChannelNormalizer, NormalizedIncoming } from './index.js';
import { stripInternalTags } from './base.js';
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from '../utils/message-utils.js';

const TELEGRAM_MAX_LENGTH = PLATFORM_MESSAGE_LIMITS.telegram ?? 4096;

// ============================================================================
// HTML entity handling
// ============================================================================

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * Decode common HTML entities in incoming Telegram text.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (match) => HTML_ENTITIES[match] ?? match);
}

// ============================================================================
// Normalizer
// ============================================================================

export const telegramNormalizer: ChannelNormalizer = {
  platform: 'telegram',

  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming {
    let text = msg.text || '';

    // Decode HTML entities from Telegram
    text = decodeHtmlEntities(text);

    // Strip /command prefix — treat as plain message
    if (text.startsWith('/') && !text.startsWith('/connect')) {
      const spaceIndex = text.indexOf(' ');
      if (spaceIndex > 0) {
        text = text.slice(spaceIndex + 1);
      }
      // If there's nothing after the command, keep the original
    }

    // Convert attachments to base64 data URIs
    const attachments: NormalizedAttachment[] | undefined = msg.attachments
      ?.filter((a) => a.data)
      .map((a) => ({
        type: a.type,
        data: `data:${a.mimeType};base64,${Buffer.from(a.data!).toString('base64')}`,
        mimeType: a.mimeType,
        filename: a.filename,
        size: a.size,
      }));

    return {
      text: text || (attachments?.length ? '[Attachment]' : ''),
      attachments: attachments?.length ? attachments : undefined,
    };
  },

  normalizeOutgoing(response: string): string[] {
    // Strip internal tags first
    let cleaned = stripInternalTags(response);

    if (!cleaned) return [];

    // Decode any HTML entities that might have been escaped
    // (e.g., &lt;b&gt; → <b>)
    cleaned = decodeHtmlEntities(cleaned);

    // NOTE: No markdown→HTML conversion here. Downstream senders
    // (TelegramChannelAPI.sendMessage, TelegramProgressManager) handle it.

    // Split into message parts if too long
    return splitMessage(cleaned, TELEGRAM_MAX_LENGTH);
  },
};
