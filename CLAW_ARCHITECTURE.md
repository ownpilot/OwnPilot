# Claw Architecture

> Unified Autonomous Agent Runtime — v0.4.0

## Overview

Claw is OwnPilot's unified autonomous agent runtime. A Claw agent combines an LLM brain, a file-based workspace, an optional persistent Soul identity, a coding sub-agent (Claude Code, Codex, or Gemini CLI), sandboxed script execution, and access to all 250+ platform tools into a single self-directed runtime that can pursue multi-cycle missions.

Claw is **not** a chatbot. It is an autonomous agent that:

- Receives a mission (a natural-language goal + optional success contract)
- Plans and executes tool calls across multiple cycles
- Persists working memory, artifacts, and a run journal to disk
- Can spawn sub-agents (subclaws) up to 3 levels deep
- Integrates with the workflow system via the `clawNode` node type
- Broadcasts lifecycle events via EventBus and WebSocket
- Is gated by a global LLM concurrency semaphore (configurable, default 3 slots)

## Architecture Map

```
┌─────────────────────────────────────────────────────────────────┐
│                         Claw System                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────────┐    ┌──────────────┐ │
│  │  ClawService │────▶│   ClawManager    │───▶│  ClawRunner  │ │
│  │  (lifecycle  │     │  (singleton,    │    │  (per-claw,  │ │
│  │   facade)    │     │   scheduling,    │    │  cycle exec) │ │
│  └──────────────┘     │   rate limiting) │    └──────┬───────┘ │
│         │             └──────────────────┘           │         │
│         ▼                        │                    ▼         │
│  ┌──────────────────────────────────────────────────────────────────┐
│  │                      14 Core Claw Tools (claw-tools.ts)          │
│  │  claw_install_package  claw_run_script  claw_create_tool          │
│  │  claw_spawn_subclaw   claw_list_subclaws  claw_stop_subclaw     │
│  │  claw_publish_artifact  claw_send_output  claw_complete_report   │
│  │  claw_request_escalation  claw_emit_event  claw_update_config    │
│  │  claw_send_agent_message  claw_reflect                            │
│  │  claw_set_context     claw_get_context                            │
│  └─────────────────────────────────────────────────────────────────┘
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐
│  │               LlmSemaphore (llm-semaphore.ts)                    │
│  │  FIFO queue, N slots (default 3), event emission                  │
│  │  Choke point: executeAgentPipeline() wraps agent.chat()           │
│  └─────────────────────────────────────────────────────────────────┘
│                              │
│         ┌────────────────────┼────────────────────┐
│         ▼                    ▼                    ▼
│  ┌────────────┐   ┌────────────────┐   ┌──────────────────┐
│  │ Workspace  │   │  Coding Agent  │   │  .claw/ Dir      │
│  │ (sandboxed)│   │  (Claude Code, │   │  INSTRUCTIONS.md │
│  │ file ops   │   │   Codex, etc.) │   │  TASKS.md        │
│  │            │   │                │   │  MEMORY.md       │
│  │            │   │                │   │  LOG.md          │
│  └────────────┘   └────────────────┘   └──────────────────┘
│                                                                  │
│  ┌────────────────────────────────────────────────────────────────┐
│  │                   Database (4 tables)                         │
│  │  claws  claw_sessions  claw_history  claw_audit_log          │
│  └────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Core Types

**File:** `packages/core/src/services/claw-types.ts`

### ClawMode

```typescript
export type ClawMode = 'continuous' | 'interval' | 'event' | 'single-shot';
```

- **continuous**: Adaptive loop with 500ms/5s/10s backoff based on activity level
- **interval**: Fixed interval between cycles (default: 5 min)
- **event**: Listens to EventBus; runs on matching events
- **single-shot**: One execution cycle, auto-stops on completion (like Subagent)

### ClawState

```typescript
export type ClawState =
  | 'starting' // Workspace + conversation being set up
  | 'running' // Cycle in progress
  | 'waiting' // Continuous/interval: waiting for next interval
  | 'paused' // Manually paused or escalation pending
  | 'completed' // Mission complete or stop condition met
  | 'failed' // 5 consecutive errors or budget exhausted
  | 'stopped' // Manually stopped
  | 'escalation_pending'; // Awaiting user approval for escalated action
