import type { proto } from '@whiskeysockets/baileys';

export type WhatsAppMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface WhatsAppMediaDescriptor {
  kind: WhatsAppMediaKind;
  mimeType?: string;
  filename?: string;
  size?: number;
}

export interface ParsedWhatsAppMessagePayload {
  text: string;
  media: WhatsAppMediaDescriptor[];
}

/**
 * Document attachment metadata extracted from WhatsApp proto.
 * Stored in channel_messages.metadata.document JSONB column.
 * Used for media persistence, recovery, and re-download workflows.
 */
export interface WhatsAppDocumentMetadata {
  filename?: string;
  mimeType?: string;
  size?: number;
  hasMediaKey: boolean;
  hasUrl: boolean;
  hasDirectPath: boolean;
  /** Base64-encoded mediaKey (AES-256-CBC per-message key). Present only when WhatsApp includes it. */
  mediaKey?: string;
  /** CDN direct path for media download. */
  directPath?: string;
  /** Full CDN URL for media download. */
  url?: string;
}

export interface ParsedWhatsAppMessageMetadata {
  document?: WhatsAppDocumentMetadata;
}

/**
 * Parse a WhatsApp message payload and return normalized text + media descriptors.
 * Text and media are detected independently so text+attachment messages keep their text.
 */
export function parseWhatsAppMessagePayload(
  message: proto.IMessage | null | undefined
): ParsedWhatsAppMessagePayload {
  if (!message) return { text: '', media: [] };

  const text =
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    message.documentMessage?.fileName ??
    '';

  const media: WhatsAppMediaDescriptor[] = [];

  if (message.imageMessage) {
    media.push({
      kind: 'image',
      mimeType: message.imageMessage.mimetype ?? 'image/jpeg',
    });
  }

  if (message.videoMessage) {
    media.push({
      kind: 'video',
      mimeType: message.videoMessage.mimetype ?? 'video/mp4',
    });
  }

  if (message.audioMessage) {
    media.push({
      kind: 'audio',
      mimeType: message.audioMessage.mimetype ?? 'audio/ogg',
    });
  }

  if (message.documentMessage) {
    const rawSize = message.documentMessage.fileLength;
    const size =
      typeof rawSize === 'number'
        ? rawSize
        : typeof rawSize === 'bigint'
          ? Number(rawSize)
          : typeof rawSize === 'object' && rawSize !== null && 'toNumber' in rawSize
            ? (rawSize as { toNumber(): number }).toNumber()
            : undefined;

    media.push({
      kind: 'document',
      mimeType: message.documentMessage.mimetype ?? 'application/octet-stream',
      filename: message.documentMessage.fileName ?? undefined,
      size,
    });
  }

  if (message.stickerMessage) {
    media.push({
      kind: 'sticker',
      mimeType: message.stickerMessage.mimetype ?? 'image/webp',
    });
  }

  return { text, media };
}

/**
 * Extract raw-ish metadata that helps debug WhatsApp document persistence.
 * Keep this summary small enough for DB metadata JSONB, but rich enough to explain
 * why a document may or may not be downloadable later.
 */
export function extractWhatsAppMessageMetadata(
  message: proto.IMessage | null | undefined
): ParsedWhatsAppMessageMetadata {
  if (!message?.documentMessage) return {};

  const rawSize = message.documentMessage.fileLength;
  const size =
    typeof rawSize === 'number'
      ? rawSize
      : typeof rawSize === 'bigint'
        ? Number(rawSize)
        : typeof rawSize === 'object' && rawSize !== null && 'toNumber' in rawSize
          ? (rawSize as { toNumber(): number }).toNumber()
          : undefined;

  const doc = message.documentMessage;
  const mediaKeyRaw = doc.mediaKey;
  const mediaKey = mediaKeyRaw
    ? (mediaKeyRaw instanceof Uint8Array
        ? Buffer.from(mediaKeyRaw).toString('base64')
        : typeof mediaKeyRaw === 'string'
          ? mediaKeyRaw
          : undefined)
    : undefined;

  return {
    document: {
      filename: doc.fileName ?? undefined,
      mimeType: doc.mimetype ?? 'application/octet-stream',
      size,
      hasMediaKey: Boolean(mediaKeyRaw),
      hasUrl: Boolean(doc.url),
      hasDirectPath: Boolean(doc.directPath),
      mediaKey,
      directPath: doc.directPath ?? undefined,
      url: doc.url ?? undefined,
    },
  };
}
