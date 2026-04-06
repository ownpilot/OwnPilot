# Contextual Sidebar Chat — Architecture Design

> Date: 2026-04-06 | v2.0 Milestone
> Scope: Universal page-context-aware sidebar chat

---

## 1. Executive Summary

Her sayfada acilan sidebar chat, o sayfanin baglaminda calisacak — sayfa-specific agents, skills, memory, prompt, suggestions ve actions ile.

**Mevcut altyapi ZATEN %80 hazir:**
- `context-injection.ts` → memories, goals, extensions, skills, tools enjekte ediyor
- `RequestRouting` → intentHint, suggestedTools, relevantTables, relevantMcpServers
- Workflow Copilot → sayfa-specific AI asistan pattern'i (kanıtlanmış)

**Eksik %20:** Page context layer (UI → Gateway → System Prompt)

---

## 2. Mevcut Context Injection Pipeline

```
[Chat Request]
     │
     ▼
[request-preprocessor.ts]
  │  IntentClassification → routing decisions
  │  → relevantExtensionIds, suggestedTools, relevantTables, relevantMcpServers
  │
  ▼
[context-injection.ts] ← BURADA PAGE CONTEXT EKLENECEK
  │
  │  buildExtensionSections()     → ## Extension: ...
  │  buildSoulSkillsSection()     → ## Your Available Skills
  │  buildEnhancedSystemPrompt()  → ## User Context (memories), ## Active Goals
  │  buildToolSuggestionSection() → ## Suggested Tools
  │  buildDataHintSection()       → ## Available Data
  │  ❌ buildPageContextSection()  → EKSIK! Eklenmeli
  │
  ▼
[Final System Prompt]
  basePrompt
  + extensions + skills + orchestrator     (STATIC / cached)
  + ## Current Context (time)              (DYNAMIC)
  + ## Page Context ← YENİ                 (DYNAMIC / per-request)
  + tool suggestions + data hints + focus  (DYNAMIC)
```

---

## 3. Proposed Architecture: Page Context Registry

### 3.1 UI Side — Context Provider Hook

```typescript
// packages/ui/src/hooks/usePageCopilotContext.ts

interface PageCopilotContext {
  // Identity
  pageType: string;           // 'workspace' | 'workflow' | 'agent' | 'mcp-server' | ...
  entityId?: string;          // specific entity ID
  entityName?: string;        // display name

  // Context data (sent to gateway)
  contextData?: {
    path?: string;            // filesystem path (workspaces, coding-agents)
    definition?: object;      // workflow JSON, agent config, etc.
    tools?: string[];         // available tools for this context
    metadata?: Record<string, unknown>;
  };

  // UI-specific
  suggestions: string[];      // context-aware starter prompts
  actions: PageAction[];      // "Apply", "Create", "Run" buttons
  systemPromptHint?: string;  // extra instructions for the AI
}

interface PageAction {
  id: string;
  label: string;
  icon: ComponentType;
  handler: (aiOutput: unknown) => void;
}
```

### 3.2 Page Context Registry (UI)

