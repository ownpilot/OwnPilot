# Context Graph + Hook Pipeline Architecture

> **Status:** Design proposal (2026-04-14)
> **Scope:** OwnPilot super-assistant chat / per-page chat / context budget management
> **Audience:** Architecture reviewers, next implementation session
> **Related docs:**
> - `AGENT_ECOSYSTEM.md` — agent type taxonomy
> - `INJECT_ARCHITECTURE_ANALYSIS.md` — current prompt injection pipeline (P0/P1/P2)
> - `PERSONAL_ASSISTANT_INJECTION_ROOT_CAUSE.md` — P0 fix root cause (v8.12)
> - `.claude/rules/page-contexts.md` — page-specific context templates (spec)
> - `.claude/rules/sidebar-chat.md` — sidebar chat rules (spec)

---

## 📍 Q1: Her sayfaya chat → her sayfa için agent mi?

**KESİN CEVAP: HAYIR. Tek Agent + Dinamik Page Context.**

Her sayfa için ayrı agent yaratmak = 64 agent x 137 tool registration x her açılışta prompt compose = token ve memory katliamı. Bunu kimse yapmıyor.

Production pattern (Cursor, Windsurf, Linear AI, Notion AI):

```
1 Agent (sabit identity + meta-tools)
    +
Dynamic Context Layer (page-scoped)
    +
Hook Pipeline (lazy context resolution)
```

OwnPilot'ta bu kısmen zaten var — `.claude/rules/page-contexts.md` dosyası bunu adresliyor. Ama eksik tarafı: context page'den otomatik pull edilmiyor, rule olarak duruyor. İlerisi: her sayfa chat'i açılırken bir `pageContextResolver(route, entityId)` çağrısı → sadece o sayfanın ilgili fragment'ını prompt'a kat.

---

## 📍 Q2: Hook-based lazy loading production grade mi?

**EVET — en production-grade yaklaşım bu. Hatta tek gerçekçi yol.**

| Yaklaşım | Token | Flexibility | Prod Grade | Örnek |
|----------|-------|-------------|------------|-------|
| Static prompt (hardcode all) | 50K+ | ❌ | ❌ Boğulur | Amatör |
| Per-page agent | 10K/agent × N | ❌ | ❌ Memory bombası | Yok |
| Per-page prompt injection (static) | 8-12K | ⚠️ | ⚠️ | Basic RAG |
| **Hook + RAG + Graph** | **3-6K dinamik** | ✅ | ✅ | Cursor, Windsurf, Claude Projects, Raycast AI |

Cursor nasıl yapıyor: `@codebase` query gelince → embedding search → top-K file retrieve → relevant symbols extract → prompt'a kat. Semantic + syntactic hybrid.

Windsurf Cascade: AST-aware context graph — edit yaptığın function'un caller/callee'larını otomatik prompt'a kat.

Claude Projects: Project files'i chunked RAG + otomatik relevant retrieval.

**Üçü de aynı felsefe:** "Sabit context minimal, dinamik context query-driven."

---

## 📍 Q3: Graph yapısı nasıl kurulur?

Bu sorunun cevabı = **Context Graph + Retrieval Chain**

Mantık: OwnPilot'taki her "şey" bir node, aralarındaki ilişkiler edge. Query geldiğinde graph'ta relevant subgraph'ı retrieve edip prompt'a inject.

### Önerilen Context Graph Modeli

**Entity Types (nodes):**

```
┌────────────────┐
│  Page          │ — /workflows/:id, /agents/:id, /claws
│  Workflow      │ — definition, nodes[], edges[]
│  WorkflowNode  │ — type (llm/claw/code/..), config, docs
│  Agent         │ — prompt, model, tools
│  Claw          │ — mission, status, history
│  Soul          │ — schedule, directive
│  Memory        │ — type (fact/pref/skill), content, tags
│  Skill         │ — name, description, snippet
│  Tool          │ — name, signature, docs
│  MCP Server    │ — name, tools[]
│  Channel       │ — type (wa/tg/discord), config
│  File          │ — path, hash, summary
│  Conversation  │ — messages, participants
└────────────────┘
```

**Edge Types:**

