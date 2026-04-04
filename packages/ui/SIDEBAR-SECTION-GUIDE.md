# Sidebar Section Developer Guide

## Architecture Overview

Every sidebar item is a **section** identified by an ID in `LayoutConfig.sidebar.sections[]`.
If a section is in the array, it's shown. If not, it's hidden. Users add/remove sections
via the ZoneEditor or Customize panel.

There are two rendering modes:

| Mode | Renders As | When |
|------|-----------|------|
| **flat** | Single nav link (icon + label) | Default for pages without item lists |
| **accordion** | Collapsible header + item list from API | When developer implements `fetchItems` |

**Default for new sections: `accordion`.** The style toggle is available for ALL non-core sections
in ZoneEditor. If accordion mode is set but no `fetchItems` exists in the registry, the section
renders as a flat link automatically.

---

## How Sections Work

### Section IDs

```
Built-in IDs:   'search', 'customize', 'workspaces', 'workflows', 'recents', ...
Nav item paths:  '/', '/dashboard', '/analytics', '/about', ...
```

Built-in IDs are defined in `SidebarSectionId` union (types/layout-config.ts).
Nav item paths (starting with `/`) are resolved via `NAV_ITEM_MAP` for icon and label.

### Rendering Flow

```
Sidebar.tsx receives visibleSections (sorted by order)
  │
  ├── isNavItemSection(id)?  → PinnedNavLink (simple nav link)
  │
  ├── SIDEBAR_DATA_SECTIONS[id] exists?  → SidebarDataSection (accordion/flat)
  │
  └── switch(id) for special cases:
        'search'     → search button
        'scheduled'  → NavLink to /calendar
        'customize'  → toggle button
        'recents'    → custom recents UI (search, filters, date groups)
```

### Key Files

| File | Role |
|------|------|
| `types/layout-config.ts` | Section types, defaults, labels, core IDs |
| `constants/sidebar-sections.ts` | Data section registry, icon/label/group resolvers |
| `hooks/useLayoutConfig.tsx` | Section CRUD (add/remove/reorder/style), localStorage persistence |
| `components/sidebar/SidebarDataSection.tsx` | Generic accordion/flat renderer |
| `components/Sidebar.tsx` | Section routing (which component renders which section) |
| `components/ZoneEditor.tsx` | Section management UI (drag, style toggle, add/remove) |

---

## Adding a New Section (Flat Link Only)

If your page doesn't need an item list in the sidebar, it's already supported.
Users can add it via ZoneEditor "+ Add Section" or Customize panel pin button.

The section ID is the nav item path (e.g., `/analytics`). No code changes needed.

---

## Adding Accordion Optimization (Recents-Style)

This is the guide for upgrading a section from flat link to accordion view
with API-backed item list — like Workspaces, Workflows, or Agents.

### Step 1: Add Registry Entry

**File:** `packages/ui/src/constants/sidebar-sections.ts`

Add an entry to `SIDEBAR_DATA_SECTIONS`:

```typescript
// In SIDEBAR_DATA_SECTIONS object:
'my-section': {
  id: 'my-section',
  icon: MyIcon,           // Lucide icon from components/icons.tsx
  route: '/my-section',   // Page route (must match nav-items.ts)
  group: 'personal',      // 'core' | 'data' | 'ai' | 'tools' | 'personal' | 'system'
  maxItems: 5,            // Max items shown in accordion
  showPlus: true,         // Show + button in accordion header
  fetchItems: () =>
    myApi.list().then((res) =>
      (res.items ?? []).slice(0, 5).map((item) => ({
        id: item.id,
        label: item.name,
        route: `/my-section/${item.id}`,
      }))
    ),
},
```

