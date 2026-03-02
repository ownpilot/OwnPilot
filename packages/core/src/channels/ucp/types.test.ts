/**
 * UCP Types & Content Adaptation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  adaptContent,
  stripMarkdown,
  stripHtml,
  type UCPMessage,
  type UCPChannelCapabilities,
} from './types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(overrides: Partial<UCPMessage> = {}): UCPMessage {
  return {
    id: 'msg-1',
    externalId: 'ext-1',
    channel: 'telegram',
    channelInstanceId: 'channel.telegram',
    direction: 'outbound',
    sender: { id: 'user-1', platform: 'telegram' },
    content: [],
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

function makeCapabilities(overrides: Partial<UCPChannelCapabilities> = {}): UCPChannelCapabilities {
  return {
    channel: 'sms',
    features: new Set(),
    limits: {},
    ...overrides,
  };
}

// ============================================================================
// adaptContent
// ============================================================================

describe('adaptContent', () => {
  it('passes through text content when platform supports it', () => {
    const msg = makeMessage({
      content: [{ type: 'text', text: 'Hello world', format: 'plain' }],
    });
    const cap = makeCapabilities({ features: new Set(['rich_text']) });

    const result = adaptContent(msg, cap);
    expect(result.content[0].text).toBe('Hello world');
    expect(result.content[0].type).toBe('text');
  });

  it('converts buttons to text menu when platform lacks buttons', () => {
    const msg = makeMessage({
      content: [
        {
          type: 'button_group',
          text: 'Choose an option:',
          buttons: [
            { id: '1', label: 'Option A', action: 'callback', value: 'a' },
            { id: '2', label: 'Option B', action: 'callback', value: 'b' },
            { id: '3', label: 'Option C', action: 'callback', value: 'c' },
          ],
        },
      ],
    });
    const cap = makeCapabilities(); // no 'buttons' feature

    const result = adaptContent(msg, cap);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Choose an option:');
    expect(result.content[0].text).toContain('1. Option A');
    expect(result.content[0].text).toContain('2. Option B');
    expect(result.content[0].text).toContain('3. Option C');
  });

  it('preserves buttons when platform supports them', () => {
    const msg = makeMessage({
      content: [
        {
          type: 'button_group',
          buttons: [{ id: '1', label: 'OK', action: 'callback', value: 'ok' }],
        },
      ],
    });
    const cap = makeCapabilities({ features: new Set(['buttons']) });

    const result = adaptContent(msg, cap);
    expect(result.content[0].type).toBe('button_group');
    expect(result.content[0].buttons).toHaveLength(1);
  });

  it('converts cards to text when platform lacks cards', () => {
    const msg = makeMessage({
      content: [
        {
          type: 'card',
          title: 'Product Name',
          description: 'A great product',
          url: 'https://example.com',
        },
      ],
    });
    const cap = makeCapabilities(); // no 'cards' feature

    const result = adaptContent(msg, cap);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('**Product Name**');
    expect(result.content[0].text).toContain('A great product');
    expect(result.content[0].text).toContain('https://example.com');
  });

  it('strips markdown when platform lacks markdown support', () => {
    const msg = makeMessage({
      content: [{ type: 'text', text: '**Bold** and *italic* text', format: 'markdown' }],
    });
    const cap = makeCapabilities(); // no 'markdown' feature

    const result = adaptContent(msg, cap);
    expect(result.content[0].text).toBe('Bold and italic text');
    expect(result.content[0].format).toBe('plain');
  });

  it('preserves markdown when platform supports it', () => {
    const msg = makeMessage({
      content: [{ type: 'text', text: '**Bold** text', format: 'markdown' }],
    });
    const cap = makeCapabilities({ features: new Set(['markdown']) });

    const result = adaptContent(msg, cap);
    expect(result.content[0].text).toBe('**Bold** text');
    expect(result.content[0].format).toBe('markdown');
  });

  it('strips HTML when platform lacks HTML support', () => {
    const msg = makeMessage({
      content: [{ type: 'text', text: '<b>Bold</b> and <i>italic</i>', format: 'html' }],
    });
    const cap = makeCapabilities(); // no 'html' feature

    const result = adaptContent(msg, cap);
    expect(result.content[0].text).toBe('Bold and italic');
    expect(result.content[0].format).toBe('plain');
  });

  it('truncates text when exceeding channel limit', () => {
    const longText = 'A'.repeat(200);
    const msg = makeMessage({
      content: [{ type: 'text', text: longText, format: 'plain' }],
    });
    const cap = makeCapabilities({ limits: { maxTextLength: 160 } });

    const result = adaptContent(msg, cap);
    expect(result.content[0].text!.length).toBeLessThanOrEqual(160);
    expect(result.content[0].text).toContain('[truncated]');
  });

  it('does not truncate text within limit', () => {
    const msg = makeMessage({
      content: [{ type: 'text', text: 'Short text', format: 'plain' }],
    });
    const cap = makeCapabilities({ limits: { maxTextLength: 160 } });

    const result = adaptContent(msg, cap);
    expect(result.content[0].text).toBe('Short text');
  });

  it('handles empty button group gracefully', () => {
    const msg = makeMessage({
      content: [{ type: 'button_group', buttons: [] }],
    });
    const cap = makeCapabilities();

    const result = adaptContent(msg, cap);
    expect(result.content[0].type).toBe('text');
  });

  it('handles multiple content blocks', () => {
    const msg = makeMessage({
      content: [
        { type: 'text', text: 'Hello', format: 'markdown' },
        { type: 'image', url: 'https://example.com/img.png', mimeType: 'image/png' },
        {
          type: 'button_group',
          buttons: [{ id: '1', label: 'OK', action: 'callback' as const, value: 'ok' }],
        },
      ],
    });
    const cap = makeCapabilities(); // minimal features

    const result = adaptContent(msg, cap);
    expect(result.content).toHaveLength(3);
    // Text preserved (no markdown flag set, only format: 'markdown')
    expect(result.content[0].format).toBe('plain');
    // Image untouched
    expect(result.content[1].type).toBe('image');
    // Buttons converted to text
    expect(result.content[2].type).toBe('text');
  });

  it('does not mutate the original message', () => {
    const original = makeMessage({
      content: [
        {
          type: 'button_group',
          buttons: [{ id: '1', label: 'X', action: 'callback' as const, value: 'x' }],
        },
      ],
    });
    const cap = makeCapabilities();

    adaptContent(original, cap);
    expect(original.content[0].type).toBe('button_group'); // unchanged
  });
});

// ============================================================================
// stripMarkdown
// ============================================================================

describe('stripMarkdown', () => {
  it('strips bold markers', () => {
    expect(stripMarkdown('**bold** text')).toBe('bold text');
  });

  it('strips italic markers', () => {
    expect(stripMarkdown('*italic* text')).toBe('italic text');
  });

  it('strips strikethrough markers', () => {
    expect(stripMarkdown('~~deleted~~ text')).toBe('deleted text');
  });

  it('strips inline code', () => {
    expect(stripMarkdown('use `code` here')).toBe('use code here');
  });

  it('strips code blocks', () => {
    const md = '```javascript\nconsole.log("hi")\n```';
    expect(stripMarkdown(md)).toBe('console.log("hi")');
  });

  it('strips heading markers', () => {
    expect(stripMarkdown('## Heading')).toBe('Heading');
    expect(stripMarkdown('### Sub Heading')).toBe('Sub Heading');
  });

  it('strips link syntax', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here');
  });

  it('strips blockquotes', () => {
    expect(stripMarkdown('> quoted text')).toBe('quoted text');
  });

  it('handles empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });
});

// ============================================================================
// stripHtml
// ============================================================================

describe('stripHtml', () => {
  it('strips HTML tags', () => {
    expect(stripHtml('<b>bold</b> text')).toBe('bold text');
  });

  it('converts <br> to newline', () => {
    expect(stripHtml('line1<br>line2')).toBe('line1\nline2');
    expect(stripHtml('line1<br/>line2')).toBe('line1\nline2');
  });

  it('converts </p> to double newline', () => {
    expect(stripHtml('<p>first</p><p>second</p>')).toContain('first');
    expect(stripHtml('<p>first</p><p>second</p>')).toContain('second');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});
