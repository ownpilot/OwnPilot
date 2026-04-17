# Pitfalls Research

**Domain:** React sidebar overhaul in existing production app (React 19 + Vite 7 + Tailwind 4)
**Researched:** 2026-03-27
**Confidence:** HIGH

---

## Critical Pitfalls

### Pitfall 1: Mobile Sidebar Broken When Desktop Structure Changes

**What goes wrong:**
The current Layout.tsx uses a single `<aside>` element with conditional className strings — `fixed inset-y-0 left-0 z-40 w-64 transform transition-transform` (mobile) vs `w-56 border-r flex flex-col` (desktop). When restructuring the desktop sidebar (adding sections, changing flex structure, adding API-driven lists), the conditional className logic breaks the mobile slide-in behavior. Common failure: adding `overflow-y-auto` to a new sidebar sub-container causes the `transform: translateX` animation to stop working because transform on a parent doesn't propagate through certain overflow contexts.

**Why it happens:**
The mobile and desktop behaviors share one DOM element. When you add structural wrappers (e.g., `<div className="flex-1 overflow-y-auto">` for the new scrollable section area), the transform-based slide animation requires the outermost `<aside>` to be the transform target. Inner overflow containers create stacking context changes that don't affect transform, but adding `position: fixed` children inside the new structure can create unexpected clipping.

**How to avoid:**
Keep the `<aside>` element as the sole transform target. Never add `position: fixed` inside the sidebar for desktop — use absolute positioning within the sidebar bounds only. Test the mobile slide animation after every structural change. The safest approach: keep the outer `<aside>` wrapper identical to current code; only change what is inside the `<nav>` element.

**Warning signs:**
- Mobile hamburger opens but sidebar appears clipped or partially visible
- Backdrop appears (z-30) but sidebar (z-40) is not fully visible
- Sidebar slides in correctly but content inside doesn't scroll
- Mobile close button disappears or becomes untappable

**Phase to address:**
Phase 1 (Sidebar Shell) — define the layout contract before adding any sections. Run mobile smoke test after every structural change.

---

### Pitfall 2: `ownpilot_nav_groups` Key Not In STORAGE_KEYS — Schema Migration Gap

**What goes wrong:**
The current Layout.tsx uses a raw string `'ownpilot_nav_groups'` for localStorage, outside the centralized `STORAGE_KEYS` registry in `constants/storage-keys.ts`. The new sidebar introduces `pinnedItems` state (Cowork-style). If the new code reads `ownpilot_nav_groups` without a migration step, existing users get an empty/broken pinned state on first load. Worse: if the key is abandoned without cleanup, stale data accumulates indefinitely.

**Why it happens:**
Developers write the new sidebar, use a new key (e.g., `ownpilot_sidebar_pins`), and forget the old key still exists in users' browsers. On first load the old value is ignored, the state resets to defaults. Users who had carefully configured their sidebar state see everything collapse.

**How to avoid:**
1. Add both old and new keys to `STORAGE_KEYS` before using them.
2. Write a one-time migration function: read `ownpilot_nav_groups`, derive any useful state, write to new key, delete old key. Run on first mount with a guard key (e.g., `ownpilot_sidebar_migrated_v1`).
3. Wrap all localStorage reads in try-catch — malformed JSON must not crash the sidebar.

**Warning signs:**
- Sidebar state resets on every page reload
- TypeScript shows hardcoded string literals instead of `STORAGE_KEYS.*` constants
- `localStorage.getItem` called with literal string (grep for this)

**Phase to address:**
Phase 1 (Sidebar Shell) — define the new STORAGE_KEYS entries and migration logic before any state is written.

---

### Pitfall 3: API Waterfall in Sidebar (Workflows + Projects + Recents in Series)

**What goes wrong:**
The new sidebar needs three data sources: `workflowsApi.list()`, `workspacesApi.list()`, and `chatApi.listHistory()`. If implemented naively with sequential `useEffect` + `useState` (fetch workflows, then when done fetch workspaces, then recents), the sidebar shows content 3x slower than necessary. At 200ms per API call, that is 600ms total instead of 200ms for all three in parallel.