```typescript
// packages/ui/src/constants/page-copilot-registry.ts

const PAGE_COPILOT_REGISTRY: Record<string, PageCopilotConfig> = {

  // ─── DATA PAGES ───

  'workspaces': {
    pageType: 'workspace',
    resolveContext: async (params) => {
      const ws = await fileWorkspacesApi.get(params.id);
      return { path: ws.path, metadata: { name: ws.name, fileCount: ws.fileCount } };
    },
    suggestions: [
      'Bu workspace\'teki dosyalari listele',
      'Proje yapisini analiz et',
      'README.md olustur',
      'Dependency\'leri kontrol et',
    ],
    actions: [
      { id: 'browse', label: 'Browse Files', handler: (output) => navigate(`/files?path=${output}`) },
    ],
    systemPromptHint: 'You are helping with a file workspace. You can browse files, analyze code, and suggest improvements.',
  },

  'workflows': {
    pageType: 'workflow',
    resolveContext: async (params) => {
      const wf = await workflowsApi.get(params.id);
      return { definition: wf.definition, metadata: { name: wf.name, nodeCount: wf.nodes?.length } };
    },
    suggestions: [
      'Bu workflow\'u optimize et',
      'Hata yonetimi ekle',
      'Yeni bir node ekle',
      'Workflow\'u acikla',
    ],
    actions: [
      { id: 'apply', label: 'Apply to Canvas', icon: Play, handler: (def) => onApplyWorkflow(def) },
    ],
    systemPromptHint: 'You are a workflow copilot. Generate workflow JSON definitions.',
    // NOT: Workflow sayfasinda zaten Copilot var — sidebar chat bunu TAMAMLAYICI olarak kullanir
  },

  // ─── AI PAGES ───

  'agents': {
    pageType: 'agent',
    resolveContext: async (params) => {
      const agent = await agentsApi.get(params.id);
      return { metadata: { name: agent.name, provider: agent.provider, systemPrompt: agent.systemPrompt } };
    },
    suggestions: [
      'Bu agent\'in system prompt\'unu gelistir',
      'Agent konfigurasyonunu optimize et',
      'Yeni tool ekle',
      'Test mesaji gonder',
    ],
    systemPromptHint: 'You are helping configure an AI agent. You can suggest prompt improvements, tool additions, and configuration changes.',
  },

  'claws': {
    pageType: 'claw',
    resolveContext: async (params) => {
      const claw = await clawsApi.get(params.id);
      return { path: claw.workspaceId, metadata: { name: claw.name, mode: claw.mode, state: claw.state } };
    },
    suggestions: [
      'Claw durumunu analiz et',
      'Mission\'i guncelle',
      'Son ciktiyi ozetle',
      'Claw\'u yeniden baslat',
    ],
    systemPromptHint: 'You are helping manage an autonomous Claw agent. You can view its state, history, and suggest mission updates.',
  },

  'coding-agents': {
    pageType: 'coding-agent',
    resolveContext: async (params) => {
      const session = await codingAgentsApi.getSession(params.id);
      return { path: session.cwd, metadata: { provider: session.provider, status: session.status } };
    },
    suggestions: [
      'Bu coding session\'in ciktisini ozetle',
      'Calisan dizini analiz et',
      'Session gecmisini goster',
    ],
    systemPromptHint: 'You are helping with a coding agent session. The agent is working in a specific directory.',
  },

  // ─── TOOLS PAGES ───

  'tools': {
    pageType: 'tool',
    resolveContext: async () => {
      const tools = await toolsApi.list();
      return { tools: tools.map(t => t.name), metadata: { count: tools.length } };
    },
    suggestions: [
      'Kullanilabilir tool\'lari listele',
      'X tool\'unu nasil kullanirim?',
      'Bir tool zinciri olustur',
    ],
    systemPromptHint: 'You are helping the user discover and use available tools.',
  },

  'custom-tools': {
    pageType: 'custom-tool',
    resolveContext: async (params) => {
      if (params.id) {
        const ext = await customToolsApi.get(params.id);
        return { metadata: { name: ext.name, code: ext.code, type: ext.type } };
      }
      return {};
    },
    suggestions: [
      'Yeni bir custom tool olustur',
      'Bu tool\'un kodunu gelistir',
      'Tool\'u test et',
      'Hata ayiklama yap',
    ],
    actions: [
      { id: 'apply-code', label: 'Apply Code', handler: (code) => updateExtensionCode(code) },
    ],
    systemPromptHint: 'You are helping create and edit custom tools (user extensions). You can generate JavaScript/TypeScript code for tool implementations.',
  },

  'skills': {
    pageType: 'skill',
    resolveContext: async (params) => {
      if (params.id) {
        const skill = await extensionsApi.get(params.id);
        return { metadata: { name: skill.name, format: skill.format, tools: skill.manifest?.tools } };
      }
      return {};
    },
    suggestions: [
      'Yeni bir skill olustur',
      'SKILL.md formatini acikla',
      'Skill\'i agent\'a bagla',
      'Marketplace\'de benzer skill ara',
    ],
    systemPromptHint: 'You are helping manage AI skills (AgentSkills.io format). You can create SKILL.md files, configure skill tools, and connect skills to agents.',
  },

  // ─── SYSTEM PAGES ───

  'mcp-servers': {
    pageType: 'mcp-server',
    resolveContext: async () => {
      const servers = await mcpApi.list();
      return { metadata: { servers: servers.map(s => ({ name: s.name, status: s.status })) } };
    },
    suggestions: [
      'MCP server durumlarini kontrol et',
      'Yeni MCP server ekle',
      'Server tool\'larini listele',
      'Baglanti sorunlarini teshis et',
    ],
    systemPromptHint: 'You are helping manage MCP (Model Context Protocol) servers. You can check server status, list tools, and diagnose connection issues.',
  },

  'edge-devices': {
    pageType: 'edge-device',
    resolveContext: async () => {
      const devices = await edgeApi.list();
      return { metadata: { devices: devices.map(d => ({ name: d.name, status: d.status })) } };
    },
    suggestions: [
      'Bagli cihazlari listele',
      'Cihaz durumunu kontrol et',
      'MQTT topic\'lerini goster',
    ],
    systemPromptHint: 'You are helping manage edge/IoT devices connected via MQTT.',
  },

  // ─── PERSONAL PAGES (generic — no specific context) ───

  'tasks': { pageType: 'tasks', suggestions: ['Gorevlerimi ozetle', 'Yeni gorev olustur', 'Oncelik sirala'] },
  'notes': { pageType: 'notes', suggestions: ['Notlarimi ara', 'Yeni not olustur', 'Notlari ozetle'] },
  'goals': { pageType: 'goals', suggestions: ['Hedef ilerlememi goster', 'Yeni hedef belirle'] },
  'habits': { pageType: 'habits', suggestions: ['Aliskanlik istatistiklerimi goster', 'Yeni aliskanlik ekle'] },
  'memories': { pageType: 'memories', suggestions: ['Memory ara', 'Son hatirlananlar'] },
};
```

