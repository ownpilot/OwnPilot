# Plan 13 — UI Refactoring & Performance

**Priority:** P2
**Effort:** XL (multi-week; one PR per page)
**Risk:** Low
**Depends on:** none (UI changes are independent)
**Source reports:** `refactor.md` §5 (Page-component decomposition, Fire-
and-forget pattern, Component memo audit), `refactor_plan.md` M1 (done
for ClawsPage / FleetPage)

---

## Context

The UI package has ~68 K LoC across 327 `.tsx` files. The 2026-04–05
sweep (per `refactor_plan.md` M1) split `ClawsPage` (2 972 → 444 LoC)
and `FleetPage` (2 368 → 447 LoC) successfully. The pattern is
established and replicable. Remaining work:

- **8 large pages** > 1 000 LoC remain: `ChatPage.tsx` (1 299),
  `McpServersPage.tsx` (1 328), `CodingAgentsPage.tsx` (1 362),
  `SystemPage.tsx` (1 212), `ProfilePage.tsx` (1 219), `LogsPage.tsx`
  (1 185), `TriggersPage.tsx` (1 096), `PlansPage.tsx` (1 066).
- **13+ `.catch(() => {})` in hooks/components** are latent bugs.
  Each one is a fire-and-forget that swallows errors silently.
- **262 of 327 `.tsx` files do NOT use `React.memo`, `useMemo`, or
  `useCallback`**. Most are correct for leaf components, but the
  large list components and charts in `AnalyticsPage` would benefit
  from profiling.
- **`components/ToolPicker.tsx` (1 247 LoC)** and
  **`components/MarkdownContent.tsx` (1 416 LoC)** are large leaf
  components that should be split.

This plan applies the established pattern (Page → SectionContainer →
Card → Field) to the remaining large pages, centralizes the fire-and-
forget helper, and profiles the analytics-heavy pages.

## Scope

- 8 large page files (above)
- `components/ToolPicker.tsx` (1 247 LoC)
- `components/MarkdownContent.tsx` (1 416 LoC)
- `hooks/useWebSocket.tsx` (fire-and-forget cleanup)
- `pages/AnalyticsPage.tsx` (memoization profile target)
- `utils/ignore.ts` (new — centralized fire-and-forget helper)

## Goals

1. Every page is < 600 LoC, with sub-components in `pages/<feature>/`.
2. A `ignore(promise, label)` helper replaces every bare
   `.catch(() => {})` in `hooks/` and `components/`.
3. An ESLint rule flags bare `.catch(() => {})` in `*.tsx` files.
4. `AnalyticsPage` charts use `React.memo` on inner components and
   `useMemo` for derived data, verified by a profile before/after.
5. `ToolPicker.tsx` and `MarkdownContent.tsx` are split into
   sub-components with clear responsibilities.

## Implementation Steps

### Step 1 — Centralize the fire-and-forget helper

Create `packages/ui/src/utils/ignore.ts`:

```ts
import { log } from './log';

export const ignore = <T>(p: Promise<T>, label = 'fire-and-forget') =>
  p.catch((err) => log.warn(label, { error: err }));
```

Add an ESLint rule to `packages/ui/eslint.config.js` (or the root
config with a UI override) that flags any
`Promise.catch(( ) => {})` in `*.tsx` files.

Replace each of the 13+ bare `.catch(() => {})` sites with `ignore(...)`
calls.

### Step 2 — Split the 8 remaining large pages

Mirror the ClawsPage / FleetPage pattern (one PR per page):

- **PR-1: `ChatPage.tsx`** (1 299) — extract `MessageList`,
  `Composer`, `ToolbarBar`, `ScrollManager`, `useChatMessages` hook.
  Move `authedFetch` to the shared `api` module (two non-standard
  callers in `ClawsPage.tsx:49-59` and `api/endpoints/extensions.ts`
  per `refactor_plan.md` M1).
- **PR-2: `McpServersPage.tsx`** (1 328) — extract `ServerList`,
  `ServerDetailPanel`, `ServerEditor`, `ToolDiscoveryTab`.
- **PR-3: `CodingAgentsPage.tsx`** (1 362) — extract `AgentList`,
  `AgentDetailPanel`, `AgentEditor`, `SessionHistoryTab`.
- **PR-4: `SystemPage.tsx`** (1 212) — extract `SystemStatus`,
  `ConfigurationForms`, `DiagnosticsPanel`.
