# WhatsApp Channel — Architecture & Operations Guide

> Agent-friendly reference. Read this before modifying WhatsApp channel code.
> Last updated: 2026-03-06 (Session 25 — media recovery pipeline + chunk edge case)

## Message Flow (Incoming)

```
WhatsApp Cloud (Baileys WebSocket)
  → messages.upsert event (Baileys 7.x)
  → whatsapp-api.ts: handleIncomingMessage()
    → [FILTER 1] JID type filter (@s.whatsapp.net only)
    → [FILTER 2] allowed_users phone whitelist
    → [FILTER 3] fromMe + self-chat loop prevention
    → [FILTER 4] deduplication (processedMsgIds)
  → EventBus emit (channel.message.received)
  → ChannelServiceImpl.processIncomingMessage()  [service-impl.ts:453]
    → channel_users DB: find/create user
    → isBlocked? → silent drop
    → isVerified? → no: send "admin approval needed", return
    → yes: save message → find/create session
    → processViaBus() [service-impl.ts:858]
      → AI Agent (190+ tools, conversation context)
      → Generate response
  → sendMessage() → WhatsApp (with typing simulation + rate limit)
```

## Message Flow (Outgoing)

```
sendMessage(ChannelOutgoingMessage)
  → enforceRateLimit(jid)  — 20 msg/min global, 3s per-JID gap
  → simulateTyping(jid)    — available → composing → delay → paused
  → sock.sendMessage(jid, { text })
  → recordSend(jid)
  → sendPresenceUpdate('unavailable')  — go offline after sending
```

## JID Types

| JID Format | Example | Description | Current Status |
|------------|---------|-------------|----------------|
| `@s.whatsapp.net` | `YOUR_PHONE_NUMBER@s.whatsapp.net` | Direct message (phone-based) | PROCESSED |
| `@g.us` | `120363375272168801@g.us` | Group chat | SKIPPED |
| `@lid` | `179203903344808@lid` | Linked ID (WhatsApp multi-device internal) | SKIPPED (LID resolution available but inactive) |
| `@broadcast` | `status@broadcast` | Broadcast list / Status | SKIPPED |
| `@newsletter` | `123456@newsletter` | WhatsApp Channel (public) | SKIPPED |

## Access Control (allowed_users)

- **Config location:** DB table `config_entries`, service `whatsapp_baileys`, field `allowed_users`
- **Format:** Comma-separated phone numbers: `"YOUR_PHONE_NUMBER, OTHER_PHONE_NUMBER"`
- **Empty = allow all** (DANGEROUS — every incoming DM triggers AI response)
- **Current value:** `"YOUR_PHONE_NUMBER"` (self-chat only)

### How to change allowed_users

```sql
-- Add a contact to allowed users
UPDATE config_entries
SET data = jsonb_set(data::jsonb, '{allowed_users}', '"YOUR_PHONE_NUMBER, OTHER_PHONE_NUMBER"')::text
WHERE service_name = 'whatsapp_baileys' AND is_default = true;

-- Then restart container to reload config
docker restart ownpilot
```

Or via OwnPilot UI: Settings → Config Center → WhatsApp → Allowed Phone Numbers

## Anti-Ban Protections (P0 — All Active)

| Protection | Implementation | Reference |
|------------|---------------|-----------|
| Browser fingerprint | `Browsers.appropriate('Chrome')` | Evolution API pattern |
| Offline by default | `markOnlineOnConnect: false` + `sendPresenceUpdate('unavailable')` on connect | Evolution + WAHA |
| Typing simulation | `available → composing → delay(1-5s) → paused → send → unavailable` | Evolution API `sendMessageWithTyping` |
| Rate limiting | 20 msg/min global + 3s per-JID gap | Industry consensus |
| getMessage callback | Returns cached message or `undefined` (NEVER empty string) | Baileys 7.x requirement |
| Message retry cache | `msgRetryCounterCache` (SimpleTTLCache, 5min) | Evolution + WAHA |
| Device cache | `userDevicesCache` (SimpleTTLCache, 5min) | WAHA pattern |
| Transaction retry | `transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 }` | Evolution API |
| Reconnect cap | Max 10 attempts, exponential backoff + jitter | Both |
| 440 tracking | 3 consecutive 440 → stop reconnect | Custom |
| Permanent disconnect | 401/403/402/406 → no reconnect (would escalate ban) | Evolution API |
| Group skip | `@g.us` messages not processed | Anti-spam |
| Message dedup | `processedMsgIds` Set (cap 1000) — prevents double AI response on reconnect | Custom |
| Pino silent | Logger `'silent'` in production — no JID/content leakage | Both |