**Why it happens:**
Developers write three separate `useEffect` hooks, each in its own component (WorkflowsSection, ProjectsSection, RecentsSection), each fetching on mount. Because React 19 batches renders but does not parallelize fetch effects, each component mounts and fires its fetch sequentially in the component tree order. The bottleneck is not React — it is the network serial pattern.

**How to avoid:**
Fire all three fetches in parallel from a single parent hook (`useSidebarData`) using `Promise.all`:
```typescript
const [workflows, workspaces, recents] = await Promise.all([
  workflowsApi.list(),
  workspacesApi.list(),
  chatApi.listHistory({ limit: 10 }),
]);
```
Each section receives its data as props (no independent fetching). Alternatively, use the existing `apiClient` directly with parallel fetching in the sidebar's top-level effect. Show each section with a skeleton loader independently — do not block all sections on the slowest API.

**Warning signs:**
- Network waterfall visible in DevTools (requests start one after another)
- Sidebar sections appear in sequence with visible loading gaps between them
- Three separate `useEffect` blocks each calling a different API
- Total sidebar load time is sum of individual API times

**Phase to address:**
Phase 2 (Sidebar Sections — API integration) — design the data fetching strategy before implementing individual sections.

---

### Pitfall 4: NavLink Active State Broken for New Routes (/customize, dynamic workflow URLs)

**What goes wrong:**
The new sidebar adds `/customize` (Customize page) and dynamic items from the API (e.g., `/workflows/abc-123`). The existing `NavItemLink` uses `end={item.to === '/'}` — which is correct for the root but wrong for dynamic routes. Adding `/workflows/` as a sidebar item with a dynamic API-driven list means all workflow detail pages (`/workflows/abc-123`) incorrectly highlight the parent "Workflows" section header AND the specific workflow item simultaneously, or neither.

react-router-dom v7 (currently installed as `^7.13.1`) has a known partial-segment matching pitfall: `/user` and `/user-preferences` can both appear active. This applies directly to `/workflows` vs `/workflows/abc-123`.

**Why it happens:**
NavLink uses prefix matching by default. Without `end` prop, `/workflows` NavLink is active at `/workflows/abc-123`. With `end` prop, `/workflows` NavLink is NOT active when browsing a specific workflow — breaking the "parent section highlighted" UX.

The correct behavior for the new sidebar: the section header should show active state when any child is active, but individual workflow items should only highlight their exact route.

**How to avoid:**
- Section headers (Workflows, Projects): use `isActive` logic based on `location.pathname.startsWith('/workflows')` — same pattern as existing `CollapsibleGroup`.
- Individual dynamic items: use `NavLink` with `end` prop — exact match only.
- `/customize` route: add `end` prop since it has no children.
- Add `end` prop to all new NavLinks that are not parent sections.
- Never rely on NavLink active state for parent-section highlighting — compute it manually via `useLocation`.

**Warning signs:**
- Two sidebar items highlighted at the same time when on a detail page
- "Workflows" section not highlighted when inside `/workflows/abc-123`
- Root `/` item highlighted on every page (missing `end` prop)

**Phase to address:**
Phase 2 (Sidebar Sections) — define active state contract per section type before implementing NavLink wrappers.

---

### Pitfall 5: Tailwind 4 `@theme` Custom Properties Not Available in Dynamic Class Names

**What goes wrong:**
The existing codebase uses custom `@theme` tokens (`--color-primary`, `--color-bg-secondary`, etc.) defined in `index.css`. When adding new sidebar sections, developers may try to add new color tokens to `@theme` mid-implementation. The pitfall: Tailwind 4's JIT scanner only generates utility classes for tokens that exist when Vite starts scanning. If a new `--color-sidebar-pin` token is added to `@theme` after initial setup, the utility class `bg-sidebar-pin` may not be generated in production builds even though it works in dev (HMR picks it up).

