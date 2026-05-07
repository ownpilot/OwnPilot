import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface AudioItem {
  src: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  title?: string;
}

function isAudioItem(item: unknown): item is AudioItem {
  if (typeof item !== 'object' || item === null) return false;
  return typeof (item as Record<string, unknown>).src === 'string';
}

function AudioIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
  );
}

export function AudioWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  if (isAudioItem(data)) {
    return (
      <WidgetShell title={title || data.title || 'Audio'} icon={<AudioIcon />}>
        <AudioItemRenderer item={data} />
      </WidgetShell>
    );
  }

  // Multiple audio: data is { items: [...] } or [...]
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((record as { items?: unknown[] }).items)
      ? (record as { items: unknown[] }).items
      : [];

  const audioItems = items.filter(isAudioItem);

  if (audioItems.length === 0) {
    return (
      <WidgetShell title={title || 'Audio'} icon={<AudioIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No valid audio files found</p>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title={title || 'Audio Files'} icon={<AudioIcon />}>
      <div className="space-y-3">
        {audioItems.map((item, index) => (
          <AudioItemRenderer key={index} item={item} />
        ))}
      </div>
    </WidgetShell>
  );
}

function AudioItemRenderer({ item }: { item: AudioItem }) {
  const { src, autoplay = false, loop = false, controls = true, title } = item;

  return (
    <div className="rounded-md border border-border bg-bg-secondary/70 p-3 dark:border-dark-border dark:bg-dark-bg-secondary/70">
      {title && (
        <div className="mb-2 text-sm font-medium text-text-primary dark:text-dark-text-primary">
          {title}
        </div>
      )}
      <audio
        src={src}
        autoPlay={autoplay}
        loop={loop}
        controls={controls}
        className="w-full"
      />
    </div>
  );
}