/**
 * Centralized localStorage key registry.
 * Prevents typos and makes it easy to find all persisted state.
 */
export const STORAGE_KEYS = {
  THEME: 'theme',
  ADVANCED_MODE: 'ownpilot-advanced-mode',
  SETUP_COMPLETE: 'ownpilot-setup-complete',
  BRIEFING_MODEL: 'briefing-model-preference',
  DESKTOP_NOTIFICATIONS: 'ownpilot-desktop-notifications',
} as const;
