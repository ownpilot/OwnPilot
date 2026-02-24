import { describe, it, expect } from 'vitest';
import type { ChannelIncomingMessage } from '@ownpilot/core';
import { telegramNormalizer, decodeHtmlEntities } from './telegram.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMsg(overrides: Partial<ChannelIncomingMessage> = {}): ChannelIncomingMessage {
  return {
    id: 'msg-1',
    channelPluginId: 'telegram-1',
    platform: 'telegram',
    platformChatId: 'chat-123',
    text: 'Hello world',
    sender: {
      platformUserId: 'user-1',
      displayName: 'Test User',
    },
    receivedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// decodeHtmlEntities
// ============================================================================

describe('decodeHtmlEntities', () => {
  it('decodes &amp; to &', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &quot; and &#39;', () => {
    expect(decodeHtmlEntities('&quot;hello&#39;')).toBe('"hello\'');
  });

  it('decodes &apos;', () => {
    expect(decodeHtmlEntities('it&apos;s')).toBe("it's");
  });

  it('handles text with no entities', () => {
    expect(decodeHtmlEntities('hello world')).toBe('hello world');
  });

  it('handles multiple entities in one string', () => {
    expect(decodeHtmlEntities('a &amp; b &lt; c &gt; d')).toBe('a & b < c > d');
  });
});

// ============================================================================
// telegramNormalizer.normalizeIncoming
// ============================================================================

describe('telegramNormalizer.normalizeIncoming', () => {
  it('returns text as-is for plain messages', () => {
    const result = telegramNormalizer.normalizeIncoming(makeMsg({ text: 'Hello' }));
    expect(result.text).toBe('Hello');
  });

  it('decodes HTML entities in incoming text', () => {
    const result = telegramNormalizer.normalizeIncoming(makeMsg({ text: 'a &amp; b' }));
    expect(result.text).toBe('a & b');
  });

  it('strips /command prefix with arguments', () => {
    const result = telegramNormalizer.normalizeIncoming(makeMsg({ text: '/help me please' }));
    expect(result.text).toBe('me please');
  });

  it('preserves /connect command (not stripped)', () => {
    const result = telegramNormalizer.normalizeIncoming(makeMsg({ text: '/connect TOKEN123' }));
    expect(result.text).toBe('/connect TOKEN123');
  });

  it('handles /command with no arguments', () => {
    const result = telegramNormalizer.normalizeIncoming(makeMsg({ text: '/start' }));
    // No space found, keeps original text
    expect(result.text).toBe('/start');
  });

  it('returns [Attachment] for empty text with attachments', () => {
    const result = telegramNormalizer.normalizeIncoming(
      makeMsg({
        text: '',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/png',
            data: Buffer.from('test'),
            filename: 'test.png',
            size: 4,
          },
        ],
      })
    );
    expect(result.text).toBe('[Attachment]');
    expect(result.attachments).toHaveLength(1);
  });

  it('converts attachments to base64 data URIs', () => {
    const data = Buffer.from('hello');
    const result = telegramNormalizer.normalizeIncoming(
      makeMsg({
        attachments: [
          {
            type: 'document',
            mimeType: 'text/plain',
            data,
            filename: 'file.txt',
            size: 5,
          },
        ],
      })
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].data).toMatch(/^data:text\/plain;base64,/);
  });

  it('filters out attachments without data', () => {
    const result = telegramNormalizer.normalizeIncoming(
      makeMsg({
        attachments: [{ type: 'image', mimeType: 'image/png', filename: 'test.png', size: 0 }],
      })
    );
    expect(result.attachments).toBeUndefined();
  });

  it('handles message with both text and attachments', () => {
    const result = telegramNormalizer.normalizeIncoming(
      makeMsg({
        text: 'Look at this',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
            data: Buffer.from('img'),
            filename: 'photo.jpg',
            size: 3,
          },
        ],
      })
    );
    expect(result.text).toBe('Look at this');
    expect(result.attachments).toHaveLength(1);
  });
});

// ============================================================================
// telegramNormalizer.normalizeOutgoing
// ============================================================================

describe('telegramNormalizer.normalizeOutgoing', () => {
  it('strips <memories> tags', () => {
    const parts = telegramNormalizer.normalizeOutgoing(
      'Hello <memories>stuff to remember</memories> world'
    );
    expect(parts.join('')).not.toContain('<memories>');
    expect(parts.join('')).toContain('Hello');
    expect(parts.join('')).toContain('world');
  });

  it('strips <suggestions> tags', () => {
    const parts = telegramNormalizer.normalizeOutgoing(
      'Result <suggestions>some suggestions</suggestions>'
    );
    expect(parts.join('')).not.toContain('<suggestions>');
  });

  it('strips <system> tags', () => {
    const parts = telegramNormalizer.normalizeOutgoing('Text <system>internal</system> more');
    expect(parts.join('')).not.toContain('<system>');
  });

  it('strips <context> tags', () => {
    const parts = telegramNormalizer.normalizeOutgoing('Text <context>injected</context> more');
    expect(parts.join('')).not.toContain('<context>');
  });

  it('passes markdown through without conversion (downstream handles it)', () => {
    const parts = telegramNormalizer.normalizeOutgoing('This is **bold** text');
    expect(parts[0]).toBe('This is **bold** text');
  });

  it('splits long messages at 4096 chars', () => {
    const longText = 'A'.repeat(5000);
    const parts = telegramNormalizer.normalizeOutgoing(longText);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it('returns empty array for empty response', () => {
    expect(telegramNormalizer.normalizeOutgoing('')).toEqual([]);
  });

  it('returns empty array for response that is only internal tags', () => {
    const parts = telegramNormalizer.normalizeOutgoing(
      '<memories>stuff</memories><suggestions>more</suggestions>'
    );
    expect(parts).toEqual([]);
  });

  it('passes code blocks through without conversion', () => {
    const md = 'Here is code:\n```python\nprint("hello")\n```';
    const parts = telegramNormalizer.normalizeOutgoing(md);
    expect(parts[0]).toContain('```python');
  });

  it('preserves short messages as single part', () => {
    const parts = telegramNormalizer.normalizeOutgoing('Short reply');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('Short reply');
  });

  it('handles very long code blocks', () => {
    const code = 'x'.repeat(5000);
    const md = `\`\`\`\n${code}\n\`\`\``;
    const parts = telegramNormalizer.normalizeOutgoing(md);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('decodes HTML entities in outgoing messages', () => {
    // When agent sends escaped HTML entities, they should be decoded
    const text = '&lt;b&gt;bold text&lt;/b&gt; and &lt;i&gt;italic&lt;/i&gt;';
    const parts = telegramNormalizer.normalizeOutgoing(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('<b>bold text</b> and <i>italic</i>');
  });

  it('preserves existing HTML tags and passes markdown through', () => {
    // Mix of existing HTML and markdown — normalizer does not convert markdown
    const text = '<b>already bold</b> and **markdown bold**';
    const parts = telegramNormalizer.normalizeOutgoing(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('<b>already bold</b> and **markdown bold**');
  });
});
