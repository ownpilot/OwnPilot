# Plan 16 — CI/CD & Developer Experience Improvements

**Priority:** P2
**Effort:** M (3–5 days)
**Risk:** Low
**Depends on:** 12 (test stability), 06 (the registry is referenced in
the new CI gates)
**Source reports:** `refactor.md` §8 (ESLint override, Vitest
concurrency, Type-only imports, Bundle analysis, Pre-commit hook),
`refactor.md` §6.2 (Migration test in CI)

---

## Context

The CI pipeline (`.github/workflows/ci.yml`) already runs:

- Lint
- Typecheck
- Build
- Test (Vitest)
- Migration smoke test against Postgres 16 (per `refactor.md` §14,
  this is already present)
- Release verification

Gaps remain:

- **File size budget** — no CI check fails the build when a file
  exceeds 800 LoC (the goal from Plan 07).
- **Dependency-cruiser** — the layering rule from Plan 09 is not
  enforced in CI.
- **Bundle size for UI** — `rollup-plugin-visualizer` is not
  installed; PRs that bloat the bundle ship without notice.
- **Knip / unused exports** — `knip.json` exists at the root but the
  CI does not run it.
- **Lint-staged** is configured but the hook file at
  `.husky/pre-commit` should be verified (per `refactor.md` §14, it
  is present; verify the wiring).
- **Migration drift** — the `001_initial_schema.sql` and friends are
  applied at boot, but CI does not test that a fresh DB
  (PostgreSQL 16, 17, 18) can run the full set end-to-end.
- **Prettier enforcement** — `format:check` is in scripts but not
  blocking the CI.
- **`OWNPILOT_*` env validation at boot** — the gateway boots with
  implicit defaults; missing env vars fail late, not early.

This plan hardens the CI and developer experience with the missing
gates and quick wins.

## Scope

- `.github/workflows/ci.yml` (add new jobs)
- `package.json` (new scripts)
- `eslint.config.js` (file-size rule from Plan 07, dependency
  rules from Plan 09)
- `vite.config.ts` (UI bundle visualizer)
- `packages/gateway/src/config/env.ts` (env validation)
- `.husky/pre-commit` (verify wiring)

## Goals

1. CI fails on any production file > 800 LoC.
2. CI runs `dependency-cruise` on the gateway; layering violations
   fail the build.
3. CI runs `knip`; unused exports fail the build.
4. CI produces a UI bundle-size report; PRs that increase the bundle
   by > 10% require a maintainer's override comment.
5. CI runs a fresh-DB migration test on PG 16, 17, and 18 in matrix.
6. `format:check` is a blocking CI step.
7. The gateway refuses to boot if a required env var is missing or
   malformed, with a clear error listing the offending variable.
8. The pre-commit hook runs `prettier --write` and `eslint --fix` on
   staged files (verify the existing wiring).

## Implementation Steps

### Step 1 — File size budget

Add a script `scripts/check-file-size.mjs`:

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LOC = 800;
const EXCLUDE = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      const lines = readFileSync(full, 'utf8').split('\n').length;
      if (lines > MAX_LOC) offenders.push({ file: full, lines });
    }
  }
}

walk(process.cwd());
if (offenders.length > 0) {
  console.error('Files exceeding the 800 LoC budget:');
  for (const o of offenders) console.error(`  ${o.file}: ${o.lines} LoC`);
  process.exit(1);
}
```

Add `pnpm run check:file-size` to the CI workflow.

### Step 2 — Dependency cruiser in CI

Add `pnpm exec depcruise packages/gateway --config packages/gateway/.dependency-cruiser.cjs`
to the CI workflow (depends on Plan 09 Step 2).

### Step 3 — Knip

Add `pnpm exec knip` to the CI workflow. `knip.json` is already
configured at the root; add a `--no-exit-code` during initial rollout
to surface findings without blocking, then promote to blocking after
one release.

### Step 4 — UI bundle visualizer

In `packages/ui/vite.config.ts`:

```ts
import { visualizer } from 'rollup-plugin-visualizer';
export default defineConfig({
  plugins: [react(), visualizer({ filename: 'dist/stats.html' })],
});
```

Add `pnpm --filter @ownpilot/ui run build:analyze` that produces
`dist/stats.html`. A CI comment on the PR compares the new size to
the base size; a > 10% increase is flagged for review.

### Step 5 — Fresh-DB migration matrix

Add a matrix job in `ci.yml`:

```yaml
migration-fresh-db:
  strategy:
    matrix:
      pg-version: ['16', '17', '18']
  services:
    postgres:
      image: pgvector/pgvector:pg${{ matrix.pg-version }}
      env:
        POSTGRES_PASSWORD: ownpilot_test
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - run: pnpm install --frozen-lockfile
    - run: pnpm exec tsx packages/gateway/scripts/migration-smoke-test.ts
      env:
        DATABASE_URL: postgres://postgres:ownpilot_test@localhost:5432/ownpilot
