# Code Review — OwnPilot

**Date:** 2026-05-30
**Scope:** `packages/gateway`, `packages/core`, `packages/ui`
**Total Issues Found:** 100+
**Critical (P0):** 33 | **High (P1):** 32 | **Medium/Low (P2-P3):** 35+

---

## P0 — CRITICAL — Fix Immediately

### SSRF-001 — `DEFAULT_MAX_REQUEST_BODY_SIZE` undefined at call site

**File:** `packages/gateway/src/utils/safe-fetch.ts:48`

```ts
const {
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRequestBodySize = DEFAULT_MAX_REQUEST_BODY_SIZE, // ← undefined! Defined at line 161
  ...fetchOptions
} = options;
```

`DEFAULT_MAX_REQUEST_BODY_SIZE` (line 161) is referenced before it exists in scope. The body size cap at line 55 `if (maxRequestBodySize && bodyBytes > maxRequestBodySize)` always skips — cap is non-functional. Additionally, `clearTimeout(timeout)` in the `finally` block crashes on every call since `timeout` is `undefined` from the `.unref?.()` chain.

**Impact:** Body cap completely broken; runtime crash on every outbound HTTP request via `safeFetch`.

---

### SSRF-002 — `127.1` IPv4 shorthand bypasses blocklist

**File:** `packages/gateway/src/utils/ssrf.ts:36`

```ts
/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i;
```

Regex only blocks pure numeric forms (`2130706433`, `0177`). **`127.1`** (single-octet shorthand for `127.0.0.1`) contains a dot, does not match the pattern, passes unblocked. Same for `127.2`, `127.255`, etc.

**Impact:** SSRF to localhost via `127.1`, `127.2`, ..., `127.255`.

---

### SSRF-003 — `172.016.0.0` bypasses 172.16.0.0/12 block

**File:** `packages/gateway/src/utils/ssrf.ts:38-39`

```ts
const m172 = h.match(/^172\.(\d+)\./);
if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
```

`Number("016")` → `14`. `172.016.0.0` gives `14 < 16` → not blocked. Any zero-padded octet in the 172.16–172.31 range bypasses the block.

**Impact:** SSRF to 172.16.0.0/12 internal networks.

---

### AUTH-001 — Debug auth bypass when `NODE_ENV !== 'production'`

**File:** `packages/gateway/src/routes/debug.ts:13-41`

```ts
if (process.env.NODE_ENV === 'production') {
  // auth check runs
}
return next(); // all debug routes open in non-production (including unset)
```

Every debug endpoint (logs, errors, circuit breakers, sandbox traces) is accessible without auth unless `NODE_ENV === 'production'` exactly. In bare Node deployments `NODE_ENV` is commonly unset.

**Impact:** Full debug endpoint access including log inspection and sandbox traces.

---

### AUTH-002 — `/api/v1/provider-auth` unauthenticated

**File:** `packages/gateway/src/routes/register/platform.ts:38`

```ts
app.route('/api/v1/provider-auth', providerAuthRoutes);
```

Mounted via `.route()` at its own prefix, bypassing `createAuthMiddleware`. All OAuth device-code endpoints (`/oauth/device/start`, `/oauth/device/poll`, `/signout`, `/providers`, full CRUD on `/config/:provider`) are fully unauthenticated.

**Impact:** Attacker can initiate OAuth device-code flow, wait for victim to approve, poll to steal token.

---

### AUTH-003 — approvalId enumeration without ownership check

**File:** `packages/gateway/src/routes/execution-permissions.ts:83-101`

```ts
app.post('/approvals/:id/resolve', async (c) => {
  const approvalId = c.req.param('id');
  const body = await c.req.json<{ approved: boolean }>();
  const resolved = resolveApproval(approvalId, body.approved); // no ownership check
```

`resolveApproval` looks up by ID in an in-memory map with no requester verification. Attacker who guesses an `approvalId` can approve or reject arbitrary pending execution requests.

**Impact:** Arbitrary execution approval/rejection.

---

### IDOR-001 — IDOR on all agent CRUD operations

