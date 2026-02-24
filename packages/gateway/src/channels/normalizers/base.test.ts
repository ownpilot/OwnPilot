import { describe, it, expect } from 'vitest';
import type { ChannelIncomingMessage } from '@ownpilot/core';
import { baseNormalizer, stripInternalTags } from './base.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMsg(overrides: Partial<ChannelIncomingMessage> = {}): ChannelIncomingMessage {
  return {
    id: 'msg-1',
    channelPluginId: 'default-1',
    platform: 'generic',
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
// stripInternalTags
// ============================================================================

describe('stripInternalTags', () => {
  it('strips <memories> tags', () => {
    expect(stripInternalTags('Hello <memories>secret</memories> world')).toBe('Hello  world');
  });

  it('strips <suggestions> tags', () => {
    expect(stripInternalTags('Text <suggestions>hint</suggestions>')).toBe('Text');
  });

  it('strips <system> tags', () => {
    expect(stripInternalTags('Before <system>internal</system> after')).toBe('Before  after');
  });

  it('strips <context> tags', () => {
    expect(stripInternalTags('A <context>injected context</context> B')).toBe('A  B');
  });

  it('strips multiple different tags', () => {
    const input = '<memories>m</memories>Hello<suggestions>s</suggestions><system>sys</system>';
    const result = stripInternalTags(input);
    expect(result).toBe('Hello');
  });

  it('strips multiline tag content', () => {
    const input = 'Text <memories>\nline1\nline2\n</memories> end';
    expect(stripInternalTags(input)).toBe('Text  end');
  });

  it('returns empty string for only-tags input', () => {
    expect(stripInternalTags('<memories>stuff</memories>')).toBe('');
  });

  it('handles text with no tags', () => {
    expect(stripInternalTags('plain text')).toBe('plain text');
  });

  it('trims whitespace from result', () => {
    expect(stripInternalTags('  hello  ')).toBe('hello');
  });
});

// ============================================================================
// baseNormalizer.normalizeIncoming
// ============================================================================

describe('baseNormalizer.normalizeIncoming', () => {
  it('passes through text as-is', () => {
    const result = baseNormalizer.normalizeIncoming(makeMsg({ text: 'Hello world' }));
    expect(result.text).toBe('Hello world');
  });

  it('returns [Attachment] for empty text with attachments', () => {
    const result = baseNormalizer.normalizeIncoming(
      makeMsg({
        text: '',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/png',
            data: Buffer.from('test'),
            filename: 'img.png',
            size: 4,
          },
        ],
      })
    );
    expect(result.text).toBe('[Attachment]');
  });

  it('returns empty string for empty text with no attachments', () => {
    const result = baseNormalizer.normalizeIncoming(makeMsg({ text: '' }));
    expect(result.text).toBe('');
  });

  it('converts attachments to base64 data URIs', () => {
    const data = Buffer.from('hello');
    const result = baseNormalizer.normalizeIncoming(
      makeMsg({
        attachments: [
          { type: 'document', mimeType: 'text/plain', data, filename: 'f.txt', size: 5 },
        ],
      })
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].data).toMatch(/^data:text\/plain;base64,/);
  });

  it('filters out attachments without data', () => {
    const result = baseNormalizer.normalizeIncoming(
      makeMsg({
        attachments: [{ type: 'image', mimeType: 'image/png', filename: 'no-data.png', size: 0 }],
      })
    );
    expect(result.attachments).toBeUndefined();
  });

  it('handles message with no attachments', () => {
    const result = baseNormalizer.normalizeIncoming(makeMsg({ text: 'hi' }));
    expect(result.attachments).toBeUndefined();
  });
});

// ============================================================================
// baseNormalizer.normalizeOutgoing
// ============================================================================

describe('baseNormalizer.normalizeOutgoing', () => {
  it('returns text as single-element array', () => {
    expect(baseNormalizer.normalizeOutgoing('Hello world')).toEqual(['Hello world']);
  });

  it('strips internal tags from output', () => {
    const parts = baseNormalizer.normalizeOutgoing('Reply <memories>secret</memories> here');
    expect(parts).toEqual(['Reply  here']);
  });

  it('returns empty array for empty string', () => {
    expect(baseNormalizer.normalizeOutgoing('')).toEqual([]);
  });

  it('returns empty array when response is only internal tags', () => {
    expect(
      baseNormalizer.normalizeOutgoing('<memories>data</memories><suggestions>s</suggestions>')
    ).toEqual([]);
  });

  it('does not split long messages (no platform limit)', () => {
    const longText = 'A'.repeat(10000);
    const parts = baseNormalizer.normalizeOutgoing(longText);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(longText);
  });
});
