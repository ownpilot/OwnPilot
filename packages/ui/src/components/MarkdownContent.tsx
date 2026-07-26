import { memo, useMemo, useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { ChatMessageWidget } from './ChatMessageWidget';
import { CHAT_WIDGET_TAG_NAMES } from '../utils/chat-content';

export { hideIncompleteStreamingWidgets } from '../utils/chat-content';

import { isSafeUrl, resolveImageUrl } from './MarkdownContent.url-helpers';

import {
  isRecord,
  parseTagAttributes,
  parseWidgetData,
  recoverWidgetData,
  isCalloutLikeFallback,
  canonicalWidgetName,
  normalizeWidgetDataShape,
} from './markdown-widgets';

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

export interface ParsedWidget {
  name: string;
  data: unknown;
}

interface WidgetTagParts {
  tagName: string;
  attrsSource: string;
  body?: string;
}

const WIDGET_TAG_PATTERN = CHAT_WIDGET_TAG_NAMES.join('|');
const WIDGET_TAG_START_REGEX = new RegExp(`<(${WIDGET_TAG_PATTERN})\\b`, 'gi');

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

  const splitWidgetTag = (tag: string): WidgetTagParts | null => {
    const trimmed = tag.trim();
    const nameMatch = trimmed.match(/^<([a-zA-Z_][\w.-]*)/);
    const tagName = nameMatch?.[1];
    if (!tagName) return null;

    let quote: '"' | "'" | null = null;
    let escaped = false;
    let quoteContentIsJson = false;
    const attrsStart = nameMatch[0].length;

    const isAtTagBoundary = (afterIndex: number): boolean => {
      let look = afterIndex;
      while (look < trimmed.length && /\s/.test(trimmed[look] ?? '')) look += 1;
      if (look >= trimmed.length) return true;
      if (trimmed[look] === '/' && trimmed[look + 1] === '>') return true;
      if (trimmed[look] === '>') return true;
      return false;
    };

    for (let index = attrsStart; index < trimmed.length; index += 1) {
      const char = trimmed[index]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          if (quoteContentIsJson && !isAtTagBoundary(index + 1)) continue;
          quote = null;
          quoteContentIsJson = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        let look = index + 1;
        while (look < trimmed.length && /\s/.test(trimmed[look] ?? '')) look += 1;
        quoteContentIsJson = trimmed[look] === '{' || trimmed[look] === '[';
        continue;
      }

      if (char === '/' && trimmed[index + 1] === '>') {
        return { tagName, attrsSource: trimmed.slice(attrsStart, index).trim() };
      }

      if (char === '>') {
        const closingTag = `</${tagName}>`;
        if (!trimmed.toLowerCase().endsWith(closingTag.toLowerCase())) return null;
        return {
          tagName,
          attrsSource: trimmed.slice(attrsStart, index).trim(),
          body: trimmed.slice(index + 1, trimmed.length - closingTag.length),
        };
      }
    }

    return null;
  };

  const parseWidgetTag = (tag: string): ParsedWidget | null => {
    const parts = splitWidgetTag(tag);
    if (!parts) return null;
    const tagName = parts?.tagName.toLowerCase();
    if (
      !tagName ||
      !CHAT_WIDGET_TAG_NAMES.includes(tagName as (typeof CHAT_WIDGET_TAG_NAMES)[number])
    ) {
      return null;
    }

    const attrs = parseTagAttributes(parts.attrsSource);
    const name =
      tagName === 'widget'
        ? canonicalWidgetName(attrs.name ?? attrs.type ?? attrs.widget ?? attrs.kind ?? '')
        : canonicalWidgetName(tagName);
    if (!name) return null;

    const dataValue = attrs.data ?? parts.body?.trim();
    if (!dataValue) return { name, data: {} };

    try {
      return { name, data: normalizeWidgetDataShape(name, parseWidgetData(dataValue)) };
    } catch {
      let data = recoverWidgetData(name, dataValue);
      if (isRecord(data) && data.error === 'Invalid widget data') {
        data = { ...data, raw: dataValue };
      }
      return {
        name: isCalloutLikeFallback(data) ? 'callout' : name,
        data: normalizeWidgetDataShape(name, data),
      };
    }
  };

  const parseWidgetLine = (line: string): ParsedWidget | null => parseWidgetTag(line);

  const findWidgetTagEnd = (text: string, startIndex: number, tagName: string): number => {
    const lowerText = text.toLowerCase();
    const closingTag = `</${tagName.toLowerCase()}>`;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let quoteContentIsJson = false;

    const isAtTagBoundary = (afterIndex: number): boolean => {
      let look = afterIndex;
      while (look < text.length && /\s/.test(text[look] ?? '')) look += 1;
      if (look >= text.length) return true;
      if (text[look] === '/' && text[look + 1] === '>') return true;
      if (text[look] === '>') return true;
      return false;
    };

    for (let index = startIndex; index < text.length; index += 1) {
      const char = text[index]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          // JSON-like values may contain stray apostrophes (e.g. Turkish "09:00'da").
          // Treat `'` as the closing quote only when followed by a tag boundary.
          if (quoteContentIsJson && !isAtTagBoundary(index + 1)) {
            continue;
          }
          quote = null;
          quoteContentIsJson = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        let look = index + 1;
        while (look < text.length && /\s/.test(text[look] ?? '')) look += 1;
        quoteContentIsJson = text[look] === '{' || text[look] === '[';
        continue;
      }

      if (char === '/' && text[index + 1] === '>') return index + 2;

      if (char === '>') {
        const closingAt = lowerText.indexOf(closingTag, index + 1);
        return closingAt === -1 ? -1 : closingAt + closingTag.length;
      }
    }

    return -1;
  };

  const findNextWidgetTag = (
    text: string,
    startIndex: number
  ): { start: number; end: number } | null => {
    WIDGET_TAG_START_REGEX.lastIndex = startIndex;
    let match: RegExpExecArray | null;

    while ((match = WIDGET_TAG_START_REGEX.exec(text)) !== null) {
      const tagName = match[1];
      if (!tagName) continue;
      const end = findWidgetTagEnd(text, match.index, tagName);
      if (end !== -1) return { start: match.index, end };
    }

    return null;
  };

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
    let match: ReturnType<typeof findNextWidgetTag>;

    while ((match = findNextWidgetTag(text, lastIndex)) !== null) {
      if (match.start > lastIndex) {
        const textBlocks = renderTextBlocksWithoutWidgets(text.slice(lastIndex, match.start), key);
        blocks.push(...textBlocks);
        key += textBlocks.length;
      }

      const tag = text.slice(match.start, match.end);
      const widget = parseWidgetTag(tag);
      if (widget) {
        blocks.push(<ChatMessageWidget key={key++} name={widget.name} data={widget.data} />);
      } else {
        const textBlocks = renderTextBlocksWithoutWidgets(tag, key);
        blocks.push(...textBlocks);
        key += textBlocks.length;
      }

      lastIndex = match.end;
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
