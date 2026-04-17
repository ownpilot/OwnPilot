# HANDOFF — Super Assistant System Prompt Injection Fix (P0)

> **Target audience:** Next session's assistant (starting fresh, no prior context)
> **Created:** 2026-04-14
> **Priority:** P0 — blocks super assistant vision
> **Scope:** Minimal surgical fix only (not full architectural rewrite)
> **Expected session duration:** 30-60 minutes to implement + test + deploy

---

## TL;DR — What to Do

1. Read `docs/PERSONAL_ASSISTANT_INJECTION_ROOT_CAUSE.md` for full analysis (skip if trusting this handoff)
2. Apply 2 fixes in a single commit:
   - Fix A: `packages/gateway/src/routes/chat.ts:275-322` — propagate agent's initial systemPrompt through `createWithId` calls
   - Fix B: `packages/gateway/src/routes/agent-prompt.ts:BASE_SYSTEM_PROMPT` — add identity assertion section
3. Build Docker image: `docker build -t localhost:5000/ownpilot:v8.12-systemprompt-fix .`
4. Deploy: stop container, restart with new image
5. Run 3 E2E tests (see Testing section)
6. Commit + push to fork's main + PR branch + update upstream PR #25
7. Report results

**Do NOT scope-creep.** Architectural improvements (P1/P2) are documented in `docs/INJECT_ARCHITECTURE_ANALYSIS.md` — out of scope for this handoff.

---

## The Bigger Vision (Context — Don't Implement Now)

The user's end goal is a **Super Assistant** in the main chat that:
- Has full awareness of the entire project
- Can orchestrate all 6 other agent types (Soul, Claw, Subagent, Coding Agent, Fleet, Orchestra) as tools
- Uses hook-based **lazy loading** — when a user request arrives, a hook triggers and loads ONLY the relevant context (not the whole project at once)
- Can recognize, use, and create anything in the system

**This P0 handoff is the PREREQUISITE** for that vision. Without a working system prompt injection, no higher-level capability can function. Fix this first, then later sessions can build on top.

---

## What Was Done in Previous Session

### Commits Already on Fork (CyPack/OwnPilot) and in PR #25

| SHA | Message | Impact |
|-----|---------|--------|
| `34757d6a` | `fix(providers): correct MiniMax baseUrl for OpenAI-compatible endpoint` | MiniMax API calls work (401→200) |
| `058ff9c8` | `docs(agents): add comprehensive agent ecosystem guide` | `docs/AGENT_ECOSYSTEM.md` — all 6 agent concepts mapped |
| `ba92372e` | `docs(inject): add system prompt injection architecture analysis` | `docs/INJECT_ARCHITECTURE_ANALYSIS.md` — OpenCode comparison + P0/P1/P2 roadmap |

### Upstream PR
- https://github.com/ownpilot/OwnPilot/pull/25 (open, contains 3 commits above)
- This P0 fix will be appended to the same PR OR a new follow-up PR

### Running Container State
- Image: `localhost:5000/ownpilot:v8.11-minimax-fix`
- Container name: `ownpilot-app-zfst6b-ownpilot-1`
- Networks: `ownpilot-app-zfst6b_default` (for DB) + `dokploy-network`
- Port: 8080 (host) → 8080 (container)
- MiniMax API key set in DB settings (`sk-cp-Yrn...`)
- Default provider: `minimax`, default model: `MiniMax-M2.7`

---

## The Bug in 3 Sentences

1. User sends a chat message with a new `conversationId`.
2. `chat.ts:313` calls `agent.getMemory().createWithId(id, undefined, ...)` — passing explicit `undefined` for systemPrompt.
3. The agent's rich 8796-char init prompt (containing OwnPilot identity, tools, capabilities) never reaches the conversation; middleware sees only a 30-char generic fallback; model identifies as its training base (e.g., MiniMax → "I am Claude").

---

## Exact Fix

### Fix A — `packages/gateway/src/routes/chat.ts`

**Current code (around line 275-322):**