### 3.3 Gateway Side — Page Context Section Builder

```typescript
// packages/gateway/src/services/middleware/page-context-injection.ts

interface PageContext {
  pageType: string;
  entityId?: string;
  path?: string;
  contextData?: Record<string, unknown>;
  systemPromptHint?: string;
}

function buildPageContextSection(pageContext: PageContext | undefined): string {
  if (!pageContext?.pageType) return '';

  const parts: string[] = [];
  parts.push(`## Page Context`);
  parts.push(`The user is currently viewing: **${pageContext.pageType}**`);

  if (pageContext.entityId) {
    parts.push(`Entity ID: ${pageContext.entityId}`);
  }

  if (pageContext.path) {
    parts.push(`Working directory: \`${pageContext.path}\``);
  }

  if (pageContext.contextData) {
    // Inject entity-specific data (workflow def, agent config, etc.)
    parts.push(`\nContext data:\n\`\`\`json\n${JSON.stringify(pageContext.contextData, null, 2)}\n\`\`\``);
  }

  if (pageContext.systemPromptHint) {
    parts.push(`\n${pageContext.systemPromptHint}`);
  }

  return '\n\n' + parts.join('\n');
}
```

### 3.4 Integration into Existing Pipeline

```
context-injection.ts (MODIFIED):

  // Existing sections (unchanged)
  const extensionSuffix = buildExtensionSections(ctx);
  const skillsSuffix = await buildSoulSkillsSection(agentId);

  // NEW: Page context section
  const pageContext = ctx.get<PageContext>('pageContext');
  const pageContextSuffix = buildPageContextSection(pageContext);

  // Existing dynamic sections
  const toolSuggestionSuffix = buildToolSuggestionSection(routing);
  const dataHintSuffix = buildDataHintSection(routing);

  // Final prompt assembly (pageContext goes in DYNAMIC block)
  const finalPrompt = basePrompt
    + extensionSuffix + skillsSuffix + orchestratorSuffix   // STATIC
    + freshTimeContext + afterTimeContext                     // DYNAMIC start
    + pageContextSuffix                                      // NEW: Page context
    + toolSuggestionSuffix + dataHintSuffix + focusSuffix;  // DYNAMIC end
