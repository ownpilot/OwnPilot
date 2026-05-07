import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Circle,
  Clipboard,
  Info,
  Layers,
  ListChecks,
  Table,
  TrendingUp,
} from './icons';
import { WidgetShell } from './widgets/WidgetShell';
import {
  CodeWidget,
  ImageWidget,
  FileWidget,
  VideoWidget,
  AudioWidget,
  EmbedWidget,
  ChartWidget,
  HtmlWidget as HtmlWidgetComponent,
  WidgetErrorBoundary,
} from './widgets';
import type { WidgetTone } from './widgets/widget-types';

interface ChatMessageWidgetProps {
  name: string;
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJsonPayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function warnFallback(widget: string, reason: string, data: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[ChatMessageWidget] ${widget} → JsonWidget fallback (${reason})`, data);
  }
}

function firstArrayValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return undefined;
}

function normalizeRenderableData(name: string, data: unknown): unknown {
  const parsed = typeof data === 'string' ? parseJsonPayload(data) : data;
  if (!isRecord(parsed)) return parsed;

  if (
    name === 'key_value' ||
    name === 'key_values' ||
    name === 'facts' ||
    name === 'details' ||
    name === 'properties'
  ) {
    const items =
      parsed.items ?? parsed.entries ?? parsed.facts ?? parsed.properties ?? parsed.details;
    if (Array.isArray(items) && !Array.isArray(parsed.items)) return { ...parsed, items };

    const singleLabel = parsed.key ?? parsed.label ?? parsed.name;
    const singleValue = parsed.value ?? parsed.text ?? parsed.detail ?? parsed.description;
    if (
      (typeof singleLabel === 'string' || typeof singleLabel === 'number') &&
      (typeof singleValue === 'string' ||
        typeof singleValue === 'number' ||
        typeof singleValue === 'boolean')
    ) {
      return { title: parsed.title, items: [{ key: singleLabel, value: singleValue }] };
    }

    const reserved = new Set([
      'title',
      'tone',
      'status',
      'type',
      'items',
      'entries',
      'facts',
      'properties',
      'details',
    ]);
    const scalarItems = Object.entries(parsed)
      .filter(
        ([key, value]) =>
          !reserved.has(key) &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      )
      .map(([key, value]) => ({ key, value }));
    return scalarItems.length > 0 ? { title: parsed.title, items: scalarItems } : parsed;
  }

  if (name === 'card' || name === 'cards' || name === 'card_grid') {
    const items = parsed.items ?? parsed.cards ?? parsed.entries;
    if (Array.isArray(items) && !Array.isArray(parsed.items)) return { ...parsed, items };

    const hasCardFields = ['title', 'label', 'name', 'detail', 'description', 'body', 'text'].some(
      (key) => parsed[key] !== undefined
    );
    if (hasCardFields && !Array.isArray(parsed.items)) return { items: [parsed] };
  }

  if (name === 'metric' || name === 'metrics' || name === 'metric_grid' || name === 'stats') {
    const items = firstArrayValue(parsed, ['items', 'metrics', 'stats', 'values']);
    return items && !Array.isArray(parsed.items) ? { ...parsed, items } : parsed;
  }

  if (name === 'list' || name === 'checklist') {
    const items = firstArrayValue(parsed, [
      'items',
      'entries',
      'list',
      'tasks',
      'todos',
      'recommendations',
      'suggestions',
    ]);
    return items && !Array.isArray(parsed.items) ? { ...parsed, items } : parsed;
  }

  if (name === 'table') {
    const rows = firstArrayValue(parsed, ['rows', 'items', 'entries', 'data']);
    const headers = firstArrayValue(parsed, ['headers', 'columns', 'fields']);
    const normalized = { ...parsed };
    if (rows && !Array.isArray(normalized.rows)) normalized.rows = rows;
    if (headers && !Array.isArray(normalized.headers)) normalized.headers = headers;
    return normalized;
  }

  if (name === 'step' || name === 'steps' || name === 'plan') {
    const items = firstArrayValue(parsed, ['items', 'steps', 'plan', 'tasks']);
    return items && !Array.isArray(parsed.items) ? { ...parsed, items } : parsed;
  }

  if (name === 'bar' || name === 'bar_chart') {
    const items = firstArrayValue(parsed, ['items', 'bars', 'series', 'values']);
    return items && !Array.isArray(parsed.items) ? { ...parsed, items } : parsed;
  }

  if (name === 'timeline') {
    const items = firstArrayValue(parsed, ['items', 'events', 'entries']);
    return items && !Array.isArray(parsed.items) ? { ...parsed, items } : parsed;
  }

  return parsed;
}

function toneClasses(tone: WidgetTone): {
  shell: string;
  icon: string;
  marker: string;
} {
  switch (tone) {
    case 'success':
      return {
        shell: 'border-success/25 bg-success/5',
        icon: 'text-success',
        marker: 'bg-success',
      };
    case 'warning':
      return {
        shell: 'border-warning/30 bg-warning/10',
        icon: 'text-warning',
        marker: 'bg-warning',
      };
    case 'danger':
      return {
        shell: 'border-error/30 bg-error/10',
        icon: 'text-error',
        marker: 'bg-error',
      };
    case 'info':
      return {
        shell: 'border-primary/25 bg-primary/5',
        icon: 'text-primary',
        marker: 'bg-primary',
      };
    default:
      return {
        shell: 'border-border bg-bg-primary dark:border-dark-border dark:bg-dark-bg-primary',
        icon: 'text-text-muted dark:text-dark-text-muted',
        marker: 'bg-text-muted dark:bg-dark-text-muted',
      };
  }
}

function normalizeTone(value: unknown): WidgetTone {
  if (
    value === 'info' ||
    value === 'success' ||
    value === 'warning' ||
    value === 'danger' ||
    value === 'default'
  ) {
    return value;
  }
  return 'default';
}

function MetricGrid({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const itemsSource = Array.isArray(data) ? data : record.items;
  const items = asArray(itemsSource).filter(isRecord).slice(0, 8);

  if (items.length === 0) {
    warnFallback('metric_grid', 'no items after filter', data);
    return <JsonWidget name="metric_grid" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<BarChart3 className="h-4 w-4" />}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => {
          const tone = normalizeTone(item.tone ?? item.status);
          const classes = toneClasses(tone);
          const detail = asText(item.detail ?? item.change);
          return (
            <div
              key={index}
              className="rounded-md border border-border bg-bg-secondary/70 p-3 dark:border-dark-border dark:bg-dark-bg-secondary/70"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-dark-text-muted">
                  {asText(item.label)}
                </div>
                <span className={`h-2 w-2 rounded-full ${classes.marker}`} />
              </div>
              <div className="mt-1 text-xl font-semibold text-text-primary dark:text-dark-text-primary">
                {asText(item.value)}
              </div>
              {detail && (
                <div className="mt-1 text-xs text-text-secondary dark:text-dark-text-secondary">
                  {detail}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

function TableWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const rawRows = asArray(Array.isArray(data) ? data : record.rows);
  const rawColumns = asArray(record.columns ?? record.headers)
    .map(asText)
    .filter(Boolean);
  const objectRows = rawRows.filter(isRecord);
  const columns =
    rawColumns.length > 0
      ? rawColumns
      : objectRows.length > 0
        ? Object.keys(objectRows[0]!)
        : asArray(rawRows[0]).map((_, index) => `Column ${index + 1}`);

  if (columns.length === 0 || rawRows.length === 0) {
    warnFallback('table', `columns=${columns.length} rows=${rawRows.length}`, data);
    return <JsonWidget name="table" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<Table className="h-4 w-4" />}>
      <div className="max-w-full overflow-x-auto rounded-md border border-border dark:border-dark-border">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bg-tertiary/80 dark:bg-dark-bg-tertiary/80">
              {columns.map((column) => (
                <th
                  key={column}
                  className="border-b border-border px-3 py-2 text-left font-semibold text-text-secondary dark:border-dark-border dark:text-dark-text-secondary"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rawRows.slice(0, 30).map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="odd:bg-bg-primary even:bg-bg-secondary/60 dark:odd:bg-dark-bg-primary dark:even:bg-dark-bg-secondary/60"
              >
                {columns.map((column, columnIndex) => {
                  const value = isRecord(row) ? row[column] : asArray(row)[columnIndex];
                  return (
                    <td
                      key={`${rowIndex}-${column}`}
                      className="border-b border-border/70 px-3 py-2 align-top text-text-primary dark:border-dark-border/70 dark:text-dark-text-primary"
                    >
                      {asText(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  );
}

function ListWidget({ data, checklist = false }: { data: unknown; checklist?: boolean }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const items = asArray(Array.isArray(data) ? data : record.items).slice(0, 20);

  if (items.length === 0) {
    const widgetName = checklist ? 'checklist' : 'list';
    warnFallback(widgetName, 'no items after filter', data);
    return <JsonWidget name={widgetName} data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<ListChecks className="h-4 w-4" />}>
      <div className="space-y-2">
        {items.map((item, index) => {
          const itemRecord = isRecord(item) ? item : {};
          const done = itemRecord.done === true || itemRecord.status === 'done';
          const label = isRecord(item)
            ? asText(itemRecord.label ?? itemRecord.title)
            : asText(item);
          const detail = isRecord(item) ? asText(itemRecord.detail ?? itemRecord.description) : '';
          return (
            <div key={index} className="flex gap-2">
              {checklist ? (
                done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
                )
              ) : (
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
              )}
              <div>
                <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {label}
                </div>
                {detail && (
                  <div className="text-xs text-text-secondary dark:text-dark-text-secondary">
                    {detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

function KeyValueWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const entriesSource = Array.isArray(data)
    ? data
    : (record.items ?? record.entries ?? record.facts);
  const entries = asArray(entriesSource)
    .map((entry) => {
      if (isRecord(entry)) return entry;
      // Promote `"key: value"` strings to records so we don't drop loose LLM output.
      if (typeof entry === 'string') {
        const colonAt = entry.indexOf(':');
        return colonAt > 0
          ? { key: entry.slice(0, colonAt).trim(), value: entry.slice(colonAt + 1).trim() }
          : { value: entry };
      }
      return null;
    })
    .filter(isRecord)
    .slice(0, 24);

  if (entries.length === 0) {
    warnFallback('key_value', 'no entries after filter', data);
    return <JsonWidget name="key_value" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<Clipboard className="h-4 w-4" />}>
      <dl className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry, index) => {
          const label = asText(entry.label ?? entry.key ?? entry.name ?? entry.title);
          const value = asText(entry.value ?? entry.text ?? entry.detail ?? entry.description);
          if (!label && !value) return null;
          return (
            <div
              key={index}
              className="rounded-md border border-border bg-bg-secondary/70 px-3 py-2 dark:border-dark-border dark:bg-dark-bg-secondary/70"
            >
              {label && (
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted dark:text-dark-text-muted">
                  {label}
                </dt>
              )}
              {value && (
                <dd className="mt-0.5 text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {value}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </WidgetShell>
  );
}

function CardsWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const items = asArray(Array.isArray(data) ? data : (record.items ?? record.cards))
    .map((item) => {
      if (isRecord(item)) return item;
      // Promote bare strings to a card-shaped record so the widget still renders.
      if (typeof item === 'string') return { title: item };
      return null;
    })
    .filter(isRecord)
    .slice(0, 9);

  if (items.length === 0) {
    warnFallback('cards', 'no items after filter', data);
    return <JsonWidget name="cards" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<Layers className="h-4 w-4" />}>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item, index) => {
          const tone = normalizeTone(item.tone ?? item.status);
          const classes = toneClasses(tone);
          const cardTitle = asText(item.title ?? item.label ?? item.name);
          const detail = asText(item.detail ?? item.description ?? item.body ?? item.text);
          const meta = asText(item.meta ?? item.subtitle ?? item.value);
          return (
            <article
              key={index}
              className="rounded-md border border-border bg-bg-secondary/70 p-3 dark:border-dark-border dark:bg-dark-bg-secondary/70"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  {cardTitle && (
                    <h4 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                      {cardTitle}
                    </h4>
                  )}
                  {meta && (
                    <div className="mt-0.5 text-xs text-text-muted dark:text-dark-text-muted">
                      {meta}
                    </div>
                  )}
                </div>
                <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${classes.marker}`} />
              </div>
              {detail && (
                <p className="mt-2 text-sm leading-6 text-text-secondary dark:text-dark-text-secondary">
                  {detail}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </WidgetShell>
  );
}

function StepsWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const steps = asArray(Array.isArray(data) ? data : (record.items ?? record.steps))
    .filter((item) => typeof item === 'string' || isRecord(item))
    .slice(0, 12);

