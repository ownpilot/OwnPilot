import { useState, useMemo } from 'react';
import {
  Pin,
  Search,
  LayoutDashboard,
  Info,
  ChevronRight,
  FolderOpen,
} from '../components/icons';
import { navGroups, mainItems, bottomItems } from '../constants/nav-items';
import type { NavGroup } from '../constants/nav-items';
import { NAV_DESCRIPTIONS } from '../constants/nav-descriptions';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useGroupCollapseState } from '../hooks/useGroupCollapseState';
import { useToast } from '../components/ToastProvider';

type TabId = 'items' | 'local-files';

/**
 * Build display sections: synthetic "Main" + navGroups + synthetic "Other".
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
  const { isOpen, toggle } = useGroupCollapseState();
  const [activeTab, setActiveTab] = useState<TabId>('items');
  const [query, setQuery] = useState('');
  // TODO(phase-7): selectedItem drives right-side detail panel
  const [_selectedItem, setSelectedItem] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return DISPLAY_SECTIONS;
    return DISPLAY_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.label.toLowerCase().includes(normalizedQuery) ||
          (NAV_DESCRIPTIONS[item.to] ?? '').toLowerCase().includes(normalizedQuery),
      ),
    })).filter((section) => section.items.length > 0);
  }, [normalizedQuery]);

  const handleTogglePin = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const isPinned = pinnedItems.includes(path);
    if (!isPinned && pinnedItems.length >= MAX_PINNED_ITEMS) {
      toast.warning(`Pin limit reached \u2014 max ${MAX_PINNED_ITEMS} items`);
      return;
    }
    setPinnedItems((prev) =>
      isPinned ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border shrink-0">
        <button
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'items'
              ? 'text-primary border-primary'
              : 'text-text-muted dark:text-dark-text-muted border-transparent hover:text-text-secondary dark:hover:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
          }`}
          onClick={() => setActiveTab('items')}
          data-testid="customize-tab-items"
        >
          <LayoutDashboard className="w-4 h-4" />
          Items
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'local-files'
              ? 'text-primary border-primary'
              : 'text-text-muted dark:text-dark-text-muted border-transparent hover:text-text-secondary dark:hover:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
          }`}
          onClick={() => setActiveTab('local-files')}
          data-testid="customize-tab-local-files"
        >
          <FolderOpen className="w-4 h-4" />
          Local Files
        </button>
      </div>

      {/* Items tab */}
      {activeTab === 'items' && (
        <>
          {/* Search bar */}
          <div className="px-3 py-2 border-b border-border dark:border-dark-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
              <input
                type="text"
                placeholder="Search pages..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="customize-search"
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary placeholder-text-muted dark:placeholder-dark-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
              />
            </div>
          </div>

          {/* Group list */}
          <div className="flex-1 overflow-y-auto py-1" data-testid="customize-items-list">
            {filteredSections.length === 0 ? (
              <div className="text-center py-12 text-text-muted dark:text-dark-text-muted text-sm">
                No pages match &ldquo;{query}&rdquo;
              </div>
            ) : (
              filteredSections.map((section) => {
                const groupOpen = isOpen(section.id);
                const SectionIcon = section.icon;
                return (
                  <div key={section.id} data-testid={`customize-group-${section.id}`}>
                    {/* Group header — drawer toggle */}
                    <button
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary dark:hover:text-dark-text-secondary"
                      onClick={() => toggle(section.id)}
                      data-testid={`customize-group-toggle-${section.id}`}
                    >
                      <ChevronRight
                        className={`w-3 h-3 transition-transform duration-150 ${
                          groupOpen ? 'rotate-90' : ''
                        }`}
                      />
                      <SectionIcon className="w-3 h-3 opacity-50" />
                      <span className="flex-1 text-left">{section.label}</span>
                      {section.badge && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded normal-case tracking-normal">
                          {section.badge}
                        </span>
                      )}
                      <span className="text-[11px] font-normal normal-case tracking-normal">
                        {section.items.length}
                      </span>
                    </button>

                    {/* Collapsible item list */}
                    {groupOpen &&
                      section.items.map((item) => {
                        const isPinned = pinnedItems.includes(item.to);
                        const Icon = item.icon;
                        return (
                          <div
                            key={item.to}
                            className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                            onClick={() => setSelectedItem(item.to)}
                            data-testid={`customize-item-${item.to.replace(/\//g, '-').replace(/^-/, '')}`}
                          >
                            <Icon className="w-3.5 h-3.5 text-text-secondary dark:text-dark-text-secondary shrink-0" />
                            <span className="flex-1 text-base text-text-primary dark:text-dark-text-primary truncate">
                              {item.label}
                            </span>
                            <button
                              className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border transition-all ${
                                isPinned
                                  ? 'opacity-100 text-primary bg-primary/10 border-primary/30'
                                  : 'opacity-0 group-hover:opacity-50 hover:!opacity-100 text-text-muted dark:text-dark-text-muted border-transparent hover:border-primary hover:text-primary hover:bg-primary/10'
                              }`}
                              onClick={(e) => handleTogglePin(e, item.to)}
                              title={isPinned ? 'Unpin' : 'Pin'}
                              aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${item.label}`}
                              data-testid={`customize-pin-${item.to.replace(/\//g, '-').replace(/^-/, '')}`}
                            >
                              <Pin
                                className="w-3 h-3"
                                style={isPinned ? { fill: 'currentColor' } : undefined}
                              />
                            </button>
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Local Files tab */}
      {activeTab === 'local-files' && (
        <div className="flex-1 flex items-center justify-center" data-testid="customize-local-files">
          <div className="text-center text-text-muted dark:text-dark-text-muted">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">Local file browsing coming soon</p>
            <p className="text-xs mt-1 opacity-70">Browse and pin files from your workspace</p>
          </div>
        </div>
      )}

      {/* Pin counter footer */}
      <div
        className="px-3 py-2 border-t border-border dark:border-dark-border text-center text-xs text-text-muted dark:text-dark-text-muted shrink-0"
        data-testid="customize-pin-footer"
      >
        <Pin className="w-3 h-3 inline-block mr-1 -mt-0.5" />
        <span
          className={
            pinnedItems.length >= MAX_PINNED_ITEMS
              ? 'text-error font-semibold'
              : 'font-semibold'
          }
        >
          {pinnedItems.length}
        </span>
        {' / '}
        {MAX_PINNED_ITEMS} pinned
      </div>
    </div>
  );
}
