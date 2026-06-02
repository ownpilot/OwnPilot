/**
 * SidebarDataSection — generic accordion/flat renderer for registry-backed sections.
 *
 * In FLAT mode: single nav button (icon + label → navigates to section page).
 * In ACCORDION mode: collapsible header (chevron + label + plus) + item list from API.
 *
 * Driven by SidebarDataSectionDef from sidebar-sections registry.
 * Data fetching is lazy — only fires when visible AND in accordion mode.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from '../icons';
import type {
  SidebarDataSectionDef,
  SidebarItem,
  SidebarItemBadgeTone,
} from '../../constants/sidebar-sections';
import type { SidebarSectionConfig } from '../../types/layout-config';
import { SIDEBAR_SECTION_LABELS } from '../../types/layout-config';
import { useGateway } from '../../hooks/useWebSocket';

// Per-tone tailwind classes for the live state dot. Pulsing is reserved for
// the "active execution / needs intervention" tones so the eye is drawn to
// rows that actually warrant attention, not every running claw.
const BADGE_TONE_CLASS: Record<SidebarItemBadgeTone, string> = {
  running: 'bg-green-500',
  pending: 'bg-amber-500',
  escalation: 'bg-purple-500 animate-pulse',
  reflection: 'bg-purple-500 animate-pulse',
  stalled: 'bg-red-500 animate-pulse',
  failed: 'bg-amber-500',
  idle: 'bg-gray-400 dark:bg-gray-600',
};

/**
 * Sections whose live state should refresh on WS events while their
 * accordion is expanded. Each subscription is `{ topic, filter? }`; the
 * filter lets noisy generic topics like `data:changed` be narrowed to a
 * single entity type so we don't refetch on unrelated CRUD.
 */
interface LiveRefetchSub {
  topic: string;
  /** Optional predicate against the event payload — return false to skip refetch. */
  filter?: (data: unknown) => boolean;
}

const isEntityMatch =
  (entity: string) =>
  (data: unknown): boolean =>
    typeof data === 'object' && data !== null && (data as { entity?: string }).entity === entity;

const LIVE_REFETCH_TOPICS: Record<string, readonly LiveRefetchSub[]> = {
  claws: [
    { topic: 'claw:update' },
    { topic: 'claw:started' },
    { topic: 'claw:stopped' },
    { topic: 'claw:plan:updated' },
    { topic: 'claw:escalation' },
  ],
  workflows: [{ topic: 'data:changed', filter: isEntityMatch('workflow') }],
  triggers: [
    { topic: 'data:changed', filter: isEntityMatch('trigger') },
    { topic: 'trigger:executed' },
  ],
};

interface SidebarDataSectionProps {
  def: SidebarDataSectionDef;
  config: SidebarSectionConfig;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCloseCustomize: () => void;
}

