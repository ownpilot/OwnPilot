# System Prompt Injection Architecture — OpenCode Comparison & Production Optimizations

> **Status:** Architecture analysis + concrete optimization proposals
> **Focus:** The Personal Assistant's system prompt injection pipeline — bugs discovered, gaps vs OpenCode's 9-layer model, and production-grade fixes
> **Related:** [AGENT_ECOSYSTEM.md](./AGENT_ECOSYSTEM.md), [AGENTS.md](./AGENTS.md)

---

## Table of Contents

1. [Context — OpenCode's 9-Layer Inject Architecture](#context--opencodes-9-layer-inject-architecture)
2. [OwnPilot Inject Pipeline — Real Layers](#ownpilot-inject-pipeline--real-layers)
3. [The Live Bug We Caught](#the-live-bug-we-caught)
4. [Production-Grade Solutions — 3 OpenCode Patents to Adapt](#production-grade-solutions--3-opencode-patents-to-adapt)
5. [5 Immediate Optimizations](#5-immediate-optimizations)
6. [Implementation Priority](#implementation-priority)

---

## Context — OpenCode's 9-Layer Inject Architecture

For reference, OpenCode (a similar AI coding agent) structures system prompt injection across 9 deterministic layers:

### Layer 0 — Provider Base Prompt (Static)
`packages/opencode/src/session/prompt/` — model-specific `.txt` file:
- Claude → `anthropic.txt`
- GPT → `beast.txt`
- Gemini → `gemini.txt`

If an agent has its own prompt, this layer is entirely replaced.

### Layer 1 — Environment Block (Runtime, every LLM call)
`system.ts` — model name, working directory, OS platform, today's date → prepended to system array.

### Layer 2 — Instruction Files / Rules (Filesystem Walk)
`instruction.ts` — two-phase:
- Session start: searches for `AGENTS.md` (project → worktree root → `~/.config/opencode/AGENTS.md` → `~/.claude/CLAUDE.md` fallback)
- `opencode.json` → `instructions: ["docs/*.md", "glob+URL support"]`

### Layer 3 — Incremental Discovery (Tool Execution Time — OpenCode Unique!)
When `read` tool fires, walks up from file's directory to find new `AGENTS.md` → lazy injects as `<system-reminder>`. Duplicate-safe via claim system.

### Layer 4 — Agent-Specific Prompt Override
`.opencode/agents/*.md` or `~/.config/opencode/agents/` — frontmatter + body = agent system prompt. `{file:./prompts/x.txt}` syntax for external file references.

### Layer 5 — Skills System
`skill.ts` — `.opencode/skill/`, `.claude/skills/` (compat), global → skill tool's description built runtime as XML from all sources.

### Layer 6 — Mode Fragments (Conditional)
State-driven static `.txt` fragments injected:
- `plan.txt` → appended to last user message when plan mode active
- `build-switch.txt` → on plan→build transition
- `max-steps.txt` → as fake assistant message when step limit exceeded

### Layer 7 — MCP Tool Registration
MCP instructions field does NOT go directly to system prompt (differs from Claude Code!). Delivered via tool descriptions. `tool.execute.before/after` hooks wrap MCP calls.

### Layer 8 — Plugin Hooks (Programmatic, npm SDK)
`@opencode-ai/plugin` package — the most powerful layer:

| Hook | What It Does |
|------|--------------|
| `experimental.chat.system.transform` | Mutate system prompt array |
| `chat.message` | Mutate user messages |
| `experimental.chat.messages.transform` | Mutate entire history |
| `chat.params` | Override temperature/topP/topK |
| `tool.definition` | Mutate tool schema |
| `experimental.session.compacting` | Inject/modify compaction prompt |

### Layer 8b — Provider Cache Restructure (Anthropic/DeepSeek)
`provider/transform.ts` — transforms system array into 2-part cache-friendly structure, injects `cacheControl` markers.

---

## OwnPilot Inject Pipeline — Real Layers

Observed from live production logs during session:

```
[PromptComposer] System prompt composed: 8796 chars — base_prompt:8796, tools:137, time_context:91
[Middleware:ContextInjection] System prompt final: 1268 chars — base_prompt:212, orchestrator [static]:1056
```

1:1 mapping against OpenCode's 9-layer model:

| # | Layer | OpenCode | OwnPilot | File |
|---|-------|----------|----------|------|
| 0 | **Provider base prompt** | Model-specific `.txt` | `BASE_SYSTEM_PROMPT` single file, same for all providers | `packages/gateway/src/routes/agent-prompt.ts` |
| 1 | **Environment block (runtime)** | `system.ts` every call | `PromptComposer.compose()` → time_context (hour-rounded for cache), workspace dirs | `packages/core/src/agent/prompt-composer.ts` |
| 2 | **Instruction files / Rules** | AGENTS.md filesystem walk + glob | **MISSING** — no file-based rule discovery | — |
| 3 | **Incremental discovery (lazy)** | Walk-up from read-tool target | **MISSING** — critical gap | — |
| 4 | **Agent-specific prompt override** | `.opencode/agents/*.md` frontmatter | DB `agents.system_prompt` — **BUT LEFT EMPTY for Personal Assistant** | `agents` table |
| 5 | **Skills system** | `.opencode/skill/` + `.claude/skills/` fallback | `user_extensions` + `agentskills-parser` + `soul.skillAccess` | `packages/gateway/src/services/agentskills-parser.ts` |
| 6 | **Mode fragments** | `plan.txt`/`build-switch.txt` | **MISSING** — only code execution on/off | — |
| 7 | **MCP tool registration** | Via tool description (no aggressive inject) | **MCP instructions injected into system prompt** (Claude Code behavior) | `packages/gateway/src/mcp/` |
| 8 | **Plugin hooks (SDK)** | `experimental.chat.system.transform` | **MISSING** — no hook system for prompt transformation | — |
| 8b | **Provider cache restructure** | `provider/transform.ts` Anthropic markers | **Partial** — `PromptComposer` rounds time but no array-split with `cache_control` | `prompt-composer.ts` |

### Summary

OwnPilot has a **partial implementation** covering Layers 0, 1, 5 well; Layer 4 has infrastructure but is unreliable; Layers 2, 3, 6, 7, 8 are missing or inverted.

---

## The Live Bug We Caught

During this session, we reproduced the exact failure mode caused by the gaps above. Screenshots showed:
- Screenshot 1: MiniMax identifies as **Claude** (Anthropic)
- Screenshot 3: MiniMax identifies as **OwnPilot**

Same provider, same model, different sessions. The cause is deterministic:

```
Agent init (cache miss):
  injectMemoryIntoPrompt("") → PromptComposer → 8796 chars (rich content)
  ↓
  BASE_SYSTEM_PROMPT contains: "You are OwnPilot..." ← identity HERE
  ↓
ContextInjection middleware (every request):
  currentSystemPrompt = agent.getConversation().systemPrompt || fallback
  basePrompt = stripInjectedSections(currentSystemPrompt)
  ↓
  Problem: DB's Personal Assistant agent has systemPrompt="" (EMPTY)
  ↓
  createAgentFromRecord(record) returns cached agent
  ↓
  record.systemPrompt = "" → falls back to "You are a helpful AI assistant."
  ↓
  stripInjectedSections strips PromptComposer's rich content
  ↓
  Final: 212 chars + 1056 orchestrator = 1268 chars
  ↓
  Base prompt has NO OwnPilot identity → model thinks it's Claude
```

### Why OpenCode Wouldn't Have This Bug

- **Layer 0** is model-specific — proper base prompt for each model
- **Layer 4** is file-based (`.opencode/agents/*.md`) — no DB empty-row problem
- **Layer 8** `chat.system.transform` — no plugin can accidentally override identity; conflicts are deterministic

---

## Production-Grade Solutions — 3 OpenCode Patents to Adapt

### Adaptation 1: Layer 0 Model-Specific Base Prompt

**Current:**
```typescript
// packages/gateway/src/routes/agent-prompt.ts
export const BASE_SYSTEM_PROMPT = `You are OwnPilot...` // single prompt, all providers
```

**Proposed:**
```typescript
// packages/gateway/src/prompts/ (NEW DIRECTORY)
// ├── anthropic.md    — For Claude (markdown formatted for prompt caching)
// ├── openai.md       — For GPT
// ├── gemini.md       — For Google
// ├── generic.md      — Others (MiniMax, DeepSeek, Groq, etc.)

function loadBasePrompt(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'anthropic.md',
    openai: 'openai.md',
    google: 'gemini.md',
  };
  const file = map[provider] || 'generic.md';
  return readFileSync(join(PROMPTS_DIR, file), 'utf-8');
}
```

**Benefit:** Identity drift cases (MiniMax claiming to be Claude) are resolvable because model-specific prompts can add assertions like "You are NOT Claude/Anthropic. You are OwnPilot."

### Adaptation 2: Layer 3 Incremental Discovery (OwnPilot-Specific)

OpenCode walks the filesystem (`read tool → parent dirs → AGENTS.md`).
OwnPilot's equivalent: **workspace-aware, query-driven memory injection**.

**Current:**
```typescript
// memory-injector.ts
// Session start loads all memories (max 10, importance-sorted)
// Even memories unrelated to the current question are in context
```

**Proposed — Query-Driven Memory Retrieval:**
```typescript
// NEW: packages/gateway/src/assistant/memory-lazy-inject.ts

async function lazyMemoryInject(
  userMessage: string,
  basePrompt: string
): Promise<string> {
  // 1. Embed user message (pgvector)
  const queryEmbedding = await embedder.embed(userMessage);

  // 2. Find top 5 semantically relevant memories
  const relevantMemories = await memoryRepo.searchByEmbedding(
    queryEmbedding,
    { limit: 5, threshold: 0.7 }
  );

  // 3. Inject only relevant ones — XML system-reminder format
  if (relevantMemories.length === 0) return basePrompt;

  return basePrompt + `\n\n<system-reminder source="memory-relevance">
Relevant context from your memory (retrieved based on current query):
${relevantMemories.map(m => `- ${m.content}`).join('\n')}
</system-reminder>`;
}
```

**Benefit:** Instead of injecting 10 memories every time, only relevant ones — token savings + improved signal/noise ratio.

### Adaptation 3: Layer 8 Plugin Hooks

**Current:** OwnPilot has a plugin system (`PluginRegistry`) but only for **tool registration**. No system prompt transform hooks.

**Proposed — 6 New Hook Types:**
```typescript
// packages/core/src/plugins/types.ts

export interface PluginHooks {
  // Existing:
  beforeToolCall?: (toolName: string, args: object) => object | void;
  afterToolCall?: (toolName: string, result: unknown) => unknown | void;

  // NEW — OpenCode inspired:
  transformSystemPrompt?: (prompt: string, context: RequestContext) => string;
  transformMessages?: (messages: Message[]) => Message[];
  transformParams?: (params: LLMParams) => LLMParams;
  transformToolDefinition?: (tool: ToolDefinition) => ToolDefinition;
  onCompacting?: (prompt: string) => string;

  // NEW — OwnPilot-specific:
  onAgentRoute?: (userIntent: string) => AgentType | null; // → Soul/Claw/Subagent routing!
}
```

**Application order (deterministic):**
```
BASE_PROMPT
  → [Plugin A.transformSystemPrompt]
  → [Plugin B.transformSystemPrompt]
  → buildEnhancedSystemPrompt (memories/goals)
  → ContextInjection middleware (extensions/skills)
  → [Plugin C.transformSystemPrompt]  // last chance override
  → LLM call
```

**Critical:** Plugin order must be determined by `priority` field (OpenCode has this too).

---

## 5 Immediate Optimizations

Quick wins identified during code review:

### Opt 1: `stripInjectedSections` Bug Fix (CRITICAL)

**Problem:** Middleware strips PromptComposer's rich content on every request.

**Fix:** `context-injection.ts:83` — update `stripInjectedSections` to strip only old **orchestrator** sections, preserving PromptComposer's base content.

```typescript
// BEFORE:
const basePrompt = stripInjectedSections(currentSystemPrompt);
// Strips ALL of "## User Context", "## Active Goals", "## Autonomy Level"

// AFTER:
const basePrompt = stripOrchestratorSections(currentSystemPrompt);
// Strips only orchestrator-added content (memories/goals/autonomy)
// PROMPTCOMPOSER's time_context, workspace, tools, user_profile PRESERVED
```

### Opt 2: Default Agent Seed Fix

**Problem:** `agents` table has Personal Assistant row with `system_prompt=""` (rollback/migration artifact).

**Fix — Migration approach:**
```sql
-- packages/gateway/src/db/migrations/postgres/028_seed_default_agent_prompt.sql
UPDATE agents
SET system_prompt = $BASE_SYSTEM_PROMPT
WHERE id = 'default' AND (system_prompt IS NULL OR system_prompt = '');
```

**Or better — runtime re-seed in `getOrCreateDefaultAgent`:**
```typescript
if (record && (!record.systemPrompt || record.systemPrompt.length < 100)) {
  record = await agentsRepo.update(defaultId, { systemPrompt: BASE_SYSTEM_PROMPT });
}
```

### Opt 3: Cache Restructure (OpenCode Layer 8b)

**Problem:** Anthropic prompt caching is half-done — time is hour-rounded but no `cache_control` markers.

**Fix:** `packages/core/src/agent/providers/anthropic-provider.ts`:
```typescript
// Split system prompt in two
const staticPart = prompt.split('## Current Context')[0];
const dynamicPart = '## Current Context' + prompt.split('## Current Context')[1];

const systemArray = [
  { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
  { type: 'text', text: dynamicPart } // not cached
];
```

**Benefit:** Instead of resending 8796-char prompt every request, static part gets a cache hit → ~75% token savings (per Anthropic documentation).

### Opt 4: MCP Instructions Lazy Load (OpenCode Layer 7)

**Problem:** OwnPilot aggressively injects MCP instructions into system prompt (Claude Code behavior). This bloats the prompt.

**Fix:** Move MCP instructions into tool descriptions. Keep only a summary of MCP server list in system prompt.

### Opt 5: Identity Assertion Guard (MiniMax/Claude Confusion)

**Problem:** MiniMax M2.7 and other Anthropic-compatible models identify as Claude.

**Fix:** Add a provider-aware identity assertion at the top of `BASE_SYSTEM_PROMPT`:
```typescript
function buildIdentityAssertion(provider: string, model: string): string {
  return `# Identity Assertion (CRITICAL)

You are **OwnPilot**, a privacy-first personal AI assistant.
You are NOT Claude. You are NOT ChatGPT. You are NOT Gemini.
You are running on the ${model} model via ${provider}, but your identity is OwnPilot.
Never claim to be made by Anthropic, OpenAI, or Google — regardless of your training base.

---
`;
}
```

This 5-minute fix deterministically resolves the "MiniMax thinks it's Claude" issue.

---

## Implementation Priority

### P0 — Critical Bug Fixes (immediate, 1 PR)

| # | Fix | Impact |
|---|-----|--------|
| 1 | `stripInjectedSections` fix (Opt 1) | Session identity inconsistency resolved |
| 2 | Default agent seed fix (Opt 2) | DB empty-prompt problem resolved |
| 3 | Identity assertion (Opt 5) | MiniMax Claude confusion resolved |

All three are interrelated and should ship together.

### P1 — Performance (1 week)

| # | Fix | Impact |
|---|-----|--------|
| 4 | Cache restructure (Opt 3) | ~75% token savings on Anthropic |
| 5 | Lazy memory injection (Adaptation 2) | Improved signal/noise + token savings |

### P2 — Architectural (1 month)

| # | Fix | Impact |
|---|-----|--------|
| 6 | Model-specific base prompts (Adaptation 1) | Reduces provider identity drift |
| 7 | Plugin hook system (Adaptation 3) | Enables third-party extensibility |
| 8 | MCP lazy load (Opt 4) | Reduces prompt bloat |

---

## Trade-offs & Risks

### Token Usage Analysis

Current pipeline cost per message (observed):
- PromptComposer output: 8796 chars (~2200 tokens)
- ContextInjection final: 1268 chars (~320 tokens) ← what actually reaches model
- **Net waste:** 7528 chars discarded → CPU cycle cost + potential confusion

After P0 fixes:
- PromptComposer output preserved through middleware: ~2200 tokens
- + Orchestrator suffix: ~260 tokens
- **Net prompt:** ~2460 tokens → proper identity, tools, profile all reach model

After P1 (cache restructure):
- First request: 2460 tokens
- Subsequent requests (cache hit): ~600 tokens (only dynamic dynamic parts)

### Backwards Compatibility

- **P0 fixes:** 100% backwards compatible — only fix bugs
- **P1 fixes:** Need migration for existing memory embeddings; cache markers are additive
- **P2 fixes:** Plugin hooks are opt-in (existing plugins unchanged); model-specific prompts have `generic.md` fallback

### Testing Requirements

- E2E test per provider: "Who are you?" must return OwnPilot identity in all cases
- System prompt byte-count guardrail: CI should fail if final prompt exceeds expected size (prevents accidental bloat)
- Cache hit rate monitoring: Track `cache_read_input_tokens` in usage logs

---

## References

- [OpenCode Agent Prompt Architecture](https://opencode.ai/docs/agents/) (external)
- [Anthropic Prompt Caching Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) (external)
- [AGENT_ECOSYSTEM.md](./AGENT_ECOSYSTEM.md) — Agent concepts overview
- [AGENTS.md](./AGENTS.md) — Core agent class reference
- `packages/gateway/src/services/middleware/context-injection.ts` — Where the bug lives
- `packages/core/src/agent/prompt-composer.ts` — PromptComposer (Layer 1)
- `packages/gateway/src/routes/agent-prompt.ts` — BASE_SYSTEM_PROMPT (Layer 0)

---

*Last updated: 2026-04-14*
*Authors: OwnPilot team + collaborative deep-dive session*
