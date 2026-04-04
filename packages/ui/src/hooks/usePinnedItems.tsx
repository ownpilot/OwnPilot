/**
 * usePinnedItems — thin wrapper over useLayoutConfig for pinned sidebar items.
 *
 * Pinned items are now stored in LayoutConfig.sidebar.pinnedItems (since V7).
 * This wrapper preserves the existing API so consumers (Sidebar, CustomizePage,
 * CustomizeDetailPanel) don't need changes.
 *
 * PinnedItemsProvider is a no-op pass-through — kept for Layout.tsx compat.
 */
import type { ReactNode } from 'react';
import { useLayoutConfig } from './useLayoutConfig';

// Re-export types from layout-config for import path compatibility
export type { SidebarPinnedConfig } from '../types/layout-config';
export { MAX_PINNED_ITEMS } from '../types/layout-config';

/** No-op provider — pinned state now lives in LayoutConfigProvider */
export function PinnedItemsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePinnedItems() {
  const lc = useLayoutConfig();
  return {
    pinnedConfigs: lc.getPinnedConfigs(),
    pinnedItems: lc.getPinnedItemPaths(),
    setPinnedItems: lc.setPinnedItemPaths,
    setPinnedConfigs: lc.setPinnedConfigs,
    addGroup: lc.addPinnedGroup,
    isGroupPinned: lc.isPinnedGroup,
    toggleGroup: lc.togglePinnedGroup,
    MAX_PINNED_ITEMS: 15,
  };
}
