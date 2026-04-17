# Architecture Research

**Domain:** React SPA sidebar overhaul — existing Layout.tsx extraction + new data-driven sections
**Researched:** 2026-03-27
**Confidence:** HIGH (based on direct codebase analysis, no external speculation)

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Layout.tsx (orchestrator)                     │
│                                                                       │
│  ┌────────────────┐   ┌──────────────────────────┐   ┌─────────────┐ │
│  │  <Sidebar />   │   │     <main> / <Outlet>    │   │ <StatsPanel>│ │
│  │  (extracted)   │   │   (unchanged — Outlet)   │   │ (unchanged) │ │
│  │                │   │                          │   │             │ │
│  │ SidebarHeader  │   │  SecurityBanner          │   │             │ │
│  │ SidebarNav     │   │  Page content (lazy)     │   │             │ │
│  │ SidebarFooter  │   │                          │   │             │ │
│  └────────┬───────┘   └──────────────────────────┘   └─────────────┘ │
│           │                                                           │
│  isMobileSidebarOpen, isStatsPanelCollapsed, badgeCounts stay here   │
└───────────┬──────────────────────────────────────────────────────────┘
            │
            │ props
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      Sidebar component                                 │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  SidebarHeader: [New Task/Chat] [Search] [Customize] [Scheduled]│   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  SidebarSection: Workflows  [+]                                 │   │
│  │    useSidebarWorkflows() → workflowsApi.list()                  │   │
│  │    WorkflowItem × N                                             │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  SidebarSection: Projects  [+]                                  │   │
│  │    useSidebarProjects() → fileWorkspacesApi.list()              │   │
│  │    ProjectItem × N                                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  SidebarSection: Recents                                        │   │
│  │    useSidebarRecents() → chatApi.listHistory({ limit: 8 })     │   │
│  │    RecentItem × N                                               │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  SidebarFooter: ConnectionIndicator, LogOut                     │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
            │
            │ navigate()
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│                   /customize route                                      │
│   CustomizePage: grid of ALL mainItems + navGroups items               │
│   Pin/unpin writes to localStorage (STORAGE_KEYS.SIDEBAR_PINNED)      │
│   No callback needed — sidebar reads same localStorage key             │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | New vs Modified |
|-----------|----------------|-----------------|
| `Layout.tsx` | Shell: 3-col layout, mobile state, badge state, WS wiring | **MODIFIED** (slimmed) |
| `Sidebar.tsx` | Renders all sidebar content; receives mobile/auth props | **NEW** (extracted) |
| `SidebarHeader.tsx` | Fixed top: New Chat, Search, Customize nav, Scheduled nav | **NEW** |
| `SidebarSection.tsx` | Generic section: label, [+] button, items list, empty state | **NEW** |
| `SidebarFooter.tsx` | Connection indicator, logout button | **NEW** (extracted from Layout) |
| `useSidebarWorkflows.ts` | Fetch workflows list, loading/error state | **NEW** |
| `useSidebarProjects.ts` | Fetch file workspaces list, loading/error state | **NEW** |
| `useSidebarRecents.ts` | Fetch recent conversations (limit 8), loading/error state | **NEW** |
| `CustomizePage.tsx` | Grid of all 63 items, pin/unpin to localStorage | **NEW** |
| `NavItemLink.tsx` | Individual nav link with active state | **KEPT** (move to Sidebar.tsx or its own file) |
| `CollapsibleGroup.tsx` | Old collapsible groups — **DELETED** after migration | **DELETED** |
| `StatsPanel.tsx` | Right panel stats — **UNTOUCHED** | UNCHANGED |
| `MiniChat`, `MiniTerminal`, `DebugDrawer` | Floating overlays — **UNTOUCHED** | UNCHANGED |

---

## Recommended Project Structure

```
packages/ui/src/
├── components/
│   ├── Layout.tsx                    # MODIFIED: delegates sidebar to <Sidebar />
│   ├── Sidebar.tsx                   # NEW: sidebar root component
│   ├── sidebar/                      # NEW: sidebar sub-components
│   │   ├── SidebarHeader.tsx         # Fixed top actions
│   │   ├── SidebarSection.tsx        # Generic section (Workflows/Projects/Recents)
│   │   └── SidebarFooter.tsx         # Connection + logout
│   └── ... (all other components unchanged)
│
├── hooks/
│   ├── useSidebarWorkflows.ts        # NEW: workflows fetch + state
│   ├── useSidebarProjects.ts         # NEW: projects fetch + state
│   ├── useSidebarRecents.ts          # NEW: recents fetch + state
│   └── ... (existing hooks unchanged)
│
├── constants/
│   └── storage-keys.ts              # ADD: SIDEBAR_PINNED key
│
└── pages/
    └── CustomizePage.tsx            # NEW: /customize grid page
```