**File:** `packages/gateway/src/routes/agents/index.ts:80, 159–308`

```ts
GET / → agentsRepo.count() + agentsRepo.getPage(100, 0)  // no userId filter
GET /:id, PATCH /:id, DELETE /:id, POST /:id/reset       // no ownership check
```

Any authenticated user can read, modify, reset, or delete any agent by ID across the entire deployment.

---

### IDOR-002 — IDOR on all 15 soul sub-routes

**File:** `packages/gateway/src/routes/souls/agent-routes.ts:49–662`

`/:agentId/logs`, `/:agentId/memories`, `/:agentId/goals`, `/:agentId/tools`, `/:agentId/stats`, `/:agentId/versions`, `/:agentId/feedback`, etc. — none verify `agentId` belongs to the requesting user.

**Impact:** Full enumeration of any user's agent data across all sub-routes.

---

### IDOR-003 — IDOR on all messages endpoints + `from` spoofing

**File:** `packages/gateway/src/routes/agents/messages.ts:21–101`

```ts
GET /, GET /agent/:id, GET /thread/:id, GET /crew/:id  // no user ownership
POST / → body.from accepted unvalidated                // any user can spoof sender
```

**Impact:** Read any user's messages; spoof messages as any identity.

---

### IDOR-004 — IDOR on command-center `/mission`, `/tools/batch-update`, `/execute`

**File:** `packages/gateway/src/routes/agents/command-center.ts:437–766`

- `POST /mission`: iterates `body.agentIds` and `body.crewIds` without ownership verification
- `POST /execute` (L595): discards return value of `getUserId(c)` — auth failure silently ignored
- `POST /tools/batch-update`: no ownership verification on `body.agentIds`

---

### IDOR-005 — Crew memory deletion IDOR + `/templates` unauthenticated

**File:** `packages/gateway/src/routes/crews.ts:142-145, 683–704`

- `GET /templates`: no `getUserId()` call — unauthenticated access to crew templates
- `DELETE /:id/memory/:memoryId`: verifies crew ownership but not that memory belongs to that crew

---

### IDOR-006 — Auth bypass via `userId='default'` fallback

**File:** `packages/gateway/src/routes/souls/index.ts:42-46, 63-67`

```ts
const userId = getUserId(c) ?? 'default';
```

`/stats` and `/health` treat `'default'` as valid — returns data for literal string `'default'` when middleware fails to set `userId`.

**Impact:** Cross-user data leak when auth middleware misconfigures.

---

### IDOR-007 — No ownership on any custom-data record operation

**File:** `packages/gateway/src/routes/custom-data.ts:97–362`

Every `GET/PUT/DELETE /records/:id`, `/tables/:table/records`, `/search` accepts raw IDs with zero user scoping. UUID enumeration gives full record access.

---

### IDOR-008 — Chat history `/logs/:id` IDOR + `olderThanDays` DoS

**File:** `packages/gateway/src/routes/chat/history.ts:142-151, 859-878`

- `GET /logs/:id`: `logsRepo.getLog(id)` without checking `log.userId === userId`
- `olderThanDays`: `listConversations({ limit: 10000 })` without `userId` — fetches 10K conversations across all users, filters in JS

---

### IDOR-009 — `/costs/expensive`, `/costs/export`, subscriptions IDOR

**File:** `packages/gateway/src/routes/costs.ts:105, 563-659`

- `GET /expensive` and `GET /export`: no `userId` — returns all users' usage data
- `GET /subscriptions`: `getUserId(c) ?? 'default'` — returns data for literal `'default'` on auth misconfiguration

---

### IDOR-010 — Tool source leak + tool execute by name

**File:** `packages/gateway/src/routes/tools.ts:299, 370`

No ownership check. Any authenticated user can retrieve or execute any tool by name.

---

### IDOR-011 — CorrelationId audit trace accessible cross-user

**File:** `packages/gateway/src/routes/audit.ts:183-203`

```ts
await logger.query({ correlationId: requestId, actorId: userId });
```

