# Notification & Approval Layer — Design Document

> OpenClaw Bridge | Architecture Decision: Option B (Bridge + Human Middleware)

## Problem Statement

The bridge detects when Claude Code needs human input (via `pattern-matcher.ts`) but has no mechanism to proactively notify the user. When a blocking pattern like `QUESTION` or `TASK_BLOCKED` is detected, the information is embedded in the HTTP response — but nobody is watching. The session stalls silently until someone happens to check.

The missing piece: a push-based notification layer that alerts the user when approval or input is required, and a response path to inject the user's answer back into the waiting session.

## Current State

### Pattern Detection
- 7 regex patterns: `PROGRESS`, `TASK_COMPLETE`, `TASK_BLOCKED`, `QUESTION`, `ANSWER`, `PHASE_COMPLETE`, `ERROR`
- `isBlocking()` returns `true` for `QUESTION` and `TASK_BLOCKED`
- Detection runs on every CC output chunk

### Signal Delivery (reactive only)
| Channel | Mechanism | Limitation |
|---------|-----------|------------|
| HTTP headers | `X-Bridge-Pattern`, `X-Bridge-Blocking` | Non-streaming responses only; client must read headers |
| SSE | `bridge_meta` event with pattern data | Client must hold open SSE connection during chat |

### Gap
All delivery is **reactive** — the client must already be connected (SSE) or actively reading the response (headers). There is no way to reach a user who is not currently polling or streaming. No push notification, no callback, no persistent notification queue.

## Design Options

### Option A: Polling Endpoint

`GET /v1/sessions/pending` — returns a list of sessions currently waiting for human input.

**Pros:**
- Simple to implement (read from in-memory session map)
- Stateless — no connection management
- Works with any HTTP client (curl, scripts, monitoring tools)
- No new dependencies

**Cons:**
- Latency proportional to polling interval (5-10s typical)
- Wasteful requests when nothing is pending
- Scales poorly with many idle clients

### Option B: WebSocket Channel

Persistent WebSocket connection at `ws://localhost:9090/v1/notifications` for real-time push.

**Pros:**
- Instant notification delivery
- Bidirectional — could accept responses on the same connection
- Native browser support

**Cons:**
- Connection lifecycle management (reconnection, heartbeat, stale connections)
- New dependency (Fastify WebSocket plugin)
- Persistent connections conflict with bridge's stateless design
- More complex client implementation

### Option C: Webhook/Callback

`POST` to a user-configured URL when a blocking pattern is detected.

**Pros:**
- True push — user gets notified immediately
- Fully decoupled — bridge fires and forgets
- Integrates directly with existing automation tools (n8n, Telegram bots, Slack incoming webhooks, email relays)
- No persistent connections on either side

**Cons:**
- Requires user to set up a receiver endpoint
- Delivery reliability concerns (receiver down, network errors)
- Retry logic needed

### Option D: Server-Sent Events (SSE) Notification Channel

Dedicated SSE endpoint `GET /v1/notifications/stream` for push notifications, separate from the per-chat SSE stream.

**Pros:**
- Push-based with low latency
- Browser-native (`EventSource` API)
- Reuses existing SSE infrastructure in the bridge
- Simpler than WebSocket (unidirectional)

**Cons:**
- Unidirectional — notifications only, responses still need a separate HTTP call
- Requires persistent connection (same drawback as WebSocket, lighter weight)
- Connection management still needed (reconnection, keepalive)

## Recommended Architecture

**Option C (Webhook) as primary + Option A (Polling) as fallback.**

### Rationale

| Criterion | Webhook (C) | Polling (A) |
|-----------|-------------|-------------|
| Push vs Pull | Push | Pull |
| Implementation complexity | Medium | Low |
| External integration | Native (n8n, Telegram, Slack) | Requires wrapper |
| Persistent connections | None | None |
| Reliability | Retry with backoff | Client-controlled |
| Statelessness | Yes (fire-and-forget + retry) | Yes (read from session map) |

Both options maintain the bridge's stateless philosophy — no persistent connections to manage, no reconnection logic, no new runtime dependencies. Webhook covers the primary use case (automated pipelines, chat bots), while polling serves CLI users and simple scripts.

WebSocket (B) and SSE (D) are rejected because they require persistent connections, adding operational complexity disproportionate to the benefit for a single-user orchestration tool.

## Implementation Plan

### Phase 1: Pending Sessions Endpoint (Polling Fallback)

**Endpoint:** `GET /v1/sessions/pending`