| Edge | Source → Target | Example |
|------|-----------------|---------|
| `uses` | Agent → Tool | default agent uses `core.add_task` |
| `calls` | WorkflowNode → Tool | LLM node calls a tool |
| `depends_on` | Claw → Skill | Claw depends on skill.code_review |
| `references` | Memory → Entity | memory about a specific workflow |
| `triggers` | Trigger → Agent/Claw/Workflow | cron trigger fires workflow |
| `produces` | Workflow → Artifact | workflow produces a report |
| `owns` | User → (Agent \| Claw \| Soul) | user owns their claws |
| `page_of` | Page → Entity | workflow page owns workflow |

### Hook Pipeline (UserPromptSubmit Protocol)

```
User message arrives
    ↓
┌───────────────────────────────────────────────────┐
│ Hook: pre-prompt-compose                          │
│ Context: { message, page, conversationId, userId }│
├───────────────────────────────────────────────────┤
│ Stage 1: Entity Resolver                          │
│   → Extract entities from message (regex + NER)   │
│   → Match with graph nodes (fuzzy + exact)        │
│   Output: resolvedEntities[]                      │
├───────────────────────────────────────────────────┤
│ Stage 2: Page Context Injector                    │
│   → route.pathname → PageContextResolver(...)     │
│   → Inject page entity + 1-hop neighbors          │
├───────────────────────────────────────────────────┤
│ Stage 3: Semantic Retriever                       │
│   → pgvector: embed(message) → top-K memories     │
│   → pg_trgm: fuzzy match skill/tool names         │
├───────────────────────────────────────────────────┤
│ Stage 4: Graph Traversal                          │
│   → For each resolvedEntity: BFS depth=2          │
│   → Collect 10-30 related nodes + deduplicate     │
├───────────────────────────────────────────────────┤
│ Stage 5: Budget Enforcer                          │
│   → priority-rank retrieved chunks                │
│   → fit into token budget (e.g. 3000 tokens)      │
│   → drop low-priority                             │
├───────────────────────────────────────────────────┤
│ Stage 6: Prompt Assembly                          │
│   → Sections: identity / page_context /           │
│               active_entities / memories /         │
│               tools_for_task / suggestions         │
└───────────────────────────────────────────────────┘
    ↓
Agent Execution (normal flow)
```

### Somut Örnek: Workflow Sayfasında "bu workflow'u optimize et"

```
Page: /workflows/wf_abc123
Message: "bu workflow'u optimize et"

Stage 1 (Entity Resolver):
  Page context → workflow: wf_abc123

Stage 2 (Page Context):
  Fetch: workflow.definition
  Subgraph: nodes[] (6 node), edges[] (7 edge)

Stage 4 (Graph Traversal, depth=1):
  For each node in workflow:
    - node.type → load tool_docs for that type only
    - node.config.toolId → load tool signature
  Drop: other 18 node types' docs (not used)

Stage 5 (Budget):
  Included: identity (400 tok) + workflow_def (600 tok) +
            6 node_type_docs (300 tok each = 1800) +
            related_memories (300 tok) = 3100 total
  Skipped: remaining 18 node types, agent ecosystem,
           claw management, soul management = ~6000 saved

Result: Agent ONLY sees the 6 node types it needs.
```

Bu exact pattern **LangChain RAG, LlamaIndex Graph RAG, Claude Projects, Cursor @codebase** hepsinin özü.

---

## 🏗️ OwnPilot'a Önerilen Implementation Yol Haritası

### Faz 0: Altyapı (prerequisite, 1 session)

- `context-graph-schema.sql` migration — 2 tablo: `graph_nodes`, `graph_edges` (polymorphic)
- `ContextGraphRepository` — insert/query/traverse
- Indeksler: `(node_type, ref_id)`, `(from_node, edge_type)`, pgvector on `node_embeddings`

### Faz 1: Hook Middleware (en yüksek ROI, 1 session)

- `context-injection.ts` refactor: mevcut middleware'i Hook Pipeline'a evir
- `HookRegistry`: `pre-prompt-compose` event tanımı
- 3 built-in hook: `pageContext`, `entityResolver`, `budgetEnforcer`

### Faz 2: Graph Populator (background, 1 session)

- Event-driven indexer: workflow/agent/claw/memory CRUD → graph'a mirror
- Embedding worker: node content → pgvector
- İlk seed: mevcut 6 workflow, 3 agent, 6 trigger, 3 plan graph'a at

### Faz 3: Retrieval Chain (her hook için 1 session)

