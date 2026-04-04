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
  type SidebarSectionStyle,
  DEFAULT_LAYOUT_CONFIG,
  DEFAULT_SIDEBAR_SECTIONS,
  LAYOUT_CONFIG_VERSION,
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
  return typeof obj.id === 'string' && typeof obj.visible === 'boolean' && typeof obj.order === 'number';
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
  if (typeof obj.version === 'number' && obj.version === 4) {
    const config = obj as unknown as LayoutConfig;
    const existingIds = new Set((config.sidebar?.sections ?? []).map((s) => s.id));
    const newSections = DEFAULT_SIDEBAR_SECTIONS.filter((s) => !existingIds.has(s.id));
    const maxOrder = Math.max(0, ...(config.sidebar?.sections ?? []).map((s) => s.order));
    return migrateConfig({
      ...config,
      version: LAYOUT_CONFIG_VERSION,
      sidebar: {
        ...config.sidebar,
        sections: [
          ...(config.sidebar?.sections ?? []).filter((s) => s.id !== 'footer'),
          ...newSections.map((s, i) => ({ ...s, order: maxOrder + 1 + i })),
        ],
      },
    });
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
  toggleSidebarSection: (sectionId: string) => void;
  toggleSidebarSectionStyle: (sectionId: string) => void;
  reorderSidebarSections: (sections: SidebarSectionConfig[]) => void;
  setSidebarWidth: (width: SidebarWidth) => void;
  getSidebarSections: () => SidebarSectionConfig[];
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

  const toggleSidebarSection = useCallback(
    (sectionId: string) => {
      setConfig((prev) => ({
        ...prev,
        sidebar: {
          ...prev.sidebar,
          sections: (prev.sidebar.sections ?? DEFAULT_SIDEBAR_SECTIONS).map((s) =>
            s.id === sectionId ? { ...s, visible: !s.visible } : s
          ),
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
            s.id === sectionId ? { ...s, style: (s.style === 'flat' ? 'accordion' : 'flat') as SidebarSectionStyle } : s
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

  return (
    <LayoutConfigContext.Provider
      value={{ config, setConfig, setHeaderDisplayMode, setZoneDisplayMode, setZoneEntries, addZoneEntry, removeZoneEntry, getZone, addCustomGroup, removeCustomGroup, updateCustomGroup, toggleSidebarSection, toggleSidebarSectionStyle, reorderSidebarSections, setSidebarWidth, getSidebarSections }}
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
