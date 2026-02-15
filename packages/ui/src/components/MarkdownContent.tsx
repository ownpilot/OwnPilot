import { memo, useMemo } from 'react';
import { CodeBlock } from './CodeBlock';

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** Smaller code blocks for compact views (history/inbox) */
  compact?: boolean;
}

export const MarkdownContent = memo(function MarkdownContent({ content, className, compact }: MarkdownContentProps) {
  const maxHeight = compact ? '200px' : '300px';

  // Render inline elements (bold, italic, inline code, links)
  const renderInlineElements = (text: string): (string | React.ReactElement)[] => {
    const elements: (string | React.ReactElement)[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      // Inline code
      const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
      if (inlineCodeMatch) {
        elements.push(
          <code key={key++} className="px-1.5 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary text-primary rounded font-mono text-sm">
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

      // Links
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        elements.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {linkMatch[1]}
          </a>
        );
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // No match, add next character
      const nextSpecial = remaining.search(/[`*\[]/);
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
        parts.push(
          <span key={key++} className="whitespace-pre-wrap break-words">
            {renderInlineElements(textBefore)}
          </span>
        );
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
      parts.push(
        <span key={key++} className="whitespace-pre-wrap break-words">
          {renderInlineElements(text.slice(lastIndex))}
        </span>
      );
    }

    return parts.length > 0 ? parts : <span className="whitespace-pre-wrap break-words">{text}</span>;
  };

  const rendered = useMemo(() => renderContent(content), [content, compact]);

  return (
    <div className={className}>
      {rendered}
    </div>
  );
});