```

---

## 4. Data Flow (Complete)

```
┌─────────────────────────────────┐
│  UI: StatsPanel Chat Tab        │
│                                 │
│  usePageCopilotContext()        │
│    ↓ reads route params         │
│    ↓ resolves from registry     │
│    ↓ fetches entity data        │
│                                 │
│  Sends to gateway:              │
│  POST /api/v1/chat              │
│  body: {                        │
│    message: "...",              │
│    pageContext: {               │
│      pageType: "workspace",    │
│      entityId: "ws_abc",       │
│      path: "/home/ayaz/proj",  │
│      contextData: {...},       │
│      systemPromptHint: "..."   │
│    }                           │
│  }                             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Gateway: chat.ts route         │
│                                 │
│  Extracts pageContext from body │
│  ctx.set('pageContext', body.   │
│          pageContext)           │
│                                 │
│  If pageContext.path exists AND │
│  provider is bridge:            │
│    → inject X-Project-Dir      │
│                                 │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Gateway: context-injection     │
│                                 │
│  buildPageContextSection()      │
│    → "## Page Context"          │
│    → pageType, entityId, path   │
│    → contextData (JSON)         │
│    → systemPromptHint           │
│                                 │
│  Injected into system prompt    │
│  alongside existing sections    │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  LLM / Bridge                   │
│                                 │
│  AI receives enriched prompt:   │
│  - Base prompt                  │
│  - Extensions + Skills          │
│  - Memories + Goals             │
│  - ## Page Context ← NEW        │
│  - Tool suggestions             │
│  - Data hints                   │
│                                 │
│  AI responds with page-aware    │
│  context (knows which page,     │
│  which entity, which directory) │
└─────────────────────────────────┘
```

---

## 5. Workflow Copilot Pattern Comparison

| Aspect | Workflow Copilot (mevcut) | Universal Contextual Chat (yeni) |
|--------|--------------------------|----------------------------------|
| **Scope** | Sadece workflow sayfasi | TUM sayfalar |
| **LLM cagrisi** | Direkt provider API (gateway) | Chat pipeline (bridge + context injection) |
| **State** | Local useState (bagimsiz) | Dedicated SidebarChatStore (Phase 16 onerisi) |
| **System prompt** | 600 satir static + current workflow | Mevcut chat prompt + ## Page Context section |
| **Actions** | "Apply to Canvas" | Sayfa-bazli (Apply, Create, Run, Browse) |
| **Suggestions** | 30 hardcoded + shuffle | Registry-based per-page |
| **Streaming** | SSE via workflowsApi.copilot() | SSE via useChatStore (veya dedicated store) |

**Key insight:** Workflow Copilot AYRI bir endpoint kullaniyor (`/workflows/copilot`). Universal contextual chat ise MEVCUT chat pipeline'ini kullaniyor — sadece `pageContext` ekleniyor. Bu cok daha guclu cunku bridge uzerinden CLI spawn edebilir (dosya okuma, kod yazma, terminal).

---

## 6. Implementation Plan (Phase Order)

### Phase A: Page Context Registry (UI)
- `usePageCopilotContext.ts` hook
- `page-copilot-registry.ts` config
- Route → context resolution
- Context-aware suggestions

### Phase B: Gateway Page Context Injection
- `buildPageContextSection()` function
- `pageContext` field in chat request body
- Integration into context-injection.ts
- Validation schema update

### Phase C: Dedicated SidebarChatStore
- Phase 16 research onerisi: Alternative D
- Separate store for sidebar chat
- Independent session management
- Context change → new conversation

### Phase D: Sidebar Chat UI Enhancement
- Suggestions from registry
- Action buttons per context
- Context banner improvements
- Streaming cancel (AbortController)

### Phase E: Bridge Directory Routing
- Gateway X-Project-Dir forwarding
- Docker path mapping (OWNPILOT_HOST_FS)
- Bridge path validation (existing)

### Phase F: Per-Page Copilot Prompts
- Workspace copilot prompt
- Agent configuration copilot prompt
- Tool/Extension copilot prompt
- MCP server copilot prompt

---

## 7. Cross-Reference: Existing Infrastructure Reuse

| Needed | Already Exists | Where |
|--------|---------------|-------|
| System prompt injection | context-injection.ts | gateway middleware |
| Extension/skill injection | buildExtensionSections() | context-injection.ts |
| Memory/goal injection | buildEnhancedSystemPrompt() | assistant/index.ts |
| Tool suggestions | buildToolSuggestionSection() | context-injection.ts |
| Data hints | buildDataHintSection() | context-injection.ts |
| Prompt caching | Anthropic cache split | context-injection.ts |
| SSE streaming | useChatStore.sendMessage() | UI hook |
| Bridge CWD routing | spawn({ cwd: projectDir }) | all 4 runtimes |
| Path validation | validateProjectDir() | bridge routes.ts |
| Action buttons | "Apply to Canvas" pattern | WorkflowCopilotPanel |
| Suggestions | SuggestionsList component | WorkflowCopilotPanel |
| Sidebar chat UI | CompactChat (Phase 13) | StatsPanel.tsx |

**%80 mevcut altyapi yeniden kullaniliyor. Sadece "## Page Context" section builder + UI registry eklenmesi gerekiyor.**

---

## 8. Workflow Copilot Deep Analysis (Pattern Reference)

### Architecture

```
WorkflowCopilotPanel (UI, 1113 LOC)
  │  w-96, sag panel, border-l, flex-col
  │  State: useState<CopilotMessage[]> (LOCAL — global store degil!)
  │
  │  workflowsApi.copilot() → stream()
  ▼
