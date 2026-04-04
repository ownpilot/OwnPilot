/**
 * ZoneEditor — settings panel for a selected wireframe zone.
 *
 * Shows display mode selector, entry list with remove buttons,
 * and add item/group controls for header zones.
 * Shows "coming soon" placeholder for non-header zones.
 */
import { useState } from 'react';
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { useHeaderItems } from '../hooks/useHeaderItems';
import { ALL_NAV_ITEMS, NAV_ITEM_MAP, navGroups } from '../constants/nav-items';
import { PAGE_LAYOUT_REGISTRY } from '../constants/page-layouts';
import { LayoutDashboard, AlignLeft, Type, X, Plus, ChevronDown, FileCode, GripVertical, ListChecks, Minus } from './icons';
import type { WireframeZone } from './LayoutWireframe';
import type { HeaderZoneId, HeaderItemDisplayMode } from '../types/layout-config';
import { SIDEBAR_SECTION_LABELS, SIDEBAR_WIDTH_VALUES, CORE_SECTION_IDS, type SidebarWidth } from '../types/layout-config';
import { SECTION_GROUP_LABELS, getSectionIcon, getSectionLabel, getSectionGroup as getGroup, DATA_SECTION_ROUTES, type SidebarSectionGroup } from '../constants/sidebar-sections';

const ZONE_LABELS: Record<WireframeZone, string> = {
  'header-brand': 'Header — Brand',
  'header-left': 'Header — Left Zone',
  'header-center': 'Header — Center Zone',
  'header-right': 'Header — Right Zone',
  'header-settings': 'Header — Settings',
  sidebar: 'Sidebar',
  customize: 'Customize Panel',
  content: 'Content Area',
  'stats-panel': 'Stats Panel',
};

const HEADER_ZONE_MAP: Record<string, HeaderZoneId> = {
  'header-left': 'left',
  'header-center': 'center',
  'header-right': 'right',
};

const DISPLAY_MODES: { mode: HeaderItemDisplayMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { mode: 'icon', label: 'Icon', icon: LayoutDashboard },
  { mode: 'icon-text', label: 'Icon+Text', icon: AlignLeft },
  { mode: 'text', label: 'Text', icon: Type },
];

function isEditableHeaderZone(zone: WireframeZone): zone is 'header-left' | 'header-center' | 'header-right' {
  return zone in HEADER_ZONE_MAP;
}

