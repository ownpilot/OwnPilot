/**
 * WhatsApp Channel Normalizer
 *
 * Handles WhatsApp-specific message formatting:
 * - Incoming: WhatsApp formatting conversion (*bold*, _italic_)
 * - Outgoing: Internal tag stripping, markdown conversion, message splitting at 4096 chars
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';
import type { ChannelNormalizer, NormalizedIncoming } from './index.js';
import { stripInternalTags } from './base.js';
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from '../utils/message-utils.js';

const WHATSAPP_MAX_LENGTH = PLATFORM_MESSAGE_LIMITS.whatsapp ?? 4096;

/**
 * Convert WhatsApp formatting to plain text.
 * WhatsApp uses: *bold*, _italic_, ~strikethrough~, ```monospace```
 */
function normalizeWhatsAppFormatting(text: string): string {
  // WhatsApp formatting is already close to Markdown — keep it as-is
  // The AI will receive plain-ish text and respond in Markdown
  return text;
}

/**
 * Convert standard Markdown to WhatsApp formatting.
 * **bold** → *bold*, __italic__ → _italic_, ~~strike~~ → ~strike~
 */
function markdownToWhatsApp(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **bold** → *bold*
    .replace(/__(.+?)__/g, '_$1_') // __italic__ → _italic_
    .replace(/~~(.+?)~~/g, '~$1~'); // ~~strike~~ → ~strike~
}

export const whatsappNormalizer: ChannelNormalizer = {
  platform: 'whatsapp',

  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming {
    let text = msg.text || '';

    text = normalizeWhatsAppFormatting(text);

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
    let cleaned = stripInternalTags(response);
    if (!cleaned) return [];

    // Convert standard Markdown to WhatsApp formatting
    cleaned = markdownToWhatsApp(cleaned);

    return splitMessage(cleaned, WHATSAPP_MAX_LENGTH);
  },
};
