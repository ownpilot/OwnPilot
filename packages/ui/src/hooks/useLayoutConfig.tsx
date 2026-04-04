/**
 * useLayoutConfig — manages layout presentation preferences.
 *
 * Controls header zone configuration, display modes, and future sidebar options.
 * Uses Context so all consumers share state. LayoutConfigProvider must wrap the tree.
 *
 * Storage: localStorage[STORAGE_KEYS.LAYOUT_CONFIG] as LayoutConfig.
 * Version field enables forward-compatible migrations.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';
import {
  type LayoutConfig,
  type HeaderItemDisplayMode,
  type HeaderZoneId,
  type HeaderZoneEntry,
  type HeaderZoneConfig,
  type CustomGroup,
  type SidebarWidth,
  type SidebarSectionConfig,
  type SidebarPinnedConfig,
  DEFAULT_LAYOUT_CONFIG,
  DEFAULT_SIDEBAR_SECTIONS,
  DEFAULT_PINNED_ITEMS,
  MAX_PINNED_ITEMS,
  LAYOUT_CONFIG_VERSION,
  CORE_SECTION_IDS,
  SECTION_DEFAULT_STYLES,
} from '../types/layout-config';

// --- Validation & Migration ---

const VALID_DISPLAY_MODES = ['icon', 'icon-text', 'text'];
const VALID_ZONE_IDS: HeaderZoneId[] = ['left', 'center', 'right'];
const EMPTY_ZONE: HeaderZoneConfig = { entries: [], displayMode: 'icon' };

function isValidZoneEntry(v: unknown): v is HeaderZoneEntry {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (obj.type === 'item') return typeof obj.path === 'string';
  if (obj.type === 'group') {
    return typeof obj.id === 'string' && typeof obj.label === 'string' &&
      Array.isArray(obj.items) && obj.items.every((x: unknown) => typeof x === 'string');
  }
  if (obj.type === 'widget') return typeof obj.widgetId === 'string';
  return false;
}

function isValidZoneConfig(v: unknown): v is HeaderZoneConfig {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) return false;
  if (!VALID_DISPLAY_MODES.includes(obj.displayMode as string)) return false;
  return obj.entries.every(isValidZoneEntry);
}

const VALID_SIDEBAR_WIDTHS = ['narrow', 'default', 'wide'];

function isValidSidebarSection(v: unknown): v is SidebarSectionConfig {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.order === 'number';
}

function isValidPinnedConfig(v: unknown): v is SidebarPinnedConfig {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (obj.type === 'item') return typeof obj.path === 'string';
  if (obj.type === 'group') {
    return typeof obj.id === 'string' && typeof obj.label === 'string' &&
      Array.isArray(obj.items) && obj.items.every((x: unknown) => typeof x === 'string');
  }
  return false;
}

function isValidConfig(v: unknown): v is LayoutConfig {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;
  if (!obj.header || typeof obj.header !== 'object') return false;
  const h = obj.header as Record<string, unknown>;
  if (!VALID_DISPLAY_MODES.includes(h.itemDisplayMode as string)) return false;
  if (!h.zones || typeof h.zones !== 'object') return false;
  const zones = h.zones as Record<string, unknown>;
  if (!VALID_ZONE_IDS.every((id) => isValidZoneConfig(zones[id]))) return false;
  if (!Array.isArray(obj.customGroups)) return false;
  // V4+: validate sidebar
  if (obj.sidebar && typeof obj.sidebar === 'object') {
    const s = obj.sidebar as Record<string, unknown>;
    if (!VALID_SIDEBAR_WIDTHS.includes(s.width as string)) return false;
    if (s.sections !== undefined) {
      if (!Array.isArray(s.sections) || !s.sections.every(isValidSidebarSection)) return false;
    }
    if (s.pinnedItems !== undefined) {
      if (!Array.isArray(s.pinnedItems) || !s.pinnedItems.every(isValidPinnedConfig)) return false;
    }
  }
  return true;
}

function migrateConfig(raw: unknown): LayoutConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_LAYOUT_CONFIG;
  const obj = raw as Record<string, unknown>;

  // V1 → V2: add zones from old flat headerItems
  if (typeof obj.version === 'number' && obj.version < 2) {
    const h = (obj.header as Record<string, unknown>) || {};
    const displayMode = VALID_DISPLAY_MODES.includes(h.itemDisplayMode as string)
      ? (h.itemDisplayMode as HeaderItemDisplayMode)
      : 'icon';

    return {
      ...DEFAULT_LAYOUT_CONFIG,
      version: LAYOUT_CONFIG_VERSION,
      header: {
        itemDisplayMode: displayMode,
        zones: {
          left: { entries: [], displayMode },
          center: { entries: [], displayMode },
          right: { entries: [], displayMode },
        },
      },
    };
  }

  // V2 → V3: add customGroups array
  if (typeof obj.version === 'number' && obj.version === 2) {
    return migrateConfig({
      ...(obj as unknown as LayoutConfig),
      version: 3,
      customGroups: [],
    });
  }

  // V3 → V4+: add sidebar sections + width (recursive to apply further migrations)
  if (typeof obj.version === 'number' && obj.version === 3) {
    return migrateConfig({
      ...(obj as unknown as LayoutConfig),
      version: 4,
      sidebar: {
        width: 'default' as const,
        sections: [...DEFAULT_SIDEBAR_SECTIONS],
      },
    });
  }

  // V4 → V5: add 21 new data sections (hidden by default, preserving user's existing prefs)
  // Note: V5 sections had `visible` field — V5→V6 migration strips it below
  if (typeof obj.version === 'number' && obj.version === 4) {
    // First migrate to V5 format, then chain to V5→V6
    const config = obj as unknown as LayoutConfig;
    const existingSections = (config.sidebar?.sections ?? []).filter((s) => s.id !== 'footer');
    return migrateConfig({
      ...config,
      version: 5, // will chain to V5→V6
      sidebar: {
        ...config.sidebar,
        sections: existingSections,
      },
    });
  }

  // V5 → V6: remove `visible` field, keep only visible sections (add/remove pattern)
  if (typeof obj.version === 'number' && obj.version === 5) {
    const config = obj as unknown as LayoutConfig;
    const oldSections = (config.sidebar?.sections ?? []) as (SidebarSectionConfig & { visible?: boolean })[];
    // Keep sections that were visible (or core sections that must always exist)
    const keptSections = oldSections
      .filter((s) => s.visible === true || s.visible === undefined || CORE_SECTION_IDS.has(s.id))
      .map(({ visible: _, ...rest }, idx) => ({ ...rest, order: idx }));
    // Ensure core sections exist (in case of corrupted config)
    const keptIds = new Set(keptSections.map((s) => s.id));
    const missingCore = DEFAULT_SIDEBAR_SECTIONS
      .filter((s) => CORE_SECTION_IDS.has(s.id) && !keptIds.has(s.id));
    // Full reindex to ensure contiguous 0-based order (no gaps)
    const allSections = [...keptSections, ...missingCore]
      .map((s, i) => ({ ...s, order: i }));
    return migrateConfig({
      ...config,
      version: 6, // chain to V6→V7
      sidebar: {
        ...config.sidebar,
        sections: allSections,
      },
    });
  }

  // V6 → V7: absorb pinnedItems from separate localStorage key into LayoutConfig
  if (typeof obj.version === 'number' && obj.version === 6) {
    const config = obj as unknown as LayoutConfig;
    let pinnedItems: SidebarPinnedConfig[] = [...DEFAULT_PINNED_ITEMS];
    try {
      const raw = localStorage.getItem('ownpilot-sidebar-pinned');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (typeof parsed[0] === 'string') {
            // Legacy string[] format
            pinnedItems = parsed.map((path: string) => ({ type: 'item' as const, path }));
          } else if (parsed.every(isValidPinnedConfig)) {
            pinnedItems = parsed;
          }
        }
        // Clean up old key after successful migration
        localStorage.removeItem('ownpilot-sidebar-pinned');
      }
    } catch { /* ignore malformed data */ }
    return {
      ...config,
      version: LAYOUT_CONFIG_VERSION,
      sidebar: {
        ...config.sidebar,
        pinnedItems,
      },
    };
  }

  if (isValidConfig(obj)) {
    // Strip any leftover 'footer' section from pre-v4.1 configs
    const config = { ...obj, version: LAYOUT_CONFIG_VERSION } as LayoutConfig;
    if (config.sidebar?.sections) {
      config.sidebar = {
        ...config.sidebar,
        sections: config.sidebar.sections.filter((s) => s.id !== 'footer'),
      };
    }
    return config;
  }
  return DEFAULT_LAYOUT_CONFIG;
}

