# OwnPilot Refactor & Gap Audit — 2026-06-22

## Scope

This audit is based on a read-only review of the current monorepo. It supplements `refactor-next.md` with updated observations from the current tree.

Reviewed inputs:

- Root project metadata: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `knip.json`
- Existing roadmap: `refactor-next.md`
- Architecture docs: `docs/architecture.md`
- Package manifests: `packages/{core,gateway,ui,cli}/package.json`
- Gateway API helpers and representative routes: `routes/helpers.ts`, `routes/agentic.ts`, `routes/claws.ts`
- Large module summaries for Claw, Workflow, Channel, Core file-system tools, and UI workflow templates
- Static risk scans for `as any`, `as unknown as`, TODO/FIXME, `dangerouslySetInnerHTML`, eval-like usage, `Math.random`, `console.*`, and package import coupling

No source changes were made during the audit.

## Executive summary

OwnPilot is in a strong state: strict TypeScript is enabled, the release gate is comprehensive, tests are extensive, security remediation has been active, and recent package/export migrations have removed major mock/import hazards.

The main remaining issue is structural concentration. Gateway services and routes hold too many responsibilities per file, while core service/agent barrels remain wide enough to recreate import and mocking coupling. The newly expanded Agentic layer is well covered by tests, but needs persistence and observability decisions before it becomes a long-lived execution substrate.

## Current strengths

- `tsconfig.base.json` enables strict mode, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `isolatedModules`, and `verbatimModuleSyntax`.
- Root `release:verify` chains release check, production audit, build, typecheck, lint, and tests.
- ESLint already blocks key regressions, including bare `vi.mock('@ownpilot/core', ...)` in tests and some gateway imports that should use narrower core sub-paths.
- `apiError()` redacts 5xx details in production while preserving request metadata.
- `HtmlWidget` uses DOMPurify via `sanitizeHtml()` before `dangerouslySetInnerHTML`.
- The repo has a large test base: hundreds of colocated `*.test.*` files across core, gateway, UI, and CLI.

## Priority findings

### P0 — Add characterization tests before major splits

Target files:

- `packages/gateway/src/services/claw/manager/manager.ts`
- `packages/gateway/src/services/workflow/workflow-service.ts`
- `packages/gateway/src/channels/service-impl.ts`
- `packages/gateway/src/routes/claws.ts`

These files contain high-value runtime behavior. Before splitting, lock current behavior with characterization tests around lifecycle, cancellation, escalation, persistence, and failure handling. Refactors should not change behavior unless explicitly planned.

### P1 — Split Gateway god modules

#### Claw manager

`packages/gateway/src/services/claw/manager/manager.ts` is still large and multi-responsibility even after the recent merge cleanup.

Suggested target structure:

```text
services/claw/manager/
  index.ts
  singleton.ts
  lifecycle.ts
  tasks.ts
  escalation.ts
  inbox.ts
  persistence.ts
  scheduler-sync.ts
  events.ts
```

Keep `services/claw/manager.ts` as the stable public re-export.

#### Workflow service

`packages/gateway/src/services/workflow/workflow-service.ts` mixes execution runtime, resume runtime, DAG traversal, error handling, repository persistence, and progress callbacks.

Suggested target structure:

```text
services/workflow/
  service.ts
  runtime.ts
  resume-runtime.ts
  error-handling.ts
  persistence.ts
  dispatch.ts
```

Pay particular attention to duplicated logic between execute and resume paths.

#### Channel service

`packages/gateway/src/channels/service-impl.ts` mixes plugin discovery, outbound messaging, inbound message pairing, ownership, verification, session persistence, and bridge runtime.

Suggested target structure:

```text
channels/
  service.ts
  plugin-registry.ts
  outbound.ts
  inbound.ts
  pairing.ts
  ownership.ts
  session-bridge.ts
```

This should be sequenced after stronger tests because channel integrations have high operational blast radius.

### P1 — Move domain logic out of route files

`packages/gateway/src/routes/claws.ts` is a route file but also contains domain helpers such as health scoring, safe-fix patch generation, and session serialization.

Move pure helpers into service-level modules:

```text
services/claw/health.ts
services/claw/recommendations.ts
services/claw/serialization.ts
```

Routes should own only HTTP concerns: validation, status codes, and response mapping.

### P1 — Decide Agentic execution persistence model

`packages/gateway/src/routes/agentic.ts` uses a shared in-process `AgenticOrchestrator` singleton so executions survive across requests in the same process. This is acceptable as a first implementation, but process restart loses execution history.

Recommended next step: introduce a DB-backed execution store or repository for `AgenticReport` and step events.

Minimum design requirements:

- Persist execution metadata, status, created/updated timestamps, and last error
- Persist step-level events or summarized steps
- Support cancellation status after restart
- Support cursor pagination for execution lists
- Keep in-memory map as a cache, not the source of truth

### P1 — Narrow core service/agent imports further

The gateway still imports heavily from broad core sub-paths such as `@ownpilot/core/services` and `@ownpilot/core/agent`. Some imports are legitimate, but the wide barrels caused previous mock and alias issues.

Recommended path:

1. Keep existing broad sub-paths as compatibility barrels.
2. Add narrower exports for stable domains.
3. Migrate gateway by domain, not mechanically all at once.
4. Expand ESLint `no-restricted-imports` only after each domain has a narrow replacement.