**`fetchItems` contract:**
- Returns `Promise<SidebarItem[]>` where `SidebarItem = { id: string, label: string, route: string }`
- Called lazily — only when section is visible AND in accordion mode AND expanded
- Must handle API errors gracefully (SidebarDataSection catches and shows empty)
- Slice to `maxItems` in the function (sidebar doesn't enforce this)

### Step 2: Add Section ID to Type Union

**File:** `packages/ui/src/types/layout-config.ts`

Add to `SidebarSectionId`:

```typescript
export type SidebarSectionId =
  | 'search'
  | 'customize'
  // ...existing...
  | 'my-section'  // <-- add here
```

### Step 3: Add Label

**File:** `packages/ui/src/types/layout-config.ts`

Add to `SIDEBAR_SECTION_LABELS`:

```typescript
export const SIDEBAR_SECTION_LABELS: Record<string, string> = {
  // ...existing...
  'my-section': 'My Section',
};
```

### Step 4: Add Default Style (Optional)

**File:** `packages/ui/src/types/layout-config.ts`

If you want the section to default to accordion when added:

```typescript
export const SECTION_DEFAULT_STYLES: Record<string, SidebarSectionStyle> = {
  // ...existing...
  'my-section': 'accordion',
};
```

### Step 5: Done

That's it. The section will:
- Appear in ZoneEditor "+ Add Section" dropdown under the correct group
- Render with accordion/flat toggle
- Lazy-fetch items only when expanded in accordion mode
- Show icon in ZoneEditor section list
- Support drag-to-reorder

**No changes needed in:** Sidebar.tsx, SidebarDataSection.tsx, ZoneEditor.tsx, useLayoutConfig.tsx

---

## Recents Pattern: Custom Accordion with Rich UI

The **Recents** section is the most advanced accordion implementation. It goes beyond
the generic `SidebarDataSection` by adding search, platform filters, date grouping,
inline editing, and delete confirmation. Use this as a reference for building
similarly complex sections.

### Why Recents is Special

| Feature | Generic SidebarDataSection | Recents |
|---------|---------------------------|---------|
| Data source | `fetchItems()` one-shot | `useSidebarRecents` hook (WebSocket + polling) |
| Search | No | Yes (inline text filter) |
| Filtering | No | Platform tabs (All, Web, WhatsApp, Telegram) |
| Grouping | No | Date groups (Today, Yesterday, This Week, Older) |
| Inline edit | No | Rename conversation in-place |
| Delete | No | Confirm dialog + delete API call |
| Active state | No | Highlights active conversation |
| Real-time | No | WebSocket updates for new messages |

### How to Build a Recents-Style Section

**1. Create a dedicated hook** (like `useSidebarRecents`):

```typescript
// hooks/useSidebarMySection.ts
export function useSidebarMySection() {
  const [items, setItems] = useState<MyItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Fetch on mount
  useEffect(() => {
    setIsLoading(true);
    myApi.list()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setIsLoading(false));
  }, []);

  // Filter by search
  const filtered = useMemo(() =>
    items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  // Group by category/date
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return { items: filtered, groups, search, setSearch, isLoading };
}
```

**2. Add a switch case in Sidebar.tsx:**

```typescript
// In Sidebar.tsx visibleSections.map() switch block:
case 'my-section':
  if (section.style === 'flat') {
    return (
      <div key="my-section">
        {divider}
        <button onClick={() => navigate('/my-section')} className="...">
          <MyIcon className="w-4 h-4 shrink-0" />
          <span>My Section</span>
        </button>
      </div>
    );
  }
  return (
    <div key="my-section">
      {divider}
      <div data-testid="sidebar-my-section">
        {/* Accordion header */}
        <div className="flex items-center px-3 py-1 gap-1.5">
          <button onClick={() => setCollapsed(prev => ({ ...prev, 'my-section': !prev['my-section'] }))}>
            <ChevronRight className={`w-[17px] h-[17px] ${!collapsed['my-section'] ? 'rotate-90' : ''}`} />
          </button>
          <button onClick={() => navigate('/my-section')} className="flex-1 text-left text-[15px] font-semibold uppercase">
            My Section
          </button>
        </div>
        {/* Search + items (when expanded) */}
        {!collapsed['my-section'] && (
          <>
            <input value={mySection.search} onChange={e => mySection.setSearch(e.target.value)} />
            {mySection.groups.map(group => (
              <div key={group.label}>
                <p className="text-[10px] uppercase">{group.label}</p>
                {group.items.map(item => (
                  <button key={item.id} onClick={() => navigate(item.route)}>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
```

**3. Do NOT add to SIDEBAR_DATA_SECTIONS registry** — custom sections with switch cases
bypass the generic renderer. The registry is for simple accordion sections only.

### Recents Implementation Reference

| Component | File | Lines |
|-----------|------|-------|
| Hook | `hooks/useSidebarRecents.ts` | ~230 lines |
| Sidebar render | `components/Sidebar.tsx` case 'recents' | ~100 lines |
| Flat fallback | Same file, `section.style === 'flat'` check | ~10 lines |
| API | `api/endpoints/chat.ts` | conversations list + delete + rename |

Key patterns from Recents:
- **Lazy loading**: Only fetches when accordion mode + expanded
- **WebSocket integration**: `useSidebarRecents` subscribes to WS for real-time updates
- **Date grouping**: Groups conversations by Today/Yesterday/This Week/Older
- **Platform tabs**: Filters by source (web, whatsapp, telegram)
- **Inline edit**: Click rename → input appears → blur/enter commits
- **Optimistic delete**: Confirm dialog → API call → remove from list

---

## Section Lifecycle

```
Developer adds registry entry (sidebar-sections.ts)
  ↓
User adds section via ZoneEditor "+ Add Section"
  ↓
addSidebarSection(id) → config.sidebar.sections.push({ id, order, style: 'accordion' })
  ↓
Sidebar.tsx renders: SIDEBAR_DATA_SECTIONS[id] → SidebarDataSection
  ↓
SidebarDataSection: accordion mode + expanded → fetchItems() → render list
  ↓
User toggles style in ZoneEditor → toggleSidebarSectionStyle(id)
  ↓
style: 'flat' → SidebarDataSection renders as single link (no API call)
```

## Checklist

- [ ] Registry entry in `sidebar-sections.ts` with fetchItems
- [ ] Section ID added to `SidebarSectionId` union
- [ ] Label in `SIDEBAR_SECTION_LABELS`
- [ ] (Optional) Default style in `SECTION_DEFAULT_STYLES`
- [ ] (Optional) Custom switch case in Sidebar.tsx for rich UI
- [ ] API endpoint exists and returns list data
- [ ] fetchItems handles errors gracefully
- [ ] Test: add section via ZoneEditor → accordion shows items
- [ ] Test: toggle to flat → shows single link, no API call
- [ ] Test: remove section → gone from sidebar