function readConfig(): LayoutConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAYOUT_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidConfig(parsed) && parsed.version === LAYOUT_CONFIG_VERSION) {
        // Strip leftover 'footer' from pre-removal configs (footer is now structural)
        if (parsed.sidebar?.sections?.some((s: { id: string }) => s.id === 'footer')) {
          const cleaned = {
            ...parsed,
            sidebar: { ...parsed.sidebar, sections: parsed.sidebar.sections.filter((s: { id: string }) => s.id !== 'footer') },
          };
          persistConfig(cleaned);
          return cleaned;
        }
        return parsed;
      }
      const migrated = migrateConfig(parsed);
      localStorage.setItem(STORAGE_KEYS.LAYOUT_CONFIG, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Malformed JSON
  }
  return DEFAULT_LAYOUT_CONFIG;
}

function persistConfig(config: LayoutConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAYOUT_CONFIG, JSON.stringify(config));
  } catch {
    // Storage full
  }
}

// --- Context ---

interface LayoutConfigValue {
  config: LayoutConfig;
  setConfig: (updater: LayoutConfig | ((prev: LayoutConfig) => LayoutConfig)) => void;
  setHeaderDisplayMode: (mode: HeaderItemDisplayMode) => void;
  setZoneDisplayMode: (zoneId: HeaderZoneId, mode: HeaderItemDisplayMode) => void;
  setZoneEntries: (zoneId: HeaderZoneId, entries: HeaderZoneEntry[]) => void;
  addZoneEntry: (zoneId: HeaderZoneId, entry: HeaderZoneEntry) => void;
  removeZoneEntry: (zoneId: HeaderZoneId, index: number) => void;
  getZone: (zoneId: HeaderZoneId) => HeaderZoneConfig;
  addCustomGroup: (label: string, items: string[]) => CustomGroup;
  removeCustomGroup: (id: string) => void;
  updateCustomGroup: (id: string, label: string, items: string[]) => void;
  // Sidebar helpers
  addSidebarSection: (sectionId: string) => void;
  removeSidebarSection: (sectionId: string) => void;
  toggleSidebarSectionStyle: (sectionId: string) => void;
  reorderSidebarSections: (sections: SidebarSectionConfig[]) => void;
  setSidebarWidth: (width: SidebarWidth) => void;
  getSidebarSections: () => SidebarSectionConfig[];
  // Pinned items helpers (data now lives in config.sidebar.pinnedItems)
  getPinnedConfigs: () => SidebarPinnedConfig[];
  setPinnedConfigs: (updater: SidebarPinnedConfig[] | ((prev: SidebarPinnedConfig[]) => SidebarPinnedConfig[])) => void;
  getPinnedItemPaths: () => string[];
  setPinnedItemPaths: (updater: string[] | ((prev: string[]) => string[])) => void;
  addPinnedGroup: (id: string, label: string, items: string[]) => void;
  isPinnedGroup: (groupId: string) => boolean;
  togglePinnedGroup: (id: string, label: string, items: string[]) => void;
}

