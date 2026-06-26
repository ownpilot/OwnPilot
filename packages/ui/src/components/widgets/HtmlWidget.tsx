import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import DOMPurify__default from 'dompurify';
import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

// Handle both CJS (node test env) and ESM imports
type DOMPurifyModule = typeof DOMPurify__default & { default?: typeof DOMPurify__default };
const DOMPurify = (DOMPurify__default as DOMPurifyModule).default ?? DOMPurify__default;

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

export interface HtmlData {
  html: string;
  title?: string;
}

function isHtmlData(item: unknown): item is HtmlData {
  if (typeof item !== 'object' || item === null) return false;
  return typeof (item as Record<string, unknown>).html === 'string';
}

// Restrict URIs in href/src to http(s), mailto, and relative paths. The
// default DOMPurify allow-list also permits `tel:`, `xmpp:`, and a handful
// of niche schemes; we tighten so a sanitized blob cannot ship a
// surprise `data:`, `blob:`, or `vbscript:` link.
const SAFE_URI_RE = /^(?:(?:https?|mailto):|\/|#|[a-zA-Z0-9_./?=&%+-]+$)/i;

// Tags / attributes we accept. Explicit allow-listing means we don't rely
// on DOMPurify USE_PROFILES (which is implicit and version-dependent).
const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'i',
  'em',
  'strong',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'span',
] as const;

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'] as const;
const ALLOWED_TAG_SET = new Set<string>(ALLOWED_TAGS);
const ALLOWED_ATTR_SET = new Set<string>(ALLOWED_ATTR);
const URI_ATTRS = new Set(['href', 'src']);

let dompurifyHooked = false;
function ensureDompurifyHook(): void {
  if (dompurifyHooked) return;
  if (typeof DOMPurify.addHook !== 'function') return;
  // After sanitization, force `rel="noopener noreferrer"` on every
  // `<a target="_blank">` so a sanitized link cannot tabnab the parent
  // window via `window.opener`.
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // Strip target on non-_blank values to avoid `target="self"` shadowing.
    if (node.tagName === 'A') {
      const target = node.getAttribute('target');
      if (target && target !== '_blank') {
        node.removeAttribute('target');
      }
    }
  });
  dompurifyHooked = true;
}

function sanitizeHtml(html: string): string {
  if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') {
    // Fallback: strip all tags in non-DOMPurify environments (e.g., test SSR)
    return html.replace(/<[^>]*>/g, '').slice(0, 10000);
  }
  ensureDompurifyHook();
  // Explicit, restrictive config. The React node converter below performs
  // the final tag/attribute allow-list enforcement, which avoids relying on
  // environment-specific parser behavior for forbidden tags.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOWED_URI_REGEXP: SAFE_URI_RE,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'formaction', 'srcdoc'],
    RETURN_TRUSTED_TYPE: false,
  });
}

function safeAttributeProps(element: Element): Record<string, string> {
  const props: Record<string, string> = {};

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (!ALLOWED_ATTR_SET.has(name)) continue;
    if (URI_ATTRS.has(name) && !SAFE_URI_RE.test(value)) continue;

    if (name === 'class') {
      props.className = value;
    } else if (name === 'target') {
      if (value === '_blank') props.target = value;
    } else if (name === 'rel') {
      props.rel = value;
    } else {
      props[name] = value;
    }
  }

  if (props.target === '_blank') {
    props.rel = 'noopener noreferrer';
  }

  return props;
}

function nodeToReact(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  if (!ALLOWED_TAG_SET.has(tagName)) {
    return null;
  }

  const children = Array.from(element.childNodes)
    .map((child, index) => nodeToReact(child, `${key}-${index}`))
    .filter(
      (child): child is Exclude<ReactNode, null | undefined | false> =>
        child != null && child !== false
    );

  return createElement(tagName, { key, ...safeAttributeProps(element) }, ...children);
}

function htmlToReactNodes(html: string): ReactNode {
  if (typeof DOMParser === 'undefined' || typeof Node === 'undefined') {
    return html;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = Array.from(doc.body.childNodes)
    .map((node, index) => nodeToReact(node, `html-${index}`))
    .filter(
      (node): node is Exclude<ReactNode, null | undefined | false> => node != null && node !== false
    );

  return createElement(Fragment, null, ...nodes);
}

function HtmlIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  );
}

export function HtmlWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  const htmlContent = isHtmlData(data) ? data.html : typeof data === 'string' ? data : '';

  const renderedHtml = useMemo(() => htmlToReactNodes(sanitizeHtml(htmlContent)), [htmlContent]);

  if (!htmlContent) {
    return (
      <WidgetShell title={title || 'HTML'} icon={<HtmlIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No HTML content provided</p>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title={title || 'HTML'} icon={<HtmlIcon />}>
      <div className="prose prose-sm dark:prose-invert max-w-none">{renderedHtml}</div>
    </WidgetShell>
  );
}