### Structure Rationale

- **`sidebar/` subfolder:** Keeps Sidebar sub-components co-located without polluting the root `components/` directory. Sidebar.tsx imports from `./sidebar/`.
- **Hooks co-located in `hooks/`:** Follows existing pattern (`useChatStore`, `useAuth`). Each hook is a single file with one responsibility.
- **CustomizePage in `pages/`:** Follows existing page convention. All 40+ pages are lazy-loaded from `pages/` and registered in `App.tsx`.
- **No new context provider:** The sidebar data is sidebar-local. A dedicated `SidebarDataProvider` would be over-engineering for data only the sidebar consumes.

---

## Architectural Patterns

### Pattern 1: Layout.tsx Refactoring — Extract, Do Not Rewrite

**What:** Move the entire `<aside>` block (lines 405–487 in Layout.tsx) plus the mobile backdrop into a new `<Sidebar>` component. Layout.tsx passes `isMobileSidebarOpen`, `setIsMobileSidebarOpen`, and `isMobile` as props.

**When to use:** The sidebar section is a clear, self-contained region already. Extraction is safe and low-risk.

**Trade-offs:** Layout.tsx still holds `isMobileSidebarOpen` state because the mobile hamburger button (`Menu` icon) lives in the global header, which is also in Layout. Pushing that state down would require prop drilling in reverse or a context — neither is worth it for one boolean.

**What stays in Layout.tsx after extraction:**
- `isMobileSidebarOpen` state + `setIsMobileSidebarOpen`
- `isStatsPanelCollapsed` state
- `badgeCounts` state + `RealtimeBridge` (badge updates come via WebSocket)
- Global header JSX
- `<Sidebar>` usage
- Main content area / `<Outlet>`
- `<StatsPanel>` usage
- Floating overlays: `MiniChat`, `MiniTerminal`, `DebugDrawer`

**Example:**
```typescript
// Layout.tsx after extraction
<Sidebar
  isMobile={isMobile}
  isOpen={isMobileSidebarOpen}
  onClose={() => setIsMobileSidebarOpen(false)}
  wsStatus={wsStatus}
/>
```

---

### Pattern 2: Per-Section Data Hooks (not a SidebarDataProvider)

**What:** Three independent hooks — `useSidebarWorkflows`, `useSidebarProjects`, `useSidebarRecents` — each called inside their respective section or in `Sidebar.tsx`.

**When to use:** Data is consumed in one place (the sidebar). No other component in the app needs live workflow/project/recents lists at the sidebar level.

**Trade-offs:**
- Three separate API calls on mount. This is fine — each is a lightweight list query. Parallel execution by React means no waterfall.
- A `SidebarDataProvider` would only pay off if the same data were needed outside the sidebar (it is not in this milestone).

**Hook shape (all three follow same pattern):**
```typescript
// hooks/useSidebarWorkflows.ts
export function useSidebarWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    workflowsApi.list({ limit: '20' })
      .then(res => { if (!cancelled) setWorkflows(res.data ?? []); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { workflows, isLoading, error };
}
```

**Why not SWR or React Query:** The project has no SWR/React Query dependency. Adding one for three sidebar fetch calls is disproportionate. The hooks above are 15 lines each, cancellation-safe, and match the existing codebase pattern (see `ConversationSidebar.tsx` lines 1–50 for precedent).

---

### Pattern 3: Customize Page — localStorage Communication, No Callback

**What:** `/customize` is a standalone page. It reads/writes a `STORAGE_KEYS.SIDEBAR_PINNED` localStorage key (a `string[]` of pinned route paths). The sidebar reads the same key on mount.

**When to use:** Cross-component state that does not need real-time reactivity within a single session. The user navigates to /customize, pins items, navigates back — sidebar re-renders on route change and reads updated localStorage.

**Trade-offs:**
- No real-time pin/unpin preview while on the customize page (acceptable for v1.0).
- If real-time preview is needed later, `useSyncExternalStore` with a storage event listener is a clean upgrade path.

