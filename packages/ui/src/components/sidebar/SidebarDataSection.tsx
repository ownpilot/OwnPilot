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
import type { SidebarDataSectionDef, SidebarItem } from '../../constants/sidebar-sections';
import type { SidebarSectionConfig } from '../../types/layout-config';
import { SIDEBAR_SECTION_LABELS } from '../../types/layout-config';

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

  // Lazy data fetching — only when accordion mode and expanded
  const shouldFetch = config.style !== 'flat' && !collapsed;
  const { items, isLoading } = useSidebarItems(def.fetchItems, shouldFetch);

  // --- Flat mode: single nav link ---
  if (config.style === 'flat') {
    return (
      <button
        onClick={() => { onCloseCustomize(); navigate(def.route); }}
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
          <ChevronRight className={`w-[17px] h-[17px] shrink-0 transition-transform duration-150 ${!collapsed ? 'rotate-90' : ''}`} />
        </button>
        <button
          onClick={() => { onCloseCustomize(); navigate(def.route); }}
          className="flex-1 text-left text-[15px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
        >
          {label}
        </button>
        {def.showPlus && (
          <button
            onClick={() => { onCloseCustomize(); navigate(def.route); }}
            className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
            aria-label={`New ${label}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      {!collapsed && (
        isLoading ? (
          <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">Loading...</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">No {label.toLowerCase()}</div>
        ) : (
          <div className="space-y-0.5">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => { onCloseCustomize(); navigate(item.route); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                title={item.label}
              >
                <Icon className="w-4 h-4 shrink-0 opacity-60" />
                <span className="truncate flex-1">
                  {item.label.length > 25 ? item.label.slice(0, 25) + '\u2026' : item.label}
                </span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// --- Internal hook: lazy data fetching ---

function useSidebarItems(
  fetchFn: () => Promise<SidebarItem[]>,
  enabled: boolean,
): { items: SidebarItem[]; isLoading: boolean } {
  const [items, setItems] = useState<SidebarItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setIsLoading(true);

    fetchFn()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        // Silently fail — sidebar items are non-critical
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [fetchFn, enabled]);

  return { items, isLoading };
}