```

### ClawConfig

Persisted configuration for a Claw agent:

```typescript
export interface ClawConfig {
  id: string;
  userId: string;
  name: string;
  mission: string;
  mode: ClawMode;
  allowedTools: string[]; // Tool allowlist; empty = all tools
  limits: ClawLimits; // Resource constraints
  intervalMs?: number; // For interval mode (default: 300000 = 5 min)
  eventFilters?: string[]; // For event mode
  autoStart: boolean;
  stopCondition?: string; // e.g., 'max_cycles:100', 'on_report', 'on_error', 'idle:5'
  provider?: string; // AI provider override
  model?: string; // Model override
  workspaceId?: string; // Auto-created on start
  soulId?: string; // Optional Soul identity
  parentClawId?: string; // For subclaw tracking
  depth: number; // Nesting depth (0 = root, max 3)
  sandbox: ClawSandboxMode; // 'auto' | 'docker' | 'local'
  codingAgentProvider?: string; // 'claude-code' | 'codex' | 'gemini-cli'
  skills?: string[]; // Skill IDs available to this claw
  missionContract?: ClawMissionContract; // Success criteria + evidence requirements
  autonomyPolicy?: ClawAutonomyPolicy; // Guardrails for self-modification
  priority?: number; // Scheduling priority: 1=highest, 3=normal, 5=lowest
  createdBy: ClawCreator; // 'user' | 'ai' | 'claw'
}
```

### ClawLimits

```typescript
export const DEFAULT_CLAW_PRIORITY = 3; // 1=highest, 5=lowest

export interface ClawLimits {
  maxTurnsPerCycle: number; // default: 50
  maxToolCallsPerCycle: number; // default: 500
  maxCyclesPerHour: number; // default: 120
  cycleTimeoutMs: number; // default: 600000 (10 min)
  totalBudgetUsd?: number; // undefined = unlimited
}
```

### ClawSession

Runtime state held in memory by ClawManager:

```typescript
export interface ClawSession {
  config: ClawConfig;
  state: ClawState;
  cyclesCompleted: number;
  totalToolCalls: number;
  totalCostUsd: number;
  lastCycleAt: Date | null;
  lastCycleDurationMs: number | null;
  lastCycleError: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
  persistentContext: Record<string, unknown>; // Working memory (claw_set/get_context)
  inbox: string[]; // Messages from subclaws/agents
  artifacts: string[]; // Published artifact IDs
  pendingEscalation: ClawEscalation | null;
}
```

### ClawHistoryEntry

Persisted record of each cycle:

```typescript
export interface ClawHistoryEntry {
  id: string;
  clawId: string;
  cycleNumber: number;
  entryType: 'cycle' | 'escalation';
  success: boolean;
  toolCalls: ClawToolCall[];
  outputMessage: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  error?: string;
  executedAt: Date;
}
```

### ClawMissionContract

Explicit success definition:

```typescript
export interface ClawMissionContract {
  successCriteria: string[]; // What "done" means
  deliverables: string[]; // Required outputs
  constraints: string[]; // Must-not-do rules
  escalationRules: string[]; // When to ask for human input
  evidenceRequired: boolean; // Require proof of completion
  minConfidence: number; // 0-1, halt below this
}
```

### ClawAutonomyPolicy

Guardrails for self-modification:

```typescript
export interface ClawAutonomyPolicy {
  allowSelfModify: boolean;
  allowSubclaws: boolean;
  requireEvidence: boolean;
  destructiveActionPolicy: 'ask' | 'block' | 'allow';
  filesystemScopes: string[];
  maxCostUsdBeforePause?: number;
}
```

---

## 2. Service Architecture

### ClawService

**File:** `packages/gateway/src/services/claw-service.ts`

Facade layer implementing `IClawService`. All public API calls go through this service. It is registered in the service registry as `Services.Claw` and obtained via `registry.get(Services.Claw)`.

Responsibilities:

- Delegates to `ClawManager` for runtime session operations
- Provides a REST/HTTP-accessible layer for claw operations
- Manages claw configuration CRUD (persisted to `claws` table)
- Provides WebSocket access to claw state via `claw:{eventName}` subscription pattern

### ClawManager

**File:** `packages/gateway/src/services/claw-manager.ts`

Singleton managing all **in-memory** `ClawSession` objects. Created once per process boot.

Key responsibilities:

| Responsibility        | Detail                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Session lifecycle** | `startClaw`, `pauseClaw`, `resumeClaw`, `stopClaw`                                                            |
| **Scheduling**        | Continuous mode: adaptive delay (500ms active, 5s idle, 10s error backoff); Interval mode: fixed `intervalMs` |
| **Rate limiting**     | `maxCyclesPerHour` enforced via sliding window; auto-pause at `maxCostUsdBeforePause`                         |
| **Error tracking**    | 5 consecutive errors → state `failed`                                                                         |
| **Auto-recovery**     | On boot: resumes `autoStart=true` claws and any interrupted sessions                                          |
| **Persistence**       | Persists session state to DB every 30s (only if `dirty` flag is set)                                          |
| **Escalation**        | Pauses on escalation request; resumes on `approveEscalation`/`denyEscalation`                                 |
| **Cleanup**           | Daily retention cleanup (90d history, 30d audit); 100-message inbox cap                                       |

Internal structure per managed claw:

```typescript
interface ManagedClaw {
  session: ClawSession; // In-memory state
  runner: ClawRunner; // Per-claw cycle executor
  timer: ReturnType<typeof setTimeout> | null; // Next-cycle timer
  eventSubscriptions: EventHandler[]; // For event mode
  consecutiveErrors: number;
  cyclesThisHour: number;
  hourWindow: number;
  persistTimer: ReturnType<typeof setInterval> | null;
  lastCycleToolCalls: number;
  cycleInProgress: boolean;
  currentCycleNumber: number;
  idleCycles: number;
  abortController: AbortController | null; // Cancel in-flight cycle
  dirty: boolean; // Skip persist if no changes
}
```

### ClawRunner

**File:** `packages/gateway/src/services/claw-runner.ts`

Per-claw, per-cycle executor. Instantiated once per `ManagedClaw`, reused across cycles.

```typescript
class ClawRunner {
  constructor(
    public readonly clawId: string,
    public readonly userId: string,
    public readonly session: ClawSession, // Live session object
    private readonly manager: ClawManager
  ) {}

