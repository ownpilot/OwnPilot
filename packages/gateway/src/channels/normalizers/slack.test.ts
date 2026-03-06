/**
 * Slack Channel Normalizer Tests
 */

import { describe, it, expect } from 'vitest';
import { slackNormalizer } from './slack.js';

describe('slackNormalizer', () => {
  describe('platform', () => {
    it('has platform = slack', () => {
      expect(slackNormalizer.platform).toBe('slack');
    });
  });

  // =========================================================================
  // normalizeIncoming
  // =========================================================================

  describe('normalizeIncoming', () => {
    it('returns plain text unchanged', () => {
      const result = slackNormalizer.normalizeIncoming({ text: 'Hello world' });
      expect(result.text).toBe('Hello world');
    });

    it('replaces <@U123> with @user', () => {
      const result = slackNormalizer.normalizeIncoming({ text: 'Hey <@U1234567>' });
      expect(result.text).toBe('Hey @user');
    });

    it('replaces <#C123|name> with #name', () => {
      const result = slackNormalizer.normalizeIncoming({ text: 'see <#C123|general>' });
      expect(result.text).toBe('see #general');
    });

    it('replaces <#C123> (no name) with #channel', () => {
      const result = slackNormalizer.normalizeIncoming({ text: 'see <#C999>' });
      expect(result.text).toBe('see #channel');
    });

    it('replaces <!here> with @here', () => {
      const result = slackNormalizer.normalizeIncoming({ text: '<!here> attention' });
      expect(result.text).toBe('@here attention');
    });

    it('replaces <!channel> with @channel', () => {
      const result = slackNormalizer.normalizeIncoming({ text: '<!channel> everyone' });
      expect(result.text).toBe('@channel everyone');
    });

    it('replaces <!everyone> with @everyone', () => {
      const result = slackNormalizer.normalizeIncoming({ text: '<!everyone> listen up' });
      expect(result.text).toBe('@everyone listen up');
    });

    it('replaces <url|text> with just text', () => {
      const result = slackNormalizer.normalizeIncoming({
        text: 'click <https://example.com|here>',
      });
      expect(result.text).toBe('click here');
    });

    it('replaces bare <url> with the URL', () => {
      const result = slackNormalizer.normalizeIncoming({ text: 'visit <https://example.com>' });
      expect(result.text).toBe('visit https://example.com');
    });

    it('returns empty string when text is empty', () => {
      const result = slackNormalizer.normalizeIncoming({ text: '' });
      expect(result.text).toBe('');
    });

    it('returns [Attachment] when text is empty and has attachments with data', () => {
      const result = slackNormalizer.normalizeIncoming({
        text: '',
        attachments: [{ type: 'file', data: Buffer.from('x'), mimeType: 'text/plain' }],
      });
      expect(result.text).toBe('[Attachment]');
    });

    it('converts attachments with data to base64 data URIs', () => {
      const data = Buffer.from('file content');
      const result = slackNormalizer.normalizeIncoming({
        text: 'here is a file',
        attachments: [{ type: 'file', data, mimeType: 'application/pdf', filename: 'doc.pdf' }],
      });
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments![0].data).toMatch(/^data:application\/pdf;base64,/);
    });

    it('filters out attachments without data', () => {
      const result = slackNormalizer.normalizeIncoming({
        text: 'hi',
        attachments: [{ type: 'image', mimeType: 'image/png' }],
      });
      expect(result.attachments).toBeUndefined();
    });
  });

  // =========================================================================
  // normalizeOutgoing
  // =========================================================================

  describe('normalizeOutgoing', () => {
    it('converts **bold** to Slack *bold*', () => {
      const result = slackNormalizer.normalizeOutgoing('**hello**');
      expect(result[0]).toBe('*hello*');
    });

    it('converts [text](url) to Slack <url|text>', () => {
      const result = slackNormalizer.normalizeOutgoing('[click here](https://example.com)');
      expect(result[0]).toBe('<https://example.com|click here>');
    });

    it('returns empty array for empty response', () => {
      expect(slackNormalizer.normalizeOutgoing('')).toEqual([]);
    });

    it('strips internal tags', () => {
      const result = slackNormalizer.normalizeOutgoing('<memories>remember this</memories>Hello');
      expect(result[0]).not.toContain('<memories>');
      expect(result[0]).toContain('Hello');
    });

    it('splits long messages at ~4000 chars', () => {
      const longMsg = 'a'.repeat(5000);
      const result = slackNormalizer.normalizeOutgoing(longMsg);
      expect(result.length).toBeGreaterThan(1);
      result.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(4000));
    });

    it('returns array with single element for short message', () => {
      const result = slackNormalizer.normalizeOutgoing('Short message.');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Short message.');
    });
  });
});
