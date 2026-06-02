# Plan 05 — Template Injection & Workflow Approval Hardening

**Priority:** P0
**Effort:** M (3–5 days)
**Risk:** Medium
**Depends on:** 04 (the approval ownership work intersects)
**Source reports:** `CODE_REVIEW.md` TPL-001, TPL-002, APPR-001, APPR-002, APPR-003, WF-001, WF-002, WF-003

---

## Context

The workflow template resolver and the approval subsystem together form the
highest-value attack surface for a malicious actor who has reached the
workflow authoring plane (which is the same plane that owns the agent
runtime, the file system, the network, and the email/SMS gateways).

Two template-injection classes:

- **TPL-001 (recursive resolution):** `deepResolve` re-runs string
  resolution on any string that contains `{{...}}`. A workflow author can
  template `"Token: {{nodeA.output.field}}"` where Node A's output is
  `"{{__inputs.apiKey}}"` — the secret leaks into Node B's templated
  string. There is no depth limit, no cycle guard, and no allowlist of
  resolvable variables.
- **TPL-002 (auto-parse):** `getNestedValue` auto-parses JSON-looking
  strings at every path step. A common LLM output of `{"secret": "..."}` is
  auto-parsed and the nested template re-resolves — turning normal LLM
  output into a template injection vector.

Three approval issues:

- **APPR-001 (race):** Concurrent approve/reject calls overwrite each
  other silently. Two clicks within milliseconds, the second wins, no
  indication of conflict.
- **APPR-002 (no authorization):** `resumeFromApproval(userId, ...)` does
  not verify that the caller is the workflow owner or a designated
  approver. Anyone with the approval ID can resolve it.
- **APPR-003 (brute-force):** Short numeric codes (e.g., 6 digits) are
  compared with `timingSafeEqual`, but a parallel attacker across many
  `platformUserId` values can brute-force within rate-limit windows.

Three workflow reliability issues, all caused by silent error swallowing:

- **WF-001:** The error-handler node is never executed because failed
  nodes fabricate a synthetic `'success'` result.
- **WF-002:** Version snapshot creation errors are swallowed silently.
- **WF-003:** `executeWorkflow`'s `started` event fires before the
  execution promise settles, so post-start errors are lost.

## Scope

- `packages/gateway/src/services/workflow/template-resolver.ts:28-30, 137-167`
- `packages/gateway/src/services/workflow/workflow-service.ts:366-408, 542-549, 556-570, 580, 985, 1269`
- `packages/gateway/src/services/workflow/workflow-service.ts:1370` (cross-ref)
- `packages/gateway/src/channels/service-impl.ts:783-787`
- `packages/gateway/src/services/permission/execution-approval.ts` (overlap with Plan 04)

## Goals

1. Template resolution is bounded by a depth limit and an explicit
   allowlist of resolvable variables; recursive resolution of strings
   that contain `__inputs.*` is forbidden.
2. JSON auto-parsing in `getNestedValue` is opt-in per node, not
   automatic. Default off.
