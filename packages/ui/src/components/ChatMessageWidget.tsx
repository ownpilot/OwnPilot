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

type WidgetTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

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

function WidgetShell({
  children,
  title,
  icon,
  tone = 'default',
}: {
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  tone?: WidgetTone;
}) {
  const classes = toneClasses(tone);
  return (
    <section className={`my-3 rounded-lg border ${classes.shell} overflow-hidden`}>
      {(title || icon) && (
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2 dark:border-dark-border/70">
          {icon && <span className={classes.icon}>{icon}</span>}
          {title && (
            <div className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              {title}
            </div>
          )}
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

function MetricGrid({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const title = asText(record.title);
  const itemsSource = Array.isArray(data) ? data : record.items;
  const items = asArray(itemsSource).filter(isRecord).slice(0, 8);

  if (items.length === 0) return <JsonWidget name="metric_grid" data={data} />;

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

  if (columns.length === 0 || rawRows.length === 0) return <JsonWidget name="table" data={data} />;

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

  if (items.length === 0) return <JsonWidget name={checklist ? 'checklist' : 'list'} data={data} />;

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
  const entries = asArray(entriesSource).filter(isRecord).slice(0, 24);

  if (entries.length === 0) return <JsonWidget name="key_value" data={data} />;

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
    .filter(isRecord)
    .slice(0, 9);

  if (items.length === 0) return <JsonWidget name="cards" data={data} />;

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

  if (steps.length === 0) return <JsonWidget name="steps" data={data} />;

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

  if (bars.length === 0) return <JsonWidget name="bar_chart" data={data} />;

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

  if (items.length === 0) return <JsonWidget name="timeline" data={data} />;

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
    return (
      <WidgetShell
        title="Widget could not be rendered"
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="warning"
      >
        <div className="text-sm leading-6 text-text-secondary dark:text-dark-text-secondary">
          The data for this widget was incomplete or malformed, so it was hidden from the chat.
        </div>
      </WidgetShell>
    );
  }

  const visibleData = isRecord(data) && 'raw' in data ? { ...data, raw: '[hidden]' } : data;

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

  if (isRecord(data) && data.error === 'Invalid widget data') {
    return <JsonWidget name={normalized || 'widget'} data={data} />;
  }

  switch (normalized) {
    case 'metric':
    case 'metrics':
    case 'metric_grid':
    case 'stats':
      return <MetricGrid data={data} />;
    case 'table':
      return <TableWidget data={data} />;
    case 'list':
      return <ListWidget data={data} />;
    case 'checklist':
      return <ListWidget data={data} checklist />;
    case 'key_value':
    case 'key_values':
    case 'facts':
    case 'details':
    case 'properties':
      return <KeyValueWidget data={data} />;
    case 'card':
    case 'cards':
    case 'card_grid':
      return <CardsWidget data={data} />;
    case 'step':
    case 'steps':
    case 'plan':
      return <StepsWidget data={data} />;
    case 'callout':
    case 'note':
      return <CalloutWidget data={data} />;
    case 'progress':
      return <ProgressWidget data={data} />;
    case 'bar':
    case 'bar_chart':
      return <BarChartWidget data={data} />;
    case 'timeline':
      return <TimelineWidget data={data} />;
    default:
      return <JsonWidget name={normalized || 'widget'} data={data} />;
  }
}
