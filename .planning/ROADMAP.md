# Roadmap: OwnPilot UI Redesign

## Milestone v1.0: Sidebar Overhaul (COMPLETED 2026-03-28)

Transformed 63-item chaotic sidebar into Cowork-inspired structural sidebar with Customize page.

- [x] **Phase 1: Foundation** — nav-items.ts, STORAGE_KEYS, usePinnedItems hook (completed 2026-03-28)
- [x] **Phase 2: Sidebar Rebuild** — Sidebar.tsx, useSidebarRecents, Layout.tsx surgery (completed 2026-03-28)
- [x] **Phase 3: Customize Page** — CustomizePage.tsx, nav-descriptions.ts, /customize route (completed 2026-03-28)
- [x] **Phase 4: Tests** — Playwright E2E 15/15 PASS, PinnedItemsContext fix (completed 2026-03-28)

---

## Milestone v1.1: Advanced UI — 2-Tab Customize + Search + Local Files

**Goal:** Evolve CustomizePage from a flat card grid into a Cowork-style 2-tab panel system (Items + Local Files), add global search overlay with Ctrl+K, expand sidebar with Workflows/Projects sections, and integrate host filesystem browsing.

**Reference:** HTML prototype at `~/ownpilot-ui-prototype.html`

**Phase Numbering:**
- Integer phases (5, 6, 7...): Planned milestone work
- Decimal phases (5.1): Urgent insertions

## Phases

- [ ] **Phase 5: Sidebar Enhancement** — Search button, Scheduled link, Workflows [+] section, Projects [+] section, sidebar width 240px
- [ ] **Phase 6: Customize 2-Tab Restructure** — Items tab with collapsible groups + pin buttons, Local Files tab placeholder, search + pin counter footer
- [ ] **Phase 7: Detail Panel** — CustomizeDetailPanel in right panel when /customize active, item selection → detail view, pin/unpin/navigate actions
- [ ] **Phase 8: Global Search Overlay** — Ctrl+K overlay, search across pages/workflows/conversations, grouped results, click-to-navigate
- [ ] **Phase 9: Local Files Tab** — Host filesystem tree via File API, Nautilus-style bookmarks, Edge Devices section, machine profiles, file detail view
- [ ] **Phase 10: E2E Tests + Polish** — Playwright full suite, mobile regression, Docker build verify, typecheck gate

## Phase Details

### Phase 5: Sidebar Enhancement
**Goal**: Sidebar gets Search button (opens overlay), Scheduled link, dynamic Workflows section with last 5 workflows, dynamic Projects section with workspaces, wider layout (240px)
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: SIDE-01 through SIDE-05
**Success Criteria**:
  1. Search button visible in sidebar, clicking triggers onSearchOpen callback
  2. Scheduled link navigates to /calendar
  3. Projects section shows workspaces from API with [+] button
  4. Workflows section shows last 5 workflows from API with [+] button
  5. Sidebar width is 240px (w-60)
**Plans**: TBD

### Phase 6: Customize 2-Tab Restructure
**Goal**: CustomizePage transforms from full-page card grid into a 2-tab panel: Items tab (collapsible group list with separate pin buttons per item) + Local Files tab (placeholder). Groups collapse/expand with state persisted to localStorage
**Depends on**: Phase 5
**Requirements**: CUST-01 through CUST-06
**Success Criteria**:
  1. Two tabs visible: "Items" and "Local Files"
  2. Items tab shows all 56 items in collapsible groups matching nav-items.ts navGroups structure
  3. Each group header clicks to collapse/expand, state persists across page refresh
  4. Each item row has a separate pin button (hover-visible, pinned=always-visible)
  5. Item click selects it (distinct from pin toggle), pin button click pins/unpins
  6. Search bar filters across all groups, pin counter in footer
**Plans**: TBD

### Phase 7: Detail Panel
**Goal**: When /customize route is active, Layout.tsx replaces StatsPanel with CustomizeDetailPanel. Selecting an item in the Items tab shows its detail (icon, title, description, route, pin/unpin button, Navigate button, Show in Files button)
**Depends on**: Phase 6
**Requirements**: DET-01 through DET-04
**Success Criteria**:
  1. On /customize route, right panel shows CustomizeDetailPanel instead of StatsPanel
  2. Clicking any item in Items tab shows its detail in the right panel
  3. Pin/Unpin button in detail panel works (syncs with sidebar via PinnedItemsContext)
  4. "Open Page" button navigates to the item's route
  5. Empty state "Select an item to see details" when nothing selected
**Plans**: TBD

### Phase 8: Global Search Overlay
**Goal**: A full-screen search overlay triggered by sidebar Search button or Ctrl+K/Cmd+K, searches across pages (ALL_NAV_ITEMS), workflows (workflowsApi), conversations (chatApi.listHistory). Results grouped by category, click navigates to result
**Depends on**: Phase 5
**Requirements**: SRCH-01 through SRCH-05
**Success Criteria**:
  1. Clicking Search in sidebar opens overlay
  2. Ctrl+K / Cmd+K keyboard shortcut opens overlay
  3. ESC or backdrop click closes overlay
  4. Typing filters results across pages, workflows, conversations in real time
  5. Clicking a result navigates to that route and closes overlay
**Plans**: TBD

### Phase 9: Local Files Tab
**Goal**: The "Local Files" tab in Customize panel becomes a full filesystem browser. Uses File Workspace API to browse /host-home mount. Nautilus-style bookmarks (Home, Downloads, Projects...), Edge Devices clickable header, machine profiles (ayaz@IP), file detail in right panel on click
**Depends on**: Phase 7
**Requirements**: FILE-01 through FILE-06
**Success Criteria**:
  1. Local Files tab shows bookmark list matching Nautilus sidebar
  2. Clicking a bookmark expands inline as a drawer showing directory contents
  3. Subdirectories expand recursively with arrow toggle
  4. Clicking a file shows detail in right panel (name, path, size, type, preview placeholder)
  5. Edge Devices header is clickable — shows edge devices overview in detail panel
  6. Directory open/close state persists to localStorage
**Plans**: TBD

### Phase 10: E2E Tests + Polish
**Goal**: Full Playwright E2E suite covering all new features. Mobile regression. Docker build verification. TypeScript clean
**Depends on**: Phase 9
**Requirements**: TST-07 through TST-12
**Success Criteria**:
  1. Playwright tests pass for: sidebar enhancements, 2-tab customize, detail panel, search overlay, local files, mobile
  2. pnpm run typecheck exits clean
  3. Docker build produces correct CSS
  4. No regression in StatsPanel, MiniChat, MiniTerminal, DebugDrawer
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 5. Sidebar Enhancement | 0/TBD | Not started | - |
| 6. Customize 2-Tab | 0/TBD | Not started | - |
| 7. Detail Panel | 0/TBD | Not started | - |
| 8. Global Search | 0/TBD | Not started | - |
| 9. Local Files Tab | 0/TBD | Not started | - |
| 10. E2E Tests + Polish | 0/TBD | Not started | - |

---
*Roadmap created: 2026-03-28 — v1.0 complete*
*Updated: 2026-03-29 — v1.1 milestone started (6 phases)*