3. Approval resolution requires the caller to be the workflow owner or
   in the approver list (complements Plan 04's per-resource ownership).
4. Approval IDs include a one-time-use nonce; replay of the same ID is
   rejected.
5. Numeric approval codes are rate-limited per `platformUserId` _and_
   per `approvalId`, with exponential backoff.
6. Workflow error paths surface real failures; error-handler nodes run;
   version snapshot errors are reported; `executeWorkflow` errors are
   observable.

## Implementation Steps

### Step 1 — Bound and allowlist template resolution

In `packages/gateway/src/services/workflow/template-resolver.ts`:

- Add a `MAX_RESOLUTION_DEPTH = 5` constant. `deepResolve` increments a
  depth counter; values over the limit return the original string with a
  `truncated: true` flag (no throw — workflows should not break for
  legitimate deeply-nested templates).
- Maintain a `resolvedKeys: Set<string>` per resolution call. If a key is
  requested twice within the same call, the second request returns
  `'<cycle:key>'` instead of recursing.
- Maintain a `forbiddenPrefixes: string[] = ['__inputs.', '__secrets.']`
  list. Any template that, after one resolution, yields a string that
  _contains_ one of these prefixes, is _not_ re-resolved.
- Update the public `resolveTemplate` function to accept the
  `{ maxDepth, forbiddenPrefixes, allowJsonParse }` options object and
  default to safe values.

### Step 2 — Opt-in JSON parsing

In `packages/gateway/src/services/workflow/template-resolver.ts:137-167`:

- Remove the auto-parse in `getNestedValue`. The function returns the raw
  value as-is.
- Add an opt-in `parseJson: boolean = false` option to the
  `transformer` node and the `http-request` node. When true, the result
  is parsed exactly once and re-resolved through the same depth-limited
  pipeline. Document the security trade-off in the node schema.

### Step 3 — Approval authorization

In `packages/gateway/src/services/workflow/workflow-service.ts:542-549, 1269`:

- Before resolving an approval, fetch the workflow, verify the caller's
  `userId` matches `workflow.userId` OR is in `workflow.approverIds`.
  Return 403 on mismatch; the request never reaches the approval state
  machine.
- The `subWorkflowNode` pattern (L1370) is the reference implementation;
  mirror its ownership check style.

### Step 4 — One-time-use approval IDs

In `packages/gateway/src/services/permission/execution-approval.ts`:

- When the approval is created, generate a `nonce: string` via
  `crypto.randomBytes(16)`. Store `nonce` on the approval row.
- `resolveApproval(id, decision, nonce)` requires the nonce to match;
  successful resolution marks the approval row with `consumedAt` and
  rejects subsequent calls with `already_consumed`.
- The nonce is returned to the workflow UI exactly once (via the
  workflow's `pendingApproval` payload).

### Step 5 — Rate-limit numeric approval codes

In `packages/gateway/src/channels/service-impl.ts:783-787`:

- Wrap the `timingSafeEqual` call in a per-`platformUserId` rate limiter
  (reuse the `createLoginThrottle` helper from C2 in `refactor_plan.md`).
- After 3 wrong submissions, force a 30-second cooldown.
- After 10 wrong submissions, force a 24-hour lockout and emit an
  `audit.approval.codeLockout` event.
- The `platformUserId` × `approvalId` matrix means an attacker can't
  parallelize across many `platformUserId` values either — the per-account
  cap aggregates.

### Step 6 — Surface workflow errors

In `packages/gateway/src/services/workflow/workflow-service.ts:366-408`:

- Remove the synthetic success fabrication. The failed node's result
  remains `{ status: 'error', error: ... }`. The error-handler node
  (if configured) is the mechanism for recovery, and it now actually
  runs.
- For workflows without an error handler, the workflow ends with
  `status: 'error'` and a non-zero exit code; the CLI / UI surface the
  error.

In `packages/gateway/src/services/workflow/workflow-service.ts:580`:

- Wrap the version snapshot creation in a try/catch that emits an
  `audit.workflow.versionCreate` event with `ok: false, error: ...`. Do
  not swallow.

In `packages/gateway/src/services/workflow/workflow-service.ts:985`:

- Store the `executionPromise` and attach a `.catch(err => ...)` that
  emits an `audit.workflow.executionFailed` event with the full error.
  The `started` event payload includes the `executionPromise`'s
  resolution method, so callers can `await` it if they need the final
  state.

## Acceptance Criteria

1. A workflow that templates `"{{nodeA.output}}"` where `nodeA.output`
   is `"{{__inputs.apiKey}}"` does not leak the secret into `nodeB.output`
   when `nodeB` is `"Token: {{nodeA.output}}"`. The string returned is
   either truncated or the inner `__inputs` reference is preserved
   verbatim.
2. A transformer node with `parseJson: false` (default) does not
   auto-parse a string value that looks like JSON.
3. A user who is neither the workflow owner nor in `approverIds` calling
   `POST /api/v1/workflows/:id/approvals/:approvalId/resolve` returns 403.
4. A second call to resolve the same `approvalId` with a reused nonce
   returns `already_consumed`.
5. 4 wrong approval-code submissions in 60 seconds forces a 30s cooldown;
   the 11th wrong submission in 24h forces a 24h lockout.
6. A failed node no longer fabricates success; the workflow's
   `errorHandler` node (if configured) runs.
7. An `executeWorkflow` error after `started` is emitted in an
   `audit.workflow.executionFailed` event with the full error.

## Test Plan

- `tests/services/template-resolver.test.ts` — depth limit, cycle
  detection, `__inputs` re-resolution forbidden.
- `tests/services/workflow-service.test.ts` — failed-node path,
  error-handler invocation, version-snapshot error reporting,
  execution-failed audit.
- `tests/services/execution-approval.test.ts` — nonce consumption,
  cross-user 403.
- `tests/channels/service-impl.test.ts` — approval-code rate limit;
  lockout audit.
- An end-to-end workflow test in `tests/e2e/`: workflow with an
  unhandled error reaches the configured `errorHandler` node.

## Risks & Rollback

- **Risk:** Removing the auto-parse breaks workflows that rely on the
  current behavior. Mitigation: ship behind `WORKFLOW_LEGACY_TEMPLATE`
  flag, default-off, log a one-time warning. Existing workflows
  opt-in to `parseJson: true` to keep their behavior.
- **Risk:** Depth-limit at 5 may be too aggressive for deep DAGs.
  Mitigation: make the limit configurable per workflow (default 5, max
  50). Most workflows need 2–3.
- **Risk:** One-time-use approval IDs change the workflow API contract.
  Mitigation: document the change; the new `nonce` field is additive
  (old clients ignoring it will fail their second resolve, but the
  first works — degraded, not broken).
- **Rollback:** The flag-based rollout handles Steps 1 and 2. Steps 3–6
  are local changes; revert one commit per step if needed.

## Out of Scope

- General workflow execution policy (concurrency caps, total runtime
  limits). Belongs to Plan 10 (Claw & runtime reliability).
- Replacing the template language entirely (e.g., moving to JsonLogic
  or a sandboxed expression evaluator). The current language is fine
  with the depth + allowlist guard; full replacement is a much larger
  refactor.
