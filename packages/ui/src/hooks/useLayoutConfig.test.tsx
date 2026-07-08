// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { STORAGE_KEYS } from '../constants/storage-keys';
import {
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONFIG_VERSION,
  type LayoutConfig,
  type HeaderZoneEntry,
} from '../types/layout-config';
import { LayoutConfigProvider, useLayoutConfig } from './useLayoutConfig';

function renderHook<T>(
  useHook: () => T,
  options?: { wrapper?: React.FC<{ children: ReactNode }> }
) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  const element = options?.wrapper
    ? createElement(options.wrapper, { children: createElement(TestComponent) })
    : createElement(TestComponent);

  act(() => {
    root = createRoot(container);
    root!.render(element);
  });

  return {
    result: result as { current: T },
    unmount: () =>
      act(() => {
        root!.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
  };
}

const wrapper: React.FC<{ children: ReactNode }> = ({ children }) =>
  createElement(LayoutConfigProvider, null, children);

describe('useLayoutConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── Provider guard ──

  it('throws when used outside LayoutConfigProvider', () => {
    expect(() => renderHook(() => useLayoutConfig())).toThrow(
      'useLayoutConfig must be used within a LayoutConfigProvider'
    );
  });

  // ── Default config ──

  it('returns default config when nothing is in localStorage', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config).toEqual(DEFAULT_LAYOUT_CONFIG);
    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);

    unmount();
  });

  it('returns default config when localStorage key does not exist', () => {
    localStorage.removeItem(STORAGE_KEYS.LAYOUT_CONFIG);

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config).toEqual(DEFAULT_LAYOUT_CONFIG);

    unmount();
  });

  it('migrates partial v10 storage config into a complete current config', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 10,
        sidebar: {
          width: 'wide',
          sections: [{ id: '/dashboard', order: 0 }],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.header).toEqual(DEFAULT_LAYOUT_CONFIG.header);
    expect(result.current.config.customGroups).toEqual([]);
    expect(result.current.config.sidebar.width).toBe('wide');
    expect(result.current.config.sidebar.sections.map((section) => section.id)).toEqual([
      '/dashboard',
      '/agentic',
      'agentic-executions',
    ]);

    const persisted = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LAYOUT_CONFIG) ?? '{}'
    ) as LayoutConfig;
    expect(persisted.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(persisted.header).toEqual(DEFAULT_LAYOUT_CONFIG.header);

    unmount();
  });

  it('falls back to defaults for malformed storage JSON', () => {
    localStorage.setItem(STORAGE_KEYS.LAYOUT_CONFIG, '{not-json');

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config).toEqual(DEFAULT_LAYOUT_CONFIG);

    unmount();
  });

  // ── Migration paths ──

  it('migrates v1 config with headerItems to current version', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 1,
        header: { itemDisplayMode: 'icon-text' },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.header.itemDisplayMode).toBe('icon-text');
    // V1→V2 created zones with matching displayMode
    expect(result.current.config.header.zones.left.displayMode).toBe('icon-text');
    expect(result.current.config.header.zones.center.displayMode).toBe('icon-text');
    expect(result.current.config.header.zones.right.displayMode).toBe('icon-text');
    expect(result.current.config.sidebar.width).toBe('default');

    unmount();
  });

  it('migrates v1 config with invalid display mode to icon', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 1,
        header: { itemDisplayMode: 'invalid-mode' },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.header.itemDisplayMode).toBe('icon');
    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);

    unmount();
  });

  it('migrates v2 config to current version with empty customGroups', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 2,
        header: DEFAULT_LAYOUT_CONFIG.header,
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.customGroups).toEqual([]);

    unmount();
  });

  it('migrates v3 config to current version with sidebar', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 3,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.sidebar.width).toBe('default');
    expect(result.current.config.sidebar.sections.length).toBeGreaterThan(0);

    unmount();
  });

  it('migrates v4 config stripping footer and pinned sections', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 4,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'narrow',
          sections: [
            { id: '/', order: 0 },
            { id: 'footer', order: 1 },
            { id: 'pinned', order: 2 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('/');
    expect(ids).not.toContain('footer');
    expect(ids).not.toContain('pinned');
    expect(result.current.config.sidebar.width).toBe('narrow');

    unmount();
  });

  it('migrates v5 config stripping visible field', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 5,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0, visible: true },
            { id: 'workspaces', order: 1, visible: false },
            { id: 'customize', order: 2 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    const sections = result.current.config.sidebar.sections;
    expect(sections.map((s) => s.id)).not.toContain('workspaces');
    expect(sections.map((s) => s.id)).toContain('/dashboard');
    expect(sections.some((s) => 'visible' in s)).toBe(false);

    unmount();
  });

  it('migrates v5 config with visible:false core section kept', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 5,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [{ id: 'search', order: 0, visible: false }],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.sidebar.sections.map((s) => s.id)).toContain('search');

    unmount();
  });

  it('migrates v6 config converting pinned items to nav sections', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 6,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'pinned', order: 1 },
            { id: 'customize', order: 2 },
          ],
          pinnedItems: [
            { type: 'item', path: '/analytics' },
            { type: 'item', path: '/settings' },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).not.toContain('pinned');
    // Pinned paths become nav sections at the front (before /dashboard)
    expect(ids[0]).toBe('/analytics');
    expect(ids[1]).toBe('/settings');

    unmount();
  });

  it('removes old ownpilot-sidebar-pinned localStorage key during v6 migration', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 6,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'customize', order: 1 },
          ],
        },
      })
    );
    localStorage.setItem('ownpilot-sidebar-pinned', JSON.stringify(['/old-pin']));

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(localStorage.getItem('ownpilot-sidebar-pinned')).toBeNull();

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids[0]).toBe('/old-pin');

    unmount();
  });

  it('migrates v7 config adding claws sections', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 7,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'customize', order: 1 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('/claws');
    expect(ids).toContain('claws');

    unmount();
  });

  it('migrates v7 config skips adding claws when already present', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 7,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: '/claws', order: 1 },
            { id: 'claws', order: 2 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    // Claws should not be duplicated
    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids.filter((id) => id === '/claws')).toHaveLength(1);

    unmount();
  });

  it('chains v7→v8→v9→v10→v11 in a single load', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 7,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'customize', order: 1 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('/claws');
    expect(ids).toContain('/mission-control');
    expect(ids).toContain('/agentic');
    expect(ids).toContain('agentic-executions');
    expect(ids).toContain('claws');

    unmount();
  });

  it('migrates v8 config adding mission-control section', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 8,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'workspaces', order: 1 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('/mission-control');

    unmount();
  });

  it('migrates v8 config inserts mission-control at top when no /dashboard', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 8,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [{ id: 'workspaces', order: 0 }],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids[0]).toBe('/mission-control');

    unmount();
  });

  it('migrates v9 config adding agentic sections', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 9,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'workspaces', order: 1 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('/agentic');
    expect(ids).toContain('agentic-executions');

    unmount();
  });

  it('migrates v9 config skips adding agentic sections when already present', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 9,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: '/agentic', order: 1 },
            { id: 'agentic-executions', order: 2 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids.filter((id) => id === '/agentic')).toHaveLength(1);

    unmount();
  });

  it('migrates v9 config with /mission-control anchor for agentic insertion', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 9,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/mission-control', order: 0 },
            { id: 'workspaces', order: 1 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    const mcIdx = ids.indexOf('/mission-control');
    const agenticIdx = ids.indexOf('/agentic');
    expect(agenticIdx).toBe(mcIdx + 1);

    unmount();
  });

  it('migrates v10 config that already has agentic sections', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 10,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: '/agentic', order: 1 },
            { id: 'agentic-executions', order: 2 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids.filter((id) => id === '/agentic')).toHaveLength(1);

    unmount();
  });

  it('removes pinned section from current-version config via re-run V6 migration', () => {
    // readConfig re-runs V6→...→V11 when hasPinned/hasFooter at current version.
    // Pinned section is removed; default nav items (/dashboard) are added.
    // Footer is not stripped in this path (completeLayoutConfig preserves it).
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: LAYOUT_CONFIG_VERSION,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'footer', order: 1 },
            { id: 'pinned', order: 2 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).not.toContain('pinned');
    // pinned → nav sections: / and /dashboard are default pinned paths
    expect(ids).toContain('/dashboard');
    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);

    unmount();
  });

  it('repairs config missing /agentic section at current version', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: LAYOUT_CONFIG_VERSION,
        header: DEFAULT_LAYOUT_CONFIG.header,
        customGroups: [],
        sidebar: {
          width: 'default',
          sections: [
            { id: '/dashboard', order: 0 },
            { id: 'workspaces', order: 1 },
          ],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('/agentic');
    expect(ids).toContain('agentic-executions');

    unmount();
  });

  // ── Header zone operations ──

  it('setHeaderDisplayMode updates all zones', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.setHeaderDisplayMode('text');
    });

    expect(result.current.config.header.itemDisplayMode).toBe('text');
    expect(result.current.config.header.zones.left.displayMode).toBe('text');
    expect(result.current.config.header.zones.center.displayMode).toBe('text');
    expect(result.current.config.header.zones.right.displayMode).toBe('text');

    unmount();
  });

  it('setZoneDisplayMode updates a single zone', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.setZoneDisplayMode('left', 'icon-text');
    });

    expect(result.current.config.header.zones.left.displayMode).toBe('icon-text');
    expect(result.current.config.header.zones.center.displayMode).toBe('icon');

    unmount();
  });

  it('setZoneEntries replaces entries in a zone', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });
    const entries: HeaderZoneEntry[] = [{ type: 'item', path: '/test' }];

    act(() => {
      result.current.setZoneEntries('center', entries);
    });

    expect(result.current.config.header.zones.center.entries).toEqual(entries);

    unmount();
  });

  it('addZoneEntry appends to a zone', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });
    const entry: HeaderZoneEntry = { type: 'item', path: '/new-item' };

    act(() => {
      result.current.addZoneEntry('right', entry);
    });

    expect(result.current.config.header.zones.right.entries).toHaveLength(1);
    expect(result.current.config.header.zones.right.entries[0]).toEqual(entry);

    unmount();
  });

  it('removeZoneEntry removes entry at index', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addZoneEntry('left', { type: 'item', path: '/first' });
      result.current.addZoneEntry('left', { type: 'item', path: '/second' });
    });
    expect(result.current.config.header.zones.left.entries).toHaveLength(2);

    act(() => {
      result.current.removeZoneEntry('left', 0);
    });

    expect(result.current.config.header.zones.left.entries).toHaveLength(1);
    expect(
      (result.current.config.header.zones.left.entries[0]! as { type: 'item'; path: string }).path
    ).toBe('/second');

    unmount();
  });

  it('getZone returns zone for a valid zoneId', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const leftZone = result.current.getZone('left');
    expect(leftZone).toBeDefined();
    expect(leftZone.entries).toEqual([]);
    expect(leftZone.displayMode).toBe('icon');

    unmount();
  });

  // ── Custom groups ──

  it('addCustomGroup creates and returns a group', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    let group: ReturnType<typeof result.current.addCustomGroup> | undefined;
    act(() => {
      group = result.current.addCustomGroup('My Group', ['/path1', '/path2']);
    });

    expect(group).toBeDefined();
    expect(group!.id).toMatch(/^custom-/);
    expect(group!.label).toBe('My Group');
    expect(group!.items).toEqual(['/path1', '/path2']);
    expect(result.current.config.customGroups).toHaveLength(1);

    unmount();
  });

  it('removeCustomGroup removes by id', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    let groupId = '';
    act(() => {
      const group = result.current.addCustomGroup('To Remove', ['/a']);
      groupId = group.id;
    });

    act(() => {
      result.current.removeCustomGroup(groupId);
    });

    expect(result.current.config.customGroups).toHaveLength(0);

    unmount();
  });

  it('removeCustomGroup does nothing for non-existent id', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addCustomGroup('Keep', ['/keep']);
    });

    act(() => {
      result.current.removeCustomGroup('non-existent-id');
    });

    expect(result.current.config.customGroups).toHaveLength(1);

    unmount();
  });

  it('updateCustomGroup updates label and items', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    let groupId = '';
    act(() => {
      const group = result.current.addCustomGroup('Old', ['/old']);
      groupId = group.id;
    });

    act(() => {
      result.current.updateCustomGroup(groupId, 'Updated', ['/new1', '/new2']);
    });

    expect(result.current.config.customGroups[0]!.label).toBe('Updated');
    expect(result.current.config.customGroups[0]!.items).toEqual(['/new1', '/new2']);

    unmount();
  });

  it('updateCustomGroup does nothing for non-existent id', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addCustomGroup('Keep', ['/keep']);
    });

    act(() => {
      result.current.updateCustomGroup('bad-id', 'Nope', ['/x']);
    });

    expect(result.current.config.customGroups[0]!.label).toBe('Keep');

    unmount();
  });

  // ── Sidebar operations ──

  it('addSidebarSection adds new section with correct order', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addSidebarSection('tools');
    });

    const sections = result.current.config.sidebar.sections;
    const tool = sections.find((s) => s.id === 'tools');
    expect(tool).toBeDefined();
    expect(tool!.order).toBeGreaterThanOrEqual(0);

    unmount();
  });

  it('addSidebarSection does not duplicate existing section', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addSidebarSection('search');
    });

    const searchSections = result.current.config.sidebar.sections.filter((s) => s.id === 'search');
    expect(searchSections).toHaveLength(1);

    unmount();
  });

  it('addSidebarSection applies accordion default for unknown ids', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addSidebarSection('unknown-section-id');
    });

    const us = result.current.config.sidebar.sections.find((s) => s.id === 'unknown-section-id');
    expect(us!.style).toBe('accordion');

    unmount();
  });

  it('removeSidebarSection does not remove core sections', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.removeSidebarSection('search');
    });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).toContain('search');

    unmount();
  });

  it('removeSidebarSection removes non-core section and reindexes', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    // Add a section first so we can remove it
    act(() => {
      result.current.addSidebarSection('tools');
    });

    act(() => {
      result.current.removeSidebarSection('tools');
    });

    const ids = result.current.config.sidebar.sections.map((s) => s.id);
    expect(ids).not.toContain('tools');
    // Orders should be contiguous
    const orders = result.current.config.sidebar.sections.map((s) => s.order);
    expect(orders).toEqual(orders.map((_, i) => i));

    unmount();
  });

  it('toggleSidebarSectionStyle toggles between flat and accordion', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addSidebarSection('workspaces');
    });

    // Toggle from accordion to flat
    act(() => {
      result.current.toggleSidebarSectionStyle('workspaces');
    });
    expect(result.current.config.sidebar.sections.find((s) => s.id === 'workspaces')!.style).toBe(
      'flat'
    );

    // Toggle back to accordion
    act(() => {
      result.current.toggleSidebarSectionStyle('workspaces');
    });
    expect(result.current.config.sidebar.sections.find((s) => s.id === 'workspaces')!.style).toBe(
      'accordion'
    );

    unmount();
  });

  it('reorderSidebarSections replaces sections array', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const current = result.current.config.sidebar.sections;
    const reversed = [...current].reverse().map((s, i) => ({ ...s, order: i }));

    act(() => {
      result.current.reorderSidebarSections(reversed);
    });

    expect(result.current.config.sidebar.sections).toEqual(reversed);

    unmount();
  });

  it('setSidebarWidth updates width', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.setSidebarWidth('narrow');
    });

    expect(result.current.config.sidebar.width).toBe('narrow');

    unmount();
  });

  it('getSidebarSections returns current sections', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const sections = result.current.getSidebarSections();
    expect(sections).toEqual(result.current.config.sidebar.sections);

    unmount();
  });

  // ── setConfig ──

  it('setConfig with direct value replaces config', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    const newConfig = {
      ...DEFAULT_LAYOUT_CONFIG,
      sidebar: { ...DEFAULT_LAYOUT_CONFIG.sidebar, width: 'narrow' as const },
    };

    act(() => {
      result.current.setConfig(newConfig);
    });

    expect(result.current.config.sidebar.width).toBe('narrow');

    unmount();
  });

  it('setConfig with updater function transforms config', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.setConfig((prev) => ({
        ...prev,
        sidebar: { ...prev.sidebar, width: 'wide' },
      }));
    });

    expect(result.current.config.sidebar.width).toBe('wide');

    unmount();
  });

  // ── Persistence ──

  it('persists config changes to localStorage', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.setSidebarWidth('wide');
    });

    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LAYOUT_CONFIG) ?? '{}'
    ) as LayoutConfig;
    expect(stored.sidebar.width).toBe('wide');
    expect(stored.version).toBe(LAYOUT_CONFIG_VERSION);

    unmount();
  });

  it('persists header display mode change to localStorage', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.setHeaderDisplayMode('text');
    });

    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LAYOUT_CONFIG) ?? '{}'
    ) as LayoutConfig;
    expect(stored.header.itemDisplayMode).toBe('text');

    unmount();
  });

  it('persists custom group addition to localStorage', () => {
    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    act(() => {
      result.current.addCustomGroup('Persisted', ['/route']);
    });

    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LAYOUT_CONFIG) ?? '{}'
    ) as LayoutConfig;
    expect(stored.customGroups).toHaveLength(1);
    expect(stored.customGroups[0]!.label).toBe('Persisted');

    unmount();
  });

  // ── Edge cases: incomplete config objects ──

  it('handles config with version 0 (completeLayoutConfig path)', () => {
    localStorage.setItem(STORAGE_KEYS.LAYOUT_CONFIG, JSON.stringify({ version: 0 }));

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.header).toBeDefined();
    expect(result.current.config.sidebar).toBeDefined();
    expect(result.current.config.customGroups).toEqual([]);

    unmount();
  });
});
