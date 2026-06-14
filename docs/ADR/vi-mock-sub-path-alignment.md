# ADR: vi.mock Sub-Path Alignment

## Status

**Accepted** — 2026-06-14 (Migration complete)

## Context

The `@ownpilot/core` package uses sub-path exports (`@ownpilot/core/services`,
`@ownpilot/core/events`, `@ownpilot/core/agent`, etc.). Gateway and CLI source
files import from these sub-paths. However, many test files still used
`vi.mock('@ownpilot/core', ...)` to mock the main entry point.

`vi.mock()` intercepts by **module specifier**. When source imports from
`@ownpilot/core/services` but the test mocks `@ownpilot/core`, the mock factory
is never applied — the real implementation runs instead. Tests pass but for the
**wrong reason**: mock assertions are silently ignored, and real code (which may
touch databases, networks, or ConfigCenter) executes unexpectedly.

## Migration Result

**131 broken test files fixed across 10 commits.** Final state:

| Metric             | Before | After | Change    |
| ------------------ | ------ | ----- | --------- |
| Failing test files | 121    | 3     | **-118**  |
| Failing tests      | 1974   | 3     | **-1971** |
| Passing tests      | 15094  | 17115 | **+2021** |
| ESLint warnings    | 147    | 0     | **-147**  |

The 3 remaining failures are pre-existing issues unrelated to mock alignment
(see `routes/helpers.test.ts` EXPOSE-001 and `routes/settings.test.ts` sandbox
config assertions).

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

### Migration Tools

Two scripts automate detection and migration:

#### `scripts/detect-mock-mismatch.mjs`

Scans all test files across packages and reports:

- **BROKEN** — source already uses sub-paths, mock not applied (fix now)
- **AT-RISK** — source still on main path, will break when source migrates

```bash
node scripts/detect-mock-mismatch.mjs
```

#### `scripts/migrate-phase1.mjs`

Automates Phase 1 migration: files where the source imports from exactly one
`@ownpilot/core/*` sub-path. Changes the mock path and adds `importOriginal`
where needed.

```bash
node scripts/migrate-phase1.mjs          # apply
node scripts/migrate-phase1.mjs --dry-run # preview
```

#### `scripts/migrate-phase3-apply.mjs`

Automates Phase 3: detects single-sub-path mocks hiding among multi-sub-path
source imports, and auto-applies path changes using a symbol→sub-path map
built from `@ownpilot/core`'s export files.

```bash
node scripts/migrate-phase3-apply.mjs          # apply
node scripts/migrate-phase3-apply.mjs --dry-run # preview
```

### Key Lessons

1. **`importOriginal` is essential** — without it, mocking `@ownpilot/core/agent`
   with only `createSimpleAgent` breaks because `getDefaultModelForProvider` (also
   from agent) disappears. Always spread the original module.

2. **Symbol→sub-path mapping matters** — `getEventSystem` is in
   `@ownpilot/core/events`, not services. Putting it in the wrong mock block
   causes silent failures (mock applies but to the wrong module).

3. **Transitive imports count** — `agent-tool-registry.ts` is a facade that
   re-exports from `registry/external-registration.ts`, which imports from
   `@ownpilot/core/services`. The test must mock both `agent` and `services`.

4. **Integration tests without 1:1 source files** — tests that import
   `./index.js` (a barrel) need their mock paths determined by what the barrel
   re-exports, not by the barrel itself.

### Prevention

An ESLint rule in `eslint.config.js` prevents new occurrences by flagging
`vi.mock('@ownpilot/core', ...)` without a sub-path in test files:

```javascript
'no-restricted-syntax': [
  'warn',
  {
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name='mock'][arguments.0.value='@ownpilot/core']",
    message:
      "vi.mock('@ownpilot/core') doesn't intercept sub-path imports. Use vi.mock('@ownpilot/core/<sub-path>') instead.",
  },
],
```

The pre-commit hook (`eslint --max-warnings=0`) blocks commits with warnings.
