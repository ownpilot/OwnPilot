/**
 * Markdown → Telegram HTML converter.
 *
 * Telegram supports a small HTML subset: <b>, <i>, <s>, <u>, <code>,
 * <pre>, <a href="">, <blockquote>.  This module converts standard
 * Markdown (as produced by LLMs) into that subset, HTML-escaping
 * everything else so Telegram never rejects the payload.
 */

// ============================================================================
// HTML escaping
// ============================================================================

/** Escape `&`, `<`, `>` in text content (NOT in generated tags). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// Placeholder helpers
// ============================================================================

type PlaceholderMap = Map<string, string>;

let placeholderCounter = 0;

function makePlaceholder(map: PlaceholderMap, html: string): string {
  const key = `\x00PH${++placeholderCounter}\x00`;
  map.set(key, html);
  return key;
}

function restorePlaceholders(text: string, map: PlaceholderMap): string {
  // Restore in reverse insertion order: outer (later) placeholders first,
  // so inner (earlier) placeholders are revealed before their turn.
  // This handles nesting: applyInlineFormatting may wrap text containing
  // code placeholders, creating an outer PH whose value includes inner PHs.
  const entries = [...map.entries()].reverse();
  let result = text;
  for (const [key, html] of entries) {
    result = result.replaceAll(key, html);
  }
  return result;
}

// ============================================================================
// Inline formatting
// ============================================================================

/**
 * Apply inline Markdown formatting to already-escaped text.
 * Order matters: bold-italic first, then bold, italic, strikethrough, links.
 */
function applyInlineFormatting(text: string, ph: PlaceholderMap): string {
  let result = text;

  // Bold-italic: ***text*** or ___text___
  result = result.replace(/(\*\*\*|___)(.+?)\1/g, (_m, _d, content) =>
    makePlaceholder(ph, `<b><i>${content}</i></b>`),
  );

  // Bold: **text** or __text__
  result = result.replace(/(\*\*|__)(.+?)\1/g, (_m, _d, content) =>
    makePlaceholder(ph, `<b>${content}</b>`),
  );

  // Italic: *text* or _text_  (but not inside words for underscores)
  result = result.replace(/(?<!\w)\*([^\s*](?:.*?[^\s*])?)\*(?!\w)/g, (_m, content) =>
    makePlaceholder(ph, `<i>${content}</i>`),
  );
  result = result.replace(/(?<!\w)_([^\s_](?:.*?[^\s_])?)_(?!\w)/g, (_m, content) =>
    makePlaceholder(ph, `<i>${content}</i>`),
  );

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, (_m, content) =>
    makePlaceholder(ph, `<s>${content}</s>`),
  );

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    makePlaceholder(ph, `<a href="${url}">${text}</a>`),
  );

  return result;
}

// ============================================================================
// Main converter
// ============================================================================

/**
 * Convert standard Markdown to Telegram-compatible HTML.
 *
 * Uses a placeholder-based algorithm:
 *  1. Extract fenced code blocks → placeholder
 *  2. Extract inline code → placeholder
 *  3. Process block-level elements (quotes, headers, lists, hrs)
 *  4. Apply inline formatting on remaining text
 *  5. Restore all placeholders
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  placeholderCounter = 0;
  const ph: PlaceholderMap = new Map();

  // ------------------------------------------------------------------
  // Step 1: Extract fenced code blocks
  // ------------------------------------------------------------------
  let text = markdown.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      // Remove trailing newline inside code block if present
      const trimmedCode = code.endsWith('\n') ? code.slice(0, -1) : code;
      const langAttr = lang ? ` class="language-${lang}"` : '';
      return makePlaceholder(ph, `<pre><code${langAttr}>${escapeHtml(trimmedCode)}</code></pre>`);
    },
  );

  // ------------------------------------------------------------------
  // Step 2: Extract inline code
  // ------------------------------------------------------------------
  text = text.replace(
    /`([^`]+)`/g,
    (_m, code: string) => makePlaceholder(ph, `<code>${escapeHtml(code)}</code>`),
  );

  // ------------------------------------------------------------------
  // Step 3: Process lines (block-level elements)
  // ------------------------------------------------------------------
  const lines = text.split('\n');
  const processed: string[] = [];
  let inBlockquote = false;
  const blockquoteLines: string[] = [];

  const flushBlockquote = () => {
    if (blockquoteLines.length > 0) {
      const content = blockquoteLines.join('\n');
      processed.push(`<blockquote>${content}</blockquote>`);
      blockquoteLines.length = 0;
    }
    inBlockquote = false;
  };

  for (const line of lines) {
    // Blockquote: > text
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      inBlockquote = true;
      blockquoteLines.push(escapeHtml(bqMatch[1]!));
      continue;
    }

    // Flush any pending blockquote when we hit a non-quote line
    if (inBlockquote) {
      flushBlockquote();
    }

    // If the line is purely a placeholder (code block), pass it through
    if (/^\x00PH\d+\x00$/.test(line.trim())) {
      processed.push(line);
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      processed.push('———');
      continue;
    }

    // Heading: # / ## / ### → bold
    const headingMatch = line.match(/^#{1,6}\s+(.*)/);
    if (headingMatch) {
      const escaped = escapeHtml(headingMatch[1]!);
      const formatted = applyInlineFormatting(escaped, ph);
      processed.push(`<b>${formatted}</b>`);
      continue;
    }

    // Unordered list: - item, * item
    const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
    if (ulMatch) {
      const escaped = escapeHtml(ulMatch[1]!);
      const formatted = applyInlineFormatting(escaped, ph);
      processed.push(`  \u2022 ${formatted}`);
      continue;
    }

    // Ordered list: 1. item
    const olMatch = line.match(/^[\s]*(\d+)\.\s+(.*)/);
    if (olMatch) {
      const escaped = escapeHtml(olMatch[2]!);
      const formatted = applyInlineFormatting(escaped, ph);
      processed.push(`  ${olMatch[1]}. ${formatted}`);
      continue;
    }

    // Empty line → preserve
    if (line.trim() === '') {
      processed.push('');
      continue;
    }

    // Normal text: escape then apply inline formatting
    const escaped = escapeHtml(line);
    processed.push(applyInlineFormatting(escaped, ph));
  }

  // Flush trailing blockquote
  if (inBlockquote) {
    flushBlockquote();
  }

  // ------------------------------------------------------------------
  // Step 4: Join and restore placeholders
  // ------------------------------------------------------------------
  const joined = processed.join('\n');
  return restorePlaceholders(joined, ph);
}
