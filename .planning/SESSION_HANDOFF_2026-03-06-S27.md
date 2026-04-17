# Session Handoff S27 → S28

## Session S27 Summary
- Downloaded 61 SOR files from Sor Euronet WhatsApp group (last 7 days) → `~/sor-downloads/2026-week-10/`
- Fixed LID→display name resolution: DB batch UPDATE 6408 rows + code fix `resolveDisplayName()` in whatsapp-api.ts
- Commit: `9c2beaf` pushed to fork, PR #11 updated
- Docker rebuild + deploy: image `df00ea79`, container healthy
- Password set: `OwnPilot2026!`
- QR scan done, WhatsApp connected

## NEXT SESSION: Implement Reconnect Gap Fill

### ROOT CAUSE DISCOVERED (CRITICAL)
**The primary bug is in `whatsapp-api.ts` line 276:**
```typescript
if (upsert.type !== 'notify') return;  // <-- THIS DROPS ALL OFFLINE MESSAGES
```

WhatsApp DOES push missed messages on reconnect — they arrive via `messages.upsert` with `type: 'append'` (not `'notify'`). The current code silently drops them.

Baileys source confirms: `await upsertMessage(msg, node.attrs.offline ? 'append' : 'notify')` — offline messages get `type='append'`.

### RESEARCH COMPLETED (5 Agents Spawned, 3 Completed)

#### Agent 1: Baileys Protocol Research (COMPLETED)
Key findings:
- Short disconnections (sec-min): messages queued on server, pushed as `messages.upsert type='append'` on reconnect
- Longer disconnections (min-hours): may arrive via `messaging-history.set` with `syncType=RECENT` (value 3)
- Very long (14+ days): device unlinked
- `fetchMessageHistory()`: max 50/call, phone must be online, results async via `messaging-history.set` ON_DEMAND
- **FIX: Always persist BOTH append and notify messages, but only auto-reply to notify**

#### Agent 2: Context7 Baileys Docs (COMPLETED)
Key findings:
- `syncType` values: INITIAL_BOOTSTRAP(0), RECENT(3), PUSH(4→pushName), ON_DEMAND(6)
- `shouldSyncHistoryMessage: () => true` already correctly configured
- `messages.upsert type='append'` = historical/offline catch-up messages
- `messages.upsert type='notify'` = real-time only

#### Agent 3: Codebase Deep Analysis (COMPLETED)
Key findings:
- Connection lifecycle fully mapped (connect→QR→open→messages→close→scheduleReconnect→reconnect)
- `cleanupSocket()` clears messageCache, messageKeyCache, historyAnchorByJid but NOT processedMsgIds (correct)
- DB infrastructure READY: `getDistinctChats()`, `getLatestByChat()`, `getOldestByChat()` all exist
- Composite index recommended: `idx_channel_messages_channel_jid_created`
- No `lastDisconnectedAt` tracking exists
- Insertion point: `handleConnectionUpdate()` when `connection === 'open'` (line 1102+)
- `fetchGroupHistory()`/`fetchGroupHistoryFromAnchor()` already implemented but never called automatically

#### Agent 4: Production References (COMPLETED)
Key findings:
- **Evolution API:** Processes BOTH `append` and `notify` — this is the correct pattern. Our #1 fix
- **WAHA:** Manual pull (`wa/messages pull`), no auto gap detection
- **Mautrix (gold standard):** DB-backed queue, composite unique key `(chat_jid, sender_jid, message_id)`, timestamp tracking per chat, `isNewLogin` flag, timer-based dispatch
- **All production systems:** Processing `type='append'` = highest impact, lowest risk fix
- **Anti-ban:** `fetchMessageHistory` sparingly, max 1/30s, passive sync preferred

#### Agent 5: Devil's Advocate (COMPLETED)
Critical risks:
- **R1.1 CRITICAL:** Burst fetch after reconnect = ban trigger. Max 3-5 chats, 60-300s delay
- **R2.1 CRITICAL:** Gap fill + upsert overlap → double AI response. Gap fill = storage ONLY
- **R5.2 CRITICAL:** Network flapping → 60s stability window before gap fill
- **R1.3 HIGH:** Repeated reconnect amplification → daily cap 3 gap fills, skip if gap < 5min
- **R4.2 HIGH:** Media download during gap fill = ban. Metadata only, lazy download
- **R3.2 HIGH:** No UNIQUE(channel_id, external_id) → add as prerequisite
- **OVERALL RECOMMENDATION:** "Do NOT build active gap fill. Passive sync + append processing is sufficient. The safest gap fill is the one you do not build."

### IMPLEMENTATION PLAN (3 Phases)

#### Phase 1: FIX THE SILENT DROP (Critical — immediate impact)
**File:** `whatsapp-api.ts` lines 262-290

Current code only processes `type='notify'` messages through `handleIncomingMessage()`.
Fix: Process `type='append'` messages through DB storage (but NOT AI auto-reply).

