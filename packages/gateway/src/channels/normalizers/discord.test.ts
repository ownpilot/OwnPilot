/**
 * Discord Channel Normalizer Tests
 */

import { describe, it, expect } from 'vitest';
import { discordNormalizer } from './discord.js';

describe('discordNormalizer', () => {
  describe('platform', () => {
    it('has platform = discord', () => {
      expect(discordNormalizer.platform).toBe('discord');
    });
  });

  // =========================================================================
  // normalizeIncoming
  // =========================================================================

  describe('normalizeIncoming', () => {
    it('returns text unchanged when no Discord mentions', () => {
      const result = discordNormalizer.normalizeIncoming({ text: 'Hello world' });
      expect(result.text).toBe('Hello world');
    });

    it('strips user mention <@userId> → @user', () => {
      const result = discordNormalizer.normalizeIncoming({ text: 'Hey <@123456789> wassup' });
      expect(result.text).toBe('Hey @user wassup');
    });

    it('strips user mention with ! <@!userId> → @user', () => {
      const result = discordNormalizer.normalizeIncoming({ text: '<@!987654321> hello' });
      expect(result.text).toBe('@user hello');
    });

    it('strips channel mention <#channelId> → #channel', () => {
      const result = discordNormalizer.normalizeIncoming({ text: 'see <#444555666> for details' });
      expect(result.text).toBe('see #channel for details');
    });

    it('strips role mention <@&roleId> → @role', () => {
      const result = discordNormalizer.normalizeIncoming({ text: 'ping <@&111222333>' });
      expect(result.text).toBe('ping @role');
    });

    it('removes custom emoji <:name:id>', () => {
      const result = discordNormalizer.normalizeIncoming({ text: 'nice <:thumbsup:123>' });
      expect(result.text).toBe('nice');
    });

    it('removes animated custom emoji <a:name:id>', () => {
      const result = discordNormalizer.normalizeIncoming({ text: 'wow <a:wave:456>' });
      expect(result.text).toBe('wow');
    });

    it('handles multiple mentions in one message', () => {
      const result = discordNormalizer.normalizeIncoming({
        text: '<@111> see <#222> and ping <@&333>',
      });
      expect(result.text).toBe('@user see #channel and ping @role');
    });

    it('returns empty string when text is empty', () => {
      const result = discordNormalizer.normalizeIncoming({ text: '' });
      expect(result.text).toBe('');
    });

    it('returns [Attachment] when text is empty and has attachments', () => {
      const result = discordNormalizer.normalizeIncoming({
        text: '',
        attachments: [{ type: 'image', data: Buffer.from('img'), mimeType: 'image/png' }],
      });
      expect(result.text).toBe('[Attachment]');
    });

    it('converts attachments with data to base64 data URIs', () => {
      const data = Buffer.from('hello');
      const result = discordNormalizer.normalizeIncoming({
        text: 'check this',
        attachments: [
          { type: 'image', data, mimeType: 'image/jpeg', filename: 'img.jpg', size: 5 },
        ],
      });
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments![0].data).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('filters out attachments without data', () => {
      const result = discordNormalizer.normalizeIncoming({
        text: 'hi',
        attachments: [{ type: 'image', mimeType: 'image/png' }],
      });
      expect(result.attachments).toBeUndefined();
    });

    it('trims whitespace from final text', () => {
      const result = discordNormalizer.normalizeIncoming({ text: '  hello  ' });
      expect(result.text).toBe('hello');
    });
  });

  // =========================================================================
  // normalizeOutgoing
  // =========================================================================

  describe('normalizeOutgoing', () => {
    it('returns array with message unchanged (Discord supports Markdown)', () => {
      const result = discordNormalizer.normalizeOutgoing('**Bold** and _italic_');
      expect(result).toEqual(['**Bold** and _italic_']);
    });

    it('returns empty array for empty response', () => {
      expect(discordNormalizer.normalizeOutgoing('')).toEqual([]);
    });

    it('strips internal tags', () => {
      const result = discordNormalizer.normalizeOutgoing(
        '<memories>remember this</memories>Hello world'
      );
      expect(result[0]).not.toContain('<memories>');
      expect(result[0]).toContain('Hello world');
    });

    it('splits message at 2000 chars', () => {
      const longMsg = 'a'.repeat(2500);
      const result = discordNormalizer.normalizeOutgoing(longMsg);
      expect(result.length).toBeGreaterThan(1);
      result.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(2000));
    });
  });
});
