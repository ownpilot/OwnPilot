/**
 * Base Channel Normalizer
 *
 * Default normalizer for platforms without a specific implementation.
 * Pass-through with basic internal tag stripping.
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';
import type { ChannelNormalizer, NormalizedIncoming } from './index.js';

/** Internal tags that should never leak to channel users */
const INTERNAL_TAG_PATTERNS = [
  /<memories>[\s\S]*?<\/memories>/g,
  /<suggestions>[\s\S]*?<\/suggestions>/g,
  /<system>[\s\S]*?<\/system>/g,
  /<context>[\s\S]*?<\/context>/g,
];

/**
 * Strip all internal tags from a response string.
 */
export function stripInternalTags(text: string): string {
  let result = text;
  for (const pattern of INTERNAL_TAG_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

export const baseNormalizer: ChannelNormalizer = {
  platform: 'default',

  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming {
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
      text: msg.text || (attachments?.length ? '[Attachment]' : ''),
      attachments: attachments?.length ? attachments : undefined,
    };
  },

  normalizeOutgoing(response: string): string[] {
    const cleaned = stripInternalTags(response);
    return cleaned ? [cleaned] : [];
  },
};