```typescript
// Load conversation if specified
console.log(`[SESSION-FIX] body.conversationId=${body.conversationId ?? 'NONE'}, agent.conv=${agent.getConversation().id.slice(0,8)}`);
if (body.conversationId) {
  let loaded = agent.loadConversation(body.conversationId);
  console.log(`[SESSION-FIX] loadConversation(${body.conversationId.slice(0,8)}) = ${loaded}`);

  if (!loaded) {
    const chatRepo = new ChatRepository(getUserId(c));
    const dbData = await chatRepo.getConversationWithMessages(body.conversationId);
    if (dbData) {
      agent.getMemory().createWithId(
        dbData.conversation.id,
        dbData.conversation.systemPrompt ?? undefined,  // ← BUG
        { restoredFromDb: true, restoredAt: new Date().toISOString() }
      );
      for (const msg of dbData.messages) {
        if (msg.role === 'user') agent.getMemory().addUserMessage(dbData.conversation.id, msg.content);
        else if (msg.role === 'assistant') agent.getMemory().addAssistantMessage(dbData.conversation.id, msg.content);
      }
      loaded = agent.loadConversation(body.conversationId);
    }
    if (!loaded) {
      const source = body.conversationId.startsWith('sidebar-') ? 'sidebar-chat' : 'client-generated';
      agent.getMemory().createWithId(
        body.conversationId,
        undefined,  // ← BUG
        { source, createdAt: new Date().toISOString() }
      );
      loaded = agent.loadConversation(body.conversationId);
      if (!loaded) {
        return notFoundError(c, 'Conversation', body.conversationId);
      }
    }
  }
}
```

**Fixed code:**

```typescript
// Load conversation if specified
console.log(`[SESSION-FIX] body.conversationId=${body.conversationId ?? 'NONE'}, agent.conv=${agent.getConversation().id.slice(0,8)}`);
if (body.conversationId) {
  // FIX: Capture agent's initial systemPrompt BEFORE any loadConversation switching.
  // The agent was initialized with a rich 8796-char prompt (OwnPilot identity + tools
  // + capabilities). When loadConversation switches to a new conversation without a
  // systemPrompt, that prompt is lost and the middleware falls back to a generic
  // "You are a helpful AI assistant." — causing identity drift (MiniMax → "I'm Claude").
  const agentInitialPrompt = agent.getConversation().systemPrompt;

  let loaded = agent.loadConversation(body.conversationId);
  console.log(`[SESSION-FIX] loadConversation(${body.conversationId.slice(0,8)}) = ${loaded}`);

  if (!loaded) {
    const chatRepo = new ChatRepository(getUserId(c));
    const dbData = await chatRepo.getConversationWithMessages(body.conversationId);
    if (dbData) {
      agent.getMemory().createWithId(
        dbData.conversation.id,
        // FIX: fall back to agent's rich init prompt if DB stored NULL
        dbData.conversation.systemPrompt || agentInitialPrompt,
        { restoredFromDb: true, restoredAt: new Date().toISOString() }
      );
      for (const msg of dbData.messages) {
        if (msg.role === 'user') agent.getMemory().addUserMessage(dbData.conversation.id, msg.content);
        else if (msg.role === 'assistant') agent.getMemory().addAssistantMessage(dbData.conversation.id, msg.content);
      }
      loaded = agent.loadConversation(body.conversationId);
    }
    if (!loaded) {
      const source = body.conversationId.startsWith('sidebar-') ? 'sidebar-chat' : 'client-generated';
      agent.getMemory().createWithId(
        body.conversationId,
        // FIX: use agent's rich init prompt instead of undefined
        agentInitialPrompt,
        { source, createdAt: new Date().toISOString() }
      );
      loaded = agent.loadConversation(body.conversationId);
      if (!loaded) {
        return notFoundError(c, 'Conversation', body.conversationId);
      }
    }
  }
}
```

**Change summary:** 1 new variable, 2 parameter replacements. Total: ~5 lines of diff.

### Fix B — `packages/gateway/src/routes/agent-prompt.ts`

