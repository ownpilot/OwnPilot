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

## Milestone v2.1: Contextual Chat — Full Implementation

**Goal:** v2.0 research + scaffold'i production-ready hale getir. Her sayfada sidebar chat o sayfanin baglaminda calisir: path olan sayfalarda (workspace, coding-agent, claw) bridge CLI spawn ile dosya erisimi, path olmayan sayfalarda (workflow, agent, tools) direkt LLM API ile context data injection. Docker bind mount + path mapping ile host dosya sistemi erisimi.

**Branch:** feature/v2.1-contextual-impl
**Depends on:** v2.0 (Phase 11-17 complete)
**Research docs:**
- `.planning/phases/11-workspace-protocol/RESEARCH.md` (workspace protocol)
- `.planning/phases/11-workspace-protocol/BRIDGE-DIRECTORY-ROUTING-RESEARCH.md` (CLI tools, spawn CWD, security)
- `.planning/phases/11-workspace-protocol/CONTEXTUAL-CHAT-ARCHITECTURE.md` (full architecture)
- `.planning/phases/16-multi-session/RESEARCH.md` (multi-session, Dedicated SidebarChatStore)

**Architecture Decision Records:**
- Path var → Bridge CLI spawn (o dizinde) → dosya erisimi, git, terminal
- Path yok → Direkt LLM API → context data system prompt'a inject
- Docker: bind mount `/home/ayaz:/host-home:rw` + path mapping
- Chat state: Dedicated SidebarChatStore (ChatPage/MiniChat'ten bagimsiz)
- Context: Session-based (ilk mesajda gonder, sonrakilerde conversationId ile resolve)
- Hibrit provider: Otomatik secim (path → bridge, no-path → LLM API)

**Key Insight:** Gateway `context-injection.ts` pipeline %80 hazir — sadece `## Page Context` section builder + path mapping eklenmesi gerekiyor.

### Wave Map (Dependency Order)

```
Wave 1 (Foundation — parallel, bagimsiz):
  Phase 18: SidebarChatStore        ← UI, bagimsiz
  Phase 19: Page Copilot Registry   ← UI, bagimsiz
  Phase 20: Docker Host-FS Setup    ← DevOps, bagimsiz

Wave 2 (Gateway Pipeline — Wave 1 sonrasi):
  Phase 21: Path Mapping Utility    ← Gateway, depends: Phase 20
  Phase 22: pageContext Injection   ← Gateway, depends: Phase 21
  Phase 23: X-Project-Dir Forward   ← Gateway, depends: Phase 22

Wave 3 (Integration — Wave 2 sonrasi):
  Phase 24: Hybrid Provider Route   ← Gateway+UI, depends: Phase 22-23
  Phase 25: Per-Page Prompts        ← Gateway, depends: Phase 24
  Phase 26: UI Polish               ← UI, depends: Phase 18-19, 24

Wave 4 (Quality — Wave 3 sonrasi):
  Phase 27: Bridge Security         ← Bridge, depends: nothing (parallel)
  Phase 28: E2E Integration Tests   ← Test, depends: Phase 26
  Phase 29: Docker Build + Deploy   ← DevOps, depends: Phase 28
```

## Phases

- [ ] **Phase 18: Dedicated SidebarChatStore** — ChatPage/MiniChat'ten bagimsiz chat store. Kendi messages, sessionId, provider, model, isLoading state'i. contextPath ile otomatik conversation reset. useChatStore'a dokunmadan bagimsiz calisir
- [ ] **Phase 19: Page Copilot Registry** — Route → context config mapping. Per-page: resolveContext(), suggestions[], actions[], systemPromptHint. usePageCopilotContext() hook. 23 sidebar section icin config
- [ ] **Phase 20: Docker Host-FS Setup** — `/home/ayaz:/host-home:rw` bind mount. OWNPILOT_HOST_FS + OWNPILOT_HOST_FS_HOST_PREFIX env vars. Docker compose guncelleme. Container restart + verify
- [ ] **Phase 21: Gateway Path Mapping** — `toHostPath()` / `toContainerPath()` utility. OWNPILOT_HOST_FS env var'dan prefix cozumleme. Container path ↔ host path donusumu
- [ ] **Phase 22: Gateway pageContext Injection** — `buildPageContextSection()` fonksiyonu. context-injection.ts'e entegrasyon. pageContext field'i chat request body'de. Validation schema guncelleme
- [ ] **Phase 23: Gateway X-Project-Dir Forwarding** — pageContext.path varsa → toHostPath() → X-Project-Dir header. agent-cache.ts'de bridge request'e ekleme. Sadece bridge provider'lar icin
- [ ] **Phase 24: Hybrid Provider Routing** — Path var → bridge provider (auto). Path yok → direkt LLM API (copilot pattern). Provider secimi: otomatik + manual override. Gateway chat route'da routing logic
- [ ] **Phase 25: Per-Page Copilot Prompts** — Workflow copilot prompt (24 node type). Agent config copilot prompt. Tool/extension copilot prompt. MCP server copilot prompt. Her sayfa icin domain-specific system prompt section
- [ ] **Phase 26: UI Polish** — Registry-based suggestions. Per-context action buttons (Apply, Create, Run). Context banner gelistirme. Streaming cancel (AbortController). Provider selector (bridge vs LLM API)
- [ ] **Phase 27: Bridge Security Fixes** — validateProjectDir'a realpathSync() ekleme (symlink). additionalDirs path validation. Default CWD daraltma (/home/ayaz/ → /home/ayaz/ownpilot/)
- [ ] **Phase 28: E2E Integration Tests** — Workspace context: chat → bridge spawn → dosya erisimi. Workflow context: chat → LLM API → JSON cikti. Sayfa gecisi: context reset → yeni conversation. Docker path mapping: container → host → CLI
- [ ] **Phase 29: Docker Build + Deploy** — Bind mount ile yeni image. Container restart. Smoke test: workspace chat + workflow chat. ROADMAP progress guncelleme

### Phase 18: Dedicated SidebarChatStore
**Goal:** StatsPanel CompactChat icin ChatPage/MiniChat'ten tamamen bagimsiz chat store. Kendi messages, sessionId, provider, model state'i. Context degistiginde otomatik sifirlama.
**Depends on:** Phase 16 research (Alternative D: Dedicated SidebarChatStore)
**Requirements:** CTX-12
**Success Criteria:**
  1. useSidebarChat() hook calisiyor, useChatStore()'dan bagimsiz
  2. StatsPanel CompactChat useSidebarChat() kullaniyor
  3. ChatPage'de mesaj gonderince sidebar chat ETKILENMIYOR
  4. Sidebar'da mesaj gonderince ChatPage ETKILENMIYOR
  5. contextPath degisince sidebar messages temizleniyor + yeni session
**Plans:** TBD

### Phase 19: Page Copilot Registry
**Goal:** Her sayfa icin context config, suggestions ve actions tanimlayan registry. usePageCopilotContext() hook ile route'dan otomatik resolution.
**Depends on:** Phase 14 (usePageContext hook)
**Requirements:** CTX-13
**Success Criteria:**
  1. page-copilot-registry.ts 23 section icin config iceriyor
  2. usePageCopilotContext() route'a gore dogru config donduruyor
  3. Her section icin en az 3 context-aware suggestion var
  4. Path olan sections icin resolveContext() async cagri yapiliyor
  5. Path olmayan sections icin contextData (definition, config) donduruluyor
**Plans:** TBD

### Phase 20: Docker Host-FS Setup
**Goal:** Container icinden host dosya sistemine erisim icin bind mount. OWNPILOT_HOST_FS env var ile gateway'e host-fs konumunu bildirme.
**Depends on:** Nothing (DevOps, bagimsiz)
**Requirements:** CTX-14
**Success Criteria:**
  1. Docker compose'da `/home/ayaz:/host-home:rw` volume mount eklendi
  2. OWNPILOT_HOST_FS=/host-home env var set edildi
  3. OWNPILOT_HOST_FS_HOST_PREFIX=/home/ayaz env var set edildi
  4. Container restart sonrasi `/host-home/` icinden host dosyalari gorunuyor
  5. `docker exec ownpilot ls /host-home/projects/` calisiyor
**Plans:** TBD

### Phase 21: Gateway Path Mapping
**Goal:** Container path ↔ host path donusumu. toHostPath('/host-home/projects/x') → '/home/ayaz/projects/x'.
**Depends on:** Phase 20
**Requirements:** CTX-15
**Success Criteria:**
  1. host-path.ts utility dosyasi olusturuldu
  2. toHostPath() container → host donusumu calisiyor
  3. toContainerPath() host → container donusumu calisiyor
  4. OWNPILOT_HOST_FS env var yoksa null donuyor (graceful degradation)
  5. Unit testler: 5+ senaryo PASS
**Plans:** TBD

### Phase 22: Gateway pageContext Injection
**Goal:** context-injection.ts pipeline'ina ## Page Context section builder eklemek. Chat request body'de pageContext field'i kabul etmek.
**Depends on:** Phase 21
**Requirements:** CTX-16
**Success Criteria:**
  1. buildPageContextSection() fonksiyonu olusturuldu
  2. context-injection.ts'de DYNAMIC block'a eklendi
  3. Chat request body'de pageContext field'i kabul ediliyor
  4. Validation schema (workflowCopilotSchema benzeri) guncellendi
  5. System prompt'ta ## Page Context gorunuyor (debug endpoint ile dogrulama)
**Plans:** TBD

### Phase 23: Gateway X-Project-Dir Forwarding
**Goal:** pageContext.path varsa → toHostPath() → X-Project-Dir header olarak bridge request'e ekleme.
**Depends on:** Phase 21, 22
**Requirements:** CTX-17
**Success Criteria:**
  1. Bridge provider request'inde X-Project-Dir header'i mevcut
  2. Path mapping dogru calisiyor (container path → host path)
  3. Non-bridge provider'larda X-Project-Dir EKLENMEZ
  4. Path yoksa header EKLENMEZ (null safety)
  5. Bridge tarafinda CLI dogru CWD'de spawn oluyor
**Plans:** TBD

### Phase 24: Hybrid Provider Routing
**Goal:** Path olan sayfalarda otomatik bridge provider secimi, path olmayan sayfalarda direkt LLM API.
**Depends on:** Phase 22, 23
**Requirements:** CTX-18
**Success Criteria:**
  1. Workspace sayfasinda sidebar chat bridge provider'i otomatik seciyor
  2. Workflow sayfasinda sidebar chat LLM API'yi otomatik seciyor
  3. Kullanici manual override yapabiliyor (bridge → LLM veya LLM → bridge)
  4. LLM API path'inda copilot-benzeri SSE streaming calisiyor
  5. Bridge path'inda mevcut chat pipeline calisiyor
**Plans:** TBD

### Phase 25: Per-Page Copilot Prompts
**Goal:** Her sayfa turu icin domain-specific system prompt section'lari. Workflow: 24 node type. Agent: config best practices. Tool: schema + usage.
**Depends on:** Phase 24
**Requirements:** CTX-19
**Success Criteria:**
  1. Workflow copilot prompt (mevcut workflow-copilot-prompt.ts reuse)
  2. Agent configuration prompt (system prompt optimization, tool selection)
  3. Tool/extension prompt (code generation, schema, test patterns)
  4. MCP server prompt (connection diagnostics, tool discovery)
  5. Her prompt en az 1 pratik test ile dogrulanmis (AI mantikli yanit veriyor)
**Plans:** TBD

### Phase 26: UI Polish
**Goal:** Sidebar chat UX iyilestirmeleri — suggestions, action buttons, context banner, streaming cancel.
**Depends on:** Phase 18, 19, 24
**Requirements:** CTX-20
**Success Criteria:**
  1. Per-page suggestions registry'den gorunuyor
  2. "Apply" / "Create" / "Run" action buttons (Copilot pattern)
  3. Context banner: ikon + isim + path (truncated)
  4. Streaming cancel butonu (AbortController)
  5. Provider selector dropdown (bridge vs LLM API)
  6. MarkdownContent rendering (Copilot'tan) ← plain text yerine
**Plans:** TBD

### Phase 27: Bridge Security Fixes
**Goal:** Directory routing guvenlik aciklari kapatma (symlink bypass, additionalDirs validation).
**Depends on:** Nothing (paralel calisabilir)
**Requirements:** CTX-21
**Success Criteria:**
  1. validateProjectDir'a realpathSync() eklendi
  2. Symlink bypass testi: FAIL (symlink path reddedilir)
  3. additionalDirs her entry icin validateProjectDir() calisiyor
  4. Default CWD daraltildi (config.ts)
  5. Mevcut bridge testler PASS (regression yok)
**Plans:** TBD

### Phase 28: E2E Integration Tests
**Goal:** Uctan uca contextual chat akisi testleri.
**Depends on:** Phase 26
**Requirements:** CTX-22
**Success Criteria:**
  1. Workspace chat: sayfa ac → sidebar chat → mesaj gonder → yanit al
  2. Workflow chat: sayfa ac → sidebar chat → workflow JSON yaniti
  3. Sayfa gecisi: context reset → eski mesajlar temizlenir
  4. Provider routing: workspace=bridge, workflow=LLM otomatik secim
  5. Context banner: dogru ikon, isim, path gorunuyor
**Plans:** TBD

### Phase 29: Docker Build + Deploy
**Goal:** Bind mount ile production Docker image. Smoke test.
**Depends on:** Phase 28
**Requirements:** CTX-23
**Success Criteria:**
  1. Docker build basarili (bind mount volume config)
  2. Container restart + healthy
  3. Workspace sidebar chat → bridge spawn → dosya listesi
  4. Workflow sidebar chat → LLM API → JSON cikti
  5. ROADMAP progress tablosu tamamen guncel
**Plans:** TBD

## Progress (v2.1)

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 18. SidebarChatStore | 1/1 | Complete | 2026-04-06 |
| 19. Page Copilot Registry | 1/1 | Complete | 2026-04-06 |
| 20. Docker Host-FS Setup | 1/1 | Complete | 2026-04-06 |
| 21. Gateway Path Mapping | 1/1 | Complete | 2026-04-06 |
| 22. pageContext Injection | 1/1 | Complete | 2026-04-06 |
| 23. X-Project-Dir Forward | 1/1 | Complete | 2026-04-06 |
| 24. Hybrid Provider Route | 1/1 | Complete | 2026-04-06 |
| 25. Per-Page Prompts | 1/1 | Complete | 2026-04-06 |
| 26. UI Polish | 1/1 | Complete | 2026-04-06 |
| 27. Bridge Security | 1/1 | Complete | 2026-04-06 |
| 28. E2E Integration Tests | 1/1 | Complete | 2026-04-06 |
| 29. Docker Build + Deploy | 1/1 | Complete | 2026-04-06 |

---
*Roadmap created: 2026-03-28 — v1.0 complete*
*Updated: 2026-03-29 — v1.1 milestone started (6 phases)*
*Updated: 2026-04-05 — v2.0 Contextual Sidebar Chat milestone added (7 phases, Phase 11: Workspace Protocol Research)*
*Updated: 2026-04-05 — v2.0 all 7 phases complete (Phase 11-17, branch: feature/v2-contextual-chat)*
*Updated: 2026-04-06 — v2.1 Contextual Chat Full Implementation milestone added (12 phases, 4 waves)*
