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

export const LAYOUT_CONFIG_VERSION = 5;

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
  // Core (always-visible UI controls)
  | 'pinned'
  | 'search'
  | 'scheduled'
  | 'customize'
  // Data (API-backed list sections with accordion/flat toggle)
  | 'workspaces'
  | 'workflows'
  | 'recents'
  // AI & Automation
  | 'agents'
  | 'claws'
  | 'triggers'
  | 'fleet'
  | 'artifacts'
  // Tools & Extensions
  | 'tools'
  | 'custom-tools'
  | 'extensions'
  // Personal Data
  | 'tasks'
  | 'notes'
  | 'goals'
  | 'plans'
  | 'memories'
  | 'bookmarks'
  | 'contacts'
  | 'habits'
  // System
  | 'channels'
  | 'edge-devices'
  | 'mcp-servers'
  | 'ai-models'
  | 'coding-agents';

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

/** All 28 configurable sidebar sections (footer is structural, always rendered) */
export const DEFAULT_SIDEBAR_SECTIONS: SidebarSectionConfig[] = [
  // Core (visible by default)
  { id: 'pinned', visible: true, order: 0 },
  { id: 'search', visible: true, order: 1 },
  { id: 'scheduled', visible: true, order: 2 },
  { id: 'customize', visible: true, order: 3 },
  // Data (visible by default)
  { id: 'workspaces', visible: true, order: 4 },
  { id: 'workflows', visible: true, order: 5 },
  { id: 'recents', visible: true, order: 6 },
  // AI & Automation (hidden, accordion-ready when enabled)
  { id: 'agents', visible: false, order: 7, style: 'accordion' },
  { id: 'claws', visible: false, order: 8, style: 'accordion' },
  { id: 'triggers', visible: false, order: 9, style: 'flat' },
  { id: 'fleet', visible: false, order: 10, style: 'flat' },
  { id: 'artifacts', visible: false, order: 11, style: 'flat' },
  // Tools & Extensions (hidden, accordion-ready when enabled)
  { id: 'tools', visible: false, order: 12, style: 'accordion' },
  { id: 'custom-tools', visible: false, order: 13, style: 'flat' },
  { id: 'extensions', visible: false, order: 14, style: 'flat' },
  // Personal Data (hidden)
  { id: 'tasks', visible: false, order: 15, style: 'flat' },
  { id: 'notes', visible: false, order: 16, style: 'flat' },
  { id: 'goals', visible: false, order: 17, style: 'flat' },
  { id: 'plans', visible: false, order: 18, style: 'flat' },
  { id: 'memories', visible: false, order: 19, style: 'flat' },
  { id: 'bookmarks', visible: false, order: 20, style: 'flat' },
  { id: 'contacts', visible: false, order: 21, style: 'flat' },
  { id: 'habits', visible: false, order: 22, style: 'flat' },
  // System (hidden)
  { id: 'channels', visible: false, order: 23, style: 'flat' },
  { id: 'edge-devices', visible: false, order: 24, style: 'flat' },
  { id: 'mcp-servers', visible: false, order: 25, style: 'flat' },
  { id: 'ai-models', visible: false, order: 26, style: 'flat' },
  { id: 'coding-agents', visible: false, order: 27, style: 'flat' },
];

/** Human-readable labels for sidebar sections */
export const SIDEBAR_SECTION_LABELS: Record<string, string> = {
  // Core
  pinned: 'Pinned Items',
  search: 'Search',
  scheduled: 'Scheduled',
  customize: 'Customize',
  // Data
  workspaces: 'Workspaces',
  workflows: 'Workflows',
  recents: 'Recent Chats',
  // AI & Automation
  agents: 'Agents',
  claws: 'Claws',
  triggers: 'Triggers',
  fleet: 'Fleet Command',
  artifacts: 'Artifacts',
  // Tools & Extensions
  tools: 'Tools',
  'custom-tools': 'Custom Tools',
  extensions: 'Skills & Extensions',
  // Personal Data
  tasks: 'Tasks',
  notes: 'Notes',
  goals: 'Goals',
  plans: 'Plans',
  memories: 'Memories',
  bookmarks: 'Bookmarks',
  contacts: 'Contacts',
  habits: 'Habits',
  // System
  channels: 'Channels',
  'edge-devices': 'Edge Devices',
  'mcp-servers': 'MCP Servers',
  'ai-models': 'AI Models',
  'coding-agents': 'Coding Agents',
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
