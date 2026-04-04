# Project Research Summary

**Project:** OwnPilot Sidebar Overhaul — Cowork-style structural sidebar
**Domain:** React 19 SPA sidebar redesign on existing production app
**Researched:** 2026-03-27
**Confidence:** HIGH

## Executive Summary

This milestone replaces OwnPilot's existing 519-line Layout.tsx god component (63 nav items in collapsible groups) with a Cowork-inspired structural sidebar: fixed top actions (New Chat, Search, Customize, Scheduled), three API-driven dynamic sections (Workflows, Projects, Recents), and a new /customize page for pin/unpin navigation item management. The existing tech stack (React 19, Vite 7, Tailwind 4, react-router-dom v7) requires zero new production dependencies — only `@playwright/test` is added as a dev dependency for E2E coverage. All patterns map to established React idioms already present in the codebase.

The recommended approach is a bottom-up extraction: first establish the data layer (three independent fetch hooks + localStorage constants), then build leaf UI components (SidebarHeader, SidebarSection, SidebarFooter), then assemble into a Sidebar.tsx root, and only then swap Layout.tsx's `<aside>` for the new `<Sidebar>` component. The highest-risk step (Layout.tsx modification) is intentionally deferred to late in the build order so all dependencies are verified before touching the component that orchestrates the entire app shell. A parallel /customize page is additive (new route) and carries zero regression risk to existing pages.

The three critical risks to mitigate up front are: (1) mobile sidebar slide animation breaking when inner scroll containers are added — keep `<aside>` as the sole CSS transform target; (2) API waterfall creating a 600ms+ sidebar load when three data sources fetch sequentially — use Promise.all in a single parent hook; (3) NavLink active state becoming ambiguous for dynamic routes like /workflows/:id — compute parent section active state manually via `location.pathname.startsWith()` and use `end` prop on all leaf NavLinks. Establishing these contracts in Phase 1 prevents expensive rewrites in later phases.

---

## Key Findings

### Recommended Stack

The production stack is fully locked and no changes are needed beyond one devDependency. React 19.2.4, Vite 7.3.1, Tailwind 4.2.1, TypeScript 5.9.3, react-router-dom 7.13.1, and lucide-react 0.577.0 all support this milestone without upgrade. A critical discovery: `package.json` already shows `react-router-dom@^7.13.1` — the PROJECT.md context that implied v6 was outdated. This eliminates any migration concern.

The only addition recommended is `@playwright/test@^1.50.0` as a devDependency. This provides Chromium-based E2E testing with Vite's built-in `webServer` integration, zero Playwright plugin needed. The full browser suite is not required — only `npx playwright install chromium`.

See `.planning/research/STACK.md` for full version compatibility matrix and configuration patterns.

**Core technologies:**
- React 19.2.4 + react-router-dom 7.13.1: SPA routing and NavLink active state — already installed, v7 confirmed
- Tailwind 4.2.1: All CSS-first, tokens in `index.css @theme` block — already installed, no new config files
- `useState + useEffect`: Sidebar data fetching pattern — 15 lines per hook, cancellation-safe, no SWR/TanStack Query needed
- `@playwright/test@^1.50.0`: E2E test coverage — only new dependency, devDependency only
- `Array.filter + String.includes`: /customize page search — zero dependency, sufficient for 63 static items
- CSS `transition-transform`: Mobile slide animation — no Framer Motion needed, GPU compositor thread

**Explicitly not adding:** Framer Motion, SWR, TanStack Query, Fuse.js, @headlessui/react, React.Activity

### Expected Features

The feature set is anchored to the wireframe and Cowork reference screenshot. All APIs required (workflowsApi, workspacesApi, chatApi) already exist. The only missing pieces are a new route, a new page, a new hook, and a new constant.

See `.planning/research/FEATURES.md` for full behavior specifications per section.

**Must have (table stakes — v1.0):**
- New Task/Chat button — navigates to `/`, clears conversation state
- Search button — navigates to `/history?search=` (MVP), full overlay deferred
- Customize button — navigates to `/customize` (arrow icon, must create route + page)
- Scheduled item — navigates to `/tasks` (no schema work in scope)
- Workflows section — `workflowsApi.list()`, collapsible, [+] navigates to /workflows
- Projects section — `workspacesApi.list()`, collapsible, [+] inline name input
- Recents section — `chatApi.listHistory({ limit: 6 })`, always expanded, "See all" link
- /customize page — categorized grid of all 63 nav items, pin/unpin to localStorage
- usePinnedItems hook — localStorage key `ownpilot-sidebar-pinned`, default `["/", "/customize"]`, max 15
- Sidebar pinned items rendering — reads same localStorage key on mount/route change
- Section collapse state in localStorage — Workflows and Projects only, Recents always open
- Playwright E2E suite — mock API routes, role-based locators, data-testid attributes

