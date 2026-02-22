import { memo, useMemo, useState } from 'react';
import { CodeBlock } from './CodeBlock';

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

    return parts.length > 0 ? (
      parts
    ) : (
      <span className="whitespace-pre-wrap break-words">{text}</span>
    );
  };

  const rendered = useMemo(() => renderContent(content), [content, compact, workspaceId]);

  return <div className={className}>{rendered}</div>;
});
