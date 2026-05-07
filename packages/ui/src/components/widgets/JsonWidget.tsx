import { useMemo } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function JsonWidget({ data, title: titleProp }: Props) {
  const record = isRecord(data) ? data : {};

  if (record.error === 'Invalid widget data') {
    const raw = typeof record.raw === 'string' ? record.raw : undefined;
    return (
      <WidgetShell
        title="Widget could not be rendered"
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="warning"
      >
        <div className="text-sm leading-6 text-text-secondary dark:text-dark-text-secondary">
          The data for this widget was incomplete or malformed, so it was hidden from the chat.
        </div>
        {raw && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-text-muted hover:text-text-primary dark:text-dark-text-muted dark:hover:text-dark-text-primary">
              Show raw data
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-bg-tertiary p-3 text-xs text-text-secondary dark:bg-dark-bg-tertiary dark:text-dark-text-secondary">
              {raw}
            </pre>
          </details>
        )}
      </WidgetShell>
    );
  }

  const title = titleProp || 'JSON';
  const visibleData = useMemo(() => {
    if (isRecord(data) && 'raw' in data && typeof data.raw === 'string' && data.raw.length > 200) {
      return { ...data, raw: '[hidden — truncated for display]' };
    }
    return data;
  }, [data]);

  return (
    <WidgetShell title={title} icon={<Info className="h-4 w-4" />}>
      <pre className="max-h-64 overflow-auto rounded-md bg-bg-tertiary p-3 text-xs text-text-secondary dark:bg-dark-bg-tertiary dark:text-dark-text-secondary">
        {JSON.stringify(visibleData, null, 2)}
      </pre>
    </WidgetShell>
  );
}