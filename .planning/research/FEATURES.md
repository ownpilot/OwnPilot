# Feature Research

**Domain:** Cowork-style structural sidebar — AI/productivity app navigation
**Researched:** 2026-03-27
**Confidence:** HIGH (wireframe + Cowork live reference + existing codebase audited)

---

## Context: What Is Being Built

The existing sidebar has 63 nav items crammed into collapsible groups (Layout.tsx, 519 lines).
This milestone replaces that with a Cowork-style structural sidebar containing:

- Fixed top area: New Task/Chat button, Search, Customize (arrow → /customize), Scheduled
- Dynamic section: Workflows [+] — list from `workflowsApi.list()`
- Dynamic section: Projects [+] — list from `workspacesApi.list()`
- Dynamic section: Recents — list from `chatApi.listHistory({ limit: 6 })`
- /customize page: grid of all 63+ items, pin/unpin to sidebar

The current Layout.tsx collapsible groups are replaced entirely. All 63 items move to /customize.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must work correctly or the redesign feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| New Task/Chat button — opens new conversation | Every AI app (Cowork, Cursor, ChatGPT) has this as CTA | LOW | Navigate to `/` with a state flag that clears current conversation. Uses existing `chatApi`. Route: `/`. Already exists, just needs button wiring. |
| Search — opens search UI (not just filter) | Cowork sidebar has "Search" as primary action. Users expect cmd+K style. | MEDIUM | No global search exists yet. Minimum viable: navigate to `/history?search=` with input focus. Full: inline dropdown with debounced chatApi.listHistory({search}) + workflow results. |
| Customize button — navigates to /customize page | Cowork pattern: arrow → shows customize page. Wireframe confirms arrow icon. | LOW | Simple NavLink to `/customize`. The /customize route and page must be created. |
| Scheduled — shows scheduled tasks list | Cowork's "Scheduled" is a dedicated page for recurring task management. Confirmed: sidebar item navigates to scheduled tasks page. | LOW | Navigate to existing `/tasks?filter=scheduled` or new `/scheduled` route. Task type with recurrence fields likely needed. |
| Workflows section — expandable list with [+] | Apps like Notion, Linear show dynamic lists with "new" button inline. Wireframe shows this pattern. | MEDIUM | `workflowsApi.list()` already returns workflows. [+] opens `/workflows` or creates inline. Items link to `/workflows/:id`. |
| Projects section — workspace list with [+] | Cowork shows "Projects" as primary sidebar section. `workspacesApi.list()` exists. | MEDIUM | `workspacesApi.list()` returns workspaces. [+] triggers `workspacesApi.create()`. Items navigate to workspace context (could be `/` with workspaceId param). |
| Recents section — recent conversations | Every chat tool (ChatGPT, Cursor, Cowork) shows recent chats in sidebar. Wireframe shows 6 items. | LOW | `chatApi.listHistory({ limit: 6 })` is already available. Truncate titles to ~30 chars. Items navigate to ChatPage with conversationId. |
| Section collapse/expand — remember state | Notion and Linear both persist collapse state per section. Users expect this. | LOW | localStorage per section key. Default: Workflows=open, Projects=open, Recents=open. |
| /customize page — grid of all pages with pin/unpin | Cowork "Customize" shows skills/pages grid with toggle. Wireframe arrow → confirms navigation. | MEDIUM | Grid rendering ALL_NAV_ITEMS (flat array from navGroups). Pin state stored in localStorage. Default pinned = ["/", "/customize"]. Max 15 pins. |
| Active state on sidebar items | NavLink `isActive` highlighting for current page. Already done for current sidebar. | LOW | Already implemented in NavItemLink component — carry over pattern. |
| Mobile sidebar preserved | Existing mobile slide-in behavior must not regress. | LOW | Existing isMobile/isMobileSidebarOpen logic preserved. New structure renders same sections on mobile. |

### Differentiators (Competitive Advantage)

