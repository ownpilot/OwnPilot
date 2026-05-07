import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface FileItem {
  name: string;
  size?: number;
  type?: string;
  url?: string;
  icon?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function isFileItem(item: unknown): item is FileItem {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;
  return typeof record.name === 'string';
}

function FileIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

export function FileWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  // Single file: data is { name, size?, type?, url? } or just { name }
  if (isFileItem(data)) {
    return (
      <WidgetShell title={title || 'File'} icon={<FileIcon />}>
        <FileItemRenderer item={data} />
      </WidgetShell>
    );
  }

  // Multiple files: data is { items: [...] } or [...]
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((record as { items?: unknown[] }).items)
      ? (record as { items: unknown[] }).items
      : [];

  const fileItems = items.filter(isFileItem);

  if (fileItems.length === 0) {
    return (
      <WidgetShell title={title || 'Files'} icon={<FileIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No valid files found</p>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title={title || 'Files'} icon={<FileIcon />}>
      <div className="space-y-2">
        {fileItems.map((item, index) => (
          <FileItemRenderer key={index} item={item} />
        ))}
      </div>
    </WidgetShell>
  );
}

function FileItemRenderer({ item }: { item: FileItem }) {
  const { name, size, type, url } = item;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-bg-secondary/70 p-3 dark:border-dark-border dark:bg-dark-bg-secondary/70">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileIcon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium text-text-primary dark:text-dark-text-primary">
          {name}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          {type && <span className="truncate">{type}</span>}
          {type && size && <span>•</span>}
          {size && <span>{formatBytes(size)}</span>}
        </div>
      </div>
      {url && (
        <a
          href={url}
          download={name}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20"
          onClick={e => e.stopPropagation()}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>
      )}
    </div>
  );
}