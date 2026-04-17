# HANDOFF: Multi-Session Chat — Instant Sidebar Entry Fix

**Date:** 2026-04-12 (updated session 2)
**Branch:** main
**Last commit:** `e85edb23` (fix: per-conversation agent cache for parallel multi-session chat)
**Deploy:** v8.9-parallel-chat (Dokploy, localhost:5000 registry)

---

## SESSION 2 FIXES (6 commits: 4bc33329..e85edb23)

| # | Commit | Problem | Root Cause | Fix |
|---|--------|---------|------------|-----|
| 1 | `4bc33329` | Sidebar entry not instant on Send | optimisticEntries useMemo pruned by DB reload race | Custom event `chat:optimistic-entry` → useSidebarRecents prepends directly |
| 2 | `7b4f4bee` | Dev fetch 404 + WS crash + CORS | Raw `fetch('/api/...')` bypasses VITE_API_BASE; dev-proxy no WS handler; X-Runtime not in CORS | VITE_API_BASE prefix + WS upgrade handler + CORS headers + TARGET_HOST=127.0.0.1 |
| 3 | `2860b73f` | User message lost when AI fails | Early persist only creates conv row, no message | `chatRepo.addMessage()` in early persist + dedup in saveStreamingChat + ChatPage memory fallback |
| 4 | `9b843e2c` | MessageBus path saves log only | `processStreamingViaBus` calls `saveStreamingLog` not `saveStreamingChat` | Changed to `saveStreamingChat` with closure-captured conversationId |
| 5 | `e85edb23` | "Agent already processing" on parallel chat | chatAgentCache keyed by `provider\|model` = singleton per provider | Added `conversationId` to cache key → per-conversation agent instances |
| 6 | `f5ac...` | launch.json autoPort golden path | autoPort:true breaks Vite (PORT env ignored) | Restored autoPort:false |

### Key Architecture Insights

1. **Agent Cache**: `chatAgentCache` key was `chat|provider|model` → ALL conversations shared ONE agent. `isProcessing` lock rejected concurrent requests. Fix: `chat|provider|model|conv_ID` → 20 concurrent agents (LRU eviction).

2. **MessageBus vs Legacy Streaming**: Two paths exist in `chat.ts`. MessageBus path (line 447) delegated persistence to middleware that broke on `resetContext`. Legacy path (line 500) called `saveStreamingChat` directly. Fix: both paths now use `saveStreamingChat`.

3. **Dev Proxy Architecture**: `dev-proxy.mjs` → `127.0.0.1:8080`. Needs WS upgrade handler + error resilience. CORS must include `X-Runtime`, `X-Conversation-Id`.

### Remaining Issues
- Duplicate user messages in some conversations (dedup check `getMessages(id, {limit:1})` may not catch all cases)
- Bridge CC spawn for openclaw-bridge project fails with code=143 (needs investigation)
- openclaw-bridge has 35 pre-existing test failures (validateProjectDir ENOENT)

---

## 1. WHAT WAS DONE (9 commits this session)