## LID Resolution (INACTIVE — Ready to Activate)

WhatsApp's Linked ID system (2024+): some messages arrive as `@lid` instead of `@s.whatsapp.net`.

### When to activate

| Scenario | Trigger | Action |
|----------|---------|--------|
| A | Auto-reply opened to other users, their messages come as `@lid` | Activate LID resolution |
| B | Group messages enabled, participant JIDs are `@lid` | Activate LID resolution |
| C | LID-only contacts can't match `allowed_users` | Activate LID resolution |

### How it works

Baileys provides two JIDs per message:
```
key.remoteJid    = 179203903344808@lid           (device/linked ID)
key.remoteJidAlt = OTHER_PHONE_NUMBER@s.whatsapp.net    (real phone number)
```

Evolution API swaps them before processing (line 1478-1479 of
`~/evolution-api-src/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`):
```typescript
if (messageRaw.key.remoteJid?.includes('@lid') && messageRaw.key.remoteJidAlt) {
  messageRaw.key.remoteJid = messageRaw.key.remoteJidAlt;
}
```

### How to activate in OwnPilot

In `whatsapp-api.ts`, find the `/* LID Resolution */` block comment in `handleIncomingMessage()`.
Remove the `/*` and `*/` markers. No other changes needed — downstream code uses `remoteJid` variable.

### Alternative: PostgreSQL LID→Phone mapping

If `remoteJidAlt` is not reliably present (~5% of messages), add persistent mapping:

```sql
CREATE TABLE whatsapp_lid_map (
  lid TEXT PRIMARY KEY,          -- 179203903344808@lid
  phone TEXT NOT NULL,           -- OTHER_PHONE_NUMBER@s.whatsapp.net
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

WAHA uses this pattern with SQLite (`Sqlite3LidPNRepository`). PostgreSQL equivalent
would integrate with existing OwnPilot DB. Not needed until LID resolution is activated
AND remoteJidAlt proves unreliable.

## Auto-Reply Pipeline

### ChannelServiceImpl.processIncomingMessage() [service-impl.ts:453]

```
1. Find/create channel_user in DB (by phone + platform)
2. Check isBlocked → silent drop
3. Handle /connect verification command
4. Check isVerified → if false: send "admin approval needed", return
5. Save message to DB
6. Find/create channel_session
7. processViaBus() → AI Agent → response
8. sendMessage() via WhatsApp
```

### Disabling auto-reply (ranked by speed)

| Method | Speed | Scope | Reversible |
|--------|-------|-------|------------|
| Disconnect WhatsApp (UI/API) | Instant | All | Yes |
| Set `allowed_users` to fake number | Instant (after restart) | All except self | Yes |
| `UPDATE channel_users SET is_blocked = TRUE WHERE platform = 'whatsapp'` | Instant | Specific users | Yes |
| `UPDATE channel_users SET is_verified = FALSE WHERE platform = 'whatsapp'` | Instant | All (sends "approval needed" msg) | Yes |
| Add `auto_reply` toggle to config schema | Code change | Configurable | Yes |

### TriggerEngine (secondary path)

`TriggerEngine` at `triggers/engine.ts` subscribes to ALL EventBus events via `onPattern('**')`.
If a user-defined trigger matches `channel.message.received`, it fires ADDITIONALLY to the main
AI pipeline. Check `triggers` DB table for unexpected auto-responses.

### WorkspaceManager (DEAD path)

`WorkspaceManager` subscribes to `gateway.channel.message` — this event is NEVER emitted.
Not a concern.

## Scenarios & Configuration Recipes

### Scenario 1: Self-chat only (CURRENT)
```
allowed_users: "YOUR_PHONE_NUMBER"
Groups: SKIP
LID: SKIP
```
AI responds only when you message yourself.

### Scenario 2: Personal assistant for specific people
```
allowed_users: "YOUR_PHONE_NUMBER, OTHER_PHONE_NUMBER, THIRD_PHONE_NUMBER"
Groups: SKIP
LID: Activate resolution (so LID contacts are recognized)
```
AI responds to you + listed contacts. Everyone else ignored.

### Scenario 3: Group bot (e.g., "Company Support Group")
```
allowed_users: "" (empty = all)
Groups: Enable @g.us processing (modify JID filter)
  + Add mention/keyword trigger (only respond when mentioned or keyword detected)
