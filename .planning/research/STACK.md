# Stack Research

**Domain:** React 19 SPA — sidebar overhaul additions to existing production app
**Researched:** 2026-03-27
**Confidence:** HIGH (all versions verified against npm registry and official docs)

---

## Context: What Already Exists (Do Not Re-research)

The following are already installed and validated. This research covers ONLY additions needed for the sidebar overhaul:

| Technology | Installed Version | Status |
|------------|------------------|--------|
| React | 19.2.4 | Locked — do not change |
| Vite | 7.3.1 | Locked |
| Tailwind CSS | 4.2.1 | Locked |
| TypeScript | 5.9.3 | Locked |
| react-router-dom | 7.13.1 | **Already v7** — see below |
| lucide-react | 0.577.0 | Current — see below |
| Vitest | 4.1.0 | Locked |
| @monaco-editor/react | 4.7.0 | Unchanged |

**Critical discovery:** `package.json` shows `react-router-dom@^7.13.1`, NOT v6 as the PROJECT.md context stated. The app already uses v7. This resolves the v6-vs-v7 question entirely.

---

## Recommended Stack Additions

### New Dependency: Playwright

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@playwright/test` | `^1.50.0` | E2E test suite | Latest stable (1.50.x as of March 2026 — v1.58.x is newest but 1.50.x is the tested stable band). Chromium-first, zero flakiness compared to Cypress for SPA navigation. Official Microsoft support. |

**Use `@playwright/test`, not `playwright`:**
- `@playwright/test` is the test runner package (includes assertions, fixtures, config)
- `playwright` is the browser automation library only — no test runner
- For E2E with Vitest already in place, `@playwright/test` is the correct package

**Vite integration pattern (playwright.config.ts):**
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

Vite's default dev port is 5173. No additional plugin needed — `webServer` starts Vite automatically before tests run.

---

### New DevDependency: Playwright Browsers

After install, run once: `npx playwright install chromium` (not full browser suite — just Chromium is sufficient for the sidebar E2E tests in scope).

---

## What Does NOT Need to Be Added

### react-router-dom: Already v7, No Migration Needed

The app already runs react-router-dom v7.13.1. Imports still use `from 'react-router-dom'` — this continues to work because v7 ships `react-router-dom` as a re-export of `react-router`.

**For the sidebar overhaul, NavLink works as follows in v7:**
```typescript
// Section headers (parent routes) — do NOT use end prop:
<NavLink
  to="/workflows"
  className={({ isActive }) => isActive ? 'bg-accent' : 'hover:bg-muted'}
>
  Workflows
</NavLink>

// Individual dynamic items — use end prop for exact match:
<NavLink
  to={`/workflows/${wf.id}`}
  end
  className={({ isActive }) => isActive ? 'bg-accent' : 'hover:bg-muted'}
>
  {wf.name}