**Data flow:**
```
CustomizePage
  writes: localStorage.setItem(STORAGE_KEYS.SIDEBAR_PINNED, JSON.stringify(['/', '/workflows', ...]))

Sidebar (on mount or route change)
  reads: localStorage.getItem(STORAGE_KEYS.SIDEBAR_PINNED)
  derives: pinnedItems[] → shown in SidebarHeader area or as top section
```

**No prop or callback between CustomizePage and Sidebar.** They communicate through shared localStorage, consistent with how `openGroups` is currently persisted in Layout.tsx (line 346).

---

### Pattern 4: SidebarSection — Generic, Reusable

**What:** One generic section component handles Workflows, Projects, and Recents. It accepts a title, items array, loading/error state, optional `onAdd` handler, and a render-item function.

**When to use:** All three sections follow the same visual pattern: header row with label + optional [+] button, list of items, loading spinner, empty state.

**Example:**
```typescript
<SidebarSection
  title="Workflows"
  items={workflows}
  isLoading={isLoadingWorkflows}
  onAdd={() => navigate('/workflows/new')}
  renderItem={(wf) => (
    <NavLink to={`/workflows/${wf.id}`}>{wf.name}</NavLink>
  )}
/>
```

---

## Data Flow

### Sidebar Initialization Flow

```
Layout mounts
  → Sidebar mounts (receives isMobile, wsStatus props)
    → SidebarHeader mounts (static — no data fetch)
    → SidebarSection "Workflows" mounts
        → useSidebarWorkflows() fires workflowsApi.list()  ─┐
    → SidebarSection "Projects" mounts                       ├─ parallel
        → useSidebarProjects() fires fileWorkspacesApi.list() ─┤
    → SidebarSection "Recents" mounts                        │
        → useSidebarRecents() fires chatApi.listHistory()   ─┘
          (limit: 8, offset: 0)
    → SidebarFooter mounts (reads wsStatus prop — no fetch)
```

### Customize Flow

```
User clicks [Customize] in SidebarHeader
  → navigate('/customize')
  → CustomizePage renders grid of ALL nav items (from imported constants)
  → User clicks pin/unpin on item
  → CustomizePage writes to localStorage[STORAGE_KEYS.SIDEBAR_PINNED]
  → User navigates back (browser back or close button on page)
  → Sidebar re-mounts (route change triggers layout re-render)
  → Sidebar reads localStorage[STORAGE_KEYS.SIDEBAR_PINNED] on init
  → Pinned items shown in sidebar
```

### Badge / WebSocket Flow (unchanged)

```
RealtimeBridge (in Layout.tsx — UNCHANGED)
  → receives WS events → calls onBadgeUpdate()
  → Layout state badgeCounts updates
  → Currently passed to NavItemLink for /inbox and /tasks badges
  → After refactor: pass badgeCounts down as prop to Sidebar if needed
```

---

## Integration Points with Existing Layout.tsx

### What Moves Out (extraction target)

| Code in Layout.tsx | Moves To |
|--------------------|----------|
| `<aside>` JSX block (lines 405–487) | `Sidebar.tsx` |
| Mobile backdrop `<div>` (lines 397–403) | `Sidebar.tsx` |
| `NavItemLink` function component | `Sidebar.tsx` (or `sidebar/NavItemLink.tsx`) |
| `CollapsibleGroup` function component | **DELETED** |
| `ConnectionIndicator` function component | `SidebarFooter.tsx` |
| `mainItems`, `navGroups`, `bottomItems` constants | `CustomizePage.tsx` imports them; Sidebar no longer uses navGroups |
| `openGroups` state + `toggleGroup()` | **DELETED** (replaced by section-level expand state) |
| `getInitialOpenGroups()` | **DELETED** |
| localStorage key `'ownpilot_nav_groups'` | **DEPRECATED** (add new key to STORAGE_KEYS) |

### What Stays in Layout.tsx

| Code | Reason |
|------|--------|
| `isMobileSidebarOpen` state | Hamburger `<Menu>` button lives in global header, also in Layout |
| `isStatsPanelCollapsed` state | StatsPanel toggle button is in StatsPanel, passed up via `onToggle` |
| `badgeCounts` state + `handleBadgeUpdate` | `RealtimeBridge` is a sibling of Sidebar in Layout JSX |
| `<RealtimeBridge>` | WS badge wiring — no reason to move |
| Global `<header>` JSX | Contains PulseSlotGrid, MiniPomodoro, WS dot — unrelated to sidebar |
| `<MiniChat>`, `<MiniTerminal>`, `<DebugDrawer>` | Floating overlays, independent of sidebar |