**Should have (competitive differentiators — v1.x, after launch validation):**
- Recents auto-refresh after new conversation is created (WebSocket event confirmation needed)
- Search overlay with cross-type results (conversations + workflows + workspaces)
- Workflow quick-run status indicator in sidebar item

**Defer (v2+):**
- Drag-drop reordering in /customize (dnd-kit evaluation needed, touch UX testing needed)
- Global cmd+K command palette (full search milestone)
- Scheduled tasks as first-class page with recurrence schema work
- Workflow quick-run from sidebar hover

**Anti-features (do not build):** inline forms in sidebar, infinite recents scroll, sidebar search that filters items in place, real-time count badges on sections

### Architecture Approach

The architecture follows a clean extraction pattern: Layout.tsx delegates its entire `<aside>` block to a new `<Sidebar>` component, which assembles sub-components from a `components/sidebar/` directory. Three independent per-section data hooks are called in Sidebar.tsx (not in a shared provider context) — this gives independent loading states per section with no data waterfall. The /customize page communicates with the sidebar via shared localStorage (no callback, no prop drilling) — sidebar reads on re-mount after route change. This is the same pattern already used by `ownpilot_nav_groups` in the existing codebase.

See `.planning/research/ARCHITECTURE.md` for the full component tree diagram and 9-step build order.

**Major components:**
1. `Layout.tsx` (modified) — shell: keeps isMobileSidebarOpen, badgeCounts, wsStatus, stats panel state; delegates sidebar JSX to `<Sidebar>`
2. `Sidebar.tsx` (new) — sidebar root: assembles SidebarHeader + 3 SidebarSections + SidebarFooter; calls 3 data hooks
3. `components/sidebar/SidebarHeader.tsx` (new) — fixed top: New Chat, Search, Customize, Scheduled buttons
4. `components/sidebar/SidebarSection.tsx` (new, generic) — reusable section with title, [+], items list, loading/empty state
5. `components/sidebar/SidebarFooter.tsx` (new, extracted) — connection indicator + logout
6. `hooks/useSidebarWorkflows.ts` / `useSidebarProjects.ts` / `useSidebarRecents.ts` (new) — 15-line hooks, cancellation-safe, useState+useEffect
7. `pages/CustomizePage.tsx` (new) — /customize grid with pin/unpin, reads/writes `STORAGE_KEYS.SIDEBAR_PINNED`
8. `constants/nav-items.ts` (new, extracted from Layout.tsx) — shared `ALL_NAV_ITEMS` flat array for both Sidebar and CustomizePage
9. `constants/storage-keys.ts` (modified) — add `SIDEBAR_PINNED` key; migrate `ownpilot_nav_groups` users on first load

**Deleted after migration:** CollapsibleGroup component, openGroups state, getInitialOpenGroups(), `ownpilot_nav_groups` localStorage key (after migration)

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for all 8 pitfalls with recovery strategies and a "Looks Done But Isn't" checklist.

1. **Mobile sidebar breaks when inner scroll containers are added** — Keep `<aside>` as the sole CSS transform target. Never add `position: fixed` children inside sidebar. Test mobile slide at 375px width after every structural change in Phase 1.

2. **localStorage migration gap for existing `ownpilot_nav_groups` users** — Add both old and new keys to STORAGE_KEYS before any state is written. Write one-time migration function: read old key, write new key, delete old, guard with `ownpilot_sidebar_migrated_v1`. Wrap all localStorage reads in try-catch.

3. **API waterfall making sidebar load 3x slower than necessary** — Fire all three fetches in parallel with Promise.all from a single `useSidebarData` hook or from Sidebar.tsx's top-level effect. Design this contract in Phase 2 before implementing any individual section.

4. **NavLink active state ambiguity for dynamic routes** — Section headers (Workflows, Projects): compute active state via `location.pathname.startsWith()`, not NavLink's default prefix match. Leaf items: always add `end` prop for exact match. Never rely on NavLink for parent-section highlighting.

5. **Tailwind 4 custom tokens missing from production builds** — All new design tokens go inside the existing `@theme` block in `index.css` only. Verify in Docker build output: `grep 'new-class-name' packages/ui/dist/assets/*.css`. No separate token files, no `tailwind.config.js`.

6. **StatsPanel state migrating to wrong owner during Layout refactor** — `isMobileSidebarOpen` moves into Sidebar; `isStatsPanelCollapsed`, `badgeCounts`, and `RealtimeBridge` stay in Layout.tsx. Define ownership mapping explicitly before extraction (Phase 1).

7. **Playwright test flakiness from SPA timing** — Always combine `waitForURL` + content assertion. Mock all three sidebar API routes before each test. Use `page.getByRole()` and `data-testid` attributes. Never use `waitForTimeout()`.

---

