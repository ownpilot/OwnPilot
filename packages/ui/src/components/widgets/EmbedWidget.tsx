import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';
import { safeEmbedSrc } from './media-url';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface EmbedItem {
  src: string;
  title?: string;
  width?: number | string;
  height?: number | string;
  /** @deprecated The `sandbox` flag is ignored; embeds are always sandboxed. */
  sandbox?: boolean;
}

function isEmbedItem(item: unknown): item is EmbedItem {
  if (typeof item !== 'object' || item === null) return false;
  return typeof (item as Record<string, unknown>).src === 'string';
}

function EmbedIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

export function EmbedWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp;

  if (isEmbedItem(data)) {
    return (
      <WidgetShell title={title || data.title || 'Embed'} icon={<EmbedIcon />}>
        <EmbedItemRenderer item={data} />
      </WidgetShell>
    );
  }

  // Multiple embeds: data is { items: [...] } or [...]
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((record as { items?: unknown[] }).items)
      ? (record as { items: unknown[] }).items
      : [];

  const embedItems = items.filter(isEmbedItem);

  if (embedItems.length === 0) {
    return (
      <WidgetShell title={title || 'Embed'} icon={<EmbedIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No valid embeds found</p>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title={title || 'Embeds'} icon={<EmbedIcon />}>
      <div className="space-y-3">
        {embedItems.map((item, index) => (
          <EmbedItemRenderer key={index} item={item} />
        ))}
      </div>
    </WidgetShell>
  );
}

function EmbedItemRenderer({ item }: { item: EmbedItem }) {
  // `sandbox` is intentionally ignored. The widget JSON used to honor a
  // `sandbox: false` flag, which removed the iframe sandbox attribute
  // entirely and let an LLM-emitted `<widget name="embed" data='{"src":
  // "https://attacker.tld","sandbox":false}'>` render fully unsandboxed
  // (top-level navigation, popups, storage, form submission) — full
  // RCE-in-page via top-level nav hijack. Always sandbox.
  const { src, title, width = '100%', height = 400 } = item;
  const safeSrc = safeEmbedSrc(src);
  if (!safeSrc) {
    return (
      <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
        Blocked embed URL
      </div>
    );
  }

  // Note: sandbox attribute intentionally does NOT include allow-same-origin.
  // allow-same-origin + allow-scripts together effectively disable the sandbox,
  // allowing the framed page full origin access. We allow only scripts and forms.
  return (
    <div className="rounded-md overflow-hidden border border-border dark:border-dark-border">
      {title && (
        <div className="bg-bg-tertiary px-3 py-1.5 dark:bg-dark-bg-tertiary">
          <span className="text-xs font-medium text-text-muted">{title}</span>
        </div>
      )}
      <iframe
        src={safeSrc}
        title={title || 'Embedded content'}
        width={width}
        height={height}
        sandbox="allow-scripts allow-forms"
        className="border-0 w-full"
        loading="lazy"
      />
    </div>
  );
}
