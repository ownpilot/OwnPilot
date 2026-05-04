import { memo, useMemo, useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { ChatMessageWidget } from './ChatMessageWidget';
import { CHAT_WIDGET_TAG_NAMES } from '../utils/chat-content';

export { hideIncompleteStreamingWidgets } from '../utils/chat-content';

// =============================================================================
// URL safety
// =============================================================================

/** Only allow http/https URLs to prevent javascript: XSS */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// =============================================================================
// Image URL helpers
// =============================================================================

function resolveImageUrl(url: string, workspaceId?: string | null): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:')) return url;
  if (workspaceId) {
    const cleanPath = url.replace(/^[/\\]+/, '');
    return `/api/v1/file-workspaces/${encodeURIComponent(workspaceId)}/file/${cleanPath}?raw=true`;
  }
  return url;
}

// =============================================================================
// ImagePreview — inline thumbnail with lightbox expand
// =============================================================================

function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-muted dark:text-dark-text-muted">
        [Image: {alt || src}]
      </span>
    );
  }

  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setExpanded(true)}
        onError={() => setError(true)}
        className="inline-block max-w-sm max-h-64 rounded-lg border border-border dark:border-dark-border my-2 cursor-pointer hover:opacity-90 transition-opacity"
        loading="lazy"
      />
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <img src={src} alt={alt} className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  );
}

// =============================================================================
// MarkdownContent
// =============================================================================

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** Smaller code blocks for compact views (history/inbox) */
  compact?: boolean;
  /** Workspace ID for resolving relative image paths */
  workspaceId?: string | null;
}

type TableAlignment = 'left' | 'center' | 'right';

interface MarkdownTable {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
  nextIndex: number;
}

interface ParsedWidget {
  name: string;
  data: unknown;
}