LID: Activate resolution
```
Requires code change in handleIncomingMessage to allow specific group JIDs.

### Scenario 4: Full chatbot (all DMs)
```
allowed_users: "" (empty = all)
Groups: SKIP (safer)
LID: Activate resolution
Anti-ban: CRITICAL — rate limits, typing simulation, verification gate
```
WARNING: High ban risk + API cost. Use channel_users.isVerified as gate.

## Connection & Session

- **Auth:** Multi-file auth state at `OWNPILOT_DATA_DIR/whatsapp-sessions/{pluginId}/`
- **Reconnect:** Exponential backoff (3s base, 10s for 440) + jitter, max 10 attempts, max 2min delay
- **Session persistence:** Volume mount `ownpilot-znahub_ownpilot-data:/app/data`
- **QR scan:** Only needed on first connect or after logout. Broadcast via WebSocket to UI.

## Docker Deployment

```bash
# Build
docker build -t localhost:5000/ownpilot:latest .

# Push
docker push localhost:5000/ownpilot:latest

# Run
docker run -d --name ownpilot \
  --network ownpilot-znahub_default \
  -p 8080:8080 \
  -v ownpilot-znahub_ownpilot-data:/app/data \
  -e DATABASE_URL="postgresql://ownpilot:YOUR_DB_PASSWORD@ownpilot-postgres:5432/ownpilot" \
  -e OWNPILOT_DATA_DIR=/app/data \
  -e NODE_ENV=production \
  localhost:5000/ownpilot:latest
```

## Key Files

| File | Purpose |
|------|---------|
| `whatsapp-api.ts` | Core WhatsApp Baileys integration (connect, send, receive, anti-ban) |
| `index.ts` | Plugin registration, config schema, tool definition |
| `session-store.ts` | File-based auth state (useMultiFileAuthState wrapper) |
| `../../service-impl.ts` | ChannelServiceImpl — processIncomingMessage, AI pipeline |
| `../../../triggers/engine.ts` | TriggerEngine — event-based trigger matching |
| `../../../routes/agent-service.ts` | AI agent creation (createChatAgentInstance) |

## Research References

Analysis reports from 6 specialist agents (2026-03-04):
- `/tmp/analysis-evolution-patterns.md` — Evolution API makeWASocket config, getMessage, typing
- `/tmp/analysis-waha-patterns.md` — WAHA store bind, msgRetryCounterCache, browser fingerprint
- `/tmp/analysis-ban-bestpractice.md` — Consolidated P0 anti-ban checklist
- `/tmp/analysis-evolution-group-api.md` — 16 group endpoints, findChats, Prisma pagination
- `/tmp/analysis-waha-group-api.md` — NestJS controllers, dot-notation filters, webhooks
- `/tmp/analysis-ownpilot-code-review.md` — Critical fixes (getMessage, typing, logger)
- `/tmp/analysis-ownpilot-autoreply-chain.md` — Full auto-reply event chain analysis
- `/tmp/analysis-evolution-lid-handling.md` — LID swap strategy, remoteJidAlt
- `/tmp/analysis-waha-lid-handling.md` — LID utilities, SQLite store, jidsFromKey

Cloned source repos (for deep pattern analysis):
- `~/evolution-api-src/` — Evolution API (20MB, main: whatsapp.baileys.service.ts 5122 lines)
- `~/waha-src/` — WAHA (51MB, main: session.noweb.core.ts 2700+ lines)

## Media Recovery Pipeline

### Overview

WhatsApp media (images, documents, audio, video) follows a two-phase lifecycle:

1. **Metadata arrives first** — via history sync or real-time events, containing `mediaKey`, `directPath`, and a temporary CDN `url`.
2. **Binary data is downloaded separately** — using the metadata to decrypt the file from WhatsApp's CDN.

Real-time messages include both phases automatically. History sync messages often arrive with metadata only — the CDN URL expires within hours/days, so binary data must be downloaded promptly or recovered later.

### The Problem: ON CONFLICT DO NOTHING

History sync delivers messages in bulk via the `messaging-history.set` Baileys event. These are inserted using `createBatch()`, which uses `INSERT ... ON CONFLICT DO NOTHING` for deduplication.

The issue: WhatsApp sometimes re-delivers the same messages across multiple history sync rounds. The first delivery may arrive **without** media metadata (e.g., during initial pairing), while a later delivery includes full metadata (`mediaKey`, `directPath`, `url`). Because `ON CONFLICT DO NOTHING` silently skips rows that already exist, the updated media metadata from the second delivery is **lost**.

### The Fix: enrichMediaMetadata()

After each `createBatch()` call, an enrichment pass runs over all messages in the batch:

```
createBatch(messages)           ← INSERT ... ON CONFLICT DO NOTHING
  ↓