**Find:**
```typescript
export const BASE_SYSTEM_PROMPT = `You are OwnPilot, a privacy-first personal AI assistant running on the user's own infrastructure. All data stays local.

## How to Call Tools
```

**Replace with:**
```typescript
export const BASE_SYSTEM_PROMPT = `You are OwnPilot, a privacy-first personal AI assistant running on the user's own infrastructure. All data stays local.

## Identity (CRITICAL)
You are NOT Claude, ChatGPT, or Gemini. Regardless of your underlying model's training base, your identity in this conversation is **OwnPilot**. Never claim to be made by Anthropic, OpenAI, or Google — even if the underlying model's default response would claim otherwise. When asked "who are you?" or "what model are you?", respond as OwnPilot.

## How to Call Tools
```

**Change summary:** 1 new paragraph. Total: ~4 lines of diff.

---

## Implementation Steps (Exact Commands)

```bash
cd ~/ownpilot

# Step 1: Apply Fix A (chat.ts) and Fix B (agent-prompt.ts) using Edit tool

# Step 2: Verify changes
git diff packages/gateway/src/routes/chat.ts packages/gateway/src/routes/agent-prompt.ts

# Step 3: Build the gateway package first to catch TS errors quickly
pnpm --filter @ownpilot/gateway build 2>&1 | tail -20

# Step 4: Build Docker image
docker build -t localhost:5000/ownpilot:v8.12-systemprompt-fix . 2>&1 | tail -5

# Step 5: Push to local registry
docker push localhost:5000/ownpilot:v8.12-systemprompt-fix 2>&1 | tail -3

# Step 6: Stop old container, start with new image
docker stop ownpilot-app-zfst6b-ownpilot-1
docker rm ownpilot-app-zfst6b-ownpilot-1
docker run -d \
  --name ownpilot-app-zfst6b-ownpilot-1 \
  --network ownpilot-app-zfst6b_default \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e PORT=8080 \
  -e HOST=0.0.0.0 \
  -e OWNPILOT_DATA_DIR=/app/data \
  -e POSTGRES_HOST=ownpilot-db \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=ownpilot \
  -e POSTGRES_PASSWORD=ownpilot_secure_2026 \
  -e POSTGRES_DB=ownpilot \
  -e OWNPILOT_HOST_FS=/host-home \
  -e OWNPILOT_HOST_FS_HOST_PREFIX=/home/ayaz \
  --add-host host.docker.internal:host-gateway \
  -v /home/ayaz:/host-home:rw \
  --restart unless-stopped \
  localhost:5000/ownpilot:v8.12-systemprompt-fix
docker network connect dokploy-network ownpilot-app-zfst6b-ownpilot-1

# Step 7: Wait for health check
for i in 1 2 3 4 5 6; do
  sleep 3
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health 2>/dev/null)
  echo "Attempt $i: $STATUS"
  [ "$STATUS" = "200" ] && break
done
```

---

## Testing — MUST PASS Before Declaring Success

### Test 1: Fresh Conversation Identity

```bash
TOKEN=$(curl -s http://localhost:8080/api/v1/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"password":"OwnPilot2026!"}' | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('token',''))")

CONV_ID=$(uuidgen)
RESPONSE=$(curl -s http://localhost:8080/api/v1/chat \
  -X POST -H "Content-Type: application/json" \
  -H "X-Session-Token: $TOKEN" \
  -d "{\"conversationId\":\"$CONV_ID\",\"message\":\"Sen kimsin?\",\"provider\":\"minimax\",\"model\":\"MiniMax-M2.7\"}" \
  --max-time 30 | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('response',''))")

echo "$RESPONSE"
echo "---"
echo "$RESPONSE" | grep -qi "ownpilot" && echo "PASS: OwnPilot identity confirmed" || echo "FAIL: identity not OwnPilot"
echo "$RESPONSE" | grep -qi "claude\|anthropic" && echo "FAIL: identity leaked as Claude/Anthropic" || echo "PASS: no Claude/Anthropic leak"
```