- `semanticRetriever` (pgvector top-K)
- `graphTraversal` (BFS with budget)
- `pageContextResolver` (route → entity lookup)

### Faz 4: Super Assistant Tools (2-3 session)

- `soul-management-tools` (5 tool) — handoff Phase 2
- `workflow-management-tools` (6 tool)
- `fleet-management-tools` (4 tool)
- `mcp-management-tools` (4 tool)

### Faz 5: Context Graph UI (opsiyonel, 1 session)

- Debug panel: "bu mesaj için hangi context yüklendi?" → graph visualization
- Context preview before send

---

## 💎 Production-Grade Token Budget Önerisi

```
┌──────────────────────────────────────────┐
│ STATIC (always present) — ~1500 tokens   │
│ ├── Identity (OwnPilot + guard)          │
│ ├── Meta-tools (search/get_help/use)     │
│ ├── Response protocol (memories/suggs)   │
│ └── Top 20 critical tool names + sig     │
├──────────────────────────────────────────┤
│ DYNAMIC (hook-injected) — ~3000 tokens   │
│ ├── Page context (route-aware)           │
│ ├── Top-K relevant memories (pgvector)   │
│ ├── Entity-specific tool docs            │
│ ├── Active entity states (claws, etc.)   │
│ └── Recent conversation summary          │
├──────────────────────────────────────────┤
│ HISTORY (sliding window) — ~1500 tokens  │
│ └── Last N messages (summarized if >N)   │
└──────────────────────────────────────────┘
Total input: ~6000 tokens (MiniMax 204K limit = %3)
```

Bu sınır **MiniMax M2.7'nin 204K window'unun sadece %3'ü** — geri kalan %97 response + tool_call için elimizde. Şu anki 10K statik prompt bile %5. **Hedef: static'i 1.5K'ya indir, dynamic'i ihtiyaca göre 3-6K seviyesinde tut.**

---

## 🎯 En Yüksek ROI İlk Hamle

Senin sorunun özüne cevaben **ilk yapılacak iş:**

**Hook middleware'i refactor et + 3 hook implement et** (Faz 1).

Çünkü:

1. Mevcut `context-injection.ts` zaten var — extensible hale getirmek 1 gün iş
2. `page-contexts.md` ve `sidebar-chat.md` rule'ları zaten **spec**'i yazmış durumda
3. İlk hook: `pageContextResolver` — her sayfaya chat eklemek ZATEN bunu gerektiriyor
4. Sonraki hook'lar (memory retriever, entity resolver) aynı pipeline'a plug-in

Bu yapıldıktan sonra **her sayfaya chat** + **graph-based context** otomatik gelir. Agent hâlâ tek, ama her sayfada "doğru kılığa bürünmüş" gibi davranır.

---

## Pratik Başlangıç Önerisi

İstersen şu adımı atabilirim:

1. `context-injection.ts` mevcut halini oku → ne yapıyor tam göster
2. Hook pipeline prototype yaz → küçük bir PoC (page resolver hook)
3. Tek bir sayfada test et (örn. `/workflows/:id` → o workflow'u context'e kat)
4. Sonuçları ölç (token'ı ne kadar düşürdük, cevap kalitesi nasıl)

---

## Connections to Existing Work

- **P0 Fix (v8.12-systemprompt-fix, 2026-04-14):** The `agentInitialPrompt` propagation fix in `chat.ts` is the prerequisite for this architecture. Without that fix, the rich prompt never reaches the conversation, and hook injection would be meaningless.
- **`.claude/rules/page-contexts.md`:** This file already specifies per-route capabilities (Workflow / Agent / MCP / Extension / Custom Tools / Tools / File Workspace). It IS the spec for `pageContextResolver`. Implementation just needs to wire DB/API lookups into the hook pipeline.
- **`.claude/rules/sidebar-chat.md`:** Defines sidebar chat behavior and DB/API access patterns. Hook pipeline inherits these guarantees.
- **PromptComposer (`packages/core/src/agent/prompt-composer.ts`):** Currently composes base_prompt + tool_docs + time_context statically. Faz 1 refactor turns this into a hook-dispatcher.
- **ContextInjection middleware (`packages/gateway/src/services/middleware/context-injection.ts`):** Currently appends orchestrator section statically. Faz 1 refactor makes this the entry point for the hook pipeline.

---

*End of architecture proposal. Next session should start with Faz 1 (hook middleware refactor) for highest ROI.*