- **PR-5: `ProfilePage.tsx`** (1 219) — extract `UserProfile`,
  `ApiKeysTab`, `PreferencesTab`.
- **PR-6: `LogsPage.tsx`** (1 185) — extract `LogStream`,
  `LogFilterBar`, `LogEntry`.
- **PR-7: `TriggersPage.tsx`** (1 096) — extract `TriggerList`,
  `TriggerEditor`, `TriggerHistoryTab`.
- **PR-8: `PlansPage.tsx`** (1 066) — extract `PlanList`,
  `PlanEditor`, `PlanExecutionTab`.

### Step 3 — Split `ToolPicker.tsx`

In `packages/ui/src/components/ToolPicker.tsx` (1 247 LoC):

- The file mixes the tool grid, the search bar, the filter chips, and
  the per-tool detail panel.
- Split into:
  - `ToolPicker/index.tsx` — shell
  - `ToolPicker/Grid.tsx` — the tool grid
  - `ToolPicker/SearchBar.tsx` — search input
  - `ToolPicker/FilterChips.tsx` — category filter chips
  - `ToolPicker/DetailPanel.tsx` — per-tool detail
  - `ToolPicker/hooks/useToolSearch.ts` — search state
- After the split, the shell is < 200 LoC.

### Step 4 — Split `MarkdownContent.tsx`

In `packages/ui/src/components/MarkdownContent.tsx` (1 416 LoC):

- The component handles inline code, code blocks (with syntax
  highlighting), tables, images, links, headings, and embeds.
- Split into:
  - `MarkdownContent/index.tsx` — shell + dispatcher
  - `MarkdownContent/CodeBlock.tsx` — code blocks with syntax
    highlighting
  - `MarkdownContent/Table.tsx` — table rendering
  - `MarkdownContent/Embed.tsx` — image / video / link embeds
  - `MarkdownContent/Heading.tsx` — heading anchors
- Consider using a maintained Markdown library (e.g., `react-markdown`
  with `remark-gfm`) if the hand-rolled implementation grows further.

### Step 5 — Profile `AnalyticsPage`

- Run a React Profiler recording on `AnalyticsPage` with 10 000 data
  points; identify the top-3 most-expensive renders.
- Apply `React.memo` to the inner chart components; `useMemo` for
  derived data; `useCallback` for event handlers passed to memoized
  children.
- Re-profile; assert a > 30% reduction in render time for the
  slow operations.
- Document the profile results in `docs/PERFORMANCE.md`.

## Acceptance Criteria

1. Every page file is < 600 LoC after the plan.
2. `ToolPicker.tsx` and `MarkdownContent.tsx` are split; no single
   component file is > 600 LoC.
3. `grep -rn '.catch(.*=> *{})' packages/ui/src/` returns zero matches
   in `hooks/` and `components/`.
4. `AnalyticsPage` re-render time for the slowest operation is reduced
   by > 30% in a before/after profile.
5. Existing Playwright e2e tests pass without modification; visual
   regression (if any) is pixel-identical.
6. The ESLint rule for bare `.catch(() => {})` is enabled in CI.

## Test Plan

- Move existing per-page tests alongside the new sub-components.
- For `AnalyticsPage`, add a benchmark test that asserts the
  re-render time is within budget (a Jest-style "performance test"
  with a generous upper bound to avoid flake).
- For the fire-and-forget helper, a unit test asserts that a rejected
  promise is logged at `warn`.

## Risks & Rollback

- **Risk:** Splitting a page breaks a sibling component that imports
  an internal symbol. Mitigation: keep barrel re-exports for one
  release; CI grep confirms no stale imports.
- **Risk:** `React.memo` on a component that receives inline objects
  defeats the memoization. Mitigation: pair with `useMemo` for the
  props; document the pattern.
- **Risk:** The performance profile in Step 5 is machine-dependent
  and might flake. Mitigation: set the budget high (e.g., 2× the
  pre-refactor median) and run on a fixed CI runner size.
- **Rollback:** Each page PR is independently revertible. The
  `ignore()` helper is additive.

## Out of Scope

- Migrating to a different UI framework (e.g., Solid, Svelte). React
  19 with Vite is current and well-supported.
- Introducing a state-management library (Zustand, Redux Toolkit).
  The current React-Query + Context patterns are sufficient per
  `refactor.md` §11.
- Accessibility audit. The existing tests cover the major flows; a
  full a11y audit is a future effort (separate plan).
- Internationalization. Out of scope for the refactor.