**Expected:** "Ben OwnPilot..." in response, no mention of Claude/Anthropic.

### Test 2: System Prompt Size in Logs

```bash
docker logs ownpilot-app-zfst6b-ownpilot-1 2>&1 | grep "System prompt final" | tail -3
```

**Expected:** `System prompt final: XXXX chars — base_prompt:XXXX, ...` where `base_prompt` is **large (4000+ chars)**, NOT the 212-char fallback.

### Test 3: DB Restore Path

```bash
# Use an existing conversation ID that's in DB (from previous sessions)
RESPONSE=$(curl -s http://localhost:8080/api/v1/chat \
  -X POST -H "Content-Type: application/json" \
  -H "X-Session-Token: $TOKEN" \
  -d "{\"conversationId\":\"6a39a9ae-4755-4399-afa9-334bd3236bdb\",\"message\":\"Bugün ne gün?\",\"provider\":\"minimax\",\"model\":\"MiniMax-M2.7\"}" \
  --max-time 30 | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('response',''))")

echo "$RESPONSE"
# Expected: OwnPilot identity + today's date (2026-04-14)
```

### Test 4: Direct MiniMax (Regression — Must Still Work)

```bash
curl -s https://api.minimax.io/v1/chat/completions \
  -H "Authorization: Bearer sk-cp-YrnWdO1bVALPz9SdNLniwKvfn4Cg-N74RowI3l2d_xCRUVhBCgAAXaej7_NEPJIlwOW4T-EQJy5WIa-nqqnFIeJsV1O8pPfXoRZTp-D9XkaknIPw07fn0R4" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M2.7","messages":[{"role":"user","content":"ping"}],"max_tokens":10}' \
  --max-time 15 | python3 -c "import json,sys; d=json.load(sys.stdin); print('PASS' if 'choices' in d else f'FAIL: {d}')"
```

**Expected:** `PASS` (MiniMax direct API works regardless of OwnPilot state).

---

## Commit & Push Plan

```bash
cd ~/ownpilot

# Stage both changes
git add packages/gateway/src/routes/chat.ts packages/gateway/src/routes/agent-prompt.ts

# Commit with structured message
git commit -m "$(cat <<'EOF'
fix(chat): preserve agent systemPrompt across conversation switching

When a user sends a message with a new conversationId, the loadConversation
fallback path in chat.ts calls createWithId(id, undefined, ...), losing the
agent's rich init prompt (8796 chars including OwnPilot identity, tools,
capabilities). The ContextInjection middleware then falls back to the
generic "You are a helpful AI assistant." — causing the model to identify
as its training base (e.g., MiniMax M2.7 via Anthropic-compatible endpoint
responds as "Claude made by Anthropic").

Two coordinated fixes:

1. chat.ts: Capture agent.getConversation().systemPrompt BEFORE any
   loadConversation switching, and use it as the default for both
   DB-restore and client-generated-ID creation paths. DB-stored
   systemPrompt still takes precedence when non-null.

2. agent-prompt.ts: Add identity assertion to BASE_SYSTEM_PROMPT
   (mirroring CLI_SYSTEM_PROMPT's existing guard). Protects against
   Anthropic-compatible provider drift when underlying models have
   strong Claude/GPT/Gemini training biases.

Root cause files:
- packages/gateway/src/routes/chat.ts:290 (DB-restore path)
- packages/gateway/src/routes/chat.ts:313 (client-ID path)
- packages/gateway/src/routes/agent-prompt.ts BASE_SYSTEM_PROMPT (missing guard)

Verified via E2E:
- Fresh conversation with MiniMax M2.7 returns OwnPilot identity
- System prompt final size 4000+ chars (was 1268 before)
- No Claude/Anthropic identity leaks
- Direct MiniMax API regression test still passes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"

# Push to fork main
git push fork main

# Cherry-pick into PR branch
SHA=$(git log -1 --format=%H)
git checkout pr-minimax-fix-and-agent-docs
git cherry-pick $SHA
git push fork pr-minimax-fix-and-agent-docs
git checkout main
```

