import { useState } from 'react';
import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface ImageItem {
  src: string;
  alt?: string;
  title?: string;
  caption?: string;
  width?: number | string;
  height?: number | string;
  lazy?: boolean;
}

function isImageItem(item: unknown): item is ImageItem {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;
  return typeof record.src === 'string';
}

export function ImageWidget({ data, title: titleProp }: Props) {
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, boolean>>({});

  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  // Single image: data is { src, alt?, title? } or just a string
  if (typeof data === 'string') {
    return <ImageItemRenderer src={data} index={0} onLoad={() => setLoaded(l => ({ ...l, 0: true }))} onError={() => setErrors(e => ({ ...e, 0: true }))} loaded={!!loaded[0]} error={!!errors[0]} />;
  }

  if (isImageItem(data)) {
    return (
      <WidgetShell title={title || data.title} icon={<ImageIcon />}>
        <ImageItemRenderer {...data} index={0} onLoad={() => setLoaded(l => ({ ...l, 0: true }))} onError={() => setErrors(e => ({ ...e, 0: true }))} loaded={!!loaded[0]} error={!!errors[0]} />
      </WidgetShell>
    );
  }

  // Multiple images: data is { items: [...] } or [...]
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((record as { items?: unknown[] }).items)
      ? (record as { items: unknown[] }).items
      : [];

  const imageItems = items.filter(isImageItem);

  if (imageItems.length === 0) {
    return (
      <WidgetShell title={title || 'Image'} icon={<ImageIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No valid images found</p>
      </WidgetShell>
    );
  }

  const columns = Math.min(4, Math.max(1, imageItems.length));

  return (
    <WidgetShell title={title || 'Images'} icon={<ImageIcon />}>
      <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {imageItems.map((item, index) => (
          <ImageItemRenderer
            key={index}
            {...item}
            index={index}
            onLoad={() => setLoaded(l => ({ ...l, [index]: true }))}
            onError={() => setErrors(e => ({ ...e, [index]: true }))}
            loaded={!!loaded[index]}
            error={!!errors[index]}
          />
        ))}
      </div>
    </WidgetShell>
  );
}

interface ImageItemProps extends ImageItem {
  index: number;
  onLoad: () => void;
  onError: () => void;
  loaded: boolean;
  error: boolean;
}

function ImageItemRenderer({ src, alt, caption, width, height, lazy = true, index, onLoad, onError, loaded, error }: ImageItemProps) {
  const [show, setShow] = useState(!lazy);

  return (
    <figure className="space-y-1">
      <div className="relative overflow-hidden rounded-md border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        {!show && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
        {error ? (
          <div className="flex h-32 items-center justify-center text-text-muted">
            <ImageIcon className="h-8 w-8" />
            <span className="ml-2 text-sm">Failed to load</span>
          </div>
        ) : (
          <img
            src={src}
            alt={alt || `Image ${index + 1}`}
            width={width}
            height={height}
            loading={lazy ? 'lazy' : undefined}
            onLoad={() => { setShow(true); onLoad(); }}
            onError={onError}
            className={`max-w-full transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
          />
        )}
      </div>
      {caption && (
        <figcaption className="text-xs text-text-muted text-center">{caption}</figcaption>
      )}
    </figure>
  );
}

function ImageIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}