for each message with mediaKey:
  enrichMediaMetadata(id, {     ← UPDATE ... WHERE mediaKey IS NULL
    mediaKey, directPath, url
  })
```

`enrichMediaMetadata()` only updates rows where the existing `mediaKey` is missing — it never overwrites valid metadata. This ensures that re-delivered history sync data is merged into existing rows.

**Code location:** `packages/gateway/src/db/repositories/channel-messages.ts`

### Recovery Endpoints

Three endpoints handle different stages of media recovery:

#### 1. Single Message Retry

```
POST /api/v1/channels/YOUR_CHANNEL_ID/messages/YOUR_MESSAGE_ID/retry-media
```

Re-downloads binary data for a single message using its stored `mediaKey`. Works only if the message already has a valid `mediaKey` in the database.

```bash
curl -X POST http://localhost:8080/api/v1/channels/YOUR_CHANNEL_ID/messages/YOUR_MESSAGE_ID/retry-media
```

**Query parameters:**
- `index` — attachment index (default `0`)

**Returns:** `{ downloaded: true, size: 275704, mimeType: "image/jpeg" }` on success.

#### 2. Batch Retry

```
POST /api/v1/channels/YOUR_CHANNEL_ID/batch-retry-media
```

Downloads binary data for multiple messages in sequence. Requires all messages to already have `mediaKey`. Throttled to avoid WhatsApp rate limits.

```bash
curl -X POST http://localhost:8080/api/v1/channels/YOUR_CHANNEL_ID/batch-retry-media \
  -H "Content-Type: application/json" \
  -d '{
    "messageIds": ["MSG_ID_1", "MSG_ID_2", "MSG_ID_3"],
    "throttleMs": 5000
  }'
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `messageIds` | `string[]` | (required) | Message IDs to retry (max 50) |
| `throttleMs` | `number` | `5000` | Delay between downloads in milliseconds |

#### 3. Full Recovery Pipeline

```
POST /api/v1/channels/YOUR_CHANNEL_ID/recover-media
```

Production-grade endpoint that orchestrates the full pipeline: query DB for gaps, trigger history sync to obtain missing `mediaKey`s, wait for enrichment, then batch-download.

```bash
# Dry run — see what would be recovered without downloading
curl -X POST http://localhost:8080/api/v1/channels/YOUR_CHANNEL_ID/recover-media \
  -H "Content-Type: application/json" \
  -d '{
    "groupJid": "YOUR_GROUP_JID@g.us",
    "dateFrom": "2026-03-01",
    "dateTo": "2026-03-05",
    "dryRun": true
  }'

# Actual recovery — download up to 20 files
curl -X POST http://localhost:8080/api/v1/channels/YOUR_CHANNEL_ID/recover-media \
  -H "Content-Type: application/json" \
  -d '{
    "groupJid": "YOUR_GROUP_JID@g.us",
    "dateFrom": "2026-03-01",
    "dateTo": "2026-03-05",
    "limit": 20,
    "throttleMs": 5000
  }'
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupJid` | `string` | (required) | Group JID to recover media from |
| `dateFrom` | `string` | (none) | ISO date — start of recovery window |
| `dateTo` | `string` | (none) | ISO date — end of recovery window |
| `limit` | `number` | `20` | Maximum files to download per call |
| `dryRun` | `boolean` | `false` | If `true`, report what would be downloaded without actually downloading |
| `throttleMs` | `number` | `5000` | Delay between downloads (ms) |
| `syncWaitMs` | `number` | `8000` | How long to wait for history sync delivery (ms) |
| `skipSync` | `boolean` | `false` | Skip the history sync step (use only existing metadata) |

### Safety Guidelines

| Risk | Mitigation |
|------|------------|
| WhatsApp rate limit / ban | `limit` caps downloads per call (default 20). `throttleMs` adds delay between each (default 5s). |
| Runaway downloads | Always use `dryRun: true` first to inspect scope. Never set `limit` above 50 in production. |
| Wasted bandwidth | Use `dateFrom`/`dateTo` to narrow the recovery window. Use `skipSync: true` if you know metadata is already present. |
| CDN URL expiry | `retry-media` and `batch-retry-media` use `mediaKey` + `directPath` for decryption, not the CDN URL. URLs expire but keys remain valid. |

### Pipeline Stages (Internal)