Additionally: Tailwind 4's `@variant dark` uses `&:where(.dark, .dark *)`. The existing `@variant dark (&:where(.dark, .dark *))` definition is correct — but any new components that bypass this and use `dark:` utilities with a different dark mode setup (e.g., copying from shadcn or another library that uses `prefers-color-scheme`) will break dark mode.

**Why it happens:**
Tailwind 4 is CSS-first — all configuration lives in `index.css`. Developers new to v4 instinctively reach for `tailwind.config.js` (which does not exist in this project), or add tokens to a second CSS file that is not `@import`'d before `@theme`.

**How to avoid:**
- All new design tokens go in `packages/ui/src/index.css` inside the existing `@theme` block — never in a separate file unless it is explicitly `@import`'d at the top of `index.css`.
- Verify any new token generates the expected utility class in the build output: `pnpm build && grep 'sidebar-pin' packages/ui/dist/assets/*.css`.
- Never add `@apply` with classes that are not in the Tailwind utilities — in v4, `@apply` is discouraged but still works only for generated utilities.
- Do not use `theme()` function in new CSS — use CSS variable `var(--color-primary)` directly.

**Warning signs:**
- Classes work in dev (HMR) but disappear in production build
- New sidebar colors show in dev, missing in Docker build
- `pnpm build` output CSS does not contain expected new class names
- Dark mode works on main sidebar but not on new sections

**Phase to address:**
Phase 1 (Sidebar Shell) — establish token conventions upfront. Phase 3 (Docker build verification).

---

### Pitfall 6: StatsPanel Collapse State Owned by Layout — Breaks After Sidebar Extraction

**What goes wrong:**
The current `Layout.tsx` owns `isStatsPanelCollapsed` state and passes it as a prop to `<StatsPanel>`. When the sidebar is refactored into its own component, developers may lift state incorrectly or move `isStatsPanelCollapsed` into the new sidebar component (wrong owner), or into a new `SidebarContext` that `StatsPanel` should not depend on. Result: StatsPanel collapse button stops working, or sidebar refactor triggers unnecessary StatsPanel re-renders on every nav click.

**Why it happens:**
Layout.tsx is 519 lines with multiple state concerns tightly coupled: sidebar open/close (mobile), stats panel collapsed state, badge counts, pulse slots, WebSocket status. When extracting the new sidebar, developers often grab more state than belongs to the sidebar, or leave state in Layout that should move to a dedicated context.

**How to avoid:**
Ownership mapping before refactoring:
- `isMobileSidebarOpen` → moves to new `<Sidebar>` component (owns its own open state)
- `isStatsPanelCollapsed` → stays in `Layout.tsx` or moves to a `LayoutContext` (NOT SidebarContext)
- `badgeCounts` → stays in `Layout.tsx` (fed by `RealtimeBridge`)
- `openGroups`/pinned state → moves to new `<Sidebar>` component

Keep `<StatsPanel>` props identical to current interface. Do not pass StatsPanel state through the new sidebar's context.

**Warning signs:**
- StatsPanel collapse toggle causes full sidebar re-render (visible in React DevTools Profiler)
- StatsPanel state resets when navigating
- `isStatsPanelCollapsed` appearing in sidebar context type definitions

**Phase to address:**
Phase 1 (Sidebar Shell extraction) — define exact state ownership boundary in a comment block or interface before extracting.

---

### Pitfall 7: React 19 `<Activity>` vs Conditional Rendering — Wrong Tool for Mobile Sidebar

**What goes wrong:**
React 19.2 introduces `<Activity mode="hidden">` which preserves component state when hidden. Developers reading about this new API may wrap the new sidebar in `<Activity>` thinking it is the correct modern approach for the mobile slide-in sidebar. It is not — and doing so wastes memory. `<Activity>` preserves fiber state in memory even when hidden, which is appropriate for heavy content panels (like a chat thread that should preserve scroll position). It is NOT appropriate for a navigation sidebar whose state is already persisted to localStorage.

The mobile sidebar does not need state preservation — `isMobileSidebarOpen` drives its visibility and localStorage handles collapse state. Using `<Activity>` here adds memory overhead (~2x per the React docs) for no benefit.