  async executeCycle(): Promise<ClawCycleResult>;
  async executeSingleShot(): Promise<ClawCycleResult>;
  async runMission(): Promise<void>; // Top-level mission runner
}
```

Runner responsibilities per cycle:

1. Build prompt with `.claw/` directive content injected
2. Acquire LlmSemaphore slot (blocks if all N slots busy)
3. Execute agent cycle via `agent.chat()` (same pipeline as autonomous agents)
4. Release LlmSemaphore slot
5. Apply stop condition logic (`max_cycles:N`, `on_report`, `on_error`, `idle:N`)
6. Call `manager.persistSession()` on changes
7. Broadcast events via EventBus
8. Auto-fail after 5 consecutive errors

### ClawExecutionContext

**File:** `packages/gateway/src/services/claw-context.ts`

`AsyncLocalStorage`-based ambient context that carries the current claw's identity through tool executions. All claw tools (lifecycle, delegation, output, context) use `getClawContext()` to determine which claw is executing. Modeled after `heartbeat-context.ts`.

```typescript
interface ClawExecutionContext {
  clawId: string;
  userId: string;
  workspaceId?: string;
  depth: number;
  sandbox?: ClawSandboxMode; // Inherited from claw config
}

export function runInClawContext<T>(ctx: ClawExecutionContext, fn: () => Promise<T>): Promise<T>;
export function getClawContext(): ClawExecutionContext | undefined;
```

---

## 3. The 14 Core Claw Tools

**File:** `packages/gateway/src/tools/claw-tools.ts` (dispatcher)
**File:** `packages/gateway/src/tools/claw/definitions.ts` (tool definitions)

All tools return `{ success: boolean; result?: unknown; error?: string }`. They are registered in `agent-tool-registry.ts` under `CLAW_TOOL_NAMES`.

### Lifecycle Tools

| Tool                   | Executor                 | Purpose                            |
| ---------------------- | ------------------------ | ---------------------------------- |
| `claw_install_package` | `lifecycle-executors.ts` | Install npm package in workspace   |
| `claw_run_script`      | `lifecycle-executors.ts` | Execute JS/TS script in sandbox    |
| `claw_create_tool`     | `lifecycle-executors.ts` | Create a new custom tool from code |

### Delegation Tools

| Tool                      | Executor                  | Purpose                             |
| ------------------------- | ------------------------- | ----------------------------------- |
| `claw_spawn_subclaw`      | `delegation-executors.ts` | Create child Claw agent (depth ≤ 3) |
| `claw_list_subclaws`      | `delegation-executors.ts` | List active subclaws                |
| `claw_stop_subclaw`       | `delegation-executors.ts` | Stop a running subclaw              |
| `claw_send_agent_message` | `delegation-executors.ts` | Send message to subclaw inbox       |

### Output / Communication Tools

| Tool                      | Executor              | Purpose                                                            |
| ------------------------- | --------------------- | ------------------------------------------------------------------ |
| `claw_publish_artifact`   | `output-executors.ts` | Publish artifact (file) to workspace                               |
| `claw_send_output`        | `output-executors.ts` | Emit output to parent claw/agent                                   |
| `claw_complete_report`    | `output-executors.ts` | Signal mission completion                                          |
| `claw_request_escalation` | `output-executors.ts` | Request human approval for action                                  |
| `claw_emit_event`         | `output-executors.ts` | Emit EventBus event (can trigger other claws, workflows, triggers) |

### Context / Working Memory Tools

| Tool                 | Executor               | Purpose                                                                                       |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `claw_set_context`   | `context-executors.ts` | Store key/value in persistentContext                                                          |
| `claw_get_context`   | `context-executors.ts` | Retrieve value from persistentContext                                                         |
| `claw_reflect`       | `context-executors.ts` | Self-review: evaluate progress against mission                                                |
| `claw_update_config` | `context-executors.ts` | Modify runtime claw settings (mission, mode, priority 1–5, sandbox, interval, stop condition) |

### Management Tools (separate file)

**File:** `packages/gateway/src/tools/claw-management-tools.ts` (7 tools)

| Tool                         | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `get_claw_status`            | Query current state of a claw        |
| `get_claw_history`           | Retrieve cycle history               |
| `claw_pause`                 | Pause a running claw                 |
| `claw_resume`                | Resume a paused claw                 |
| `claw_update`                | Update claw configuration            |
| `claw_delete`                | Delete a claw (stopped/failed only)  |
| `claw_doctor`                | Diagnose claw health issues          |
| `claw_apply_recommendations` | Apply health recommendations to claw |
| `claw_restart`               | Stop and restart a claw              |

**Total: 14 core + 7 management = 21 claw tools**

### Working Memory Bounds

```typescript
MAX_CONTEXT_KEYS = 100;
MAX_KEY_LEN = 64; // characters
MAX_VALUE_BYTES = 8 * 1024; // 8 KB per value
MAX_TOTAL_BYTES = 64 * 1024; // 64 KB total
```

---

## 4. LLM Concurrency Semaphore

**File:** `packages/gateway/src/services/llm-semaphore.ts`

Global FIFO queue-based concurrency limiter. All LLM calls across all claws, subagents, and fleet workers go through this semaphore — prevents stampeding the same LLM provider API.

```typescript
export class LlmSemaphore {
  private slots: string[] = []; // slot[i] = agentId or ''
  private waitQueue: Array<{ agentId: string; resolve: (slotIdx: number) => void }> = [];

