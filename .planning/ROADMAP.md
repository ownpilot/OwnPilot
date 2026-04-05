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

## Milestone v2.0: Contextual Sidebar Chat

**Goal:** StatsPanel (sag panel) Stats | Chat tab'li yapiya donusur. Sidebar'dan bir ogeye tiklandiginda chat o ogenin baglaminda (dizin, ID, metadata) calisir. Bridge uzerinden CC/OpenCode/Codex/Gemini ile baglamsal konusma.

**Branch:** feature/contextual-sidebar-chat
**Handoff:** ~/Downloads/session-handoff-2026-04-05-s6.md
**Key Insight:** StatsPanel zaten persistent aside (route degisikliginde yikilmaz), expand/collapse toggle var, WS updates aliyor — contextual chat icin yapisal olarak cok uygun.

**Architecture Reference:**
```
Layout.tsx (4-panel shell)
  [Sidebar]       ← Baglam kaynagi (workspace/workflow/agent tiklama)
  [Main <Outlet>] ← Sayfa icerigi
  [StatsPanel]    ← HEDEF: Stats | Chat tab'li yapi
  [MiniChat]      ← Floating widget (StatsPanel Chat varsa redundant olabilir)
```

**Key Files:**
- packages/ui/src/components/StatsPanel.tsx (374 LOC) — donusturulecek
- packages/ui/src/components/MiniChat.tsx (537 LOC) — referans chat UI
- packages/ui/src/hooks/useChatStore.tsx (656 LOC) — global chat state
- packages/ui/src/components/Layout.tsx (257 LOC) — panel orkestrasyonu
- packages/ui/src/constants/sidebar-sections.ts (317 LOC) — 23 data section registry

**Dizin/Baglam Availability Tablosu:**
| Sidebar Section | Dizin Context? | Kaynak |
|----------------|----------------|--------|
| workspaces | YES: FileWorkspaceInfo.path | GET /file-workspaces/{id} |
| coding-agents | YES: session.cwd | GET /coding-agents/{id} |
| claws | YES: .claw/ workspace | Claw config |
| workflows | NO: DB-stored | metadata only |
| agents | NO: config-based | N/A |
| tasks/notes/etc | NO: personal data | N/A |

## Phases

- [ ] **Phase 11: Workspace Protocol Research** — Workspace'lerin calisma protokolunu arastir: FileWorkspace path nasil resolve ediliyor, chat request'e nasil aktariliyor, bridge X-Project-Dir ile nasil eslesiyor, workspace create/select/switch lifecycle, WorkspaceSelector component akisi, sandbox vs host-fs workspace farki. Karar dokumani uret
- [ ] **Phase 12: StatsPanel Tab System** — Stats | Chat tab switcher, tab state persistence (localStorage), Chat tab placeholder
- [ ] **Phase 13: Compact Chat UI** — MiniChat-benzeri compact message list + input in StatsPanel Chat tab, useChatStore() baglantisi, genislik ayari (w-64 → w-80)
- [ ] **Phase 14: Context Detection** — Route degisikliginde aktif sayfa/oge baglam tespiti, context banner (aktif workspace/agent gosterimi), context change event
- [ ] **Phase 15: Context Injection** — Chat request'e X-Project-Dir header inject (workspace path varsa), baglam degistiginde otomatik ilk mesaj veya prepopulate
- [ ] **Phase 16: Multi-Session Research** — useChatStore tek global context → coklu context arastirmasi, MiniChat vs StatsPanel Chat session izolasyonu karari
- [ ] **Phase 17: E2E Tests** — Playwright: tab switching, contextual chat, workspace baglam injection, message send/receive

### Phase 11: Workspace Protocol Research
**Goal**: Workspace'lerin calisma protokolunu derinlemesine arastir. FileWorkspace path nasil resolve ediliyor, chat request'e nasil aktariliyor, bridge X-Project-Dir ile nasil eslesiyor, workspace lifecycle (create/select/switch), WorkspaceSelector component akisi, sandbox workspace vs host-fs workspace farki.
**Depends on**: Nothing (pure research — bagimsiz, ilk phase olabilir)
**Requirements**: CTX-00
**Success Criteria**:
  1. FileWorkspace API akisi dokumanlastirilir: create → path resolve → file listing → chat context
  2. WorkspaceSelector component akisi haritalanir: UI select → useChatStore.workspaceId → request body
  3. Bridge tarafinda X-Project-Dir nasil islenir dokumanlastirilir: header → spawn cwd
  4. Sandbox workspace (Docker volume) vs host-fs workspace (OWNPILOT_HOST_FS bind mount) farki aciklanir
  5. Chat request'e workspace path inject etmenin en uygun yontemi belirlenir (header vs body vs gateway resolve)
  6. Karar dokumani yazilir: RESEARCH.md veya WORKSPACE-PROTOCOL.md
**Plans**: TBD