export function SidebarDataSection({
  def,
  config,
  collapsed,
  onToggleCollapse,
  onCloseCustomize,
}: SidebarDataSectionProps) {
  const navigate = useNavigate();
  const label = SIDEBAR_SECTION_LABELS[config.id] ?? config.id;
  const Icon = def.icon;

  // Lazy data fetching — accordion mode, and either expanded OR a section
  // that has live state (so the header badge can summarize attention even
  // while collapsed). Flat-mode sections never fetch.
  const hasLiveState = LIVE_REFETCH_TOPICS[config.id] !== undefined;
  const shouldFetch = config.style !== 'flat' && (!collapsed || hasLiveState);
  const { items, isLoading, refetch } = useSidebarItems(def.fetchItems, shouldFetch);

  // Worst-tone attention summary for the collapsed header. Reflection /
  // stalled / escalation are the tones that warrant a pulsing red marker;
  // running shows a calm green dot when the section is collapsed so the
  // user sees "yes, something is alive in here" without expanding.
  const headerAttention = (() => {
    if (!collapsed) return null;
    if (items.length === 0) return null;
    const counts: Partial<Record<SidebarItemBadgeTone, number>> = {};
    for (const it of items) {
      const t = it.badge?.tone;
      if (t) counts[t] = (counts[t] ?? 0) + 1;
    }
    const priority: SidebarItemBadgeTone[] = [
      'escalation',
      'reflection',
      'stalled',
      'failed',
      'pending',
      'running',
    ];
    for (const tone of priority) {
      const n = counts[tone];
      if (n && n > 0) return { tone, count: n };
    }
    return null;
  })();

  // Live refetch on WS events for sections that have meaningful runtime
  // state (claws today). Only subscribes while the accordion is open so we
  // don't burn updates for collapsed sections.
  const { subscribe } = useGateway();
  useEffect(() => {
    if (!shouldFetch) return;
    const subs = LIVE_REFETCH_TOPICS[config.id];
    if (!subs || subs.length === 0) return;
    const unsubs = subs.map((sub) =>
      subscribe(sub.topic, (data) => {
        if (sub.filter && !sub.filter(data)) return;
        refetch();
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [shouldFetch, config.id, subscribe, refetch]);

  // --- Flat mode: single nav link ---
  if (config.style === 'flat') {
    return (
      <button
        onClick={() => {
          onCloseCustomize();
          navigate(def.route);
        }}
        data-testid={`sidebar-${config.id}`}
        className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate flex-1">{label}</span>
      </button>
    );
  }

  // --- Accordion mode: collapsible header + items ---
  return (
    <div className="mb-2" data-testid={`sidebar-${config.id}`}>
      <div className="flex items-center px-3 py-1 gap-1.5">
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        >
          <ChevronRight
            className={`w-[17px] h-[17px] shrink-0 transition-transform duration-150 ${!collapsed ? 'rotate-90' : ''}`}
          />
        </button>
        <button
          onClick={() => {
            onCloseCustomize();
            navigate(def.route);
          }}
          className="flex-1 text-left text-[15px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors flex items-center gap-1.5"
        >
          <span>{label}</span>
          {headerAttention && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                headerAttention.tone === 'escalation' ||
                headerAttention.tone === 'reflection' ||
                headerAttention.tone === 'stalled'
                  ? 'bg-red-500/15 text-red-500 animate-pulse'
                  : headerAttention.tone === 'failed' || headerAttention.tone === 'pending'
                    ? 'bg-amber-500/15 text-amber-500'
                    : 'bg-green-500/15 text-green-500'
              }`}
              title={`${headerAttention.count} ${headerAttention.tone}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${BADGE_TONE_CLASS[headerAttention.tone]}`}
              />
              {headerAttention.count}
            </span>
          )}
        </button>
        {def.showPlus && (
          <button
            onClick={() => {
              onCloseCustomize();
              navigate(def.route);
            }}
            className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
            aria-label={`New ${label}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      {!collapsed &&
        (isLoading ? (
          <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
            No {label.toLowerCase()}
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onCloseCustomize();
                  navigate(item.route);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                title={item.badge?.title ? `${item.label} \u2014 ${item.badge.title}` : item.label}
              >
                {item.badge ? (
                  // Live status dot replaces the section icon for items that
                  // carry runtime state. Pulsing tones (escalation/reflection
                  // /stalled) draw the eye to the rows that need a human.
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${BADGE_TONE_CLASS[item.badge.tone]}`}
                    aria-label={item.badge.title ?? item.badge.tone}
                  />
                ) : (
                  <Icon className="w-4 h-4 shrink-0 opacity-60" />
                )}
                <span className="truncate flex-1">
                  {item.label.length > 25 ? item.label.slice(0, 25) + '\u2026' : item.label}
                </span>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}

// --- Internal hook: lazy data fetching ---

function useSidebarItems(
  fetchFn: () => Promise<SidebarItem[]>,
  enabled: boolean
): { items: SidebarItem[]; isLoading: boolean; refetch: () => void } {
  const [items, setItems] = useState<SidebarItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Bump a tick to trigger a refetch. Avoids exposing the raw fetch promise
  // and keeps the cancellation logic centralized in the effect below.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setIsLoading(true);

    fetchFn()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch((err) => {
        // Sidebar items are non-critical — log and fall back to empty list
        // so the dev-tools warning is visible (R4 migration).
        console.warn('[ignored sidebar items fetch]', err);
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchFn, enabled, tick]);

  return { items, isLoading, refetch: () => setTick((t) => t + 1) };
}