  async acquire(agentId: string, _label: string): Promise<() => void>;
  private release(agentId: string, slotIdx: number): void;
  getDetailedSlots(resolveLabel: (agentId: string) => string): Slot[];
  get activeCount(): number;
  get queuedCount(): number;
  setMaxSlots(n: number): void;
}
```

### Integration Point

`executeAgentPipeline()` in `packages/gateway/src/services/agent-runner-utils.ts` is the single choke point. Every `agent.chat()` call — from claws, subclaws, fleet workers, and subagents — is wrapped:

```typescript
const release = await llmSemaphore.acquire(opts.agentId ?? 'unknown', opts.timeoutLabel ?? 'agent');
try {
  const chatResult = await opts.agent.chat(...);
} finally {
  release();
}
```

### Configuration

- Settings key: `gateway.max_llm_concurrency` (persisted, hot-reloadable)
- Default: `DEFAULT_MAX_LLM_CONCURRENCY = 3`
- Runtime control: `GET/PUT /settings/max-llm-concurrency` (returns `{ maxConcurrency, activeCalls, queuedCalls }`)

### Event Emission

On every acquire/release/resize, emits `llm.slot.update` via `getEventSystem()`. WebSocket subscribers receive `{ max, active, queued }`. The ClawsPage subscribes to `llm.slot.update` and refreshes the `ConcurrencyBar` strip in real-time.

---

## 5. The .claw/ Directive File System

**File:** `packages/gateway/src/services/claw-runner.ts` (`.claw/` directive system at line 448)

Each claw workspace contains a `.claw/` directory auto-scaffolded on first start. The four directive files are **re-injected into the prompt every cycle** so the claw can edit its own instructions, task list, memory, and run journal — and see the updated content in the next cycle.

### INSTRUCTIONS.md

Top-level mission and behavioral directives. Injected first in every cycle prompt.

```
.claw/INSTRUCTIONS.md
├── Your role and identity
├── Your core mission (the "mission" field)
├── Operational constraints (what you must/must not do)
├── Escalation criteria (when to ask for human input)
└── Success definition (what a completed mission looks like)
```

### TASKS.md

A living task list the claw maintains. The claw appends completed items and revises remaining ones after each cycle. Format is freeform markdown.

### MEMORY.md

Persistent cross-cycle memory. The claw writes insights, decisions, and context here. Not re-injected every cycle (it's in the workspace root and the claw can `cat` it).

### LOG.md

Auto-generated run journal. Each cycle appends a timestamped entry:

```
## Cycle N — YYYY-MM-DD HH:mm:ss (duration: Xms)
### Actions Taken
- ...
### Results
- ...
### Next Steps
- ...
```

---

## 6. Communication Patterns

### EventBus

**File:** `packages/core/src/events/`

Claw emits lifecycle events via `getEventSystem().emit()`:

| Event             | Payload                            | When                                |
| ----------------- | ---------------------------------- | ----------------------------------- |
| `claw.started`    | `{clawId, name}`                   | ClawManager.startClaw()             |
| `claw.paused`     | `{clawId, reason}`                 | Manually or escalation              |
| `claw.resumed`    | `{clawId}`                         | After approval or resume            |
| `claw.progress`   | `{clawId, cycle, cyclesCompleted}` | After each cycle                    |
| `claw.escalation` | `{clawId, type, reason}`           | Escalation requested                |
| `claw.cycle.*`    | varies                             | Cycle lifecycle (start, end, error) |
| `claw.error`      | `{clawId, error}`                  | Cycle failed                        |
| `claw.stopped`    | `{clawId, reason}`                 | Stop requested                      |
| `claw.update`     | `{clawId, state}`                  | Session state change                |
| `claw.output`     | `{clawId, output}`                 | Output emitted                      |
| `llm.slot.update` | `{max, active, queued}`            | LLM slot acquired/released/resized  |

### WebSocket

ClawManager subscribes to EventBus and re-broadcasts all claw events as WebSocket messages with the pattern `claw:{eventName}`. Clients subscribe to `claw:*` to receive all claw events for a user.

### Inbox (Inter-Claw Communication)

Subclaws and agents can send messages to a claw's inbox via `claw_send_agent_message`. The claw reads inbox messages at cycle start and responds within the same cycle.

```
Claw A (parent)
  └── claw_spawn_subclaw → Claw B (subclaw, depth=1)
        └── claw_send_agent_message(to=A, message="done") → Claw A inbox
