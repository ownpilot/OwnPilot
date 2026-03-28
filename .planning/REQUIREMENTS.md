# Requirements: OwnPilot UI Redesign

**Defined:** 2026-03-28
**Core Value:** Sidebar'da sadece kullanicinin ihtiyac duydugu sey gorunur

## v1.0 Requirements

Requirements for sidebar overhaul. Each maps to roadmap phases.

### Sidebar

- [ ] **SB-01**: User sees only pinned items in sidebar (not 63-item list)
- [ ] **SB-02**: Customize link is always visible in sidebar
- [ ] **SB-03**: User sees "Recents" section with last 6 conversations
- [ ] **SB-04**: User can click a recent conversation to load it
- [ ] **SB-05**: Default pinned items appear on first load (Chat, Dashboard, Customize)
- [ ] **SB-06**: Sidebar state persists across page refresh (localStorage)
- [ ] **SB-07**: Mobile sidebar preserves slide-in/backdrop behavior

### Customize Page

- [ ] **CZ-01**: User can view all available pages in categorized grid
- [ ] **CZ-02**: User can pin/unpin items via star toggle
- [ ] **CZ-03**: Pinned items immediately appear/disappear in sidebar
- [ ] **CZ-04**: User can search/filter items by name
- [ ] **CZ-05**: Pin limit (max 15) shows warning toast

### Infrastructure

- [ ] **INF-01**: Nav items extracted to shared constants (sidebar + customize reuse)
- [ ] **INF-02**: localStorage keys registered in STORAGE_KEYS (no raw strings)
- [ ] **INF-03**: Old nav group localStorage state handled gracefully (migration)

### Testing

- [ ] **TST-01**: Playwright E2E: sidebar renders pinned items correctly
- [ ] **TST-02**: Playwright E2E: pin/unpin from Customize page works
- [ ] **TST-03**: Playwright E2E: Recents section shows conversations
- [ ] **TST-04**: Playwright E2E: mobile sidebar slide-in works
- [ ] **TST-05**: Playwright E2E: Customize page grid + search works
- [ ] **TST-06**: TypeScript typecheck passes (pnpm run typecheck)

## v1.1 Requirements

Deferred to next milestone. Tracked but not in current roadmap.

### Sidebar Enhancements

- **SB-08**: New Task/Chat button in sidebar top section
- **SB-09**: Search button/input in sidebar
- **SB-10**: Scheduled link in sidebar
- **SB-11**: Workflows [+] dynamic section (workflowsApi)
- **SB-12**: Projects [+] dynamic section (fileWorkspacesApi)
- **SB-13**: Drag-drop reorder for pinned items

### Right Panel

- **RP-01**: RightPanel tab infrastructure (Stats | Chat | Files)
- **RP-02**: Context chat panel
- **RP-03**: File preview with Shiki

## Out of Scope

| Feature | Reason |
|---------|--------|
| RightPanel changes | Baglamsal tasarim gerekiyor, ayri milestone |
| .ownpilot/ config editor | v1.5+ scope |
| Context chat injection | v2.0 scope |
| File preview + Shiki | v1.5 scope |
| Backend changes | Sidebar is frontend-only, APIs already exist |
| Drag-drop reorder | v1.1+ complexity |
| Global cmd+K search overlay | v1.1+ |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SB-01 | Phase 2 | Pending |
| SB-02 | Phase 2 | Pending |
| SB-03 | Phase 2 | Pending |
| SB-04 | Phase 2 | Pending |
| SB-05 | Phase 1 | Pending |
| SB-06 | Phase 1 | Pending |
| SB-07 | Phase 1 | Pending |
| CZ-01 | Phase 3 | Pending |
| CZ-02 | Phase 3 | Pending |
| CZ-03 | Phase 3 | Pending |
| CZ-04 | Phase 3 | Pending |
| CZ-05 | Phase 3 | Pending |
| INF-01 | Phase 1 | Pending |
| INF-02 | Phase 1 | Pending |
| INF-03 | Phase 1 | Pending |
| TST-01 | Phase 4 | Pending |
| TST-02 | Phase 4 | Pending |
| TST-03 | Phase 4 | Pending |
| TST-04 | Phase 4 | Pending |
| TST-05 | Phase 4 | Pending |
| TST-06 | Phase 4 | Pending |

**Coverage:**
- v1.0 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-27 — traceability filled after roadmap creation*