**Why it happens:**
React 19.2 release coverage emphasizes `<Activity>` for "preserving sidebar state." Developers implement it without checking whether their specific use case (nav sidebar) actually needs state preservation.

**How to avoid:**
Keep the current conditional className approach for the mobile slide animation — `translate-x-0 / -translate-x-full`. This is correct and has zero memory overhead. Reserve `<Activity>` only if a future milestone adds a heavy right-panel that needs background state (e.g., Context Chat panel — currently Out of Scope for v2.0).

**Warning signs:**
- Importing `Activity` from `react` in Layout or Sidebar component
- `<Activity mode={isMobileSidebarOpen ? "visible" : "hidden"}>` wrapping the nav sidebar

**Phase to address:**
Phase 1 (Sidebar Shell) — document explicitly that the mobile pattern stays CSS-transform-based.

---

### Pitfall 8: Playwright Test Flakiness from SPA Navigation Timing

**What goes wrong:**
Playwright tests navigate to sidebar items (click "Workflows", expect sidebar section to expand, expect URL to change). In a React SPA, route transitions happen without full page reload. Playwright's default locator assertions assume DOM is stable, but React 19's concurrent renderer may batch state updates in ways that cause the URL to change before the new page's content is rendered. Tests that assert `await expect(page).toHaveURL('/workflows')` immediately after a click pass locally but fail in CI where the app starts with an empty API response (workflows list is empty in test environment).

Additionally: the new sidebar makes 3 API calls on mount. Tests that assert sidebar content without mocking the API calls will have timing failures — the workflows section shows a loading skeleton for 200ms and then renders items. Hard-coded `waitForTimeout()` calls to handle this are the wrong fix.

**Why it happens:**
This is the first Playwright suite for OwnPilot (currently not set up — being added in this milestone). Developers writing E2E tests for the first time often reach for `waitForTimeout()` when content does not appear immediately.

**How to avoid:**
- Always combine `waitForURL` + content assertion: `await page.waitForURL('**/workflows'); await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible()`.
- Mock API calls for sidebar data: `await page.route('**/api/v1/workflows**', route => route.fulfill({ json: { workflows: mockData } }))`.
- Use `page.getByRole()` and `page.getByTestId()` — never CSS selectors like `.sidebar-item:nth-child(3)`.
- Add `data-testid` attributes to key sidebar elements during implementation (not as an afterthought).
- Never use `waitForTimeout()` — use `waitForLoadState('networkidle')` or explicit content assertions.

**Warning signs:**
- `await page.waitForTimeout(1000)` appearing in test files
- CSS selectors like `page.locator('.nav-item')` without role qualifiers
- Tests pass locally 100% but fail in CI 30% of the time
- Tests that do not mock API calls checking sidebar data

