# Plan 07 — God File Decomposition

**Priority:** P1
**Effort:** XL (1–2 weeks; one PR per file)
**Risk:** Low
**Depends on:** 06 (the registry migration unblocks claw/sandbox splits)
**Source reports:** `refactor.md` §3.1, `refactor_plan.md` M1 (done for UI)

---

## Context

The 2026-05-23 refactor consolidated the autonomous agent layer (Fleet,
Subagent, Orchestra → Claw/Soul/Crew) and eliminated ~1 800 LoC of
`claw-tools.ts`. The remaining 15 files >800 LoC are listed in
`refactor.md` §3.1 (revised table). All are well-structured with section
comments and clear domain boundaries — the issue is **size**, not
**design**. A 1 800-line file is hard to navigate, hard to test in
isolation, and accumulates accidental complexity over time.

The pattern in the codebase is to split along natural seams:

- A `manager.ts` file splits into `manager.ts` (orchestrator) +
  `<domain>-executors.ts` (per-domain logic) + `<domain>-schemas.ts` (per-
  domain types) + `<domain>-utils.ts` (helpers).
- A `routes/<feature>.ts` file splits into `routes/<feature>/index.ts` +
  `routes/<feature>/<subroute>.ts`.
- A UI page file splits into `pages/<feature>/<Page>.tsx` (shell) +
  `pages/<feature>/<SubComponent>.tsx` (per-section component).

This plan sequences the splits from smallest to largest, so each PR is
reviewable and shippable independently. The `refactor_plan.md` M1
progress entries (ClawsPage 2972→444, FleetPage 2368→447) are the
reference pattern for UI splits.

## Scope

Files from `refactor.md` §3.1 (line counts and proposed splits):

| File                                   | LoC   | Suggested split                                                |
| -------------------------------------- | ----- | -------------------------------------------------------------- |
| `services/claw/manager.ts`             | 1 839 | task-plan / escalation / scheduling extraction                 |
| `ws/server.ts`                         | 1 353 | login/throttle, channel routing, heartbeat, per-event handlers |
| `routes/claws.ts`                      | 1 291 | sub-routes under `routes/claws/`                               |
| `server.ts`                            | 1 194 | See Plan 06 — boot decomposition                               |
| `services/agent/service.ts`            | 1 189 | lifecycle methods vs query/display methods                     |
| `routes/chat/index.ts`                 | 1 019 | history, streaming, fetch-url into separate route modules      |
| `db/repositories/claws.ts`             | 969   | query helpers from mutation methods                            |
| `services/browser-service.ts`          | 917   | screenshot / PDF / browser automation                          |
| `services/claw/runner.ts`              | 895   | cycle phase extraction                                         |
| `tools/claw/definitions.ts`            | 853   | already focused; consider type-only file                       |
| `tools/claw/lifecycle-executors.ts`    | 853   | `install_package`, `run_script`, `create_tool`, `execute`      |
| `tools/claw/plan-executors.ts`         | 841   | already focused                                                |
| `tools/claw/output-executors.ts`       | 841   | already focused                                                |
| `middleware/schemas/workflow-claws.ts` | 839   | per-domain: `agents.ts`, `workflows.ts`                        |
| `tools/browser-tools.ts`               | 823   | screenshot / PDF / markdown tool groups                        |

UI page files from `refactor.md` §5.1 (12 pages > 1 000 LoC):

- `ChatPage.tsx` (1 299), `McpServersPage.tsx` (1 328), `CodingAgentsPage.tsx` (1 362),
  `SystemPage.tsx` (1 212), `ProfilePage.tsx` (1 219), `LogsPage.tsx` (1 185),
  `TriggersPage.tsx` (1 096), `PlansPage.tsx` (1 066)

## Goals

1. No production file in the gateway exceeds 800 LoC (excluding dense
   data tables such as `package.json` and generated code).
2. Each split produces a thin "shell" file (< 200 LoC) that delegates
   to per-domain modules.
3. Each split lands in a single PR; no multi-file mega-PRs.
4. The new structure is consistent — the same naming convention is used
   across all splits.

## Implementation Steps

The sequence is small-to-large, simplest-to-most-fragile first.

### Wave A — Leaf extractions (low risk, mechanical)

- **PR-A1: `tools/claw/definitions.ts`** — split into
  `tools/claw/definitions/{index.ts, registry.ts, schemas.ts}`. Pure
  refactor; no behavior change.
- **PR-A2: `tools/claw/plan-executors.ts`** and **`output-executors.ts`** —
  similar pure splits.

### Wave B — Repository + middleware splits

- **PR-B1: `db/repositories/claws.ts`** — split into
  `db/repositories/claws/{queries.ts, mutations.ts, types.ts, index.ts}`.
  Repository methods become re-exports for back-compat; new code uses
  the sub-modules.
