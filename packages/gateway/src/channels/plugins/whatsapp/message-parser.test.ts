import { describe, expect, it } from 'vitest';
import type { proto } from '@whiskeysockets/baileys';
import {
  extractWhatsAppMessageMetadata,
  parseWhatsAppMessagePayload,
} from './message-parser.js';

describe('parseWhatsAppMessagePayload', () => {
  it('keeps text when message contains text + document', () => {
    const payload = parseWhatsAppMessagePayload({
      extendedTextMessage: { text: 'Adres notu burada' },
      documentMessage: {
        mimetype: 'application/octet-stream',
        fileName: '2313JJ_12_V1.SOR',
        fileLength: 20480,
      },
    } as unknown as proto.IMessage);

    expect(payload.text).toBe('Adres notu burada');
    expect(payload.media).toEqual([
      {
        kind: 'document',
        mimeType: 'application/octet-stream',
        filename: '2313JJ_12_V1.SOR',
        size: 20480,
      },
    ]);
  });

  it('uses document filename as text fallback when caption is missing', () => {
    const payload = parseWhatsAppMessagePayload({
      documentMessage: {
        mimetype: 'application/octet-stream',
        fileName: '2728JA_45_V1.SOR',
        fileLength: 20480,
      },
    } as unknown as proto.IMessage);

    expect(payload.text).toBe('2728JA_45_V1.SOR');
    expect(payload.media).toEqual([
      {
        kind: 'document',
        mimeType: 'application/octet-stream',
        filename: '2728JA_45_V1.SOR',
        size: 20480,
      },
    ]);
  });

  it('returns [Attachment] fallback candidate when only media exists', () => {
    const payload = parseWhatsAppMessagePayload({
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: '',
      },
    } as unknown as proto.IMessage);

    expect(payload.text).toBe('');
    expect(payload.media).toEqual([{ kind: 'image', mimeType: 'image/jpeg' }]);
  });

  it('extracts document metadata useful for persistence and retry diagnostics', () => {
    const metadata = extractWhatsAppMessageMetadata({
      documentMessage: {
        mimetype: 'application/octet-stream',
        fileName: '2728GN_23_V1.SOR',
        fileLength: 20480,
        mediaKey: new Uint8Array([1, 2, 3]),
        url: 'https://mmg.whatsapp.net/test',
        directPath: '/v/t62/path',
      },
    } as unknown as proto.IMessage);

    expect(metadata).toEqual({
      document: {
        filename: '2728GN_23_V1.SOR',
        mimeType: 'application/octet-stream',
        size: 20480,
        hasMediaKey: true,
        hasUrl: true,
        hasDirectPath: true,
      },
    });
  });
});