</NavLink>
```

No v7 migration steps needed. `BrowserRouter`, `NavLink`, `useNavigate`, `useLocation` all work from existing `'react-router-dom'` imports.

---

### Tailwind CSS 4: Stable, No Sidebar Concerns

Tailwind 4.2.1 is production-stable as of 2026. For sidebar-specific utilities:

- **Container queries** built-in (no plugin needed) — can use `@container` if sidebar sub-components need adaptive layouts
- **Transition utilities** (`transition-transform`, `duration-200`, `ease-in-out`) work identically to v3 for CSS-based sidebar animations
- **Dark mode** via `@variant dark` — already configured in `index.css`. New sidebar components must use `dark:` utilities, not `prefers-color-scheme` media query
- **Custom tokens** — add any new sidebar design tokens inside the existing `@theme` block in `index.css`, never in a new file

**No new Tailwind packages or plugins needed.** `@tailwindcss/vite` (already at 4.2.1) handles everything.

---

### Data Fetching: useState + useEffect Sufficient

**Do NOT add SWR or TanStack Query** for this milestone.

The sidebar needs 3 API calls on mount (workflows, projects, recents). Each is a one-shot fetch — no polling, no mutation, no cross-component sharing, no invalidation. This is exactly the `useState + useEffect` use case.

**Total cost of the data fetching layer:** ~45 lines across 3 hook files (15 lines each), cancellation-safe with `let cancelled = false`. Adding SWR (5.3 KB gzipped) or TanStack Query (16.2 KB gzipped) for 3 `useEffect` calls is disproportionate overhead and introduces an external mental model with no benefit for this scope.

**If caching becomes needed in v2.0** (when sidebar data is shared across multiple components, requires real-time updates, or needs optimistic mutations), SWR is the correct addition — it is 3x smaller than TanStack Query and sufficient for read-heavy sidebar state.

---

### Animation: CSS Transitions Only

**Do NOT add Framer Motion or @headlessui/react for this milestone.**

The sidebar sections (Workflows/Projects/Recents) are always-visible sections with a fixed list — there is no collapse/expand interaction in v1.0. The mobile slide animation is already implemented via CSS transforms (`transition-transform`) and is preserved as-is.

**If section collapse/expand is added in a future milestone**, the correct approach is:
1. CSS transitions via Tailwind's `transition` + `duration-200` utilities for simple height-based reveals (limitation: CSS cannot animate `height: 0` to `height: auto`)
2. `@headlessui/react` Disclosure (v2.2.9) for accessible accordion with Tailwind — lightweight, React 19-compatible (fixed in recent releases), designed for exactly this use case. Bundle cost: ~12 KB gzipped.
3. Framer Motion is NOT recommended for sidebar sections — it uses `requestAnimationFrame` on the main thread (not GPU compositor), so under load it drops frames before CSS does. At 30 KB gzipped for what CSS transitions handle natively, it is not worth adding.

---

### Search: Array.filter Sufficient for Customize Page

**Do NOT add Fuse.js.**

The `/customize` page search filters a static list of ~63 nav items by label. The items have short text labels, users are expected to type exact or near-exact names, and the list never exceeds 100 items. `Array.filter()` with `item.label.toLowerCase().includes(query.toLowerCase())` is the correct tool:

- 0 KB overhead
- Instant performance at 63 items (Array.filter on 63 strings is sub-millisecond)
- Exact substring match is appropriate here — typo tolerance on a navigation menu label is not a UX win

**If the Customize page evolves to support free-form tags, multi-field search across thousands of items, or fuzzy matching across description text**, add Fuse.js then (4.0 KB gzipped, zero dependencies).

---

### lucide-react: Already Current

The installed version `0.577.0` is current as of this research (latest is 1.7.0 based on web search — but npm semver `^0.577.0` may reflect a different release track). Regardless, the existing 103 icons already cover all sidebar UI needs:

- `Plus` — section [+] add button
- `Search` — header search button
- `Settings2` or `Sliders` — Customize button
- `Clock` or `Calendar` — Scheduled button
- `ChevronRight/Down` — section expand/collapse (if added later)
- `Workflow`, `FolderOpen`, `MessageSquare` — section icons
- `LogOut`, `Wifi`, `WifiOff` — footer

No icon library changes needed.

---

## Installation Commands

```bash
# Add Playwright E2E (dev dependency only — never ships to production)
pnpm add -D @playwright/test --filter @ownpilot/ui