**Session tracking changes in `ClaudeManager`:**
```typescript
interface PendingApproval {
  pattern: 'QUESTION' | 'TASK_BLOCKED';
  text: string;           // extracted question/blocker text
  detectedAt: number;     // Unix timestamp ms
}

// Add to session metadata
interface SessionMeta {
  // ... existing fields
  pendingApproval: PendingApproval | null;
}
```

**Response format:**
```json
{
  "pending": [
    {
      "conversationId": "my-conv",
      "sessionId": "uuid-here",
      "pattern": "QUESTION",
      "text": "Which database should I use for this?",
      "detectedAt": 1709136000000,
      "waitingFor": "12s"
    }
  ]
}
```

**Behavior:**
- Returns only sessions where `pendingApproval !== null`
- `pendingApproval` is set when `isBlocking()` returns `true`
- `pendingApproval` is cleared when `/respond` is called or session terminates
- Recommended client polling interval: 5-10 seconds

### Phase 2: Webhook Registration & Delivery

**Registration — single target (env var):**
```bash
BRIDGE_WEBHOOK_URL=https://n8n.example.com/webhook/bridge-notify
```

**Registration — multi target (API):**
```
POST /v1/webhooks
{
  "url": "https://n8n.example.com/webhook/bridge-notify",
  "events": ["blocking"],        // future: ["blocking", "complete", "error"]
  "secret": "optional-hmac-key"  // for payload signing
}
```

**Webhook payload:**
```json
{
  "event": "session.blocking",
  "conversationId": "my-conv",
  "sessionId": "uuid-here",
  "pattern": "QUESTION",
  "text": "Which database should I use for this?",
  "timestamp": "2026-02-28T12:00:00.000Z",
  "respondUrl": "http://localhost:9090/v1/sessions/uuid-here/respond"
}
```

**Delivery:**
- Fire on `isBlocking() === true` detection
- Retry: 3 attempts with exponential backoff (1s, 4s, 16s)
- Timeout: 5s per attempt
- Deduplication: max 1 webhook per session per blocking event (clear on respond)
- Failed delivery logged but does not block session (polling still works)

### Phase 3: User Response Flow

**Endpoint:** `POST /v1/sessions/:id/respond`

**Request:**
```json
{
  "message": "Use PostgreSQL with Supabase"
}
```

**Behavior:**
1. Validate session exists and has `pendingApproval !== null`
2. Clear `pendingApproval` on the session
3. Inject `message` as the next user message to the CC process (same mechanism as `/v1/chat/completions` but targeting existing session)
4. Return `200` with session status
5. CC continues processing with the injected response

**Response:**
```json
{
  "status": "resumed",
  "sessionId": "uuid-here",
  "conversationId": "my-conv"
}
```

**Error cases:**
- `404` — session not found
- `409` — session not pending (no blocking pattern active)
- `400` — empty message body

## Data Flow Diagram

```
CC stdout → StreamProcessor → pattern-matcher.ts → isBlocking()?
  │
  ├── NO  → normal flow
  │         ├── HTTP: X-Bridge-Pattern header
  │         └── SSE: bridge_meta event
  │
  └── YES → blocking flow
              │
              ├─ 1. session.pendingApproval = { pattern, text, detectedAt }
              │
              ├─ 2. Webhook (if configured)
              │     POST → user's webhook URL
              │     ├── Success → logged
              │     └── Failure → retry (3x backoff) → logged
              │
              ├─ 3. Polling
              │     GET /v1/sessions/pending includes this session
              │
              └─ 4. Wait for response
                    POST /v1/sessions/:id/respond
                    │
                    ├── Clear pendingApproval
                    ├── Inject message → CC stdin
                    └── Session continues
```

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Webhook URL validation | HTTPS required in production; localhost/HTTP allowed in dev |
| Payload authenticity | HMAC-SHA256 signature in `X-Bridge-Signature` header, signed with bridge API key or user-provided secret |
| Webhook flood | Rate limit: max 1 webhook per session per blocking event; global cap of 10 webhooks/minute |
| Response injection | Same `Authorization: Bearer` token required as all other bridge endpoints |
| Sensitive data in webhook payload | `text` field contains CC output — consider truncation or opt-in full text |
| Webhook target SSRF | Block private IP ranges in production (10.x, 172.16-31.x, 192.168.x) unless explicitly allowed |

