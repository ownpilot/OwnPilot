/**
 * Slack Channel Normalizer
 *
 * Handles Slack-specific message formatting:
 * - Incoming: Slack mrkdwn → plain text, user/channel mention resolution
 * - Outgoing: Internal tag stripping, Markdown → Slack mrkdwn, message splitting
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';
import type { ChannelNormalizer, NormalizedIncoming } from './index.js';
import { stripInternalTags } from './base.js';
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from '../utils/message-utils.js';

const SLACK_MAX_LENGTH = PLATFORM_MESSAGE_LIMITS.slack ?? 4000;

/**
 * Convert Slack mrkdwn formatting to plain text.
 * Slack uses: *bold*, _italic_, ~strikethrough~, `code`, ```code block```
 * Special mentions: <@U123>, <#C123>, <!here>, <!channel>
 */
function normalizeSlackMrkdwn(text: string): string {
  return text
    .replace(/<@(\w+)>/g, '@user') // <@U123> → @user
    .replace(/<#(\w+)\|?([^>]*)>/g, (_m, _id, name) => (name ? `#${name}` : '#channel'))
    .replace(/<!here>/g, '@here')
    .replace(/<!channel>/g, '@channel')
    .replace(/<!everyone>/g, '@everyone')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2') // <url|text> → text
    .replace(/<(https?:\/\/[^>]+)>/g, '$1'); // <url> → url
}

/**
 * Convert standard Markdown to Slack mrkdwn.
 * **bold** → *bold*, [text](url) → <url|text>, etc.
 */
function markdownToSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **bold** → *bold*
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>'); // [text](url) → <url|text>
}

export const slackNormalizer: ChannelNormalizer = {
  platform: 'slack',

  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming {
    let text = msg.text || '';

    // Convert Slack mrkdwn to plain text
    text = normalizeSlackMrkdwn(text);

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

    // Convert Markdown to Slack mrkdwn
    cleaned = markdownToSlackMrkdwn(cleaned);

    return splitMessage(cleaned, SLACK_MAX_LENGTH);
  },
};
