/**
 * Discord Channel Normalizer
 *
 * Handles Discord-specific message formatting:
 * - Incoming: Strip Discord mentions, convert embed text
 * - Outgoing: Internal tag stripping, message splitting at 2000 chars
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';
import type { ChannelNormalizer, NormalizedIncoming } from './index.js';
import { stripInternalTags } from './base.js';
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from '../utils/message-utils.js';

const DISCORD_MAX_LENGTH = PLATFORM_MESSAGE_LIMITS.discord ?? 2000;

/**
 * Strip Discord user/role/channel mentions, keeping the readable name where possible.
 * <@123456> → @user, <#123456> → #channel, <@&123456> → @role
 */
function stripDiscordMentions(text: string): string {
  return text
    .replace(/<@!?\d+>/g, '@user')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<@&\d+>/g, '@role')
    .replace(/<a?:\w+:\d+>/g, ''); // Custom emojis → remove
}

export const discordNormalizer: ChannelNormalizer = {
  platform: 'discord',

  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming {
    let text = msg.text || '';

    // Strip Discord-specific mentions
    text = stripDiscordMentions(text);

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
      text: text.trim() || (attachments?.length ? '[Attachment]' : ''),
      attachments: attachments?.length ? attachments : undefined,
    };
  },

  normalizeOutgoing(response: string): string[] {
    let cleaned = stripInternalTags(response);
    if (!cleaned) return [];

    // Discord supports Markdown natively — no conversion needed
    return splitMessage(cleaned, DISCORD_MAX_LENGTH);
  },
};
