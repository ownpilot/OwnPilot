---
generated_at: 2026-04-13T00:15:00Z
trigger_reason: bug_report
session_number: 3
pipeline_status: analysis_complete
files_updated: 0
coverage_scope: [duplicate-messages, persistence-middleware, messagebus-double-save]
---

# HANDOFF: Duplicate Messages Bug — Double Persistence Path

## BUG DESCRIPTION

AI'dan yanit geldikten sonra sidebar'dan conversation'a tiklandiginda
her mesaj (user + assistant) 2 kere gorunuyor.

Screenshot evidence: "4 hangi modelsin" → 2x user msg + 2x assistant msg

## DB EVIDENCE

```sql
-- "4 hangi modelsin" (e2577716) — v8.9-parallel-chat
user      | 4 hangi modelsin              | 21:49:51  ← early persist
user      | 4 hangi modelsin              | 21:50:13  ← persistence middleware
assistant | <think>The user is asking...   | 21:50:13  ← persistence middleware (RAW)
assistant | MiniMax-M2.7                  | 21:50:13  ← saveStreamingChat (STRIPPED)

-- "w hangi modelsin" (d4860520) — ERROR case, NO duplicate
user      | w hangi modelsin              | 21:25:25  ← early persist only
assistant | Error: Agent already proc...  | 21:25:26  ← error, no double save
```

Pattern: EVERY successful AI response = 2x user + 2x assistant. Error cases = 1x each (correct).

## ROOT CAUSE

TWO separate persistence paths run for the SAME conversation:

```
POST /api/v1/chat
  │
  ├─ 1. EARLY PERSIST (chat.ts:417-435)
  │     chatRepo.addMessage({role:'user'})     ← USER MSG #1 ✅
  │
  ├─ 2. MessageBus processes AI stream
  │
  ├─ 3. PERSISTENCE MIDDLEWARE (middleware/persistence.ts:67-89)
  │     chatRepo.addMessage({role:'user'})     ← USER MSG #2 ❌ DUPLICATE
  │     chatRepo.addMessage({role:'assistant'}) ← ASSISTANT MSG #1 (raw <think>)
  │
  └─ 4. processStreamingViaBus → saveStreamingChat (chat-streaming.ts:709)
        conversation-service._persist:
          getMessages(id, {limit:1}) → finds early persist user msg
          SKIP user msg (dedup works!)     ← BUT middleware already added #2
          addMessage({role:'assistant'})    ← ASSISTANT MSG #2 (stripped) ❌ DUPLICATE
```

The dedup in `_persist` correctly skips the user message, but the persistence middleware
runs BEFORE `_persist` and adds its OWN user + assistant WITHOUT any dedup check.

## WHY THIS HAPPENED

Session 2 commit `9b843e2c` changed `saveStreamingLog` → `saveStreamingChat` in
processStreamingViaBus. Original architecture was:

- persistence middleware: saves user + assistant messages (MessageBus path)
- saveStreamingLog: saves trace/log ONLY (no messages)

By changing to saveStreamingChat, BOTH the middleware AND saveStreamingChat now save
messages → double persist.

## FIX OPTIONS

### Option A: Revert to saveStreamingLog + fix middleware conversationId (RECOMMENDED)

```typescript
// chat-streaming.ts — REVERT to saveStreamingLog
await new ConversationService(userId).saveStreamingLog(state, {...});

// middleware/persistence.ts — FIX: use params.conversationId, not agent state
// The middleware receives conversationId from the MessageBus context
// Ensure it uses the CLOSURE-captured ID, not agent.getConversation().id
```

This restores the original architecture: middleware handles messages, saveStreamingLog handles logs.
The middleware needs to receive the correct conversationId from the MessageBus context
(captured at SSE start, before any resetContext call).

### Option B: Disable middleware, keep saveStreamingChat

```typescript
// Disable persistence middleware for MessageBus path
// OR add a flag to skip middleware when saveStreamingChat will run
```

More invasive — requires understanding the middleware registration system.

### Option C: Deduplicate at DB level

```sql
-- Add unique constraint: (conversation_id, role, content, created_at rounded to second)
-- Or use INSERT ... ON CONFLICT DO NOTHING
```

Band-aid — doesn't fix the architectural double-write.

## KEY FILES

| File | Lines | Role |
|------|-------|------|
| `packages/gateway/src/services/middleware/persistence.ts` | 67-89 | Persistence middleware — saves user+assistant (NO dedup) |
| `packages/gateway/src/routes/chat-streaming.ts` | 709 | `saveStreamingChat` call (changed from `saveStreamingLog` in 9b843e2c) |
| `packages/gateway/src/services/conversation-service.ts` | 142-150 | `_persist` with dedup check |
| `packages/gateway/src/routes/chat.ts` | 427-435 | Early persist user message |

## INVESTIGATION STEPS FOR NEXT SESSION

1. Read `middleware/persistence.ts` FULLY — understand how it receives conversationId
2. Check MessageBus middleware registration — how is conversationId passed?
3. Test Option A: revert chat-streaming.ts to saveStreamingLog
4. Verify: send message → check DB → should be exactly 1 user + 1 assistant
5. Test resetContext scenario: send → New Chat → send → both conversations should persist

## CURRENT STATE

- Branch: main
- Last commit: `973d02ad` (docs: handoff + lessons)
- Deploy: v8.9-parallel-chat
- All tests passing: gateway 372/372, UI 176/176
- Container: localhost:5000/ownpilot:v8.9-parallel-chat running

## WHAT NOT TO TOUCH

- Early persist in chat.ts (user message save) — KEEP, this prevents message loss
- Per-conversation agent cache in agent-service.ts — KEEP, this enables parallel chat
- Sidebar optimistic entry (useChatStore + useSidebarRecents) — KEEP, this is correct
- VITE_API_BASE fixes (useChatStore, useSidebarChat, useWebSocket) — KEEP
- dev-proxy.mjs WS handler — KEEP

## QUICK REFERENCE

```bash
# Check for duplicates
docker exec ownpilot-app-zfst6b-ownpilot-db-1 psql -U ownpilot -d ownpilot -c \
  "SELECT c.id, LEFT(c.title,25), c.message_count,
   (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.role='user') as u,
   (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.role='assistant') as a
   FROM conversations c ORDER BY c.created_at DESC LIMIT 10;"

# Test commands
pnpm --filter @ownpilot/gateway exec tsc --noEmit
pnpm --filter gateway exec vitest run src/routes/chat.test.ts src/routes/chat-streaming.test.ts
pnpm --filter gateway exec vitest run src/services/middleware/persistence.test.ts
```
