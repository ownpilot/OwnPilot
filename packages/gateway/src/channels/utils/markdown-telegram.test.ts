import { describe, it, expect } from 'vitest';
import { escapeHtml, markdownToTelegramHtml } from './markdown-telegram.js';

// ============================================================================
// escapeHtml
// ============================================================================

describe('escapeHtml', () => {
  it('escapes < > &', () => {
    expect(escapeHtml('a < b > c & d')).toBe('a &lt; b &gt; c &amp; d');
  });

  it('escapes combined entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;',
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ============================================================================
// markdownToTelegramHtml
// ============================================================================

describe('markdownToTelegramHtml', () => {
  // ---------- edge cases ------------------------------------------------

  it('returns empty string for empty input', () => {
    expect(markdownToTelegramHtml('')).toBe('');
  });

  it('passes plain text through (HTML-escaped)', () => {
    expect(markdownToTelegramHtml('Hello world')).toBe('Hello world');
  });

  it('escapes HTML in plain text', () => {
    expect(markdownToTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  // ---------- bold / italic / bold-italic --------------------------------

  it('converts **bold**', () => {
    expect(markdownToTelegramHtml('This is **bold** text')).toBe(
      'This is <b>bold</b> text',
    );
  });

  it('converts __bold__', () => {
    expect(markdownToTelegramHtml('This is __bold__ text')).toBe(
      'This is <b>bold</b> text',
    );
  });

  it('converts *italic*', () => {
    expect(markdownToTelegramHtml('This is *italic* text')).toBe(
      'This is <i>italic</i> text',
    );
  });

  it('converts _italic_', () => {
    expect(markdownToTelegramHtml('This is _italic_ text')).toBe(
      'This is <i>italic</i> text',
    );
  });

  it('converts ***bold italic***', () => {
    expect(markdownToTelegramHtml('This is ***bold italic*** text')).toBe(
      'This is <b><i>bold italic</i></b> text',
    );
  });

  it('converts ___bold italic___', () => {
    expect(markdownToTelegramHtml('This is ___bold italic___ text')).toBe(
      'This is <b><i>bold italic</i></b> text',
    );
  });

  // ---------- strikethrough ----------------------------------------------

  it('converts ~~strikethrough~~', () => {
    expect(markdownToTelegramHtml('This is ~~deleted~~ text')).toBe(
      'This is <s>deleted</s> text',
    );
  });

  // ---------- links ------------------------------------------------------

  it('converts [text](url) to <a> tag', () => {
    expect(markdownToTelegramHtml('Visit [Google](https://google.com) now')).toBe(
      'Visit <a href="https://google.com">Google</a> now',
    );
  });

  // ---------- inline code ------------------------------------------------

  it('converts inline `code` and escapes content', () => {
    expect(markdownToTelegramHtml('Use `<div>` tag')).toBe(
      'Use <code>&lt;div&gt;</code> tag',
    );
  });

  it('preserves markdown-like content inside inline code', () => {
    expect(markdownToTelegramHtml('Run `**not bold**`')).toBe(
      'Run <code>**not bold**</code>',
    );
  });

  // ---------- fenced code blocks -----------------------------------------

  it('converts fenced code block with language', () => {
    const input = '```js\nconst x = 1;\n```';
    expect(markdownToTelegramHtml(input)).toBe(
      '<pre><code class="language-js">const x = 1;</code></pre>',
    );
  });

  it('converts fenced code block without language', () => {
    const input = '```\nhello\n```';
    expect(markdownToTelegramHtml(input)).toBe('<pre><code>hello</code></pre>');
  });

  it('escapes HTML inside code blocks', () => {
    const input = '```html\n<b>bold</b>\n```';
    expect(markdownToTelegramHtml(input)).toBe(
      '<pre><code class="language-html">&lt;b&gt;bold&lt;/b&gt;</code></pre>',
    );
  });

  it('does NOT convert markdown inside code blocks', () => {
    const input = '```\n**bold** *italic* [link](url)\n```';
    expect(markdownToTelegramHtml(input)).toBe(
      '<pre><code>**bold** *italic* [link](url)</code></pre>',
    );
  });

  // ---------- blockquotes ------------------------------------------------

  it('converts single blockquote line', () => {
    expect(markdownToTelegramHtml('> This is a quote')).toBe(
      '<blockquote>This is a quote</blockquote>',
    );
  });

  it('merges consecutive blockquote lines', () => {
    const input = '> Line 1\n> Line 2\n> Line 3';
    expect(markdownToTelegramHtml(input)).toBe(
      '<blockquote>Line 1\nLine 2\nLine 3</blockquote>',
    );
  });

  it('escapes HTML in blockquotes', () => {
    expect(markdownToTelegramHtml('> a < b')).toBe(
      '<blockquote>a &lt; b</blockquote>',
    );
  });

  // ---------- headings ---------------------------------------------------

  it('converts # heading to bold', () => {
    expect(markdownToTelegramHtml('# Title')).toBe('<b>Title</b>');
  });

  it('converts ## heading to bold', () => {
    expect(markdownToTelegramHtml('## Subtitle')).toBe('<b>Subtitle</b>');
  });

  it('converts ### heading to bold', () => {
    expect(markdownToTelegramHtml('### Section')).toBe('<b>Section</b>');
  });

  // ---------- lists ------------------------------------------------------

  it('converts unordered list items with - ', () => {
    const input = '- Item 1\n- Item 2';
    expect(markdownToTelegramHtml(input)).toBe('  \u2022 Item 1\n  \u2022 Item 2');
  });

  it('converts unordered list items with * ', () => {
    const input = '* Item A\n* Item B';
    expect(markdownToTelegramHtml(input)).toBe('  \u2022 Item A\n  \u2022 Item B');
  });

  it('converts ordered list items', () => {
    const input = '1. First\n2. Second';
    expect(markdownToTelegramHtml(input)).toBe('  1. First\n  2. Second');
  });

  // ---------- horizontal rules -------------------------------------------

  it('converts --- to ———', () => {
    expect(markdownToTelegramHtml('---')).toBe('———');
  });

  it('converts *** to ———', () => {
    expect(markdownToTelegramHtml('***')).toBe('———');
  });

  // ---------- mixed content ----------------------------------------------

  it('handles mixed content with paragraphs, code, and lists', () => {
    const input = [
      'Hello **world**!',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '- Item *one*',
      '- Item **two**',
    ].join('\n');

    const result = markdownToTelegramHtml(input);
    expect(result).toContain('Hello <b>world</b>!');
    expect(result).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(result).toContain('\u2022 Item <i>one</i>');
    expect(result).toContain('\u2022 Item <b>two</b>');
  });

  it('handles text before and after code block', () => {
    const input = 'Before\n```\ncode\n```\nAfter';
    const result = markdownToTelegramHtml(input);
    expect(result).toContain('Before');
    expect(result).toContain('<pre><code>code</code></pre>');
    expect(result).toContain('After');
  });

  // ---------- no double-escaping -----------------------------------------

  it('does not double-escape &amp; in source', () => {
    // If source already has &amp; it should become &amp;amp;
    // because we treat the source as raw markdown text, not as HTML.
    // This is correct behaviour — the source literally contains "&amp;".
    expect(markdownToTelegramHtml('&amp;')).toBe('&amp;amp;');
  });

  // ---------- preserving whitespace --------------------------------------

  it('preserves empty lines', () => {
    const input = 'Line 1\n\nLine 2';
    const result = markdownToTelegramHtml(input);
    expect(result).toBe('Line 1\n\nLine 2');
  });

  // ---------- heading with inline formatting -----------------------------

  it('applies inline formatting inside headings', () => {
    expect(markdownToTelegramHtml('## Hello **world**')).toBe(
      '<b>Hello <b>world</b></b>',
    );
  });
});
