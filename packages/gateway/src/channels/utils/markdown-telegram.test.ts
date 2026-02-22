import { describe, it, expect } from 'vitest';
import { escapeHtml, markdownToTelegramHtml } from './markdown-telegram.js';

// ============================================================================
// escapeHtml
// ============================================================================

describe('escapeHtml', () => {
  it('should escape ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should escape less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('should escape greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('should escape all three together', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('should return empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should leave normal text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('should handle multiple occurrences of the same char', () => {
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c');
  });

  it('should handle HTML-like tags', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;'
    );
  });
});

// ============================================================================
// markdownToTelegramHtml
// ============================================================================

describe('markdownToTelegramHtml', () => {
  // ---------- empty/falsy input ------------------------------------------

  describe('empty/falsy input', () => {
    it('should return empty string for empty string', () => {
      expect(markdownToTelegramHtml('')).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(markdownToTelegramHtml(undefined as unknown as string)).toBe('');
    });

    it('should return empty string for null', () => {
      expect(markdownToTelegramHtml(null as unknown as string)).toBe('');
    });
  });

  // ---------- fenced code blocks -----------------------------------------

  describe('fenced code blocks', () => {
    it('should convert code block with language tag', () => {
      const input = '```js\nconst x = 1;\n```';
      expect(markdownToTelegramHtml(input)).toBe(
        '<pre><code class="language-js">const x = 1;</code></pre>'
      );
    });

    it('should convert code block without language tag', () => {
      const input = '```\nhello\n```';
      expect(markdownToTelegramHtml(input)).toBe('<pre><code>hello</code></pre>');
    });

    it('should escape HTML entities inside code blocks', () => {
      const input = '```html\n<b>bold</b>\n```';
      expect(markdownToTelegramHtml(input)).toBe(
        '<pre><code class="language-html">&lt;b&gt;bold&lt;/b&gt;</code></pre>'
      );
    });

    it('should handle multiple code blocks', () => {
      const input = '```js\nfoo()\n```\n\n```py\nbar()\n```';
      const result = markdownToTelegramHtml(input);
      expect(result).toContain('<pre><code class="language-js">foo()</code></pre>');
      expect(result).toContain('<pre><code class="language-py">bar()</code></pre>');
    });

    it('should preserve trailing newline inside code block', () => {
      const input = '```\ncode\n\n```';
      const result = markdownToTelegramHtml(input);
      expect(result).toContain('<pre><code>code\n</code></pre>');
    });

    it('should NOT convert markdown inside code blocks', () => {
      const input = '```\n**bold** *italic* [link](url)\n```';
      expect(markdownToTelegramHtml(input)).toBe(
        '<pre><code>**bold** *italic* [link](url)</code></pre>'
      );
    });
  });

  // ---------- inline code ------------------------------------------------

  describe('inline code', () => {
    it('should convert inline code', () => {
      const result = markdownToTelegramHtml('Use `console.log` here');
      expect(result).toContain('<code>console.log</code>');
    });

    it('should escape HTML entities inside inline code', () => {
      expect(markdownToTelegramHtml('Use `<div>` tag')).toBe('Use <code>&lt;div&gt;</code> tag');
    });

    it('should handle multiple inline codes in the same line', () => {
      const result = markdownToTelegramHtml('Use `foo` and `bar`');
      expect(result).toContain('<code>foo</code>');
      expect(result).toContain('<code>bar</code>');
    });

    it('should preserve markdown-like content inside inline code', () => {
      expect(markdownToTelegramHtml('Run `**not bold**`')).toBe('Run <code>**not bold**</code>');
    });
  });

  // ---------- bold and italic --------------------------------------------

  describe('bold and italic', () => {
    it('should convert **bold** with asterisks', () => {
      expect(markdownToTelegramHtml('This is **bold** text')).toBe('This is <b>bold</b> text');
    });

    it('should convert __bold__ with underscores', () => {
      expect(markdownToTelegramHtml('This is __bold__ text')).toBe('This is <b>bold</b> text');
    });

    it('should convert *italic* with asterisks', () => {
      expect(markdownToTelegramHtml('This is *italic* text')).toBe('This is <i>italic</i> text');
    });

    it('should convert _italic_ with underscores', () => {
      expect(markdownToTelegramHtml('This is _italic_ text')).toBe('This is <i>italic</i> text');
    });

    it('should convert ***bold-italic*** with asterisks', () => {
      expect(markdownToTelegramHtml('This is ***bold italic*** text')).toBe(
        'This is <b><i>bold italic</i></b> text'
      );
    });

    it('should convert ___bold-italic___ with underscores', () => {
      expect(markdownToTelegramHtml('This is ___bold italic___ text')).toBe(
        'This is <b><i>bold italic</i></b> text'
      );
    });
  });

  // ---------- strikethrough ----------------------------------------------

  describe('strikethrough', () => {
    it('should convert ~~text~~ to strikethrough', () => {
      expect(markdownToTelegramHtml('This is ~~deleted~~ text')).toBe(
        'This is <s>deleted</s> text'
      );
    });

    it('should handle multiple strikethroughs', () => {
      const result = markdownToTelegramHtml('~~one~~ and ~~two~~');
      expect(result).toContain('<s>one</s>');
      expect(result).toContain('<s>two</s>');
    });
  });

  // ---------- links ------------------------------------------------------

  describe('links', () => {
    it('should convert markdown links to HTML anchors', () => {
      expect(markdownToTelegramHtml('Visit [Google](https://google.com) now')).toBe(
        'Visit <a href="https://google.com">Google</a> now'
      );
    });

    it('should handle multiple links in the same line', () => {
      const result = markdownToTelegramHtml('[A](https://a.com) and [B](https://b.com)');
      expect(result).toContain('<a href="https://a.com">A</a>');
      expect(result).toContain('<a href="https://b.com">B</a>');
    });

    it('should handle link with special characters in text', () => {
      const result = markdownToTelegramHtml('[Click & go](https://example.com)');
      expect(result).toContain('<a href="https://example.com">');
    });
  });

  // ---------- headings ---------------------------------------------------

  describe('headings', () => {
    it('should convert # H1 to bold', () => {
      expect(markdownToTelegramHtml('# Title')).toBe('<b>Title</b>');
    });

    it('should convert ## H2 to bold', () => {
      expect(markdownToTelegramHtml('## Subtitle')).toBe('<b>Subtitle</b>');
    });

    it('should convert ### H3 to bold', () => {
      expect(markdownToTelegramHtml('### Section')).toBe('<b>Section</b>');
    });

    it('should convert ###### H6 to bold', () => {
      expect(markdownToTelegramHtml('###### Deep')).toBe('<b>Deep</b>');
    });
  });

  // ---------- lists ------------------------------------------------------

  describe('lists', () => {
    it('should convert dash unordered list items', () => {
      const input = '- Item 1\n- Item 2';
      expect(markdownToTelegramHtml(input)).toBe('  \u2022 Item 1\n  \u2022 Item 2');
    });

    it('should convert asterisk unordered list items', () => {
      const input = '* Item A\n* Item B';
      expect(markdownToTelegramHtml(input)).toBe('  \u2022 Item A\n  \u2022 Item B');
    });

    it('should convert ordered list items', () => {
      const input = '1. First\n2. Second';
      expect(markdownToTelegramHtml(input)).toBe('  1. First\n  2. Second');
    });

    it('should apply inline formatting inside list items', () => {
      const result = markdownToTelegramHtml('- **bold item**');
      expect(result).toContain('\u2022');
      expect(result).toContain('<b>bold item</b>');
    });
  });

  // ---------- blockquotes ------------------------------------------------

  describe('blockquotes', () => {
    it('should convert single line blockquote', () => {
      expect(markdownToTelegramHtml('> This is a quote')).toBe(
        '<blockquote>This is a quote</blockquote>'
      );
    });

    it('should merge consecutive blockquote lines', () => {
      const input = '> Line 1\n> Line 2\n> Line 3';
      expect(markdownToTelegramHtml(input)).toBe('<blockquote>Line 1\nLine 2\nLine 3</blockquote>');
    });

    it('should escape HTML entities in blockquotes', () => {
      expect(markdownToTelegramHtml('> a < b')).toBe('<blockquote>a &lt; b</blockquote>');
    });
  });

  // ---------- horizontal rules -------------------------------------------

  describe('horizontal rules', () => {
    it('should convert --- to em dash line', () => {
      expect(markdownToTelegramHtml('---')).toBe('\u2014\u2014\u2014');
    });

    it('should convert *** to em dash line', () => {
      expect(markdownToTelegramHtml('***')).toBe('\u2014\u2014\u2014');
    });

    it('should convert ___ to em dash line', () => {
      expect(markdownToTelegramHtml('___')).toBe('\u2014\u2014\u2014');
    });
  });

  // ---------- combined/complex cases -------------------------------------

  describe('combined/complex cases', () => {
    it('should handle heading with inline formatting in subsequent text', () => {
      const result = markdownToTelegramHtml('# Title\n\nSome **bold** text');
      expect(result).toContain('<b>Title</b>');
      expect(result).toContain('<b>bold</b>');
    });

    it('should handle link with bold text inside', () => {
      const result = markdownToTelegramHtml('[**bold link**](https://example.com)');
      expect(result).toContain('<a href="https://example.com">');
    });

    it('should handle code block followed by formatted text', () => {
      const input = '```js\nfoo()\n```\n\nSome *italic* text';
      const result = markdownToTelegramHtml(input);
      expect(result).toContain('<pre><code class="language-js">foo()</code></pre>');
      expect(result).toContain('<i>italic</i>');
    });

    it('should handle multiple block types in one message', () => {
      const input = [
        '# Title',
        '',
        'A paragraph with **bold**.',
        '',
        '- item one',
        '- item two',
        '',
        '> a quote',
        '',
        '```\ncode\n```',
      ].join('\n');
      const result = markdownToTelegramHtml(input);
      expect(result).toContain('<b>Title</b>');
      expect(result).toContain('<b>bold</b>');
      expect(result).toContain('  \u2022 item one');
      expect(result).toContain('<blockquote>');
      expect(result).toContain('<pre><code>code</code></pre>');
    });

    it('should handle mixed inline formatting in one line', () => {
      const result = markdownToTelegramHtml('**bold** and *italic* and `code` and ~~strike~~');
      expect(result).toContain('<b>bold</b>');
      expect(result).toContain('<i>italic</i>');
      expect(result).toContain('<code>code</code>');
      expect(result).toContain('<s>strike</s>');
    });

    it('should handle text before and after code block', () => {
      const input = 'Before\n```\ncode\n```\nAfter';
      const result = markdownToTelegramHtml(input);
      expect(result).toContain('Before');
      expect(result).toContain('<pre><code>code</code></pre>');
      expect(result).toContain('After');
    });

    it('should handle mixed content with paragraphs, code, and lists', () => {
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

    it('should apply inline formatting inside headings', () => {
      expect(markdownToTelegramHtml('## Hello **world**')).toBe('<b>Hello <b>world</b></b>');
    });
  });

  // ---------- edge cases -------------------------------------------------

  describe('edge cases', () => {
    it('should escape HTML special chars in normal text', () => {
      const result = markdownToTelegramHtml('Use <div> & "quotes"');
      expect(result).toContain('&lt;div&gt;');
      expect(result).toContain('&amp;');
    });

    it('should not treat underscores inside words as italic', () => {
      const result = markdownToTelegramHtml('some_variable_name');
      expect(result).not.toContain('<i>');
      expect(result).toContain('some_variable_name');
    });

    it('should preserve empty lines', () => {
      const result = markdownToTelegramHtml('Line 1\n\nLine 2');
      expect(result).toBe('Line 1\n\nLine 2');
    });

    it('should handle plain text with no markdown', () => {
      expect(markdownToTelegramHtml('Hello world')).toBe('Hello world');
    });

    it('should escape HTML in plain text', () => {
      expect(markdownToTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    });

    it('should double-escape already-escaped entities in source', () => {
      // Source literally contains "&amp;" — that gets escaped to "&amp;amp;"
      expect(markdownToTelegramHtml('&amp;')).toBe('&amp;amp;');
    });
  });

  // ---------- placeholder leak safety ------------------------------------

  describe('placeholder leak safety', () => {
    it('should not leak placeholders for inline code inside italic', () => {
      const result = markdownToTelegramHtml('Check *this `tool_name` works* now');
      expect(result).toContain('<code>tool_name</code>');
      expect(result).toContain('<i>');
      expect(result).not.toMatch(/PH\d+/);
    });

    it('should not leak placeholders for inline code inside bold', () => {
      const result = markdownToTelegramHtml('Use **the `core.add_task` tool** for tasks');
      expect(result).toContain('<code>core.add_task</code>');
      expect(result).toContain('<b>');
      expect(result).not.toMatch(/PH\d+/);
    });

    it('should not leak placeholders for multiple inline codes inside formatting', () => {
      const result = markdownToTelegramHtml('*Use `add_expense` and `send_email` tools*');
      expect(result).toContain('<code>add_expense</code>');
      expect(result).toContain('<code>send_email</code>');
      expect(result).not.toMatch(/PH\d+/);
    });

    it('should not leak placeholders in complex mixed content', () => {
      const input = [
        '**Tools**: `core.add_task`, `core.search`',
        '',
        'Try *using `custom.save_rate` now*',
        '',
        '- Use `tool_a` for X',
        '- Use `tool_b` for Y',
      ].join('\n');
      const result = markdownToTelegramHtml(input);
      expect(result).not.toMatch(/PH\d+/);
      expect(result).toContain('<code>core.add_task</code>');
      expect(result).toContain('<code>custom.save_rate</code>');
    });
  });
});
