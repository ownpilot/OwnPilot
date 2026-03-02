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

### PERF-001: N+1 Query in Channel Message Processing

**Location**: `packages/gateway/src/channels/service-impl.ts` (inferred)

**Description**: Processing channel messages may trigger individual database queries per message rather than batching.

**Solution**: Implement batch processing with `Promise.all()` or database bulk operations.

**Success Criteria**:
- [ ] Message processing uses batch queries
- [ ] 1000 messages process in < 5 seconds
- [ ] Database query count is O(1) regardless of message count

---

### PERF-002: Memory Leak in WebSocket Session Manager

**Location**: `packages/gateway/src/ws/session.ts` (inferred)

**Description**: Session metadata may accumulate without bounds if cleanup doesn't run.

**Solution**: Implement LRU cache with max size for session storage.

**Success Criteria**:
- [ ] Session manager memory capped at 100MB regardless of connection count
- [ ] Oldest inactive sessions evicted first
- [ ] Metrics exposed for session count and memory usage

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

### TEST-001: Missing Tests for Subagent Nesting Depth Limit

**Location**: `packages/gateway/src/services/subagent-manager.ts:77-79`

**Description**: The MAX_SUBAGENT_DEPTH check exists but may not have comprehensive tests.

**Success Criteria**:
- [ ] Test verifies subagent at depth 2 succeeds
- [ ] Test verifies subagent at depth 3 is rejected
- [ ] Test verifies depth counter increments correctly

---

### TEST-002: Missing Tests for Background Agent Budget Enforcement

**Location**: `packages/gateway/src/services/background-agent-manager.ts:496-502`

**Description**: Budget enforcement logic needs edge case testing.

**Success Criteria**:
- [ ] Test verifies agent stops at exact budget limit
- [ ] Test verifies floating-point budget calculations
- [ ] Test verifies budget persists across restarts

---

## Tool-Specific Issues

### TOOL-001: Fetch Timeout Not Configurable in Dynamic Tools

**Location**: `packages/core/src/agent/tools/dynamic-tool-executor.ts:50`

**Description**: The `createSafeFetch` doesn't accept timeout options.

**Solution**: Pass timeout configuration from tool permissions or context.

---

### TOOL-002: Missing Content-Type Validation in File Download

**Location**: `packages/core/src/agent/tools/file-system.ts:636-646`

**Description**: Downloaded files aren't validated against expected content types.

**Solution**:
```typescript
// Validate content type and size
const contentType = response.headers.get('content-type');
const contentLength = response.headers.get('content-length');

if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
  return { content: 'Error: File too large', isError: true };
}
```

---

## Monitoring & Observability

### OBS-001: Insufficient Context in Error Logs

**Location**: Various locations

**Description**: Many error logs don't include enough context for debugging (userId, sessionId, correlation IDs).

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
*Last updated: 2026-03-02 | Open: 0 P0 + 0 P1 + 0 P2 + 0 P3 + 2 Perf + 1 Sec (partial) + 2 Test + 2 Tool | Resolved: 12 bugs + 1 security*