Features that make this sidebar better than the Cowork reference.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Pinned items (usePinnedItems hook) | User controls exactly what appears — not just "recent". Cowork doesn't have this, it has fixed sections. | MEDIUM | localStorage `ownpilot-pinned-items: string[]`. Default: `["/", "/customize"]`. Max 15. Pin/unpin from /customize grid. Already designed in previous planning (usePinnedItems.ts). |
| Search with workflow + conversation results | Cowork search is limited to tasks. Ownpilot can search across conversations, workflows, workspaces at once. | HIGH | Defer full implementation to v1.x. MVP: navigate to /history with search pre-filled. |
| Recents showing conversation summary | Show first message snippet or AI-generated title, not raw UUID. chatApi.listHistory returns `title` field. | LOW | Use `conversation.title ?? conversation.id.slice(0,8)`. Already available in Conversation type. |
| Workflow quick-run from sidebar | Hover on workflow item → run button appears inline. No page navigation needed. | HIGH | Defer to v2. Not in scope for v1.0 sidebar. |
| Section item count badges | Show (3) pending workflows, (2) new projects inline on section header. | MEDIUM | Defer. Complexity without clear user benefit at launch. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Drag-drop sidebar reordering | "I want to reorder my pinned items" | Heavy dependency (dnd-kit or react-beautiful-dnd, ~15KB), complex touch support, state serialization issues | Up/down arrow buttons in /customize page for v1. Drag-drop in v2+. |
| Inline create form in sidebar | "Add workflow directly from sidebar" | Sidebar is narrow (w-56). Forms in narrow space cause UX problems (validation, error messages don't fit). Linear tried this, rolled it back. | [+] button navigates to full create page or opens modal from the main content area. |
| Real-time dynamic counts on every section | "Show me how many items in each section" | Requires polling or WebSocket subscriptions for 3 separate data sources simultaneously. Battery/CPU impact on low-end devices. | Load counts once on mount, no live updates. |
| Sidebar search that filters sidebar items in-place | "Type in search, sidebar items filter" | Breaks spatial memory — items disappear/reappear, users lose track. VS Code tried this in 2018, reverted. | Separate Search button navigates to dedicated search page with results. |
| Infinite recents scroll | "Show all my conversations in sidebar" | Sidebar becomes a scroll trap, navigation items scroll off screen, mobile unusable | Hard cap at 6-8 items. "See all" link to /history. |
| Auto-collapse workflows/projects when empty | "Hide empty sections" | Users don't know the sections exist until they create items. Discovery problem. Cowork shows empty sections with "Create first..." hint. | Always show section with empty state message: "No workflows yet. [+] to create." |

---

## Feature Dependencies

```
[New Task/Chat button]
    └──requires──> [ChatPage exists at /] (ALREADY DONE)
    └──requires──> [conversation reset mechanism in useChatStore] (ALREADY DONE)

[Recents section]
    └──requires──> [chatApi.listHistory()] (ALREADY DONE — exists)
    └──enhances──> [New Task/Chat button] (clicking new chat updates recents list)

[Workflows section]
    └──requires──> [workflowsApi.list()] (ALREADY DONE — exists)
    └──requires──> [/workflows route] (ALREADY DONE — exists in App.tsx)

[Projects section]
    └──requires──> [workspacesApi.list()] (ALREADY DONE — exists)
    └──requires──> [workspacesApi.create()] (ALREADY DONE — exists)

[Customize button]
    └──requires──> [/customize route] (MUST CREATE — not in App.tsx yet)
    └──requires──> [CustomizePage.tsx] (MUST CREATE)
    └──requires──> [ALL_NAV_ITEMS flat array] (MUST CREATE — nav-items.ts extract)

[/customize page pin/unpin]
    └──requires──> [usePinnedItems hook] (MUST CREATE)
    └──requires──> [STORAGE_KEYS.PINNED_ITEMS] (MUST ADD to storage-keys.ts)
    └──requires──> [ALL_NAV_ITEMS] (MUST CREATE — nav-items.ts extract)

[Sidebar pinned items render]
    └──requires──> [usePinnedItems hook] (MUST CREATE)
    └──requires──> [ALL_NAV_ITEMS] (MUST CREATE)

[Search button]
    └──requires──> [chatApi.listHistory()] (ALREADY DONE — for conversation search)
    └──requires──> [/history route with ?search= support] (ALREADY DONE for navigation)
    └──enhances──> [workflowsApi.list()] (for cross-type search in v1.x)

[Scheduled section]
    └──requires──> [tasksApi.list()] (ALREADY DONE — exists)
    └──requires──> [/tasks route] (ALREADY DONE)
    └──note──> [recurring task fields — may need schema check]

[Section collapse state]
    └──requires──> [localStorage (STORAGE_KEYS pattern)] (ALREADY DONE — pattern exists)
    └──independent from pinnedItems state
```

### Dependency Notes

- **ALL_NAV_ITEMS requires nav-items.ts extraction first:** Layout.tsx currently embeds navGroups/mainItems/bottomItems inline. These must be extracted to `constants/nav-items.ts` before CustomizePage and the new sidebar can share the same data. This is a pure refactor, zero behavior change (F1.5 in roadmap).
- **usePinnedItems requires STORAGE_KEYS addition:** New key `ownpilot-pinned-items` must be added to the centralized registry before the hook can be written.
- **Recents enhances New Task/Chat:** When the user clicks New Task/Chat, the new conversation eventually appears in Recents. No explicit dependency — they share the same API — but the UX flow connects them.
- **Workflows [+] conflicts with inline creation:** [+] should navigate to `/workflows` (new workflow creation flow) rather than adding an inline form. This avoids the narrow-sidebar form problem.

---

## Section-by-Section Behavior Specification

### 1. New Task/Chat Button

**What it does:** Opens a fresh conversation. Navigates to `/` (ChatPage) and signals to clear current conversation context.

**How to implement:** `useNavigate('/')` + call `chatStore.resetConversation()` or equivalent. The button sits at the top of the sidebar, full-width, prominent (primary color background). Icon: `MessageSquare` or `Plus`.

**UX detail:** If user is already on ChatPage with an active conversation, clicking New Task/Chat starts a new one (does NOT ask "are you sure"). Cowork and ChatGPT both do this — it's the expected behavior. Current conversation is saved to history automatically.

**Complexity:** LOW. The reset mechanism already exists (`chatApi.resetContext`). The ChatPage already handles `conversationId=undefined` as a new chat.

### 2. Search Button

**MVP behavior (v1.0):** Clicking opens an inline input in the sidebar (expands below the button) or navigates to `/history` with the search input auto-focused. Searches only conversation history via `chatApi.listHistory({ search: query })`.

**Full behavior (v1.x, defer):** Global search overlay (cmd+K) — covers conversations, workflows, workspace files, nav items. Similar to Linear's command palette.

**UX anti-pattern to avoid:** Do NOT filter sidebar items in place. Search is a separate mode, not a sidebar filter.

**Complexity:** LOW for MVP (navigate to /history with search), MEDIUM-HIGH for full overlay.

### 3. Customize Button (→ arrow)

**What it does:** Navigates to `/customize`. The arrow icon (→) in the wireframe signals "takes you somewhere", not an in-place toggle.

**What /customize shows:** Full grid of ALL 63+ navigation items, categorized by group (Personal Data, AI & Automation, Tools & Extensions, System, Experimental, Settings). Each item has its icon, label, and a star/pin toggle. Pinned items appear in the sidebar's top area. Search/filter input at the top of the grid.

**UX detail (from Cowork reference screenshot):** The Cowork Customize panel shows skills/connectors in a two-column layout with categories on the left and items on the right. OwnPilot should use the same pattern — category list on left (or tabs), items in grid on right.

**Complexity:** MEDIUM. New page, but mostly rendering existing nav items data.

### 4. Scheduled Section

**What Cowork's "Scheduled" actually is (verified from official sources):** A dedicated page listing recurring tasks — their cadence (hourly/daily/weekly), last run, next run, status, and results. Users can create, pause, resume, delete, or run-on-demand.

**What OwnPilot has:** `tasksApi.list()` with `status` filter. Task type has `dueDate` field. No explicit `recurrence` or `scheduledAt` field confirmed yet — needs schema check.

**MVP behavior (v1.0):** Sidebar item navigates to `/tasks`. A `?filter=scheduled` or `?tab=scheduled` query param can filter to tasks with `dueDate` set or a `recurring` flag. If the tasks schema has no recurring field, the item navigates to CalendarPage (`/calendar`) which shows date-based task view.

**Recommended approach for v1.0:** Navigate to `/tasks` — don't block the sidebar on schema uncertainty. The section label is "Scheduled" but it shows the tasks page which already exists.

**Complexity:** LOW (navigation only). MEDIUM if recurring task schema work is needed (out of scope v1.0).

### 5. Workflows Section [+]

**What it shows:** A flat list of workflow names fetched from `workflowsApi.list({ limit: 10 })`. Each item is a NavLink to `/workflows/:id`. The [+] button calls `workflowsApi.create()` or navigates to `/workflows` with create intent.

**Collapse behavior:** Section header "Workflows" is clickable — collapses/expands the list. State persisted in localStorage. Default: open (matching Cowork behavior where Projects are always visible).

**Empty state:** "No workflows yet. [+] to create."

**Item display:** Workflow name, truncated to 24 chars. Active workflow (running) could show a subtle pulse indicator (v1.x enhancement).

**Complexity:** MEDIUM. Requires API call, loading state, error handling, collapse state.

### 6. Projects Section [+]

**What it shows:** Workspace list from `workspacesApi.list()`. Each workspace = a "project" in Cowork terms. Items navigate to `/workspaces` (existing page) or filter the chat interface to that workspace.

**[+] behavior:** Calls `workspacesApi.create(name)` — prompts for name inline (small input that appears below [+]) or navigates to a creation modal. Inline name input is acceptable here because it's a simple single-field create (just a name string), unlike workflow creation which needs the full editor.

**Complexity:** MEDIUM. Same as Workflows section but with inline create input.

### 7. Recents Section

**What it shows:** 6 most recent conversations from `chatApi.listHistory({ limit: 6 })`. Each item shows the conversation title (or first 30 chars of first message if no title). Clicking navigates to `/?conversationId={id}` (loads that conversation in ChatPage).

**No collapse:** Recents section in Cowork reference shows items without a collapse toggle. Wireframe also has no collapse button on Recents. Keep it always expanded.

**"See all" link:** Small "All conversations →" link at the bottom of the Recents list navigates to `/history`.

**Update trigger:** Recents list refreshes after New Task/Chat is clicked and a message is sent (via WebSocket event or refetch after first message).

**Complexity:** LOW. API already exists. Just need to render and link.

### 8. Section Collapse/Expand Behavior

**Which sections are collapsible:** Workflows and Projects sections (they have [+] buttons and are explicitly collapsible in the wireframe). Recents is NOT collapsible (wireframe shows no toggle).

**Default state:**
- Workflows: open (user wants to see their automations at a glance)
- Projects: open (matching Cowork's default)
- Recents: always open, no toggle

**Persistence:** `localStorage` key `ownpilot-sidebar-sections` as a JSON object `{ workflows: true, projects: true }`. Follows existing `ownpilot_nav_groups` pattern already in Layout.tsx.

**Animation:** Simple height transition (Tailwind `transition-all`). No spring physics needed.

**Complexity:** LOW. Pattern already exists in current CollapsibleGroup component.

### 9. How Cursor, VS Code, Linear, Notion Handle Sidebars (Reference)

| App | New Item | Search | Sections | Recents |
|-----|----------|--------|----------|---------|
| Cursor | [+] at top → new chat immediately | Cmd+K global | Chat tabs (not collapsible) | Recent chats as tab list (no truncation) |
| VS Code | Activity bar icons, no "New chat" button in sidebar | Cmd+P command palette | Explorer/Source Control/Extensions (always open) | No recents in sidebar |
| Linear | "New Issue" button at top | Cmd+K global, inbox | My Issues, Teams, Projects (collapsible, state persisted) | No recents — uses Inbox |
| Notion | "New page" at bottom of sidebar | Cmd+K global | Teamspaces, Shared, Private (collapsible, last-edited sort) | Recently visited pages auto-listed |
| Cowork | "New task" in top area | "Search" button at top of sidebar | Scheduled, Dispatch, Customize (fixed), Projects (dynamic) | None visible — uses task list |

**Key observation from Cowork reference screenshot (verified):** The sidebar has fixed items at top (New task, Search, Scheduled, Dispatch, Customize) and a "Projects" dynamic section below. There is NO recents section in Cowork. OwnPilot's wireframe adds Recents — this is an OwnPilot differentiator.

---

## MVP Definition

### Launch With (v1.0 — this milestone)

- [ ] New Task/Chat button — navigates to `/`, clears conversation state. Essential entry point.
- [ ] Search button — navigates to `/history` with search param. MVP: no overlay, just route change.
- [ ] Customize button — navigates to `/customize`. Opens the items grid.
- [ ] Scheduled item — navigates to `/tasks`. No new schema work.
- [ ] Workflows section — API-fetched list, collapse state, [+] navigates to `/workflows`.
- [ ] Projects section — API-fetched list, collapse state, inline [+] create with name input.
- [ ] Recents section (always open) — 6 items from `chatApi.listHistory`, links to conversations.
- [ ] /customize page — categorized grid of ALL nav items, pin/unpin, localStorage persistence.
- [ ] usePinnedItems hook — pin state management, default `["/", "/customize"]`, max 15.
- [ ] Sidebar renders pinned items in top area (above Workflows section).
- [ ] Section collapse state in localStorage.
- [ ] Playwright E2E tests covering: new chat, navigate to /customize, pin an item, verify in sidebar, navigate to workflow.

### Add After Validation (v1.x)

- [ ] Search overlay (cmd+K) with multi-type results — add when user feedback confirms navigate-to-history is insufficient.
- [ ] Recents auto-refresh on new conversation — add after confirming WebSocket event exists for conversation creation.
- [ ] Workflow quick status indicator (running/idle) in sidebar item — add when workflow monitoring use case is validated.
- [ ] Section item count badges — add when analytics show users want this signal.
- [ ] Projects inline create UX polish — smooth animation, optimistic update.

### Future Consideration (v2+)

- [ ] Drag-drop reordering in /customize and pinned items — defer until dnd-kit is evaluated and mobile UX is tested.
- [ ] Global search overlay with cmd+K — defer to after core search usage pattern is confirmed.
- [ ] Workflow quick-run from sidebar hover — defer to workflow-centric milestone.
- [ ] Scheduled tasks as a first-class page with recurrence UI — defer to productivity milestone.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| New Task/Chat button | HIGH | LOW | P1 |
| Recents section (6 items) | HIGH | LOW | P1 |
| /customize page with pin/unpin | HIGH | MEDIUM | P1 |
| Workflows section | HIGH | MEDIUM | P1 |
| Projects section | HIGH | MEDIUM | P1 |
| Customize navigation button | HIGH | LOW | P1 |
| Section collapse/expand + localStorage | MEDIUM | LOW | P1 |
| Search button (MVP: navigate to /history) | MEDIUM | LOW | P1 |
| Scheduled item (MVP: navigate to /tasks) | MEDIUM | LOW | P1 |
| usePinnedItems hook | HIGH | LOW | P1 (dependency for /customize) |
| nav-items.ts extraction | LOW (internal) | LOW | P1 (dependency for /customize) |
| Playwright E2E suite | HIGH (quality gate) | MEDIUM | P1 |
| Search overlay cmd+K | MEDIUM | HIGH | P3 |
| Drag-drop reordering | LOW | HIGH | P3 |
| Workflow quick-run from sidebar | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (v1.0 milestone)
- P2: Should have, add when possible (v1.x)
- P3: Nice to have, future consideration (v2+)

---

## Competitor Feature Analysis

| Feature | Cowork (Anthropic) | Linear | Notion | OwnPilot v1.0 Plan |
|---------|-------------------|--------|--------|---------------------|
| New item CTA at top | "New task" button | "New Issue" button | "New page" at bottom | "New Task/Chat" button — top, full-width |
| Search | Sidebar button, app-wide | Cmd+K global palette | Cmd+K global palette | Sidebar button → /history with search (MVP), overlay later |
| Custom section browse | "Customize" panel with skills grid | Settings → no equivalent | Sidebar rearrange | /customize page with categorized grid, pin/unpin |
| Scheduled/Recurring | Full "Scheduled" page — recurring tasks | Cycles view | Recurring pages (limited) | Navigate to /tasks (MVP), full recurring UI v2 |
| Dynamic workflow section | No workflows concept | "Teams/Projects" sections | Databases/pages | Workflows section from API |
| Dynamic workspace/projects | "Projects" section from local storage | Projects section | Workspaces | Projects section from workspacesApi |
| Recents | NOT present in sidebar | Not in sidebar | Auto-listed recent pages | Recents section, 6 items, always open — OwnPilot differentiator |
| Sidebar width | ~220px (estimated from screenshot) | ~240px | 224px (confirmed) | w-56 = 224px (matches Notion standard) |
| Section collapse | Fixed sections, no collapse | Collapsible, state persisted | Collapsible, state persisted | Collapsible for Workflows + Projects, state in localStorage |

---

## Implementation Notes for Roadmap

### Pre-requisite (must be done first, ~10 lines)
Extract nav items from Layout.tsx to `constants/nav-items.ts`. Pure refactor. No behavior change. This unblocks both the sidebar new render and CustomizePage. Already named F1.5 in previous planning.

### Critical path
```
F1.5 nav-items.ts extract
  → usePinnedItems hook (F1.1)
    → New sidebar render in Layout.tsx (F1.2) — pinned items + fixed sections
  → CustomizePage.tsx (F1.3)
    → /customize route in App.tsx (F1.4)
→ Workflows section component (F2.1)
→ Projects section component (F2.2)
→ Recents section component (F2.3)
→ Playwright E2E (F3.x)
```

### Layout.tsx surgery
The new Layout.tsx sidebar will have this structure:
1. Fixed top buttons: [New Task/Chat] [Search] [Customize →] [Scheduled]
2. Pinned items (from usePinnedItems) — rendered as NavLinks
3. Divider
4. WorkflowsSection (collapsible, API-fetched)
5. ProjectsSection (collapsible, API-fetched, inline [+])
6. Divider
7. RecentsSection (always open, 6 items)
8. Bottom: About, Profile, LogOut, ConnectionIndicator

The existing CollapsibleGroup component can be repurposed for Workflows and Projects sections. The existing NavItemLink component is reused for pinned items.

### API calls needed per sidebar render
- `workflowsApi.list({ limit: 10 })` — on mount
- `workspacesApi.list()` — on mount
- `chatApi.listHistory({ limit: 6 })` — on mount

All three are small JSON responses. Parallel fetch (Promise.all) on sidebar mount. No SSE/WebSocket subscriptions needed for v1.0 — static load is sufficient.

### /customize page grid
- Categories correspond to existing navGroups: Personal Data, AI & Automation, Tools & Extensions, System, Experimental, Settings
- Left sidebar: category list (or tab bar on mobile)
- Right grid: items for selected category, 3-column on desktop, 2-column on mobile
- Each item: 48x48 card with icon + label + pin toggle (filled star = pinned, outline = not pinned)
- Filter input at top: client-side filter on label string
- Pin count indicator: "X / 15 pinned"

---

## Sources

- Wireframe: `/home/ayaz/Downloads/Ekran Resmi 2026-03-28 11.42.21.png` (hand-drawn, authoritative for this project)
- Cowork sidebar screenshot: `/home/ayaz/Downloads/Ekran Resmi 2026-03-27 12.49.14.png` (Cowork with "The Planner" project open)
- Cowork Customize screenshot: `/home/ayaz/Downloads/Ekran Resmi 2026-03-27 17.01.04.png` (Skills grid in Customize panel)
- [Schedule recurring tasks in Cowork — official Claude Help Center](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-cowork) — HIGH confidence
- [Navigate with the sidebar — Notion Help Center](https://www.notion.com/help/navigate-with-the-sidebar) — HIGH confidence
- [How we redesigned the Linear UI — Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) — HIGH confidence
- [Best UX Practices for Sidebar Menu Design in 2025](https://uiuxdesigntrends.com/best-ux-practices-for-sidebar-menu-in-2025/) — MEDIUM confidence
- Existing codebase: `packages/ui/src/components/Layout.tsx`, `packages/ui/src/api/endpoints/`, `packages/ui/src/constants/storage-keys.ts` — HIGH confidence (read directly)
- Previous planning: `~/.claude/projects/-home-ayaz/memory/ownpilot-ui-roadmap.md` — HIGH confidence (prior session decisions)

---
*Feature research for: OwnPilot Sidebar Overhaul — Cowork-style structural sidebar*
*Researched: 2026-03-27*