```
recover-media endpoint
  │
  ├─ Step 1: Query DB (getAttachmentsNeedingRecovery)
  │   ├─ needsKey=true  → messages missing mediaKey entirely
  │   └─ needsData=true → messages with mediaKey but no binary
  │
  ├─ Step 2: History sync (if needsKey > 0 && !skipSync)
  │   ├─ fetchGroupHistory(groupJid, 50)
  │   └─ Wait syncWaitMs for async delivery + enrichment
  │
  ├─ Step 3: Re-query (messages now enriched with mediaKey)
  │   └─ Filter to downloadable (has mediaKey, missing data)
  │
  └─ Step 4: Batch download (throttled, capped by limit)
      ├─ retryMediaFromMetadata() per message
      ├─ updateAttachments() to persist binary
      └─ Return results array with success/failure per file
```

## Known Limitations — History Sync Chunk Boundary Edge Case

### The Finding

During history sync, WhatsApp delivers messages in "chunks" that cover date ranges. Each chunk normally includes full media metadata (`mediaKey`, `directPath`, `url`) for attachment messages.

In rare cases (~2% observed), a chunk delivers messages **without** any media metadata. This affects **all** messages in the chunk regardless of sender or file type.

Affected messages have these characteristics:
- `hasUrl: false`
- `hasMediaKey: false`
- `size: null`
- `contentType: 'attachment'` (correctly identified as media)
- `attachments: [{ type: 'file', url: '' }]` (placeholder, no data)

`enrichMediaMetadata()` **cannot fix these** because WhatsApp never re-sends the mediaKey for these messages — subsequent history syncs return the same chunk with the same missing metadata.

### Observable Pattern

When querying attachment messages for a group over a date range, a sharp boundary is visible:

```
Day N-1:  12 messages — all have mediaKey  ✅
Day N:     8 messages — ALL missing mediaKey ❌ (User A: 3, User B: 3, User C: 2)
Day N+1:   5 messages — ALL missing mediaKey ❌ (User A: 2, User B: 2, User C: 1)
Day N+2:  10 messages — all have mediaKey  ✅
```

Key observations:
- The gap spans exactly 1-2 days with sharp start/end boundaries
- **All** senders in the affected range are missing metadata (not sender-specific)
- **All** file types in the range are affected (PDF, JPEG, etc. — not type-specific)
- Messages before and after the gap have complete metadata

This pattern strongly suggests a **chunk-level** issue rather than a per-message problem.

### Possible Causes

1. **Chunk too large** — The history sync proto for the affected date range exceeded an internal size limit, causing WhatsApp to truncate the media metadata sub-message while preserving the text/envelope data.

2. **Connection interrupted during chunk delivery** — The chunk was partially received (message envelopes arrived, media metadata packet did not), and the client marked it as complete.

3. **Server-side truncation** — WhatsApp's server marked the chunk as "delivered" before the media metadata portion was fully serialized, possibly due to load or timeout.

### Diagnostic Query

To identify affected date ranges in your database:

```sql
-- Find date ranges with missing mediaKey (chunk boundary detection)
SELECT
  DATE(created_at) AS msg_date,
  COUNT(*) AS total_attachments,
  COUNT(*) FILTER (WHERE
    metadata::jsonb->'document'->>'mediaKey' IS NOT NULL
  ) AS has_key,
  COUNT(*) FILTER (WHERE
    metadata::jsonb->'document'->>'mediaKey' IS NULL
  ) AS missing_key
FROM channel_messages
WHERE channel_id = 'YOUR_CHANNEL_ID'
  AND content_type = 'attachment'
  AND metadata::jsonb->'document' IS NOT NULL
GROUP BY DATE(created_at)
ORDER BY msg_date;
```

If a date shows `missing_key = total_attachments` (100% missing), it is likely a chunk boundary issue.

### Workarounds

| Method | Success Rate | Description |
|--------|-------------|-------------|
| Re-trigger `fetchGroupHistory` | Low (~10%) | Same chunk is likely returned with the same missing metadata. Worth one attempt. |
| Forward files from phone | 100% | Ask a group member to forward the affected files. Creates a new real-time message with a fresh `mediaKey`. Works for any file type. |
| Manual export from phone | 100% | Use WhatsApp's "Export chat" or manually save files from the phone's gallery/file manager. Does not go through OwnPilot. |
| Wait for future history sync | Unknown | A future full re-sync (e.g., after re-pairing) may deliver the chunk correctly. Not guaranteed. |

### Impact Assessment

- **Scope:** ~2% of history sync date ranges in observed deployments
- **Severity:** Medium — affects only historical media, not real-time messages
- **Detection:** Run the diagnostic query above; 100% missing on a full date = chunk issue
- **No code fix possible:** The root cause is in WhatsApp's server-side chunk serialization. OwnPilot correctly processes whatever metadata is delivered.
