/**
 * ArtifactRenderer
 *
 * Renders artifacts by type:
 * - html/chart: sandboxed iframe with srcdoc, data injected as window.__DATA__
 * - svg: sandboxed iframe srcdoc (no raw innerHTML — XSS safe)
 * - markdown: MarkdownContent component
 * - form: JSON form schema rendered as inputs
 * - react: placeholder (deferred to v2)
 */

import { useMemo } from 'react';
import { MarkdownContent } from './MarkdownContent';
import type { ArtifactType, DataBinding } from '../api/endpoints/artifacts';

interface ArtifactRendererProps {
  type: ArtifactType;
  content: string;
  dataBindings?: DataBinding[];
  className?: string;
  fullWidth?: boolean;
}

function buildIframeDoc(content: string, dataBindings?: DataBinding[]): string {
  const dataScript = dataBindings?.length
    ? `<script>window.__DATA__ = ${JSON.stringify(
        Object.fromEntries(
          dataBindings
            .filter((b) => b.lastValue !== undefined)
            .map((b) => [b.variableName, b.lastValue])
        )
      )};</script>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: https:; font-src https://cdn.jsdelivr.net;">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; color: #1a1a2e; background: transparent; }
  @media (prefers-color-scheme: dark) {
    body { color: #e0e0e0; }
  }
</style>
${dataScript}
</head>
<body>${content}</body>
</html>`;
}

function buildSvgDoc(svgContent: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
<style>
  body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: transparent; }
  svg { max-width: 100%; height: auto; }
</style>
</head>
<body>${svgContent}</body>
</html>`;
}

function HtmlRenderer({
  content,
  dataBindings,
  className,
  fullWidth,
}: {
  content: string;
  dataBindings?: DataBinding[];
  className?: string;
  fullWidth?: boolean;
}) {
  const srcdoc = useMemo(() => buildIframeDoc(content, dataBindings), [content, dataBindings]);

  return (
    <iframe
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className={`w-full border-0 rounded-lg bg-white dark:bg-dark-bg-tertiary ${className ?? ''}`}
      style={{ minHeight: fullWidth ? 400 : 200 }}
      title="Artifact"
    />
  );
}

function SvgRenderer({ content, className, fullWidth }: { content: string; className?: string; fullWidth?: boolean }) {
  const srcdoc = useMemo(() => buildSvgDoc(content), [content]);

  return (
    <iframe
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className={`w-full border-0 rounded-lg bg-white dark:bg-dark-bg-tertiary ${className ?? ''}`}
      style={{ minHeight: fullWidth ? 300 : 150 }}
      title="SVG Artifact"
    />
  );
}

function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`prose dark:prose-invert max-w-none ${className ?? ''}`}>
      <MarkdownContent
        content={content}
        className="text-sm text-text-primary dark:text-dark-text-primary leading-relaxed"
      />
    </div>
  );
}

function FormRenderer({ content, className }: { content: string; className?: string }) {
  const schema = useMemo(() => {
    try {
      return JSON.parse(content) as {
        fields?: Array<{ name: string; type: string; label: string; placeholder?: string }>;
      };
    } catch {
      return null;
    }
  }, [content]);

  if (!schema?.fields) {
    return (
      <div className={`text-sm text-text-muted dark:text-dark-text-muted ${className ?? ''}`}>
        Invalid form schema
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      {schema.fields.map((field) => (
        <div key={field.name}>
          <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
            {field.label}
          </label>
          {field.type === 'textarea' ? (
            <textarea
              placeholder={field.placeholder}
              className="w-full px-3 py-2 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
              rows={3}
            />
          ) : (
            <input
              type={field.type || 'text'}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function ArtifactRenderer({
  type,
  content,
  dataBindings,
  className,
  fullWidth,
}: ArtifactRendererProps) {
  switch (type) {
    case 'html':
    case 'chart':
      return <HtmlRenderer content={content} dataBindings={dataBindings} className={className} fullWidth={fullWidth} />;
    case 'svg':
      return <SvgRenderer content={content} className={className} fullWidth={fullWidth} />;
    case 'markdown':
      return <MarkdownRenderer content={content} className={className} />;
    case 'form':
      return <FormRenderer content={content} className={className} />;
    case 'react':
      return (
        <div
          className={`flex items-center justify-center p-8 text-sm text-text-muted dark:text-dark-text-muted ${className ?? ''}`}
        >
          React artifacts are not supported in this version.
        </div>
      );
    default:
      return null;
  }
}
