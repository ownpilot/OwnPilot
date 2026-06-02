# Plan 04 — Sandbox & Permission System Hardening

**Priority:** P0
**Effort:** L (1 week)
**Risk:** High
**Depends on:** 02 (`requireOwnership` is reused for the owner check)
**Source reports:** `CODE_REVIEW.md` EXT-001, EXT-002, PERM-001, PERM-002, PERM-003, RACE-001; `refactor.md` §3.2

---

## Context

The extension sandbox and the broader permission system have three classes
of vulnerability that are exploitable in production:

- **EXT-001 (path traversal):** `isWithinDirectory(skillDir, fullPath)` is
  called with the arguments in the wrong order. The intent is "is `fullPath`
  inside `skillDir`?" but the code checks "is `skillDir` inside `fullPath`?"
  — the inverse. An extension with `script_paths: ['../../secrets']` escapes
  the skill directory and reads or writes arbitrary files.
- **EXT-002 (impersonation):** The extension worker sends `ownerUserId` in
  the `callTool` bridge message, and the main thread trusts that value to
  set the `userId` on the resulting `toolContext`. A malicious extension
  can claim to be any user — defeating per-user blocklists, audit trails,
  and downstream authorization.
- **PERM-001 (suffix-match over-permission):** `allowedTools` uses
  `tool.endsWith('.${t}')` to match, so `allowedTools: ['delete']` permits
  any tool whose name ends with `.delete` (e.g., `db.delete_file`,
  `fs.delete_directory`). The correct semantic is exact match against the
  tool's base name.

In addition, the `permission/gate.ts` has dead code (`allowSubclaws === false`
literal check, `require_approval` silently treated as `deny`) and the
`approvalId` race in `execution-approval.ts` allows two concurrent requests
to clobber each other's decisions (one auto-rejects, the other hangs for
the full 120s timeout).

The sandbox permission fix is partly already landed per `refactor.md` §14
(`workerData` now carries `ownerUserId` + `grantedPermissions`); this plan
verifies, extends, and adds the missing pieces — particularly the bridge
trust model in EXT-002, which the existing fix did not address.

## Scope

- `packages/gateway/src/services/extension/service.ts:520` (path traversal)
- `packages/gateway/src/services/extension/sandbox.ts:386`
  (worker → main ownerUserId trust)
- `packages/gateway/src/services/tool/executor.ts:386` (main thread
  `userId` assignment)
- `packages/gateway/src/services/permission/gate.ts:259-261, 344, 358`
  (subclaw check, suffix match, require_approval)
- `packages/gateway/src/services/permission/execution-approval.ts:11-17, 28-43`
  (unbounded map, race)
- `packages/gateway/src/utils/path.ts` (new — `isWithinDirectory`, used in
  EXT-001)
- `packages/gateway/src/utils/permission.ts` (new — `toolBaseName`, used
  in PERM-001)

## Goals

1. `isWithinDirectory(child, parent)` is a single, audited utility with a
   test suite. All callers in the extension system use it correctly.
2. The main thread derives `ownerUserId` from the worker registration, not
   from any message sent by the worker.
3. The `allowedTools` check matches the tool's base name exactly, not by
   suffix.
4. The execution-approval flow uses an atomic claim (singleflight pattern)
   and the `pendingApprovals` map is bounded.
5. The dead-code branches (`allowSubclaws === false` literal,
   `require_approval` silent deny) are fixed or removed.
6. All five fixes have unit + integration tests.

## Implementation Steps

### Step 1 — Extract and test `isWithinDirectory`

Create `packages/gateway/src/utils/path.ts`:

```ts
/**
 * Returns true if `child` resolves to a path inside `parent` after
 * normalization. Resolves relative segments, normalizes slashes for the
 * current platform, and rejects paths that escape via `..` segments.
 */
export function isWithinDirectory(parent: string, child: string): boolean;
```

Implement using `path.resolve()` from `node:path` plus a final
`startsWith(parent + path.sep)` check. Add a `.test.ts` covering:

- `isWithinDirectory('/a', '/a/b')` → true
- `isWithinDirectory('/a', '/a/b/../c')` → true (c is inside a)
- `isWithinDirectory('/a', '/a/../b')` → false (b is sibling)
- `isWithinDirectory('/a', '/b/../a/c')` → true
- `isWithinDirectory('/a', '/secrets')` → false
- `isWithinDirectory('C:\\a', 'C:\\a\\b')` → true (Windows)

Replace the inverted call in `extension/service.ts:520`:

```ts
- if (!isWithinDirectory(skillDir, fullPath)) {
+ if (!isWithinDirectory(skillDir, fullPath)) {  // child=fullPath, parent=skillDir
+   // fullPath is NOT inside skillDir
+ }
```

(Note: the existing call has the args in the right conceptual order; the
audit finding is about which one should be the child. Verify by reading
the call site before editing — line numbers may have shifted.)

### Step 2 — Trust the worker registration, not the bridge message

In `packages/gateway/src/services/extension/sandbox.ts`:

- On worker start, persist the worker's `ownerUserId` and
  `grantedPermissions` in a `Map<workerId, WorkerContext>` keyed by the
  worker's PID + extension ID.
- In the `callTool` bridge handler, look up the context by worker ID; never
  accept `ownerUserId` from the message itself.
- The `audit.extension.callTool` event payload no longer includes
  `msg.ownerUserId`; it includes `workerOwnerUserId` (the trusted value) and
  `msgClaimedUserId` (for forensic visibility — the worker is lying if
  these differ).

In `packages/gateway/src/services/tool/executor.ts:386`:

