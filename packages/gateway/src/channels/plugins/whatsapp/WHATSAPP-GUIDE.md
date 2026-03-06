# WhatsApp Channel — Architecture & Operations Guide

> Agent-friendly reference. Read this before modifying WhatsApp channel code.
> Last updated: 2026-03-04 (Session 7 — anti-ban hardening + LID research)

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

| JID Format        | Example                            | Description                                | Current Status                                  |
| ----------------- | ---------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `@s.whatsapp.net` | `YOUR_PHONE_NUMBER@s.whatsapp.net` | Direct message (phone-based)               | PROCESSED                                       |
| `@g.us`           | `120363375272168801@g.us`          | Group chat                                 | SKIPPED                                         |
| `@lid`            | `179203903344808@lid`              | Linked ID (WhatsApp multi-device internal) | SKIPPED (LID resolution available but inactive) |
| `@broadcast`      | `status@broadcast`                 | Broadcast list / Status                    | SKIPPED                                         |
| `@newsletter`     | `123456@newsletter`                | WhatsApp Channel (public)                  | SKIPPED                                         |

## Access Control (allowed_users)

- **Config location:** DB table `config_entries`, service `whatsapp_baileys`, field `allowed_users`
- **Format:** Comma-separated phone numbers: `"YOUR_PHONE_NUMBER, OTHER_PHONE_NUMBER"`
- **Empty = allow all** (DANGEROUS — every incoming DM triggers AI response)
- **Current value:** `"YOUR_PHONE_NUMBER"` (self-chat only)

### How to change allowed_users

```sql
-- Add Selin to allowed users
UPDATE config_entries
SET data = jsonb_set(data::jsonb, '{allowed_users}', '"YOUR_PHONE_NUMBER, OTHER_PHONE_NUMBER"')::text
WHERE service_name = 'whatsapp_baileys' AND is_default = true;

-- Then restart container to reload config
docker restart ownpilot
```

Or via OwnPilot UI: Settings → Config Center → WhatsApp → Allowed Phone Numbers

## Anti-Ban Protections (P0 — All Active)

| Protection           | Implementation                                                                | Reference                             |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| Browser fingerprint  | `Browsers.appropriate('Chrome')`                                              | Evolution API pattern                 |
| Offline by default   | `markOnlineOnConnect: false` + `sendPresenceUpdate('unavailable')` on connect | Evolution + WAHA                      |
| Typing simulation    | `available → composing → delay(1-5s) → paused → send → unavailable`           | Evolution API `sendMessageWithTyping` |
| Rate limiting        | 20 msg/min global + 3s per-JID gap                                            | Industry consensus                    |
| getMessage callback  | Returns cached message or `undefined` (NEVER empty string)                    | Baileys 7.x requirement               |
| Message retry cache  | `msgRetryCounterCache` (SimpleTTLCache, 5min)                                 | Evolution + WAHA                      |
| Device cache         | `userDevicesCache` (SimpleTTLCache, 5min)                                     | WAHA pattern                          |
| Transaction retry    | `transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 }`        | Evolution API                         |
| Reconnect cap        | Max 10 attempts, exponential backoff + jitter                                 | Both                                  |
| 440 tracking         | 3 consecutive 440 → stop reconnect                                            | Custom                                |
| Permanent disconnect | 401/403/402/406 → no reconnect (would escalate ban)                           | Evolution API                         |
| Group skip           | `@g.us` messages not processed                                                | Anti-spam                             |
| Message dedup        | `processedMsgIds` Set (cap 1000) — prevents double AI response on reconnect   | Custom                                |
| Pino silent          | Logger `'silent'` in production — no JID/content leakage                      | Both                                  |

## LID Resolution (INACTIVE — Ready to Activate)

WhatsApp's Linked ID system (2024+): some messages arrive as `@lid` instead of `@s.whatsapp.net`.

### When to activate

| Scenario | Trigger                                                         | Action                  |
| -------- | --------------------------------------------------------------- | ----------------------- |
| A        | Auto-reply opened to other users, their messages come as `@lid` | Activate LID resolution |
| B        | Group messages enabled, participant JIDs are `@lid`             | Activate LID resolution |
| C        | LID-only contacts can't match `allowed_users`                   | Activate LID resolution |

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

| Method                                                                     | Speed                   | Scope                             | Reversible |
| -------------------------------------------------------------------------- | ----------------------- | --------------------------------- | ---------- |
| Disconnect WhatsApp (UI/API)                                               | Instant                 | All                               | Yes        |
| Set `allowed_users` to fake number                                         | Instant (after restart) | All except self                   | Yes        |
| `UPDATE channel_users SET is_blocked = TRUE WHERE platform = 'whatsapp'`   | Instant                 | Specific users                    | Yes        |
| `UPDATE channel_users SET is_verified = FALSE WHERE platform = 'whatsapp'` | Instant                 | All (sends "approval needed" msg) | Yes        |
| Add `auto_reply` toggle to config schema                                   | Code change             | Configurable                      | Yes        |

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
allowed_users: "YOUR_PHONE_NUMBER, OTHER_PHONE_NUMBER, 905551234567"
Groups: SKIP
LID: Activate resolution (so LID contacts are recognized)
```

AI responds to you + listed contacts. Everyone else ignored.

### Scenario 3: Group bot (e.g., "Sor Euronet")

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

| File                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `whatsapp-api.ts`                  | Core WhatsApp Baileys integration (connect, send, receive, anti-ban) |
| `index.ts`                         | Plugin registration, config schema, tool definition                  |
| `session-store.ts`                 | File-based auth state (useMultiFileAuthState wrapper)                |
| `../../service-impl.ts`            | ChannelServiceImpl — processIncomingMessage, AI pipeline             |
| `../../../triggers/engine.ts`      | TriggerEngine — event-based trigger matching                         |
| `../../../routes/agent-service.ts` | AI agent creation (createChatAgentInstance)                          |

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
