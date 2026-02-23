/**
 * Telegram Channel Normalizer
 *
 * Handles Telegram-specific message formatting:
 * - Incoming: HTML entity decoding, /command stripping
 * - Outgoing: Markdown → Telegram HTML, message splitting at 4096 chars
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
// Markdown → Telegram HTML conversion
// ============================================================================

/**
 * Convert common markdown formatting to Telegram HTML.
 *
 * Supported conversions:
 * - **bold** → <b>bold</b>
 * - *italic* → <i>italic</i>
 * - `inline code` → <code>inline code</code>
 * - ```lang\ncode\n``` → <pre><code class="language-lang">code</code></pre>
 * - [text](url) → <a href="url">text</a>
 */
export function markdownToTelegramHtml(text: string): string {
  let result = text;

  // Code blocks (must be done before inline patterns)
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const cls = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${cls}>${escapeHtml(code.trimEnd())}</code></pre>`;
  });

  // Inline code (after code blocks to avoid double-matching)
  result = result.replace(
    /`([^`]+)`/g,
    (_match, code: string) => `<code>${escapeHtml(code)}</code>`
  );

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic: *text* (but not inside <b> tags or when preceded by *)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');

  return result;
}

/**
 * Escape HTML special characters for Telegram.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

    // Convert markdown to Telegram HTML
    cleaned = markdownToTelegramHtml(cleaned);

    // Split into message parts if too long
    return splitMessage(cleaned, TELEGRAM_MAX_LENGTH);
  },
};
