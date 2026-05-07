import { useWidgetErrorBoundary } from './WidgetErrorBoundary';
import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

export function CodeWidget({ data, title: titleProp }: Props) {
  useWidgetErrorBoundary();
  const record = typeof data === 'object' && data !== null ? data : {};

  const title = (record as { title?: string }).title || titleProp || 'Code';
  const code = typeof (record as { code?: string }).code === 'string'
    ? (record as { code: string }).code
    : typeof data === 'string' ? data : '';
  const language = ((record as { language?: string }).language || 'text').toLowerCase();
  const showLineNumbers = (record as { showLineNumbers?: boolean }).showLineNumbers !== false;

  if (!code) {
    return (
      <WidgetShell title={title} icon={<CodeIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No code provided</p>
      </WidgetShell>
    );
  }

  const lines = code.split('\n');

  return (
    <WidgetShell title={title} icon={<CodeIcon />} tone="default">
      <div className="rounded-md overflow-hidden border border-border dark:border-dark-border">
        <div className="flex items-center justify-between bg-bg-tertiary px-3 py-1.5 dark:bg-dark-bg-tertiary">
          <span className="text-xs font-medium text-text-muted">{language}</span>
        </div>
        <pre className="overflow-x-auto bg-bg-secondary p-3 text-sm dark:bg-dark-bg-secondary">
          <code>
            {lines.map((line, i) => (
              <span key={i} className="grid grid-cols-[auto_1fr] gap-4">
                {showLineNumbers && (
                  <span className="select-none text-text-muted/50 dark:text-dark-text-muted/50 text-right w-8">
                    {i + 1}
                  </span>
                )}
                <span className="text-text-primary dark:text-dark-text-primary whitespace-pre">{line}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </WidgetShell>
  );
}

function CodeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}