```typescript
// BEFORE (broken):
if (upsert.type !== 'notify') return;

// AFTER (fixed):
const isOfflineSync = upsert.type === 'append';
for (const msg of upsert.messages) {
  // Cache ALL messages for getMessage retry
  // ... (existing cache logic, already handles both types)

  if (isOfflineSync) {
    // Offline/reconnect messages: SAVE to DB but DON'T auto-reply
    this.handleOfflineMessage(msg).catch(err => log.error(...));
  } else {
    // Real-time: existing flow (dedup + handleIncomingMessage)
    // ... (existing notify logic)
  }
}
```

New method `handleOfflineMessage(msg)`:
- Parse payload (text, media, attachments)
- Build DB row (same as history sync format)
- Call `messagesRepo.create()` or use createBatch
- Resolve display name via `resolveDisplayName()`
- DO NOT call eventBus.emit(MESSAGE_RECEIVED) — no AI response
- Dedup via processedMsgIds (already in place for cache)

#### Phase 2: Track Connection State
- Add `lastDisconnectedAt` instance variable
- Record timestamp on `connection='close'`
- Optionally persist to DB for crash recovery

#### Phase 3: Active Gap Fill (fetchMessageHistory)
- After reconnect + 60s delay (let passive sync complete first)
- Query `getDistinctChats()` → compare lastMessageAt vs lastDisconnectedAt
- For chats with gap > 5min: call `fetchMessageHistory()` with 30s spacing
- Results arrive via existing `messaging-history.set` handler
- Max 20 chats, prioritize by activity

### SAFEGUARDS
- Dedup: `processedMsgIds` + DB `ON CONFLICT DO NOTHING`
- Rate limit: 30s between fetchMessageHistory calls (existing)
- Max gap fill: cap at 20 chats, 50 msgs each = 1000 msgs max
- No AI response for offline messages (prevent flood)
- Delay gap fill 60s after reconnect (let passive sync run first)
- Log all gap fill activity for debugging

### FILES TO MODIFY
1. `packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts` — main changes
2. `packages/gateway/src/db/repositories/channel-messages.ts` — possibly add helper methods
3. `packages/gateway/src/db/schema.ts` — add composite index migration

### TEST STRATEGY
- Unit: mock messages.upsert with type='append', verify DB storage
- Unit: mock connection close→open cycle, verify gap fill triggered
- Integration: disconnect container, send messages, reconnect, verify received
- Verify: offline messages saved but NO AI response triggered

### GIT
- Branch: `fix/whatsapp-440-reconnect-loop`
- HEAD: `9c2beaf` (pushed to fork)
- PR: https://github.com/ownpilot/OwnPilot/pull/11

### DEVIL'S ADVOCATE SAFEGUARD CHECKLIST (S28 must verify each)
- [ ] `type='append'` messages saved to DB but NO AI response triggered
- [ ] `processedMsgIds` checked for append messages (dedup)
- [ ] No media download for offline messages (metadata only)
- [ ] Phase 3 (active gap fill) SKIP unless passive sync proven insufficient
- [ ] If Phase 3 needed: 60s stability window, max 3 chats, daily cap 3

### REFERENCE FILES (S28 MUST READ BEFORE IMPLEMENTATION)
IMPORTANT: Read ALL of these before writing any code. They contain critical context.

```bash
# 1. Main implementation file (READ FULLY — especially lines 262-290, 1051-1076, 1102-1157)
cat ~/ownpilot/packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts

# 2. DB repository — createBatch, enrichMediaMetadata, getDistinctChats, getLatestByChat
cat ~/ownpilot/packages/gateway/src/db/repositories/channel-messages.ts

# 3. Channel service — processIncomingMessage flow
cat ~/ownpilot/packages/gateway/src/channels/service-impl.ts

# 4. DB schema — channel_messages table, indexes
cat ~/ownpilot/packages/gateway/src/db/schema.ts

# 5. Message parser — payload parsing, media extraction
cat ~/ownpilot/packages/gateway/src/channels/plugins/whatsapp/message-parser.ts

# 6. WhatsApp guide — architecture, known limitations, media recovery
cat ~/ownpilot/packages/gateway/src/channels/plugins/whatsapp/WHATSAPP-GUIDE.md

# 7. This handoff file itself
cat ~/ownpilot/.planning/SESSION_HANDOFF_2026-03-06-S27.md
```

### IMPLEMENTATION ORDER (strict)
1. Read ALL reference files above first
2. Phase 1: Fix `type='append'` silent drop (5 min, %90 impact)
3. Phase 2: `lastDisconnectedAt` tracking (10 min)
4. Phase 3: Active gap fill — ONLY if Phase 1+2 insufficient after testing
5. Test: Disconnect container, send messages via phone, reconnect, verify DB
