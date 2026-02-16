/**
 * Chunking Tests
 *
 * Tests for markdown-aware text chunking.
 */

import { describe, it, expect } from 'vitest';
import { chunkMarkdown, shouldChunk } from './chunking.js';

describe('shouldChunk', () => {
  it('returns false for short text', () => {
    expect(shouldChunk('Hello world')).toBe(false);
  });

  it('returns true for text exceeding threshold', () => {
    const longText = 'x'.repeat(2001);
    expect(shouldChunk(longText)).toBe(true);
  });

  it('returns false for text equal to threshold', () => {
    const text = 'x'.repeat(2000);
    expect(shouldChunk(text)).toBe(false);
  });

  it('trims whitespace before checking', () => {
    const text = '  ' + 'x'.repeat(1998) + '  ';
    expect(shouldChunk(text)).toBe(false);
  });

  it('accepts custom max chars', () => {
    expect(shouldChunk('Hello world', 5)).toBe(true);
    expect(shouldChunk('Hello world', 50)).toBe(false);
  });
});

describe('chunkMarkdown', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkMarkdown('Hello world', 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('Hello world');
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.headingContext).toBe('');
  });

  it('returns empty array for empty text', () => {
    const chunks = chunkMarkdown('', 2000);
    expect(chunks).toHaveLength(0);
  });

  it('returns empty array for whitespace-only text', () => {
    const chunks = chunkMarkdown('   \n  \n  ', 2000);
    expect(chunks).toHaveLength(0);
  });

  it('splits at heading boundaries', () => {
    const text = [
      '# Section 1',
      'Content for section one. '.repeat(20),
      '# Section 2',
      'Content for section two. '.repeat(20),
    ].join('\n');

    const chunks = chunkMarkdown(text, 300);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // First chunk should reference Section 1
    const sec1Chunk = chunks.find(c => c.text.includes('Section 1'));
    expect(sec1Chunk).toBeDefined();
  });

  it('preserves heading context in chunks', () => {
    const text = [
      '# Main Title',
      '',
      '## Sub Section',
      'Paragraph content that should include heading context. '.repeat(30),
    ].join('\n');

    const chunks = chunkMarkdown(text, 300);
    // Chunks after the heading should have heading context
    const hasContext = chunks.some(c => c.headingContext.includes('Main Title'));
    expect(hasContext).toBe(true);
  });

  it('splits at paragraph boundaries when heading split not possible', () => {
    const text = [
      'First paragraph with some text.',
      '',
      'Second paragraph with more text.',
      '',
      'Third paragraph with even more text.',
      '',
      'Fourth paragraph continues.',
    ].join('\n').repeat(10);

    const chunks = chunkMarkdown(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits at sentence boundaries as fallback', () => {
    // Single long paragraph with no double newlines
    const text = 'This is a sentence. '.repeat(200);

    const chunks = chunkMarkdown(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles nested headings', () => {
    const text = [
      '# H1',
      '## H2',
      '### H3',
      'Content under H3. '.repeat(30),
      '## Another H2',
      'Content under another H2. '.repeat(30),
    ].join('\n');

    const chunks = chunkMarkdown(text, 300);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('merges tiny chunks into previous', () => {
    const text = [
      '# Section 1',
      'Long content here. '.repeat(20),
      '# Section 2',
      'Tiny',
    ].join('\n');

    const chunks = chunkMarkdown(text, 300);
    // The tiny "Section 2 / Tiny" chunk should be merged into previous
    const lastChunk = chunks[chunks.length - 1]!;
    expect(lastChunk.text).toContain('Long content');
  });

  it('indexes chunks sequentially', () => {
    const text = 'Word. '.repeat(500);
    const chunks = chunkMarkdown(text, 200);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });
});
