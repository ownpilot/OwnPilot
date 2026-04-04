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

/** Built-in sidebar section identifiers (footer is structural, not configurable) */
export type SidebarSectionId =
  | 'pinned'
  | 'search'
  | 'scheduled'
  | 'customize'
  | 'workspaces'
  | 'workflows'
  | 'recents';

/**
 * ID for a sidebar section — built-in IDs are typed as SidebarSectionId,
 * custom section IDs follow the `custom-{timestamp}` pattern.
 * Kept as string (not branded) because JSON serialization loses brand info.
 */
export type SidebarSectionIdOrCustom = SidebarSectionId | (string & {});

/** How a data section header renders in the sidebar */
export type SidebarSectionStyle = 'accordion' | 'flat';

export interface SidebarSectionConfig {
  id: SidebarSectionIdOrCustom;
  visible: boolean;
  order: number;
  /** Display style — 'accordion' shows items with collapse, 'flat' shows as single nav link */
  style?: SidebarSectionStyle;
}

/** All 7 configurable sidebar sections in their default order (footer is structural, always rendered) */
export const DEFAULT_SIDEBAR_SECTIONS: SidebarSectionConfig[] = [
  { id: 'pinned', visible: true, order: 0 },
  { id: 'search', visible: true, order: 1 },
  { id: 'scheduled', visible: true, order: 2 },
  { id: 'customize', visible: true, order: 3 },
  { id: 'workspaces', visible: true, order: 4 },
  { id: 'workflows', visible: true, order: 5 },
  { id: 'recents', visible: true, order: 6 },
];

/** Human-readable labels for sidebar sections */
export const SIDEBAR_SECTION_LABELS: Record<string, string> = {
  pinned: 'Pinned Items',
  search: 'Search',
  scheduled: 'Scheduled',
  customize: 'Customize',
  workspaces: 'Workspaces',
  workflows: 'Workflows',
  recents: 'Recent Chats',
};

/** Sidebar width presets — narrow is still text-visible, not icon-only */
export const SIDEBAR_WIDTH_VALUES: Record<SidebarWidth, { class: string; label: string; px: number }> = {
  narrow: { class: 'w-48', label: 'Compact', px: 192 },
  default: { class: 'w-60', label: 'Default', px: 240 },
  wide: { class: 'w-72', label: 'Wide', px: 288 },
};

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