**Phase to address:**
Phase 4 (Playwright E2E Setup) — establish mock patterns and locator conventions before writing any test assertions.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline API fetch per section component | Simple to implement | Waterfall fetches, 3x load time | Never — use parallel fetch |
| Raw localStorage string literals | Fast to write | Not in STORAGE_KEYS, hard to find/migrate | Never — always use STORAGE_KEYS |
| Copy CollapsibleGroup pattern for dynamic sections | Familiar code | Dynamic list items need different UX (not just toggle) | As a temporary stub only |
| `!important` CSS overrides for dark mode in new sections | Quick fix for Tailwind variant issues | Breaks dark mode toggle, unmaintainable | Never |
| Skip `data-testid` attributes | Saves 30s per element | Playwright tests become brittle selectors | Never for interactive sidebar elements |
| One Layout.tsx refactor (add new sidebar inline) | No extraction overhead | 519-line file grows to 800+ lines | Only if sidebar extraction is Phase 2 milestone |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `workflowsApi.list()` in sidebar | No error handling — API returns 401 if session expired | Catch ApiError, show "Not connected" placeholder, don't crash sidebar |
| `chatApi.listHistory({ limit: 10 })` for Recents | Fetching full history (no limit) — slow and large payload | Always pass `limit: 10` and `page: 1`, show "See all" link |
| `workspacesApi.list()` returns `{ workspaces: [...] }` (envelope) | Destructuring as `data.data` (ApiError envelope confusion) | The API client already unwraps `ApiResponse<T>` — access `result.workspaces` not `result.data.workspaces` |
| react-router-dom v7 NavLink | Using `to="/workflows/"` with trailing slash | Trailing slash breaks active state matching — always use `to="/workflows"` without trailing slash |
| localStorage on first render | Reading localStorage in render body (not lazy initializer) | Always use `useState(() => { ... localStorage.getItem ... })` lazy initializer, as currently done in Layout.tsx |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sidebar re-renders on every route change | NavLink isActive triggers re-render of entire sidebar, causes visible flicker | Extract sidebar to separate component; memo-ize static sections; only dynamic sections should re-render | Immediately with 63-item sidebar in a single component |
| API fetch on every sidebar mount | Each page navigation re-fetches workflows+workspaces | Cache sidebar data in React context or module-level variable with TTL | From day one — every navigation causes 3 API calls |
| `window.matchMedia` called without SSR guard | Works in dev, crashes if component is ever SSR'd | Already handled by `useIsMobile` hook — do not call `window.matchMedia` directly in new code | If OwnPilot ever adds SSR |
| Full Layout re-render from StatsPanel toggle | `isStatsPanelCollapsed` state in Layout causes entire sidebar to re-render | Keep StatsPanel state co-located with StatsPanel, not in Layout | With every StatsPanel interaction |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Empty state during API load shows blank sections | User sees section headers with nothing below them — looks broken | Show skeleton loaders per section with fixed height placeholders |
| Workflows section shows all 50+ workflows without virtualization | Sidebar becomes extremely long, hard to scroll | Limit to 5-7 most recent/pinned workflows, add "See all" link to /workflows page |
| "New Task/Chat" button navigates to a route | User loses current context | Button should open a modal or start new chat inline, not navigate away |
| Pinned items persist across accounts (localStorage is per-domain) | On a shared machine, User B sees User A's pinned layout | Namespace localStorage keys with user ID: `ownpilot_sidebar_pins_${userId}` |
| Search in sidebar triggers API on every keystroke | 50+ API calls while user types | Debounce 200ms minimum, or search locally within loaded items |
| Mobile sidebar auto-closes on route change (current behavior) | Already works — do NOT remove this behavior | Keep the existing `useEffect(() => setIsMobileSidebarOpen(false), [location.pathname])` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Mobile sidebar:** Does the slide animation still work after adding scrollable inner containers? Test by resizing browser to 375px width.
- [ ] **Active state:** Navigate to `/workflows/[id]` — is "Workflows" section header highlighted? Navigate to `/customize` — is "Customize" button highlighted without highlighting Chat?
- [ ] **localStorage migration:** Does an existing user (with `ownpilot_nav_groups` in localStorage) get their sidebar state correctly on first load of the new sidebar?
- [ ] **API errors:** Disconnect from gateway (stop backend), refresh — does the sidebar render with empty sections gracefully, or does it crash?
- [ ] **Dark mode:** Toggle theme with new sidebar open — do all new sections respect dark mode without hardcoded light colors?
- [ ] **Docker build:** Run `docker build -t localhost:5000/ownpilot:test-sidebar .` — do all new Tailwind utility classes appear in production CSS?
- [ ] **StatsPanel:** Does the StatsPanel collapse/expand still work independently after Layout refactor?
- [ ] **MiniChat/MiniTerminal:** Are these still desktop-only (`!isMobile`)? Did sidebar refactor accidentally remove this condition?
- [ ] **DebugDrawer:** Is the bottom drawer still visible and functional? (It is a `shrink-0` sibling to the main flex column — ensure the new sidebar does not affect the outer layout structure.)
- [ ] **pre-commit hook:** Does `pnpm lint && pnpm typecheck` pass on the new sidebar code? (Pre-existing ACP errors require `--no-verify` per PROJECT.md constraints — new code must not add new lint errors.)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Mobile sidebar broken by structural change | LOW | Revert the specific inner-wrapper change; test with `translate-x-0/-translate-x-full` on `<aside>` directly |
| localStorage migration missed | MEDIUM | Add migration function and deploy; stale data is harmless but causes state reset — users re-configure once |
| API waterfall implemented | LOW | Extract to `useSidebarData` hook, replace sequential useEffects with Promise.all |
| NavLink active state wrong | LOW | Add/remove `end` prop on specific NavLinks; verify with `useLocation` in React DevTools |
| Tailwind token missing from production build | LOW | Add token to `index.css @theme` block, rebuild Docker image |
| StatsPanel state moved to wrong owner | MEDIUM | Move `isStatsPanelCollapsed` back to Layout; wire through props not SidebarContext |
| Playwright tests all using waitForTimeout | MEDIUM | Replace with `waitForURL` + content assertions; add `data-testid` attrs; mock API routes |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Mobile sidebar broken | Phase 1 (Sidebar Shell) | Resize to 375px, open hamburger, verify slide animation |
| localStorage migration | Phase 1 (Sidebar Shell) | Open with existing `ownpilot_nav_groups` in localStorage, verify state intact |
| API waterfall | Phase 2 (Sidebar Sections) | DevTools Network tab shows 3 requests starting simultaneously |
| NavLink active state | Phase 2 (Sidebar Sections) | Navigate to dynamic routes, verify only correct items highlighted |
| Tailwind token missing | Phase 1 + Phase 3 (Docker build) | `grep` new class names in dist CSS output |
| StatsPanel state boundary | Phase 1 (Sidebar Shell extraction) | StatsPanel toggle does not re-render sidebar (React Profiler) |
| Activity component misuse | Phase 1 (Sidebar Shell) | Code review: no `<Activity>` import in Sidebar or Layout |
| Playwright flakiness | Phase 4 (E2E tests) | Tests pass 5 consecutive runs in CI with mocked APIs |

