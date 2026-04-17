/**
 * usePinnedItems — maps pin/unpin actions to sidebar section add/remove.
 *
 * Since V7, individual nav items are sidebar sections (e.g. '/', '/dashboard').
 * "Pinning" an item = adding it as a section to LayoutConfig.
 * "Unpinning" = removing that section.
 *
 * If a nav item's path matches a data section route (e.g. '/workflows' → 'workflows'),
 * the data section ID is used instead to avoid duplicates.
 *
 * PinnedItemsProvider is a no-op pass-through.
 */
import type { ReactNode } from 'react';
import { useLayoutConfig } from './useLayoutConfig';
import { SIDEBAR_DATA_SECTIONS, isNavItemSection } from '../constants/sidebar-sections';

// Re-export types for import path compatibility
export type { SidebarPinnedConfig } from '../types/layout-config';
export { MAX_PINNED_ITEMS } from '../types/layout-config';

/** Map nav item path → data section ID if the route matches (e.g. '/workflows' → 'workflows') */
const ROUTE_TO_DATA_SECTION = new Map<string, string>(
  Object.entries(SIDEBAR_DATA_SECTIONS).map(([id, def]) => [def.route, id])
);

/** Resolve a nav item path to the correct section ID (data section if exists, path otherwise) */
function resolveToSectionId(path: string): string {
  return ROUTE_TO_DATA_SECTION.get(path) ?? path;
}

/** No-op provider — pinned state lives in LayoutConfigProvider */
export function PinnedItemsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePinnedItems() {
  const { getSidebarSections, addSidebarSection, removeSidebarSection } = useLayoutConfig();

  const sections = getSidebarSections();
  // "Pinned" items = nav item path sections + data sections that were added via pin
  const pinnedItems = sections
    .filter((s) => isNavItemSection(s.id) || ROUTE_TO_DATA_SECTION.has('/' + s.id) || ROUTE_TO_DATA_SECTION.has(s.id))
    .map((s) => isNavItemSection(s.id) ? s.id : SIDEBAR_DATA_SECTIONS[s.id]?.route ?? s.id);

  return {
    pinnedConfigs: pinnedItems.map((path) => ({ type: 'item' as const, path })),
    pinnedItems,
    setPinnedItems: (updater: string[] | ((prev: string[]) => string[])) => {
      const current = pinnedItems;
      const next = typeof updater === 'function' ? updater(current) : updater;
      // Remove items no longer in list
      current.filter((p) => !next.includes(p)).forEach((p) => removeSidebarSection(resolveToSectionId(p)));
      // Add new items — resolve to data section ID if possible
      next.filter((p) => !current.includes(p)).forEach((p) => addSidebarSection(resolveToSectionId(p)));
    },
    setPinnedConfigs: () => { /* no-op */ },
    addGroup: (_id: string, _label: string, _items: string[]) => { /* groups deprecated */ },
    isGroupPinned: (_groupId: string) => false,
    toggleGroup: (_id: string, _label: string, _items: string[]) => { /* groups deprecated */ },
    MAX_PINNED_ITEMS: 15,
  };
}