| # | Commit | What | Status |
|---|--------|------|--------|
| 1 | `87b68e8a` | RC-1: Stream orphan pattern (clearMessages doesn't abort stream) | ✅ Working |
| 2 | `87b68e8a` | RC-2: resetContext no longer deletes old conversation from agent memory | ✅ Working |
| 3 | `87b68e8a` | RC-3: sessionId persisted to localStorage | ⚠️ Reverted in e5794da4 (caused stale resume) |
| 4 | `935ffb3b` | Multi-session store: sessionsRef Map, createSession/switchSession/closeSession, tab bar | ✅ Working (verified with Playwright A→B→C test) |
| 5 | `c6949575` | Multi-optimistic sidebar: stickyOptimisticMapRef replaces single-slot ref | ⚠️ NOT WORKING — see OPEN BUG below |
| 6 | `d1ced44c` | Client-generated conversationId: backend accepts unknown IDs, auto-creates | ✅ Working (backend verified) |
| 7 | `7a4923b4` | Stream retry: withRetry on OpenAIProvider.stream() for 429/5xx | ✅ Working |
| 8 | `27c31c59` | resetContext on New Chat: re-prime backend agent with current provider/model | ✅ Working |
| 9 | `e5794da4` | Fresh session on page load: no stale localStorage sessionId restore | ✅ Working |

Additional minor commits: `42be8bb3` (pre-set sessionId before setMessages), `4800b410` (auto-focus input on New Chat).

---

## 2. THE OPEN BUG — MUST FIX FIRST

### Symptom
User sends a message → message appears in chat area → "Calling minimax/MiniMax-M2.7..." streaming → **but the conversation does NOT appear in sidebar RECENT until the response completes and the page is refreshed.**

Screenshot evidence: User sends "b hangi modelsin" — chat area shows it, sidebar RECENT shows only OLD conversations, not the new one.

### Root Cause Analysis

The optimistic sidebar entry system has a **timing/render gap**:

1. `sendMessage()` in `useChatStore.tsx`:
   - Line 301-305: `setSessionId(freshUUID)` if null → sets React state + ref + localStorage
   - Line 319-328: `setMessages([...prev, userMsg])` → adds user message
   - Line 365: `fetch POST /api/v1/chat` → backend early persist → WS `chat:history:updated`

2. `Sidebar.tsx` `optimisticEntries` useMemo (line 106-147):
   - Dependencies: `[chatMessages, chatStoreSessionId, recents.conversations, sessionTabs]`
   - Line 110: `const firstUserMsg = chatMessages.find(m => m.role === 'user')`
   - Line 112: `const convId = chatStoreSessionId || '__optimistic__'`
   - Line 113: `if (!recents.conversations.some(c => c.id === convId))` → add to map
   - Line 140-144: Prune entries that DB now has

3. **The race condition:**
   - `sendMessage` fires → React batches state updates
   - Backend early persist fires VERY fast (~50ms) → WS broadcast → `recents.reload()` from DB
   - DB entry arrives with the SAME sessionId → prune logic removes optimistic entry
   - Net result: optimistic entry appears for 1 frame then gets pruned, OR never appears

4. **Why it worked during the Playwright A→B→C test:**
   - The test was run from a fresh Chromium instance (clean state)
   - MiniMax M2.7 takes ~18 seconds to respond — plenty of time for optimistic entry to appear
   - The bridge-opencode provider was slower, so early persist timing was different
   - After the first "New Chat" click, `createSession()` added the snapshot to `sessionTabs` which provided the sidebar entry via a DIFFERENT code path (line 127-136)

5. **Why it stopped working in the user's browser:**
   - The user's browser has localStorage with stale sessionId (before `e5794da4` fix)
   - WS `chat:history:updated` fires very fast after early persist
   - `recents.reload()` triggers useMemo recalculation
   - The prune logic at line 140-144 removes the optimistic entry because DB now has it

### The REAL Fix Needed

**The optimistic entry should NOT be pruned by DB arrival.** Instead, the DB entry should REPLACE the optimistic entry seamlessly. The current approach of "add optimistic then prune when DB has it" creates a flicker/disappearance.

**Better approach:** Remove the optimistic entry system entirely. Instead:
1. When `sendMessage` is called, immediately call `recents.reload()` AFTER the user message is added
2. The early persist creates the DB entry BEFORE the AI responds
3. The WS `chat:history:updated` already triggers `recents.reload()`
4. The DB entry appears in sidebar from the FIRST reload

**OR even simpler:** After `setMessages` in `sendMessage`, manually inject the new conversation into `recents.conversations` without waiting for WS/DB:

```typescript
// In sendMessage, after setMessages:
// Manually trigger sidebar recents to show this conversation
window.dispatchEvent(new CustomEvent('chat:new-conversation', {
  detail: { id: currentSessionId, title: content.slice(0, 80) }
}));
```

And in `useSidebarRecents.ts`, listen for this event and prepend the entry.

---

## 3. KEY FILES & THEIR ROLES

| File | Lines | Role | Changed In |
|------|-------|------|------------|
| `packages/ui/src/hooks/useChatStore.tsx` | 914 | Main chat store — multi-session, streaming, sessionId | All commits |
| `packages/ui/src/components/Sidebar.tsx` | 488 | Sidebar with optimistic entries, recents | c6949575 |
| `packages/ui/src/pages/ChatPage.tsx` | 1268 | Chat UI, tab bar, provider selector, New Chat | 935ffb3b, 27c31c59, 4800b410 |
| `packages/ui/src/hooks/useSidebarRecents.ts` | 238 | WS-driven sidebar recents list from DB | NOT changed (but key for fix) |
| `packages/ui/src/components/ChatInput.tsx` | 392 | Chat input with focus() handle | 4800b410 |
| `packages/gateway/src/routes/chat.ts` | 852 | POST /chat handler, early persist, SSE streaming | d1ced44c |
| `packages/gateway/src/routes/agent-service.ts` | 931 | Agent cache, resetContext (no more memory.delete) | 87b68e8a |
| `packages/core/src/agent/providers/openai-provider.ts` | ~400 | Bridge provider, stream retry | 7a4923b4 |
| `packages/ui/src/constants/storage-keys.ts` | 24 | localStorage key registry | 87b68e8a |

---

## 4. ARCHITECTURE SNAPSHOT

```
┌─── useChatStore (ChatProvider) ────────────────────────────┐
│                                                             │
│  MULTI-SESSION:                                             │
│    sessionsRef: Map<id, ChatSessionSnapshot>  (in-memory)   │
│    activeSessionId: string (React state)                    │
│    sessionTabs: SessionTab[] (React state)                  │
│    createSession() → snapshot + clear + new UUID            │
│    switchSession(id) → snapshot + restore                   │
│    closeSession(id) → remove + switch nearest               │
│                                                             │
│  PER-SESSION STATE:                                         │
│    messages[], sessionId, isLoading, streamingContent,      │
│    thinkingContent, isThinking, progressEvents, error,      │
│    suggestions, extractedMemories, pendingApproval,         │
│    sessionInfo, lastFailedMessage                           │
│                                                             │
│  STREAM CONTROL:                                            │
│    streamGenRef (orphan counter)                            │
│    abortControllerRef (HTTP cancel for Stop button)         │
│    isCurrentStream() check in SSE read loop                 │
│                                                             │
│  GLOBAL (shared across sessions):                           │
│    provider, model (localStorage persisted)                 │
│    agentId, workspaceId, thinkingConfig                     │
│                                                             │
│  SESSION ID:                                                │
│    Fresh UUID on page load (no localStorage restore)        │
│    Pre-generated in sendMessage if null (safety net)        │
│    Client-generated ID sent to backend as conversationId    │
│    Backend auto-creates conversation for unknown IDs        │
└─────────────────────────────────────────────────────────────┘

┌─── Sidebar ────────────────────────────────────────────────┐
│  recents: useSidebarRecents() → DB-driven, WS-refreshed   │
│  optimisticEntries: useMemo from chatMessages + sessionTabs│
│    ⚠️ BUG: entries get pruned immediately by DB arrival    │
│  activeConversationId: URL param || chatStoreSessionId     │
└─────────────────────────────────────────────────────────────┘

┌─── Backend (chat.ts) ──────────────────────────────────────┐
│  POST /api/v1/chat                                         │
│    1. Accept client-generated conversationId (auto-create) │
│    2. Early persist → DB row + WS broadcast                │
│    3. SSE stream → chunks → done event                     │
│    4. Full persist → user + assistant messages to DB        │
│  resetChatAgentContext() → preserves old conv (no delete)  │
│  Stream retry: withRetry on 429/5xx before first chunk     │
└─────────────────────────────────────────────────────────────┘

┌─── DB (PostgreSQL) ────────────────────────────────────────┐
│  conversations: id, title, provider, model, message_count  │
│  messages: id, conversation_id, role, content              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. DATA FLOW: Send Message → Sidebar Entry (DESIRED)

```
User types message + hits Enter
  │
  ├─ 1. useChatStore.sendMessage()
  │     ├─ setSessionId(freshUUID) if null → ref + state + localStorage
  │     ├─ setMessages([...prev, userMsg]) → user bubble appears
  │     └─ fetch POST /api/v1/chat { conversationId: freshUUID, message, provider, model }
  │
  ├─ 2. INSTANT: Sidebar entry appears (BROKEN — this is the bug)
  │     ├─ CURRENT: optimisticEntries useMemo triggered by chatMessages change
  │     │   → builds entry with chatStoreSessionId as ID
  │     │   → BUT gets pruned when DB entry arrives via WS (race condition)
  │     │
  │     └─ DESIRED: entry appears and STAYS until user navigates away
  │         OPTION A: Don't prune — let DB entry replace optimistic naturally
  │         OPTION B: Skip optimistic entirely — just reload recents after setMessages
  │         OPTION C: Emit custom event from sendMessage → useSidebarRecents prepends
  │
  ├─ 3. Backend early persist (~50ms after request arrives)
  │     └─ getOrCreateConversation(freshUUID, {title: truncate(message)})
  │     └─ WS broadcast: chat:history:updated
  │
  ├─ 4. Sidebar WS handler → recents.reload() → DB query → conversation list updated
  │     └─ New conversation appears in RECENT (from DB, not optimistic)
  │
  └─ 5. SSE done event → session.sessionId set → sidebar highlight
```

---

## 6. SPECIFIC SUB-TASKS FOR THE FIX

### Task 1: Fix the sidebar instant entry (CRITICAL)

**Problem:** `optimisticEntries` in Sidebar.tsx gets pruned immediately by DB arrival.

**Approach A (simplest):** Remove the prune-on-DB-match logic. Let optimistic entries persist. When DB entry arrives with same ID, sidebar shows both briefly (optimistic + DB) — but since they have the same ID, only one renders (Map key dedup). Actually the issue is `recents.conversations.some(c => c.id === convId)` returns true → entry is NOT added to map.

**Approach B (recommended):** Skip the optimistic entry system for the ACTIVE session entirely. Instead, in `sendMessage()`, after adding the user message, dispatch a custom event that `useSidebarRecents` listens to and immediately prepends a temporary entry:

```typescript
// In useChatStore sendMessage, after setMessages:
window.dispatchEvent(new CustomEvent('chat:optimistic-entry', {
  detail: { id: currentSessionId, title: content.slice(0, 80) }
}));
```

```typescript
// In useSidebarRecents, add listener:
useEffect(() => {
  const handler = (e: CustomEvent) => {
    setConversations(prev => {
      if (prev.some(c => c.id === e.detail.id)) return prev;
      return [{ id: e.detail.id, title: e.detail.title, ... } as Conversation, ...prev];
    });
  };
  window.addEventListener('chat:optimistic-entry', handler);
  return () => window.removeEventListener('chat:optimistic-entry', handler);
}, []);
```

This way the entry goes directly into `recents.conversations` (the canonical list), not a separate optimistic layer. When DB reload happens, the entry is already there (or gets replaced by the real DB entry with the same ID).

**Approach C (cleanest, LibreChat-style):** Use React Query / SWR optimistic update pattern. `recents.reload()` call can include an optimistic entry in the cache before the actual fetch completes.

### Task 2: Verify no replace behavior

After Task 1, test the A→B→C scenario:
1. Send A → sidebar shows A INSTANTLY
2. New Chat → A stays, fresh chat opens
3. Send B → sidebar shows B above A (no replace!)
4. New Chat → both stay
5. Send C → sidebar shows C above B above A

### Task 3: Tab bar + sidebar sync

When user clicks a tab, the corresponding sidebar entry should be highlighted. Currently `activeConversationId = searchParams.get('conversationId') || chatStoreSessionId`. Tab click calls `switchSession(id)` which sets `sessionId` → sidebar should highlight.

### Task 4: Provider/model config on New Chat

`27c31c59` added `chatApi.resetContext(provider, model)` to handleNewChat. Verify this ensures the correct bridge-opencode / minimax/MiniMax-M2.7 config is sent on the first message of a new chat.

---

## 7. RESEARCH FINDINGS (from this session)

### Multi-session patterns in other projects

| Project | State Lib | Session Structure | Switch Mechanism |
|---------|-----------|-------------------|-----------------|
| LibreChat | Recoil atomFamily | Atom per conversation | URL `/c/:id` + navigate |
| Open WebUI | Svelte stores | Flat array + backend | URL `/c/[id]` |
| LobeChat | Zustand 11 slices | sessions[] + activeAgentId | State-only set() |
| ChatGPT-Next-Web | Zustand + IndexedDB | sessions[] + currentSessionIndex | Index-based |
| big-AGI | Zustand + IndexedDB | conversations[] + pane manager | Multi-pane focus |

**Key insight:** All projects use client-generated IDs. LibreChat's server-side ID generation was a known bug fixed in v0.8.0.

### Devil's advocate findings (4 specialist agents)

- Pre-generated client UUID → backend 404 (CRITICAL) → FIXED by removing sidebar-* prefix check
- Shared agent concurrency risk → tolerable for single-user
- Stream abort universally weak → our orphan pattern is better than most

### Backend tracer findings

- Early persist at t3 (before AI response) — conversation exists in DB immediately
- `session.sessionId === conversationId` (same value, different names)
- `getOrCreateConversation` is idempotent
- No UUID format validation (any string ≤200 chars)

---

## 8. DEPLOYMENT NOTES

- **Dokploy compose:** `composeId: 5D5V14E1ESPb0pdSbrSN6`
- **Image registry:** `localhost:5000/ownpilot:v8.4-fresh-session`
- **compose-update:** MCP tool does NOT update composeFile → use REST API:
  ```bash
  DOKPLOY_KEY=$(python3 -c "import json; d=json.load(open('/home/ayaz/.claude.json')); print(d['mcpServers']['DokployServer']['env']['DOKPLOY_API_KEY'])")
  curl -s -X POST "http://localhost:3000/api/trpc/compose.update" \
    -H "x-api-key: $DOKPLOY_KEY" -H "Content-Type: application/json" \
    -d '{"json":{"composeId":"5D5V14E1ESPb0pdSbrSN6","composeFile":"...","sourceType":"raw"}}'
  ```
- **extra_hosts:** `host.docker.internal:host-gateway` required for bridge connectivity
- **Vite dev:** `:5173` with proxy to `:8080` — restart after useChatStore changes (HMR doesn't fully propagate Context Provider changes)

---

## 9. TEST COMMANDS

```bash
# Full test suite
pnpm run typecheck                    # 6/6 tasks
pnpm --filter ui exec vitest run      # 176/176 tests
pnpm --filter gateway exec vitest run src/routes/agent-service.test.ts  # 156/156
pnpm --filter gateway exec vitest run src/routes/chat.test.ts           # 74/74
pnpm run build                        # 4/4 packages

# Backend API test
TOKEN=$(curl -s http://localhost:8080/api/v1/auth/login -X POST \
  -H "Content-Type: application/json" -d '{"password":"OwnPilot2026!"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -s -m 60 -X POST http://localhost:8080/api/v1/chat \
  -H "Content-Type: application/json" -H "X-Session-Token: $TOKEN" \
  -H "X-Runtime: opencode" \
  -d '{"message":"test","provider":"0d279d0c-61f8-4884-9acd-0bfc3439abf8","model":"minimax/MiniMax-M2.7","stream":false,"conversationId":"test-'$(date +%s)'"}'

# DB check
docker exec ownpilot-app-zfst6b-ownpilot-db-1 psql -U ownpilot -d ownpilot -c \
  "SELECT id, LEFT(title,40), message_count FROM conversations ORDER BY created_at DESC LIMIT 5;"
```

---

## 10. WHAT NOT TO TOUCH

- `useSidebarChat.tsx` — sidebar mini-chat, completely independent, working fine
- `packages/core/src/agent/` — agent engine, tools, plugins (no changes needed)
- `packages/gateway/src/services/conversation-service.ts` — persistence layer, working
- `packages/gateway/src/routes/chat-streaming.ts` — SSE callbacks, working
- Bridge provider headers (`X-Runtime`, `X-Conversation-Id`) — working correctly
- DB schema — no migrations needed