- Replace `ownerUserId: msg.ownerUserId ?? 'system'` with
  `ownerUserId: workerRegistry.get(workerId)?.ownerUserId ?? 'system'` —
  but this should never be `'system'` in practice. If the lookup fails,
  return an `internal_error` result and emit an audit event at `error`
  level (a worker that does not have a registered context is anomalous).

### Step 3 — Fix `allowedTools` base-name match

In `packages/gateway/src/services/permission/gate.ts:344`:

- Replace `tool.endsWith('.${t}')` with `toolBaseName(tool) === t` where
  `toolBaseName(tool)` strips the namespace prefix (the part before the
  first `.` in many cases, or applies the existing
  `stripToolNamespace` helper if one exists).
- Add a `utils/permission.ts` test covering:
  - `toolBaseName('db.delete_file') === 'delete_file'`
  - `toolBaseName('fs.delete') === 'delete'`
  - `toolBaseName('delete') === 'delete'`
  - `allowedTools: ['delete']` does not match `'db.delete_file'`

### Step 4 — Bound the `pendingApprovals` map

In `packages/gateway/src/services/permission/execution-approval.ts:11-17`:

- Add a `setInterval` cleanup of expired approvals (similar to
  `ws/server.ts`'s `authAttempts` pattern). The interval is registered in
  the service lifecycle, not at module load.
- Cap the total in-flight count at 1000; new requests beyond the cap are
  rejected with `internal_error` and audited.
- Use a `Map` with a soft cap and a hard cap; log a warning when the soft
  cap is hit.

### Step 5 — Atomic claim for `approvalId`

In `packages/gateway/src/services/permission/execution-approval.ts:28-43`:

- Replace the read-then-write pattern with an atomic claim:
  ```ts
  const existing = pendingApprovals.get(approvalId);
  if (!existing) return { ok: false, reason: 'expired_or_missing' };
  if (existing.decision) return { ok: false, reason: 'already_decided' };
  // Claim ownership: register a single decision
  existing.decision = { approved, decidedBy: userId, decidedAt: Date.now() };
  ```

  - Use the JS event loop's single-threaded guarantee: a synchronous block
    between the read and the write is enough since no `await` is involved.
  - If the caller is not the `requestedBy` user or an approver, return
    `forbidden` without touching the state.

### Step 6 — Dead-code cleanup

In `packages/gateway/src/services/permission/gate.ts:259-261`:

- The literal `allowSubclaws === false` check should be replaced with a
  normalized check (treat `undefined` as the default, `false` as opt-out,
  `true` as opt-in). Document the new default in a comment.

In `packages/gateway/src/services/permission/gate.ts:358`:

- The `require_approval` branch should result in an interactive
  approval-flow result, not a silent deny. Add an integration with
  `execution-approval.ts` so the request is queued and the caller is told
  to poll.

## Acceptance Criteria

1. `isWithinDirectory('/a', '/secrets')` returns `false`. The extension
   service test that previously exploited `script_paths: ['../../secrets']`
   now fails to escape.
2. An extension that lies about `ownerUserId` in a `callTool` message is
   audited with the discrepancy (`workerOwnerUserId !== msgClaimedUserId`)
   and the tool call is attributed to the trusted value.
3. `allowedTools: ['delete']` no longer matches `db.delete_file`. Existing
   extension manifests that used suffix-style matching continue to work
   (audit shows no current extension uses suffix matching — verify
   before merge).
4. Two concurrent resolve calls on the same `approvalId` resolve to
   `ok: false, reason: 'already_decided'` for the second caller.
5. The `pendingApprovals` map is bounded at 1000 entries; the 1001st
   request is rejected with a clear error and an audit event.
6. `require_approval` permissions return a `pending_approval` result, not
   a silent `deny`.

## Test Plan

- `tests/utils/path.test.ts` — full table for `isWithinDirectory`.
- `tests/services/extension-service.test.ts` — extension with malicious
  `script_paths` is rejected at install time and at runtime.
- `tests/services/permission-gate.test.ts` — table for `allowedTools`
  base-name matching; `allowSubclaws` defaults; `require_approval` flow.
- `tests/services/execution-approval.test.ts` — concurrent resolve race;
  bounded map; cleanup interval.
- An end-to-end audit test: install an extension, fire a `callTool` that
  lies about `ownerUserId`, assert the audit log shows the discrepancy.

## Risks & Rollback

- **Risk:** The atomic claim in Step 5 changes the response shape for
  concurrent callers (second caller now gets `already_decided` instead of
  hanging). Mitigation: document the new contract in
  `docs/API_ROUTES.md`; flag this as a breaking change in the changelog.
- **Risk:** Bounding the `pendingApprovals` map at 1000 might be too low
  for high-throughput workflows. Mitigation: make the cap a config value
  with a sensible default; document the throughput implications.
- **Risk:** Fixing the suffix-match in `allowedTools` could break
  extensions that rely on the old (incorrect) behavior. Mitigation: ship
  the change behind a `OWNPILOT_PERMISSION_STRICT` flag, default-off for
  one release. Audit existing extension manifests before flipping.
- **Rollback:** Each step is independently revertible. Step 1 is a single
  utility addition. Step 2 reverts to trusting the message. Steps 3–6
  are local fixes to specific files.

## Out of Scope

- Sandboxing the workflow `vm` context for cross-realm object leaks
  (covered in `refactor_plan.md` H3, marked done — verify with a
  regression test before relying on the fix).
- Replacement of `vm` with `isolated-vm`. Same source as above — research
  task, deferred.
- Permission UX in the UI. The permission schema and gate are fixed here;
  surfacing the new state in the UI is a Plan 13 concern.
