---
phase: 01-foundation
plan: 02
subsystem: ui-hooks
tags: [localStorage, pinned-items, migration, layout-refactor]
dependency_graph:
  requires:
    - "01-01: nav-items.ts constants file"
    - "01-01: STORAGE_KEYS.SIDEBAR_PINNED and NAV_GROUPS"
  provides:
    - "usePinnedItems hook with localStorage persistence and migration"
    - "Layout.tsx imports from shared constants (no duplicate definitions)"
  affects:
    - "packages/ui/src/hooks/usePinnedItems.ts (new)"
    - "packages/ui/src/components/Layout.tsx (refactored imports)"
tech_stack:
  added: []
  patterns:
    - "useState lazy initializer for localStorage reads (avoids re-render churn)"
    - "Functional updater pattern for localStorage-synced state setter"
    - "One-time migration pattern: read old key → write defaults → delete old key"
    - "Type-only import for NavItem/NavGroup interfaces"
key_files:
  created:
    - packages/ui/src/hooks/usePinnedItems.ts
  modified:
    - packages/ui/src/components/Layout.tsx
decisions:
  - "setPinnedItems accepts string[] | ((prev: string[]) => string[]) — supports both direct-set and functional-update callers (Sidebar and CustomizePage both need different patterns)"
  - "Migration writes DEFAULT_PINNED to new key (not derived from old key) — old NAV_GROUPS held collapse state, not pin state"
  - "ownpilot_nav_groups localStorage logic preserved in Layout.tsx — Phase 2 removes it when Sidebar.tsx is extracted"
  - "Removed 37 icon imports from Layout.tsx that moved to nav-items.ts; kept only ChevronDown, ChevronRight, Menu, X, LogOut"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_changed: 2
---

# Phase 01 Plan 02: usePinnedItems Hook + Layout.tsx Refactor Summary

**One-liner:** usePinnedItems hook with localStorage persistence, NAV_GROUPS migration, and Layout.tsx de-duplicated via constants/nav-items imports.

## What Was Built

### Task 1: usePinnedItems hook (`packages/ui/src/hooks/usePinnedItems.ts`)

Hook return shape: `{ pinnedItems: string[], setPinnedItems: (string[] | ((prev: string[]) => string[])) => void, MAX_PINNED_ITEMS: number }`

Key behaviors:
- **Default pinned items** for new users: `['/', '/dashboard', '/customize']`
- **Lazy initializer**: `useState(() => readPinnedItems())` — localStorage read happens once on mount
- **Migration**: if `ownpilot_nav_groups` key exists and `ownpilot-sidebar-pinned` does not → write defaults, remove old key
- **Persistence**: every `setPinnedItems` call writes to `localStorage.setItem(STORAGE_KEYS.SIDEBAR_PINNED, ...)`
- **MAX_PINNED_ITEMS = 15**: exported constant for consumer-side warning toasts
- **3 try-catch blocks**: `runMigration()`, `readPinnedItems()`, `setPinnedItems()` write path

Commit: `7461076c`

### Task 2: Layout.tsx refactor (`packages/ui/src/components/Layout.tsx`)

Changes (pure refactor — zero behavioral change):
- Removed `interface NavItem` and `interface NavGroup` inline definitions
- Removed `const mainItems`, `const navGroups`, `const bottomItems` inline arrays (~130 lines removed)
- Added `import type { NavItem, NavGroup } from '../constants/nav-items'`
- Added `import { mainItems, navGroups, bottomItems } from '../constants/nav-items'`
- Removed 37 icon imports that moved to nav-items.ts (kept: ChevronDown, ChevronRight, Menu, X, LogOut)
- Added MOBILE CONTRACT comment above `<aside>` block

Commit: `04eac7c3`

## Migration Behavior

| User state | What happens |
|-----------|-------------|
| Brand new (no localStorage) | `readPinnedItems()` returns `DEFAULT_PINNED = ['/', '/dashboard', '/customize']` |
| Has `ownpilot_nav_groups` only | Migration writes defaults to `ownpilot-sidebar-pinned`, deletes old key |
| Has `ownpilot-sidebar-pinned` only | Reads and validates existing array, falls back to defaults if malformed |
| Has both keys | `hasNewKey` is truthy → migration skips, reads existing SIDEBAR_PINNED |

## TypeScript Status

Pre-existing errors in `@ownpilot/gateway` (acp-client.ts — missing `@agentclientprotocol/sdk`) and `@ownpilot/ui` (AnalyticsPage, CostsPage — missing `recharts`; SkillEditorPage — missing `@monaco-editor/react`) were already present before this plan. Zero new errors introduced.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `usePinnedItems` returns real localStorage-backed data. No hardcoded empty values flow to UI rendering.

## Self-Check: PASSED