**Signature generation:**
```typescript
const signature = crypto
  .createHmac('sha256', apiKey)
  .update(JSON.stringify(payload))
  .digest('hex');
// Header: X-Bridge-Signature: sha256=<signature>
```

## Phase 4: SSE Real-Time Notification Stream

> **Decision (2026-02-28):** SSE selected over WebSocket/polling/TUI after evaluation.
> Alternatives documented below for fallback if SSE doesn't meet performance requirements.

### Primary Use Case

GSD workflow'unda CC session'ları dakikalarca çalışır. Kullanıcı:
1. **Canlı CC output'u izlemeli** (phase execution sırasında ne oluyor?)
2. **QUESTION/TASK_BLOCKED anında görmeli** (soru geldi → hemen cevap ver)
3. **PHASE_COMPLETE bildirimini almalı** (sonraki adıma geç)
4. **Birden fazla session'ı tek stream'den takip etmeli**

### Endpoint

```
GET /v1/notifications/stream
Authorization: Bearer <token>
```

**SSE Event Types:**

```
event: session.output
data: {"conversationId":"my-conv","sessionId":"uuid","text":"Working on...","timestamp":"..."}

event: session.blocking
data: {"conversationId":"my-conv","sessionId":"uuid","pattern":"QUESTION","text":"Which DB?","respondUrl":"http://localhost:9090/v1/sessions/uuid/respond"}

event: session.phase_complete
data: {"conversationId":"my-conv","sessionId":"uuid","pattern":"PHASE_COMPLETE","text":"Phase 3 complete"}

event: session.error
data: {"conversationId":"my-conv","sessionId":"uuid","error":"CC spawn failed"}

event: session.done
data: {"conversationId":"my-conv","sessionId":"uuid","usage":{"input_tokens":1234,"output_tokens":567}}

event: heartbeat
data: {"timestamp":"..."}
```

**Cevap Verme:** SSE tek yönlü (server→client). Cevap vermek için mevcut `POST /v1/sessions/:id/respond` kullanılır.

### Architecture

```
ClaudeManager.send() → StreamChunk yield
       │
       ├─→ HTTP response (mevcut — per-request)
       │
       └─→ SSE EventBus → broadcast to all SSE clients (YENİ)
                │
                ├─ text chunk → session.output event
                ├─ isBlocking() → session.blocking event
                ├─ PHASE_COMPLETE → session.phase_complete event
                ├─ error → session.error event
                └─ done → session.done event
```

**EventBus pattern:** ClaudeManager bir EventEmitter (zaten extends ediyor). Her chunk'ta event emit et → SSE handler dinle → tüm bağlı client'lara push et.

### Connection Management

| Concern | Solution |
|---------|----------|
| Reconnection | SSE native retry (browser `EventSource` otomatik reconnect) |
| Heartbeat | 15s interval `heartbeat` event (connection canlı mı kontrolü) |
| Stale connections | 5 min no-activity timeout → server-side close |
| Max clients | 10 concurrent SSE connections (safety cap) |
| Auth | Bearer token — ilk bağlantıda doğrula |

### CRITICAL REQUIREMENT: Long-Running Interactive Sessions

> **Discovered 2026-02-28:** SSE alone is NOT sufficient. The core problem is deeper.

**Problem:** Bridge uses spawn-per-message architecture. Each message spawns a fresh CC
process, writes to stdin, closes stdin (EOF), CC processes, outputs, exits. Session
continuity is via `--resume` (disk-based), but the **process does not stay alive**.

**Why this matters for GSD:**
- GSD phase execution can take minutes
- During execution, CC asks questions (QUESTION pattern)
- If process is dead, there's nothing to inject the answer INTO
- `--resume` starts a NEW process — GSD internal state may not survive cleanly
- Questions asked in the previous process are "gone" from the live context

**What the user needs:**
1. CC process stays alive (stdin open, no EOF)
2. Output streams in real-time via SSE
3. When QUESTION detected, user sends answer via POST
4. Answer is written to the SAME process's stdin (no new spawn)
5. CC continues in the same process, same context, same GSD state
6. Entire GSD phase cycle runs in ONE process

**Required architectural change:**
- New mode: "interactive session" alongside existing "fire-and-forget" mode
- `POST /v1/sessions/start-interactive` — spawn CC with stdin kept open
- `POST /v1/sessions/:id/input` — write to open stdin (no EOF, no new process)
- `GET /v1/notifications/stream` — SSE for real-time output
- Process lifecycle: alive until explicit close or idle timeout

