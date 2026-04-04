/**
 * Centralized localStorage key registry.
 * Prevents typos and makes it easy to find all persisted state.
 */
export const STORAGE_KEYS = {
  THEME: 'theme',
  SETUP_COMPLETE: 'ownpilot-setup-complete',
  BRIEFING_MODEL: 'briefing-model-preference',
  DESKTOP_NOTIFICATIONS: 'ownpilot-desktop-notifications',
  SESSION_TOKEN: 'ownpilot-session-token',
  DEBUG_DRAWER: 'ownpilot-debug-drawer',
  MINI_CHAT_OPEN: 'ownpilot-mini-chat-open',
  SIDEBAR_PINNED: 'ownpilot-sidebar-pinned',  // string[] of pinned route paths (e.g. ['/', '/dashboard', '/customize'])
  NAV_GROUPS: 'ownpilot_nav_groups',           // legacy key — kept for migration compat, replaced by SIDEBAR_PINNED
  GROUP_COLLAPSE: 'ownpilot-customize-group-state', // Record<string, boolean> — group open/closed state in CustomizePage
  LOCAL_FILES_DEVICES: 'ownpilot-local-files-devices', // Record<string, boolean> — open/closed state for machine devices
  LOCAL_FILES_DIRS: 'ownpilot-local-files-dirs',       // Record<string, boolean> — open/closed state for bookmark directories
  HEADER_ITEMS: 'ownpilot-header-items',               // HeaderItemConfig[] — pinned items/groups in header bar
  LAYOUT_CONFIG: 'ownpilot-layout-config',             // LayoutConfig — header/sidebar display preferences
} as const;