---

## Sources

- Layout.tsx source audit: `/home/ayaz/ownpilot/packages/ui/src/components/Layout.tsx` (519 lines, direct inspection)
- storage-keys.ts audit: `/home/ayaz/ownpilot/packages/ui/src/constants/storage-keys.ts` (direct inspection — `ownpilot_nav_groups` NOT in registry)
- React 19.2 Activity component: [react.dev/reference/react/Activity](https://react.dev/reference/react/Activity)
- React 19.2 release: [react.dev/blog/2025/10/01/react-19-2](https://react.dev/blog/2025/10/01/react-19-2)
- react-router-dom NavLink pitfalls: [GitHub Issue #9279](https://github.com/remix-run/react-router/issues/9279), [GitHub Issue #10506](https://github.com/remix-run/react-router/issues/10506)
- Tailwind CSS v4 migration: [tailwindcss.com/docs/upgrade-guide](https://tailwindcss.com/docs/upgrade-guide), [Medium v4 migration guide](https://medium.com/better-dev-nextjs-react/tailwind-v4-migration-from-javascript-config-to-css-first-in-2025-ff3f59b215ca)
- Fetch waterfall prevention: [developerway.com — how to fetch data in React](https://www.developerway.com/posts/how-to-fetch-data-in-react)
- Playwright flakiness: [betterstack.com — avoid flaky tests](https://betterstack.com/community/guides/testing/avoid-flaky-playwright-tests/), [betterstack.com — best practices](https://betterstack.com/community/guides/testing/playwright-best-practices/)
- React stale closure / useEffectEvent: [logrocket.com — useEffectEvent](https://blog.logrocket.com/react-useeffectevent/), [React 19.2 useEffectEvent](https://react.dev/blog/2025/10/01/react-19-2)
- Component state decoupling: [martinfowler.com — modularizing React apps](https://martinfowler.com/articles/modularizing-react-apps.html)
- localStorage pitfalls: [rxdb.info — localStorage guide](https://rxdb.info/articles/localstorage.html)

---
*Pitfalls research for: React 19 + Vite 7 + Tailwind 4 sidebar overhaul — OwnPilot UI Redesign v1.0*
*Researched: 2026-03-27*
