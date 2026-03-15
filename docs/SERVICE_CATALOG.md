# OwnPilot Service Catalog

> **91 services** in `packages/gateway/src/services/` + 7 workflow + 7 middleware
> Last updated: 2026-03-15 (v0.2.1)

## How to Read This

Each service is listed with:
- **Lines**: Source code size (excluding tests)
- **Responsibility**: What it does
- **Depends on**: Key dependencies
- **Quality**: Current health assessment

Quality ratings:
- OK = Clean, well-structured
- REFACTORED = Recently improved this session
- NEEDS WORK = Known issues documented

---

## 1. AI Chat & Model Routing

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `model-routing` | 296 | Resolves AI provider + model from settings with multi-level fallback waterfall (per-agent, per-channel, per-process, global default). Central routing for all AI calls. |
| `provider-service-impl` | 118 | IProviderService implementation. Wraps provider configs, API key lookup, base URL resolution. |
| `config-center-impl` | 122 | ConfigCenter interface backed by PostgreSQL config_services tables with in-memory cache. Single source of truth for all API keys and service configs. |
| `config-tools` | 322 | AI tools for managing config entries (get/set/list). Allows the agent to read and modify settings. |
| `api-service-registrar` | 53 | Auto-registers tool config requirements in Config Center when tools declare needed services. |
| `cli-chat-provider` | 815 | IProvider implementation using installed CLI tools (Claude Code, Codex, Gemini CLI) as chat backends. Enables using CLI subscriptions without API keys. |
| `cli-chat-parsers` | 280 | Output parsers and arg builders for each CLI (3 parsers, 3 builders). Pure functions, independently testable. |
| `cli-tool-bridge` | 586 | Enables tool calling through CLI prompt engineering. Injects tool definitions into prompts, parses structured responses back. |

**Quality**: All OK. `cli-chat-provider` was REFACTORED (815 from 1116 — parsers extracted).

---

## 2. Autonomous Agent System

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `background-agent-manager` | 834 | Lifecycle manager for background agents: scheduling (continuous, interval, event, immediate), cycle execution, rate limiting, budget enforcement, session persistence. |
| `background-agent-runner` | 240 | Executes a single background agent cycle: resolve provider, create agent, run chat, extract results. Uses shared `executeAgentPipeline()`. |
| `background-agent-service` | 211 | Gateway facade for background agent system. CRUD + start/stop/pause API. |
| `agent-runner-utils` | 414 | Shared utilities for all runners: `registerAllToolSources()`, `createConfiguredAgent()`, `resolveProviderAndModel()`, `executeAgentPipeline()`, `createToolCallCollector()`, `resolveToolFilter()`, `calculateExecutionCost()`, `createCancellationPromise()`. |
| `agent-registry` | 137 | DB-backed agent config registry. Maps agent names to configs (system prompt, preferred model). |

**Quality**: REFACTORED. `executeAgentPipeline()` unified across 3 runners. Manager is large (834 lines) but well-organized.

---

## 3. Subagent System

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `subagent-manager` | 455 | Manages subagent sessions: spawn, cancel, track, cleanup. Handles background execution with event emission. |
| `subagent-runner` | 269 | Single-task subagent execution with cancellation support via AbortController. Uses shared `executeAgentPipeline()`. |
| `subagent-service` | 82 | Thin facade combining SubagentManager (sessions) + SubagentRunner (execution). |

**Quality**: OK. Runner REFACTORED to use shared pipeline.

---

## 4. Fleet Command

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `fleet-manager` | 747 | Multi-worker task orchestration: task queue, dependency DAG, worker assignment, shared context, crash recovery, cron scheduling. |
| `fleet-worker` | 491 | 4-type task executor: `ai-chat` (full Agent), `coding-cli` (orchestration), `api-call` (direct provider), `mcp-bridge` (MCP tool calls). |
| `fleet-service` | 239 | Gateway facade for Fleet Command. Session CRUD + task management API. |

**Quality**: OK. `ai-chat` executor REFACTORED to use shared pipeline.

---

## 5. Coding Agents

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `coding-agent-service` | 633 | Main entry: task execution, PTY fallback, session creation, ACP support, status reporting. |
| `coding-agent-sessions` | 924 | Session manager: ACP + PTY modes, output buffering (100KB ring), WS subscriber management, completion callbacks, graceful shutdown. |
| `coding-agent-orchestrator` | 550 | Multi-step CLI orchestration: spawn → poll → analyze output → decide next step → repeat. |
| `coding-agent-providers` | 364 | Provider detection/config for Claude Code, Codex, Gemini CLI. Binary detection, version checks. |
| `coding-agent-pty` | 417 | PTY adapter: `spawnStreamingPty()` (node-pty) and `spawnStreamingProcess()` (child_process) with output streaming. |

**Quality**: OK. Sessions (924 lines) is large but well-organized internally — ACP/PTY concerns share ManagedSession state.

---

