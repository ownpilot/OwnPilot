# Plans -- Autonomous Plan Execution System

OwnPilot includes a full-featured autonomous plan execution system that enables the AI assistant to decompose complex goals into ordered steps and execute them independently. Plans support conditional branching, parallel execution, looping, sub-plan delegation, user-input gates, automatic retries with exponential backoff, checkpointing, rollback, and a complete audit trail.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
   - [plans table](#plans-table)
   - [plan_steps table](#plan_steps-table)
   - [plan_history table](#plan_history-table)
   - [Indexes](#indexes)
3. [Data Model and Types](#data-model-and-types)
   - [Plan](#plan)
   - [PlanStep](#planstep)
   - [PlanHistory](#planhistory)
   - [StepConfig](#stepconfig)
4. [Plan Status Lifecycle](#plan-status-lifecycle)
5. [Step Status Lifecycle](#step-status-lifecycle)
6. [Plan Step Types](#plan-step-types)
   - [tool_call](#tool_call)
   - [llm_decision](#llm_decision)
   - [user_input](#user_input)
   - [condition](#condition)
   - [parallel](#parallel)
   - [loop](#loop)
   - [sub_plan](#sub_plan)
7. [Autonomy Levels](#autonomy-levels)
8. [Plan Executor](#plan-executor)
   - [Execution Loop](#execution-loop)
   - [Step Execution](#step-execution)
   - [Dependency Resolution](#dependency-resolution)
   - [Deadlock Detection](#deadlock-detection)
   - [Timeout Handling](#timeout-handling)
   - [Retry Logic and Exponential Backoff](#retry-logic-and-exponential-backoff)
   - [Error Handling and Failure Policies](#error-handling-and-failure-policies)
   - [Branching and Step Skipping](#branching-and-step-skipping)
   - [Checkpointing](#checkpointing)
   - [Rollback](#rollback)
   - [Pause and Resume](#pause-and-resume)
   - [Abort](#abort)
9. [Event System](#event-system)
10. [Core Orchestrator Integration](#core-orchestrator-integration)
11. [API Reference](#api-reference)
    - [Plan CRUD](#plan-crud)
    - [Plan Execution](#plan-execution)
    - [Step Management](#step-management)
    - [History](#history)
    - [Executor Status](#executor-status)
12. [Agent Tools](#agent-tools)
13. [Integration with Triggers and Goals](#integration-with-triggers-and-goals)
    - [Trigger-Plan Connection](#trigger-plan-connection)
    - [Goal-Plan Connection](#goal-plan-connection)
14. [Repository Methods](#repository-methods)
    - [Plan CRUD Methods](#plan-crud-methods)
    - [Step Methods](#step-methods)
    - [History Methods](#history-methods)
    - [Progress and Statistics](#progress-and-statistics)
    - [Dependency Cycle Detection](#dependency-cycle-detection)
15. [Seed Data and Examples](#seed-data-and-examples)
16. [Source File Map](#source-file-map)

---

## Architecture Overview

The plan system is distributed across two packages:

```
packages/core/src/agent/orchestrator.ts     -- Planning agent interfaces (Plan, PlanStep),
                                               plan decomposition prompts, multi-agent orchestrator
packages/gateway/src/plans/executor.ts      -- PlanExecutor (runtime engine)
packages/gateway/src/plans/index.ts         -- Public module exports
packages/gateway/src/db/repositories/plans.ts -- PlansRepository (database layer)
packages/gateway/src/routes/plans.ts        -- Hono REST routes
packages/gateway/src/tools/plan-tools.ts    -- AI-agent tool definitions and handlers
packages/gateway/src/db/seeds/plans-seed.ts -- Example plan seeds
packages/gateway/scripts/seed-triggers-plans.ts -- Script-based seed via API
```

Data flows through four layers:

```
 AI Agent  --->  Plan Tools  --->  Plan Executor  --->  Plans Repository  --->  PostgreSQL
   (LLM)       (tool defs)       (runtime engine)     (SQL queries)           (tables)
```

1. The AI agent calls plan tools (`create_plan`, `add_plan_step`, `execute_plan`, etc.).
2. Plan tools delegate to `PlansRepository` for persistence and to `PlanExecutor` for runtime.
3. `PlanExecutor` iterates through steps, invokes registered step handlers, manages retries, checkpoints, and events.
4. `PlansRepository` performs all SQL operations against the `plans`, `plan_steps`, and `plan_history` tables.

---

## Database Schema

### plans table

Stores the top-level plan records.

```sql
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL DEFAULT 'default',
  name            TEXT NOT NULL,
  description     TEXT,
  goal            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','running','paused','completed','failed','cancelled')),
  current_step    INTEGER NOT NULL DEFAULT 0,
  total_steps     INTEGER NOT NULL DEFAULT 0,
  progress        REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority        INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
  source          TEXT,
  source_id       TEXT,
  trigger_id      TEXT REFERENCES triggers(id) ON DELETE SET NULL,
  goal_id         TEXT REFERENCES goals(id) ON DELETE SET NULL,
  autonomy_level  INTEGER NOT NULL DEFAULT 1 CHECK(autonomy_level >= 0 AND autonomy_level <= 4),
  max_retries     INTEGER NOT NULL DEFAULT 3,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  timeout_ms      INTEGER,
  checkpoint      TEXT,
  error           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  metadata        JSONB DEFAULT '{}'
);
```

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | TEXT | -- | PRIMARY KEY | Unique identifier (format: `plan_{timestamp}_{random}`) |
| `user_id` | TEXT | `'default'` | NOT NULL | Owner user ID |
| `name` | TEXT | -- | NOT NULL | Human-readable plan name |
| `description` | TEXT | NULL | -- | Detailed description |
| `goal` | TEXT | -- | NOT NULL | What this plan aims to achieve |
| `status` | TEXT | `'pending'` | NOT NULL, CHECK | Current plan state |
| `current_step` | INTEGER | 0 | NOT NULL | Index of the current or last completed step |
| `total_steps` | INTEGER | 0 | NOT NULL | Total number of steps (auto-updated on addStep) |
| `progress` | REAL | 0 | NOT NULL, 0-100 | Percentage complete (auto-calculated) |
| `priority` | INTEGER | 5 | NOT NULL, 1-10 | Execution priority (10 = highest) |
| `source` | TEXT | NULL | -- | What created this plan (e.g. "agent", "trigger", "user") |
| `source_id` | TEXT | NULL | -- | ID of the creating entity |
| `trigger_id` | TEXT | NULL | FK -> triggers(id), ON DELETE SET NULL | Associated trigger |
| `goal_id` | TEXT | NULL | FK -> goals(id), ON DELETE SET NULL | Associated goal |
| `autonomy_level` | INTEGER | 1 | NOT NULL, 0-4 | How autonomously the plan runs |
| `max_retries` | INTEGER | 3 | NOT NULL | Maximum plan-level retry attempts |
| `retry_count` | INTEGER | 0 | NOT NULL | Current plan-level retry count |
| `timeout_ms` | INTEGER | NULL | -- | Overall plan timeout in milliseconds |
| `checkpoint` | TEXT | NULL | -- | Serialized checkpoint state (JSON string) |
| `error` | TEXT | NULL | -- | Error message if the plan failed |
| `created_at` | TIMESTAMP | NOW() | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP | NOW() | NOT NULL | Last update timestamp |
| `started_at` | TIMESTAMP | NULL | -- | Set when status first transitions to `running` |
| `completed_at` | TIMESTAMP | NULL | -- | Set when status becomes `completed`, `failed`, or `cancelled` |
| `metadata` | JSONB | `'{}'` | -- | Arbitrary JSON metadata |

### plan_steps table

Stores individual steps belonging to a plan. Steps are cascade-deleted when their parent plan is deleted.

```sql
CREATE TABLE IF NOT EXISTS plan_steps (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  order_num     INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('tool_call','llm_decision','user_input',
                                             'condition','parallel','loop','sub_plan')),
  name          TEXT NOT NULL,
  description   TEXT,
  config        JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','running','completed','failed','skipped','blocked','waiting')),
  dependencies  JSONB DEFAULT '[]',
  result        TEXT,
  error         TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 3,
  timeout_ms    INTEGER,
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP,
  duration_ms   INTEGER,
  on_success    TEXT,
  on_failure    TEXT,
  metadata      JSONB DEFAULT '{}'
);
```

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | TEXT | -- | PRIMARY KEY | Unique identifier (format: `step_{timestamp}_{random}`) |
| `plan_id` | TEXT | -- | NOT NULL, FK -> plans(id), CASCADE | Parent plan |
| `order_num` | INTEGER | -- | NOT NULL | Execution order (1-based) |
| `type` | TEXT | -- | NOT NULL, CHECK | Step type (see [Plan Step Types](#plan-step-types)) |
| `name` | TEXT | -- | NOT NULL | Human-readable step name |
| `description` | TEXT | NULL | -- | What this step does |
| `config` | JSONB | `'{}'` | NOT NULL | Type-specific configuration (see [StepConfig](#stepconfig)) |
| `status` | TEXT | `'pending'` | NOT NULL, CHECK | Current step state |
| `dependencies` | JSONB | `'[]'` | -- | Array of step IDs that must complete first |
| `result` | TEXT | NULL | -- | JSON-serialized execution result |
| `error` | TEXT | NULL | -- | Error message if the step failed |
| `retry_count` | INTEGER | 0 | NOT NULL | Number of retries attempted |
| `max_retries` | INTEGER | 3 | NOT NULL | Maximum retry attempts |
| `timeout_ms` | INTEGER | NULL | -- | Step-level timeout in milliseconds |
| `started_at` | TIMESTAMP | NULL | -- | Set when status transitions to `running` |
| `completed_at` | TIMESTAMP | NULL | -- | Set when status reaches a terminal state |
| `duration_ms` | INTEGER | NULL | -- | Computed: `completed_at - started_at` |
| `on_success` | TEXT | NULL | -- | Step ID or action on success (branching) |
| `on_failure` | TEXT | NULL | -- | Step ID or action on failure (`'abort'`, `'skip'`, or step ID) |
| `metadata` | JSONB | `'{}'` | -- | Arbitrary JSON metadata |

### plan_history table

Append-only audit log for every significant plan event. Step references are nullified (SET NULL) when the step is deleted, but the history row itself is cascade-deleted when the plan is deleted.

```sql
CREATE TABLE IF NOT EXISTS plan_history (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  step_id     TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL CHECK(event_type IN (
    'started','step_started','step_completed','step_failed',
    'paused','resumed','completed','failed','cancelled','checkpoint'
  )),
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique identifier (format: `evt_{timestamp}_{random}`) |
| `plan_id` | TEXT | Parent plan |
| `step_id` | TEXT or NULL | Related step (if event is step-level) |
| `event_type` | TEXT | One of: `started`, `step_started`, `step_completed`, `step_failed`, `paused`, `resumed`, `completed`, `failed`, `cancelled`, `checkpoint` |
| `details` | JSONB | Event-specific data (results, errors, checkpoint data, duration) |
| `created_at` | TIMESTAMP | When the event occurred |

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_plans_user     ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_status   ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_priority ON plans(priority DESC);
CREATE INDEX IF NOT EXISTS idx_plans_goal     ON plans(goal_id);
CREATE INDEX IF NOT EXISTS idx_plans_trigger  ON plans(trigger_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan   ON plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status);
CREATE INDEX IF NOT EXISTS idx_plan_steps_order  ON plan_steps(plan_id, order_num);
```

---

## Data Model and Types

All TypeScript types are defined in `packages/gateway/src/db/repositories/plans.ts`.

### Plan

```typescript
interface Plan {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  goal: string;
  status: PlanStatus;           // 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  currentStep: number;
  totalSteps: number;
  progress: number;             // 0-100
  priority: number;             // 1-10
  source: string | null;
  sourceId: string | null;
  triggerId: string | null;
  goalId: string | null;
  autonomyLevel: number;        // 0-4
  maxRetries: number;
  retryCount: number;
  timeoutMs: number | null;
  checkpoint: string | null;    // JSON string
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}
```

### PlanStep

```typescript
interface PlanStep {
  id: string;
  planId: string;
  orderNum: number;
  type: StepType;               // 'tool_call' | 'llm_decision' | 'user_input' | 'condition' | 'parallel' | 'loop' | 'sub_plan'
  name: string;
  description: string | null;
  config: StepConfig;
  status: StepStatus;           // 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'waiting'
  dependencies: string[];       // Array of step IDs
  result: unknown;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  onSuccess: string | null;
  onFailure: string | null;
  metadata: Record<string, unknown>;
}
```

### PlanHistory

```typescript
interface PlanHistory {
  id: string;
  planId: string;
  stepId: string | null;
  eventType: PlanEventType;     // 'started' | 'step_started' | 'step_completed' | 'step_failed' | 'paused' | 'resumed' | 'completed' | 'failed' | 'cancelled' | 'checkpoint' | 'rollback'
  details: Record<string, unknown>;
  createdAt: Date;
}
```

### StepConfig

The `config` JSONB column is polymorphic based on step type:

```typescript
interface StepConfig {
  // For tool_call
  toolName?: string;
  toolArgs?: Record<string, unknown>;

  // For llm_decision
  prompt?: string;
  choices?: string[];

  // For user_input
  question?: string;
  inputType?: 'text' | 'choice' | 'confirm';
  options?: string[];
  timeout?: number;

  // For condition
  condition?: string;
  trueStep?: string;           // Step ID to jump to if true
  falseStep?: string;          // Step ID to jump to if false

  // For parallel
  steps?: string[];            // Array of tool definitions to run concurrently
  waitAll?: boolean;

  // For loop
  maxIterations?: number;
  loopCondition?: string;
  loopStep?: string;

  // For sub_plan
  subPlanId?: string;
}
```

---

## Plan Status Lifecycle

A plan transitions through the following states:

```
                  +---> running ---+--> completed
                  |        |       |
  pending --------+        |       +--> failed
                  |        v       |
                  |      paused    +--> cancelled
                  |        |
                  +--------+  (resume)
```

| Status | Description | Entered When |
|--------|-------------|--------------|
| `pending` | Created but not yet started. | Plan is first created, or after a rollback resets it. |
| `running` | Currently executing steps. | `execute()` or `resume()` is called; `started_at` is recorded on first transition. |
| `paused` | Execution is temporarily halted. | A `user_input` step is reached, manual pause via API, or `shouldPause` is returned by a step handler. |
| `completed` | All steps finished successfully. | Every step has reached `completed` or `skipped` status and no pending steps remain. `completed_at` is recorded. |
| `failed` | A step exhausted its retries and the failure policy is `abort`, or a dependency deadlock was detected. | `completed_at` is recorded along with the `error` field. |
| `cancelled` | Manually aborted by the user or system. | `abort()` is called. The `AbortController` signals all in-flight operations. `completed_at` is recorded. |

Key implementation details from `PlansRepository.update()`:
- `started_at` is set only on the first transition to `running` (not on subsequent resumes).
- `completed_at` is set whenever status becomes `completed`, `failed`, or `cancelled`.

---

## Step Status Lifecycle

Individual steps transition through these states:

```
                +--> running --> completed
                |       |
  pending ------+       +--> failed --> (retry) --> pending
                |                          |
                |                          +--> failed (final)
                +--> skipped
                +--> blocked
                +--> waiting
```

| Status | Description |
|--------|-------------|
| `pending` | Not started yet. This is the initial state and the state a step returns to when scheduled for retry. |
| `running` | Currently executing. `started_at` is recorded. |
| `completed` | Finished successfully. `completed_at` and `duration_ms` are recorded. Result is stored. |
| `failed` | An error occurred and either retries were exhausted or the step was marked as permanently failed. |
| `skipped` | Skipped due to a condition branch (steps between the current step and the branch target are skipped). |
| `blocked` | Waiting for dependencies that can never be met (deadlock detected). |
| `waiting` | Waiting for external input (e.g., user approval). |

When a step's status transitions to `completed`, `failed`, or `skipped`, the repository automatically sets `completed_at` and computes `duration_ms` from `started_at`.

---

## Plan Step Types

Each step type has a dedicated handler registered in `PlanExecutor.registerDefaultHandlers()`.

### tool_call

Executes a registered tool with the given arguments.

**Config:**
```json
{
  "toolName": "list_goals",
  "toolArgs": { "status": "active", "limit": 20 }
}
```

**Behavior:**
1. Validates that the tool exists via `hasTool()`.
2. Calls `executeTool(toolName, toolArgs, userId)`.
3. Wraps the result as `{ type: 'tool_call', toolName, result }`.
4. If the tool is not found, the step fails immediately.

### llm_decision

Delegates a decision to the AI agent. The LLM receives the prompt, optional choices, and context from all previous step results.

**Config:**
```json
{
  "prompt": "Based on the goal data, identify goals that need attention.",
  "choices": ["goals_healthy", "needs_attention", "critical_intervention"]
}
```

**Behavior:**
1. Dynamically imports the chat agent and resolves the current provider/model.
2. Constructs a full prompt by appending:
   - The choice list (if provided).
   - All previous step results from the `previousResults` map.
3. Calls `agent.chat(fullPrompt)`.
4. Returns `{ type: 'llm_decision', decision, toolCalls }`.

### user_input

Pauses the plan and waits for user input. The plan enters `paused` status until resumed.

**Config:**
```json
{
  "question": "Would you like to adjust goal priorities?",
  "inputType": "choice",
  "options": ["Adjust priorities", "Extend deadlines", "Keep as is"],
  "timeout": 86400000
}
```

**Behavior:**
1. Returns `shouldPause: true` immediately.
2. The executor sets the plan status to `paused`.
3. The plan remains paused until the user calls the resume API endpoint.
4. Supported input types: `text`, `choice`, `confirm`.

### condition

Branches execution based on a condition evaluation.

**Config:**
```json
{
  "condition": "result:step_123",
  "trueStep": "step_456",
  "falseStep": "step_789"
}
```

**Behavior:**
1. Evaluates the condition:
   - `"result:{stepId}"` -- checks if the referenced step has a truthy result in `previousResults`.
   - `"true"` -- always true.
   - `"false"` -- always false.
2. Returns `nextStep` pointing to either `trueStep` or `falseStep`.
3. The executor marks all steps between the current step and the target step as `skipped`.

### parallel

Executes multiple tool calls concurrently, respecting the `maxConcurrent` configuration.

**Config:**
```json
{
  "steps": [
    { "toolName": "list_goals", "toolArgs": { "status": "active" } },
    { "toolName": "list_tasks", "toolArgs": { "status": "pending" } }
  ]
}
```

**Behavior:**
1. Parses the steps array into `{ toolName, toolArgs }` pairs.
2. Splits into batches of `maxConcurrent` size (default: 5).
3. Each batch is executed with `Promise.allSettled()`.
4. All results are collected. The step succeeds only if every parallel sub-step succeeds.
5. If any sub-step fails, the overall parallel step reports `"Some parallel steps failed"`.

### loop

Repeats a tool call until either the maximum iterations are reached or the abort signal fires.

**Config:**
```json
{
  "toolName": "check_status",
  "toolArgs": { "target": "deployment" },
  "maxIterations": 10
}
```

**Behavior:**
1. Validates the tool exists.
2. Iterates up to `maxIterations` (default: 10).
3. Each iteration calls `executeTool()` with an additional `{ iteration: i }` argument.
4. If any iteration fails, the loop terminates early with the collected results.
5. The abort signal is checked between iterations.

### sub_plan

Executes another plan as a nested sub-plan. This enables hierarchical plan composition.

**Config:**
```json
{
  "subPlanId": "plan_1706000000_abc123"
}
```

**Behavior:**
1. Calls `this.execute(config.subPlanId)` recursively.
2. The sub-plan runs through the same executor pipeline (dependency resolution, retries, checkpointing).
3. The parent step succeeds if and only if the sub-plan completes successfully.

---

## Autonomy Levels

Plans have an `autonomy_level` field (0-4) that determines how much independent action the executor takes.

| Level | Name | Behavior |
|-------|------|----------|
| 0 | No autonomy | Requires explicit user approval for every step before execution. |
| 1 | Suggest and confirm | Suggests actions and waits for user approval before executing. This is the default. |
| 2 | Safe auto-execute | Executes routine and safe tasks automatically. Pauses and asks for approval on unusual or potentially destructive operations. |
| 3 | Full with safety checks | Full autonomy with safety guardrails. Executes all steps but applies safety checks before dangerous operations. |
| 4 | Complete autonomy | Unrestricted execution without any approval gates. |

The autonomy level is stored per-plan and can be set at creation time or updated later. It is also configurable at the executor level via `ExecutorConfig.autonomyLevel`.

---

## Plan Executor

The `PlanExecutor` class in `packages/gateway/src/plans/executor.ts` is the runtime engine. It is instantiated as a singleton via `getPlanExecutor()`.

### Executor Configuration

```typescript
interface ExecutorConfig {
  userId?: string;          // Default: 'default'
  maxConcurrent?: number;   // Default: 5 (for parallel step batches)
  defaultTimeout?: number;  // Default: 60000 (60 seconds per step)
  verbose?: boolean;        // Default: false
  autonomyLevel?: number;   // Default: 1
}
```

### Execution Loop

The core execution loop in `PlanExecutor.executeSteps()` works as follows:

```
while (true):
  1. Yield to event loop (setTimeout 0) to prevent blocking.
  2. Check abort signal. If aborted, throw "Plan execution aborted".
  3. Check pause flag. If paused, return (plan stays in paused status).
  4. Get the next pending step (first by order_num).
  5. If no pending step exists, mark plan as completed and return.
  6. Check if the step's dependencies are met.
     a. If met: execute the step.
     b. If not met: scan all pending steps for one with met dependencies.
        - If found: execute that step instead. Reset stall counter.
        - If not found: increment stall counter.
          - If stall counter >= 3 (MAX_STALL): detect deadlock, mark blocked
            steps, fail the plan with "Dependency deadlock".
          - Otherwise: wait 1 second and retry.
  7. After executing the step, recalculate plan progress.
  8. Loop back to step 1.
```

### Step Execution

Each step is executed by `PlanExecutor.executeStep()`:

1. Update step status to `running`.
2. Log `step_started` event.
3. Emit `step:started` event.
4. Build a `StepExecutionContext` with the plan, step, previous results, and abort signal.
5. Look up the registered handler for `step.type`.
6. Execute the handler with a timeout wrapper.
7. On success:
   - Store result in the `results` map.
   - Update step status to `completed`.
   - Log `step_completed` event.
   - Handle branching if `result.nextStep` is set.
   - Handle pause if `result.shouldPause` is true.
   - Handle approval if `result.requiresApproval` is true.
8. On failure: enter the retry logic (see below).

### Dependency Resolution

Steps can declare dependencies on other steps via the `dependencies` array (a list of step IDs). The executor checks dependencies with `PlansRepository.areDependenciesMet()`:

```typescript
async areDependenciesMet(stepId: string): Promise<boolean> {
  const step = await this.getStep(stepId);
  if (!step || step.dependencies.length === 0) return true;
  const completedSteps = await this.getStepsByStatus(step.planId, 'completed');
  const completedIds = new Set(completedSteps.map(s => s.id));
  return step.dependencies.every(depId => completedIds.has(depId));
}
```

A step can only execute when all of its dependencies have reached `completed` status.

### Deadlock Detection

When no pending step can execute because all pending steps have unmet dependencies, the executor enters a stall state. After 3 consecutive stalls (`MAX_STALL = 3`) with 1-second waits between them:

1. All pending steps with unmet dependencies are marked as `blocked`.
2. The plan is set to `failed` with error: `"Dependency deadlock: all pending steps have unmet dependencies"`.

### Circular Dependency Prevention

When adding a step with dependencies, `PlansRepository.addStep()` invokes `detectDependencyCycle()` which performs a DFS traversal of the dependency graph. If a cycle is detected, the step addition is rejected with an error message showing the cycle path, for example:

```
Circular dependency detected: Fetch Data -> Process Data -> (new step) -> Fetch Data
```

### Timeout Handling

Every step execution is wrapped in `executeWithTimeout()`:

```typescript
private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
  // Races the handler promise against a setTimeout rejection.
  // If the handler does not settle within `timeout` ms, the step fails with:
  // "Step timed out after {timeout}ms"
}
```

Timeout resolution order:
1. `step.timeoutMs` if set on the individual step.
2. `config.defaultTimeout` from executor config (default: 60000 ms).

### Retry Logic and Exponential Backoff

When a step fails:

1. Check `step.retryCount < step.maxRetries` (default max: 3).
2. If retries remain:
   - Compute backoff: `min(1000 * 2^retryCount, 30000)` milliseconds.
   - Wait for the backoff duration.
   - Reset step status to `pending` and increment `retryCount`.
   - Record the error on the step (for diagnostics).
   - The step will be picked up again in the next iteration of the execution loop.
3. If retries are exhausted:
   - Mark step as `failed`.
   - Log `step_failed` event.
   - Emit `step:failed` event.
   - Consult the failure policy (`on_failure` field).

**Backoff schedule (default max_retries = 3):**

| Attempt | Backoff |
|---------|---------|
| 1st retry | 1 second |
| 2nd retry | 2 seconds |
| 3rd retry | 4 seconds |

The cap is 30 seconds per backoff interval.

### Error Handling and Failure Policies

Each step has an `on_failure` field that determines what happens after all retries are exhausted:

| `on_failure` value | Behavior |
|--------------------|----------|
| `null` or `'abort'` | **Default.** The error propagates and the plan fails. |
| `'skip'` | The executor logs a warning and continues to the next step. |
| A step ID (e.g., `'step_789'`) | The executor jumps to the specified step. |

### Branching and Step Skipping

When a step (typically a `condition` step) returns `nextStep` in its result:

1. The executor locates the target step by ID.
2. All pending steps with `orderNum` between the current step and the target step are marked as `skipped`.
3. The `step:skipped` event is emitted for each skipped step with the reason `"Skipped due to condition branch"`.
4. Execution continues from the target step.

### Checkpointing

Checkpoints capture the plan's state at a point in time for recovery purposes.

**Creating a checkpoint:**
```
POST /plans/:id/checkpoint
Body: { "data": { ... arbitrary state ... } }
```

The executor serializes the checkpoint as:
```json
{
  "timestamp": "2025-01-30T12:00:00.000Z",
  "data": { ... }
}
```

This is stored in the `checkpoint` column of the `plans` table and a `checkpoint` event is logged to `plan_history`.

### Rollback

The rollback endpoint restores a plan to its last checkpoint state:

```
POST /plans/:id/rollback
```

**Rollback process:**

1. Verify a checkpoint exists (return error `NO_CHECKPOINT` if not).
2. Call `executor.restoreFromCheckpoint(id)` to parse the checkpoint data.
3. Reset all `failed` and `completed` steps back to `pending` (clearing their `error` and `result` fields).
4. Reset the plan status to `pending`.
5. Recalculate progress.
6. Log a `rollback` event with the checkpoint data in details.

After rollback, the plan can be re-executed from the beginning.

### Pause and Resume

**Pause** (`POST /plans/:id/pause`):
1. Adds the plan ID to the in-memory `pausedPlans` set.
2. Updates plan status to `paused` in the database.
3. Logs a `paused` event.
4. The execution loop checks `pausedPlans` at the start of each iteration and returns early.

**Resume** (`POST /plans/:id/resume`):
1. Validates the plan status is `paused`.
2. Removes the plan ID from `pausedPlans`.
3. Updates plan status to `running`.
4. Logs a `resumed` event.
5. Calls `execute()` which picks up from where the plan left off (completed steps are loaded from the database into the `results` map).

### Abort

**Abort** (`POST /plans/:id/abort`):
1. Retrieves the `AbortController` from the `runningPlans` map.
2. Calls `controller.abort()`, signaling all in-flight operations.
3. Updates plan status to `cancelled`.
4. Logs a `cancelled` event.

---

## Event System

The `PlanExecutor` extends `EventEmitter` and fires the following events:

| Event | Signature | When |
|-------|-----------|------|
| `plan:started` | `(plan: Plan)` | Plan execution begins |
| `plan:completed` | `(plan: Plan, result: ExecutionResult)` | All steps completed successfully |
| `plan:failed` | `(plan: Plan, error: string)` | Plan execution failed |
| `plan:paused` | `(plan: Plan)` | Plan was paused |
| `plan:resumed` | `(plan: Plan)` | Plan resumed after pause |
| `step:started` | `(plan: Plan, step: PlanStep)` | A step begins execution |
| `step:completed` | `(plan: Plan, step: PlanStep, result: StepResult)` | A step completed successfully |
| `step:failed` | `(plan: Plan, step: PlanStep, error: string)` | A step failed after all retries |
| `step:skipped` | `(plan: Plan, step: PlanStep, reason: string)` | A step was skipped due to branching |
| `approval:required` | `(plan: Plan, step: PlanStep, context: unknown)` | A step requires user approval |

Additionally, `plan_history` database events provide a persistent audit trail with the event types: `started`, `step_started`, `step_completed`, `step_failed`, `paused`, `resumed`, `completed`, `failed`, `cancelled`, `checkpoint`, `rollback`.

---

## Core Orchestrator Integration

The `packages/core/src/agent/orchestrator.ts` file provides a separate but complementary planning layer:

**Plan and PlanStep interfaces (core):**
```typescript
interface Plan {
  goal: string;
  steps: PlanStep[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  currentStep: number;
}

interface PlanStep {
  id: number;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  dependsOn: number[];
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  result?: unknown;
}
```

**Key functions:**
- `createPlanningPrompt(goal, availableTools)` -- Generates a structured prompt that asks the LLM to decompose a goal into steps with tool assignments and dependencies.
- `parsePlan(response)` -- Extracts a `Plan` JSON object from an LLM response.

**AgentOrchestrator** handles the LLM conversation loop:
- `execute(userMessage, conversationHistory, metadata)` -- Runs a tool-calling loop up to `maxIterations`.
- `stream(...)` -- Streaming variant with `AsyncGenerator<AgentStep>`.
- `cancel()` -- Aborts the current execution via `AbortController`.

**MultiAgentOrchestrator** manages teams of agents:
- `registerTeam(team)` -- Registers a named team with a router function.
- `execute(message, teamName, context)` -- Routes a message to the appropriate agent.

The core orchestrator is used by the gateway's `llm_decision` step handler: it dynamically imports the chat agent and calls `agent.chat()` with the step's prompt and previous results.

---

## API Reference

All routes are mounted under `/plans` in `packages/gateway/src/routes/plans.ts`. All endpoints accept an optional `?userId=` query parameter (defaults to `'default'`).

### Plan CRUD

#### `GET /plans`

List plans with optional filters.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `userId` | string | No | `'default'` | Filter by user |
| `status` | string | No | -- | Filter by status |
| `goalId` | string | No | -- | Filter by associated goal |
| `triggerId` | string | No | -- | Filter by associated trigger |
| `limit` | number | No | 20 | Maximum results |
| `offset` | number | No | 0 | Pagination offset |

**Response:** `200`
```json
{
  "success": true,
  "data": {
    "plans": [ ... ],
    "total": 5,
    "limit": 20,
    "offset": 0
  }
}
```

Plans are sorted by `priority DESC, created_at DESC`.

---

#### `POST /plans`

Create a new plan.

**Request Body:**
```json
{
  "name": "Weekly Report Generation",
  "goal": "Generate and send a weekly summary report",
  "description": "Automated weekly report with metrics",
  "priority": 7,
  "source": "agent",
  "sourceId": "agent_123",
  "triggerId": "trigger_456",
  "goalId": "goal_789",
  "autonomyLevel": 2,
  "maxRetries": 3,
  "timeoutMs": 300000,
  "metadata": { "category": "reporting" }
}
```

Required fields: `name`, `goal`.

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "plan": { ... },
    "message": "Plan created successfully."
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_REQUEST` | Missing `name` or `goal` |

---

#### `GET /plans/stats`

Get aggregate statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 25,
    "byStatus": {
      "pending": 5,
      "running": 2,
      "paused": 1,
      "completed": 15,
      "failed": 1,
      "cancelled": 1
    },
    "completionRate": 60.0,
    "avgStepsPerPlan": 4.2,
    "avgDurationMs": 12500
  }
}
```

---

#### `GET /plans/active`

Get all running or paused plans.

**Response:**
```json
{
  "success": true,
  "data": {
    "plans": [ ... ],
    "count": 3
  }
}
```

---

#### `GET /plans/pending`

Get all pending plans, sorted by `priority DESC, created_at ASC`.

---

#### `GET /plans/:id`

Get a specific plan with its steps and recent history (last 20 events).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "plan_1706000000_abc123",
    "name": "...",
    "goal": "...",
    "status": "running",
    "progress": 66.7,
    "steps": [ ... ],
    "recentHistory": [ ... ]
  }
}
```

---

#### `PATCH /plans/:id`

Update plan fields.

**Updatable fields:** `name`, `description`, `status`, `currentStep`, `progress`, `priority`, `autonomyLevel`, `checkpoint`, `error`, `metadata`.

---

#### `DELETE /plans/:id`

Delete a plan and all its steps and history (cascade).

---

### Plan Execution

#### `POST /plans/:id/execute`

Start executing a plan. Also aliased as `POST /plans/:id/start`.

**Preconditions:**
- Plan must exist.
- Plan must not already be running (returns `400 ALREADY_RUNNING`).

**Response (success):**
```json
{
  "success": true,
  "data": {
    "result": { "planId": "...", "status": "completed", "completedSteps": 3, "totalSteps": 3, "duration": 5000 },
    "message": "Plan executed successfully."
  }
}
```

**Response (failure):**
```json
{
  "success": false,
  "data": {
    "result": { "planId": "...", "status": "failed", "error": "..." },
    "message": "Plan execution ended with status: failed"
  },
  "error": { "code": "EXECUTION_ERROR", "message": "..." }
}
```

---

#### `POST /plans/:id/pause`

Pause a running plan.

---

#### `POST /plans/:id/resume`

Resume a paused plan. Returns error `NOT_PAUSED` if the plan is not in paused status.

---

#### `POST /plans/:id/abort`

Abort a running plan. Triggers the `AbortController`.

---

#### `POST /plans/:id/checkpoint`

Create a checkpoint for a plan.

**Request Body (optional):**
```json
{
  "data": { "custom": "state" }
}
```

---

#### `POST /plans/:id/rollback`

Rollback a plan to its last checkpoint. Returns error `NO_CHECKPOINT` if no checkpoint exists.

---

### Step Management

#### `GET /plans/:id/steps`

Get all steps for a plan, ordered by `order_num ASC`.

---

#### `POST /plans/:id/steps`

Add a step to a plan.

**Request Body:**
```json
{
  "orderNum": 1,
  "type": "tool_call",
  "name": "Fetch active goals",
  "description": "Get all active goals with their progress",
  "config": {
    "toolName": "list_goals",
    "toolArgs": { "status": "active", "limit": 20 }
  },
  "dependencies": [],
  "maxRetries": 3,
  "timeoutMs": 30000,
  "onSuccess": null,
  "onFailure": "abort",
  "metadata": {}
}
```

Required fields: `type`, `name`, `orderNum`.

The `total_steps` counter on the parent plan is automatically recalculated after insertion.

**Error:** If circular dependencies are detected, returns `500 ADD_STEP_ERROR` with the cycle path.

---

#### `GET /plans/:id/steps/:stepId`

Get a specific step by ID.

---

#### `PATCH /plans/:id/steps/:stepId`

Update step fields: `status`, `result`, `error`, `retryCount`, `metadata`.

---

### History

#### `GET /plans/:id/history`

Get the audit trail for a plan.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum events to return |

Events are sorted by `created_at DESC` (most recent first).

---

### Executor Status

#### `GET /plans/executor/status`

Get the current executor state.

**Response:**
```json
{
  "success": true,
  "data": {
    "runningPlans": ["plan_1706000000_abc123"]
  }
}
```

---

## Agent Tools

The AI agent interacts with the plan system through seven tools defined in `packages/gateway/src/tools/plan-tools.ts`. All tools are in the `Automation` category.

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `create_plan` | Create a new execution plan with a goal. | `name`, `goal` |
| `add_plan_step` | Add a step to an existing plan. | `plan_id`, `order`, `type`, `name` |
| `list_plans` | List all plans with status and progress. | -- |
| `get_plan_details` | Get detailed plan info with steps and history. | `plan_id` |
| `execute_plan` | Start executing a plan (non-blocking). | `plan_id` |
| `pause_plan` | Pause a running plan. | `plan_id` |
| `delete_plan` | Delete a plan permanently. | `plan_id` |

**Tool execution flow for `execute_plan`:**
The tool handler starts execution in the background (non-blocking) via `executor.execute(planId).catch(...)` and immediately returns a response indicating the plan is running. The agent can poll `get_plan_details` to check progress.

**Step creation via `add_plan_step`:**
The tool maps its flat parameters into the polymorphic `StepConfig`:
- `tool_name` and `tool_args` -> `config.toolName` and `config.toolArgs`
- `prompt` and `choices` -> `config.prompt` and `config.choices`
- `question` -> `config.question`

---

## Integration with Triggers and Goals

### Trigger-Plan Connection

Plans can be associated with triggers via the `trigger_id` foreign key. This enables:

- **Trigger-initiated plans:** A trigger fires and creates or starts a plan.
- **Querying by trigger:** `GET /plans?triggerId=trigger_123` lists all plans created by a specific trigger.
- **Referential integrity:** If the trigger is deleted, the plan's `trigger_id` is set to `NULL` (ON DELETE SET NULL) -- the plan itself is preserved.

Trigger types that can initiate plans:

| Trigger Type | Description | Example |
|--------------|-------------|---------|
| `schedule` | Cron-based scheduling | Run "Weekly Goal Review" plan every Sunday at 6 PM |
| `event` | Fires on system events | Start "Email Processing Pipeline" when new emails arrive |
| `condition` | Fires when conditions are met | Start "Task Cleanup" when stale tasks exceed threshold |
| `webhook` | Fires on external HTTP calls | Start "Code Review Assistant" from a GitHub webhook |

### Goal-Plan Connection

Plans can be associated with goals via the `goal_id` foreign key. This enables:

- **Goal-driven plans:** Plans that work toward achieving a specific goal.
- **Querying by goal:** `GET /plans?goalId=goal_789` lists all plans associated with a goal.
- **Progress correlation:** Goal progress can be inferred from associated plan completion rates.
- **Referential integrity:** If the goal is deleted, the plan's `goal_id` is set to `NULL` (ON DELETE SET NULL).

Goals have their own status lifecycle (`active`, `paused`, `completed`, `abandoned`) and support hierarchical decomposition with parent/child relationships via `parentId`.

---

## Repository Methods

The `PlansRepository` class in `packages/gateway/src/db/repositories/plans.ts` extends `BaseRepository` and provides all database operations.

### Plan CRUD Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `(input: CreatePlanInput) -> Promise<Plan>` | Creates a plan with a generated ID. Defaults: priority 5, autonomy 1, maxRetries 3. |
| `get` | `(id: string) -> Promise<Plan \| null>` | Fetches a plan by ID, scoped to the repository's userId. |
| `update` | `(id: string, input: UpdatePlanInput) -> Promise<Plan \| null>` | Partial update. Automatically sets `started_at` and `completed_at` based on status transitions. |
| `delete` | `(id: string) -> Promise<boolean>` | Deletes a plan (cascades to steps and history). |
| `list` | `(options) -> Promise<Plan[]>` | Lists plans with optional filters for status, goalId, triggerId. Sorted by priority DESC, created_at DESC. |
| `getActive` | `() -> Promise<Plan[]>` | Returns plans with status `running` or `paused`. |
| `getPending` | `() -> Promise<Plan[]>` | Returns plans with status `pending`, sorted by priority DESC, created_at ASC. |

### Step Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `addStep` | `(planId, input: CreateStepInput) -> Promise<PlanStep>` | Adds a step, checks for circular dependencies, and updates the plan's `total_steps`. |
| `getStep` | `(id: string) -> Promise<PlanStep \| null>` | Fetches a step by ID (joined with plan for user scoping). |
| `updateStep` | `(id, input: UpdateStepInput) -> Promise<PlanStep \| null>` | Partial update. Auto-computes `started_at`, `completed_at`, `duration_ms`. |
| `getSteps` | `(planId: string) -> Promise<PlanStep[]>` | All steps for a plan, ordered by `order_num ASC`. |
| `getNextStep` | `(planId: string) -> Promise<PlanStep \| null>` | First step with status `pending`. |
| `getStepsByStatus` | `(planId, status) -> Promise<PlanStep[]>` | Steps filtered by status. |
| `areDependenciesMet` | `(stepId: string) -> Promise<boolean>` | Checks if all dependency step IDs have `completed` status. |

### History Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `logEvent` | `(planId, eventType, stepId?, details?) -> Promise<void>` | Appends an event to `plan_history`. |
| `getHistory` | `(planId, limit?) -> Promise<PlanHistory[]>` | Fetches history events, most recent first. Default limit: 50. |

### Progress and Statistics

| Method | Signature | Description |
|--------|-----------|-------------|
| `recalculateProgress` | `(planId) -> Promise<number>` | Computes `(completed / total) * 100` and updates the plan. |
| `getStats` | `() -> Promise<{total, byStatus, completionRate, avgStepsPerPlan, avgDurationMs}>` | Aggregate statistics across all plans for the user. |

### Dependency Cycle Detection

The standalone function `detectDependencyCycle()` performs a DFS traversal:

```typescript
function detectDependencyCycle(
  existingSteps: PlanStep[],
  newDependencies: string[],
  newStepId: string = '__new__'
): string | null
```

It builds an adjacency list from all existing steps plus the proposed new step, then runs DFS from the new step. If a back-edge is found, it returns the cycle path as a human-readable string using step names.

---

## Seed Data and Examples

### Database Seed (plans-seed.ts)

Located at `packages/gateway/src/db/seeds/plans-seed.ts`. Creates three example plans if they do not already exist:

| Plan | Steps | Description |
|------|-------|-------------|
| Weekly Goal Review | 3 | Fetches active goals, gets next actions, then LLM analyzes progress. |
| Daily Memory Digest | 2 | Lists recent memories, then LLM generates a daily digest. |
| Task Cleanup | 2 | Lists pending tasks, then LLM identifies stale ones. |

### Script Seed (seed-triggers-plans.ts)

Located at `packages/gateway/scripts/seed-triggers-plans.ts`. Run with:

```bash
npx tsx scripts/seed-triggers-plans.ts
```

Creates five comprehensive example plans via the API:

| Plan | Steps | Autonomy | Description |
|------|-------|----------|-------------|
| Morning Routine Analysis | 4 | 3 | Calendar + tasks + LLM prioritization + notification |
| Weekly Goal Review | 5 | 2 | Goals + progress + LLM analysis + user input + condition |
| Email Processing Pipeline | 5 | 4 | Fetch emails + categorize + condition + alert + archive |
| Code Review Assistant | 6 | 2 | User input + fetch PR + LLM review + confirm + condition + post |
| Research Topic Deep Dive | 7 | 3 | User input + web search + fetch + memory + LLM synthesis + save |

Also creates 10 sample triggers (schedule, event, condition, webhook) that can be linked to plans.

---

## Source File Map

| File | Purpose |
|------|---------|
| `packages/gateway/src/plans/executor.ts` | PlanExecutor class: runtime engine with execute/pause/resume/abort/checkpoint |
| `packages/gateway/src/plans/index.ts` | Module exports for the plans package |
| `packages/gateway/src/db/repositories/plans.ts` | PlansRepository: all SQL operations, types, cycle detection |
| `packages/gateway/src/routes/plans.ts` | Hono REST API routes for plans |
| `packages/gateway/src/tools/plan-tools.ts` | AI agent tool definitions and execution handlers |
| `packages/gateway/src/db/seeds/plans-seed.ts` | Database seed with example plans |
| `packages/gateway/scripts/seed-triggers-plans.ts` | API-based seed script for triggers and plans |
| `packages/gateway/src/db/schema.ts` | SQL schema definitions (lines 442-503) |
| `packages/core/src/agent/orchestrator.ts` | Core Plan/PlanStep interfaces, planning prompts, AgentOrchestrator, MultiAgentOrchestrator |