## Implications for Roadmap

Based on research, a 4-phase structure is recommended. Dependencies flow clearly: data layer must precede UI components, UI components must precede Layout surgery, Layout surgery must precede E2E coverage. The /customize page is additive and can be parallelized with Phase 3 if desired.

### Phase 1: Sidebar Shell Foundation
**Rationale:** Highest-risk architectural decisions must be settled before any feature work. This phase defines the component boundary, state ownership contract, and localStorage migration — the three areas where mistakes in later phases are most expensive to unwind.
**Delivers:** New `<Sidebar>` component successfully rendering inside Layout.tsx with existing nav items intact (no functional regression). STORAGE_KEYS updated with SIDEBAR_PINNED. localStorage migration for `ownpilot_nav_groups` users. nav-items.ts extraction from Layout.tsx.
**Addresses:** New Task/Chat button wiring (no data fetch needed), Customize navigation button (simple NavLink to /customize), Scheduled navigation item
**Avoids:** Pitfall 1 (mobile breakage), Pitfall 2 (localStorage migration), Pitfall 5 (Tailwind tokens), Pitfall 6 (StatsPanel state boundary), Pitfall 7 (React.Activity misuse)

### Phase 2: Dynamic Sidebar Sections
**Rationale:** With the shell established and state ownership clear, the three data-driven sections can be implemented safely. The parallel fetch contract from ARCHITECTURE.md must be established at the start of this phase to prevent the waterfall pitfall.
**Delivers:** Workflows section (API list, collapse state, [+] button), Projects section (API list, collapse state, inline [+] create), Recents section (always expanded, 6 items, "See all" link). All three loading with skeletons, error states rendering gracefully.
**Uses:** useSidebarWorkflows, useSidebarProjects, useSidebarRecents hooks; Promise.all parallel fetch pattern; generic SidebarSection component
**Implements:** Parallel data fetching contract from ARCHITECTURE.md Pattern 2; NavLink active state contract from PITFALLS.md Pitfall 4
**Avoids:** Pitfall 3 (API waterfall), Pitfall 4 (NavLink active state)

### Phase 3: Customize Page + Pinned Items
**Rationale:** Additive phase — new route, new page, no changes to existing Layout or Sidebar once Phase 2 is complete. CustomizePage reads/writes the same localStorage key that Sidebar already reads. usePinnedItems hook and pinned items rendering in the sidebar header area complete the feature.
**Delivers:** /customize route registered in App.tsx. CustomizePage with categorized grid of all 63 nav items, pin/unpin. usePinnedItems hook. Sidebar renders pinned items above the Workflows section. Docker build verification that all new Tailwind tokens are present in production CSS.
**Uses:** nav-items.ts (extracted in Phase 1), STORAGE_KEYS.SIDEBAR_PINNED (added in Phase 1), lazy-loaded route pattern from App.tsx
**Implements:** ARCHITECTURE.md Pattern 3 (localStorage communication, no callback)

### Phase 4: Playwright E2E Coverage + Polish
**Rationale:** E2E tests cannot be written until all interactive behavior is implemented. This phase locks in the feature contract and catches regressions before shipping. Polish items (dark mode verification, mobile regression checklist) are cheaper to fix here than post-launch.
**Delivers:** Playwright suite covering: new chat button, /customize page navigation, pin an item and verify in sidebar, navigate to workflow item, mobile sidebar open/close. All mocked API routes. "Looks Done But Isn't" checklist items verified.
**Uses:** @playwright/test (only new dependency in this milestone), page.route() API mocking, data-testid attributes added during Phases 2-3
**Avoids:** Pitfall 8 (Playwright flakiness), production dark mode/Docker regressions

### Phase Ordering Rationale

- Phase 1 must come first because: nav-items.ts extraction is a prerequisite for CustomizePage; STORAGE_KEYS update is a prerequisite for usePinnedItems; state ownership definition prevents destructive Layout refactoring in Phase 2.
- Phase 2 cannot be parallelized with Phase 1 because it depends on SidebarSection (Phase 1 output) and the storage keys contract (Phase 1 output).
- Phase 3 is safe to parallelize with Phase 2 (CustomizePage does not depend on sidebar data hooks) but the pinned items rendering step in the sidebar requires Phase 2's Sidebar.tsx to be complete. Recommended: serial to avoid merge conflicts in Sidebar.tsx.
- Phase 4 requires all interactive behavior from Phases 1-3 before test assertions are meaningful.

### Research Flags

Phases with well-documented patterns (skip research-phase):
- **Phase 1:** Pure extraction and refactor. All patterns from existing Layout.tsx. Zero unknowns.
- **Phase 2:** Standard useState+useEffect hook pattern already present in ConversationSidebar.tsx. Promise.all pattern is trivial.
- **Phase 3:** localStorage read/write pattern identical to `ownpilot_nav_groups` already in codebase. New route registration is established in App.tsx.
- **Phase 4:** Playwright config established in STACK.md. Mock patterns documented in PITFALLS.md.