## 6. Soul Agents & Orchestra

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `soul-heartbeat-service` | 432 | Bridge core HeartbeatRunner to gateway repos. Crew context injection, tool filtering, agent engine factory. |
| `heartbeat-service` | 339 | Heartbeat CRUD + schedule management (NL-to-cron). Trigger synchronization. |
| `heartbeat-parser` | 338 | Natural language schedule parsing: "every weekday at 9am" → cron expression. |
| `heartbeat-context` | 37 | AsyncLocalStorage for threading soul agentId through tool calls during heartbeat cycles. |
| `orchestra-engine` | 590 | Multi-agent plan execution: sequential, parallel, DAG strategies. Spawns subagents per task, manages dependencies. |

**Quality**: OK. Well-structured — strategies are clean private methods.

---

## 7. Personal Data Services

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `goal-service` | 299 | Goals CRUD + step decomposition + statistics. Clean domain service. |
| `plan-service` | 276 | Plans CRUD + step management + history logging. Clean domain service. |
| `memory-service` | 479 | Memories CRUD + embedding search + hybrid search + chunking. Coordinates with EmbeddingService. |
| `custom-data-service` | 356 | Dynamic schema tables + records. Plugin ownership, protection flags, JSONB filtering. |
| `trigger-service` | 221 | Trigger CRUD + execution tracking. Delegates scheduling to TriggerEngine. |
| `conversation-service` | 334 | Chat persistence: conversation lifecycle, message saving, WS broadcast. Post-processing extracted to `chat-post-processor.ts`. |
| `notification-router` | 235 | Route notifications across channels. In-memory preference storage (should be DB). |

**Quality**: All OK. `conversation-service` REFACTORED (post-processing extracted). `notification-router` has known issue: in-memory preferences.

---

## 8. Tools & Execution

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `tool-executor` | 590 | Central tool registry: 5 registration subsystems (core, plugins, custom, extensions, MCP). Tool execution with permission checking and audit logging. |
| `tool-permission-service` | 256 | Permission checks: tool group enables, CLI policies, extension permissions, custom tool approval. |
| `tool-service-impl` | 120 | IToolService implementation wrapping tool-executor. |
| `tool-source` | 379 | View source code of any tool (core or custom). File reading, AST extraction, caching. |
| `custom-tool-registry` | 158 | DynamicToolRegistry for user-created JS tools. Sandbox execution, global state management. |
| `execution-approval` | 66 | Approval request/response lifecycle for tool execution gating. |
| `permission-utils` | 48 | ToolExecContext type, permission downgrade helpers. |

**Quality**: REFACTORED. `tool-executor` deduplicated (590 from 646). `registerSingleExtensionTool()` extracted.

---

## 9. CLI Tool System

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `cli-tool-service` | 303 | CLI tool discovery + execution + policy enforcement. Manages allowlists. |
| `cli-tools-catalog` | 399 | Available CLI tool definitions (static catalog of known tools). |
| `cli-tools-discovery` | 131 | Scan system for installed CLI tools (binary detection). |
| `binary-utils` | 224 | CLI binary detection, sanitized env creation, process spawning utilities. |

**Quality**: OK.

---

## 10. Extensions & Skills

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `extension-service` | 668 | Install/enable/disable/uninstall/reload extensions. Manifest parsing (JSON, MD, SKILL.md). Config Center registration, security audit. |
| `extension-trigger-manager` | 112 | Extension trigger lifecycle: activate on enable, deactivate on disable, orphan cleanup. |
| `extension-scanner` | 143 | Directory scanning for extension manifests. Path resolution (bundled, data dir, workspace). |
| `extension-sandbox` | 395 | Worker-thread sandbox for extension code execution. Permission-gated `callTool` handler. |
| `extension-permissions` | 212 | Permission checker: maps tool names to permission groups, validates extension grants. |
| `extension-markdown` | 604 | Extension markdown format parser & serializer. |
| `extension-types` | 403 | ExtensionManifest types, validation functions, SkillPermission type. |
| `skill-security-audit` | 481 | Static analysis: detect dangerous patterns in extension code (eval, exec, fetch, fs). |
| `skill-npm-installer` | 331 | npm package installer for AgentSkills.io skills. |
| `agentskills-parser` | 353 | SKILL.md format parser (AgentSkills.io open standard). |

**Quality**: REFACTORED. `extension-service` split (668 from 858). Trigger manager + scanner extracted.

---

## 11. MCP (Model Context Protocol)

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `mcp-client-service` | 410 | Connect to external MCP servers, register their tools in shared registry. Auto-reconnect, health monitoring. |
| `mcp-server-service` | 401 | Expose OwnPilot's 250+ tools AS an MCP server. Session management with 30-min TTL. |

**Quality**: OK.

---