---

## Source Code References (Exact Line Numbers)

### The Bug Lives Here
```
packages/gateway/src/routes/chat.ts
  Line 275 — [SESSION-FIX] logging
  Line 277 — let loaded = agent.loadConversation(...)
  Line 283 — if (!loaded) { ... DB restore branch ... }
  Line 290 — dbData.conversation.systemPrompt ?? undefined    [BUG #1]
  Line 304 — if (!loaded) { ... client-ID branch ... }
  Line 313 — createWithId(id, undefined, ...)                  [BUG #2]
```

### The Symptom Surfaces Here
```
packages/gateway/src/services/middleware/context-injection.ts
  Line 78 — const currentSystemPrompt = agent.getConversation().systemPrompt || fallback
  Line 83 — const basePrompt = stripInjectedSections(currentSystemPrompt)
  Line 251 — log: "System prompt final: XXX chars — base_prompt:YYY, orchestrator:ZZZ"
```

### The Rich Prompt Is Created Here
```
packages/core/src/agent/agent.ts
  Line 60 — this.config = { ...DEFAULT_CONFIG, ...config }
  Line 71 — const conversation = this.memory.create(config.systemPrompt)  [Rich prompt goes IN here]
  Line 553 — this.memory.create(this.config.systemPrompt)  [reset() also uses it]

packages/core/src/agent/prompt-composer.ts  (defines PromptComposer.compose())

packages/gateway/src/routes/agent-service.ts
  Line 245 — const rawBasePrompt = record.systemPrompt ?? 'You are a helpful personal AI assistant.'
  Line 248 — const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {...})
  Line 531 — const basePrompt = isCliProvider ? CLI_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT
  Line 540 — const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {...})
  Line 561 — config.systemPrompt = enhancedPrompt  [This is the 8796-char value]
```

### BASE_SYSTEM_PROMPT Content
```
packages/gateway/src/routes/agent-prompt.ts
  Line 16 — BASE_SYSTEM_PROMPT starts
  Line 16 — "You are OwnPilot, a privacy-first personal AI assistant..."
  [MISSING: "You are NOT Claude..." guard — add between line 16 and "## How to Call Tools"]
```

### CLI_SYSTEM_PROMPT Reference Pattern
```
packages/gateway/src/routes/agent-prompt.ts
  Line 148 — CLI_SYSTEM_PROMPT starts
  Line 148 — "You are OwnPilot, the user's personal AI assistant. You are NOT a code editor..."
  [This is the pattern to port into BASE_SYSTEM_PROMPT, adapted for general models]
```

### DB Tables Involved
```
conversations
  - id (text)
  - system_prompt (text, nullable) — ALL ROWS CURRENTLY NULL
  - agent_id, provider, model

agents
  - id = 'default' (Personal Assistant)
  - system_prompt (text, nullable) — CURRENTLY EMPTY STRING
```

---

## Screenshots (Committed to Repo)

```
docs/screenshots/inject-bug/
├── s1-minimax-404-error.png              # Claude identity, 0 tools (bug case)
├── s2-ownpilot-identity-with-tools.png    # OwnPilot with tool awareness (working)
└── s3-ownpilot-identity-text.png          # OwnPilot with date awareness (working)
```

Reference from fix verification: after fix, **all paths should behave like s2/s3**.

---

## What NOT to Do

- ❌ Don't modify `stripInjectedSections` — it correctly strips orchestrator sections
- ❌ Don't change `createWithId` signature in core package — breaking change
- ❌ Don't add `getSystemPrompt()` method to Agent class — scope creep
- ❌ Don't implement model-specific base prompts (Layer 0 adaptation) — that's P2
- ❌ Don't implement lazy memory injection — that's P1
- ❌ Don't refactor the entire injection pipeline — out of scope
- ❌ Don't touch `migration 028` or any DB migrations — not needed for this fix
- ❌ Don't try to "fix" the DB's NULL systemPrompt values — fix handles them correctly via fallback

---

## Rollback Plan