**Compatibility:** Existing spawn-per-message remains the default for stateless API calls.
Interactive mode is opt-in for GSD/long-running workflows.

### Implementation Steps (Revised — Interactive + SSE)

**Sub-phase 4a: EventBus + SSE Stream**
1. `src/event-bus.ts` — Typed EventEmitter for bridge-wide events
2. `claude-manager.ts` — Her StreamChunk'ta event emit et
3. `router.ts` — Pattern detection event'lerini emit et
4. `routes.ts` — `GET /v1/notifications/stream` SSE handler
5. Heartbeat timer (15s)
6. Connection tracking + cleanup
7. Tests (unit + integration)

**Sub-phase 4b: Interactive Session Mode (CRITICAL)**
1. `claude-manager.ts` — `startInteractive()` method (spawn CC, stdin open, no EOF)
2. `claude-manager.ts` — `writeToSession()` method (write to open stdin without closing)
3. `routes.ts` — `POST /v1/sessions/start-interactive` endpoint
4. `routes.ts` — `POST /v1/sessions/:id/input` endpoint (inject to open stdin)
5. Process lifecycle management (idle timeout, explicit close, crash recovery)
6. Integration with SSE stream (output chunks → EventBus → SSE clients)
7. Integration with pattern detection (QUESTION → SSE event → user input → stdin)
8. Tests: interactive session lifecycle, stdin injection, GSD flow simulation

### Alternative Approaches (Fallback)

Evaluated 2026-02-28. If SSE doesn't meet requirements, these are ranked alternatives:

#### Alternative A: WebSocket Bidirectional
```
ws://localhost:9090/v1/ws
```
- **Pros:** Hem izle hem cevap ver aynı connection'dan. Tam duplex.
- **Cons:** Fastify WebSocket plugin gerekli. Connection lifecycle karmaşık (heartbeat, reconnect, stale). Client implementation daha zor (EventSource'a kıyasla).
- **When to switch:** SSE + POST /respond kombinasyonu kullanıcı deneyiminde friction yaratırsa (ör. cevap gecikmesi >200ms hissedilirse).

#### Alternative B: Terminal TUI (ncurses/blessed)
```
bridge-tui --connect localhost:9090
```
- **Pros:** Web browser gerektirmez. tmux pane'de canlı output + inline cevap. SSH üzerinden çalışır.
- **Cons:** Ayrı binary/package. blessed/ink gibi Node TUI framework gerekli. UI geliştirme eforu yüksek.
- **When to switch:** Web UI olmadan sadece terminal'den çalışılacaksa. Headless server deployment.

#### Alternative C: Enhanced Polling
```
GET /v1/sessions/:id/output?since=<timestamp>&wait=30
```
- **Pros:** Sıfır persistent connection. Long-polling ile ~1s latency. En basit implementation.
- **Cons:** Her poll yeni HTTP connection. Server-side buffer yönetimi gerekli. Gerçek real-time değil.
- **When to switch:** SSE connection management sorun yaratırsa (reverse proxy, firewall). Minimal client gerekliyse.

#### Decision Matrix

| Criterion | SSE | WebSocket | TUI | Polling |
|-----------|-----|-----------|-----|---------|
| Latency | ~instant | ~instant | ~instant | 1-5s |
| Browser support | Native | Native | N/A | Native |
| Implementation | Medium | High | High | Low |
| Bidirectional | No (+ POST) | Yes | Yes | No (+ POST) |
| Connection mgmt | Low | High | N/A | None |
| n8n compatible | Yes | Partial | No | Yes |

**Selected: SSE** — best balance of simplicity, browser compatibility, and real-time capability.

## Future: Telegram/WhatsApp Integration

### Via n8n (recommended, no code)

```
Bridge webhook → n8n webhook trigger → Telegram node (send message)
User replies → Telegram trigger node → n8n HTTP request → POST /v1/sessions/:id/respond
```

This requires zero bridge-side changes — the webhook + respond API is sufficient.

### Native Telegram Bot (optional, separate service)

A standalone bot service that:
1. Subscribes to bridge webhooks
2. Sends formatted Telegram messages with inline keyboard (Approve / Reject / Reply)
3. Accepts user replies and forwards to `POST /v1/sessions/:id/respond`
4. Tracks conversation-to-chat mapping

This would live outside the bridge as an independent microservice, keeping the bridge focused on CC orchestration.

### WhatsApp

Same pattern via WhatsApp Business API or Twilio, with n8n as the integration layer. No bridge changes needed.
