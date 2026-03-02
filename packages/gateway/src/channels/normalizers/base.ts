/**
 * Base Channel Normalizer
 *
 * Default normalizer for platforms without a specific implementation.
 * Pass-through with basic internal tag stripping.
 * Auto-transcribes audio attachments via VoiceService when available.
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

/** MIME type → file extension mapping for audio */
const AUDIO_MIME_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-m4a': 'm4a',
};

/**
 * Attempt to transcribe an audio attachment via VoiceService.
 * Returns the transcription text, or null on any error.
 */
export async function transcribeAudioAttachment(
  data: Uint8Array,
  mimeType: string
): Promise<string | null> {
  try {
    const { getVoiceService } = await import('../../services/voice-service.js');
    const service = getVoiceService();
    if (!(await service.isAvailable())) return null;

    const ext = AUDIO_MIME_EXT[mimeType] || 'ogg';
    const result = await service.transcribe(Buffer.from(data), `voice.${ext}`);
    return result.text?.trim() || null;
  } catch {
    // Voice service not configured or transcription failed — silent
    return null;
  }
}

export const baseNormalizer: ChannelNormalizer = {
  platform: 'default',

  async normalizeIncoming(msg: ChannelIncomingMessage): Promise<NormalizedIncoming> {
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

    // Auto-transcribe audio attachments
    const transcriptions: string[] = [];
    const audioAttachments = msg.attachments?.filter((a) => a.type === 'audio' && a.data);
    if (audioAttachments?.length) {
      for (const att of audioAttachments) {
        const text = await transcribeAudioAttachment(att.data!, att.mimeType);
        if (text) transcriptions.push(text);
      }
    }

    // Build final text: transcription prefix + original text
    let text = msg.text || '';
    if (transcriptions.length > 0) {
      const prefix = transcriptions.map((t) => `[Voice message]: ${t}`).join('\n');
      text = text ? `${prefix}\n\n${text}` : prefix;
    } else if (!text && attachments?.length) {
      text = '[Attachment]';
    }

    return {
      text,
      attachments: attachments?.length ? attachments : undefined,
    };
  },

  normalizeOutgoing(response: string): string[] {
    const cleaned = stripInternalTags(response);
    return cleaned ? [cleaned] : [];
  },
};