```

### Agent-to-Claw (via HeartbeatContext)

**File:** `packages/core/src/events/heartbeat-context.ts`

`runInHeartbeatContext(ctx, fn)` threads the heartbeat's `agentId` through `AsyncLocalStorage`. This allows tools called during a heartbeat to route messages to the correct inbox when `crewId` is present in the soul context.

---

## 7. Execution Flow

### Single-Shot Mode

```
createClaw()
  → ClawService          (persist config to DB)
  → ClawManager.startClaw()
        → ClawRunner.runMission()
              → LlmSemaphore.acquire()
              → agent.chat(mission + .claw/INSTRUCTIONS.md)
                    → ClawCycleResult
              → LlmSemaphore.release()
              → claw_complete_report?
                    → state = 'completed'
                    → ClawManager.stopClaw()
        → ClawRunner.executeSingleShot() [one-shot: no loop]
  → return session
```

### Continuous/Interval Mode

```
createClaw()
  → ClawService
  → ClawManager.startClaw()
        → ClawRunner.runMission() [loop]
              ┌─ continuous: adaptive delay
              │    minDelay = 500ms  (active)
              │    idleDelay = 5s    (no tool calls)
              │    maxDelay = 10s   (error backoff)
              ├─ interval: fixed intervalMs (default 5 min)
              └─ event: EventBus subscription
              → LlmSemaphore.acquire()
              → agent.chat(mission + .claw/)
              → LlmSemaphore.release()
              → check stopCondition
                   'max_cycles:N'  → state = 'completed'
                   'on_report'     → if report tool called
                   'on_error'      → if cycle errored
                   'idle:N'        → if N cycles with no tool calls
              → if 5 consecutive errors → state = 'failed'
              → persistSession()
              → broadcast events
  → return session (immediate, loop runs async)
```

### Workflow Integration (clawNode)

**File:** `packages/gateway/src/services/workflow/executors/claw.ts`

```
executeClawNode(node, nodeOutputs, variables, userId, signal?)
  → resolveTemplates({ name, mission }, nodeOutputs, variables)
  → ClawService.createClaw({ name, mission, mode, sandbox, ... })
  → ClawService.startClaw(clawId, userId)
  → if !waitForCompletion (cyclic modes default false)
       return { status: 'success', clawId, state, waitedForCompletion: false }
  → else (single-shot or user requested wait)
       waitForClawTerminal() — EventBus push-based subscription (no polling)
       → ClawService.getHistory(clawId, userId, 1, 0)
       → ClawService.stopClaw(clawId, userId)
       → ClawService.deleteClaw(clawId, userId)  [ephemeral workflow claw]
       return { status, cyclesCompleted, lastOutput, cost, state }
  → on error: cleanup leaked claw config if create succeeded but downstream failed
```

> **Note:** Uses EventBus push-based `waitForClawTerminal()` instead of 2-second polling. Subscribes to `claw.update` events and resolves when the claw reaches a terminal state or the abort signal fires.

### Subclaw Spawning

```
claw_spawn_subclaw({ mission, name?, mode?, depth?, ... }, userId)
  → validate depth < MAX_CLAW_DEPTH (3)
  → validate not paused/failed/stopped
  → createClaw({ parentClawId: currentClawId, depth: currentDepth + 1 })
  → startClaw(newClawId, userId)
  → send message to parent inbox: "subclaw started"
  → return { subclawId, state }