const WIDGET_TAG_PATTERN = CHAT_WIDGET_TAG_NAMES.join('|');
const WIDGET_TAG_REGEX = new RegExp(`<(?:${WIDGET_TAG_PATTERN})\\b[\\s\\S]*?\\/>`, 'gi');

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
  compact,
  workspaceId,
}: MarkdownContentProps) {
  const maxHeight = compact ? '200px' : '300px';

  // Render inline elements (bold, italic, inline code, links, images)
  const renderInlineElements = (text: string): (string | React.ReactElement)[] => {
    const elements: (string | React.ReactElement)[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      // Inline code
      const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
      if (inlineCodeMatch) {
        elements.push(
          <code
            key={key++}
            className="px-1.5 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary text-primary rounded font-mono text-sm"
          >
            {inlineCodeMatch[1]}
          </code>
        );
        remaining = remaining.slice(inlineCodeMatch[0].length);
        continue;
      }

      // Bold
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        elements.push(<strong key={key++}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italic
      const italicMatch = remaining.match(/^\*([^*]+)\*/);
      if (italicMatch) {
        elements.push(<em key={key++}>{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Image: ![alt](url) — must come before link pattern
      const imageMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imageMatch) {
        const imgAlt = imageMatch[1] ?? '';
        const imgSrc = resolveImageUrl(imageMatch[2]!, workspaceId);
        elements.push(<ImagePreview key={key++} src={imgSrc} alt={imgAlt} />);
        remaining = remaining.slice(imageMatch[0].length);
        continue;
      }

      // Links
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const url = linkMatch[2]!;
        if (isSafeUrl(url)) {
          elements.push(
            <a
              key={key++}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {linkMatch[1]}
            </a>
          );
        } else {
          // Render as plain text for unsafe URLs (javascript:, data:, etc.)
          elements.push(<span key={key++}>{linkMatch[1]}</span>);
        }
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // No match, advance to next special character
      const nextSpecial = remaining.search(/[`*\[!]/);
      if (nextSpecial === -1) {
        elements.push(remaining);
        break;
      } else if (nextSpecial === 0) {
        elements.push(remaining[0]!);
        remaining = remaining.slice(1);
      } else {
        elements.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return elements;
  };

  const splitTableRow = (line: string): string[] => {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map((cell) => cell.trim());
  };

  const parseTableSeparator = (line: string): TableAlignment[] | null => {
    const cells = splitTableRow(line);
    if (cells.length < 2) return null;

    const alignments: TableAlignment[] = [];
    for (const cell of cells) {
      const normalized = cell.replace(/\s/g, '');
      if (!/^:?-{1,}:?$/.test(normalized)) return null;
      if (normalized.startsWith(':') && normalized.endsWith(':')) alignments.push('center');
      else if (normalized.endsWith(':')) alignments.push('right');
      else alignments.push('left');
    }

    return alignments;
  };

  const parseMarkdownTable = (lines: string[], startIndex: number): MarkdownTable | null => {
    const headerLine = lines[startIndex];
    const separatorLine = lines[startIndex + 1];
    if (!headerLine?.includes('|') || !separatorLine?.includes('|')) return null;

    const headers = splitTableRow(headerLine);
    const alignments = parseTableSeparator(separatorLine);
    if (!alignments) return null;
    while (alignments.length < headers.length) alignments.push('left');

    const rows: string[][] = [];
    let nextIndex = startIndex + 2;

    while (nextIndex < lines.length) {
      const line = lines[nextIndex];
      if (!line || !line.trim() || !line.includes('|')) break;

      const cells = splitTableRow(line);
      while (cells.length < headers.length) cells.push('');
      rows.push(cells.slice(0, headers.length));
      nextIndex += 1;
    }

    return { headers, alignments, rows, nextIndex };
  };

  const alignmentClass = (alignment: TableAlignment): string => {
    if (alignment === 'center') return 'text-center';
    if (alignment === 'right') return 'text-right';
    return 'text-left';
  };

  const renderTable = (table: MarkdownTable, key: number): React.ReactElement => (
    <div
      key={key}
      className="my-3 max-w-full overflow-x-auto rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary"
    >
      <table className="min-w-full border-collapse text-sm leading-6">
        <thead>
          <tr className="bg-bg-tertiary/80 dark:bg-dark-bg-tertiary/80">
            {table.headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                className={`border-b border-border dark:border-dark-border px-3 py-2 font-semibold text-text-secondary dark:text-dark-text-secondary ${alignmentClass(table.alignments[index] ?? 'left')}`}
              >
                {renderInlineElements(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="odd:bg-bg-primary even:bg-bg-secondary/60 dark:odd:bg-dark-bg-primary dark:even:bg-dark-bg-secondary/60"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${rowIndex}-${cellIndex}`}
                  className={`border-b border-border/70 px-3 py-2 align-top text-text-primary last:border-r-0 dark:border-dark-border/70 dark:text-dark-text-primary ${alignmentClass(table.alignments[cellIndex] ?? 'left')}`}
                >
                  {renderInlineElements(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const decodeAttributeValue = (value: string): string =>
    value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

  const parseTagAttributes = (source: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    let index = 0;

    while (index < source.length) {
      while (/\s/.test(source[index] ?? '')) index += 1;

      const nameStart = index;
      while (/[a-zA-Z0-9_:.-]/.test(source[index] ?? '')) index += 1;
      const attrName = source.slice(nameStart, index).toLowerCase();
      if (!attrName) break;

      while (/\s/.test(source[index] ?? '')) index += 1;
      if (source[index] !== '=') continue;
      index += 1;
      while (/\s/.test(source[index] ?? '')) index += 1;

      const quote = source[index];
      if (quote !== '"' && quote !== "'") continue;
      index += 1;

      let value = '';
      if (attrName === 'data' && quote === "'" && /^[\s]*[\[{]/.test(source.slice(index))) {
        const closingQuote = source.lastIndexOf(quote);
        if (closingQuote >= index) {
          value = source.slice(index, closingQuote);
          index = closingQuote;
        }
      }

      while (index < source.length) {
        const char = source[index]!;
        const next = source[index + 1];
        if (char === '\\' && next === quote) {
          value += char + next;
          index += 2;
          continue;
        }
        if (char === quote) break;
        value += char;
        index += 1;
      }

      attrs[attrName] = decodeAttributeValue(value);
      if (source[index] === quote) index += 1;
    }

    return attrs;
  };

  const parseWidgetData = (value: string): unknown => {
    const candidates = [value, value.replace(/\\"/g, '"').replace(/\\'/g, "'")];

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === 'string' && /^[\s[{]/.test(parsed)) {
          return JSON.parse(parsed);
        }
        return parsed;
      } catch {
        // Try the next normalization.
      }
    }

    throw new Error('Invalid widget data');
  };

  const decodeJsonString = (value: string): string => {
    try {
      return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
    } catch {
      return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
  };

  const recoverStringField = (source: string, keys: string[]): string | undefined => {
    for (const key of keys) {
      const closed = source.match(
        new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`)
      )?.[1];
      if (closed) return decodeJsonString(closed);

      const partial = source.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*)$`))?.[1];
      if (partial) {
        return decodeJsonString(partial.replace(/[,\]}]\s*$/, ''));
      }
    }

    return undefined;
  };

  const recoverStringArray = (source: string, key: string): string[] => {
    const start = source.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
    if (start === -1) return [];

    const afterKey = source.slice(start);
    const arrayStart = afterKey.indexOf('[');
    if (arrayStart === -1) return [];

    const arrayBody = afterKey.slice(
      arrayStart + 1,
      afterKey.indexOf(']', arrayStart + 1) + 1 || undefined
    );
    return Array.from(arrayBody.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)).map((match) =>
      decodeJsonString(match[1] ?? '')
    );
  };

  const recoverTableData = (value: string): unknown => {
    const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
    const headers = recoverStringArray(normalized, 'headers');
    const rowsSourceStart = normalized.search(/"rows"\s*:\s*\[/);
    const rowsSource = rowsSourceStart === -1 ? normalized : normalized.slice(rowsSourceStart);

    const rows = Array.from(rowsSource.matchAll(/\[([^\[\]]*"[^\[\]]*")\s*\]/g))
      .map((match) =>
        Array.from((match[1] ?? '').matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)).map((cell) =>
          decodeJsonString(cell[1] ?? '')
        )
      )
      .filter((row) => row.length >= Math.max(1, Math.min(headers.length || 1, 2)));

    if (headers.length > 0 && rows.length > 0) return { headers, rows };
    return { error: 'Invalid widget data' };
  };

  const recoverListData = (value: string, name: string): unknown => {
    const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
    const title = recoverStringField(normalized, ['title']);
    const collectionStart = normalized.search(/"(?:items|entries|facts|cards|steps)"\s*:\s*\[/);
    const collectionSource =
      collectionStart === -1 ? normalized : normalized.slice(collectionStart);
    const isKeyValue =
      name === 'key_value' ||
      name === 'key_values' ||
      name === 'facts' ||
      name === 'details' ||
      name === 'properties';
    const items: Array<Record<string, string | undefined>> = [];

    for (const chunk of collectionSource.split('{').slice(1)) {
      const itemSource = `{${chunk}`;
      if (isKeyValue) {
        const key = recoverStringField(itemSource, ['key', 'label', 'name', 'title']);
        const value = recoverStringField(itemSource, [
          'value',
          'detail',
          'description',
          'body',
          'text',
        ]);
        if (key || value) items.push({ key, value });
        continue;
      }

      const itemTitle = recoverStringField(itemSource, ['title', 'label', 'name', 'key']);
      const detail = recoverStringField(itemSource, [
        'detail',
        'description',
        'body',
        'text',
        'value',
      ]);
      if (itemTitle || detail) items.push({ title: itemTitle, detail });
    }

    if (items.length > 0) return title ? { title, items } : { items };
    return { error: 'Invalid widget data' };
  };

  const recoverWidgetData = (name: string, value: string): unknown => {
    const normalized = value.replace(/\\"/g, '"').replace(/\\'/g, "'");

    if (name === 'callout' || name === 'note') {
      const title = recoverStringField(normalized, ['title']);
      const body = recoverStringField(normalized, ['body', 'detail', 'text']);
      if (title || body) {
        return {
          title,
          body,
          tone: normalized.match(/"(?:type|tone|status)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/)?.[1],
        };
      }
    }

    if (name === 'table') return recoverTableData(value);
    if (
      name === 'list' ||
      name === 'checklist' ||
      name === 'key_value' ||
      name === 'key_values' ||
      name === 'facts' ||
      name === 'details' ||
      name === 'properties' ||
      name === 'card' ||
      name === 'cards' ||
      name === 'card_grid' ||
      name === 'step' ||
      name === 'steps' ||
      name === 'plan'
    ) {
      return recoverListData(value, name);
    }

    return { error: 'Invalid widget data' };
  };

  const parseWidgetTag = (tag: string): ParsedWidget | null => {
    const match = tag.trim().match(/^<([a-zA-Z_][\w.-]*)\s+([\s\S]*?)\/>$/i);
    const tagName = match?.[1]?.toLowerCase();
    if (
      !tagName ||
      !match?.[2] ||
      !CHAT_WIDGET_TAG_NAMES.includes(tagName as (typeof CHAT_WIDGET_TAG_NAMES)[number])
    ) {
      return null;
    }

    const attrs = parseTagAttributes(match[2]);
    const name = tagName === 'widget' ? attrs.name?.trim() : tagName;
    if (!name) return null;

    if (!attrs.data) return { name, data: {} };

    try {
      return { name, data: parseWidgetData(attrs.data) };
    } catch {
      return { name, data: recoverWidgetData(name, attrs.data) };
    }
  };

  const parseWidgetLine = (line: string): ParsedWidget | null => parseWidgetTag(line);

  const renderTextBlocksWithoutWidgets = (text: string, startKey: number): React.ReactElement[] => {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks: React.ReactElement[] = [];
    const paragraphLines: string[] = [];
    let key = startKey;
    let index = 0;

    const flushParagraph = () => {
      if (paragraphLines.length === 0) return;
      const paragraph = paragraphLines.join('\n').trimEnd();
      paragraphLines.length = 0;
      if (!paragraph.trim()) return;
      blocks.push(
        <p
          key={key++}
          className="my-2 whitespace-pre-wrap break-words leading-7 first:mt-0 last:mb-0"
        >
          {renderInlineElements(paragraph)}
        </p>
      );
    };

    while (index < lines.length) {
      const line = lines[index] ?? '';
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        index += 1;
        continue;
      }

      const table = parseMarkdownTable(lines, index);
      if (table) {
        flushParagraph();
        blocks.push(renderTable(table, key++));
        index = table.nextIndex;
        continue;
      }

      const widget = parseWidgetLine(trimmed);
      if (widget) {
        flushParagraph();
        blocks.push(<ChatMessageWidget key={key++} name={widget.name} data={widget.data} />);
        index += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        const level = headingMatch[1]!.length;
        const headingClass =
          'mb-2 mt-4 text-base font-semibold leading-6 text-text-primary first:mt-0 dark:text-dark-text-primary';
        const headingContent = renderInlineElements(headingMatch[2]!);
        if (level === 1) {
          blocks.push(
            <h2 key={key++} className={headingClass}>
              {headingContent}
            </h2>
          );
        } else if (level === 2) {
          blocks.push(
            <h3 key={key++} className={headingClass}>
              {headingContent}
            </h3>
          );
        } else if (level === 3) {
          blocks.push(
            <h4 key={key++} className={headingClass}>
              {headingContent}
            </h4>
          );
        } else {
          blocks.push(
            <h5 key={key++} className={headingClass}>
              {headingContent}
            </h5>
          );
        }
        index += 1;
        continue;
      }

      if (/^[-*_]{3,}$/.test(trimmed)) {
        flushParagraph();
        blocks.push(<hr key={key++} className="my-3 border-border dark:border-dark-border" />);
        index += 1;
        continue;
      }

      const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
      if (unorderedMatch) {
        flushParagraph();
        const items: string[] = [];
        while (index < lines.length) {
          const itemMatch = (lines[index] ?? '').trim().match(/^[-*+]\s+(.+)$/);
          if (!itemMatch) break;
          items.push(itemMatch[1]!);
          index += 1;
        }
        blocks.push(
          <ul key={key++} className="my-2 list-disc space-y-1 pl-5 leading-7">
            {items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInlineElements(item)}</li>
            ))}
          </ul>
        );
        continue;
      }

      const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (orderedMatch) {
        flushParagraph();
        const items: string[] = [];
        while (index < lines.length) {
          const itemMatch = (lines[index] ?? '').trim().match(/^\d+[.)]\s+(.+)$/);
          if (!itemMatch) break;
          items.push(itemMatch[1]!);
          index += 1;
        }
        blocks.push(
          <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 leading-7">
            {items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInlineElements(item)}</li>
            ))}
          </ol>
        );
        continue;
      }

      const quoteMatch = trimmed.match(/^>\s?(.+)$/);
      if (quoteMatch) {
        flushParagraph();
        blocks.push(
          <blockquote
            key={key++}
            className="my-2 border-l-2 border-primary/50 pl-3 text-text-secondary dark:text-dark-text-secondary"
          >
            {renderInlineElements(quoteMatch[1]!)}
          </blockquote>
        );
        index += 1;
        continue;
      }

      paragraphLines.push(line);
      index += 1;
    }

    flushParagraph();
    return blocks;
  };

  const renderTextBlocks = (text: string, startKey: number): React.ReactElement[] => {
    const blocks: React.ReactElement[] = [];
    let lastIndex = 0;
    let key = startKey;
    let match;

    WIDGET_TAG_REGEX.lastIndex = 0;
    while ((match = WIDGET_TAG_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const textBlocks = renderTextBlocksWithoutWidgets(text.slice(lastIndex, match.index), key);
        blocks.push(...textBlocks);
        key += textBlocks.length;
      }

      const widget = parseWidgetTag(match[0]);
      if (widget) {
        blocks.push(<ChatMessageWidget key={key++} name={widget.name} data={widget.data} />);
      } else {
        const textBlocks = renderTextBlocksWithoutWidgets(match[0], key);
        blocks.push(...textBlocks);
        key += textBlocks.length;
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      const textBlocks = renderTextBlocksWithoutWidgets(text.slice(lastIndex), key);
      blocks.push(...textBlocks);
    }

    return blocks;
  };

  // Parse markdown-like code blocks
  const renderContent = (text: string) => {
    const codeBlockRegex = /```(\w*)[ \t]*\r?\n?([\s\S]*?)```/g;
    const parts: React.ReactElement[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Add text before the code block
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        const textBlocks = renderTextBlocks(textBefore, key);
        parts.push(...textBlocks);
        key += textBlocks.length;
      }

      // Add the code block
      const language = match[1] || 'plaintext';
      const code = (match[2] ?? '').trim();
      const lineCount = code.split('\n').length;
      parts.push(
        <div key={key++} className="my-3">
          <CodeBlock
            code={code}
            language={language}
            showLineNumbers={compact ? lineCount > 5 : lineCount > 3}
            maxHeight={maxHeight}
          />
        </div>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const textBlocks = renderTextBlocks(text.slice(lastIndex), key);
      parts.push(...textBlocks);
    }

    return parts.length > 0 ? (
      parts
    ) : (
      <span className="whitespace-pre-wrap break-words">{renderInlineElements(text)}</span>
    );
  };

  const rendered = useMemo(() => renderContent(content), [content, compact, workspaceId]);

  return <div className={className}>{rendered}</div>;
});