### New Prop Interface for Sidebar

```typescript
interface SidebarProps {
  isMobile: boolean;
  isOpen: boolean;           // = isMobileSidebarOpen in Layout
  onClose: () => void;       // = () => setIsMobileSidebarOpen(false)
  wsStatus: ConnectionStatus; // passed through to SidebarFooter
}
```

### App.tsx Change

Add one lazy-loaded route for the customize page:

```typescript
const CustomizePage = lazy(() =>
  import('./pages/CustomizePage').then((m) => ({ default: m.CustomizePage }))
);

// In <Routes>:
<Route path="/customize" element={<CustomizePage />} />
```

### STORAGE_KEYS Change

```typescript
export const STORAGE_KEYS = {
  // ... existing keys ...
  SIDEBAR_PINNED: 'ownpilot-sidebar-pinned',      // string[] of pinned route paths
  NAV_GROUPS: 'ownpilot_nav_groups',              // keep for migration compat, can prune later
} as const;
```

---

## Mobile Sidebar Preservation

The mobile sidebar behavior is entirely driven by:
1. `isMobile` from `useIsMobile()` (media query hook)
2. `isMobileSidebarOpen` boolean state in Layout
3. CSS: `fixed inset-y-0 left-0 z-40 w-64 transform transition-transform` + `translate-x-0` / `-translate-x-full`
4. Backdrop overlay div with `z-30`
5. Close-on-navigate `useEffect` (lines 317–319 in Layout.tsx)

**All five of these are preserved exactly:**
- `isMobile` and `isMobileSidebarOpen` stay in Layout.tsx
- Sidebar receives `isMobile` and `isOpen` as props
- The CSS classes are applied in Sidebar.tsx based on `isMobile` and `isOpen` props (identical logic, just moved)
- The backdrop div moves into Sidebar.tsx alongside the `<aside>`
- The close-on-navigate `useEffect` stays in Layout.tsx where `location` is already consumed

---

## Build Order

Build bottom-up: data layer first, then UI components, then integration.

```
Step 1: Data hooks (no UI, independently testable)
  → useSidebarWorkflows.ts
  → useSidebarProjects.ts
  → useSidebarRecents.ts
  Verify: TypeScript compiles, hooks return expected shapes

Step 2: STORAGE_KEYS update
  → Add SIDEBAR_PINNED to constants/storage-keys.ts
  Verify: No TS errors

Step 3: SidebarSection (generic, no real data needed — test with mock)
  → components/sidebar/SidebarSection.tsx
  Verify: Renders items, loading spinner, empty state

Step 4: SidebarHeader (static — no data fetch)
  → components/sidebar/SidebarHeader.tsx
  Verify: Buttons render, Customize navigates to /customize

Step 5: SidebarFooter (receives wsStatus prop)
  → components/sidebar/SidebarFooter.tsx (extracted from Layout's ConnectionIndicator)
  Verify: Matches existing visual, logout works

Step 6: Sidebar.tsx (assembles header + 3 sections + footer)
  → Calls the 3 hooks, composes sections
  → Receives isMobile/isOpen/onClose/wsStatus props
  Verify: Compiles, sections render with loading states

Step 7: Layout.tsx refactor (swap <aside> for <Sidebar />)
  → Delete CollapsibleGroup, openGroups, navGroups usage
  → Add <Sidebar> import and JSX
  Verify: pnpm typecheck passes, dev server loads, mobile toggle works

Step 8: CustomizePage.tsx (new route)
  → Grid of all nav items, pin/unpin localStorage
  → Register in App.tsx
  Verify: /customize route loads, pinning persists

Step 9: Wire pinned items into Sidebar
  → Sidebar reads SIDEBAR_PINNED on init
  → Pinned items render in header section or top of nav
  Verify: Pin in /customize → navigate back → item appears in sidebar
```

**Rationale for this order:**
- Steps 1–2 have zero UI dependencies and can be verified with typecheck alone
- Steps 3–5 are leaf components (no children to worry about)
- Step 6 assembles leaves — all dependencies already exist
- Step 7 is the highest-risk step (modifying Layout.tsx) and is deferred until all pieces are ready and verified
- Steps 8–9 are additive (new route + localStorage wiring) — no risk to existing functionality

