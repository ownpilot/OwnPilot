# Known Bugs and Issues

> Comprehensive bug tracking for OwnPilot codebase
> Last updated: 2026-03-02

## Severity Legend

- **P0 (Critical)**: System crash, data loss, security vulnerability
- **P1 (High)**: Feature broken, significant performance issue
- **P2 (Medium)**: Partial feature failure, workaround exists
- **P3 (Low)**: Cosmetic issues, minor inconveniences

---

## P0 - Critical Bugs

> All P0 bugs resolved as of 2026-03-02. See Resolved Bugs table below.

---

## P1 - High Priority Bugs

> All P1 bugs resolved as of 2026-03-02. See Resolved Bugs table below.

---

## P2 - Medium Priority Bugs

> BUG-007 and BUG-010 resolved as of 2026-03-02. See Resolved Bugs table below.
> BUG-008 and BUG-009 closed as enhancements (not bugs — overall timeout and bounded queues already exist).

---

## P3 - Low Priority Bugs

> All P3 bugs resolved. BUG-011 fixed 2026-02-18, BUG-012/013/014 fixed 2026-03-02. See Resolved Bugs table.

---

## Performance Issues

> PERF-001 and PERF-002 closed — investigation confirmed both were speculative.
> PERF-001: Messages are processed one-at-a-time per event, no batch N+1 pattern.
> PERF-002: `SessionManager.remove()` is thorough (unsubs, WeakMap cleanup, limits enforced).

---

## Security Issues

> SEC-001 resolved as of 2026-03-02 (IP-based rate limiting added). See Resolved Bugs table.
> SEC-002 partially addressed (null byte check + path normalization added via BUG-005 fix).

### SEC-002: Path Traversal in File System Tools (Windows) — Partially Fixed

**Location**: `packages/core/src/agent/tools/file-system.ts:91`

**Description**: Null byte injection and basic Windows backslash handling now fixed. Full TOCTOU via `O_NOFOLLOW`/fd-based ops remains a future hardening task.

**Remaining Work**:
- [ ] Unicode path attacks prevention
- [ ] Full fd-based file operations (TOCTOU hardening)

---

## Test Coverage Gaps

> TEST-001 closed — tests already exist (depth 0 allowed, depth 1 allowed, depth 3 rejected).
> TEST-002 resolved — 3 budget enforcement + 1 rate limiting test added (2026-03-02).

---

## Tool-Specific Issues

> TOOL-001 resolved — Added 30s AbortController timeout to `createSafeFetch` (2026-03-02).
> TOOL-002 resolved — Added 100MB Content-Length pre-check + post-download size validation to file download (2026-03-02).

---

## Monitoring & Observability

> OBS-001 resolved — structured context objects added to all error/warn logs in background-agent-manager and subagent-manager (2026-03-02).

### OBS-001: Insufficient Context in Error Logs — Fixed

**Location**: `background-agent-manager.ts`, `subagent-manager.ts`

**Description**: Converted 12 template-literal error/warn logs to structured context objects with `agentId`, `error`, `subagentId`, etc.

**Solution**: Standardize error logging with structured context:
```typescript
log.error('Operation failed', {
  error: getErrorMessage(err),
  userId: context.userId,
  sessionId: context.sessionId,
  correlationId: context.correlationId,
  operation: 'backgroundAgent.cycle',
  agentId: config.id,
});
```

---

## Resolved Bugs (For Reference)

| Bug ID | Description | Resolution | Date |
|--------|-------------|------------|------|
| BUG-001 | Dynamic Tool Sandbox missing error handling | Added try-catch around `sandbox.execute()` with fatal error recovery | 2026-03-02 |
| BUG-002 | WebSocket message handler error boundary | Added sessionId to error log context, kept fire-and-forget `.catch()` pattern | 2026-03-02 |
| BUG-003 | Background Agent timer leak on rapid start/stop | Added `clearInterval` guard before creating new `persistTimer` | 2026-03-02 |
| BUG-004 | Subagent Manager cleanup timer initialization | Deferred `startCleanup()` with `setImmediate`, added guard + error handling | 2026-03-02 |
| BUG-005 | File system path traversal (null bytes, Windows) | Added null byte rejection + cross-platform path normalization | 2026-03-02 |
| BUG-006 | Database adapter singleton race condition | Added `adapterPromise` lock for concurrent deduplication | 2026-03-02 |
| BUG-007 | Coding agent zombie processes | SIGTERM then deferred SIGKILL fallback via setTimeout | 2026-03-02 |
| BUG-010 | Background Agent event subscription leak | Clear existing subscriptions before adding new ones in `subscribeToEvents()` | 2026-03-02 |
| BUG-012 | Math tools validator regex incomplete | Fixed regex to include `d` character, `round()` now works | 2026-03-02 |
| BUG-013 | Math `log` mapped to wrong implementation | `log` → `Math.log` (natural log), added `log10` → `Math.log10` | 2026-03-02 |
| BUG-014 | `Math.ln` doesn't exist | `ln` now maps to `Math.log` via function name mapping | 2026-03-02 |
| SEC-001 | Missing WS auth rate limiting | Added IP-based rate limiter (10 attempts/min/IP) with auto-cleanup | 2026-03-02 |
| TEST-002 | Missing budget enforcement tests | Added 3 budget + 1 rate limit tests for BackgroundAgentManager | 2026-03-02 |
| TOOL-001 | Fetch timeout not configurable | Added 30s AbortController timeout to `createSafeFetch` | 2026-03-02 |
| TOOL-002 | Missing file download size validation | Added 100MB Content-Length pre-check + post-download size guard | 2026-03-02 |
| OBS-001 | Insufficient context in error logs | Structured context objects in background-agent-manager + subagent-manager | 2026-03-02 |
| BUG-011 | Chat history cache not cleared | Fixed in commit with cache cleanup | 2026-02-18 |
| - | Grammy middleware ordering | Commands now registered before message handlers | 2026-02-19 |
| - | CLAUDECODE env var blocking child processes | `delete env.CLAUDECODE` in spawn | 2026-02-25 |

---

## How to Contribute

1. **Pick a bug**: Choose based on priority and your expertise
2. **Write a test**: Create a failing test that demonstrates the bug
3. **Implement fix**: Make the minimal change to fix the issue
4. **Verify**: Ensure the test passes and no regressions introduced
5. **Update this file**: Mark the bug as resolved with PR link

## Bug Triage Process

1. **New bugs**: File as GitHub issue with `bug` label
2. **Triage**: Maintainer assigns severity and priority
3. **Assignment**: Developer claims bug by commenting
4. **PR**: Link PR to bug using `Fixes #bug-number`
5. **Verification**: QA verifies fix before closing

---

*This document is maintained by the development team.*
*Last updated: 2026-03-02 | Open: 1 Sec (hardening only) | Resolved: 16 bugs + 1 security + 1 observability + 3 speculative closed*