```

---

## 8. Database Schema

### claws

```sql
CREATE TABLE IF NOT EXISTS claws (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  mission         TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'single-shot',
  allowed_tools   TEXT[],                        -- empty = all tools
  limits          JSONB NOT NULL DEFAULT '{}',
  interval_ms     INTEGER,
  event_filters   TEXT[],
  auto_start      BOOLEAN NOT NULL DEFAULT false,
  stop_condition  TEXT,
  provider        TEXT,
  model           TEXT,
  workspace_id    TEXT,
  soul_id          TEXT,
  parent_claw_id  TEXT,
  depth           INTEGER NOT NULL DEFAULT 0,
  sandbox         TEXT NOT NULL DEFAULT 'auto',
  coding_agent_provider TEXT,
  skills          TEXT[],
  preset          TEXT,
  mission_contract JSONB,
  autonomy_policy JSONB,
  created_by      TEXT NOT NULL DEFAULT 'user',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### claw_sessions

```sql
CREATE TABLE IF NOT EXISTS claw_sessions (
  claw_id          TEXT PRIMARY KEY REFERENCES claws(id) ON DELETE CASCADE,
  state            TEXT NOT NULL,
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  total_cost_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  last_cycle_at    TIMESTAMPTZ,
  last_cycle_duration_ms INTEGER,
  last_cycle_error TEXT,
  started_at       TIMESTAMPTZ NOT NULL,
  stopped_at       TIMESTAMPTZ,
  persistent_context JSONB NOT NULL DEFAULT '{}',
  inbox            TEXT[] NOT NULL DEFAULT '{}',
  artifacts        TEXT[] NOT NULL DEFAULT '{}',
  pending_escalation JSONB
);
```

### claw_history

```sql
CREATE TABLE IF NOT EXISTS claw_history (
  id              SERIAL PRIMARY KEY,
  claw_id         TEXT NOT NULL REFERENCES claws(id) ON DELETE CASCADE,
  cycle_number    INTEGER NOT NULL,
  entry_type      TEXT NOT NULL DEFAULT 'cycle',
  success         BOOLEAN NOT NULL DEFAULT false,
  tool_calls      JSONB NOT NULL DEFAULT '[]',
  output_message  TEXT,
  tokens_used     JSONB,
  cost_usd        NUMERIC(12, 6),
  duration_ms     INTEGER,
  error           TEXT,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Index: getHistory() queries by claw_id + executed_at DESC
CREATE INDEX IF NOT EXISTS idx_claw_history_claw_id ON claw_history(claw_id, executed_at DESC);
```

### claw_audit_log

```sql
CREATE TABLE IF NOT EXISTS claw_audit_log (
  id          SERIAL PRIMARY KEY,
  claw_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Migrations:** Files `022_claw_sessions.sql` and `023_claw_audit_log.sql` in `packages/gateway/src/db/migrations/postgres/`

---

## 9. Cost Tracking

**File:** `packages/gateway/src/services/agent-runner-utils.ts`

`calculateExecutionCost(provider, model, usage)` wraps `@ownpilot/core`'s `calculateCost()`. Used by:

- `ClawRunner.executeCycle()` → `ClawCycleResult.costUsd`
- `ClawManager.persistSession()` → `session.totalCostUsd`
- `ClawManager` → auto-pause when `totalCostUsd > autonomyPolicy.maxCostUsdBeforePause`

---

## 10. Sandbox Execution

**File:** `packages/gateway/src/tools/claw/sandbox-env.ts`

Scripts run in a sandboxed Node.js VM with:

- No `process`, `require`, `eval`, `Function` constructor
- Blocked globals: `Buffer`, `process`, `clearImmediate`, `setImmediate`
- Blocked patterns: `constructor.constructor`, `Proxy`, `Object.defineProperty` on prototypes
- V8 stack traces stripped of host paths (replaced with `<sandbox>:line:column`)
- Network: configurable (`permissions.network: true|false`)
- Filesystem: scoped to workspace directory
- Spawn: disabled by default

Full security test suite: `packages/core/src/sandbox/sandbox-escape.test.ts` (573 lines, 50+ adversarial test cases)

---

## 11. Claw UI

**File:** `packages/ui/src/pages/ClawsPage.tsx`

8-tab management panel:

1. **Active** — Currently running claws with live state
2. **All** — Full list with search/filter/bulk actions
3. **Templates** — Pre-configured mission templates
4. **Presets** — Productized loadouts
5. **Audit** — Audit log viewer
6. **Settings** — Global claw defaults
7. **Logs** — Run journal viewer
8. **Builder** — Visual claw configuration

### ConcurrencyBar

**File:** `packages/ui/src/pages/claws/ConcurrencyBar.tsx`

Live LLM slot visualizer strip at the top of the ClawsPage. Shows:

- **Active slots** (green, pulsing dot + claw name)
- **Queued slots** (amber, clock icon, slide-in animation)
- **Free slots** (dashed gray border, slot number)
- **Utilization bar** (green → amber → red gradient based on fill %)
- **Live count**: `active/max` with queued indicator

WebSocket subscription to `llm.slot.update` provides real-time count updates. `+/−` buttons call `PUT /settings/max-llm-concurrency` for runtime control.

ClawsWidget (live WS updates) embedded in DashboardPage.

---

## 12. Limitations and Known Issues

### Runtime Limitations

| Issue                           | Impact                                            | Workaround                                           |
| ------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Event mode reliability          | Event subscriptions are in-process; lost on crash | Claw auto-recovers interrupted sessions on boot      |
| Single-shot claws are ephemeral | Deleted immediately after completion              | For persistence, use `continuous` or `interval` mode |

### Architectural Limitations

| Issue                          | Detail                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| No distributed claw scheduling | All claws run in single gateway process; `MAX_CONCURRENT_CLAWS=50`                                         |
| Workspace isolation            | Subclaws share workspace parent directory unless sandbox is `docker` (now **auto-enforced for depth > 0**) |
| Cost tracking is estimate-only | `calculateCost()` is a provider approximation; actual invoice may differ                                   |

### Testing Limitations

| Issue                       | Detail                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Concurrent claw tests       | Shared `ManagedClaw` map can cause cross-test pollution            |
| `backup.test.ts` mock issue | `child_process` mock conflict with keychain; pre-existing          |
| EventBus async timing       | `advanceTimersByTimeAsync` required for Promise.race + fake timers |

---

## 13. Key File Index

| Purpose                           | File                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| Core types                        | `packages/core/src/services/claw-types.ts`                           |
| Agent execution types             | `packages/core/src/services/agent-execution-result.ts`               |
| Heartbeat context                 | `packages/core/src/events/heartbeat-context.ts`                      |
| Claw execution context            | `packages/gateway/src/services/claw-context.ts`                      |
| LLM concurrency semaphore         | `packages/gateway/src/services/llm-semaphore.ts`                     |
| EventBus / HookBus                | `packages/core/src/events/index.ts`                                  |
| ClawService facade                | `packages/gateway/src/services/claw-service.ts`                      |
| ClawManager singleton             | `packages/gateway/src/services/claw-manager.ts`                      |
| ClawRunner (per-claw)             | `packages/gateway/src/services/claw-runner.ts`                       |
| Claw tools dispatcher             | `packages/gateway/src/tools/claw-tools.ts`                           |
| Tool definitions                  | `packages/gateway/src/tools/claw/definitions.ts`                     |
| Lifecycle executors               | `packages/gateway/src/tools/claw/lifecycle-executors.ts`             |
| Delegation executors              | `packages/gateway/src/tools/claw/delegation-executors.ts`            |
| Output executors                  | `packages/gateway/src/tools/claw/output-executors.ts`                |
| Context executors                 | `packages/gateway/src/tools/claw/context-executors.ts`               |
| Sandbox env builder               | `packages/gateway/src/tools/claw/sandbox-env.ts`                     |
| Management tools                  | `packages/gateway/src/tools/claw-management-tools.ts`                |
| Claw repo                         | `packages/gateway/src/db/repositories/claws.ts`                      |
| Workflow executor                 | `packages/gateway/src/services/workflow/executors/claw.ts`           |
| Tool registry                     | `packages/gateway/src/services/tool-executor.ts`                     |
| Agent tool registry               | `packages/gateway/src/services/agent-tool-registry.ts`               |
| Agent runner utils                | `packages/gateway/src/services/agent-runner-utils.ts`                |
| Shared cost calc                  | `packages/core/src/llm/cost.ts`                                      |
| Workspace                         | `packages/gateway/src/workspace/file-workspace.ts`                   |
| EventBus service                  | `packages/gateway/src/services/events/event-bus.ts`                  |
| REST routes                       | `packages/gateway/src/routes/claws.ts` (16 endpoints)                |
| Settings routes (LLM concurrency) | `packages/gateway/src/routes/settings.ts`                            |
| WebSocket                         | `packages/gateway/src/routes/_ws.ts`                                 |
| ClawsPage UI                      | `packages/ui/src/pages/ClawsPage.tsx`                                |
| ConcurrencyBar                    | `packages/ui/src/pages/claws/ConcurrencyBar.tsx`                     |
| ArtifactRenderer                  | `packages/ui/src/components/ArtifactRenderer.tsx`                    |
| ArtifactDetailModal               | `packages/ui/src/components/ArtifactDetailModal.tsx`                 |
| ClawsWidget                       | `packages/ui/src/components/claws/claws-widget.tsx`                  |
| DB migrations                     | `packages/gateway/src/db/migrations/postgres/022_claw_sessions.sql`  |
|                                   | `packages/gateway/src/db/migrations/postgres/023_claw_audit_log.sql` |
| Sandbox escape tests              | `packages/core/src/sandbox/sandbox-escape.test.ts`                   |
| Manager tests                     | `packages/gateway/src/services/claw-manager.test.ts`                 |
| Runner tests                      | `packages/gateway/src/services/claw-runner.test.ts`                  |

---

## 14. REST API (16 + 2 endpoints)

All under `/api/v1/claws`:

| Method   | Path                      | Purpose                                  |
| -------- | ------------------------- | ---------------------------------------- |
| `POST`   | `/`                       | Create claw                              |
| `GET`    | `/:id`                    | Get claw config                          |
| `GET`    | `/`                       | List user's claws                        |
| `PATCH`  | `/:id`                    | Update claw config                       |
| `DELETE` | `/:id`                    | Delete claw                              |
| `POST`   | `/:id/start`              | Start claw                               |
| `POST`   | `/:id/pause`              | Pause claw                               |
| `POST`   | `/:id/resume`             | Resume claw                              |
| `POST`   | `/:id/stop`               | Stop claw                                |
| `POST`   | `/:id/execute-now`        | Trigger immediate cycle                  |
| `GET`    | `/:id/session`            | Get current session                      |
| `GET`    | `/:id/history`            | Get cycle history                        |
| `GET`    | `/:id/audit`              | Get audit log entries                    |
| `POST`   | `/:id/message`            | Send message to inbox                    |
| `POST`   | `/:id/approve-escalation` | Approve escalated action                 |
| `POST`   | `/:id/deny-escalation`    | Deny escalated action                    |
| `GET`    | `/stats`                  | Aggregated claw stats + `llmConcurrency` |
| `GET`    | `/presets`                | List claw presets                        |
| `GET`    | `/recommendations`        | List health recommendations              |
| `POST`   | `/recommendations/apply`  | Batch-apply recommendations              |

**Settings endpoints for LLM concurrency:**

| Method | Path                            | Purpose                                            |
| ------ | ------------------------------- | -------------------------------------------------- |
| `GET`  | `/settings/max-llm-concurrency` | Get `{ maxConcurrency, activeCalls, queuedCalls }` |
| `PUT`  | `/settings/max-llm-concurrency` | Set max concurrency slots (≥1)                     |

---

## 15. Prompt Injection and .claw/ Scaffolding

**File:** `packages/gateway/src/services/claw-runner.ts` (`.claw/` directive system at line 448)

Every cycle prompt includes:

1. **System preamble** — Identity, mission, tool allowlist, limits
2. **INSTRUCTIONS.md** — The claw's directives (fresh-read every cycle)
3. **TASKS.md** — Task list with "Current files and directives are listed in each cycle message"
4. **Context** — Workspace path, working memory summary, inbox messages
5. **Previous cycle** — Last LOG.md entry (previous cycle summary)
6. **Mission** — Original `mission` field (not re-read, in-memory on manager)

This means the claw can edit any `.claw/` file and see the effect next cycle — including changing its own identity, constraints, and task list.

---

## 16. Artifact System

Claws publish artifacts via `claw_publish_artifact`. Artifacts are rendered by type:

| Type       | Renderer                           | Notes                                                      |
| ---------- | ---------------------------------- | ---------------------------------------------------------- |
| `html`     | `ArtifactRenderer` (iframe srcdoc) | Auto-height via postMessage; CSP sandbox                   |
| `chart`    | `ArtifactRenderer` (iframe srcdoc) | Same as HTML; data bindings via `window.__DATA__`          |
| `svg`      | `ArtifactRenderer` (iframe srcdoc) | No raw innerHTML; XSS safe                                 |
| `markdown` | `MarkdownContent`                  | Prose rendered; scrollable in card view (max-height 12rem) |
| `form`     | JSON schema form                   | Custom tool for structured input                           |
| `react`    | Placeholder                        | Not yet supported                                          |

**ArtifactDetailModal** (full-screen viewer):

- Content area uses `flex flex-col h-full min-h-0` so iframe fills available height
- `autoHeight` prop enables postMessage-based resize (no dead space at bottom)
- Source view toggle shows raw content

**ArtifactCard** (grid listing):

- `cardView` prop truncates markdown at 12rem with `overflow-y-auto`
- Prevents excessively tall cards in the 3-column grid

---
