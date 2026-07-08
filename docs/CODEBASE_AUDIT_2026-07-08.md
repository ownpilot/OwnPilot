# Codebase Audit — 2026-07-08

## Scope

Full monorepo analysis: 4 packages (`core`, `gateway`, `cli`, `ui`) + `website`, ~2325 source files, ~169K symbols.

## Methodology

- Structural analysis (tree, dependency graph, config review)
- Type-safety scan (`as any`, `@ts-ignore`, silent catches, eslint-disable in production code)
- Knip dead-code detection (after fixing config — was previously non-functional)
- Barrel export analysis
- Build pipeline review (turbo.json)
- Migration/DB schema review

## Key Metrics

| Metric                                  | Value                   |
| --------------------------------------- | ----------------------- |
| `as any` in production                  | **0**                   |
| `@ts-expect-error` in production        | **0**                   |
| `eslint-disable` in production          | **0**                   |
| Silent `catch {}` in production         | **0**                   |
| `noUnusedLocals` / `noUnusedParameters` | Active in all tsconfigs |
| `verbatimModuleSyntax`                  | Active                  |
| Test count (core)                       | 9845 pass, 3 skip       |

---

## Findings & Resolutions

### ✅ Fixed (7/10)

| #   | Finding                                               | Severity | Fix                                                                                                                               | Commit     |
| --- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | `core/src/services/index.ts` duplicate `export *`     | 🔴       | Removed 2 redundant `export *` (claw-types, coding-agent-service); added missing `DEFAULT_CLAW_AUTONOMY_POLICY` to explicit block | `1e4fc931` |
| 2   | Knip config broken — empty `{}` for 3 workspaces      | 🟠       | Added entry files for all 6 workspaces (core, gateway, cli, ui, website, root)                                                    | `ae76f15e` |
| 3   | 5 orphaned scripts in repo root                       | 🟡       | Deleted `_cleanup.mjs`, `_cleanup2.mjs`, `_img.cjs`, `_readhealth.mjs`, `packages/gateway/scripts/fetch_crypto.py`                | `1e4fc931` |
| 4   | `turbo.json` test depends on `["build"]`              | 🟡       | Changed to `["^build"]` so tests don't wait for self-build                                                                        | `56299bc6` |
| 5   | `SetupWizard.tsx` — 270 lines, completely unused      | 🟡       | Deleted file (replaced by `SetupWizardPlaceholder` in ChatStarterPrompts)                                                         | `8b4077aa` |
| 6   | `clearPersonalStoreCache` — dead export, never called | 🟡       | Removed function entirely                                                                                                         | `8b4077aa` |
| 7   | `migration:smoke` script not in `package.json`        | 🔵       | Added `"migration:smoke": "tsx scripts/migration-smoke-test.ts"`                                                                  | `53a83fba` |

PR: https://github.com/ownpilot/OwnPilot/pull/111

### 🔄 Remaining (3/10)

#### 8. 🟠 41 SQL migration files — squash needed

**Location:** `packages/gateway/src/db/migrations/postgres/`

41 migration files is high for any project. 5 of the 41 are "drop" migrations (020, 025, 035, 038) which revert earlier schema decisions. This indicates architectural churn that should be resolved by squashing into a clean base migration.

**Recommendation:** Squash migrations 001-041 into a single `001_initial_schema.sql` when the next production deployment window opens. Verify against the smoke test (`pnpm migration:smoke`).

#### 9. 🔵 Website package version drift

**Location:** `website/package.json`

- `@types/node@^25.5.0` — root uses `^22.19.21`
- `react-router@^7.17.0` — ui uses `react-router-dom@^7.16.0`
- `typescript@^5.8.3` — root uses `^5.9.3`

The website package is not in `pnpm-workspace.yaml` so it manages deps independently. This is intentional but the version drift should be monitored.

#### 10. 🔵 `claw-types.ts` exports internal implementation constants

**Location:** `packages/core/src/services/claw-types.ts`

Constants like `CLAW_RECENT_FAILURES_MAX`, `CLAW_REFLECTION_THRESHOLD`, `CLAW_TASK_STALL_*` are exported from the file and leak through `export *` chains. These are internal implementation details of the claw circuit-breaker and should not be part of the public API.

**Recommendation:** Move constants into the claw module that uses them (`heartbeat-circuit-breaker.ts`) or mark with `@internal` JSDoc. Verify no external consumers exist first (grep shows none).

---

## Verification Pipeline

All changes verified against:

```bash
pnpm --filter @ownpilot/core typecheck     # ✅
pnpm --filter @ownpilot/gateway typecheck   # ✅
pnpm --filter @ownpilot/ui typecheck        # ✅
pnpm --filter @ownpilot/core test           # ✅ 9845 pass
pnpm run typecheck                          # ✅ turbo: 6/6 tasks
pnpm run build (core, gateway, cli)         # ✅
```