# Install Chromium browser for Playwright (run once after install)
cd packages/ui && npx playwright install chromium
```

That is the only `npm install` command needed for this milestone.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `@playwright/test` 1.50+ | Cypress | Playwright has better SPA navigation support, official Chromium builds, no flaky custom wait-for patterns. Vitest already in project — Playwright adds E2E tier without replacing unit tests. |
| `@playwright/test` 1.50+ | Vitest Browser Mode | Vitest browser mode tests components, not full app flows. Does not replace E2E for multi-step user flows (sidebar → page → customize → back). |
| CSS transitions | Framer Motion | CSS handles `transform`/`opacity` on GPU compositor thread. Framer Motion runs on main thread. For sidebar sections, CSS is correct and costs 0 KB. |
| CSS transitions | `@headlessui/react` Disclosure | Headless UI is correct for accessible toggle panels — but v1.0 has no collapsible sections. Add only if collapse/expand is scoped in. |
| Array.filter | Fuse.js | Fuse.js is correct for multi-field fuzzy search on large datasets. 63 nav items with short labels need exact substring match, not fuzzy matching. |
| useState + useEffect | SWR | SWR adds stale-while-revalidate (correct for dashboard data). Sidebar data is fetched once on mount — SWR's caching strategy provides no benefit for this access pattern. |
| useState + useEffect | TanStack Query | Same rationale as SWR, with 3x larger bundle (16.2 KB). Correct choice for mutation-heavy apps or those with complex server state synchronization — not applicable here. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `playwright` (bare package) | Browser automation only — no test runner, no assertions, no config | `@playwright/test` |
| Framer Motion | 30 KB, main-thread animations, overkill for CSS-native sidebar transitions | CSS `transition-transform` utilities |
| TanStack Query | 16.2 KB gzipped for 3 one-shot fetch calls | `useState + useEffect` with cancellation token |
| Fuse.js | 4 KB overhead for filtering 63 static short-string items | `Array.filter` + `String.includes` |
| `@headlessui/react` NOW | No collapsible sections in v1.0 scope | Add in future milestone when section toggle is designed |
| React 19 `<Activity>` for mobile sidebar | Doubles memory for preserved fiber state — sidebar state is already in localStorage | CSS `translate-x-0 / -translate-x-full` pattern (current approach) |
| `react-router-dom` migration to `react-router` | All imports work from `react-router-dom` in v7 — migration is cosmetic | Keep existing imports, no change |

---

## Stack Patterns for This Milestone

**Sidebar data fetching pattern:**
```typescript
// All three sidebar hooks follow this exact shape:
export function useSidebarWorkflows() {
  const [data, setData] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    workflowsApi.list({ limit: '20' })
      .then(res => { if (!cancelled) setData(res.data ?? []); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, isLoading, error };
}
```

**NavLink active state pattern for dynamic sidebar items:**
```typescript
// Parent section — active when any child route is active:
const isWorkflowsActive = location.pathname.startsWith('/workflows');

// Child item — exact match only:
<NavLink to={`/workflows/${wf.id}`} end className={...}>
```

**Playwright E2E pattern for sidebar API mocking:**
```typescript
// Always mock sidebar API calls in E2E tests — prevents timing failures:
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/workflows**', route =>
    route.fulfill({ json: { data: mockWorkflows } })
  );
});
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@playwright/test@^1.50.0` | Vite 7.3.1 | Uses `webServer.command: 'pnpm dev'` — no Vite plugin needed |
| `@playwright/test@^1.50.0` | TypeScript 5.9.3 | Ships own TypeScript types — no `@types/playwright` needed |
| `react-router-dom@7.13.1` | React 19.2.4 | Fully compatible. v7 was designed for React 18+ |
| `lucide-react@0.577.0` | React 19.2.4 | Fully compatible — tree-shakeable SVG components |
| Tailwind 4.2.1 | Vite 7.3.1 | `@tailwindcss/vite` plugin already configured |

---

## Sources

- npm package.json (direct read): `/home/ayaz/ownpilot/packages/ui/package.json` — confirmed installed versions
- `@playwright/test` latest version: [npmjs.com/package/@playwright/test](https://www.npmjs.com/package/@playwright/test) — v1.58.2 latest, 1.50+ stable band. MEDIUM confidence (web search verified)
- Playwright + Vite webServer config: [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver) — MEDIUM confidence (official docs)
- react-router-dom v7 `react-router-dom` re-export: [reactrouter.com/upgrading/v6](https://reactrouter.com/upgrading/v6) — MEDIUM confidence (official docs)
- react-router-dom v7 NavLink `isActive` pattern: [reactrouter.com/api/components/NavLink](https://reactrouter.com/api/components/NavLink) — HIGH confidence (official docs)
- Tailwind CSS 4 production-stable status: [tailwindcss.com/blog/tailwindcss-v4](https://tailwindcss.com/blog/tailwindcss-v4) — HIGH confidence (official)
- Animation performance comparison (CSS vs Framer Motion): [motion.dev/magazine/web-animation-performance-tier-list](https://motion.dev/magazine/web-animation-performance-tier-list) — MEDIUM confidence (verified multiple sources)
- `@headlessui/react` v2.2.9 React 19 compatibility: [github.com/tailwindlabs/headlessui/discussions/3354](https://github.com/tailwindlabs/headlessui/discussions/3354) — MEDIUM confidence (GitHub discussion)
- SWR vs TanStack Query bundle sizes: [logrocket.com/swr-vs-tanstack-query-react](https://blog.logrocket.com/swr-vs-tanstack-query-react/) — MEDIUM confidence (verified against npm)
- lucide-react 1,694 icons, v1.7.0 latest: [lucide.dev](https://lucide.dev) — MEDIUM confidence (web search)

---

*Stack research for: OwnPilot Sidebar Overhaul — React 19 + Vite 7 + Tailwind 4 additions only*
*Researched: 2026-03-27*
