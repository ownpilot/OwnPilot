# Plan 17 — Documentation & Process Improvements

**Priority:** P3
**Effort:** M (ongoing; this plan establishes the framework)
**Risk:** Low
**Depends on:** none
**Source reports:** `refactor.md` §9 (Documentation & memory drift),
`refactor.md` §11 (Don't switch test runners; the existing investment
in docs is the same)

---

## Context

The documentation in `docs/` is extensive (25+ files) but shows drift
in three places:

- `docs/dead-code-audit-report.md` (April 2026) is ~5 weeks stale and
  contradicts `MEMORY.md` re: Discord/Slack plugins.
- `docs/architecture.md` (dated 2026-05-28) needs verification against
  the post-Claw runtime layout (Fleet/Subagent/Orchestra removed in
  2026-05-23).
- `docs/ADR/` exists but is not referenced from `CLAUDE.md` or
  `AGENTS.md`.

The `refactor/` folder (this folder) is the new canonical home for
forward-looking improvement plans. The existing `refactor.md` and
`refactor_plan.md` at the root are the historical record.

Beyond the drift, several process improvements would help future
contributors:

- **ADRs are not linked from the main index.** New contributors
  stumble on them.
- **The security report (`security-report/`)** is well-maintained but
  separate from `docs/`. The relationship is unclear.
- **The "What's already solid" section** in `refactor_plan.md` is
  excellent but lives in a file that says "SUPERSEDED". The good
  content should be preserved.
- **The CHANGELOG** is well-maintained and serves as a release log.

This plan establishes a documentation review cadence, a single index
of all plan-style documents, and a small process for keeping docs
current.

## Scope

- `docs/INDEX.md` (new)
- `docs/README.md` (add cross-references)
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` (add ADR + refactor cross-refs)
- `refactor.md`, `refactor_plan.md` (markers, links)
- `docs/architecture.md` (post-Claw verification)
- `docs/SERVICE_CATALOG.md` (post-Plan 06 update)
- `docs/API_ROUTES.md` (will be auto-generated; flag for re-gen)
- `CHANGELOG.md` (entry for this plan's deliverables)

## Goals

1. A single `docs/INDEX.md` lists every documentation file with a
   one-line description and last-updated date.
2. Every plan-style document (this folder, `refactor.md`,
   `refactor_plan.md`, ADRs) is linked from the index.
3. The "What's already solid" content from `refactor_plan.md` is
   preserved in a new `docs/ARCHITECTURE_DECISIONS.md` and removed
   from the SUPERSEDED plan file.
4. The Discord / Slack plugin status ambiguity is resolved in a
   single sentence, in one place, with a date.
5. The architecture doc reflects the post-Claw layout.
6. A lightweight "doc staleness" check runs in CI: a markdown file
   not updated in 12 months is flagged (not blocking).

## Implementation Steps

### Step 1 — Single documentation index

Create `docs/INDEX.md`:

```md
# OwnPilot Documentation Index

> **Last updated:** 2026-06-01

## Core

- [Architecture](./architecture.md) — system overview
- [AGENTS.md](../AGENTS.md) — agent conventions
- [CLAUDE.md](../CLAUDE.md) — Claude-specific notes

## ADRs (Architecture Decision Records)

- [ADR-001: Persistent Job Queue](./ADR/ADR-001-persistent-job-queue.md)
- [ADR-002: Database Retention Policy](./ADR/ADR-002-database-retention-policy.md)
- [ADR-003: API Versioning Strategy](./ADR/ADR-003-api-versioning-strategy.md)

## Reference

- [API Routes](./API_ROUTES.md) — _(auto-generated; do not edit)_
- [Service Catalog](./SERVICE_CATALOG.md) — _(updated post-Plan 06)_
- [CLI Tools](./CLI_TOOLS.md) — CLI surface
- [Tools](./TOOLS.md) — internal tool registry
- [Providers](./PROVIDERS.md) — LLM provider matrix
- [Database](./DATABASE.md) — schema overview
- [Triggers](./TRIGGERS.md) — trigger system
- [UI Components](./UI_COMPONENTS.md) — UI inventory

## Operational

- [Security Policy](../SECURITY.md)
- [Setup](../SETUP.md)
- [Contributing](../CONTRIBUTING.md)
- [Code Review](../CODE_REVIEW.md) — _(internal review artifact)_

## Plans & Audits

- [Refactor Plans](../refactor/) — _(17 plans; this folder)_
- [Refactor Master Report](../refactor.md) — _(2026-05-30 snapshot)_
- [Refactor Plan (legacy)](../refactor_plan.md) — _(April 2026; SUPERSEDED)_
- [Security Reports](../security-report/)
- [Dead Code Audit](./dead-code-audit-report.md) — _(April 2026; STALE)_

