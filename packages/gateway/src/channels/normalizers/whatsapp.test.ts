/**
 * WhatsApp Channel Normalizer Tests
 */

import { describe, it, expect } from 'vitest';
import { whatsappNormalizer } from './whatsapp.js';

describe('whatsappNormalizer', () => {
  describe('platform', () => {
    it('has platform = whatsapp', () => {
      expect(whatsappNormalizer.platform).toBe('whatsapp');
    });
  });

  // =========================================================================
  // normalizeIncoming
  // =========================================================================

  describe('normalizeIncoming', () => {
    it('returns plain text unchanged', () => {
      const result = whatsappNormalizer.normalizeIncoming({ text: 'Hello world' });
      expect(result.text).toBe('Hello world');
    });

    it('preserves WhatsApp *bold* formatting as-is', () => {
      const result = whatsappNormalizer.normalizeIncoming({ text: '*bold text*' });
      expect(result.text).toBe('*bold text*');
    });

    it('preserves WhatsApp _italic_ formatting as-is', () => {
      const result = whatsappNormalizer.normalizeIncoming({ text: '_italic text_' });
      expect(result.text).toBe('_italic text_');
    });

    it('preserves WhatsApp ~strikethrough~ formatting as-is', () => {
      const result = whatsappNormalizer.normalizeIncoming({ text: '~strike~' });
      expect(result.text).toBe('~strike~');
    });

    it('returns empty string when text is empty', () => {
      const result = whatsappNormalizer.normalizeIncoming({ text: '' });
      expect(result.text).toBe('');
    });

    it('returns [Attachment] when text is empty and has attachments with data', () => {
      const result = whatsappNormalizer.normalizeIncoming({
        text: '',
        attachments: [{ type: 'image', data: Buffer.from('img'), mimeType: 'image/png' }],
      });
      expect(result.text).toBe('[Attachment]');
    });

    it('converts attachments with data to base64 data URIs', () => {
      const data = Buffer.from('image bytes');
      const result = whatsappNormalizer.normalizeIncoming({
        text: 'see attached',
        attachments: [
          { type: 'image', data, mimeType: 'image/jpeg', filename: 'photo.jpg', size: 11 },
        ],
      });
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments![0].data).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('filters out attachments without data', () => {
      const result = whatsappNormalizer.normalizeIncoming({
        text: 'hi',
        attachments: [{ type: 'image', mimeType: 'image/png' }],
      });
      expect(result.attachments).toBeUndefined();
    });

    it('includes attachment metadata (filename, size)', () => {
      const data = Buffer.from('x');
      const result = whatsappNormalizer.normalizeIncoming({
        text: '',
        attachments: [
          { type: 'file', data, mimeType: 'application/pdf', filename: 'doc.pdf', size: 1 },
        ],
      });
      expect(result.attachments![0].filename).toBe('doc.pdf');
      expect(result.attachments![0].size).toBe(1);
    });

    it('handles undefined attachments gracefully', () => {
      const result = whatsappNormalizer.normalizeIncoming({ text: 'no attachments' });
      expect(result.attachments).toBeUndefined();
    });
  });

  // =========================================================================
  // normalizeOutgoing
  // =========================================================================

  describe('normalizeOutgoing', () => {
    it('returns empty array for empty response', () => {
      expect(whatsappNormalizer.normalizeOutgoing('')).toEqual([]);
    });

    it('converts **bold** to WhatsApp *bold*', () => {
      const result = whatsappNormalizer.normalizeOutgoing('**hello**');
      expect(result[0]).toBe('*hello*');
    });

    it('converts __italic__ to WhatsApp _italic_', () => {
      const result = whatsappNormalizer.normalizeOutgoing('__italic__');
      expect(result[0]).toBe('_italic_');
    });

    it('converts ~~strike~~ to WhatsApp ~strike~', () => {
      const result = whatsappNormalizer.normalizeOutgoing('~~strike~~');
      expect(result[0]).toBe('~strike~');
    });

    it('returns plain text unchanged', () => {
      const result = whatsappNormalizer.normalizeOutgoing('Just a message.');
      expect(result[0]).toBe('Just a message.');
    });

    it('returns array with single element for short message', () => {
      const result = whatsappNormalizer.normalizeOutgoing('Short message.');
      expect(result).toHaveLength(1);
    });

    it('strips internal tags', () => {
      const result = whatsappNormalizer.normalizeOutgoing('<context>private</context>Hello');
      expect(result[0]).not.toContain('<context>');
      expect(result[0]).toContain('Hello');
    });

    it('strips <suggestions> internal tags', () => {
      const result = whatsappNormalizer.normalizeOutgoing(
        '<suggestions>hint</suggestions>Response'
      );
      expect(result[0]).not.toContain('<suggestions>');
      expect(result[0]).toContain('Response');
    });

    it('splits long messages at ~4096 chars', () => {
      const longMsg = 'a'.repeat(5000);
      const result = whatsappNormalizer.normalizeOutgoing(longMsg);
      expect(result.length).toBeGreaterThan(1);
      result.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(4096));
    });

    it('converts multiple markdown patterns in one message', () => {
      const result = whatsappNormalizer.normalizeOutgoing('**bold** and ~~strikethrough~~');
      expect(result[0]).toBe('*bold* and ~strikethrough~');
    });
  });
});