`correlationId` traces full request chains including other users' events. `actorId` filter is cosmetic — most trace events have `actorType: 'system'` with no `actorId`. Attacker who guesses a `requestId` can read the full execution trace.

---

### IDOR-012 — All GET `/database/*` skip admin key

**File:** `packages/gateway/src/routes/database/index.ts:25`

```ts
if (c.req.method === 'GET' && !pathname.includes('/export')) {
  return next();
}
```

All GET under `/database/*` pass without admin key. `/stats` exposes connection counts, per-table row counts, sizes. `/status` exposes host/port/database name.

---

### IDOR-013 — Bridge `getById` before ownership + bridge created without userId

**File:** `packages/gateway/src/routes/bridges.ts:53, 72-84`

- `getById(id)` fetches before ownership check — leaks existence
- `repo.save({...})` with no `userId` — bridge has no owner

---

### IDOR-014 — File-workspaces IDOR when `workspace.userId` is falsy

**File:** `packages/gateway/src/routes/file-workspaces.ts:53-68`

```ts
if (workspace.userId && workspace.userId !== userId) {
  return 404;
}
```

When `userId` is null/undefined/empty, check is skipped — returns workspace to any authenticated user.

---

### IDOR-015 — `/system/status` exposes all userIds

**File:** `packages/gateway/src/routes/workspaces/container.ts:230-244`

```ts
{ userId: c.userId, workspaceId: c.workspaceId, status: c.status, ... }
```

Any authenticated user can enumerate who is running containers and when.

---

### IDOR-016 — Hardcoded `'default'` userId in MCP tool-call proxy

**File:** `packages/gateway/src/routes/mcp.ts:178`

```ts
const context = { userId: 'default', ... };
```

Every MCP CLI tool call runs as `'default'` regardless of session userId.

---

### IDOR-017 — No auth on `/claws` + 4 voice endpoints

**File:** `packages/gateway/src/routes/pulse.ts:17-25`, `routes/voice.ts:44-86`

- `GET /claws`: no auth — claw status and circuit state publicly accessible
- `/config`, `/status`, `/voices`, `/diagnostics` in voice: no `getUserId(c)` — voice provider info and service diagnostics exposed

---

### IDOR-018 — IDOR on step access (plans, goals) + connection ops (composio)

**File:** `packages/gateway/src/routes/plans.ts:586, 603`, `routes/goals.ts:264-343`, `routes/composio.ts:143, 165, 184`

`GET/PATCH /:id/steps/:stepId` fetches by `stepId` only, no plan ownership check. Same pattern across goals and Composio connection operations.

---

### IDOR-019 — Conversation read + delete IDOR

**File:** `packages/gateway/src/routes/chat/index.ts:943-1018`

```ts
const conversation = memory.get(id); // no user ownership check
const deleted = memory.delete(id); // no user ownership check
```

User A can read or delete User B's conversation by guessing the ID.

---

### IDOR-020 — API key auth but session userId for workflow ownership

**File:** `packages/gateway/src/routes/workflow/index.ts:883–1033`

```ts
if (!safeKeyCompare(providedKey, adminKey)) { ... }  // API key validated
const userId = getUserId(c);                          // ← session userId used, not API key identity
```

API key bearer can run/read workflows belonging to other users. The ownership check uses the session userId, not the identity implicit in the API key.

---

### TPL-001 — Template injection: recursive resolution exfiltrates `__inputs`

**File:** `packages/gateway/src/services/workflow/template-resolver.ts:28-30`

```ts
if (typeof value === 'string') {
  return resolveStringTemplates(value, nodeOutputs, variables, aliasMap);
}
```

`deepResolve` recursively re-resolves strings containing `{{...}}`. If `__inputs.apiKey` resolves in Node A's output, and Node B templates `"Token: {{nodeA.output.field}}"`, the inner template re-resolves and exposes the secret. No depth limit or cycle guard.

---

### TPL-002 — Template injection: `getNestedValue` auto-parses JSON mid-path

**File:** `packages/gateway/src/services/workflow/template-resolver.ts:137-167`