- **PR-B2: `middleware/schemas/workflow-claws.ts`** — split into
  `middleware/schemas/{agents.ts, workflows.ts, claws.ts, index.ts}`.

### Wave C — Tooling splits

- **PR-C1: `tools/claw/lifecycle-executors.ts`** — split into
  `tools/claw/lifecycle/{install.ts, run-script.ts, create-tool.ts, execute.ts}`.
  Each file is a single executor; the `definitions.ts` imports from
  them.
- **PR-C2: `tools/browser-tools.ts`** — split into
  `tools/browser/{screenshot.ts, pdf.ts, markdown.ts, index.ts}`.

### Wave D — Service splits

- **PR-D1: `services/claw/runner.ts`** — extract cycle phases
  (`runner/{plan.ts, execute.ts, persist.ts, index.ts}`).
- **PR-D2: `services/browser-service.ts`** — split into
  `services/browser/{navigation.ts, screenshot.ts, pdf.ts, index.ts}`.
- **PR-D3: `services/agent/service.ts`** — split into
  `services/agent/{lifecycle.ts, query.ts, display.ts, index.ts}`.

### Wave E — The big one: `services/claw/manager.ts` (1 839 LoC)

This is the highest-risk split. The file is well-structured with section
comments — the seam is clear, but the blast radius is large (touches
every autonomous agent).

- **PR-E1:** Extract task-plan methods into
  `services/claw/task-plan.ts` (replaces `replacePlan`,
  `updateTaskOnSession`, `splitTaskOnSession`).
- **PR-E2:** Extract escalation methods into
  `services/claw/escalation.ts` (`approveEscalation`, `escalate`).
- **PR-E3:** Extract scheduling helpers into
  `services/claw/scheduling.ts` (timer management, `setTimeout` chains,
  `runCleanup`).
- **PR-E4:** Extract lifecycle and IPC plumbing into
  `services/claw/lifecycle.ts` (`startClaw`, `stopClaw`, `pauseClaw`).
- After all four, `manager.ts` should be < 500 LoC as an orchestrator.

### Wave F — Routes and WebSocket

- **PR-F1: `routes/claws.ts`** — split into `routes/claws/{crud.ts,
lifecycle.ts, audit.ts, stats.ts, index.ts}`. Use the pattern from
  the already-split `routes/agents/index.ts` (Plan 03 PR-A).
- **PR-F2: `routes/chat/index.ts`** — split into
  `routes/chat/{messages.ts, streaming.ts, history.ts, fetch-url.ts,
index.ts}`. The history split is mostly already done (Plan 03 PR-B).
- **PR-F3: `ws/server.ts`** — extract login/throttle, channel routing,
  heartbeat, and per-event handlers. Target < 600 LoC.

### Wave G — UI page splits (mostly done for ClawsPage / FleetPage)

- **PR-G1: `ChatPage.tsx`** — extract `MessageList`, `Composer`,
  `ToolbarBar`, `ScrollManager`. Mirror the ClawsPage split.
- **PR-G2–G8:** The remaining 7 pages (McpServersPage, CodingAgentsPage,
  SystemPage, ProfilePage, LogsPage, TriggersPage, PlansPage) — one PR
  per page.

## Acceptance Criteria

1. No file in the listed scope exceeds 800 LoC after the plan.
2. Each shell file is < 200 LoC.
3. All existing tests pass without modification (the splits preserve
   the public API via re-exports).
4. The CLI smoke test (`pnpm start` → dashboard loads) still works.
5. The CI bundle-size check does not regress (Plan 16 will introduce
   this gate; if it already exists, no regression).

## Test Plan

- No new test logic — the existing tests serve as the safety net. If a
  split breaks behavior, an existing test fails.
- Add a per-file size budget check (Plan 16 introduces this as a CI
  gate; the goal is to _fail_ the build when a file exceeds 800 LoC).
- For UI pages, the existing Playwright e2e tests cover the
  user-visible flows.

## Risks & Rollback

- **Risk:** A split breaks an internal import that was previously
  satisfied by a transitive re-export. Mitigation: keep the original
  file as a barrel of re-exports for one release; remove only after a
  full grep confirms no external importers reference internal symbols.
- **Risk:** The `services/claw/manager.ts` split touches the highest-
  traffic code path. Mitigation: ship each sub-extraction as its own
  PR; the orchestrator file (`manager.ts`) shrinks gradually, not in
  one step.
- **Rollback:** Each PR is a single file (or a tightly coupled group).
  Revert one commit and the codebase returns to the pre-split state.

## Out of Scope

- Refactoring the file's internal design beyond the split. If a function
  in the extracted file is itself ugly, that's a separate plan.
- Renaming files or moving them across packages. Stays in the same
  directory tree.
- Architectural changes (e.g., converting `services/claw/manager.ts`
  to a state machine). That's a design change, not a size change.