---

## Anti-Patterns

### Anti-Pattern 1: SidebarDataProvider Context

**What people do:** Create a React context that fetches all sidebar data (workflows, projects, recents) in one provider, wrap Layout with it.

**Why it's wrong:** The data is only consumed in the sidebar. A context adds indirection (Provider → consumer → render) for no benefit. It also makes the data lifecycle harder to reason about — the provider must know about all three endpoints and their combined loading state.

**Do this instead:** Three separate hooks called directly in Sidebar.tsx or in each SidebarSection. Independent loading states = granular loading indicators per section.

---

### Anti-Pattern 2: Deriving Nav Items from Routes

**What people do:** Generate sidebar items by introspecting `App.tsx` route definitions rather than maintaining a `constants/nav-items.ts` file.

**Why it's wrong:** Not every route is a nav item (e.g., `/workflows/:id` editor, `/wizards/:id`, `/chat/history/:id`). Routes and nav items have different concerns. The `CustomizePage` needs the full item list (with icons and labels) which routes do not carry.

**Do this instead:** Keep nav item constants. Move `mainItems`, `navGroups`, `bottomItems` from Layout.tsx to a shared `constants/nav-items.ts` so both Sidebar.tsx and CustomizePage.tsx can import them without circular dependency.

---

### Anti-Pattern 3: Modifying Layout.tsx In-Place Without Extraction

**What people do:** Add the new sidebar JSX directly into the existing `<aside>` block in Layout.tsx, growing it from 519 lines to 700+.

**Why it's wrong:** Layout.tsx already does too much. Adding data fetching hooks (`useSidebarWorkflows` etc.) directly in Layout makes it a god component responsible for routing, layout, WebSocket state, badge state, mobile state, AND sidebar data. Testing becomes impossible.

**Do this instead:** Extract `<Sidebar>` first (Step 7), then add new sections inside Sidebar.tsx. Layout.tsx should not know about workflows, projects, or recents.

---

### Anti-Pattern 4: SWR/React Query for Three Sidebar Calls

**What people do:** Add a heavy caching library to handle sidebar data freshness.

**Why it's wrong:** The sidebar data (workflows, projects, recents) is fetched once on mount. There is no polling, invalidation, or cross-component sharing requirement in v1.0. Adding SWR/React Query introduces a 25–45 KB dependency and a new mental model for three `useEffect` calls that are already 15 lines each.

**Do this instead:** Simple `useState` + `useEffect` with cancellation token (see Pattern 2 above). If stale-while-revalidate becomes a real need in v2.0, migrate then.

---

## Scaling Considerations

| Scale | Adjustment |
|-------|------------|
| Current (63 items, 3 API sections) | Single Sidebar component, 3 independent hooks — sufficient |
| v1.5 (pinned items reordering, drag-drop) | Add `useSyncExternalStore` + storage event for real-time pin sync between CustomizePage and Sidebar |
| v2.0 (context chat panel in right sidebar) | Extract Layout's column logic into `AppShell.tsx`; columns become configurable props |
| If sidebar data needs real-time updates | Add WS subscription in hooks (reuse `useGateway().subscribe()` pattern from RealtimeBridge.tsx) |

---

## Sources

- Direct analysis of `/home/ayaz/ownpilot/packages/ui/src/components/Layout.tsx` (519 lines, read in full)
- Direct analysis of `constants/storage-keys.ts`, `hooks/useAuth.tsx`, `hooks/useChatStore.tsx`
- Direct analysis of `api/endpoints/workflows.ts`, `api/endpoints/chat.ts`, `api/endpoints/misc.ts` (fileWorkspacesApi)
- Existing pattern reference: `ConversationSidebar.tsx` (useState+useEffect fetch pattern without external library)
- Wireframe analysis: `~/Downloads/Ekran Resmi 2026-03-28 11.42.21.png` (4 fixed top buttons, Workflows+, Projects+, Recents sections)
- PROJECT.md milestone context: milestone constraints (mobile preserved, StatsPanel/MiniChat/MiniTerminal/DebugDrawer untouched)

---

*Architecture research for: OwnPilot Sidebar Overhaul — Layout.tsx extraction and new data-driven sections*
*Researched: 2026-03-27*