`getNestedValue` auto-parses strings that look like JSON at every path step and again on final value. If Node A output is `'{"secret": "{{__inputs.apiKey}}"}'`, the template `{{nodeA.output.field}}` parses the string as JSON and resolves the nested template. A common LLM JSON output becomes a template injection vector.

---

### APPR-001 — Approval race: concurrent calls overwrite decisions

**File:** `packages/gateway/src/services/workflow/workflow-service.ts:556-570`

```ts
savedNodeOutputs[approvalNodeId] = { status: 'success', output: { approved: ..., decision: ... } };
```

No idempotency guard. Two concurrent approve/reject calls race — second overwrites first with no indication.

---

### APPR-002 — No authorization check for approver

**File:** `packages/gateway/src/services/workflow/workflow-service.ts:542-549, 1269`

`resumeFromApproval(userId, ...)` accepts any `userId` and creates `WorkflowApprovalsRepository(userId)` — no verification caller is the designated approver or workflow owner. `subWorkflowNode` (L1370) correctly checks `subWorkflow.userId !== userId`, but the approval path has no equivalent.

---

### APPR-003 — Approval code brute-force (timing-safe but short codes)

**File:** `packages/gateway/src/channels/service-impl.ts:783-787`

```ts
const codeMatches =
  submittedCode.length === expectedCode.length && timingSafeEqual(submittedCode, expectedCode);
```

For short numeric codes (e.g., 6 digits), `timingSafeEqual` proceeds byte-by-byte. With parallel attempts across many `platformUserId` values, brute-force is feasible within rate-limit windows.

---

### RACE-001 — `executeCycle` race past `cycleInProgress` guard

**File:** `packages/gateway/src/services/claw/manager.ts:925-937`

The guard at line 925 is non-atomic with the write at line 936. Two concurrent calls (e.g., rate-limit timer + steer) both pass, both set `abortController`, both call `runner.runCycle()` simultaneously. Wrong cycle escapes `stopClaw`, duplicate history rows, `cyclesCompleted` incremented twice.

---

### ID-001 — Predictable IDs (timestamp + short random)

**File:** `packages/core/src/services/id-utils.ts:18-22`

```ts
return `${prefix}_${Date.now()}_${random}`;
```

`Date.now()` exposes approximate creation time; 8-char random (4 bytes = ~4B possibilities) is brute-forceable within a known time window.

---

### MEM-001 — `onSessionChanged` listener not cleaned up on unmount

**File:** `packages/ui/src/hooks/useWebSocket.tsx:220-240`

```tsx
useEffect(() => {
  return onSessionChanged(({ authenticated }) => { ... });
}, [connect]);
```

The unsubscribe function returned by `onSessionChanged` is never called. On route changes that remount the provider, listeners accumulate on `window`. After many remounts, hundreds of duplicate handlers fire.

---

### WS-001 — `disconnect()` race: reconnect timer fires after intentional close

**File:** `packages/ui/src/hooks/useWebSocket.tsx:129-145, 160-173`

When `disconnect()` calls `wsRef.current.close()`, `onclose` fires synchronously and re-schedules a reconnect timer. `wsRef` is set to null but the new timer is still armed — reconnect fires despite intentional disconnect. If server rejects, infinite retry loop.

---

## P1 — HIGH — Fix Soon

### CLAW-001 — `approveEscalation` missing `markDirty`

**File:** `packages/gateway/src/services/claw/manager.ts:759-760, 774-776`

Both inbox nudge paths call `repo.appendToInbox` without `markDirty(managed)`. `dirty` stays false; persistTimer skips next tick. Crash before next explicit persist loses the nudge.

---

### CLAW-002 — `persistTimer` leak on single-shot hot-reload

**File:** `packages/gateway/src/services/claw/manager.ts:865-890`

`updateClawConfig` clears `managed.timer` but never `managed.persistTimer` when transitioning to single-shot. 30-second interval keeps firing indefinitely.

---

### CLAW-003 — `saveAuditLog` errors silently swallowed

**File:** `packages/gateway/src/services/claw/runner.ts:183-185`