No phases require `/gsd:research-phase` — this milestone operates entirely within well-understood React SPA patterns with a codebase that has been directly analyzed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against installed package.json. One key discovery: react-router-dom is already v7, not v6 as PROJECT.md implied. Zero speculation in stack additions. |
| Features | HIGH | Wireframe is authoritative. Cowork reference screenshots analyzed directly. All required APIs confirmed to exist in codebase. Behavior specs per section written from direct API analysis. |
| Architecture | HIGH | Based on direct analysis of Layout.tsx (519 lines read in full), all hook files, all API endpoint files. Component responsibility boundaries are specific, not generic. |
| Pitfalls | HIGH | 8 pitfalls identified from direct codebase audit (localStorage key not in STORAGE_KEYS confirmed, CollapsibleGroup pattern confirmed, mobile CSS confirmed). Official React 19.2 docs verified for Activity component. |

**Overall confidence:** HIGH

### Gaps to Address

- **workspacesApi response envelope:** PITFALLS.md notes that `workspacesApi.list()` returns `{ workspaces: [...] }` not the standard `{ data: [...] }` envelope. Confirm actual response shape at the start of Phase 2 by checking the API response type in `api/endpoints/misc.ts` before writing useSidebarProjects.
- **Scheduled tasks schema:** Whether tasks have a `recurrence` or `recurring` field was not confirmed in research. The MVP navigates to `/tasks` without relying on this field — no blocker. Validate schema only if a recurring tasks filter is added to the Scheduled nav item.
- **Recents update trigger:** Research recommends refreshing Recents after New Chat + first message send. The WebSocket event name for conversation creation was not confirmed. MVP behavior (load once on mount) is sufficient for v1.0. Validate WS event in v1.x.
- **Pre-commit hook status:** PITFALLS.md notes that pre-existing ACP errors require `--no-verify`. Confirm current lint/typecheck baseline before Phase 1 to distinguish new errors from pre-existing ones.

---

## Sources

### Primary (HIGH confidence)
- `/home/ayaz/ownpilot/packages/ui/src/components/Layout.tsx` — direct source analysis, 519 lines
- `/home/ayaz/ownpilot/packages/ui/package.json` — installed versions confirmed
- `/home/ayaz/ownpilot/packages/ui/src/constants/storage-keys.ts` — confirmed `ownpilot_nav_groups` NOT in registry
- `/home/ayaz/Downloads/Ekran Resmi 2026-03-28 11.42.21.png` — wireframe (authoritative)
- `/home/ayaz/Downloads/Ekran Resmi 2026-03-27 12.49.14.png` — Cowork sidebar reference screenshot
- `/home/ayaz/Downloads/Ekran Resmi 2026-03-27 17.01.04.png` — Cowork Customize panel screenshot
- [react.dev/reference/react/Activity](https://react.dev/reference/react/Activity) — React 19.2 Activity component docs
- [reactrouter.com/api/components/NavLink](https://reactrouter.com/api/components/NavLink) — NavLink isActive pattern
- [tailwindcss.com/blog/tailwindcss-v4](https://tailwindcss.com/blog/tailwindcss-v4) — Tailwind 4 production-stable confirmation
- [support.claude.com — Schedule recurring tasks in Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-cowork) — Cowork Scheduled feature behavior

### Secondary (MEDIUM confidence)
- [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver) — Playwright + Vite webServer config pattern
- [reactrouter.com/upgrading/v6](https://reactrouter.com/upgrading/v6) — react-router-dom v7 re-export confirmation
- [notion.com/help/navigate-with-the-sidebar](https://www.notion.com/help/navigate-with-the-sidebar) — sidebar width and collapse behavior
- [linear.app/now/how-we-redesigned-the-linear-ui](https://linear.app/now/how-we-redesigned-the-linear-ui) — sidebar section collapse UX patterns
- [betterstack.com — Playwright best practices](https://betterstack.com/community/guides/testing/playwright-best-practices/) — E2E test patterns
- [developerway.com — data fetching in React](https://www.developerway.com/posts/how-to-fetch-data-in-react) — parallel fetch pattern
- [martinfowler.com — modularizing React apps](https://martinfowler.com/articles/modularizing-react-apps.html) — component state ownership

### Tertiary (MEDIUM-LOW confidence)
- npm semver for `@playwright/test` — 1.50.x confirmed stable band, 1.58.x latest noted
- lucide-react version track — 0.577.0 vs 1.7.0 version numbering discrepancy noted; existing icons confirmed sufficient for all sidebar needs

---
*Research completed: 2026-03-27*
*Ready for roadmap: yes*