## 12. AI Capabilities (Media & Web)

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `email-overrides` | 815 | Real SMTP/IMAP email executors replacing core stubs. Send, read, search emails. Config Center integration. |
| `image-overrides` | 646 | Image analysis (vision API) + generation (DALL-E, Stability, FAL). Multi-provider support. |
| `audio-overrides` | 602 | TTS (OpenAI/ElevenLabs), STT (Whisper), audio translate, FFmpeg split. |
| `voice-service` | 188 | Voice synthesis wrapper over audio-overrides. |
| `browser-service` | 613 | Headless Playwright browser: navigate, click, type, screenshot, extract. PII detection on form fills. |
| `embedding-service` | 260 | OpenAI embedding API wrapper. Model selection, dimension configuration. |
| `embedding-queue` | 255 | Priority queue for background embedding generation. Dedup, batch processing. |
| `composio-service` | 315 | Composio SDK wrapper. App discovery with 1-hour cache, tool execution. |

**Quality**: OK. Override services have similar patterns but are domain-specific enough to stay separate.

---

## 13. Edge/IoT

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `edge-service` | 260 | Edge device CRUD + MQTT coordination. Telemetry ingestion, status tracking. |
| `edge-mqtt-client` | 309 | MQTT broker (Mosquitto) connection. Pub/sub for edge device communication. |

**Quality**: OK.

---

## 14. Dashboard & Monitoring

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `dashboard-briefing` | 384 | AI-generated daily briefing. Cache with hash-based invalidation, prompt building, fallback generation. |
| `dashboard-types` | 130 | TypeScript types for DailyBriefingData, AIBriefing, etc. |
| `security-scanner` | 727 | Unified security scan: extensions, custom tools, triggers, CLI tools. Risk scoring. |

**Quality**: OK.

---

## 15. Infrastructure

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `log` | 10 | Re-export of `getLog()` from @ownpilot/core. |
| `log-service-impl` | 114 | LogService implementation. JSON (production) or colored text (dev) output. |
| `audit-service-impl` | 106 | Audit trail logger implementation. |
| `session-service-impl` | 218 | Session lifecycle: CRUD, channel index, auto-cleanup interval. |
| `ui-session` | 206 | UI WebSocket session management. Chat state, typing indicators. |
| `message-bus-impl` | 227 | Middleware-based message processing pipeline. Named middleware chain. |
| `resource-registry` | 225 | Named resource registry (key-value store for services). |
| `resource-service-impl` | 72 | Pass-through adapter for resource registry. |
| `plugin-service-impl` | 94 | Plugin lifecycle management. |
| `workspace-service-impl` | 125 | Workspace CRUD operations. |
| `pairing-service` | 213 | Channel ownership via rotating one-time pairing keys. Pretty-prints setup banner to CLI. |
| `local-discovery` | 378 | Discover local AI providers (Ollama, LM Studio, etc.) via network scanning. |
| `channel-asset-store` | 145 | Media/file storage for channel messages. |
| `service-helpers` | 23 | Registry access helpers. |
| `model-routing` | 296 | (Listed in AI Chat section above) |

**Quality**: OK.

---

## 16. Utilities

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `chunking` | 139 | Markdown-aware text chunking for embedding. Heading-based hierarchy. |
| `artifact-service` | 117 | AI artifact CRUD + WS broadcast. |
| `artifact-data-resolver` | 182 | Data binding for artifact templates. Resolves {{tasks}}, {{goals}} etc. |

**Quality**: OK.

---

## 17. Workflow Engine (`services/workflow/`)

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `workflow-service` | ~1200 | DAG execution engine: topological sort, level-by-level parallel execution, 23 node type dispatch, approval pause/resume, sub-workflow recursion. |
| `node-executors` | ~1100 | 23 node executor functions (LLM, condition, code, HTTP, delay, switch, etc.). |
| `foreach-executor` | ~350 | ForEach node: array iteration with body graph execution per item. |
| `dag-utils` | ~200 | Topological sort, downstream node resolution, forEach body detection. |
| `template-resolver` | ~175 | `{{node.output}}` template resolution between workflow nodes. |
| `types` | ~50 | WorkflowProgressEvent types. |

**Quality**: REFACTORED. `dispatchNode()` centralized — eliminates ~500 lines of dispatch duplication.

---

## 18. Middleware (`services/middleware/`)

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `agent-execution` | ~350 | Core chat middleware: runs Agent.chat() with tool callbacks, streaming support. |
| `context-injection` | ~500 | Injects memories, goals, extension prompts, skill context into system prompt per-request. |
| `request-preprocessor` | ~700 | Pre-processes user messages: intent detection, skill activation, auto-tool routing. |
| `persistence` | ~120 | Saves chat messages + tool traces to DB after each turn. |
| `post-processing` | ~100 | Post-chat: extract memories, update goals, evaluate triggers (now delegates to chat-post-processor). |
| `audit` | ~120 | Audit logging middleware for chat pipeline. |

**Quality**: OK. Post-processing REFACTORED (delegates to extracted module).

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total service files | 91 (+ 7 workflow + 7 middleware) |
| Total lines (services only) | ~30,000 |
| Largest service | `coding-agent-sessions` (924 lines) |
| Smallest service | `workflow-service` barrel (6 lines) |
| Average service size | ~330 lines |
| Services refactored this session | 12 |
| New services created this session | 6 |
