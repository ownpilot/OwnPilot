import { useState, useMemo } from 'react';
import { Pin, Search, LayoutDashboard, Info } from '../components/icons';
import { navGroups, mainItems, bottomItems } from '../constants/nav-items';
import type { NavGroup } from '../constants/nav-items';
import { NAV_DESCRIPTIONS } from '../constants/nav-descriptions';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useToast } from '../components/ToastProvider';

/**
 * Build display sections: synthetic "Main" group + 6 navGroups + synthetic "Other" group.
 */
const DISPLAY_SECTIONS: NavGroup[] = [
  {
    id: 'main',
    label: 'Main',
    icon: LayoutDashboard,
    items: mainItems,
  },
  ...navGroups,
  {
    id: 'other',
    label: 'Other',
    icon: Info,
    items: bottomItems,
  },
];

export function CustomizePage() {
  const { pinnedItems, setPinnedItems, MAX_PINNED_ITEMS } = usePinnedItems();
  const toast = useToast();
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return DISPLAY_SECTIONS;
    return DISPLAY_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.label.toLowerCase().includes(normalizedQuery) ||
        (NAV_DESCRIPTIONS[item.to] ?? '').toLowerCase().includes(normalizedQuery),
      ),
    })).filter((section) => section.items.length > 0);
  }, [normalizedQuery]);

  const handleTogglePin = (path: string) => {
    const isPinned = pinnedItems.includes(path);
    if (!isPinned && pinnedItems.length >= MAX_PINNED_ITEMS) {
      toast.warning(`Pin limit reached \u2014 max ${MAX_PINNED_ITEMS} items`);
      return;
    }
    setPinnedItems((prev) =>
      isPinned ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  const userPinnedCount = pinnedItems.length;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Customize Sidebar
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Pin pages to your sidebar for quick access
          </p>
        </div>
        {/* Pin counter */}
        <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
          <Pin className="w-4 h-4" />
          <span data-testid="pin-counter">
            <span
              className={
                userPinnedCount >= MAX_PINNED_ITEMS
                  ? 'text-error font-semibold'
                  : 'text-text-primary dark:text-dark-text-primary font-semibold'
              }
            >
              {userPinnedCount}
            </span>
            {' / '}
            {MAX_PINNED_ITEMS} slots used
          </span>
        </div>
      </header>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          <input
            type="text"
            placeholder="Search pages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="customize-search"
            className="w-full pl-9 pr-4 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder-text-muted dark:placeholder-dark-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
          />
        </div>
      </div>

      {/* Grid content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8" data-testid="customize-grid">
        {filteredSections.length === 0 ? (
          <div className="text-center py-12 text-text-muted dark:text-dark-text-muted text-sm">
            No pages match &ldquo;{query}&rdquo;
          </div>
        ) : (
          filteredSections.map((section) => (
            <section key={section.id} data-testid={`customize-group-${section.id}`}>
              {/* Group header */}
              <div className="flex items-center gap-2 mb-3">
                <section.icon className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
                <h3 className="text-xs font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                  {section.label}
                </h3>
                {section.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
                    {section.badge}
                  </span>
                )}
              </div>

              {/* Items grid: 1 col mobile, 2 col tablet, 3-4 col desktop */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {section.items.map((item) => {
                  const isPinned = pinnedItems.includes(item.to);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.to}
                      data-testid={`customize-card-${item.to.replace(/\//g, '-').replace(/^-/, '')}`}
                      onClick={() => handleTogglePin(item.to)}
                      className={`group relative flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                        isPinned
                          ? 'bg-primary/10 border-primary shadow-sm'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border hover:border-primary/50 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                      }`}
                      aria-pressed={isPinned}
                      aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${item.label}`}
                    >
                      {/* Icon */}
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isPinned
                            ? 'bg-primary/20'
                            : 'bg-bg-secondary dark:bg-dark-bg-secondary'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 ${
                            isPinned
                              ? 'text-primary'
                              : 'text-text-secondary dark:text-dark-text-secondary'
                          }`}
                        />
                      </div>

                      {/* Label + description */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isPinned
                              ? 'text-primary'
                              : 'text-text-primary dark:text-dark-text-primary'
                          }`}
                        >
                          {item.label}
                        </p>
                        <p className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-2 mt-0.5">
                          {NAV_DESCRIPTIONS[item.to] ?? ''}
                        </p>
                      </div>

                      {/* Pin indicator -- top-right corner */}
                      <div
                        className={`absolute top-3 right-3 transition-opacity ${
                          isPinned
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-60'
                        }`}
                      >
                        <Pin
                          className={`w-3.5 h-3.5 ${
                            isPinned
                              ? 'text-primary'
                              : 'text-text-muted dark:text-dark-text-muted'
                          }`}
                          style={isPinned ? { fill: 'currentColor' } : undefined}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
