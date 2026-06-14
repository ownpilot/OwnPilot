# ADR: vi.mock Sub-Path Alignment

## Status

Proposed — 2026-06-14

## Context

The `@ownpilot/core` package uses sub-path exports (`@ownpilot/core/services`,
`@ownpilot/core/events`, `@ownpilot/core/agent`, etc.). Gateway and CLI source
files import from these sub-paths. However, many test files still use
`vi.mock('@ownpilot/core', ...)` to mock the main entry point.

`vi.mock()` intercepts by **module specifier**. When source imports from
`@ownpilot/core/services` but the test mocks `@ownpilot/core`, the mock factory
is never applied — the real implementation runs instead. Tests pass but for the
**wrong reason**: mock assertions are silently ignored, and real code (which may
touch databases, networks, or ConfigCenter) executes unexpectedly.

## Current State (2026-06-14)

Run `node scripts/detect-mock-mismatch.mjs` for live status.

| Category    | Count | Meaning                                                   |
| ----------- | ----- | --------------------------------------------------------- |
| **Broken**  | 131   | Source already uses sub-paths; mock not applied           |
| **At-risk** | 4     | Source still on main path; will break on migration        |
| **Fixed**   | 31    | Mocks aligned with sub-paths (commits f106f1f9, 2e091de2) |

## Decision

### Migration Pattern

For each broken test file:

1. **Read the source file** to find which `@ownpilot/core/*` sub-paths it imports from
2. **Split** `vi.mock('@ownpilot/core', ...)` into separate `vi.mock()` calls — one per sub-path
3. **Preserve** the `importOriginal` pattern so unmocked exports keep working
4. **Verify** with `npx vitest run <file>`

```typescript
// BEFORE (broken — mock never applied)
vi.mock('@ownpilot/core', () => ({
  getLog: mockGetLog,
  getEventSystem: mockGetEventSystem,
}));

// AFTER (correct — one mock per sub-path)
vi.mock('@ownpilot/core/services', () => ({
  getLog: mockGetLog,
}));
vi.mock('@ownpilot/core/events', () => ({
  getEventSystem: mockGetEventSystem,
}));
```

### Prioritization

Fix by sub-path complexity (easiest first):

| Phase | Sub-path count   | Files | Effort                    |
| ----- | ---------------- | ----- | ------------------------- |
| 1     | Single sub-path  | ~63   | Mechanical replace        |
| 2     | Two sub-paths    | ~38   | Split mock factory        |
| 3     | Three+ sub-paths | ~30   | Careful factory splitting |

### Prevention

An ESLint rule (see `eslint-rules/no-bare-core-mock.js`) prevents new occurrences
by flagging `vi.mock('@ownpilot/core', ...)` without a sub-path.