export function ZoneEditor({ zone }: { zone: WireframeZone }) {
  const { config, getZone, setZoneDisplayMode, setZoneEntries, addZoneEntry, removeZoneEntry } = useLayoutConfig();
  const { headerItems, addItem: addLegacyItem, addGroup: addLegacyGroup, removeByIndex: removeLegacyByIndex } = useHeaderItems();
  const [addMenuOpen, setAddMenuOpen] = useState<'item' | 'group' | null>(null);
  const [addItemSearch, setAddItemSearch] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null); // insertion index (line appears BEFORE this index)

  const label = ZONE_LABELS[zone];

  // Content zone — page layout inspector
  if (zone === 'content') {
    return <ContentZoneEditor />;
  }

  // Sidebar zone — section visibility, ordering, width
  if (zone === 'sidebar') {
    return <SidebarZoneEditor />;
  }

  // Non-editable zones
  if (!isEditableHeaderZone(zone)) {
    return (
      <div className="rounded-lg border border-border dark:border-dark-border p-4">
        <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">{label}</h3>
        {zone === 'header-brand' && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Displays the application name. Brand customization coming soon.
          </p>
        )}
        {zone === 'header-settings' && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Fixed zone — shows connection status and settings icon. Not configurable.
          </p>
        )}
        {zone === 'customize' && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            The sidebar panel for pinning items and groups to Sidebar/Header. Managed via the Customize button in the sidebar.
          </p>
        )}
        {zone === 'stats-panel' && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
            {label} customization options coming soon — width, density, visibility.
          </p>
        )}
      </div>
    );
  }

  // Editable header zone
  const zoneId = HEADER_ZONE_MAP[zone]!;
  const zoneConfig = getZone(zoneId);
  const currentMode = zoneConfig.displayMode;

  // Items already in ANY zone (prevent duplicates across zones)
  const allZoneIds: (typeof zoneId)[] = ['left', 'center', 'right'];
  const usedPaths = new Set(
    allZoneIds.flatMap((z) => getZone(z).entries.filter((e) => e.type === 'item').map((e) => (e as { path: string }).path))
  );
  const usedGroupIds = new Set(
    allZoneIds.flatMap((z) => getZone(z).entries.filter((e) => e.type === 'group').map((e) => (e as { id: string }).id))
  );

  const availableItems = ALL_NAV_ITEMS.filter((item) => !usedPaths.has(item.to));
  const availableGroups = navGroups.filter((g) => !usedGroupIds.has(g.id));

  const handleAddItem = (path: string) => {
    addZoneEntry(zoneId, { type: 'item', path });
    addLegacyItem(path); // sync to legacy store
    setAddMenuOpen(null);
  };

  const handleAddGroup = (group: typeof navGroups[number]) => {
    addZoneEntry(zoneId, { type: 'group', id: group.id, label: group.label, items: group.items.map((i) => i.to) });
    addLegacyGroup(group.id, group.label, group.items.map((i) => i.to)); // sync to legacy store
    setAddMenuOpen(null);
  };

  const handleRemoveEntry = (index: number) => {
    const entry = zoneConfig.entries[index];
    removeZoneEntry(zoneId, index);
    // Sync: also remove from legacy store
    if (entry) {
      if (entry.type === 'item') {
        const legIdx = headerItems.findIndex((c) => c.type === 'item' && c.path === entry.path);
        if (legIdx >= 0) removeLegacyByIndex(legIdx);
      } else if (entry.type === 'group') {
        const legIdx = headerItems.findIndex((c) => c.type === 'group' && c.id === entry.id);
        if (legIdx >= 0) removeLegacyByIndex(legIdx);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    // If mouse is in top half → insert before this item, else after
    setDropTarget(e.clientY < midY ? i : i + 1);
  };

  const handleDragEnd = () => {
    if (dragIdx !== null && dropTarget !== null) {
      // Calculate effective insert position (account for removal shifting indices)
      let insertAt = dropTarget;
      if (insertAt > dragIdx) insertAt -= 1; // removing dragIdx shifts everything after it up
      if (insertAt !== dragIdx) {
        const reordered = [...zoneConfig.entries];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(insertAt, 0, moved!);
        setZoneEntries(zoneId, reordered);
      }
    }
    setDragIdx(null);
    setDropTarget(null);
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 dark:bg-primary/5 p-4 space-y-4">
      {/* Zone title */}
      <h3 className="text-sm font-medium text-primary">{label}</h3>

      {/* Display mode */}
      <div className="space-y-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">Display Mode</p>
        <div className="flex gap-1">
          {DISPLAY_MODES.map(({ mode, label: modeLabel, icon: ModeIcon }) => (
            <button
              key={mode}
              onClick={() => setZoneDisplayMode(zoneId, mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                currentMode === mode
                  ? 'bg-primary text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary'
              }`}
            >
              <ModeIcon className="w-3 h-3" />
              {modeLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Entries list */}
      <div className="space-y-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Entries ({zoneConfig.entries.length})
        </p>

        {zoneConfig.entries.length === 0 ? (
          <p className="text-xs text-text-muted dark:text-dark-text-muted italic py-2">
            No entries yet — add items or groups below.
          </p>
        ) : (
          <div className="space-y-1">
            {zoneConfig.entries.map((entry, i) => {
              let entryLabel = '';
              let EntryIcon: React.ComponentType<{ className?: string }> | null = null;

              if (entry.type === 'item') {
                const navItem = NAV_ITEM_MAP.get(entry.path);
                entryLabel = navItem?.label ?? entry.path;
                EntryIcon = navItem?.icon ?? null;
              } else if (entry.type === 'group') {
                entryLabel = `${entry.label} (${entry.items.length} items)`;
              }

              const showLineBefore = dragIdx !== null && dropTarget === i && dropTarget !== dragIdx && dropTarget !== dragIdx + 1;

              return (
                <div key={entry.type === 'item' ? entry.path : entry.type === 'group' ? entry.id : `widget-${i}`}>
                  {/* Drop indicator line BEFORE this item */}
                  {showLineBefore && (
                    <div className="h-0.5 bg-primary rounded-full mx-2 my-0.5" />
                  )}
                  <div
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-xs cursor-grab active:cursor-grabbing transition-opacity ${
                      dragIdx === i ? 'opacity-30' : ''
                    }`}
                  >
                  <GripVertical className="w-3 h-3 shrink-0 text-text-muted dark:text-dark-text-muted" />
                  {EntryIcon && <EntryIcon className="w-3.5 h-3.5 shrink-0 text-text-secondary dark:text-dark-text-secondary" />}
                  {entry.type === 'group' && <ChevronDown className="w-3 h-3 shrink-0 text-text-muted dark:text-dark-text-muted" />}
                  <span className="flex-1 truncate text-text-primary dark:text-dark-text-primary">{entryLabel}</span>
                  <span className="text-[9px] text-text-muted dark:text-dark-text-muted uppercase">{entry.type}</span>
                  <button
                    onClick={() => handleRemoveEntry(i)}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-error/10 hover:text-error transition-colors text-text-muted dark:text-dark-text-muted"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  </div>
                  {/* Drop indicator line AFTER last item */}
                  {(i === zoneConfig.entries.length - 1 && dragIdx !== null && dropTarget === zoneConfig.entries.length && dropTarget !== dragIdx) ? (
                    <div className="h-0.5 bg-primary rounded-full mx-2 my-0.5" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add buttons */}
      <div className="flex gap-2 relative">
        <div className="relative">
          <button
            onClick={() => { setAddMenuOpen(addMenuOpen === 'item' ? null : 'item'); setAddItemSearch(''); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Item
          </button>
          {addMenuOpen === 'item' && (
            <div className="absolute top-full left-0 mt-1 min-w-[220px] rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shadow-lg z-50">
              <div className="px-2 py-1.5 border-b border-border/50 dark:border-dark-border/50">
                <input
                  type="text"
                  value={addItemSearch}
                  onChange={(e) => setAddItemSearch(e.target.value)}
                  placeholder="Search items..."
                  autoFocus
                  className="w-full px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto py-1">
              {(() => {
                const filtered = availableItems.filter((item) =>
                  item.label.toLowerCase().includes(addItemSearch.toLowerCase())
                );
                return filtered.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted italic">
                    {availableItems.length === 0 ? 'All items already added' : 'No matches'}
                  </p>
                ) : (
                  filtered.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.to}
                        onClick={() => handleAddItem(item.to)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })
                );
              })()}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(addMenuOpen === 'group' ? null : 'group')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Group
          </button>
          {addMenuOpen === 'group' && (
            <div className="absolute top-full left-0 mt-1 min-w-[220px] max-h-[280px] overflow-y-auto py-1 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shadow-lg z-50">
              {availableGroups.length > 0 && (
                <>
                  <p className="px-3 py-1 text-[9px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider">Preset Groups</p>
                  {availableGroups.map((group) => {
                    const GIcon = group.icon;
                    return (
                      <button
                        key={group.id}
                        onClick={() => handleAddGroup(group)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                      >
                        <GIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{group.label}</span>
                        <span className="ml-auto text-[9px] text-text-muted dark:text-dark-text-muted">{group.items.length}</span>
                      </button>
                    );
                  })}
                  <div className="h-px bg-border/50 dark:bg-dark-border/50 my-1" />
                </>
              )}
              {/* Custom groups from global config */}
              {config.customGroups.length > 0 && (
                <>
                  <div className="h-px bg-border/50 dark:bg-dark-border/50 my-1" />
                  <p className="px-3 py-1 text-[9px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider">Custom Groups</p>
                  {config.customGroups
                    .filter((g) => !usedGroupIds.has(g.id))
                    .map((group) => (
                      <button
                        key={group.id}
                        onClick={() => {
                          addZoneEntry(zoneId, { type: 'group', id: group.id, label: group.label, items: group.items });
                          setAddMenuOpen(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                      >
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-muted dark:text-dark-text-muted" />
                        <span className="truncate">{group.label}</span>
                        <span className="ml-auto text-[9px] text-text-muted dark:text-dark-text-muted">{group.items.length}</span>
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar Zone: Section Visibility, Ordering, Width ──────────────────

/** All section IDs available for adding — data sections + nav items (deduplicated) */
const ALL_ADDABLE_SECTION_IDS = [
  // Data sections from labels (exclude core — they're always present)
  ...Object.keys(SIDEBAR_SECTION_LABELS).filter((id) => !CORE_SECTION_IDS.has(id)),
  // Nav items — only those NOT already covered by a data section route
  ...ALL_NAV_ITEMS.map((item) => item.to).filter((path) => !DATA_SECTION_ROUTES.has(path)),
];

/** Group each addable section for the dropdown */
function getAddableSectionGroup(id: string): SidebarSectionGroup {
  return getGroup(id);
}

function SidebarZoneEditor() {
  const { config, getSidebarSections, addSidebarSection, removeSidebarSection, toggleSidebarSectionStyle, reorderSidebarSections, setSidebarWidth } = useLayoutConfig();
  const sections = getSidebarSections();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropTarget(e.clientY < midY ? i : i + 1);
  };

  const handleDragEnd = () => {
    if (dragIdx !== null && dropTarget !== null) {
      let insertAt = dropTarget;
      if (insertAt > dragIdx) insertAt -= 1;
      if (insertAt !== dragIdx) {
        const reordered = [...sections];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(insertAt, 0, moved!);
        const updated = reordered.map((s, idx) => ({ ...s, order: idx }));
        reorderSidebarSections(updated);
      }
    }
    setDragIdx(null);
    setDropTarget(null);
  };

  // Sections available to add (not already in config)
  const existingIds = new Set(sections.map((s) => s.id));
  const availableSections = ALL_ADDABLE_SECTION_IDS.filter((id) => !existingIds.has(id));

  // Group available sections for dropdown
  const groupedAvailable = availableSections.reduce<Record<string, string[]>>((acc, id) => {
    const group = getAddableSectionGroup(id);
    (acc[group] ??= []).push(id);
    return acc;
  }, {});

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 dark:bg-primary/5 p-4 space-y-4">
      <h3 className="text-sm font-medium text-primary">Sidebar</h3>
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Add or remove sections, drag to reorder. Core sections (Search, Customize) are always shown.
      </p>

      {/* Width selector */}
      <div className="space-y-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">Width (desktop only)</p>
        <div className="flex gap-1">
          {(Object.entries(SIDEBAR_WIDTH_VALUES) as [SidebarWidth, typeof SIDEBAR_WIDTH_VALUES[SidebarWidth]][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setSidebarWidth(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                config.sidebar.width === key
                  ? 'bg-primary text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary'
              }`}
            >
              {val.label}
              <span className="text-[9px] opacity-70">{val.px}px</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sections list */}
      <div className="space-y-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Sections ({sections.length})
        </p>

        <div className="space-y-1">
          {sections.map((section, i) => {
            const sectionLabel = getSectionLabel(section.id);
            const showLineBefore = dragIdx !== null && dropTarget === i && dropTarget !== dragIdx && dropTarget !== dragIdx + 1;
            const isCore = CORE_SECTION_IDS.has(section.id);
            const isFlat = section.style === 'flat';
            const SectionIcon = getSectionIcon(section.id);

            return (
              <div key={section.id}>
                {showLineBefore && (
                  <div className="h-0.5 bg-primary rounded-full mx-2 my-0.5" />
                )}
                <div
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-xs cursor-grab active:cursor-grabbing transition-opacity ${
                    dragIdx === i ? 'opacity-30' : ''
                  }`}
                >
                  <GripVertical className="w-3 h-3 shrink-0 text-text-muted dark:text-dark-text-muted" />
                  {SectionIcon && <SectionIcon className="w-3.5 h-3.5 shrink-0 text-text-secondary dark:text-dark-text-secondary" />}
                  <span className="flex-1 truncate text-text-primary dark:text-dark-text-primary">
                    {sectionLabel}
                  </span>
                  {isCore && (
                    <span className="text-[9px] text-text-muted dark:text-dark-text-muted uppercase">core</span>
                  )}
                  {/* Style toggle — available for all non-core sections */}
                  {!isCore && (
                    <button
                      onClick={() => toggleSidebarSectionStyle(section.id)}
                      className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                        isFlat
                          ? 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                          : 'text-primary hover:bg-primary/10'
                      }`}
                      title={isFlat ? 'Switch to accordion (show items)' : 'Switch to flat (link only)'}
                    >
                      {isFlat ? <Minus className="w-3.5 h-3.5" /> : <ListChecks className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  {/* Remove button — not shown for core sections */}
                  {!isCore && (
                    <button
                      onClick={() => removeSidebarSection(section.id)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-error/10 hover:text-error transition-colors text-text-muted dark:text-dark-text-muted"
                      title="Remove section"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Drop indicator line AFTER last item */}
                {i === sections.length - 1 && dragIdx !== null && dropTarget === sections.length && dropTarget !== dragIdx ? (
                  <div className="h-0.5 bg-primary rounded-full mx-2 my-0.5" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Section button + dropdown */}
      {availableSections.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Section
          </button>
          {addMenuOpen && (
            <div className="absolute top-full left-0 mt-1 min-w-[220px] max-h-[300px] overflow-y-auto py-1 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shadow-lg z-50">
              {Object.entries(groupedAvailable).map(([group, ids]) => (
                <div key={group}>
                  <p className="px-3 py-1 text-[9px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                    {SECTION_GROUP_LABELS[group as SidebarSectionGroup] ?? group}
                  </p>
                  {ids.map((id) => {
                    const Icon = getSectionIcon(id);
                    const label = getSectionLabel(id);
                    return (
                      <button
                        key={id}
                        onClick={() => { addSidebarSection(id); setAddMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                      >
                        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                  <div className="h-px bg-border/50 dark:bg-dark-border/50 my-0.5" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info note */}
      <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
        Changes apply instantly. Width setting only affects desktop layout.
      </p>
    </div>
  );
}

// ─── Content Zone: Page Layout Inspector ──────────────────

function ContentZoneEditor() {
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const pageLayout = selectedPage ? PAGE_LAYOUT_REGISTRY[selectedPage] : null;
  const activeSection = pageLayout?.sections.find((s) => s.id === selectedSection) ?? null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 dark:bg-primary/5 p-4 space-y-4">
      <h3 className="text-sm font-medium text-primary">Content Area — Page Layout Inspector</h3>
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Select a page to inspect its component layout.
      </p>

      {/* Page grid */}
      <div className="grid grid-cols-5 gap-1.5">
        {ALL_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const hasMapped = item.to in PAGE_LAYOUT_REGISTRY;
          const isSelected = selectedPage === item.to;
          return (
            <button
              key={item.to}
              onClick={() => {
                setSelectedPage(isSelected ? null : item.to);
                setSelectedSection(null);
              }}
              title={item.label + (hasMapped ? '' : ' (not mapped yet)')}
              className={`flex flex-col items-center gap-1 px-1 py-2 rounded-md text-[10px] transition-colors ${
                isSelected
                  ? 'bg-primary text-white'
                  : hasMapped
                    ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary'
                    : 'bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 text-text-muted dark:text-dark-text-muted opacity-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate w-full text-center">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Page layout wireframe */}
      {selectedPage && !pageLayout && (
        <div className="rounded-lg border border-border dark:border-dark-border p-4 text-center">
          <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
            Layout not mapped yet for this page.
          </p>
        </div>
      )}

      {pageLayout && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              {pageLayout.label} Layout
            </h4>
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              {pageLayout.file} ({pageLayout.totalLines} lines)
            </span>
          </div>

          {/* Section wireframe */}
          <div className="rounded-lg border border-border dark:border-dark-border overflow-hidden">
            {pageLayout.sections.map((section) => {
              const isActive = selectedSection === section.id;
              const lineCount = section.lines[1] - section.lines[0];
              return (
                <button
                  key={section.id}
                  onClick={() => setSelectedSection(isActive ? null : section.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors border-b last:border-b-0 border-border/50 dark:border-dark-border/50 ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  <span className="font-medium flex-1">{section.label}</span>
                  <span className="text-[9px] text-text-muted dark:text-dark-text-muted tabular-nums">
                    L{section.lines[0]}–{section.lines[1]}
                  </span>
                  <span className="text-[9px] text-text-muted dark:text-dark-text-muted">
                    {lineCount} lines
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Source panel */}
      {activeSection && (
        <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FileCode className="w-3.5 h-3.5 text-primary shrink-0" />
            <h4 className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              {activeSection.label}
            </h4>
          </div>
          <p className="text-[11px] text-text-muted dark:text-dark-text-muted">
            {activeSection.description}
          </p>
          <div className="text-[10px] font-mono text-text-secondary dark:text-dark-text-secondary space-y-0.5">
            <p>
              <span className="text-text-muted dark:text-dark-text-muted">File: </span>
              {activeSection.file}
            </p>
            <p>
              <span className="text-text-muted dark:text-dark-text-muted">Lines: </span>
              {activeSection.lines[0]}–{activeSection.lines[1]} ({activeSection.lines[1] - activeSection.lines[0]} lines)
            </p>
          </div>
          {activeSection.subComponents && activeSection.subComponents.length > 0 && (
            <div className="pt-1 border-t border-border/50 dark:border-dark-border/50">
              <p className="text-[10px] text-text-muted dark:text-dark-text-muted mb-1">Sub-components:</p>
              <div className="space-y-0.5">
                {activeSection.subComponents.map((sub) => (
                  <div key={sub.name} className="flex items-center gap-2 text-[10px] font-mono text-text-secondary dark:text-dark-text-secondary">
                    <span className="text-primary">{sub.name}</span>
                    <span className="text-text-muted dark:text-dark-text-muted">→</span>
                    <span className="truncate">{sub.file}</span>
                    <span className="text-text-muted dark:text-dark-text-muted shrink-0">({sub.lines}L)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
