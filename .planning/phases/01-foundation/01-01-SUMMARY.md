---
phase: 01-foundation
plan: 01
subsystem: ui-constants
tags: [constants, nav-items, storage-keys, foundation]
dependency_graph:
  requires: []
  provides:
    - packages/ui/src/constants/nav-items.ts (NavItem, NavGroup, mainItems, navGroups, bottomItems, ALL_NAV_ITEMS)
    - packages/ui/src/constants/storage-keys.ts (SIDEBAR_PINNED, NAV_GROUPS)
  affects:
    - packages/ui/src/components/Layout.tsx (downstream — Plan 02 will import from nav-items.ts)
    - CustomizePage (downstream — Phase 3 will use ALL_NAV_ITEMS)
tech_stack:
  added: []
  patterns:
    - Shared constants extracted to dedicated files for single source of truth
    - ALL_NAV_ITEMS flat array derived from structured navGroups for grid consumption
key_files:
  created:
    - packages/ui/src/constants/nav-items.ts
  modified:
    - packages/ui/src/constants/storage-keys.ts
decisions:
  - "Copied interfaces and constants verbatim from Layout.tsx — no behavioral changes"
  - "Import path from nav-items.ts uses ../components/icons (same as Layout.tsx uses ./icons)"
  - "NAV_GROUPS value 'ownpilot_nav_groups' matches exact raw string in Layout.tsx for migration compatibility"
metrics:
  duration: "~1 minute"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 01 Plan 01: Nav Items Constants + Storage Keys Summary

**One-liner:** Extracted NavItem/NavGroup types and all nav item arrays from Layout.tsx into a shared constants file, plus registered SIDEBAR_PINNED and NAV_GROUPS keys in the centralized localStorage registry.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract nav-items.ts constants file | `0a8b1caf` | packages/ui/src/constants/nav-items.ts (created) |
| 2 | Add SIDEBAR_PINNED and NAV_GROUPS to STORAGE_KEYS | `3b7f191f` | packages/ui/src/constants/storage-keys.ts (modified) |

## Files Created/Modified

### Created: `packages/ui/src/constants/nav-items.ts`

Exports:
- `NavItem` interface — `{ to: string; icon: React.ComponentType<{className?: string}>; label: string }`
- `NavGroup` interface — `{ id, label, icon, items, defaultOpen?, badge? }`
- `mainItems: NavItem[]` — 5 items (Chat, Dashboard, Analytics, Channels, Conversations)
- `navGroups: NavGroup[]` — 6 groups (data, ai, tools, system, experimental, settings) with 43 total items
- `bottomItems: NavItem[]` — 2 items (About, Profile)
- `ALL_NAV_ITEMS: NavItem[]` — derived flat array (mainItems + all group items + bottomItems) for CustomizePage grid

### Modified: `packages/ui/src/constants/storage-keys.ts`

Added two keys:
- `SIDEBAR_PINNED: 'ownpilot-sidebar-pinned'` — new key, string[] of pinned route paths
- `NAV_GROUPS: 'ownpilot_nav_groups'` — legacy key matching exact raw string in Layout.tsx (migration compat)

## Interfaces and Exports (exact names for downstream plans)

```typescript
// nav-items.ts
export interface NavItem { to: string; icon: React.ComponentType<{className?: string}>; label: string; }
export interface NavGroup { id: string; label: string; icon: React.ComponentType<{className?: string}>; items: NavItem[]; defaultOpen?: boolean; badge?: string; }
export const mainItems: NavItem[]
export const navGroups: NavGroup[]
export const bottomItems: NavItem[]
export const ALL_NAV_ITEMS: NavItem[]

// storage-keys.ts (additions)
SIDEBAR_PINNED: 'ownpilot-sidebar-pinned'
NAV_GROUPS: 'ownpilot_nav_groups'
```

## TypeScript Compilation Status

No new TypeScript errors introduced. Pre-existing errors in `packages/gateway/src/acp/` (missing `@agentclientprotocol/sdk`) remain unchanged — these are pre-existing per STATE.md baseline. UI package has zero type errors.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Both files contain complete, production-ready data. nav-items.ts is an exact copy of the data in Layout.tsx (no empty arrays or placeholder values). storage-keys.ts additions are concrete string literals.

## Self-Check: PASSED

- `packages/ui/src/constants/nav-items.ts` exists: FOUND
- `packages/ui/src/constants/storage-keys.ts` modified: FOUND
- Commit `0a8b1caf` exists: FOUND
- Commit `3b7f191f` exists: FOUND
- `grep -c "export" packages/ui/src/constants/nav-items.ts` = 6: PASS
- `grep "SIDEBAR_PINNED\|NAV_GROUPS" storage-keys.ts` = 2 matches: PASS
- Layout.tsx NOT modified: PASS
