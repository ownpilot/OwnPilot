# OwnPilot UI Redesign

## What This Is

OwnPilot, privacy-first kisisel AI asistan platformu. TypeScript monorepo (React 19 + Vite 7 + Tailwind 4). Mevcut UI kaotik — 63 menu item'lik sidebar, kullanilabilirlik dusuk. Bu milestone Cowork tarzi yapisal sidebar + Customize sayfasi ile UI'i sadelelestiriyor.

## Core Value

Sidebar'da sadece kullanicinin ihtiyac duydugu sey gorunur — gerisi bir tikla erisilebilir ama gormesine gerek yok.

## Current Milestone: v1.0 Sidebar Overhaul

**Goal:** 63-item kaotik sidebar → Cowork tarzi yapisal sidebar + Customize sayfasi

**Target features:**
- Sidebar: New Task/Chat butonu, Search, Customize, Scheduled (sabit ust kisim)
- Sidebar: Workflows section [+] (API'den dinamik liste)
- Sidebar: Projects section [+] (workspaces API'den dinamik liste)
- Sidebar: Recents section (son konusmalar API'den)
- /customize sayfasi: sidebar'da olmayan tum item'lar (Cowork tarzi grid)
- Guncel kutuphane dogrulama (React 19, Vite 7, Tailwind 4 uyumu)
- Playwright Chromium E2E test suite

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Sidebar ust kisim: New Task/Chat, Search, Customize, Scheduled
- [ ] Sidebar Workflows section: API'den workflow listesi + [+] ekleme butonu
- [ ] Sidebar Projects section: API'den workspace listesi + [+] ekleme butonu
- [ ] Sidebar Recents section: son konusmalar listesi
- [ ] /customize sayfasi: sidebar disinda kalan tum item'lar grid layout
- [ ] Guncel kutuphane dogrulama
- [ ] Playwright E2E testler

### Out of Scope

- RightPanel tab altyapisi — sonra, baglamsal tasarim yapilacak
- .ownpilot/ config editor — v1.5+
- Context chat panel — v2.0
- File preview + Shiki — v1.5
- Drag-drop siralama — v2+
- Mobile responsive (sidebar) — simdilik mevcut mobile mantik korunur

## Context

- **Codebase:** TypeScript monorepo (packages/core, gateway, ui, cli)
- **Frontend:** React 19.2, Vite 7, Tailwind CSS 4
- **State:** React Context API (useChatStore, useAuth, useTheme, useWebSocket)
- **Storage:** localStorage (STORAGE_KEYS, 7 key, centralized)
- **Router:** react-router-dom v6, 40+ route
- **Layout:** Layout.tsx 519 satir, 3-column (sidebar w-56 + content + StatsPanel)
- **Mevcut API'lar:** workflowsApi.list(), chatApi.listHistory(), fileWorkspacesApi.list()
- **Monaco:** @monaco-editor/react@4.7.0 zaten yuklu
- **Test:** Vitest 4.x (26,500+ test), Playwright mevcut degil (eklenecek)
- **Base branch:** feature/bridge-conversation-id (SHA: 2f11715c)
- **Base image:** localhost:5000/ownpilot:session-fix-v5
- **Wireframe:** ~/Downloads/Ekran Resmi 2026-03-28 11.42.21.png
- **Cowork referanslari:** ~/Downloads/Ekran Resmi 2026-03-27 12.49.14.png, ~/Downloads/Ekran Resmi 2026-03-27 17.01.04.png
- **Onceki planlama:** ~/.claude/projects/-home-ayaz/memory/ownpilot-ui-roadmap.md

## Constraints

- **Tech stack:** React 19 + Vite 7 + Tailwind 4 — guncel versiyonlar kullanilmali
- **Kutuphane dogrulama:** Her yeni dependency icin Context7 ile guncellik kontrolu zorunlu
- **Branch:** Feature bazli (feature/ui-F1-sidebar)
- **Test:** Her layer sonrasi typecheck + manuel test, final'de Playwright E2E
- **Docker:** `docker build -t localhost:5000/ownpilot:TAG .` — pre-commit hook bypass: --no-verify
- **Regresyon:** Mevcut StatsPanel, MiniChat, MiniTerminal, DebugDrawer korunmali

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cowork tarzi yapisal sidebar | Wireframe + kullanici tercihi | — Pending |
| Sidebar disindakiler → /customize | Cowork pattern'i, temiz sidebar | — Pending |
| New Task/Chat = tek buton | Yeni chat acar, chat'ten task olusturulabilir | — Pending |
| Feature bazli branch | Merge conflict riski dusuk | — Pending |
| Playwright E2E | Production ortam testi zorunlu | — Pending |
| RightPanel sonra | Baglamsal tasarim gerekiyor, simdi sidebar odak | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after milestone v1.0 initialization*
