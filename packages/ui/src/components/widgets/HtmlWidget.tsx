import { useMemo } from 'react';
import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

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
  // Basic sanitization - remove dangerous tags and attributes
  // In production, use DOMPurify. For now, do basic cleaning.
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<iframe/gi, '&lt;iframe')
    .replace(/<object/gi, '&lt;object')
    .replace(/<embed/gi, '&lt;embed')
    .replace(/<form/gi, '&lt;form');
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