### Phase 12: StatsPanel Tab System
**Goal**: StatsPanel ustune Stats | Chat tab switcher eklenir. Tab state localStorage'da persist eder. Chat tab bos placeholder gosterir.
**Depends on**: v1.1 Phase 10 (veya bagimsiz — StatsPanel zaten stabil)
**Requirements**: CTX-01, CTX-02
**Success Criteria**:
  1. StatsPanel'de iki tab gorulur: "Stats" ve "Chat"
  2. Stats tab mevcut StatsPanel icerigini gosterir (regression yok)
  3. Chat tab placeholder mesaj gosterir ("Chat coming soon" veya benzeri)
  4. Tab secimi localStorage'da persist eder (sayfa refresh sonrasi korunur)
  5. Collapse/expand davranisi her iki tab icin calisir
**Plans**: TBD

### Phase 13: Compact Chat UI
**Goal**: Chat tab'inda MiniChat benzeri compact chat arayuzu render edilir. useChatStore() ile baglanir. Mesaj gonderme ve alma calisir.
**Depends on**: Phase 12
**Requirements**: CTX-03, CTX-04
**Success Criteria**:
  1. Chat tab'inda mesaj listesi gorunur (scrollable)
  2. Alt kisimda mesaj input alani var
  3. Mesaj gonderildiginde SSE stream ile yanit gelir
  4. Provider/model secimi ChatPage ile paylasilan state'den gelir
  5. StatsPanel genisligi chat icin yeterli (w-80 = 320px minimum)
**Plans**: TBD

### Phase 14: Context Detection
**Goal**: Sidebar'dan bir ogeye tiklandiginda veya route degistiginde, aktif baglam (workspace, agent, claw) tespit edilir ve Chat tab'inda gosterilir.
**Depends on**: Phase 13
**Requirements**: CTX-05, CTX-06
**Success Criteria**:
  1. Workspace sayfasinda bir workspace tiklandiginda, Chat tab context banner'inda workspace adi gorunur
  2. Coding-agents sayfasinda bir session tiklandiginda, cwd bilgisi context banner'da gorunur
  3. Baglam olmayan sayfalarda (tasks, notes) context banner gizlenir
  4. Route degisikligi context'i otomatik gunceller
**Plans**: TBD

### Phase 15: Context Injection
**Goal**: Tespit edilen baglam chat request'e inject edilir — X-Project-Dir header'i veya otomatik ilk mesaj.
**Depends on**: Phase 14
**Requirements**: CTX-07, CTX-08
**Success Criteria**:
  1. Workspace baglami varken gonderilen mesajda X-Project-Dir header'i dogru dizini icerir
  2. Bridge spawn'i o dizinde calisir (git log, dosya okuma o dizinden yapilir)
  3. Baglam degistiginde yeni conversation baslatilir (eski context karistirilmaz)
  4. Opsiyonel: Ilk mesaj otomatik olarak "Bu workspace/proje hakkinda bilgi ver" seklinde prepopulate edilir
**Plans**: TBD

### Phase 16: Multi-Session Research
**Goal**: useChatStore tek global singleton — StatsPanel Chat ve MiniChat ve ChatPage AYNI conversation'i paylasir. Bu uygun mu? Alternatifler arastirilir ve mimari karar dokumanlastirilir.
**Depends on**: Phase 13
**Requirements**: CTX-09
**Success Criteria**:
  1. Mimari karar dokumani yazilir: tek store vs coklu store
  2. Secilen yaklasim implement edilir (veya gelecek phase'e ertelenir)
  3. Bridge X-Conversation-Id ile session izolasyonu test edilir
**Plans**: TBD

### Phase 17: E2E Tests
**Goal**: Playwright ile tum contextual chat ozelliklerinin E2E testi.
**Depends on**: Phase 15
**Requirements**: CTX-10, CTX-11
**Success Criteria**:
  1. Tab switching testi: Stats → Chat → Stats gecisilir, state korunur
  2. Mesaj gonderme testi: Chat tab'inda mesaj gonderilir, yanit alinir
  3. Context injection testi: Workspace sayfasinda chat yapilir, bridge dogru dizinde calisir
  4. Regression testi: MiniChat, ChatPage, StatsPanel Stats tab'i bozulmamis
**Plans**: TBD

## Progress (v2.0)

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 11. Workspace Protocol Research | 1/1 | Complete | 2026-04-05 |
| 12. StatsPanel Tab System | 1/1 | Complete | 2026-04-05 |
| 13. Compact Chat UI | 1/1 | Complete | 2026-04-05 |
| 14. Context Detection | 1/1 | Complete | 2026-04-05 |
| 15. Context Injection | 1/1 | Complete | 2026-04-05 |
| 16. Multi-Session Research | 1/1 | Complete | 2026-04-05 |
| 17. E2E Tests | 1/1 | Complete | 2026-04-05 |

---
*Roadmap created: 2026-03-28 — v1.0 complete*
*Updated: 2026-03-29 — v1.1 milestone started (6 phases)*
*Updated: 2026-04-05 — v2.0 Contextual Sidebar Chat milestone added (7 phases, Phase 11: Workspace Protocol Research)*
*Updated: 2026-04-05 — v2.0 all 7 phases complete (Phase 11-17, branch: feature/v2-contextual-chat)*