## History

- [CHANGELOG](../CHANGELOG.md)
```

### Step 2 — Cross-references in agent docs

In `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`:

- Add a "Documentation" section linking to `docs/INDEX.md`.
- Add an "Active Refactor Plans" section linking to this folder
  (the `refactor/` directory) with a one-line summary of each plan
  by number and title.

### Step 3 — Resolve the Discord / Slack plugin status

Add a one-line entry in `docs/CHANNELS.md` (or create the file if it
doesn't exist):

```
## Channel plugins — status (as of 2026-06-01)

Active: Telegram, WhatsApp (Baileys), Discord, Slack, Matrix.
Removed: none at this revision.
```

Cross-reference from `MEMORY.md` (if it exists at root) and from the
`refactor.md` §4.2 entry to the same statement.

### Step 4 — Post-Claw architecture verification

Verify `docs/architecture.md` reflects the Claw/Soul/Crew layout (per
the 2026-05-23 refactor). If outdated, update with:

- A "Current runtime: Claw/Soul/Crew" callout at the top.
- Removal of any Fleet/Subagent/Orchestra references.
- The two-layer capability architecture (Layer 1 horizontal, Layer 2
  vertical) diagram, dated.

### Step 5 — Service catalog update (post-Plan 06)

After Plan 06 lands, update `docs/SERVICE_CATALOG.md`:

- List every registered service, with its boot order, dependencies,
  and lifecycle hooks.
- Reference the registry tokens in `packages/core/src/services/registry.ts`.
- Mark deprecated services (the legacy singletons after migration).

### Step 6 — Preserve "What's already solid"

Move the "What's already solid" content from `refactor_plan.md` into
a new `docs/ARCHITECTURE_DECISIONS.md`:

```md
# Architecture Decisions (the "why" behind the design)

> Curated from `refactor_plan.md` and the ADR collection. Each entry
> explains a non-obvious design choice so future contributors don't
> re-litigate it.

## Topics

- SSRF shared utility (DNS-resolving + sync check)
- Fleet cascade & isolation design
- Claw adaptive scheduling (CONTINUOUS_MIN/MAX/IDLE_DELAY_MS)
- Performance migration 027 (indexes)
- Centralized generateId() with randomBytes
- apiResponse / apiError / ERROR_CODES + zod middleware
- Core / gateway separation (zero-dep boundary)
- Hono over Fastify/Express
- Vitest over Jest/Mocha
- pg over ORM
- Worker + vm sandbox over wasmtime
```

Reference the new doc from `docs/INDEX.md`.

### Step 7 — Doc staleness check

Add a small script `scripts/check-doc-staleness.mjs`:

```js
// Flags any markdown file in docs/ that hasn't been updated in 365 days.
// Output is a warning; CI logs it but does not fail the build.
```

Add to CI as a non-blocking job. Future maintainers see a one-line
warning per stale file.

## Acceptance Criteria

1. `docs/INDEX.md` exists and lists every documentation file.
2. `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` link to `docs/INDEX.md` and
   to the refactor plan folder.
3. The Discord / Slack plugin status is documented in one place
   (`docs/CHANNELS.md` or the index), with a date, and is the same
   in every other reference.
4. `docs/architecture.md` reflects the post-Claw layout.
5. `docs/SERVICE_CATALOG.md` reflects the post-Plan-06 registry.
6. `docs/ARCHITECTURE_DECISIONS.md` exists and contains the curated
   "what's already solid" content.
7. The doc-staleness CI job runs and logs warnings (but does not
   block).

## Test Plan

- A smoke test asserts that `docs/INDEX.md` exists, has the right
  header, and links to a sample of known files.
- A second test asserts that the Discord / Slack status is identical
  across all references (modulo formatting).
- The doc-staleness script is run locally; it produces the expected
  output for a known-stale file.

## Risks & Rollback

- **Risk:** Moving the "What's already solid" content breaks an
  external link. Mitigation: leave a redirect note at the old
  location pointing to the new file.
- **Risk:** The doc-staleness check surfaces too many warnings,
  adding noise. Mitigation: 12 months is the threshold; the warnings
  are advisory, not blocking.
- **Rollback:** Each step is a documentation-only change; revert
  one commit per step if needed.

## Out of Scope

- Migrating to a docs site (e.g., Docusaurus, Mintlify). The
  current markdown-in-repo is fine; a site is a future effort.
- Internationalization of the documentation. English-only for now.
- A documentation style guide. The existing docs are consistent
  enough; a style guide is a future effort.