```ts
this.saveAuditLog(cycleNumber, toolCalls).catch((err) => {
  log.warn(`[${this.config.id}] Failed to save audit log: ${getErrorMessage(err)}`);
});
```

DB write failure → warning logged → cycle result unchanged. Audit records for that cycle permanently lost.

---

### TRIG-001 — `Promise.allSettled` fires all due triggers with no cap

**File:** `packages/gateway/src/triggers/engine.ts:430-439`

```ts
await Promise.allSettled(dueTriggers.map((t) => this.executeTrigger(t)));
```

Trigger storm with zero throttling. Duplicate trigger IDs silently dropped — one of two concurrent fires lost.

---

### TRIG-002 — Per-type circuit breaker allows unlimited cross-type parallelism

**File:** `packages/gateway/src/triggers/engine.ts:446-488`

`processingEvents` is a single `Set<string>`. 50 different event types firing simultaneously → 50 concurrent processing tasks with no global cap.

---

### CORS-001 — CORS origin mismatch between `app.ts` and `ui-session.ts`

**File:** `app.ts:72-78` × `ui-session.ts:33-40`

`app.ts` adds `http://localhost:${uiPort}` unconditionally. `ui-session.ts` reads only `CORS_ORIGINS` env. Browser passes CORS preflight but `isTrustedBrowserOrigin()` rejects it — breaks dev auth.

---

### WF-001 — Error handler node never executed

**File:** `packages/gateway/src/services/workflow/workflow-service.ts:366-408`

Failed node fabricates synthetic `'success'` result. Node author's recovery logic never runs.

---

### CHAN-001 — Session lock Map unbounded growth

**File:** `packages/gateway/src/channels/service-impl.ts:1187-1204`

`finally` block only deletes gate if still latest. Under concurrent requests (A → B → C), A's gate is replaced by B, never cleaned up. Resolved Promise objects accumulate indefinitely.

---

### EXT-001 — Reversed `isWithinDirectory` args → path traversal

**File:** `packages/gateway/src/services/extension/service.ts:520`

```ts
if (!isWithinDirectory(skillDir, fullPath)) { // WRONG ORDER
  // checks if skillDir is inside fullPath — inverse of intent
```

`../../secrets` in `script_paths` escapes the skill directory. Should be `isWithinDirectory(fullPath, skillDir)`.

---

### EXT-002 — `msg.ownerUserId` from worker overrides real owner

**File:** `packages/gateway/src/services/extension/sandbox.ts:386`, `services/tool/executor.ts:386`

```ts
ownerUserId: msg.ownerUserId ?? 'system',
```

Extension worker sends `ownerUserId` in `callTool` message. Main thread trusts it for execution identity. Malicious extension can impersonate any user.

---

### PERM-001 — `allowedTools` suffix-match over-permissive

**File:** `packages/gateway/src/services/permission/gate.ts:344`

```ts
tool.endsWith(`.${t}`); // if allowedTools = ['delete'], permits anything.delete_file
```

Should use `toolBaseName(tool)` instead.

---

### PERM-002 — Race condition on duplicate `approvalId`

**File:** `packages/gateway/src/services/permission/execution-approval.ts:28-43`

Two simultaneous requests with same `approvalId` both read `null` before either writes. First auto-rejects, second hangs for full `APPROVAL_TIMEOUT_MS` (120s).

---

### SQL-001 — Untrusted key interpolation in JSONB filter

**File:** `packages/gateway/src/routes/custom-data.ts:376-381`

```ts
conditions.push(`data->>$${paramIndex++} = $${paramIndex++}`);
params.push(key, String(value)); // key from user-controlled filter param
```

Key injected into SQL expression without validation against table column definitions.

---

### COST-001 — `getUserId()` undefined → `'default'` fallback

**File:** `packages/gateway/src/routes/costs.ts:105`

```ts
const userId = getUserId(c) ?? 'default';
```

Returns subscription data for shared `'default'` account on auth misconfiguration.

---

### TRIG-003 — Prompt injection in AI cron parsing

