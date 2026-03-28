# Roadmap: OwnPilot v1.0 Sidebar Overhaul

## Overview

This milestone transforms OwnPilot's chaotic 63-item collapsible sidebar into a clean, Cowork-inspired structural sidebar. The build follows a bottom-up order: foundation constants and hooks first, then sidebar shell extraction with Layout surgery, then the additive Customize page, and finally Playwright E2E coverage locking the full feature contract. The highest-risk step (Layout.tsx modification) is deliberately deferred to Phase 2 after all data-layer dependencies are verified.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Foundation** - Extract nav items, STORAGE_KEYS, usePinnedItems hook, localStorage migration, mobile sidebar contract
- [ ] **Phase 2: Sidebar Rebuild** - New Sidebar component, Recents section, pinned items rendering, Layout.tsx surgery
- [ ] **Phase 3: Customize Page** - /customize route, categorized grid, pin/unpin star toggle, search filter
- [ ] **Phase 4: Tests + Polish** - Playwright E2E suite, mobile regression, Docker build verify, typecheck gate

## Phase Details

### Phase 1: Foundation
**Goal**: The data layer and constants are in place — nav items are extracted to a shared constant, STORAGE_KEYS registry contains all new keys, localStorage migration handles existing users, and the mobile sidebar contract is defined before any UI is touched
**Depends on**: Nothing (first phase)
**Requirements**: INF-01, INF-02, INF-03, SB-05, SB-06, SB-07
**Success Criteria** (what must be TRUE):
  1. All nav items are importable from `constants/nav-items.ts` — both Sidebar and CustomizePage can import from the same source without circular dependency
  2. `STORAGE_KEYS.SIDEBAR_PINNED` and `STORAGE_KEYS.NAV_GROUPS` exist in the registry — no raw localStorage string literals in any new code
  3. A user who had `ownpilot_nav_groups` in their browser localStorage sees the sidebar load correctly on first run of the new code (old key read, new key written, old key cleared)
  4. Default pinned items (Chat, Dashboard, Customize) appear in the sidebar on first load for a brand-new user with no localStorage state
  5. Sidebar state (pinned items, section collapse) survives a full browser refresh
**Plans**: TBD

### Phase 2: Sidebar Rebuild
**Goal**: The old Layout.tsx aside block is replaced by a new Sidebar component — pinned items render in place of the 63-item collapsible list, the Recents section shows the 6 most recent conversations, and the mobile slide-in behavior is fully preserved
**Depends on**: Phase 1
**Requirements**: SB-01, SB-02, SB-03, SB-04
**Success Criteria** (what must be TRUE):
  1. The sidebar shows only pinned items (not the old 63-item collapsible groups) — clicking any pinned item navigates to its route
  2. The Customize link is always visible in the sidebar regardless of which items are pinned
  3. The Recents section shows up to 6 recent conversations — clicking a recent item loads that conversation
  4. On mobile (375px), the hamburger button opens the sidebar with the slide-in animation intact and the backdrop closes it
**Plans**: TBD
**UI hint**: yes

### Phase 3: Customize Page
**Goal**: A new /customize route delivers a categorized grid of all available pages — users can pin and unpin items via a star toggle, search filters the grid in real time, and changes immediately reflect in the sidebar on the next navigation
**Depends on**: Phase 2
**Requirements**: CZ-01, CZ-02, CZ-03, CZ-04, CZ-05
**Success Criteria** (what must be TRUE):
  1. Navigating to /customize shows all available pages grouped by category (Personal Data, AI & Automation, Tools & Extensions, System, Settings)
  2. Clicking the star toggle on any item pins it — navigating back to the sidebar shows it in the pinned list; clicking the star again unpins it and it disappears from the sidebar
  3. Typing in the search field instantly filters the grid to matching items by name (no API call, client-side only)
  4. When the pinned count reaches 15, attempting to pin another item shows a warning toast and the item is not added
**Plans**: TBD
**UI hint**: yes

### Phase 4: Tests + Polish
**Goal**: A Playwright E2E suite covers the full sidebar feature contract — every critical user flow has a passing test, TypeScript typecheck is clean, and a Docker build confirms all new Tailwind tokens are present in production CSS
**Depends on**: Phase 3
**Requirements**: TST-01, TST-02, TST-03, TST-04, TST-05, TST-06
**Success Criteria** (what must be TRUE):
  1. Playwright tests pass for: sidebar renders pinned items, pin/unpin from Customize page, Recents section shows conversations, mobile sidebar slide-in, Customize page grid and search
  2. `pnpm run typecheck` exits with zero errors across all packages
  3. Docker build completes and all new Tailwind utility classes appear in the production CSS output (grep verification)
  4. StatsPanel, MiniChat, MiniTerminal, and DebugDrawer all function correctly after the Layout.tsx refactor (regression checklist passes)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/TBD | Not started | - |
| 2. Sidebar Rebuild | 0/TBD | Not started | - |
| 3. Customize Page | 0/TBD | Not started | - |
| 4. Tests + Polish | 0/TBD | Not started | - |

---
*Roadmap created: 2026-03-27 — v1.0 Sidebar Overhaul*
*Last updated: 2026-03-27*
