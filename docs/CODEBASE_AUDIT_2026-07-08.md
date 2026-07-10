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

### ✅ Fixed (14 findings resolved)

| #   | Finding                                                                       | Severity | Fix                                                                                                                               | Commit                 |
| --- | ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | `core/src/services/index.ts` duplicate `export *`                             | 🔴       | Removed 2 redundant `export *` (claw-types, coding-agent-service); added missing `DEFAULT_CLAW_AUTONOMY_POLICY` to explicit block | `1e4fc931`             |
| 2   | Knip config broken — empty `{}` for 3 workspaces                              | 🟠       | Added entry files for all 6 workspaces (core, gateway, cli, ui, website, root)                                                    | `ae76f15e`             |
| 3   | 5 orphaned scripts in repo root                                               | 🟡       | Deleted `_cleanup.mjs`, `_cleanup2.mjs`, `_img.cjs`, `_readhealth.mjs`, `packages/gateway/scripts/fetch_crypto.py`                | `1e4fc931`             |
| 4   | `turbo.json` test depends on `["build"]`                                      | 🟡       | Changed to `["^build"]` so tests don't wait for self-build                                                                        | `56299bc6`             |
| 5   | `SetupWizard.tsx` — 270 lines, completely unused                              | 🟡       | Deleted file (replaced by `SetupWizardPlaceholder` in ChatStarterPrompts)                                                         | `8b4077aa`             |
| 6   | `clearPersonalStoreCache` — dead export, never called                         | 🟡       | Removed function entirely                                                                                                         | `8b4077aa`             |
| 7   | `migration:smoke` script not in `package.json`                                | 🔵       | Added `"migration:smoke": "tsx scripts/migration-smoke-test.ts"`                                                                  | `53a83fba`             |
| 8   | `resetServiceRegistrySync` — dead export (tests mock it)                      | 🟡       | Removed function entirely                                                                                                         | `c232283a`             |
| 9   | `skills/constants.ts` dead re-exports                                         | 🔵       | Removed `STATUS_COLORS`/`CATEGORY_COLORS`/`EXTENSION_CATEGORIES` re-exports                                                       | `ed4196ef`             |
| 10  | `mirrorCompactionToDatabase` / `STRUCTURED_SUMMARY_INSTRUCTIONS` dead exports | 🔵       | Made internal (no external consumers); removed from backward-compat re-export block in `service.ts`                               | `5b1d14b3`             |
| 11  | `setAgenticExecutor` dead export + `agentic/index.ts` dead barrel             | 🔵       | Removed `setAgenticExecutor`; deleted barrel (nothing imported from it)                                                           | `36cf5ab4`, `0daaf988` |
| 12  | 5 unused icon re-exports in `icons.tsx`                                       | 🔵       | Removed MicOff, PanelTop, ClipboardPaste, Scissors, Command (never imported)                                                      | `e8c80488`             |
| 13  | `SoulHeartbeatService` dead class export + `templateToSoulPayload` dead fn    | 🔵       | Made class internal; removed 60-line dead converter function                                                                      | `0b988958`             |
| 14  | Website `useInView` hook unused (replaced by CSS animations)                  | 🔵       | Deleted file (no callers remain after framer-motion prop removal)                                                                 | `03148680`             |

PR: https://github.com/ownpilot/OwnPilot/pull/111 — merged into `main`.

### Knip Progress

| Metric         | Initial | Final   | Change                                            |
| -------------- | ------- | ------- | ------------------------------------------------- |
| Unused files   | 1       | **0**   | -100%                                             |
| Unused exports | 43      | **27**  | -37%                                              |
| Unused types   | 420     | **420** | (event type definitions, intentional API surface) |
| Config hints   | 7       | **0**   | Knip auto-detects all entries                     |

### 2026-07-10 Addendum — Full System Scan

A second comprehensive scan was performed on 2026-07-10 covering: security (security-scanner role, 0 CVE), dead-code (bug-hunter/Knip, 25 unused exports, 86 unused types), dependency audit (0 vulnerabilities), config consistency, and remaining audit items.

#### ✅ Fixed (7 findings resolved)