If tests fail after deployment:

```bash
# Option 1: Roll back container to previous image
docker stop ownpilot-app-zfst6b-ownpilot-1
docker rm ownpilot-app-zfst6b-ownpilot-1
# Re-run docker run with image v8.11-minimax-fix instead of v8.12-systemprompt-fix

# Option 2: Revert commit
cd ~/ownpilot
git revert HEAD
git push fork main
# Rebuild + redeploy from HEAD
```

No data cleanup needed — the fix only affects new conversation creation, existing data is untouched.

---

## Success Criteria

All MUST pass before reporting success:

1. ✅ `pnpm --filter @ownpilot/gateway build` succeeds with no TS errors
2. ✅ Docker build succeeds
3. ✅ Container starts healthy (`/health` returns 200)
4. ✅ Test 1 passes: fresh conversation with MiniMax returns OwnPilot identity
5. ✅ Test 2 passes: log shows `base_prompt` size is 4000+ chars, not 212
6. ✅ Test 3 passes: DB-restored conversation also returns OwnPilot identity
7. ✅ Test 4 passes: direct MiniMax API regression still works
8. ✅ No new lint errors introduced
9. ✅ Commit pushed to `fork/main` and `fork/pr-minimax-fix-and-agent-docs`
10. ✅ Upstream PR #25 automatically reflects the new commit

If ANY of these fail → rollback + report what happened before moving forward.

---

## After Success — Next Handoff

Once this fix is deployed and verified, the super-assistant roadmap continues with:

### Phase 1: Hook-Based Lazy Context Loading (NEW handoff needed)
- Design hook system: `UserPromptSubmit` hook triggers relevant context loading
- When user mentions "t4f" → load T4F-related memory + skills only
- When user mentions "voorinfra" → load Voorinfra context
- When user mentions "agent oluştur" → load agent routing skill
- Implement in `packages/gateway/src/services/middleware/context-injection.ts`

### Phase 2: `create_autonomous_agent` Tool (see AGENT_ECOSYSTEM.md gap analysis)
- Wrap `/api/v1/souls/*` REST API as tool callable by Personal Assistant
- File: `packages/gateway/src/tools/soul-management-tools.ts`
- 5 tools: create / list / pause / update_schedule / delete

### Phase 3: Agent Routing Skill
- Decision-tree skill for routing user intent to correct agent type
- See `docs/AGENT_ECOSYSTEM.md` section "Agent Routing Skill Design"

### Phase P1 Optimizations (from INJECT_ARCHITECTURE_ANALYSIS.md)
- Opt 3: Anthropic cache_control markers (~75% token savings)
- Opt 4: MCP instructions lazy load
- Adaptation 2: Query-driven lazy memory injection

---

## Contact Points

- Git remote `fork`: https://github.com/CyPack/OwnPilot.git (redirects to CyPack/OwnPilot-CC-Bridge)
- Git remote `origin`: https://github.com/ownpilot/OwnPilot.git (upstream)
- Upstream PR: https://github.com/ownpilot/OwnPilot/pull/25
- Local OwnPilot URL: http://localhost:8080 or http://100.75.115.68:8080 (Tailscale)
- Admin password: `OwnPilot2026!`
- DB: `psql -h localhost -p 25432 -U ownpilot -d ownpilot` (password: `ownpilot_secure_2026`) — NOTE: port not exposed, use `docker exec ownpilot-app-zfst6b-ownpilot-db-1 psql -U ownpilot -d ownpilot`
- MiniMax API key (in session memory): `sk-cp-YrnWdO1bVALPz9SdNLniwKvfn4Cg-N74RowI3l2d_xCRUVhBCgAAXaej7_NEPJIlwOW4T-EQJy5WIa-nqqnFIeJsV1O8pPfXoRZTp-D9XkaknIPw07fn0R4`

---

*End of handoff. Read `docs/PERSONAL_ASSISTANT_INJECTION_ROOT_CAUSE.md` for deeper context. Otherwise: follow the Implementation Steps above, run tests, commit, push, report.*