**File:** `packages/gateway/src/routes/triggers.ts:518-535`

```ts
const NL_CRON_PROMPT = `Convert this natural language schedule description into a valid cron expression.
Input: "${description}"
```

Unbounded `description` embedded directly in AI prompt. Crafted input breaks JSON structure before cron field extraction.

---

### SET-001 — No auth on API key management

**File:** `packages/gateway/src/routes/settings.ts:163-185`

Any request (even default user) can set arbitrary provider API keys. `process.env` write included.

---

### SET-002 — No auth + no path validation on sandbox settings

**File:** `packages/gateway/src/routes/settings.ts:268-361`

`basePath` fully user-controlled without traversal sequence validation.

---

### FS-001 — Path extraction bypass when marker not found

**File:** `packages/gateway/src/routes/file-workspaces.ts:230-232, 327-329, 376-378`

```ts
const idx = c.req.path.indexOf(marker);
const filePath = idx >= 0 ? decodeURIComponent(...) : '';
```

If marker not found, `filePath` defaults to `''` — zero-length path bypasses validation, reads workspace root.

---

### FS-002 — Enumeration leak via different 404 vs 403

**File:** `packages/gateway/src/routes/file-workspaces.ts:65`

Returns 404 for non-owned workspaces — distinguishes from "not found", leaking existence.

---

### WF-002 — Silent failure on version snapshot

**File:** `packages/gateway/src/services/workflow/workflow-service.ts:580`

Version creation error swallowed silently. Client gets no indication of data loss.

---

### WF-003 — Detached promise swallows execution errors

**File:** `packages/gateway/src/services/workflow/workflow-service.ts:985`

```ts
executionPromise.catch(() => {}); // errors lost
```

`executeWorkflow` errors after `started` event fires → caller never learns.

---

## P2 — MEDIUM

### UI-001 — `once()` calls `unsub()` before handler

**File:** `packages/core/src/events/event-bus.ts:117-124`

`unsub()` called before `handler(event)`. If handler throws, unsub already fired — next event finds empty set.

---

### UI-002 — `Promise.race` timeout doesn't cancel handler

**File:** `packages/core/src/events/hook-bus.ts:178-184`

Winner resolves, loser continues running and may mutate `context.data`, corrupting hook chain for subsequent handlers.

---

### UI-003 — `setSessionId` bypasses React batching

**File:** `packages/ui/src/hooks/useChatStore.tsx:312-321`

Direct `setState` call outside `startTransition` — ref/state desync risk under concurrent rendering.

---

### UI-004 — Stale closure in `send`/`handleMessage`

**File:** `packages/ui/src/hooks/useWebSocket.tsx:79`

Pong could go to wrong socket if `send` changes without updating `connect`'s closure.

---

### REG-001 — Empty `catch` blocks mask registry errors

**File:** `packages/core/src/services/tool-service.ts:91-122`, `services/workflow-service.ts:106-139`, `services/config-center.ts:192-233`

Impossible to distinguish "not ready" from "registry threw unexpected error". A real bug in the registry layer silently passes.

---

### IDEMP-001 — `JSON.stringify(args)` unstable idempotency key

**File:** `packages/gateway/src/services/tool/executor.ts:592`

`{a:1, b:2}` vs `{b:2, a:1}` produce different strings → no cache hit for equivalent arguments.

---

### MEM-002 — `pendingApprovals` Map grows without bound

**File:** `packages/gateway/src/services/permission/execution-approval.ts:11-17`

Minor leak under long server uptime.

---

### TYPE-001 — Unvalidated `id` in `broadcastChange`

**File:** `packages/gateway/src/routes/crud-factory.ts:311-313`

`as { id: string }` cast lies if `id` is number or array.

---

### HELP-001 — `parseJsonBody` returns null after sending 415

**File:** `packages/gateway/src/routes/helpers.ts:335`

`contentTypeError && null` — 415 sent but function returns null, masking real error.

---

### AUTH-004 — `BOOTSTRAP_TOKEN` entropy not enforced

**File:** `packages/gateway/src/routes/ui-auth.ts:220-253`

Only length check (32 chars), no entropy quality. Trivially weak tokens pass.

---

### AUTH-005 — JWT secret minimum 32 chars too short

**File:** `packages/gateway/src/middleware/auth.ts:128`

Should require 64 characters for HS256 best practice.

---

### AUTH-006 — OAuth URL scheme not validated

**File:** `packages/gateway/src/routes/auth.ts:194-200`

`z.string().url()` accepts `http://` and `file://`. SSRF blocked at fetch time but not at write time.

