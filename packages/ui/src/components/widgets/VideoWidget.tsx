import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface VideoItem {
  src: string;
  poster?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  width?: number | string;
  height?: number | string;
  title?: string;
}

function isVideoItem(item: unknown): item is VideoItem {
  if (typeof item !== 'object' || item === null) return false;
  return typeof (item as Record<string, unknown>).src === 'string';
}

function VideoIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

export function VideoWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  if (isVideoItem(data)) {
    return (
      <WidgetShell title={title || data.title || 'Video'} icon={<VideoIcon />}>
        <VideoItemRenderer item={data} />
      </WidgetShell>
    );
  }

  // Multiple videos: data is { items: [...] } or [...]
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((record as { items?: unknown[] }).items)
      ? (record as { items: unknown[] }).items
      : [];

  const videoItems = items.filter(isVideoItem);

  if (videoItems.length === 0) {
    return (
      <WidgetShell title={title || 'Video'} icon={<VideoIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No valid videos found</p>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title={title || 'Videos'} icon={<VideoIcon />}>
      <div className="space-y-3">
        {videoItems.map((item, index) => (
          <VideoItemRenderer key={index} item={item} />
        ))}
      </div>
    </WidgetShell>
  );
}

function VideoItemRenderer({ item }: { item: VideoItem }) {
  const { src, poster, autoplay = false, loop = false, muted = true, controls = true, width, height } = item;

  return (
    <div className="rounded-md overflow-hidden border border-border dark:border-dark-border">
      <video
        src={src}
        poster={poster}
        autoPlay={autoplay}
        loop={loop}
        muted={muted}
        controls={controls}
        width={width}
        height={height}
        className="max-w-full"
      />
    </div>
  );
}