const LayoutConfigContext = createContext<LayoutConfigValue | null>(null);

export function LayoutConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigRaw] = useState<LayoutConfig>(() => readConfig());

  const setConfig = useCallback(
    (updater: LayoutConfig | ((prev: LayoutConfig) => LayoutConfig)) => {
      setConfigRaw((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        persistConfig(next);
        return next;
      });
    },
    [],
  );

  const setHeaderDisplayMode = useCallback(
    (mode: HeaderItemDisplayMode) => {
      setConfig((prev) => ({
        ...prev,
        header: {
          ...prev.header,
          itemDisplayMode: mode,
          zones: Object.fromEntries(
            VALID_ZONE_IDS.map((id) => [id, { ...prev.header.zones[id], displayMode: mode }])
          ) as Record<HeaderZoneId, HeaderZoneConfig>,
        },
      }));
    },
    [setConfig],
  );

  const setZoneDisplayMode = useCallback(
    (zoneId: HeaderZoneId, mode: HeaderItemDisplayMode) => {
      setConfig((prev) => ({
        ...prev,
        header: {
          ...prev.header,
          zones: { ...prev.header.zones, [zoneId]: { ...prev.header.zones[zoneId], displayMode: mode } },
        },
      }));
    },
    [setConfig],
  );

  const setZoneEntries = useCallback(
    (zoneId: HeaderZoneId, entries: HeaderZoneEntry[]) => {
      setConfig((prev) => ({
        ...prev,
        header: {
          ...prev.header,
          zones: { ...prev.header.zones, [zoneId]: { ...prev.header.zones[zoneId], entries } },
        },
      }));
    },
    [setConfig],
  );

  const addZoneEntry = useCallback(
    (zoneId: HeaderZoneId, entry: HeaderZoneEntry) => {
      setConfig((prev) => {
        const zone = prev.header.zones[zoneId];
        return {
          ...prev,
          header: {
            ...prev.header,
            zones: { ...prev.header.zones, [zoneId]: { ...zone, entries: [...zone.entries, entry] } },
          },
        };
      });
    },
    [setConfig],
  );

  const removeZoneEntry = useCallback(
    (zoneId: HeaderZoneId, index: number) => {
      setConfig((prev) => {
        const zone = prev.header.zones[zoneId];
        return {
          ...prev,
          header: {
            ...prev.header,
            zones: { ...prev.header.zones, [zoneId]: { ...zone, entries: zone.entries.filter((_, i) => i !== index) } },
          },
        };
      });
    },
    [setConfig],
  );

  const getZone = useCallback(
    (zoneId: HeaderZoneId): HeaderZoneConfig => config.header.zones[zoneId] ?? EMPTY_ZONE,
    [config],
  );

  const addCustomGroup = useCallback(
    (label: string, items: string[]): CustomGroup => {
      const group: CustomGroup = { id: `custom-${Date.now()}`, label, items };
      setConfig((prev) => ({ ...prev, customGroups: [...prev.customGroups, group] }));
      return group;
    },
    [setConfig],
  );

  const removeCustomGroup = useCallback(
    (id: string) => {
      setConfig((prev) => ({ ...prev, customGroups: prev.customGroups.filter((g) => g.id !== id) }));
    },
    [setConfig],
  );

  const updateCustomGroup = useCallback(
    (id: string, label: string, items: string[]) => {
      setConfig((prev) => ({
        ...prev,
        customGroups: prev.customGroups.map((g) => (g.id === id ? { ...g, label, items } : g)),
      }));
    },
    [setConfig],
  );

  // --- Sidebar helpers ---

  const addSidebarSection = useCallback(
    (sectionId: string) => {
      setConfig((prev) => {
        const sections = prev.sidebar.sections ?? DEFAULT_SIDEBAR_SECTIONS;
        // Don't add if already present
        if (sections.some((s) => s.id === sectionId)) return prev;
        const maxOrder = sections.reduce((m, s) => Math.max(m, s.order), -1);
        const style = SECTION_DEFAULT_STYLES[sectionId] ?? 'flat';
        return {
          ...prev,
          sidebar: {
            ...prev.sidebar,
            sections: [...sections, { id: sectionId, order: maxOrder + 1, style }],
          },
        };
      });
    },
    [setConfig],
  );

  const removeSidebarSection = useCallback(
    (sectionId: string) => {
      // Core sections cannot be removed
      if (CORE_SECTION_IDS.has(sectionId)) return;
      setConfig((prev) => ({
        ...prev,
        sidebar: {
          ...prev.sidebar,
          sections: (prev.sidebar.sections ?? DEFAULT_SIDEBAR_SECTIONS)
            .filter((s) => s.id !== sectionId)
            .map((s, i) => ({ ...s, order: i })),
        },
      }));
    },
    [setConfig],
  );

  const toggleSidebarSectionStyle = useCallback(
    (sectionId: string) => {
      setConfig((prev) => ({
        ...prev,
        sidebar: {
          ...prev.sidebar,
          sections: (prev.sidebar.sections ?? DEFAULT_SIDEBAR_SECTIONS).map((s) =>
            s.id === sectionId ? { ...s, style: (s.style === 'flat' ? 'accordion' : 'flat') } : s
          ),
        },
      }));
    },
    [setConfig],
  );

  const reorderSidebarSections = useCallback(
    (sections: SidebarSectionConfig[]) => {
      setConfig((prev) => ({
        ...prev,
        sidebar: { ...prev.sidebar, sections },
      }));
    },
    [setConfig],
  );

  const setSidebarWidth = useCallback(
    (width: SidebarWidth) => {
      setConfig((prev) => ({
        ...prev,
        sidebar: { ...prev.sidebar, width },
      }));
    },
    [setConfig],
  );

  const getSidebarSections = useCallback(
    (): SidebarSectionConfig[] => config.sidebar.sections ?? DEFAULT_SIDEBAR_SECTIONS,
    [config],
  );

  // --- Pinned items helpers ---

  const getPinnedConfigs = useCallback(
    (): SidebarPinnedConfig[] => config.sidebar.pinnedItems ?? DEFAULT_PINNED_ITEMS,
    [config],
  );

  const setPinnedConfigs = useCallback(
    (updater: SidebarPinnedConfig[] | ((prev: SidebarPinnedConfig[]) => SidebarPinnedConfig[])) => {
      setConfig((prev) => {
        const current = prev.sidebar.pinnedItems ?? DEFAULT_PINNED_ITEMS;
        const next = typeof updater === 'function' ? updater(current) : updater;
        return { ...prev, sidebar: { ...prev.sidebar, pinnedItems: next } };
      });
    },
    [setConfig],
  );

  const getPinnedItemPaths = useCallback(
    (): string[] => (config.sidebar.pinnedItems ?? DEFAULT_PINNED_ITEMS)
      .filter((c): c is Extract<SidebarPinnedConfig, { type: 'item' }> => c.type === 'item')
      .map((c) => c.path),
    [config],
  );

  const setPinnedItemPaths = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setPinnedConfigs((prevConfigs) => {
        const prevPaths = prevConfigs
          .filter((c): c is Extract<SidebarPinnedConfig, { type: 'item' }> => c.type === 'item')
          .map((c) => c.path);
        const nextPaths = typeof updater === 'function' ? updater(prevPaths) : updater;
        const groups = prevConfigs.filter((c) => c.type === 'group');
        const items: SidebarPinnedConfig[] = nextPaths.map((path) => ({ type: 'item', path }));
        return [...items, ...groups];
      });
    },
    [setPinnedConfigs],
  );

  const addPinnedGroup = useCallback(
    (id: string, label: string, items: string[]) => {
      setPinnedConfigs((prev) => {
        if (prev.length >= MAX_PINNED_ITEMS) return prev;
        if (prev.some((c) => c.type === 'group' && c.id === id)) return prev;
        return [...prev, { type: 'group', id, label, items }];
      });
    },
    [setPinnedConfigs],
  );

  const isPinnedGroup = useCallback(
    (groupId: string): boolean =>
      (config.sidebar.pinnedItems ?? DEFAULT_PINNED_ITEMS).some((c) => c.type === 'group' && c.id === groupId),
    [config],
  );

  const togglePinnedGroup = useCallback(
    (id: string, label: string, items: string[]) => {
      setPinnedConfigs((prev) => {
        const exists = prev.some((c) => c.type === 'group' && c.id === id);
        if (exists) return prev.filter((c) => !(c.type === 'group' && c.id === id));
        if (prev.length >= MAX_PINNED_ITEMS) return prev;
        return [...prev, { type: 'group', id, label, items }];
      });
    },
    [setPinnedConfigs],
  );

  return (
    <LayoutConfigContext.Provider
      value={{ config, setConfig, setHeaderDisplayMode, setZoneDisplayMode, setZoneEntries, addZoneEntry, removeZoneEntry, getZone, addCustomGroup, removeCustomGroup, updateCustomGroup, addSidebarSection, removeSidebarSection, toggleSidebarSectionStyle, reorderSidebarSections, setSidebarWidth, getSidebarSections, getPinnedConfigs, setPinnedConfigs, getPinnedItemPaths, setPinnedItemPaths, addPinnedGroup, isPinnedGroup, togglePinnedGroup }}
    >
      {children}
    </LayoutConfigContext.Provider>
  );
}

export function useLayoutConfig() {
  const ctx = useContext(LayoutConfigContext);
  if (!ctx) {
    throw new Error('useLayoutConfig must be used within a LayoutConfigProvider');
  }
  return ctx;
}