---

### CSV-001 — CSV import columns not validated against allowlist

**File:** `packages/gateway/src/routes/database/csv-export.ts:406-416`

Raw CSV headers flow directly into `INSERT` column list. `validateColumnName` exists but not called.

---

### CSV-002 — Export without `userId` filter exposes all system tables

**File:** `packages/gateway/src/routes/database/transfer.ts:77`

Entire contents of `settings`, `agents`, `system_settings`, `user_workspaces` exported without `WHERE user_id = $1`.

---

### SSE-001 — SSE stream not terminated on provider error

**File:** `packages/gateway/src/routes/workflow/copilot.ts:123`

Stream left open after error — client may hang.

---

### AGENT-001 — Fallback silently ignored

**File:** `packages/gateway/src/services/agent/service.ts:676-708`

`providerInstance` stays `undefined` if `fbApiKey` falsy or `createFallbackProvider` throws — no error, no indication.

---

### AGENT-002 — `resetChatAgentContext` cache key mismatch

**File:** `packages/gateway/src/services/agent/service.ts:734-753`

Key built as `chat|${provider}|${model}` but real keys include `conversationId`, `fallback`, `pathContext` suffixes. Effectively a no-op.

---

### CLAW-004 — `workspaceDir` hot-reload poisons in-flight guardrail

**File:** `packages/gateway/src/services/claw/runner.ts:554-556`

Guardrail closure from in-flight cycle holds old `workspaceDir` after hot-reload.

---

### PERM-003 — `allowSubclaws === false` dead code

**File:** `packages/gateway/src/services/permission/gate.ts:259-261`

Only fires if field is literal `false` — `undefined` silently passes subclaws through regardless of intent.

---

## P3 — LOW

- `escapeLike` doesn't escape leading `%` (`db/repositories/base.ts:103`)
- `dateSubtract` accepts `amount = 0` silently (`db/adapters/postgres-adapter.ts:219`)
- `generateId` format leaks timestamps (`core/src/services/id-utils.ts`)
- `__list_tools__` bypasses hard-block (`services/tool/executor.ts:444`)
- `JSON.stringify` unguarded for circular refs (`routes/custom-tools/generation.ts:276`)
- `readFileSync` swallows all errors silently (`services/tool/source.ts:46`)
- Telegram/email webhooks lack replay protection (`routes/webhooks.ts:53, 106`)
- Telegram webhook URL SSRF probe vector (`channels/plugins/telegram/telegram-api.ts:418`)
- `fireTrigger` bypasses re-entrancy guard (`triggers/engine.ts:865`)
- Event filter key prototype pollution (`triggers/engine.ts:478`)
- `pool.on('error')` logged at warn not error (`db/adapters/postgres-adapter.ts:59`)
- Weak filename encoding for Content-Disposition (`routes/file-workspaces.ts:25`)
- `maxConcurrency` unbounded (`routes/settings.ts:508`)
- `require_approval` treated as `deny` (`services/permission/gate.ts:358`)

---

## Summary Statistics

| Category                      | Count    |
| ----------------------------- | -------- |
| SSRF / Auth bypass            | 6        |
| IDOR (cross-user data access) | 22       |
| Template injection            | 2        |
| Approval race/bypass          | 3        |
| Race conditions               | 4        |
| Memory/resource leaks         | 4        |
| Path traversal                | 2        |
| SQL injection                 | 2        |
| Prompt injection              | 2        |
| Misc bugs                     | 9        |
| **Total**                     | **~100** |