| #   | Finding                                                                      | Severity | Fix                                                       | Commit     |
| --- | ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------- | ---------- |
| 15  | ESLint ignored all `.mjs` files (scripts, dev-proxy, website build scripts)  | 🟡       | Removed `**/*.mjs` from ignores — now under lint coverage | `721d833b` |
| 16  | `claw-types.ts` internal constants leaking as public API (item 10 from prev) | 🔵       | Added `@internal` JSDoc to all 7 CLAW\_\* constants       | `721d833b` |
| 17  | `scripts/report-code-health.mjs` unused `statSync` import                    | 🔵       | Removed from import list                                  | `721d833b` |
| 18  | `packages/ui/dev-proxy.mjs` unused `head` parameter                          | 🔵       | Renamed to `_head` (lint convention)                      | `721d833b` |
| 19  | `scripts/detect-mock-mismatch.mjs` `let subPaths` → `const`                  | 🔵       | Switched to `const` (never reassigned)                    | `721d833b` |
| 20  | `scripts/migrate-phase3-apply.mjs` unused destructured `subPaths`            | 🔵       | Removed from destructuring                                | `721d833b` |
| 21  | `scripts/generate-provider-configs.ts` 2× `let` → `const`                    | 🔵       | Switched `baseUrl` and `apiKeyEnv` to `const`             | `721d833b` |

PR: https://github.com/ownpilot/OwnPilot/pull/new/feat/audit-eslint-clawtypes-cleanup

### Security Scan Summary (2026-07-10)

| Severity  | Count | Key Findings                                                                                                                                                                 |
| --------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟠 High   |     2 | Auth bypass risk when UI password unset + non-localhost host; WebSocket auth fallback open in same scenario                                                                  |
| 🟡 Medium |     6 | ESLint JS/MJS scope (fixed), env template default password, opt-in hardening flags (CALLTOOL, EXTENSION_HOST, ANY_DIR, SKILL_SCRIPTS), localhost CORS defaults in production |
| 🔵 Low    |     5 | Website dependency drift, package-manager drift (pnpm + npm lockfiles), legacy MD5 helpers, placeholder secret examples                                                      |

#### 🟠 Partially Resolved — Auth bypass design-level risk

**PR #115** added a **production auth guard**: `AUTH_TYPE=none` + non-loopback `HOST` now causes a **fatal boot error** in production (`process.exit(1)` via `assertBootConfig()`). The remaining risk (API-key-without-password + exposed host) still produces only a startup warning — resolving it requires runtime DB access (`isPasswordConfigured()` is DB-backed), which happens outside the boot-validation window.

Deployments still need to:

- Set `AUTH_TYPE=api-key` + `API_KEYS` in production
- Set a UI password via Settings → Security
- Keep `HOST=127.0.0.1` unless a reverse proxy manages auth

### Knip Progress (2026-07-10)

| Metric         | Initial | Previous | Current | Change |
| -------------- | ------- | -------- | ------- | ------ |
| Unused files   | 1       | 0        | 0       | —      |
| Unused exports | 43      | 27       | 25      | -2     |
| Unused types   | 420     | 420      | 86      | -334   |
| Config hints   | 7       | 0        | 0       | —      |

The 86 unused types (down from 420) are primarily event-payload DTOs, API endpoint types, and workflow node data types — many are intentional public API surface. Further reduction requires manual API-surface review.

### ✅ Resolved (prior audit items 8–9)

#### 8. 🟠 41 SQL migration files — **squashed** (PR #114)

**Status:** ✅ Done  
**Before:** 41 files (001–041), 5 drop migrations, stale schema (missing `jobs`, `job_history`, `provider_metrics`)  
**After:** Single `001_initial_schema.sql` (2375 lines, 90 CREATE TABLE statements) generated from TypeScript schema modules (source of truth). Old files archived to `archive/`.  
**New script:** `packages/gateway/scripts/generate-squashed-migration.ts` to regenerate.  
**Verification:** Gateway typecheck ✅, schema test (3/3) ✅

#### 9. 🔵 Website package version drift

**Status:** 🔄 Monitored (intentional — outside `pnpm-workspace.yaml`, manages deps independently)

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
pnpm audit                                  # ✅ 0 vulnerabilities (1239 deps)
MJS ESLint lint                             # ✅ clean (scripts/, website/scripts/, dev-proxy)
```