Candidate exports:

```text
@ownpilot/core/services/registry
@ownpilot/core/services/runtime
@ownpilot/core/services/config
@ownpilot/core/services/llm
@ownpilot/core/services/memory
@ownpilot/core/services/claw
@ownpilot/core/services/coding-agent
@ownpilot/core/agent/providers
@ownpilot/core/agent/soul
@ownpilot/core/agent/messages
```

### P2 — Standardize cursor pagination for hot endpoints

`routes/helpers.ts` clamps offset pagination at `MAX_PAGINATION_OFFSET = 10000`, which is a good mitigation. It is still not ideal for high-volume tables.

Introduce a cursor pagination helper for new and hot endpoints:

```ts
interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
```

Priority resources:

- chat messages
- channel messages
- request logs
- heartbeat logs
- costs
- agentic executions
- workflow execution logs

### P2 — Reduce repeated route try/catch blocks

Many routes repeat `try/catch` and manually map unknown errors to `apiError(... INTERNAL_ERROR ...)`.

Introduce a wrapper:

```ts
export function withRouteErrors(handler: RouteHandler): RouteHandler {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) },
        500
      );
    }
  };
}
```

Then evolve it to map domain errors to `400`, `404`, `409`, and `503` centrally.

### P2 — Adopt structured production logging

A broad scan found hundreds of `console.*` occurrences across packages. Many are expected in CLI and tests, but gateway/core production paths should converge on structured logging.

Recommended schema:

```json
{
  "level": "info",
  "traceId": "...",
  "event": "agentic.step.complete",
  "timestamp": "ISO8601",
  "duration_ms": 123,
  "outcome": "success"
}
```

Priority modules:

- `gateway/src/agentic/*`
- `gateway/src/services/workflow/*`
- `gateway/src/services/claw/*`
- `gateway/src/channels/*`
- `gateway/src/ws/*`
- `core/src/agent/*`

### P2 — Split UI workflow templates from UI code

`packages/ui/src/components/workflows/workflow-templates.ts` is mostly static template data and is over 1k lines.

Suggested target structure:

```text
components/workflows/workflow-templates/
  index.ts
  types.ts
  api.ts
  business.ts
  content.ts
  data.ts
  devops.ts
  monitoring.ts
  personal.ts
  research.ts
  security.ts
```

Add validation tests that ensure each template has required metadata, valid nodes, and no duplicate IDs.

### P3 — Small quality cleanups

- Replace biased shuffle in `WorkflowCopilotPanel.pickRandom()` with Fisher-Yates.
- Replace `ToastProvider` notification ID generation with `crypto.randomUUID()` where available.
- Keep `Math.random()` for jitter/sampling where non-security-sensitive and documented.
- Update `refactor-next.md` with current numbers; several older findings appear partially or fully resolved.

## Risk notes

### `dangerouslySetInnerHTML`

The only production UI hit observed was `HtmlWidget`, and it uses sanitized HTML. Keep this as an allowlisted pattern and require sanitizer proximity for future uses.

### eval/new Function

Most matches are tests, validators, safe-math comments, or Puppeteer `$eval`. No direct production `globalThis.eval()` use was identified in this pass.

### TODO/FIXME

No meaningful production TODO debt was identified by the quick scan. The visible `TODO` in `manager-helpers.ts` is seeded task-file content, not source TODO debt.

### Type casts

Production `as any` appears low; most hits are tests. `as unknown as` still exists at trust boundaries. Create a script that reports production-only counts so future roadmap numbers do not mix tests with source.

## Recommended execution plan

### Phase 1 — Metrics and low-risk extraction

1. Add `scripts/report-code-health.mjs`.
2. Update `refactor-next.md` with fresh production/test-separated metrics.
3. Extract pure helper modules from `routes/claws.ts`.
4. Fix UI biased shuffle and notification ID generation.
5. Add characterization tests for ClawManager and WorkflowService.

Exit criteria:

- Code health report is reproducible.
- `routes/claws.ts` shrinks without behavior change.
- Package-scoped typecheck and tests pass.

### Phase 2 — Runtime service splits

1. Split `workflow-service.ts` runtime and persistence.
2. Split `claw/manager/manager.ts` lifecycle/tasks/escalation.
3. Split `channels/service-impl.ts` inbound/outbound/pairing.
4. Keep compatibility barrels for all moved modules.

Exit criteria:

- No gateway service runtime file exceeds 800 LOC unless it is generated/static data.
- Existing public imports continue working.
- Gateway test suite remains green.

### Phase 3 — Architecture tightening

1. DB-backed Agentic execution store.
2. Cursor pagination helper and migration for hot endpoints.
3. Narrow core service/agent sub-path exports.
4. Structured logging rollout.
5. UI workflow template data split and validation tests.

Exit criteria:

- Agentic executions survive process restart.
- New hot endpoints avoid offset pagination.
- Gateway import policy prevents newly broad core imports.
- Production logs follow structured schema in critical runtime paths.

## Suggested next prompts

```text
Create scripts/report-code-health.mjs and update refactor-next.md with fresh metrics
```

```text
Extract health/recommendation helpers from packages/gateway/src/routes/claws.ts with tests
```

```text
Plan the WorkflowService split with dependency graph and characterization tests
```
