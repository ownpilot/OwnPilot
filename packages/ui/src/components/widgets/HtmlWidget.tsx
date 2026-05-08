import { useMemo } from 'react';
import DOMPurify__default from 'dompurify';
import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

// Handle both CJS (node test env) and ESM imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DOMPurify = (DOMPurify__default as any).default ?? DOMPurify__default;

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface HtmlData {
  html: string;
  title?: string;
}

function isHtmlData(item: unknown): item is HtmlData {
  if (typeof item !== 'object' || item === null) return false;
  return typeof (item as Record<string, unknown>).html === 'string';
}

function sanitizeHtml(html: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dp = DOMPurify as any;
  if (!dp || typeof dp.sanitize !== 'function') {
    // Fallback: strip all tags in non-DOMPurify environments (e.g., test SSR)
    return html.replace(/<[^>]*>/g, '').slice(0, 10000);
  }
  // Use DOMPurify for production-grade XSS sanitization
  return dp.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
}

function HtmlIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}

export function HtmlWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  const htmlContent = isHtmlData(data)
    ? data.html
    : typeof data === 'string'
      ? data
      : '';

  const sanitized = useMemo(() => sanitizeHtml(htmlContent), [htmlContent]);

  if (!htmlContent) {
    return (
      <WidgetShell title={title || 'HTML'} icon={<HtmlIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No HTML content provided</p>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title={title || 'HTML'} icon={<HtmlIcon />}>
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </WidgetShell>
  );
}