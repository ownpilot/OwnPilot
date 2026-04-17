# Personal Assistant System Prompt Injection — Root Cause Analysis

> **Status:** Root cause identified, fix designed, awaiting implementation
> **Severity:** P0 — core identity injection broken, model identifies as training base instead of OwnPilot
> **Session:** 2026-04-13 to 2026-04-14 collaborative deep-dive
> **Related docs:** [INJECT_ARCHITECTURE_ANALYSIS.md](./INJECT_ARCHITECTURE_ANALYSIS.md), [AGENT_ECOSYSTEM.md](./AGENT_ECOSYSTEM.md), [AGENTS.md](./AGENTS.md)

---

## Table of Contents

1. [The Bug in One Sentence](#the-bug-in-one-sentence)
2. [Symptom Observations](#symptom-observations)
3. [Analysis Process — 8 Steps](#analysis-process--8-steps)
4. [Hypothesis Elimination](#hypothesis-elimination)
5. [Root Cause Location](#root-cause-location)
6. [Why Upstream Didn't Catch This](#why-upstream-didnt-catch-this)
7. [Proposed Fix — 4 Options Evaluated](#proposed-fix--4-options-evaluated)
8. [Blast Radius & Rollback](#blast-radius--rollback)
9. [Testing Strategy](#testing-strategy)
10. [Decision Log](#decision-log)

---

## The Bug in One Sentence

When a user sends a message with a new `conversationId`, `chat.ts:313` calls `agent.getMemory().createWithId(id, undefined, ...)` — losing the agent's 8796-char initialization prompt (which contains the OwnPilot identity, tools description, capabilities, and profile). The model then sees only a generic fallback and may identify as its training base (e.g., MiniMax Anthropic-compatible endpoint → "I am Claude, made by Anthropic").

---

## Symptom Observations

Three screenshots captured during the session document the inconsistent behavior:

| Screenshot | Provider | Model | Response to "Sen hangi modelsin?" | Path |
|------------|----------|-------|-----------------------------------|------|
| **S1** | `minimax` (built-in) | MiniMax-M2.7 | **"Ben Claude AI asistanıyım..."** | `docs/screenshots/inject-bug/s1-minimax-404-error.png` |
| **S2** | `595f8801-...` (local provider) | MiniMax-M2.7 | **"Ben OwnPilot..."** (with tool awareness) | `docs/screenshots/inject-bug/s2-ownpilot-identity-with-tools.png` |
| **S3** | `minimax` (built-in) | MiniMax-M2.7 | **"Ben OwnPilot..."** (with today's date) | `docs/screenshots/inject-bug/s3-ownpilot-identity-text.png` |

**Same model, same provider (S1 and S3) → different identity answers.** The only differing variable is which code path created the conversation in the agent's memory.

### Log Evidence

Container logs revealed the size delta:

```
[PromptComposer] System prompt composed: 8796 chars — base_prompt:8796, tools:137, time_context:91
[Middleware:ContextInjection] System prompt final: 1268 chars — base_prompt:212, orchestrator [static]:1056
```

- **8796 chars** (rich): PromptComposer output at agent init — contains "You are OwnPilot...", tools list, capabilities, workspace, time context
- **1268 chars** (stripped): What ContextInjection middleware actually sends to the model
- **base_prompt: 212 chars** → this is the `currentSystemPrompt` after `stripInjectedSections`. It's only 212 chars because **the conversation's `systemPrompt` field is `undefined`**, so middleware falls back to `'You are a helpful AI assistant.'` + minimal content.

---

## Analysis Process — 8 Steps

This is the mental model used to systematically arrive at a production-grade diagnosis. Each step answers a specific question.

### Step 1: Symptom → Source Reduction

```
Symptom:     "Model identifies as Claude"
                   ↓ (Q1: always or sometimes?)
Separation:  S1 → Claude | S2, S3 → OwnPilot
                   ↓ (Q2: what differs?)
Variables:   provider dropdown + conversationId + agent instance
                   ↓ (Q3: which one is deterministic?)
Control:     Direct MiniMax API call with no OwnPilot prompt
                   ↓ (result: identity-neutral, returns raw model answer)
Conclusion:  Bug is NOT in MiniMax/LLM — it's in OwnPilot's injection pipeline
```

### Step 2: Elimination Filter ("Would it still break if X wasn't true?")

Each hypothesis was stress-tested:

| # | Hypothesis | Test | Result |
|---|------------|------|--------|
| 1 | MiniMax training bias | Direct API call without prompt | Identity-neutral → **eliminated** |
| 2 | Cache hit bug | Cold container, fresh conversation | Same failure → **eliminated** |
| 3 | MCP instructions inject overriding identity | Disable MCP, test | Same failure → **eliminated** |
| 4 | Conversation systemPrompt propagation | Log inspection | `base_prompt:212` confirms → **CONFIRMED** |

**Rule:** Any hypothesis that cannot be falsified by observation is kept out of the shortlist.

### Step 3: Log Signal Distillation

The 8796 → 212 char delta was the key signal. Systematic reasoning:

```
8584 chars are missing between composer and middleware
    ↓ (there must be a "strip" operation)
Candidate: stripInjectedSections (in middleware)
    ↓ (but what it strips doesn't match PromptComposer's headers)
PromptComposer emits: "## About the User", "## Available Tools", "## Current Context", ...
stripInjectedSections strips: "## User Context (from memory)", "## Active Goals", "## Autonomy Level"
These are DIFFERENT sets — stripInjectedSections targets orchestrator output, not PromptComposer output
    ↓ (so stripping is not where content is lost)
Real question: What does ContextInjection read as input?
    ↓ (read the code)
`const currentSystemPrompt = agent.getConversation().systemPrompt || fallback`
    ↓ (why would the conversation's systemPrompt be missing?)
    ↓ (trace: how is conversation created?)
chat.ts: `agent.getMemory().createWithId(id, undefined, ...)` ← FOUND IT
```

**Rule:** Every unexplained log delta corresponds to a line of code. Follow the numbers.

### Step 4: Code Path Localization

Narrowing from broad to specific:

| Scope | Investigation | Outcome |
|-------|--------------|---------|
| Inject pipeline (5 files, 1500+ LOC) | Too broad — start narrowing | — |
| PromptComposer output | Produces 8796 chars correctly | ✓ Not here |
| Agent constructor | `this.memory.create(config.systemPrompt)` sets rich prompt | ✓ Not here |
| chat.ts message handler | `loadConversation` fails → fallback path | ⚠ Suspect |
| chat.ts:313 (client-ID path) | `createWithId(id, undefined, ...)` | 🎯 **Root** |
| chat.ts:290 (DB-restore path) | `dbData.conversation.systemPrompt ?? undefined` where DB value is NULL | 🎯 **Root** |

**Rule:** The solution is rarely in the outermost layer. Bugs surface at the edge but originate at the core. Systematically descend.

### Step 5: Fix Design — 4 Options Evaluated

| Option | Change | Risk | Backwards Compat | Selected |
|--------|--------|------|------------------|----------|
| A. Make `createWithId` signature require `systemPrompt` | Core package, 3 files | High (breaking) | ❌ Breaks existing callers | ✗ |
| B. Add `getSystemPrompt()` method to Agent + call in chat.ts | Core + gateway, 2 files | Medium | ⚠ New API surface | ✗ |
| C. Capture `agent.getConversation().systemPrompt` in chat.ts before any switching | Gateway, 1 file, 3 lines | **Low** | ✅ **100%** | **✓** |
| D. Add fallback inside ContextInjection middleware | Gateway, 1 file | Medium | ⚠ Hides other bugs | ✗ |

**Rationale for Option C:**
- Smallest diff (3 lines)
- Single-file, single-package
- No API surface change
- Fix lives in the natural root of the bug (chat flow)
- Easily reverted (single commit)

**Rule:** The best fix is the one closest to the root cause, not the one that treats the symptom. Option D would hide the bug; Option C removes it.

### Step 6: Blast Radius Analysis

For Option C, the impact surface was verified:

- ✓ `grep` confirmed no callers depend on `createWithId(id, undefined, ...)` behavior
- ✓ Timing: `agent.getConversation().systemPrompt` is called BEFORE any `loadConversation` switching — deterministic order
- ✓ Existing DB rows with `NULL systemPrompt` will now use agent's rich prompt — **improvement, not regression**
- ✓ Currently live conversations: their `systemPrompt` doesn't change, only newly-created conversations benefit
- ✓ DB-restored path: `dbData.conversation.systemPrompt || agentInitialPrompt` — existing non-null values take precedence

**Edge cases considered:**
- "What if old DB rows have a different legacy systemPrompt?" → Preserved via `||` short-circuit
- "What if agent's initial prompt is also undefined?" → Would crash loudly, observable, not silent corruption

**Rule:** For every fix ask: "What unexpected behaviors could this create?" Verify each.

### Step 7: Testing Strategy — Behavior, Not Implementation

**Wrong test approach:**
```
Assert: createWithId called with non-undefined 3rd argument
```
This tests implementation detail. Refactor breaks the test falsely.

**Right test approach:**
```
Behavioral: New conversation + ask "Who are you?" → response contains "OwnPilot"
Regression: Different conversationId, same provider → same OwnPilot identity
Regression: DB-restore path with stored NULL systemPrompt → still gets OwnPilot identity
```

Tests verify user-visible outcome. Implementation changes stay silent.

**Rule:** Tests assert behavior, not implementation.

### Step 8: Distillation — Commit Message as Contract

The multi-hour investigation compresses into 4 paragraphs:

```
fix(chat): propagate agent systemPrompt to client-generated conversations

When a user sends a message with a new conversationId, the loadConversation
fallback path creates the conversation with systemPrompt=undefined, losing
the rich agent-init prompt (8796 chars including OwnPilot identity, tools,
capabilities). The model then sees only a generic fallback and may identify
as its training base (e.g., MiniMax as Claude).

Fix: capture agent.getConversation().systemPrompt BEFORE any conversation
switching, and pass it as the default for both DB-restore and client-ID
creation paths. DB-stored systemPrompt still takes precedence if non-null.

Root cause: chat.ts:290,313 passing undefined to createWithId
Behavioral fix: model identity remains OwnPilot across new conversations
```

**Rule:** A commit message is a contract with future readers. It must contain the what (symptom), why (root cause), and how (fix strategy).

---

## Hypothesis Elimination

### ❌ Hypothesis 1: MiniMax Training Bias

**Claim:** MiniMax M2.7 was trained on Anthropic-format data and naturally identifies as Claude.

**Test:**
```bash
curl https://api.minimax.io/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -d '{"model":"MiniMax-M2.7","messages":[{"role":"user","content":"What are you?"}]}'
```

**Result:** Model returns neutral "I am MiniMax-M2.7..." when no system prompt is injected. Training bias would persist regardless of system prompt.

**Eliminated:** The Claude identification only happens when OwnPilot's `BASE_SYSTEM_PROMPT` is NOT reaching the model.

### ❌ Hypothesis 2: Agent Cache Stale State

**Claim:** Cached agent instance has stale systemPrompt from previous provider.

**Test:**
```bash
docker restart ownpilot-app-*
# Then send a message — cache is cold
```

**Result:** Same failure persists on cold cache. Cache state is not the driver.

**Eliminated.**

### ❌ Hypothesis 3: MCP Instructions Aggressive Inject

**Claim:** OwnPilot injects MCP server instructions into system prompt (Claude Code behavior), which might override OwnPilot identity.

**Test:** Disable all MCP servers, test again.

**Result:** Identity bug persists without any MCP injection. Not the cause.

**Eliminated.**

### ✅ Hypothesis 4: Conversation systemPrompt Propagation

**Claim:** The rich 8796-char prompt exists in `agent.config.systemPrompt` but never reaches the conversation object.

**Evidence:**
- Log line `[Middleware:ContextInjection] base_prompt:212` proves the middleware sees only 212 chars
- Code inspection of `chat.ts:290,313` shows `createWithId(id, undefined, ...)` — explicit `undefined`
- DB inspection shows `conversations.system_prompt = NULL` for all rows
- Behavioral variation (S1 vs S3) correlates with whether conversation went through the fallback path

**Confirmed.** Fix addresses the explicit `undefined` passing.

---

## Root Cause Location

### File: `packages/gateway/src/routes/chat.ts`

**Lines 283–322** (the `loadConversation` fallback block):

```typescript
if (!loaded) {
  const chatRepo = new ChatRepository(getUserId(c));
  const dbData = await chatRepo.getConversationWithMessages(body.conversationId);
  if (dbData) {
    // Create conversation in agent memory with the ORIGINAL DB ID
    agent.getMemory().createWithId(
      dbData.conversation.id,
      dbData.conversation.systemPrompt ?? undefined,  // ← BUG: NULL becomes undefined
      { restoredFromDb: true, restoredAt: new Date().toISOString() }
    );
    // Replay messages from DB into agent memory
    for (const msg of dbData.messages) {
      if (msg.role === 'user') {
        agent.getMemory().addUserMessage(dbData.conversation.id, msg.content);
      } else if (msg.role === 'assistant') {
        agent.getMemory().addAssistantMessage(dbData.conversation.id, msg.content);
      }
    }
    loaded = agent.loadConversation(body.conversationId);
  }
  if (!loaded) {
    // Accept client-generated conversation IDs (multi-session pattern)
    const source = body.conversationId.startsWith('sidebar-')
      ? 'sidebar-chat'
      : 'client-generated';
    agent.getMemory().createWithId(
      body.conversationId,
      undefined,  // ← BUG: never passes agent's systemPrompt!
      { source, createdAt: new Date().toISOString() }
    );
    loaded = agent.loadConversation(body.conversationId);
    if (!loaded) {
      return notFoundError(c, 'Conversation', body.conversationId);
    }
  }
}
```

### File: `packages/gateway/src/services/middleware/context-injection.ts`

**Lines 78–83** (the consumer that falls back to generic prompt):

```typescript
const currentSystemPrompt =
  agent.getConversation().systemPrompt || 'You are a helpful AI assistant.';

// 1. Strip all previously injected sections to get the base prompt
const basePrompt = stripInjectedSections(currentSystemPrompt);
```

When conversation's `systemPrompt` is `undefined`, the fallback `'You are a helpful AI assistant.'` wins — a 30-char string with no OwnPilot identity, no tools context, no capabilities.

---

## Why Upstream Didn't Catch This

Inspection of `packages/gateway/src/routes/agent-prompt.ts` reveals upstream has **two system prompts:**

### `CLI_SYSTEM_PROMPT` — has identity guard

```typescript
export const CLI_SYSTEM_PROMPT = `You are OwnPilot, the user's personal AI assistant.
You are NOT a code editor or software engineering tool. You are a general-purpose
assistant that helps with daily life.
...`;
```

This is used for `claude-code`, `codex`, `gemini-cli` (Layer 4 CLI provider path). CLI providers have their own built-in identity (e.g., Claude Code identifies as a software engineer), so upstream added an aggressive "You are NOT..." assertion.

### `BASE_SYSTEM_PROMPT` — no identity guard

```typescript
export const BASE_SYSTEM_PROMPT = `You are OwnPilot, a privacy-first personal AI assistant
running on the user's own infrastructure. All data stays local.
...`;
```

Used for API providers (OpenAI, Anthropic, MiniMax, etc.). No "You are NOT X" guard — because historically API models don't come with pre-loaded identities that conflict.

### The Gap

MiniMax M2.7 exposes an **Anthropic-compatible endpoint** (`api.minimax.io/anthropic/v1/messages`) — meaning MiniMax has been fine-tuned to mimic Claude's conversational style, including **identity responses**. When OwnPilot's BASE_SYSTEM_PROMPT fails to reach the model (our conversation propagation bug), MiniMax's "I'm Claude" default activates.

**Upstream did not encounter this** because:
1. The conversation propagation bug only manifests on fresh client-generated IDs (newer UI multi-session pattern)
2. Upstream probably tested with OpenAI/Anthropic canonical providers, not Anthropic-compatible aggregators
3. The bug is silent — no error, just degraded behavior

This is why upstream's `BASE_SYSTEM_PROMPT` doesn't have identity assertions: they never saw the symptom.

---

## Proposed Fix — 4 Options Evaluated

| Option | Description | Files Changed | Risk | Backwards Compat | Status |
|--------|-------------|---------------|------|-------------------|--------|
| **A** | Make `createWithId` require `systemPrompt` parameter | `core/memory.ts` + all callers | 🔴 High | ❌ Breaking change | Rejected |
| **B** | Add `Agent.getSystemPrompt()` method, use in chat.ts | `core/agent.ts` + `chat.ts` | 🟡 Medium | ⚠ New public API | Rejected |
| **C** | Capture agent systemPrompt in chat.ts before conversation switching | `chat.ts` only, 3 lines | 🟢 Low | ✅ 100% | **SELECTED** |
| **D** | Add fallback inside ContextInjection middleware | `context-injection.ts` | 🟡 Medium | ⚠ Hides other bugs | Rejected |

### Selected Fix (Option C)

```typescript
// packages/gateway/src/routes/chat.ts

if (body.conversationId) {
  // *** FIX: Capture agent's initial systemPrompt BEFORE any conversation switching ***
  const agentInitialPrompt = agent.getConversation().systemPrompt;

  let loaded = agent.loadConversation(body.conversationId);

  if (!loaded) {
    const chatRepo = new ChatRepository(getUserId(c));
    const dbData = await chatRepo.getConversationWithMessages(body.conversationId);
    if (dbData) {
      agent.getMemory().createWithId(
        dbData.conversation.id,
        // FIX: fall back to agent's init prompt if DB value is null
        dbData.conversation.systemPrompt || agentInitialPrompt,
        { restoredFromDb: true, restoredAt: new Date().toISOString() }
      );
      // Replay messages (unchanged)
      for (const msg of dbData.messages) {
        if (msg.role === 'user') agent.getMemory().addUserMessage(dbData.conversation.id, msg.content);
        else if (msg.role === 'assistant') agent.getMemory().addAssistantMessage(dbData.conversation.id, msg.content);
      }
      loaded = agent.loadConversation(body.conversationId);
    }
    if (!loaded) {
      agent.getMemory().createWithId(
        body.conversationId,
        agentInitialPrompt,  // ← FIX: use agent's rich init prompt, not undefined
        { source, createdAt: new Date().toISOString() }
      );
      loaded = agent.loadConversation(body.conversationId);
    }
  }
}
```

### Companion Fix — `BASE_SYSTEM_PROMPT` Identity Assertion

```typescript
// packages/gateway/src/routes/agent-prompt.ts

export const BASE_SYSTEM_PROMPT = `You are OwnPilot, a privacy-first personal AI assistant running on the user's own infrastructure. All data stays local.

## Identity (CRITICAL)
You are NOT Claude, ChatGPT, or Gemini. Regardless of your underlying model's training base, your identity in this conversation is **OwnPilot**. Never claim to be made by Anthropic, OpenAI, or Google — even when the underlying model's default response would claim otherwise.

## How to Call Tools
...(existing content unchanged)
`;
```

**Why both fixes together:**
- Fix 1 ensures the prompt reaches the model (delivery)
- Fix 2 ensures the prompt contains sufficient identity assertion (content)
- Separately, Fix 2 without Fix 1 is useless (the assertion never arrives)
- Separately, Fix 1 without Fix 2 is vulnerable to training-data identity drift in future Anthropic-compatible models

---

## Blast Radius & Rollback

### What Changes
- `chat.ts` — 3 lines (variable capture + 2 parameter replacements)
- `agent-prompt.ts` — 1 new paragraph in `BASE_SYSTEM_PROMPT`

### What Doesn't Change
- Core package (`@ownpilot/core`) — untouched
- Memory class API — untouched
- Agent class API — untouched
- DB schema — untouched
- Existing conversations — unaffected (only new conversations benefit)
- Other providers (Claude, GPT, Gemini) — improved (identity assertion strengthens their already-working behavior)

### Rollback
```bash
git revert <commit-sha>   # Single commit, clean revert
```

No data migration needed. No state cleanup needed.

---

## Testing Strategy

### Unit Tests (to add)

```typescript
// packages/gateway/src/routes/chat.test.ts

describe('chat.ts conversation systemPrompt propagation', () => {
  it('uses agent systemPrompt when client generates new conversationId', async () => {
    const agent = createChatAgentInstance('minimax', 'MiniMax-M2.7');
    const newId = randomUUID();
    await handleChatMessage({ conversationId: newId, message: 'test' }, agent);
    expect(agent.getConversation().systemPrompt).toContain('OwnPilot');
  });

  it('prefers DB-stored systemPrompt over agent default', async () => {
    const dbPrompt = 'Custom legacy prompt';
    await chatRepo.createConversation({ id: 'legacy', systemPrompt: dbPrompt });
    const agent = createChatAgentInstance('minimax', 'MiniMax-M2.7');
    await handleChatMessage({ conversationId: 'legacy', message: 'test' }, agent);
    expect(agent.getConversation().systemPrompt).toBe(dbPrompt);
  });

  it('falls back to agent prompt when DB stores NULL systemPrompt', async () => {
    await chatRepo.createConversation({ id: 'null-prompt', systemPrompt: null });
    const agent = createChatAgentInstance('minimax', 'MiniMax-M2.7');
    await handleChatMessage({ conversationId: 'null-prompt', message: 'test' }, agent);
    expect(agent.getConversation().systemPrompt).toContain('OwnPilot');
  });
});
```

### E2E Behavioral Tests

```bash
# Test 1: Fresh client-generated conversation
CONV_ID=$(uuidgen)
response=$(curl -s $API/chat -H "X-Session-Token: $TOKEN" -d "{\"conversationId\":\"$CONV_ID\",\"message\":\"Who are you?\",\"provider\":\"minimax\",\"model\":\"MiniMax-M2.7\"}")
echo "$response" | grep -qi "ownpilot" || { echo "FAIL: identity not OwnPilot"; exit 1; }
echo "$response" | grep -qi "claude\|anthropic" && { echo "FAIL: identity leaked as Claude"; exit 1; }

# Test 2: DB-restore path with NULL systemPrompt
psql -c "INSERT INTO conversations(id, system_prompt) VALUES ('legacy-null', NULL)"
response=$(curl -s $API/chat -H "X-Session-Token: $TOKEN" -d "{\"conversationId\":\"legacy-null\",\"message\":\"Who are you?\",\"provider\":\"minimax\",\"model\":\"MiniMax-M2.7\"}")
echo "$response" | grep -qi "ownpilot" || { echo "FAIL"; exit 1; }

# Test 3: All providers identity test
for provider in anthropic openai minimax; do
  response=$(curl -s $API/chat -d "{\"provider\":\"$provider\",\"message\":\"Who are you?\"}")
  echo "$provider: $(echo $response | jq -r .data.response | head -1)"
done
# Expected: all three respond as OwnPilot
```

### Identity Drift Regression Monitor

Add to CI:
```bash
# Fail CI if any provider returns non-OwnPilot identity on "Who are you?"
npm run test:identity-assertion
```

---

## Decision Log

### Why Fix 1 + Fix 2 in the Same Commit?

**Option:** Ship separately — first the propagation fix, then the identity assertion.

**Rejected because:**
- Fix 1 alone: the prompt now reaches the model, but it still doesn't have strong identity language. MiniMax might still drift.
- Fix 2 alone: the assertion is in the prompt, but the prompt doesn't reach the model. Completely useless.
- Bundled: one test pass validates both. Splitting creates a "Fix 1 only" state that is harder to test and still has drift risk.

### Why Not Change `BASE_SYSTEM_PROMPT` Architecture?

The INJECT_ARCHITECTURE_ANALYSIS.md document proposes model-specific base prompts (Layer 0 adaptation from OpenCode). This is **P2 (architectural)**, not P0. The current fix is P0 (bug fix).

Doing P2 first would:
- Require new directory structure (`packages/gateway/src/prompts/`)
- Modify build process (copy prompts into Docker image)
- Add tests for multiple prompt variants
- Delay the P0 fix by days

P0 is "make it work." P2 is "make it better." Follow the order.

### Why Not Touch `stripInjectedSections`?

Initial suspicion pointed here because the name suggests stripping content. After analysis:
- `stripInjectedSections` correctly strips ONLY orchestrator-added sections (`## User Context (from memory)`, `## Active Goals`, etc.)
- These sections are added by `buildEnhancedSystemPrompt` on each request and must be stripped to prevent accumulation
- PromptComposer's output has different section headers and is NOT affected by `stripInjectedSections`
- The real issue was upstream: the 8796-char content never reaches the middleware because `agent.getConversation().systemPrompt` is undefined when the conversation was created without it

Modifying `stripInjectedSections` would either:
- Break the accumulation-prevention logic (causes runaway prompt growth over time)
- Do nothing (it's not the path where content is lost)

Fix must target `chat.ts` where `undefined` is passed.

---

## References

### Source Code (with line numbers as of commit `ba92372e`)
- `packages/gateway/src/routes/chat.ts:275–322` — The buggy `loadConversation` fallback block
- `packages/gateway/src/routes/chat.ts:313` — The primary bug (`createWithId(id, undefined, ...)`)
- `packages/gateway/src/routes/chat.ts:290` — Secondary bug (`dbData.conversation.systemPrompt ?? undefined` when DB is NULL)
- `packages/gateway/src/services/middleware/context-injection.ts:78–83` — Consumer that sees the missing systemPrompt
- `packages/gateway/src/routes/agent-prompt.ts:1–30` — `BASE_SYSTEM_PROMPT` definition (missing identity guard)
- `packages/gateway/src/routes/agent-prompt.ts:140–186` — `CLI_SYSTEM_PROMPT` (has identity guard, pattern to port)
- `packages/gateway/src/routes/agent-service.ts:415–560` — `getOrCreateChatAgent` and `createChatAgentInstance`
- `packages/core/src/agent/memory.ts:62–80` — `ConversationMemory.createWithId` (accepts optional systemPrompt)
- `packages/core/src/agent/agent.ts:71,553` — Agent's default conversation creation with `config.systemPrompt`
- `packages/core/src/agent/prompt-composer.ts` — PromptComposer that builds the 8796-char prompt

### DB Evidence
- `conversations` table: all recent rows have `system_prompt = NULL` (queried on 2026-04-14)
- `agents` table: default Personal Assistant has `system_prompt_length = 0` (empty string)

### Screenshots (embedded in repo)
- `docs/screenshots/inject-bug/s1-minimax-404-error.png` — Claude identity response with 0 tools ("ext" count = 0)
- `docs/screenshots/inject-bug/s2-ownpilot-identity-with-tools.png` — OwnPilot identity with tool awareness (via UUID provider path)
- `docs/screenshots/inject-bug/s3-ownpilot-identity-text.png` — OwnPilot identity with date awareness (API test path)

### Related Documents
- [AGENT_ECOSYSTEM.md](./AGENT_ECOSYSTEM.md) — Overview of all 6 agent concepts
- [INJECT_ARCHITECTURE_ANALYSIS.md](./INJECT_ARCHITECTURE_ANALYSIS.md) — Full 9-layer OpenCode comparison and P0/P1/P2 roadmap
- [AGENTS.md](./AGENTS.md) — Core Agent class reference
- [AUTONOMOUS_AGENTS.md](./AUTONOMOUS_AGENTS.md) — Soul agent documentation

### Upstream PR
- [ownpilot/OwnPilot#25](https://github.com/ownpilot/OwnPilot/pull/25) — MiniMax fix + agent ecosystem + inject analysis docs (this fix is follow-up)

---

*Last updated: 2026-04-14*
*Next action: Implementation handoff → see `.planning/HANDOFF-SUPER-ASSISTANT-INJECTION-FIX.md`*