  if (steps.length === 0) {
    warnFallback('steps', 'no steps after filter', data);
    return <JsonWidget name="steps" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<ListChecks className="h-4 w-4" />}>
      <ol className="space-y-3">
        {steps.map((step, index) => {
          const item = isRecord(step) ? step : {};
          const label = isRecord(step)
            ? asText(item.label ?? item.title ?? item.name)
            : asText(step);
          const detail = isRecord(step)
            ? asText(item.detail ?? item.description ?? item.body ?? item.text)
            : '';
          const tone = normalizeTone(item.tone ?? item.status);
          const classes = toneClasses(tone);
          return (
            <li key={index} className="grid grid-cols-[auto_1fr] gap-3">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white ${classes.marker}`}
              >
                {index + 1}
              </span>
              <div>
                <div className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                  {label}
                </div>
                {detail && (
                  <div className="mt-0.5 text-sm leading-6 text-text-secondary dark:text-dark-text-secondary">
                    {detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </WidgetShell>
  );
}

function CalloutWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const tone = normalizeTone(record.tone ?? record.status ?? 'info');
  const title = asText(record.title);
  const body = asText(record.body ?? record.detail ?? record.text ?? data);
  const Icon = tone === 'warning' || tone === 'danger' ? AlertTriangle : Info;

  return (
    <WidgetShell title={title || undefined} icon={<Icon className="h-4 w-4" />} tone={tone}>
      <div className="text-sm leading-6 text-text-primary dark:text-dark-text-primary">{body}</div>
    </WidgetShell>
  );
}

function ProgressWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const label = asText(record.label);
  const value = Number(record.value ?? 0);
  const max = Number(record.max ?? 100);
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <WidgetShell title={title || undefined} icon={<TrendingUp className="h-4 w-4" />}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-primary dark:text-dark-text-primary">{label}</span>
        <span className="text-text-muted dark:text-dark-text-muted">{Math.round(percentage)}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
      </div>
    </WidgetShell>
  );
}

function BarChartWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const bars = asArray(Array.isArray(data) ? data : record.items)
    .filter(isRecord)
    .slice(0, 12);
  const maxValue = Math.max(
    1,
    ...bars.map((bar) => {
      const value = Number(bar.value ?? 0);
      return Number.isFinite(value) ? value : 0;
    })
  );

  if (bars.length === 0) {
    warnFallback('bar_chart', 'no bars after filter', data);
    return <JsonWidget name="bar_chart" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<BarChart3 className="h-4 w-4" />}>
      <div className="space-y-2">
        {bars.map((bar, index) => {
          const label = asText(bar.label ?? bar.name);
          const value = Number(bar.value ?? 0);
          const safeValue = Number.isFinite(value) ? value : 0;
          const width = Math.max(2, Math.min(100, (safeValue / maxValue) * 100));
          return (
            <div
              key={index}
              className="grid grid-cols-[minmax(96px,1fr)_minmax(0,2fr)_auto] items-center gap-2 text-sm"
            >
              <div className="truncate font-medium text-text-secondary dark:text-dark-text-secondary">
                {label}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </div>
              <div className="min-w-8 text-right tabular-nums text-text-primary dark:text-dark-text-primary">
                {asText(bar.displayValue) || String(safeValue)}
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

function TimelineWidget({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const items = asArray(Array.isArray(data) ? data : record.items)
    .filter(isRecord)
    .slice(0, 12);

  if (items.length === 0) {
    warnFallback('timeline', 'no items after filter', data);
    return <JsonWidget name="timeline" data={data} />;
  }

  return (
    <WidgetShell title={title || undefined} icon={<TrendingUp className="h-4 w-4" />}>
      <div className="space-y-0">
        {items.map((item, index) => {
          const tone = normalizeTone(item.tone ?? item.status);
          const classes = toneClasses(tone);
          const label = asText(item.label ?? item.title);
          const time = asText(item.time ?? item.date);
          const detail = asText(item.detail ?? item.description);
          return (
            <div key={index} className="grid grid-cols-[auto_1fr] gap-x-3">
              <div className="flex flex-col items-center">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${classes.marker}`} />
                {index < items.length - 1 && (
                  <span className="h-full min-h-8 w-px bg-border dark:bg-dark-border" />
                )}
              </div>
              <div className="pb-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-text-primary dark:text-dark-text-primary">
                    {label}
                  </span>
                  {time && (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {time}
                    </span>
                  )}
                </div>
                {detail && (
                  <div className="mt-0.5 text-sm text-text-secondary dark:text-dark-text-secondary">
                    {detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

function JsonWidget({ name, data }: ChatMessageWidgetProps) {
  if (isRecord(data) && data.error === 'Invalid widget data') {
    const raw = typeof data.raw === 'string' ? data.raw : undefined;
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

  const visibleData =
    isRecord(data) && 'raw' in data && typeof data.raw === 'string' && data.raw.length > 200
      ? { ...data, raw: '[hidden — truncated for display]' }
      : data;

  return (
    <WidgetShell title={name} icon={<Info className="h-4 w-4" />}>
      <pre className="max-h-64 overflow-auto rounded-md bg-bg-tertiary p-3 text-xs text-text-secondary dark:bg-dark-bg-tertiary dark:text-dark-text-secondary">
        {JSON.stringify(visibleData, null, 2)}
      </pre>
    </WidgetShell>
  );
}

export function ChatMessageWidget({ name, data }: ChatMessageWidgetProps) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const renderData = normalizeRenderableData(normalized, data);

  if (isRecord(renderData) && renderData.error === 'Invalid widget data') {
    return <JsonWidget name={normalized || 'widget'} data={renderData} />;
  }

  switch (normalized) {
    case 'metric':
    case 'metrics':
    case 'metric_grid':
    case 'stats':
      return (
        <WidgetErrorBoundary>
          <MetricGrid data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'table':
      return (
        <WidgetErrorBoundary>
          <TableWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'list':
      return (
        <WidgetErrorBoundary>
          <ListWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'checklist':
      return (
        <WidgetErrorBoundary>
          <ListWidget data={renderData} checklist />
        </WidgetErrorBoundary>
      );
    case 'key_value':
    case 'key_values':
    case 'facts':
    case 'details':
    case 'properties':
      return (
        <WidgetErrorBoundary>
          <KeyValueWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'card':
    case 'cards':
    case 'card_grid':
      return (
        <WidgetErrorBoundary>
          <CardsWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'step':
    case 'steps':
    case 'plan':
      return (
        <WidgetErrorBoundary>
          <StepsWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'callout':
    case 'note':
      return (
        <WidgetErrorBoundary>
          <CalloutWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'progress':
      return (
        <WidgetErrorBoundary>
          <ProgressWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'bar':
    case 'bar_chart':
      return (
        <WidgetErrorBoundary>
          <BarChartWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'timeline':
      return (
        <WidgetErrorBoundary>
          <TimelineWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    // Code & Media widgets
    case 'code':
    case 'code_block':
      return (
        <WidgetErrorBoundary>
          <CodeWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'image':
    case 'images':
      return (
        <WidgetErrorBoundary>
          <ImageWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'video':
      return (
        <WidgetErrorBoundary>
          <VideoWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'audio':
      return (
        <WidgetErrorBoundary>
          <AudioWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'file':
    case 'files':
      return (
        <WidgetErrorBoundary>
          <FileWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    // Advanced chart/embed widgets
    case 'chart':
    case 'pie_chart':
    case 'line_chart':
      return (
        <WidgetErrorBoundary>
          <ChartWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'embed':
    case 'iframe':
      return (
        <WidgetErrorBoundary>
          <EmbedWidget data={renderData} />
        </WidgetErrorBoundary>
      );
    case 'html':
      return (
        <WidgetErrorBoundary>
          <HtmlWidgetComponent data={renderData} />
        </WidgetErrorBoundary>
      );
    // Fallback
    default:
      return (
        <WidgetErrorBoundary>
          <JsonWidget name={normalized || 'widget'} data={renderData} />
        </WidgetErrorBoundary>
      );
  }
}