```

The existing `migration-smoke-test.ts` is reused; the matrix adds PG
17 and 18.

### Step 6 — `format:check` as a blocking step

In `.github/workflows/ci.yml`, add:

```yaml
- name: Format check
  run: pnpm run format:check
```

This is already in `package.json` scripts; just wire it into CI.

### Step 7 — Env validation at boot

In `packages/gateway/src/config/env.ts`, replace the implicit defaults
with explicit validation:

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(64), // 64-char minimum (Plan 15)
  UI_PORT: z.coerce.number().int().min(1).max(65535).default(5173),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OWNPILOT_OTEL_ENABLED: z.enum(['true', 'false']).default('false'),
  // ...
});

export const env = envSchema.parse(process.env);
```

The `parse` call throws on missing or invalid values. The error
message lists the failing keys and their constraints. The gateway
exits with code 1 if validation fails.

In `server.ts`, the env validation runs first thing — before any
other module is loaded. A clear message at boot tells the operator
what to fix.

### Step 8 — Pre-commit hook verification

Verify `.husky/pre-commit` is present and contains:

```sh
#!/usr/bin/env sh
pnpm exec lint-staged
```

If absent or stale, recreate. Add a `pre-push` hook that runs the
faster subset of CI checks (lint, typecheck) for early feedback.

## Acceptance Criteria

1. A PR that adds a 900-line file fails the CI with a clear "exceeds
   800 LoC budget" error.
2. A PR that adds an `import` crossing a forbidden layer fails the
   CI via dependency-cruiser.
3. A PR that adds a UI dependency causing > 10% bundle bloat is
   flagged in a PR comment.
4. The migration test passes against PG 16, 17, and 18.
5. A PR that breaks Prettier formatting fails the CI.
6. A gateway start with `JWT_SECRET` shorter than 64 chars exits with
   a clear error message.
7. The pre-commit hook runs `prettier --write` and `eslint --fix` on
   every commit (verified by a test commit).

## Test Plan

- `scripts/check-file-size.test.ts` (or `.mjs` with a smoke test) —
  a known-too-large file is detected; the script exits non-zero.
- The CI workflows themselves are tested by running them on a draft
  PR.
- A test boot with an invalid `JWT_SECRET` confirms the error
  message and exit code.

## Risks & Rollback

- **Risk:** The file-size budget is too aggressive for legitimate
  data tables or generated code. Mitigation: the script excludes
  `dist/`, `coverage/`, `.turbo/`, and any file matching
  `*.generated.ts`. A per-file allowlist (`// allow-large-file` in
  the first line) overrides the budget.
- **Risk:** The migration matrix on PG 17 and 18 surfaces a real
  bug. Mitigation: that's the _point_ of the test. Document the
  finding and fix.
- **Risk:** Env validation at boot breaks a deployment that relied
  on implicit defaults. Mitigation: every env var has a sensible
  default except `DATABASE_URL` and `JWT_SECRET`, which are required.
  The release notes call this out.
- **Rollback:** Each gate is independently revertible. The env
  validation is the most invasive — keep the parse in dev mode
  warn-only for one release, then promote to error.

## Out of Scope

- A full release pipeline (signed tags, semantic-release). The
  current `release:*` scripts are sufficient.
- A monorepo-wide TypeScript project-references graph. The current
  per-package `tsc --build` is fine.
- A performance-budget for the gateway startup time. Belongs to a
  future plan.
