/**
 * Layout configuration types.
 *
 * Controls visual presentation of header zones, sidebar, and general layout.
 * Persisted in localStorage via useLayoutConfig hook.
 * Version field enables forward-compatible migrations.
 *
 * Header has 5 zones:
 *   [Brand] | [Zone Left] [Zone Center] [Zone Right] | [Settings icon]
 * Brand and Settings are fixed. The 3 middle zones are user-configurable.
 */

export const LAYOUT_CONFIG_VERSION = 4;

/** How pinned header items render */
export type HeaderItemDisplayMode = 'icon' | 'icon-text' | 'text';

/** Identifies one of the 3 configurable header zones */
export type HeaderZoneId = 'left' | 'center' | 'right';

/** A single entry in a header zone — references useHeaderItems config by index or directly */
export type HeaderZoneEntry =
  | { type: 'item'; path: string }
  | { type: 'group'; id: string; label: string; items: string[] }
  | { type: 'widget'; widgetId: string };  // Future: pulse-slots, pomodoro, ws-status

export interface HeaderZoneConfig {
  entries: HeaderZoneEntry[];
  displayMode: HeaderItemDisplayMode;
}

export interface LayoutConfigHeader {
  /** Global fallback display mode (used when zone doesn't override) */
  itemDisplayMode: HeaderItemDisplayMode;
  /** Per-zone configuration */
  zones: Record<HeaderZoneId, HeaderZoneConfig>;
}

/** Sidebar width preset — affects the aside element width class */
export type SidebarWidth = 'narrow' | 'default' | 'wide';

/** Built-in sidebar section identifiers */
export type SidebarSectionId =
  | 'pinned'
  | 'search'
  | 'scheduled'
  | 'customize'
  | 'workspaces'
  | 'workflows'
  | 'recents'
  | 'footer';

export interface SidebarSectionConfig {
  id: SidebarSectionId | string;  // built-in or custom section id
  visible: boolean;
  order: number;
}

/** All 8 default sidebar sections in their default order */
export const DEFAULT_SIDEBAR_SECTIONS: SidebarSectionConfig[] = [
  { id: 'pinned', visible: true, order: 0 },
  { id: 'search', visible: true, order: 1 },
  { id: 'scheduled', visible: true, order: 2 },
  { id: 'customize', visible: true, order: 3 },
  { id: 'workspaces', visible: true, order: 4 },
  { id: 'workflows', visible: true, order: 5 },
  { id: 'recents', visible: true, order: 6 },
  { id: 'footer', visible: true, order: 7 },
];

export interface LayoutConfigSidebar {
  width: SidebarWidth;
  sections: SidebarSectionConfig[];
}

/** User-defined custom group — global, reusable across zones and sidebar */
export interface CustomGroup {
  id: string;        // custom-{timestamp}
  label: string;     // user-defined name
  items: string[];   // route paths
}

export interface LayoutConfig {
  version: number;
  header: LayoutConfigHeader;
  sidebar: LayoutConfigSidebar;
  /** Global custom groups — can be added to any header zone or sidebar */
  customGroups: CustomGroup[];
}

const EMPTY_ZONE: HeaderZoneConfig = { entries: [], displayMode: 'icon' };

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  version: LAYOUT_CONFIG_VERSION,
  header: {
    itemDisplayMode: 'icon',
    zones: {
      left: { ...EMPTY_ZONE },
      center: { ...EMPTY_ZONE },
      right: { ...EMPTY_ZONE },
    },
  },
  sidebar: {
    width: 'default',
    sections: [...DEFAULT_SIDEBAR_SECTIONS],
  },
  customGroups: [],
};
