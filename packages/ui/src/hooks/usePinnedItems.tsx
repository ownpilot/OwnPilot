/**
 * usePinnedItems — maps pin/unpin actions to sidebar section add/remove.
 *
 * Since V7, individual nav items are sidebar sections (e.g. '/', '/dashboard').
 * "Pinning" an item = adding it as a section to LayoutConfig.
 * "Unpinning" = removing that section.
 *
 * This hook provides the same API that CustomizePage and CustomizeDetailPanel expect.
 * PinnedItemsProvider is a no-op pass-through.
 */
import type { ReactNode } from 'react';
import { useLayoutConfig } from './useLayoutConfig';
import { isNavItemSection } from '../constants/sidebar-sections';

// Re-export types for import path compatibility
export type { SidebarPinnedConfig } from '../types/layout-config';
export { MAX_PINNED_ITEMS } from '../types/layout-config';

/** No-op provider — pinned state lives in LayoutConfigProvider */
export function PinnedItemsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePinnedItems() {
  const { getSidebarSections, addSidebarSection, removeSidebarSection } = useLayoutConfig();

  const sections = getSidebarSections();
  // Nav item sections are the "pinned" items (paths starting with '/')
  const pinnedItems = sections.filter((s) => isNavItemSection(s.id)).map((s) => s.id);

  return {
    pinnedConfigs: sections.filter((s) => isNavItemSection(s.id)).map((s) => ({ type: 'item' as const, path: s.id })),
    pinnedItems,
    setPinnedItems: (updater: string[] | ((prev: string[]) => string[])) => {
      const current = pinnedItems;
      const next = typeof updater === 'function' ? updater(current) : updater;
      // Remove items no longer in list
      current.filter((p) => !next.includes(p)).forEach((p) => removeSidebarSection(p));
      // Add new items
      next.filter((p) => !current.includes(p)).forEach((p) => addSidebarSection(p));
    },
    setPinnedConfigs: () => { /* no-op — use addSidebarSection/removeSidebarSection */ },
    addGroup: (_id: string, _label: string, _items: string[]) => { /* groups deprecated in V7 */ },
    isGroupPinned: (_groupId: string) => false,
    toggleGroup: (_id: string, _label: string, _items: string[]) => { /* groups deprecated in V7 */ },
    MAX_PINNED_ITEMS: 15,
  };
}
