# OwnPilot Agent Ecosystem — Complete Architecture Guide

> **Status:** Living document — covers all 6 agent concepts, their isolation boundaries, practical use cases, and current gaps.
> **Related docs:** [AGENTS.md](./AGENTS.md) (core agent class reference), [AUTONOMOUS_AGENTS.md](./AUTONOMOUS_AGENTS.md) (souls), [CODING_AGENTS.md](./CODING_AGENTS.md) (CLI wrappers), [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Table of Contents

1. [Overview — The 6 Agent Concepts](#overview--the-6-agent-concepts)
2. [Concept 1: Personal Assistant](#concept-1-personal-assistant-default-chat-agent)
3. [Concept 2: Soul Agent (Autonomous)](#concept-2-soul-agent-autonomousscheduled)
4. [Concept 3: Claw (Mission Runtime)](#concept-3-claw-unified-autonomous-runtime)
5. [Concept 4: Coding Agent (CLI Wrapper)](#concept-4-coding-agent-external-cli-orchestration)
6. [Concept 5: Subagent (Task Delegation)](#concept-5-subagent-task-focused-single-shot)
7. [Concept 6: Fleet Worker (Parallel Queue)](#concept-6-fleet-worker-parallel-task-queue)
8. [Architecture Hierarchy](#architecture-hierarchy)
9. [Isolation Mechanisms](#isolation-mechanisms)
10. [Multi-Agent Coordination](#multi-agent-coordination-creworchestra)
11. [Decision Matrix — When to Use What](#decision-matrix--when-to-use-what)
12. [UI Navigation Map](#ui-navigation-map)
13. [Current Gaps & Proposed Improvements](#current-gaps--proposed-improvements)
14. [Agent Routing Skill Design](#agent-routing-skill-design)
15. [Implementation Roadmap](#implementation-roadmap)

---

## Overview — The 6 Agent Concepts

OwnPilot is not a single agent — it's an **ecosystem** of agent concepts, each designed for a specific operational pattern. Understanding the differences is critical for both users (choosing the right tool) and developers (extending the system correctly).

| # | Concept | Primary File(s) | DB Tables | Trigger Model |
|---|---------|-----------------|-----------|---------------|
| 1 | **Personal Assistant** | `agents.ts`, `agent-service.ts` | `agents`, `agent_messages` | Reactive (user message) |
| 2 | **Soul Agent** | `souls.ts`, `agent-souls` | `agent_souls`, `agent_soul_versions` | Scheduled (cron heartbeat) |
| 3 | **Claw** | `claw-runner.ts`, `claw-manager.ts` | `claws`, `claw_sessions`, `claw_history`, `claw_audit_log` | Mission-driven cyclic |
| 4 | **Coding Agent** | `coding-agent-service.ts` | `coding_agent_*` | External CLI spawn |
| 5 | **Subagent** | `subagent-runner.ts`, `subagent-manager.ts` | `subagent_history` | Parent delegation |
| 6 | **Fleet Worker** | `fleet-manager.ts`, `fleet-worker.ts` | `fleets`, `fleet_sessions`, `fleet_tasks`, `fleet_worker_history` | Task queue + concurrency |

Plus **two coordination layers** that orchestrate the above:
- **Agent Crews** (`agent_crews`, `agent_crew_members`) — DB-persisted multi-agent teams
- **Orchestra** (`orchestra/`) — Runtime DAG-based multi-agent execution

---

## Concept 1: Personal Assistant (Default Chat Agent)

> **The "god mode" agent — sees everything, can do anything.**

### What It Is

The single default agent every user has. Lives as the row with `id='default'` in the `agents` table. Created on first boot with `BASE_SYSTEM_PROMPT` as its system prompt.

### Technical Profile

```
Table:      agents (1 row: Personal Assistant)
Prompt:     BASE_SYSTEM_PROMPT (defined in packages/gateway/src/routes/agent-prompt.ts)
Scope:      GLOBAL — full system access
Trigger:    Reactive (responds to user messages)
```

### What It Sees (System Prompt Injection Chain)

Every chat request runs through this pipeline:

```
1. PromptComposer (core/src/agent/prompt-composer.ts)
   → Builds zengin prompt: profile + tools summary + capabilities + time + workspace

2. injectMemoryIntoPrompt (core/src/agent/memory-injector.ts)
   → Loads ComprehensiveProfile (5min TTL cache, max 20 users)
   → Injects: facts, communication style, interests, goals

3. buildEnhancedSystemPrompt (gateway/src/assistant/orchestrator.ts)
   → Strips previously injected sections (prevents accumulation)
   → Adds: memories (top 10 by importance), goals (active, with steps),
           resources (ResourceRegistry summary), autonomy level + daily budget

4. ContextInjection middleware (gateway/src/services/middleware/context-injection.ts)
   → Extension sections (per-request routing)
   → Soul skills section (agent soul's skillAccess)
   → Tool suggestions (RequestRouting.intentHint)
   → Page context (which UI page user is on)

5. buildExecutionSystemPrompt (code execution permissions if enabled)
6. buildToolCatalog (first message only: custom tools + data tables)
```

### Available Tool Namespaces

- `core.*` — built-in (250+ tools: tasks, notes, calendar, habits, expenses, memory, goals, custom data)
- `custom.*` — user-created via `create_tool`
- `plugin.<id>.*` — plugin tools (Telegram, Slack, Discord, etc.)
- `ext.<id>.*` — extension JS tool bundles
- `skill.<id>.*` — AgentSkills.io skills
- `mcp.<server>.*` — external MCP servers

### Practical Scenario

```
User: "Send Alice a WhatsApp message saying I'll be 10 min late,
       add reminder to call her back at 15:00, and note that
       I need to prepare the Q3 report before our meeting."

Personal Assistant performs (single conversation):
  → plugin.whatsapp.send_message({to:"Alice", text:"..."})
  → core.add_calendar_event({title:"Call Alice back", startTime:"15:00"})
  → core.add_note({title:"Q3 Report prep", tags:["meeting","alice"]})
```

### When to Use

- Day-to-day conversational interaction
- Multi-step tasks that need orchestration across domains
- When you want the "overseer" that can create/manage all other agent types

---

## Concept 2: Soul Agent (Autonomous/Scheduled)

> **Persona + schedule + budget — runs without user prompts.**

### What It Is

An agent with a **persistent identity** (personality, voice, boundaries), **scheduled execution** (cron heartbeat), and **budget controls**. Exists in the `agent_souls` table, linked to a row in `agents` via `agent_id`.

### Technical Profile

```typescript
// agent_souls schema
{
  agent_id: string,           // FK to agents table
  identity: {                 // Injected into EVERY prompt
    name: "Radar",
    emoji: "📡",
    role: "Market Researcher",
    personality: "Systematic, curious, data-driven",
    voice: {
      tone: "analytical",
      language: "en",
      quirks: ["Uses radar metaphors"]
    },
    boundaries: [
      "Do not invest based on findings",
      "Clearly label speculation vs facts"
    ]
  },
  purpose: {
    mission: "Scan Product Hunt for emerging products",
    goals: ["Daily scan", "Weekly brief"],
    expertise: ["market research", "tech trends"],
    toolPreferences: ["search_web", "read_url"]
  },
  autonomy: {
    approvalLevel: 'autonomous',  // manual/assisted/supervised/autonomous/full
    dailyBudget: 0.50,
    monthlyBudget: 10.00
  },
  heartbeat: {
    enabled: true,
    cron: "0 8 * * *",            // Every morning 08:00
    timezone: "Europe/Istanbul"
  },
  relationships: {                // Communication with other agents
    broadcastTo: ["all"],
    inbox: true
  },
  evolution: {
    learningEnabled: true,
    memoryRetention: "90d"
  },
  skillAccess: ["web_search", "fetch_url", "add_note", "send_notification"],
  workspace_id: "uuid"            // Isolated workspace
}
```

### Practical Scenario 1 — Morning Brief Agent

```
Identity:    "Radar" 📡 — Market Researcher
Personality: Analytical, fact-based, no speculation
Mission:     "Each morning scan Product Hunt for new tech products,
              save interesting ones to memory, generate a daily brief"
Heartbeat:   Cron "0 8 * * *" (every morning at 08:00 Istanbul time)
Budget:      $0.50/day, $10/month
Skills:      web_search, fetch_url, add_note, send_notification
Boundaries:  - Do NOT give investment advice
             - Label speculation distinctly from facts

User wakes up → opens OwnPilot → Radar has already run at 08:00 →
"Today's Brief: 5 new AI startups, 2 interesting" note exists →
User didn't issue any command.
```

### Practical Scenario 2 — Email Triage Agent

```
Identity:    "Mail Master" 📧
Mission:     "Scan inbox hourly, filter spam, flag important emails,
              notify user if critical"
Heartbeat:   Hourly (cron "0 * * * *")
Tools:       imap_check, classify_email, send_notification
Budget:      $0.20/hour
```

### When to Use

- Task needs to run repeatedly on a schedule
- You don't want to issue commands manually
- The agent should have its own character/persona that persists
- Budget/cost control is important
- Inter-agent communication (inbox/broadcast) is needed

### Distinction from Personal Assistant

| Aspect | Personal Assistant | Soul Agent |
|--------|-------------------|------------|
| Trigger | User message (reactive) | Cron heartbeat (proactive) |
| Identity | Generic "OwnPilot" | Custom persona with personality |
| Budget | None | Daily/monthly limits enforced |
| Tools | ALL tools | Filtered by `skillAccess` |
| Memory | Shared user memory | Soul-specific + shared |

---

## Concept 3: Claw (Unified Autonomous Runtime)

> **Mission-obsessed cyclic runtime with .claw/ directive files.**

### What It Is

A long-running, cyclic agent runtime designed to **finish a mission** through repeated cycles. Each claw has its own isolated workspace and a `.claw/` directory containing directive files that persist across cycles.

### Technical Profile

```typescript
// claws schema
{
  id: string,
  name: string,
  mission: string,              // Detailed mission statement (max 10K chars)
  mode: 'continuous' | 'interval' | 'event' | 'single-shot',
  allowed_tools: string[],      // Tool whitelist
  limits: {
    max_cycles: number,
    max_cost_usd: number,
    idle: number                // Idle timeout in minutes
  },
  interval_ms: number,          // For interval mode
  event_filters: object[],      // For event mode
  auto_start: boolean,
  stop_condition: 'max_cycles' | 'on_report' | 'on_error' | 'idle',
  provider: string,
  model: string,
  workspace_id: string,         // Isolated workspace
  soul_id: string,              // Optional: claw can have a soul
  parent_claw_id: string,       // Hierarchical: MAX_DEPTH=3
  depth: number,
  sandbox: 'auto' | 'docker' | 'local',
  coding_agent_provider: string // Optional Claude Code / Codex / Gemini access
}
```

### The `.claw/` Directive System

Every claw workspace gets auto-scaffolded with:

```
<workspace>/.claw/
├── INSTRUCTIONS.md   # Immutable mission instructions
├── TASKS.md          # Active task list (claw updates each cycle)
├── MEMORY.md         # Persistent cross-cycle memory
└── LOG.md            # Cycle-by-cycle execution log
```

These files are:
- **Auto-injected** into the claw's system prompt every cycle
- **Persistent** across restarts
- **Editable** by the claw itself (self-modification)

Plus a **Working Memory API**:
- `claw_set_context(key, value)` — persist state across cycles
- `claw_get_context(key)` — retrieve state

### Modes

| Mode | Loop Behavior | Use Case |
|------|--------------|----------|
| `continuous` | Adaptive 500ms-10s loop | Real-time research, monitoring |
| `interval` | Fixed period (default 5min) | Periodic health checks |
| `event` | Triggered by EventBus events | Reactive automation |
| `single-shot` | One execution, stops | One-off missions |

### Stop Conditions

- `max_cycles:N` — hard cap on cycles
- `on_report` — stops when claw calls the `report_done` tool
- `on_error` — stops on first error
- `idle:N` — stops if no work for N minutes
- Auto-fail after **5 consecutive errors**

### Limits

- `MAX_CONCURRENT_CLAWS=50`
- `MAX_CLAW_DEPTH=3` (parent-child hierarchy)
- Mission max 10K chars
- Daily cleanup: 90d history retention, 30d audit retention

### Practical Scenario 1 — Server Monitor

```
Name:    "Infra Watchdog"
Mission: "Check DBgate, pgAdmin, MinIO containers every 5 minutes.
          Restart if down, WhatsApp me if still down after 3 retries."
Mode:    continuous
Stop:    on_error, idle:30

.claw/INSTRUCTIONS.md:
  Step 1: docker ps
  Step 2: curl health endpoint for each
  Step 3: If unhealthy, docker restart
  Step 4: If still unhealthy after 3 tries, send WhatsApp

.claw/MEMORY.md (after 1 week):
  - DBgate restarted 2x (memory leak pattern)
  - MinIO healthy 100%
  - pgAdmin healthy 99.7%
```

### Practical Scenario 2 — Refactor Claw

```
Name:    "Route Refactorer"
Mission: "Scan /packages/gateway/src/routes/ (71 files).
          Find routes not using apiResponse helper, fix them,
          run tests, commit. Continue until done."
Mode:    single-shot
Workspace: /home/ayaz/ownpilot/
Coding agent: claude-code
Stop: on_report

.claw/MEMORY.md:
  - 12/71 files scanned
  - 4 missing apiResponse: fixed
  - 8 passed (already compliant)
  - Tests: passing
```

### When to Use

- Long-running mission with a clear "done" state
- Need persistent cross-cycle memory/state
- Resume-able (if crashed, picks up from .claw/ state)
- Needs code execution (sandboxed)
- Hierarchical (spawning sub-claws)

### Distinction from Soul Agent

| Aspect | Soul Agent | Claw |
|--------|-----------|------|
| Trigger | Cron schedule | Mission-driven |
| Duration | Indefinite | Until mission complete |
| State | Learning evolution | .claw/ files |
| Goal | Repeated behavior | Finish a mission |
| Persona | Required (identity) | Optional (can attach soul) |

---

## Concept 4: Coding Agent (External CLI Orchestration)

> **Remote control for Claude Code / Codex / Gemini CLI — OwnPilot's "hands" for real code.**

### What It Is

A wrapper around external AI coding CLI tools that spawns them as child processes and streams their output through OwnPilot's UI via WebSocket.

### Technical Profile

```
Runtime:   child_process.spawn (auto mode) OR node-pty (interactive)
Providers: claude-code, codex, gemini-cli, custom:<name>
Session:   max 3 concurrent per user, UUID-identified
Sandbox:   User-specified cwd, sanitized env (OwnPilot secrets stripped)
Auth:      Login-based OR API key (optional)
Output:    Ring buffer (100KB) + WebSocket streaming to XTerminal
```

### Supported Providers

| Provider | Binary | Auth | API Key Env |
|----------|--------|------|-------------|
| `claude-code` | `claude` | Pro subscription or API key | `ANTHROPIC_API_KEY` |
| `codex` | `codex` | ChatGPT Plus or API key | `CODEX_API_KEY` |
| `gemini-cli` | `gemini` | Google account or API key | `GEMINI_API_KEY` |
| `custom:<name>` | User-defined | User-configured | User-configured |

### Execution Modes

- **Auto mode:** Non-interactive, spawns with `-p <prompt>` args, outputs structured JSON
- **Interactive mode:** PTY-based REPL, full terminal emulation (xterm.js in UI)

### Practical Scenario 1 — Bug Fix (Auto Mode)

```
1. Coding Agents → New Session
2. Provider: claude-code
3. CWD: /home/ayaz/ownpilot
4. Mode: auto
5. Prompt: "Fix the duplicate message bug in
            packages/gateway/src/routes/chat.ts"

Behind the scenes:
  → OwnPilot spawns: claude -p "..." --dangerously-skip-permissions
                           --output-format stream-json --verbose
  → Claude Code reads files, edits, runs tests
  → Output streams via WebSocket (coding-agent:session:output)
  → AutoModePanel parses stream-json for structured display
  → On exit: ANSI stripped, saved to coding_agent_results table
```

### Practical Scenario 2 — Interactive Coding

```
Mode: interactive
Provider: codex
→ XTerminal opens in UI
→ User types natural language, sees CLI responses
→ IDE-like experience within OwnPilot
```

### When to Use

- Need to modify actual files (Coding Agents do this, Personal Assistant asks but doesn't directly do)
- Large refactoring
- Interactive coding session (pairs well with browser preview)
- Run from within a Claw (Claw orchestrates Coding Agents for long-running code tasks)

### Distinction from Other Agents

Coding Agents are **not AI themselves** — they're **remote-control wrappers** for external AI CLIs. Personal Assistant thinks "write code X" → delegates to Coding Agent → Coding Agent writes code.

---

## Concept 5: Subagent (Task-Focused, Single-Shot)

> **One task, one execution, one result.**

### What It Is

A lightweight agent spawned to handle a single subtask in parallel with the parent. Runs to completion, returns the result, dies.

### Technical Profile

```typescript
// subagent_history schema (only history persisted)
{
  id: string,
  parent_id: string,
  task: string,
  status: 'running' | 'completed' | 'failed',
  result: string,
  tool_calls: object[],
  started_at: timestamp,
  finished_at: timestamp
}

// At runtime (not in DB)
const subagent = {
  task: "Research pricing for competitor X",
  tools: [...parentTools filtered by scope],
  maxTurns: 10,
  budgetUsd: 0.50,
  onComplete: (result) => parent.receive(result)
}
```

### Distinguishing Characteristics

- **Single execution** (not cyclic like Claw)
- **Task-focused prompt** (not mission-focused)
- **Full result returned** (not just cycle result)
- **Cancellable** via AbortController
- **Scoped tool access** from parent

### Practical Scenario — Parallel Research

```
Personal Assistant receives: "Research the top 5 CRMs for our industry,
                              compare features and pricing"

Personal Assistant decides to parallelize:
  spawn_subagent({name: "research-salesforce", task: "Detailed research on Salesforce..."})
  spawn_subagent({name: "research-hubspot",    task: "Detailed research on HubSpot..."})
  spawn_subagent({name: "research-pipedrive",  task: "Detailed research on Pipedrive..."})
  spawn_subagent({name: "research-zoho",       task: "Detailed research on Zoho..."})
  spawn_subagent({name: "research-monday",     task: "Detailed research on Monday..."})

Each subagent:
  - Runs in parallel
  - Uses web_search, fetch_url, write_note tools
  - Returns structured result

Personal Assistant:
  - Waits for all 5
  - Synthesizes into comparison table
  - Presents to user
```

### When to Use

- Parallel research/analysis on independent pieces
- Delegating a specific subtask while continuing other work
- Quick one-off task (too small for a Claw, too immediate for a Soul)

---

## Concept 6: Fleet Worker (Parallel Task Queue)

> **Swarm workers processing a task queue with concurrency control.**

### What It Is

A coordinated group of workers that pull tasks from a queue, execute them in parallel, and share context via `fleet_sessions.shared_context`.

### Technical Profile

```typescript
// fleets schema
{
  id: string,
  name: string,
  mission: string,
  workers: FleetWorkerConfig[],  // Worker types + count
  schedule_type: 'continuous' | 'interval' | 'cron' | 'event' | 'on-demand',
  cycles_per_hour_limit: number,
  budget_cap_usd: number,
  max_concurrent: number         // Default 10, max 50
}

// Worker types
type WorkerType =
  | 'ai-chat'      // Full Agent with 250+ tools
  | 'coding-cli'   // Spawns claude-code/codex/gemini
  | 'api-call'     // Direct LLM API (lightweight, no tools)
  | 'mcp-bridge'   // MCP server tool calls
  | 'claw'         // Spawns a single-shot Claw
```

### Task Queue Mechanics

- Tasks added to `fleet_tasks` table
- Workers pull tasks (FIFO with priority)
- Tasks can have `depends_on: [task_ids]` — DAG execution
- `failDependentTasks()` cascades failures
- Shared context in `fleet_sessions.shared_context` (jsonb)

### Practical Scenario — Bulk Product Analysis

```
Fleet: "Product Analyzer"
Mission: "Analyze 500 product pages and extract structured data"
Workers: 10x ai-chat worker (with web_search + fetch_url tools)
Schedule: on-demand
Max concurrent: 10
Budget: $50/day

Task queue (populated via add_fleet_tasks):
  - Analyze https://example.com/p1 → extract {price, features, reviews}
  - Analyze https://example.com/p2 → ...
  ...
  - Analyze https://example.com/p500 → ...

Execution:
  → 10 workers pull tasks simultaneously
  → Each completes in ~30 seconds
  → Shared context accumulates categories/tags
  → Failed tasks retry up to 3x
  → Results stored in fleet_tasks.result (jsonb)
```

### When to Use

- Many similar tasks (embarrassingly parallel)
- Need concurrency (10-50 simultaneous workers)
- Tasks have dependencies (DAG)
- Shared state needed across workers

---

## Architecture Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│  USER                                                            │
│   └── Personal Assistant (GLOBAL SCOPE, reactive)               │
│        │   Sees everything, can do anything                     │
│        ├── spawn_subagent("X research")         ← One-off       │
│        ├── create_claw("Finish mission Y")       ← Long-running │
│        ├── create_autonomous_agent("Every morning")  ← MISSING! │
│        ├── start_coding_session("Write code Z")  ← External CLI │
│        ├── create_orchestra(plan)                ← Multi-step   │
│        └── start_fleet(tasks)                    ← Parallel     │
│                                                                  │
│  Agents can spawn other agents (hierarchical):                  │
│        Claw ──→ Coding Agent (for code tasks)                   │
│        Claw ──→ Sub-Claw (MAX_DEPTH=3)                          │
│        Fleet ──→ Worker (ai-chat/coding-cli/claw/api/mcp)       │
│        Soul ──→ spawn_subagent (for delegated research)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Isolation Mechanisms

| Agent Type | Isolation Boundary | Workspace | Tool Scope |
|------------|-------------------|-----------|------------|
| Personal Assistant | None (global) | Session workspace | ALL tools |
| Soul Agent | `workspace_id` + `skillAccess` | `agent_souls.workspace_id` | Soul's `skillAccess` list |
| Claw | `workspace_id` + `.claw/` dir | Dedicated workspace | `allowed_tools` + claw tools |
| Coding Agent | CWD + sanitized env | User-specified path | Attached skills only |
| Subagent | Parent's delegation | Parent workspace | Scoped by parent |
| Fleet Worker | Fleet session context | Fleet workspace | Fleet task type limits |

**Environment sanitization (Coding Agents):** OwnPilot's own secrets (`POSTGRES_*`, session tokens, internal API keys) are stripped from the child process environment. Only the explicit provider API key + user-defined vars pass through.

---

## Multi-Agent Coordination (Crew/Orchestra)

### Agent Crews

Database-persisted teams for long-term multi-agent coordination.

```typescript
// agent_crews schema
{
  id: uuid,
  name: "Feature Builder Squad",
  description: "...",
  template_id: "swe_squad_v1",       // Pre-defined crew template
  coordination_pattern: 'sequential' | 'parallel' | 'dag' | 'hierarchy',
  status: 'active',
  workspace_id: string               // Crew-level shared workspace
}

// agent_crew_members schema (which agents belong to which crew)
{
  crew_id: uuid,
  agent_id: string,
  role: 'researcher' | 'designer' | 'coder' | 'reviewer' | 'tester',
  order: number
}
```

### Orchestra (Runtime Execution)

Runtime-only multi-agent execution engine for ad-hoc plans.

```typescript
type OrchestraStrategy = 'sequential' | 'parallel' | 'dag';

interface AgentTask {
  id: string;
  agentName: string;      // Must match agents.name
  input: string;
  context?: Record<string, unknown>;
  dependsOn?: string[];   // DAG edges
  timeout?: number;
  optional?: boolean;     // If true, failure doesn't block pipeline
}

interface OrchestraPlan {
  strategy: OrchestraStrategy,
  tasks: AgentTask[],
  providerRouting?: Record<string, {provider: string, model: string}>
}
```

### Practical Scenario — Feature Development Pipeline

```
Crew: "Feature Builder Squad"
Coordination: dag

Tasks:
  task_1 [researcher]: "Research dark mode implementation approaches"
    dependsOn: []

  task_2 [designer]: "Design CSS variables for dark mode"
    dependsOn: [task_1]

  task_3 [coder = claude-code CLI]: "Implement the design, run tests"
    dependsOn: [task_2]

  task_4 [reviewer]: "Code review the implementation"
    dependsOn: [task_3]

  task_5 [tester = claude-code CLI]: "Run E2E tests, capture screenshots"
    dependsOn: [task_4]

Execution flow:
  1. task_1 runs alone
  2. task_1 done → task_2 starts
  3. task_2 done → task_3 starts (Coding Agent spawned)
  4. task_3 done → task_4 starts
  5. task_4 done → task_5 starts
  6. All done → user notified with summary
```

---

## Decision Matrix — When to Use What

### By User Intent

| User Says | Route to |
|-----------|----------|
| "Chat with me about X" | **Personal Assistant** |
| "Specialized assistant for Y" (custom persona) | **Agents** (create custom) |
| "Every morning / daily / hourly / weekly..." | **Soul Agent** (scheduled) |
| "Monitor / watch / keep an eye on..." | **Claw** (continuous/interval) |
| "Finish this mission / do X until done" | **Claw** (single-shot) |
| "Write / refactor / fix code" | **Coding Agent** |
| "Quickly research X and report back" | **Subagent** |
| "Process 100 items / batch analyze..." | **Fleet** |
| "Multi-step feature development" | **Orchestra / Crew** |

### By Technical Pattern

| Pattern | Choose |
|---------|--------|
| Reactive + conversational | Personal Assistant / custom Agent |
| Proactive + scheduled + persona | Soul |
| Proactive + mission-driven + stateful | Claw |
| External tool wrapping | Coding Agent |
| Task decomposition | Subagent |
| Parallel batch | Fleet |
| Multi-agent pipeline | Orchestra / Crew |

---

## UI Navigation Map

The OwnPilot UI exposes these concepts through different sidebar entries:

```
MAIN
  Chat            — Personal Assistant (default conversation)
  Dashboard       — Overview of all active agents/claws/souls

AI & AUTOMATION
  Autonomous Agents  — Soul agent management (CRUD, heartbeat config)

SYSTEM
  Agents          — Agent configurations (including Personal Assistant)
  Logs            — Agent execution logs

EXPERIMENTAL
  Claws           — Claw runtime dashboard (8-tab mgmt panel)
  Coding Agents   — CLI coding agent sessions (xterm.js)
  Orchestration   — Multi-agent crews and orchestra plans

SETTINGS
  Coding Agents   — CLI provider configuration (API keys, defaults)
```

**Note:** Fleet Command has no UI page yet — it's backend-only. Personal Assistant can create/manage fleets via tool calls.

---

## Current Gaps & Proposed Improvements

### Gap 1: Missing `create_autonomous_agent` Tool

**Critical issue discovered during analysis.** Personal Assistant has tools to create Claws, Fleets, and Subagents, but **cannot create Soul Agents**.

#### Current Tool Inventory

| Tool | Status | Description Keywords |
|------|--------|---------------------|
| `create_claw` | Exists | "continuous/interval/event/single-shot", "monitoring", "periodic checks" |
| `create_fleet` | Exists | "parallel", "task queue", "workers" |
| `spawn_subagent` | Exists | "delegate", "parallel research", "single subtask" |
| `create_autonomous_agent` | **MISSING** | — |
| `create_soul` | **MISSING** | — |

#### Why This Matters

When user says **"create an agent that checks Product Hunt every morning at 8am and sends me a brief"**:

The AI sees only 3 agent-creation tools and chooses the **closest fit**:

1. **Most likely:** `create_claw` with `mode='interval'`, `interval_ms=86400000` — works but loses Soul features
2. **Wrong:** `create_fleet` — suggests parallel batch, not right pattern
3. **Insufficient:** `spawn_subagent` — runs once, not scheduled

#### What's Lost Without the Soul Tool

- Custom identity (name, emoji, role, personality, voice, boundaries)
- Budget controls (`dailyBudget`, `monthlyBudget`)
- Spending tracking
- Inter-agent communication (inbox/broadcast)
- Evolution/learning state
- Heartbeat-based cron scheduling

#### Proposed Fix — Add Soul Management Tools

```typescript
// packages/gateway/src/tools/soul-management-tools.ts (NEW FILE)

const createAutonomousAgentDef: ToolDefinition = {
  name: 'create_autonomous_agent',
  description: `Create an autonomous "Soul" agent with persistent identity,
  scheduled execution (cron), budget limits, and inter-agent communication.

  USE THIS WHEN user asks for:
  - An agent that runs on a SCHEDULE ("every morning", "daily", "hourly", "weekly")
  - An agent with PERSONA ("Market Researcher", "Email Assistant")
  - An agent with BUDGET constraints
  - An agent that should PERSIST across sessions with memory/learning

  DO NOT USE for:
  - One-off tasks → use spawn_subagent
  - Long-running single mission → use create_claw
  - Parallel batch work → use create_fleet`,

  parameters: {
    type: 'object',
    properties: {
      identity: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emoji: { type: 'string' },
          role: { type: 'string' },
          personality: { type: 'string' },
          voice: {
            type: 'object',
            properties: {
              tone: { type: 'string' },
              language: { type: 'string' },
              quirks: { type: 'array', items: { type: 'string' } }
            }
          },
          boundaries: { type: 'array', items: { type: 'string' } }
        },
        required: ['name', 'role']
      },
      purpose: {
        type: 'object',
        properties: {
          mission: { type: 'string' },
          goals: { type: 'array', items: { type: 'string' } },
          expertise: { type: 'array', items: { type: 'string' } },
          toolPreferences: { type: 'array', items: { type: 'string' } }
        },
        required: ['mission']
      },
      autonomy: {
        type: 'object',
        properties: {
          approvalLevel: {
            type: 'string',
            enum: ['manual', 'assisted', 'supervised', 'autonomous', 'full']
          },
          dailyBudget: { type: 'number' },
          monthlyBudget: { type: 'number' }
        }
      },
      heartbeat: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          cron: { type: 'string' },
          timezone: { type: 'string' }
        },
        required: ['enabled', 'cron']
      },
      skillAccess: { type: 'array', items: { type: 'string' } },
      provider: { type: 'string' },
      model: { type: 'string' }
    },
    required: ['identity', 'purpose', 'heartbeat']
  }
};

// Companion tools
const listAutonomousAgentsDef = { ... };
const pauseAutonomousAgentDef = { ... };
const updateAutonomousAgentScheduleDef = { ... };
const deleteAutonomousAgentDef = { ... };
```

These tools wrap the existing REST API (`/api/v1/souls/*`) — no new backend logic needed, just MCP-style wrapping.

### Gap 2: No Explicit Routing Logic

Even with all creation tools present, the AI relies on **tool descriptions alone** to pick the right one. This is **implicit routing** — it works when descriptions are excellent, but produces inconsistent choices in edge cases.

**Example edge cases where AI gets confused:**
- "Agent that monitors my email every 5 minutes" — Soul (scheduled) or Claw (continuous)?
- "Daily code review of new commits" — Soul or Orchestra?
- "Run this query once" — Subagent or direct tool call?

**Proposed fix:** Agent Routing Skill (next section).

---

## Agent Routing Skill Design

A skill that the Personal Assistant invokes **before** creating any agent, to systematically determine the correct agent type.

### Skill Structure

```
~/.claude/skills/agent-router/
├── SKILL.md
├── references/
│   ├── decision-tree.md
│   ├── keyword-mapping.md
│   └── examples.md
└── lessons/
    ├── errors.md
    ├── golden-paths.md
    └── edge-cases.md
```

### SKILL.md Core Content

```markdown
# Agent Type Router

When the user requests agent creation or task delegation, analyze their intent
and route to the correct tool. Always invoke this skill BEFORE calling any
create_*/spawn_* tool.

## Step 1: Classify User Intent

Ask yourself:
1. Is this TEK SEFERLİK (one-off) or TEKRARLI (recurring)?
2. Is there a TIME/SCHEDULE mentioned?
3. Is a PERSONA/IDENTITY described?
4. Is PARALLEL execution implied?
5. Does it require EXTERNAL CLI (code writing)?

## Step 2: Apply Decision Tree

### Q1: One-off or recurring?

#### ONE-OFF
- Small + need result fast → `spawn_subagent`
- Large + until complete → `create_claw(mode='single-shot')`
- Many parallel items → `create_fleet(scheduleType='on-demand')`
- Code writing needed → `start_coding_session`

#### RECURRING + SCHEDULED
- Identity/persona important → `create_autonomous_agent` (Soul)
- Just monitoring, no persona → `create_claw(mode='interval')`
- Batch cyclic work → `create_fleet(scheduleType='interval')`

#### RECURRING + EVENT-DRIVEN
- Single event handler → `create_claw(mode='event')`
- Multiple event listeners → `create_fleet(scheduleType='event')`

### Q2: Multi-step with specialists?

If 3+ different expertise areas needed → `create_orchestra` (DAG plan)

## Step 3: Extract Parameters

### Keyword → Tool Mapping

| User said | Route to |
|-----------|----------|
| "every morning/day/hour", "daily", "hourly" | **Soul** |
| "continuously monitor", "watch over" | **Claw continuous/interval** |
| "until done", "finish", "complete" | **Claw single-shot** |
| "all in parallel", "batch process" | **Fleet** |
| "quickly research", "look up X" | **Subagent** |
| "write code", "refactor", "run tests" | **Coding Agent** |
| "[persona name]" with personality | **Soul** (identity field) |

### Budget Heuristics

If user mentions "cheap", "limit spending", "budget":
- Soul → add `autonomy.dailyBudget`
- Claw → add `limits.max_cost_usd`
- Fleet → add `budget_cap_usd`

### Cron Translation

| User phrase | Cron expression |
|-------------|----------------|
| "every morning at 8" | `0 8 * * *` |
| "every hour" | `0 * * * *` |
| "every 5 minutes" | `*/5 * * * *` |
| "weekdays at 9am" | `0 9 * * 1-5` |
| "every Monday 10am" | `0 10 * * 1` |

## Step 4: Validate

Before executing, confirm:
- All required parameters present
- Tool choice matches user intent
- Budget/limits are sensible

If unclear, ASK user before creating.

## Examples

### Example 1
**User:** "Sabah 8'de product hunt'a bakıp bana brief gönderen agent"

**Analysis:**
- Recurring + scheduled (sabah 8 = cron "0 8 * * *")
- Persona implied ("brief gönderen" = researcher)
- No budget mentioned → default

**Action:**
```
create_autonomous_agent({
  identity: {
    name: "ProductHunt Radar",
    emoji: "🔍",
    role: "Tech Scout",
    personality: "Curious, fact-focused, concise"
  },
  purpose: {
    mission: "Scan Product Hunt daily for new tech launches",
    goals: ["Morning brief of top 5 launches"]
  },
  heartbeat: {
    enabled: true,
    cron: "0 8 * * *",
    timezone: "Europe/Istanbul"
  },
  autonomy: {
    approvalLevel: 'autonomous',
    dailyBudget: 0.50
  },
  skillAccess: ['web_search', 'fetch_url', 'add_note', 'send_notification']
})
```

### Example 2
**User:** "Bu dosyadaki bug'ları bul"

**Analysis:** One-off + small + fast result → Subagent

**Action:**
```
spawn_subagent({
  name: "bug-finder",
  task: "Analyze the specified file for bugs, return structured list"
})
```

### Example 3
**User:** "Server'ları 5 dakikada bir monitor et, 3 hata olunca WhatsApp"

**Analysis:**
- Recurring (5min) — but NO persona needed
- Just monitoring → Claw interval

**Action:**
```
create_claw({
  name: "Server Monitor",
  mission: "Check servers every 5min, WhatsApp alert after 3 errors",
  mode: 'interval',
  interval_ms: 300000,
  stop_condition: null  // runs forever
})
```
```

### Integration Options

**Option A — System Prompt Injection (Fast, Reliable)**
Add a compact "## Agent Creation Routing" section to `BASE_SYSTEM_PROMPT`:

```
## Agent Creation Routing

When user requests agent/task creation, pick the right tool:
- SCHEDULED + PERSONA → create_autonomous_agent (Soul)
- LONG MISSION → create_claw
- ONE-OFF TASK → spawn_subagent
- PARALLEL BATCH → create_fleet
- CODE WRITING → start_coding_session
- MULTI-STEP PIPELINE → create_orchestra

Keywords: "every morning/daily/hourly" → Soul | "monitor" → Claw |
"until done" → Claw single-shot | "in parallel" → Fleet |
"quickly research" → Subagent | "write code" → Coding Agent
```

**Pros:** Always active, zero latency, consistent
**Cons:** Adds ~500 chars to already-large system prompt

**Option B — Skill-Based (Modular, Updateable)**
Install `agent-router` as a skill. AI calls `skill.agent-router.classify(userRequest)` explicitly.

**Pros:** Updateable without code deploy, detailed decision tree, lessons can accumulate
**Cons:** AI must remember to call skill, 1 extra tool round-trip

**Option C — Hybrid (Recommended)**
- System prompt has the **short decision table** (Option A content)
- Skill has the **detailed examples, edge cases, keyword mapping**
- AI uses skill only when uncertain

---

## Implementation Roadmap

### Phase 1: Core Tool Addition (2-3 hours)

**Goal:** Personal Assistant can create Soul Agents.

**Files to create:**
```
packages/gateway/src/tools/soul-management-tools.ts
```

**Tool definitions:**
- `create_autonomous_agent` — main creation tool
- `list_autonomous_agents` — enumerate existing souls
- `pause_autonomous_agent` — pause heartbeat
- `resume_autonomous_agent` — resume heartbeat
- `update_autonomous_agent_schedule` — change cron
- `update_autonomous_agent_budget` — change limits
- `delete_autonomous_agent` — remove

**Implementation:**
- Each tool wraps existing `/api/v1/souls/*` endpoints
- Zod schemas for parameters
- Error handling for missing fields, invalid cron, etc.

**Files to modify:**
```
packages/gateway/src/routes/agent-service.ts
  → Import SOUL_MANAGEMENT_TOOLS
  → Add to chatStandardToolDefs array
```

**Tests:**
```
packages/gateway/src/tools/soul-management-tools.test.ts
  → Test each tool creates valid soul via API
  → Test error cases (invalid cron, duplicate name)
```

### Phase 2: Agent Router Skill (1 hour)

**Goal:** Systematic decision-making for agent type selection.

**Option:** Hybrid (A + B)

**Files to create:**
```
packages/gateway/src/routes/agent-prompt.ts
  → Add "## Agent Creation Routing" section to BASE_SYSTEM_PROMPT

~/.claude/skills/agent-router/SKILL.md (user-installable skill)
  → Detailed decision tree, keyword mapping, examples
```

**Files to modify:**
```
docs/AGENTS.md
  → Add "Agent Routing" section with decision tree
```

### Phase 3: UI Integration (optional, 2 hours)

**Goal:** Show user which agent type AI chose and why.

**Example UX:**
```
User: "Sabah 8'de product hunt baksın"
AI:   "I'm creating an Autonomous Agent (Soul) because you specified
       a recurring morning schedule. Here's the config:
       - Identity: ProductHunt Radar 🔍
       - Heartbeat: 08:00 daily
       - Budget: $0.50/day
       Create?" [Yes] [Modify] [Use Claw instead]
```

**Files to modify:**
```
packages/ui/src/components/AgentCreationConfirmation.tsx (NEW)
packages/ui/src/pages/ChatPage.tsx
  → Handle agent_creation_intent event
```

### Phase 4: Testing & Iteration (ongoing)

**Test scenarios:**
- 20 varied user requests → AI must pick correct agent type
- Edge cases: ambiguous requests, mixed signals
- User corrections: "No, make it a Claw instead" → learn

**Metrics to track:**
- Agent type selection accuracy
- User override rate (if high, improve routing)
- Time from user request to agent running

---

## Related Bug Fix — MiniMax Provider Config

During this analysis, a critical config bug was discovered and fixed in `packages/core/data/providers/minimax.json`:

**Bug:**
```json
// BEFORE (broken)
"baseUrl": "https://api.minimax.io/anthropic/v1"
"type": "openai-compatible"

// Code behavior:
fetch(`${baseUrl}/chat/completions`)
→ https://api.minimax.io/anthropic/v1/chat/completions
→ 404 Not Found (Anthropic endpoint expects /v1/messages)
```

**Fix:**
```json
// AFTER (working)
"baseUrl": "https://api.minimax.io/v1"
// Now hits https://api.minimax.io/v1/chat/completions → works
```

**Verification via MiniMax official docs:**
- OpenAI-compatible: `OPENAI_BASE_URL=https://api.minimax.io/v1`
- Anthropic-compatible: `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`

The `openai-compatible` type in OwnPilot appends `/chat/completions`, which is only valid for the `/v1` path (OpenAI format), not `/anthropic/v1` (Anthropic format expects `/v1/messages`).

---

## Appendix — File Reference

### Core Agent Files
```
packages/core/src/agent/
├── agent.ts                    # Agent class (production runtime)
├── orchestrator.ts             # AgentOrchestrator + MultiAgentOrchestrator
├── agent-builder/              # LLM-guided agent creation
├── prompt-composer.ts          # Dynamic system prompt builder
├── memory-injector.ts          # Memory injection into prompts
├── providers/                  # Multi-provider support
└── fleet/                      # Fleet types
```

### Gateway Agent Files
```
packages/gateway/src/
├── assistant/orchestrator.ts   # buildEnhancedSystemPrompt (memories/goals/autonomy)
├── services/
│   ├── claw-runner.ts          # Claw execution
│   ├── claw-manager.ts         # Claw lifecycle
│   ├── fleet-manager.ts        # Fleet scheduling
│   ├── fleet-worker.ts         # Fleet worker execution
│   ├── subagent-runner.ts      # Subagent execution
│   ├── subagent-manager.ts     # Subagent lifecycle
│   ├── coding-agent-service.ts # CLI orchestration
│   ├── coding-agent-session.ts # PTY + child_process
│   └── middleware/
│       └── context-injection.ts # Per-request prompt injection
├── routes/
│   ├── agent-service.ts        # Agent CRUD + chat
│   ├── agent-prompt.ts         # BASE_SYSTEM_PROMPT, CLI_SYSTEM_PROMPT
│   ├── souls.ts                # Soul CRUD REST API
│   ├── souls-agent-routes.ts   # Soul agent operations
│   ├── souls-deploy.ts         # Soul deployment
│   ├── claws.ts                # Claw CRUD REST API
│   ├── fleets.ts               # Fleet CRUD REST API
│   ├── subagents.ts            # Subagent REST API
│   ├── coding-agents.ts        # Coding agent sessions
│   └── crews.ts                # Agent crew CRUD
└── tools/
    ├── claw-tools.ts                 # 16 claw runtime tools
    ├── claw-management-tools.ts      # 7 claw CRUD tools (create_claw here)
    ├── fleet-tools.ts                # Fleet CRUD tools (create_fleet here)
    ├── subagent-tools.ts             # spawn_subagent
    └── soul-management-tools.ts      # MISSING — needs to be created
```

---

*Last updated: 2026-04-14*
*Authors: OwnPilot team + collaborative analysis session*