POST /workflows/copilot (gateway, SSE streaming)
  │  resolveProviderAndModel() → kullanicinin ayarli provider/model
  │  createProvider() → dogrudan LLM API cagrisi (bridge degil!)
  │  buildCopilotSystemPrompt() → 600 satir static prompt
  │    ↳ 24 node type dokumantasyonu
  │    ↳ mevcut workflow JSON (varsa)
  │    ↳ 230 available tool name listesi
  │    ↳ workflow template ideas (inspiration)
  │
  │  provider.stream() → SSE chunks
  ▼
UI: delta → streamingContent → done → extractWorkflowJson()
  │  JSON code block'tan workflow parse
  │  "Apply to Canvas" butonu → onApplyWorkflow()
  │  convertDefinitionToReactFlow() → ReactFlow nodes/edges
```

### Key Patterns from Copilot

| Pattern | Detail | Reuse for Contextual Chat |
|---------|--------|---------------------------|
| Local state (not global store) | useState<CopilotMessage[]> | YES → SidebarChatStore |
| SSE streaming + AbortController | abort.current?.abort() + stop button | YES → streaming cancel |
| JSON extraction from response | extractWorkflowJson() regex | ADAPT → per-page action extraction |
| Action button on AI output | "Apply to Canvas" button | YES → per-page actions |
| 30+ suggestions + shuffle | SuggestionsList + pickRandom() | YES → per-page suggestions |
| Context injection via prompt | buildCopilotSystemPrompt(currentWorkflow) | YES → buildPageContextSection() |
| Tool name resolver | buildToolNameResolver() fuzzy matching | MAYBE → tool page copilot |
| MarkdownContent rendering | <MarkdownContent content={} compact /> | YES → replace plain text bubbles |

### Files Reference

| File | LOC | Purpose |
|------|-----|---------|
| packages/ui/src/components/workflows/WorkflowCopilotPanel.tsx | 1113 | UI panel + JSON converter |
| packages/gateway/src/routes/workflow-copilot.ts | 147 | SSE streaming endpoint |
| packages/gateway/src/routes/workflow-copilot-prompt.ts | 657 | System prompt (24 node types) |
| packages/gateway/src/routes/workflow-template-ideas.ts | ~200 | Suggestion templates |

---

## 9. Web Research: CLI Tool Comparison (External Sources)

### Claude Code CLI
- **No `--cwd` flag** — Feature request #26287 closed as NOT_PLANNED (2026-03-18)
- Duplicate issues: #750, #1628, #3473, #15075, #36937
- SDK supports `cwd` option: `ClaudeAgentOptions(cwd="/path")`
- Security: blocks `cd` to parent/sibling directories
- Project root: walks up from CWD looking for `.claude/`
- Docs: https://platform.claude.com/docs/en/agent-sdk/claude-code-features

### OpenAI Codex CLI
- **`--cd` / `-C` flag** — sets working directory before agent starts
- `--add-dir <path>` — grants additional writable directories
- Sandbox: **Landlock + seccomp on Linux (ON by default)** — only CLI with default sandbox
- Requires Git repository by default (override: `--skip-git-repo-check`)
- Docs: https://developers.openai.com/codex/cli/reference

### Google Gemini CLI
- **No `--cwd` flag** — runtime `/directory add` command only
- `--include-directories` flag reportedly broken (#13669)
- 5 sandbox modes: macOS Seatbelt, Docker/Podman, Windows, gVisor, LXC
- Project context: GEMINI.md hierarchy (like CLAUDE.md)
- Docs: https://geminicli.com/docs/reference/commands/

### OpenCode CLI
- `--cwd` for ACP server mode, `--dir` for TUI attach
- ACP: `session/new` requires `cwd` parameter
- Session routing: walks up from CWD to nearest git root
- Docs: https://opencode.ai/docs/cli/

### Aider
- **No `--cwd` flag** — uses shell CWD
- `--subtree-only` restricts scope to current subtree
- Shell commands CWD = git repo root
- Docs: https://aider.chat/docs/config/options.html

### ACP (Agent Client Protocol) — Emerging Standard
- Supported by: OpenCode, Gemini CLI, Claude Code (adopting), Codex (adopting)
- `session/new` requires `cwd` parameter — standardized
- JetBrains, Zed editors adopting
- Source: https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/

### Multi-Runtime Orchestrators
- **Overstory** (github.com/jayminwest/overstory): 11 runtime support, git worktree isolation
- **pi-builder**: TypeScript monorepo, capability-based routing, SQLite persistence
- **Composio Agent Orchestrator**: Plans tasks, spawns agents, handles CI fixes

### Security CVEs (Directory Routing)
- CVE-2025-53109/53110: MCP Filesystem Server symlink bypass → read /etc/sudoers
- CVE-2025-68143/44/45: Anthropic Git MCP Server path traversal + argument injection → RCE
- CVE-2026-20669: Agent Safehouse improved macOS directory path validation
- Claude Code Bubblewrap escape: /proc/self/root bypass to disable sandbox

---

## 10. Behavior Scenarios (UX Reference)

### Scenario 1: Workspace Page (PATH VAR)
```
URL: /workspaces?id=ws_abc
Context: { pageType: 'workspace', path: '/home/ayaz/projects/myproject' }
Provider: Bridge (auto — path var)
Bridge CWD: /home/ayaz/projects/myproject
AI: dosya erisimi, git, terminal — GUCLU
```

### Scenario 2: Page Navigation (Context Change)
```
/workspaces → /workflows/wf_xyz
Sidebar chat: SIFIRLANIR (messages=[], conversationId=null)
Yeni context: { pageType: 'workflow', definition: {...} }
Yeni suggestions: workflow-specific
Eski konusmalar: /chat gecmisinde hala mevcut
```

### Scenario 3: Same Page Multiple Messages
```
Mesaj 1: pageContext gonderilir + yeni conversationId olusur
Mesaj 2-N: ayni conversationId devam — session-based context
Bridge: ayni session, ayni CWD, onceki context hatirlanir
```

### Scenario 4: No-Path Page (Tools, Notes)
```
URL: /tools
Context: { pageType: 'tools', contextData: { tools: [...230] } }
Provider: LLM API (auto — path yok)
Bridge: SPAWN YOK — direkt LLM call
AI: tool listesini bilir (system prompt'tan), dosya erisimi YOK
```

### Scenario 5: MCP Servers Page
```
URL: /settings/mcp-servers
Context: { pageType: 'mcp-server', contextData: { servers: [...] } }
Provider: LLM API (auto)
AI: server durumlarini bilir, diagnostik yapabilir, dosya erisimi YOK
```

### Session-Based pageContext Decision
```
ILK MESAJ:    pageContext gonderilir → gateway KAYEDER (conversationId bazli)
SONRAKILER:   pageContext GONDERILMEZ → gateway kayitlidan yukler
CONTEXT DEGISIMI: yeni conversationId → pageContext TEKRAR gonderilir
```

---

## 11. Docker Bind Mount Strategy

### Deployment Config
```yaml
services:
  ownpilot:
    volumes:
      - /home/ayaz:/host-home:rw        # Full home access (Profile 1)
    environment:
      - OWNPILOT_HOST_FS=/host-home          # Container mount point
      - OWNPILOT_HOST_FS_HOST_PREFIX=/home/ayaz  # Host path prefix
```

### Path Mapping Flow
```
Container: /host-home/projects/myproject  ← gateway gorunur (bind mount)
Host:      /home/ayaz/projects/myproject  ← bridge/CLI gorunur

Donusum: containerPath.replace(HOST_FS, HOST_PREFIX) = hostPath
  /host-home/projects/x → /home/ayaz/projects/x
```

### Reference Doc: HOST-FILESYSTEM-ACCESS.md
3 security profile documented (Profile 1: Full, 2: Selective, 3: Read-Only)
OWNPILOT_HOST_FS + OWNPILOT_HOST_FS_LABEL env vars
Currently NOT IMPLEMENTED — Phase 20 will activate
