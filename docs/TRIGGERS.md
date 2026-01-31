# Trigger System

The OwnPilot trigger system provides proactive automation for the AI assistant. Instead of waiting for user commands, triggers fire autonomously based on schedules, system events, evaluated conditions, or incoming webhooks. When a trigger fires, it executes an action -- sending a chat message through the agent, calling a tool, posting a notification, checking goal status, or summarizing memories.

This document covers every aspect of the system: database schema, trigger types and configuration, action types, the trigger engine, the plan integration, the autonomy layer, the REST API, the agent tools, the built-in proactive behaviors, and the seed data.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Trigger Types](#trigger-types)
   - [Schedule Triggers](#schedule-triggers)
   - [Event Triggers](#event-triggers)
   - [Condition Triggers](#condition-triggers)
   - [Webhook Triggers](#webhook-triggers)
4. [Action Types](#action-types)
5. [Trigger Engine](#trigger-engine)
6. [Trigger-Plan Integration](#trigger-plan-integration)
7. [Autonomy System](#autonomy-system)
8. [REST API Reference](#rest-api-reference)
9. [Agent Tools](#agent-tools)
10. [Built-in Proactive Behaviors](#built-in-proactive-behaviors)
11. [Seed Data](#seed-data)
12. [Source File Map](#source-file-map)

---

## Architecture Overview

```
                                      +-------------------+
                                      |   AutonomyPage    |
                                      |   (React UI)      |
                                      +--------+----------+
                                               |
                                      REST API calls
                                               |
                         +---------------------+---------------------+
                         |                                           |
               +---------v---------+                       +---------v---------+
               | /api/triggers/*   |                       | /api/autonomy/*   |
               | (Trigger Routes)  |                       | (Autonomy Routes) |
               +---------+---------+                       +---------+---------+
                         |                                           |
              +----------v----------+                     +----------v----------+
              | TriggersRepository  |                     | ApprovalManager     |
              | (DB Layer)          |                     | (Risk + Approvals)  |
              +----------+----------+                     +---------------------+
                         |
              +----------v----------+
              |   TriggerEngine     |  <-- singleton, runs in background
              |   (Processing)      |
              +---+------+------+---+
                  |      |      |
         Schedule |  Event|  Condition
         polling  |  emit |  evaluation
                  |      |      |
              +---v------v------v---+
              |   Action Handlers   |
              | chat | tool | notif |
              | goal_check | memory |
              +----------+----------+
                         |
              +----------v----------+
              |   Plans System      |
              |   (trigger_id FK)   |
              +---------------------+
```

Key components:

| Component | Location | Role |
|-----------|----------|------|
| `TriggerEngine` | `packages/gateway/src/triggers/engine.ts` | Singleton background processor that polls schedules, evaluates conditions, and dispatches event-based triggers |
| `TriggersRepository` | `packages/gateway/src/db/repositories/triggers.ts` | All database operations for the `triggers` and `trigger_history` tables |
| Trigger Routes | `packages/gateway/src/routes/triggers.ts` | REST API for CRUD, fire, enable/disable, history, stats, engine control |
| Trigger Tools | `packages/gateway/src/tools/trigger-tools.ts` | Six tools exposed to the AI agent for managing triggers via conversation |
| Proactive Module | `packages/gateway/src/triggers/proactive.ts` | Built-in default triggers shipped with the system |
| Plans Repository | `packages/gateway/src/db/repositories/plans.ts` | Plan execution with `trigger_id` foreign key back to the trigger |
| Autonomy Module | `packages/gateway/src/autonomy/` | Levels, risk assessment, approval workflow, budget controls |
| Autonomy Routes | `packages/gateway/src/routes/autonomy.ts` | REST API for autonomy configuration, approvals, budgets, tool permissions |
| AutonomyPage | `packages/ui/src/pages/AutonomyPage.tsx` | React UI for autonomy level selection, budget management, tool permissions, pending approvals |

---

## Database Schema

### `triggers` Table

Stores every trigger definition. Each row describes what should happen, when, and how.

```sql
CREATE TABLE IF NOT EXISTS triggers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL CHECK(type IN ('schedule', 'event', 'condition', 'webhook')),
  config      JSONB NOT NULL DEFAULT '{}',
  action      JSONB NOT NULL DEFAULT '{}',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  priority    INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
  last_fired  TIMESTAMP,
  next_fire   TIMESTAMP,
  fire_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT (PK) | auto-generated | Format: `trigger_{timestamp}_{random7}` |
| `user_id` | TEXT | `'default'` | Owner of the trigger; all queries are scoped by this value |
| `name` | TEXT | required | Human-readable name (e.g. "Daily Morning Summary") |
| `description` | TEXT | null | Optional longer explanation |
| `type` | TEXT | required | One of: `schedule`, `event`, `condition`, `webhook` |
| `config` | JSONB | `'{}'` | Type-specific configuration (see Trigger Types below) |
| `action` | JSONB | `'{}'` | What to do when the trigger fires (see Action Types below) |
| `enabled` | BOOLEAN | `TRUE` | Whether the trigger is active; disabled triggers are never evaluated |
| `priority` | INTEGER | `5` | 1 (lowest) to 10 (highest); affects processing order |
| `last_fired` | TIMESTAMP | null | When the trigger last executed |
| `next_fire` | TIMESTAMP | null | For schedule triggers: next calculated fire time from cron |
| `fire_count` | INTEGER | `0` | Total number of times this trigger has fired |
| `created_at` | TIMESTAMP | NOW() | Creation timestamp |
| `updated_at` | TIMESTAMP | NOW() | Last modification timestamp |

**Indexes:**

```sql
CREATE INDEX IF NOT EXISTS idx_triggers_user      ON triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_triggers_type      ON triggers(type);
CREATE INDEX IF NOT EXISTS idx_triggers_enabled   ON triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_triggers_next_fire ON triggers(next_fire);
```

### `trigger_history` Table

An append-only log of every trigger execution. Used for stats, debugging, and audit.

```sql
CREATE TABLE IF NOT EXISTS trigger_history (
  id          TEXT PRIMARY KEY,
  trigger_id  TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  fired_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  status      TEXT NOT NULL CHECK(status IN ('success', 'failure', 'skipped')),
  result      TEXT,
  error       TEXT,
  duration_ms INTEGER
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | Format: `hist_{timestamp}_{random7}` |
| `trigger_id` | TEXT (FK) | References `triggers(id)`; cascading delete |
| `fired_at` | TIMESTAMP | When execution started |
| `status` | TEXT | `success`, `failure`, or `skipped` |
| `result` | TEXT | JSON-serialized result data on success |
| `error` | TEXT | Error message on failure |
| `duration_ms` | INTEGER | Execution wall-clock time in milliseconds |

**Indexes:**

```sql
CREATE INDEX IF NOT EXISTS idx_trigger_history_trigger ON trigger_history(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_history_fired   ON trigger_history(fired_at DESC);
```

### Relationship to `plans` Table

The `plans` table has a foreign key back to `triggers`:

```sql
trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL
```

When a trigger fires and creates a plan, the plan's `trigger_id` is set so the system can trace which trigger originated the plan. The `source` and `source_id` fields on the plan provide additional provenance tracking. If the trigger is deleted, `trigger_id` on existing plans is set to `NULL` rather than cascading the delete.

---

## Trigger Types

Every trigger has a `type` field that determines how it is evaluated and what its `config` JSONB contains.

### Schedule Triggers

**Type value:** `schedule`

Schedule triggers fire at specific times defined by a cron expression. The trigger engine polls for due schedule triggers at a configurable interval (default: every 60 seconds). When a schedule trigger is created or updated, the system calculates the next fire time from the cron expression and stores it in `next_fire`. After each firing, `next_fire` is recalculated.

**Config Interface:**

```typescript
interface ScheduleConfig {
  cron: string;       // Required. 5-field cron expression.
  timezone?: string;  // Optional. E.g. "Europe/Istanbul", "local".
}
```

**Cron Expression Format:**

Standard 5-field cron: `minute hour day-of-month month day-of-week`

| Field | Allowed Values | Special Characters |
|-------|---------------|-------------------|
| Minute | 0-59 | `*` `,` `-` `/` |
| Hour | 0-23 | `*` `,` `-` `/` |
| Day of Month | 1-31 | `*` `,` `-` `/` |
| Month | 1-12 | `*` `,` `-` `/` |
| Day of Week | 0-6 (0 = Sunday) | `*` `,` `-` `/` |

**Cron Examples:**

| Expression | Meaning |
|-----------|---------|
| `0 8 * * *` | Every day at 08:00 |
| `0 9 * * 1-5` | Weekdays at 09:00 |
| `*/15 * * * *` | Every 15 minutes |
| `0 20 * * *` | Every day at 20:00 |
| `0 9 * * 1` | Every Monday at 09:00 |
| `0 0 1 * *` | First of every month at midnight |
| `0 18 * * 0` | Every Sunday at 18:00 |
| `0 2 * * *` | Every day at 02:00 |
| `0 21 * * *` | Every day at 21:00 |

**Validation:** Cron expressions are validated at creation time using the `validateCronExpression` utility from `@ownpilot/core`. Invalid expressions are rejected with a `400 INVALID_CRON` error. Additionally, the system verifies that the expression produces a valid next fire time -- if it does not, creation is blocked.

**Lifecycle:**

1. Trigger created with valid cron -- `next_fire` is calculated and stored.
2. Engine polls `getDueTriggers()` which returns all enabled schedule triggers where `next_fire <= NOW()`.
3. Engine executes the trigger's action.
4. `last_fired` is set to now, `fire_count` is incremented.
5. `next_fire` is recalculated from the cron expression.
6. If `next_fire` cannot be computed, a warning is logged and the trigger will not auto-fire again.

---

### Event Triggers

**Type value:** `event`

Event triggers fire in response to system events emitted through the trigger engine's event bus. They are evaluated in real time when an event occurs, not on a polling schedule.

**Config Interface:**

```typescript
interface EventConfig {
  eventType: string;                     // Required. The event name to listen for.
  filters?: Record<string, unknown>;     // Optional. Key-value filters on the event payload.
}
```

**Available Event Types:**

| Event | Emitted When |
|-------|-------------|
| `goal_completed` | A goal is marked as complete |
| `memory_added` | A new memory is stored |
| `message_received` | An incoming message arrives |

**Filter Matching:**

When an event is emitted, the engine loads all enabled event triggers matching the event type, then checks each trigger's `filters` against the event payload. Every filter key-value pair must match the corresponding payload value for the trigger to fire. If no filters are specified, the trigger fires on every occurrence of the event.

**Filter Example:**

```json
{
  "eventType": "goal_completed",
  "filters": {
    "priority": 3
  }
}
```

This trigger fires only when a goal with `priority >= 3` is completed (using the `$gte` operator in the seed example, though basic equality is used in the engine's default filter logic).

**Lifecycle:**

1. Code elsewhere calls `engine.emit('goal_completed', { goalId: '...', priority: 5 })`.
2. Engine fetches all enabled event triggers with `eventType === 'goal_completed'`.
3. For each trigger, filters are evaluated against the payload.
4. Matching triggers execute their action, with the event payload merged into the action payload.

---

### Condition Triggers

**Type value:** `condition`

Condition triggers are evaluated periodically by the engine. They check a named condition against the system state and fire when the condition is met. Unlike schedule triggers, they do not have a cron expression -- they are polled on a separate interval.

**Config Interface:**

```typescript
interface ConditionConfig {
  condition: string;       // Required. The condition name to evaluate.
  threshold?: number;      // Optional. Meaning depends on condition type.
  checkInterval?: number;  // Optional. Minutes between evaluations. Default: 60.
}
```

**Available Conditions:**

| Condition | Description | Threshold Meaning | Default Threshold |
|-----------|-------------|-------------------|-------------------|
| `stale_goals` | True if any active goals have not been updated in N days | Days since last update | 3 |
| `upcoming_deadline` | True if any goals have deadlines within N days | Days until deadline | 7 |
| `memory_threshold` | True if total memory count exceeds N | Memory count | 100 |
| `low_progress` | True if any active goals have progress below N% | Progress percentage | 20 |
| `no_activity` | True if there has been no recent activity | Not used | N/A |

**Check Interval Throttling:**

To prevent a condition trigger from firing repeatedly while a condition remains true, the engine enforces a minimum interval between firings. If a trigger has `lastFired` and less than `checkInterval` minutes (default: 60) have elapsed, evaluation is skipped for that cycle.

**Lifecycle:**

1. Engine runs the condition check loop at the configured `conditionCheckIntervalMs` (default: every 5 minutes).
2. All enabled condition triggers are fetched.
3. For each trigger, the engine checks whether enough time has passed since `last_fired` (using the trigger's `checkInterval` in minutes, converted to milliseconds).
4. If the interval has elapsed, the named condition is evaluated using live data from the Goals and Memories repositories.
5. If the condition returns `true`, the trigger's action is executed.

---

### Webhook Triggers

**Type value:** `webhook`

Webhook triggers are designed to be fired by external HTTP calls. They provide a mechanism for outside systems (GitHub, CI/CD pipelines, third-party services) to invoke actions in OwnPilot.

**Config Interface:**

```typescript
interface WebhookConfig {
  secret?: string;           // Optional. Shared secret for signature verification.
  allowedSources?: string[]; // Optional. Allowed origin domains/IPs. "*" allows all.
}
```

**Usage:**

Webhook triggers are not automatically polled or evaluated by the engine. They are typically fired manually via the `POST /triggers/:id/fire` endpoint or via the `fire_trigger` agent tool. The `secret` and `allowedSources` fields are available for custom middleware to validate incoming webhook requests.

**Config Example:**

```json
{
  "secret": "github-webhook-secret",
  "allowedSources": ["api.github.com"]
}
```

---

## Action Types

Every trigger has an `action` field (JSONB) that describes what happens when it fires. The action has a `type` and a `payload`.

**Action Interface:**

```typescript
interface TriggerAction {
  type: 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary';
  payload: Record<string, unknown>;
}
```

### `chat`

Sends a message through the AI agent system. The engine uses an injected chat handler (set via `engine.setChatHandler()` during server initialization) to route the message to the agent.

| Payload Key | Type | Description |
|-------------|------|-------------|
| `prompt` or `message` | string | The text to send to the agent |
| `agentId` | string | Optional. Target agent identifier |
| `includeContext` | boolean | Optional. Whether to include contextual data |

If the chat handler is not yet initialized (e.g., during early startup), the action is logged and returns success with a note that the agent was not available.

### `tool`

Executes a registered tool via the shared tool executor service.

| Payload Key | Type | Description |
|-------------|------|-------------|
| `tool` | string | Required. Name of the tool to execute |
| `toolName` | string | Alternative key (used in some seed examples) |
| (other keys) | any | Passed through as tool arguments |

The engine strips internal metadata keys (`tool`, `triggerId`, `triggerName`, `manual`) before passing the remaining payload as tool arguments. The tool must be registered in the system -- the engine calls `hasTool()` to verify before execution.

### `notification`

Logs a notification message. This is the simplest action type -- it writes to the console and returns success.

| Payload Key | Type | Description |
|-------------|------|-------------|
| `message` | string | The notification text |
| `title` | string | Optional. Notification title |
| `template` | string | Optional. Template with `{{variable}}` placeholders |
| `priority` | string | Optional. `"high"`, `"normal"`, etc. |
| `channel` | string | Optional. `"push"`, `"email"`, etc. |

### `goal_check`

Queries the Goals repository for stale goals and returns a summary.

| Payload Key | Type | Description |
|-------------|------|-------------|
| `staleDays` | number | Days without update to consider a goal stale (default: 3) |
| `reviewType` | string | Optional. E.g. `"weekly"` |
| `includeMetrics` | boolean | Optional. Include additional metrics |

### `memory_summary`

Queries the Memories repository for aggregate statistics and returns a summary.

| Payload Key | Type | Description |
|-------------|------|-------------|
| `maxAge` | number | Optional. Maximum age in days |
| `categories` | string[] | Optional. Memory categories to include |

---

## Trigger Engine

The `TriggerEngine` class is a singleton background processor.

**Source:** `packages/gateway/src/triggers/engine.ts`

### Configuration

```typescript
interface TriggerEngineConfig {
  pollIntervalMs?: number;              // Interval for schedule trigger polling. Default: 60000 (1 minute)
  conditionCheckIntervalMs?: number;    // Interval for condition evaluation. Default: 300000 (5 minutes)
  enabled?: boolean;                    // Whether the engine starts. Default: true
  userId?: string;                      // User scope. Default: 'default'
}
```

### Lifecycle

```
getTriggerEngine(config?)   -->  creates singleton (lazy)
engine.start()              -->  starts two interval timers + runs initial checks
engine.stop()               -->  clears both timers
engine.isRunning()          -->  returns boolean
```

### Internal Timers

| Timer | Default Interval | Purpose |
|-------|-----------------|---------|
| `pollTimer` | 60,000ms (1 min) | Calls `processScheduleTriggers()` -- fetches due schedule triggers and executes them |
| `conditionTimer` | 300,000ms (5 min) | Calls `processConditionTriggers()` -- evaluates all enabled condition triggers |

Both timers run their processing function immediately on `start()`, then repeat at the configured interval.

### Processing Flow

**Schedule Triggers:**

```
processScheduleTriggers()
  |-- repo.getDueTriggers()  // WHERE enabled=true AND type='schedule' AND next_fire <= NOW()
  |-- for each trigger:
        |-- executeTrigger(trigger)
              |-- lookup action handler by action.type
              |-- merge action.payload with event payload + trigger metadata
              |-- call handler
              |-- log execution to trigger_history
              |-- calculateNextFire() from cron
              |-- repo.markFired(id, nextFire)
```

**Condition Triggers:**

```
processConditionTriggers()
  |-- repo.getConditionTriggers()  // WHERE enabled=true AND type='condition'
  |-- for each trigger:
        |-- check checkInterval throttle (skip if fired too recently)
        |-- evaluateCondition(config)  // switch on condition name
        |-- if true: executeTrigger(trigger)
```

**Event Triggers:**

```
engine.emit(eventType, payload)
  |-- notify local event handlers (engine.on() subscribers)
  |-- repo.getByEventType(eventType)  // WHERE enabled=true AND type='event'
  |-- for each trigger:
        |-- match filters against payload
        |-- if all filters match: executeTrigger(trigger, payload)
```

### Action Handler Registration

The engine maintains a map of action type names to handler functions. Default handlers are registered in the constructor:

- `notification` -- logs message, returns success
- `goal_check` -- queries active goals, filters stale ones
- `memory_summary` -- returns memory statistics
- `chat` -- uses injected `ChatHandler` (or logs fallback)
- `tool` -- verifies tool exists, then calls `executeTool()`

Custom handlers can be added via:

```typescript
engine.registerActionHandler('my_action', async (payload) => {
  // ... custom logic
  return { success: true, message: '...', data: { ... } };
});
```

### Chat Handler Injection

The chat handler is not available at engine construction time because the agent system initializes after the engine. The server calls `engine.setChatHandler(handler)` once agents are ready. Until then, `chat` actions fall back to console logging.

### Manual Firing

Any trigger can be fired manually regardless of its type, schedule, or enabled state:

```typescript
const result = await engine.fireTrigger(triggerId);
// result: { success: boolean, message?: string, data?: any, error?: string }
```

Manual firings are logged to `trigger_history` with the same schema as automatic firings. The payload includes `manual: true` to distinguish manual from automatic executions.

---

## Trigger-Plan Integration

Triggers and plans are connected through two mechanisms:

### 1. The `trigger_id` Foreign Key

The `plans` table has a `trigger_id` column that references `triggers(id)`. When a trigger creates a plan:

```typescript
const plan = await plansRepo.create({
  name: 'Morning Routine Analysis',
  goal: 'Provide morning briefing',
  triggerId: trigger.id,        // Links back to the trigger
  source: 'trigger',            // Provenance tracking
  sourceId: trigger.id,         // Additional provenance
  autonomyLevel: 3,
});
```

Plans can be queried by their originating trigger:

```typescript
const plans = await plansRepo.list({ triggerId: 'trigger_123...' });
```

### 2. Plan Step Types

Plans consist of ordered steps, each with a type that determines execution behavior:

| Step Type | Description |
|-----------|-------------|
| `tool_call` | Execute a named tool with arguments |
| `llm_decision` | Send a prompt to the LLM for analysis/decision |
| `user_input` | Pause and wait for user input (text, choice, confirm) |
| `condition` | Evaluate a condition and branch (true/false step) |
| `parallel` | Execute multiple steps concurrently |
| `loop` | Repeat a step with a termination condition |
| `sub_plan` | Execute another plan as a sub-plan |

### 3. Execution Flow

```
Trigger fires
  |-- Action handler creates a Plan with trigger_id set
  |-- Plan status: pending -> running
  |-- Steps execute in order_num sequence
  |-- Dependencies are checked before each step
  |-- Progress is recalculated after each step completion
  |-- Plan status: running -> completed | failed
  |-- History events logged at each state change
```

### 4. Plan Status Tracking

| Status | Description |
|--------|-------------|
| `pending` | Created but not yet started |
| `running` | Currently executing steps |
| `paused` | Execution paused (e.g., waiting for user input) |
| `completed` | All steps finished successfully |
| `failed` | One or more steps failed beyond retry limits |
| `cancelled` | Manually cancelled by user or system |

---

## Autonomy System

The autonomy system governs how much freedom the AI has to act without human approval. It works alongside the trigger system to control whether triggered actions execute immediately or require user confirmation.

**Source:** `packages/gateway/src/autonomy/`

### Autonomy Levels

| Level | Name | Enum Value | Behavior |
|-------|------|------------|----------|
| 0 | Manual | `MANUAL` | Always ask before any action. Maximum user control. |
| 1 | Assisted | `ASSISTED` | Suggest actions and wait for approval before executing. |
| 2 | Supervised | `SUPERVISED` | Execute low-risk actions automatically, ask for high-risk ones. **(Default)** |
| 3 | Autonomous | `AUTONOMOUS` | Execute all actions automatically, send notifications. |
| 4 | Full Autonomy | `FULL` | Fully autonomous operation with minimal notifications. |

### Autonomy Configuration

Each user has an `AutonomyConfig` that controls behavior:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | number (0-4) | 2 (Supervised) | Global autonomy level |
| `allowedTools` | string[] | `[]` | Tools that can run without approval regardless of level |
| `blockedTools` | string[] | `[]` | Tools that always need approval regardless of level |
| `allowedCategories` | ActionCategory[] | `[]` | Categories that bypass approval |
| `blockedCategories` | ActionCategory[] | `['system_command', 'code_execution']` | Categories that always require approval |
| `maxCostPerAction` | number | 1000 | Maximum cost (tokens) per autonomous action |
| `dailyBudget` | number | 10000 | Daily budget for autonomous actions |
| `dailySpend` | number | 0 | Current spend for the day |
| `budgetResetAt` | Date | auto | When the daily budget resets |
| `notificationThreshold` | number | 2 | Notify user for actions at or above this level |
| `confirmationRequired` | string[] | `['delete_data', 'send_email', 'make_payment', 'modify_system']` | Actions that always need explicit confirmation |
| `auditEnabled` | boolean | true | Whether to log all autonomous actions |
| `timeRestrictions` | TimeRestriction[] | `[]` | Time-based autonomy level overrides |

### Risk Assessment

Every action is assessed for risk before execution. The risk assessment considers the action category, type, parameters, and context.

**Risk Levels:**

| Level | Score Range | Description |
|-------|------------|-------------|
| `low` | 0-25 | Safe, routine operations |
| `medium` | 26-50 | Standard operations with some impact |
| `high` | 51-75 | Significant impact or irreversible actions |
| `critical` | 76-100 | Dangerous, expensive, or system-altering actions |

**Action Categories:**

| Category | Typical Risk |
|----------|-------------|
| `tool_execution` | Varies by tool |
| `data_modification` | Medium-High |
| `external_communication` | High |
| `file_operation` | Medium |
| `code_execution` | High-Critical |
| `system_command` | Critical |
| `api_call` | Medium |
| `notification` | Low |
| `plan_execution` | Medium |
| `memory_modification` | Medium |
| `goal_modification` | Medium |
| `financial` | High-Critical |

### Approval Workflow

When an action requires approval:

1. The system creates a `PendingAction` with risk assessment details.
2. The action appears in the AutonomyPage UI under "Pending Approvals".
3. The UI polls for pending approvals every 10 seconds.
4. The user can approve, reject, or modify the action.
5. Decisions can be "remembered" for similar future actions.
6. Pending actions have an expiration time.

**Pending Action Fields:**

```typescript
interface PendingAction {
  id: string;
  userId: string;
  category: ActionCategory;
  type: string;
  description: string;
  params: Record<string, unknown>;
  risk: RiskAssessment;
  context: ActionContext;
  requestedAt: Date;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
}
```

### Time-Based Restrictions

Autonomy levels can vary by time of day and day of week:

```typescript
interface TimeRestriction {
  daysOfWeek: number[];   // 0-6, Sunday=0
  startHour: number;      // 0-23
  endHour: number;        // 0-23
  level: AutonomyLevel;   // Override level during this period
}
```

Example: Lower autonomy to Manual during weekends:

```json
{
  "daysOfWeek": [0, 6],
  "startHour": 0,
  "endHour": 23,
  "level": 0
}
```

### Budget Controls

The autonomy system enforces spending limits on autonomous actions:

- **Daily Budget:** Total allowed cost across all autonomous actions per day.
- **Max Cost Per Action:** Cap on any single action's cost.
- **Budget Tracking:** `dailySpend` is incremented with each action and resets at `budgetResetAt`.
- **Budget Exceeded:** Actions are blocked when the daily budget is exhausted.

The AutonomyPage UI displays a progress bar of daily spend vs. budget, with color-coded thresholds (green < 70%, yellow 70-90%, red > 90%).

---

## REST API Reference

All trigger endpoints are mounted under `/api/triggers`. Query parameter `userId` defaults to `'default'` when omitted.

### Trigger CRUD

#### `GET /api/triggers`

List triggers with optional filters.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | No | User ID (default: `'default'`) |
| `type` | string | No | Filter by type: `schedule`, `event`, `condition`, `webhook` |
| `enabled` | string | No | `'true'` or `'false'` to filter by enabled state |
| `limit` | number | No | Maximum results (default: 20) |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "triggers": [
      {
        "id": "trigger_1234567890_abc1234",
        "userId": "default",
        "name": "Daily Morning Summary",
        "description": "...",
        "type": "schedule",
        "config": { "cron": "0 8 * * *", "timezone": "Europe/Istanbul" },
        "action": { "type": "chat", "payload": { "message": "..." } },
        "enabled": true,
        "priority": 5,
        "lastFired": null,
        "nextFire": "2026-01-31T05:00:00.000Z",
        "fireCount": 0,
        "createdAt": "2026-01-30T...",
        "updatedAt": "2026-01-30T..."
      }
    ],
    "total": 1
  }
}
```

---

#### `POST /api/triggers`

Create a new trigger.

**Request Body:**

```json
{
  "name": "Daily Morning Summary",
  "description": "Get a summary of tasks every morning",
  "type": "schedule",
  "config": {
    "cron": "0 8 * * *",
    "timezone": "Europe/Istanbul"
  },
  "action": {
    "type": "chat",
    "payload": {
      "message": "Good morning! Summarize my tasks for today."
    }
  },
  "enabled": true,
  "priority": 5
}
```

**Required fields:** `name`, `type`, `config`, `action`

**Validation:**
- Schedule triggers must include `config.cron` with a valid 5-field cron expression.
- Invalid cron returns `400 INVALID_CRON`.
- If the cron does not produce a valid next fire time, creation is rejected.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "trigger": { ... },
    "message": "Trigger created successfully."
  }
}
```

**Error Responses:**

| Status | Code | Reason |
|--------|------|--------|
| 400 | `INVALID_REQUEST` | Missing required fields |
| 400 | `INVALID_CRON` | Invalid cron expression or no next fire time |
| 400 | `CREATE_FAILED` | Database constraint violation |

---

#### `GET /api/triggers/:id`

Get a single trigger with its recent execution history.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "trigger_...",
    "name": "...",
    "recentHistory": [
      {
        "id": "hist_...",
        "triggerId": "trigger_...",
        "firedAt": "2026-01-30T...",
        "status": "success",
        "result": { ... },
        "error": null,
        "durationMs": 142
      }
    ]
  }
}
```

---

#### `PATCH /api/triggers/:id`

Update a trigger. Only provided fields are changed.

**Request Body (all fields optional):**

```json
{
  "name": "New Name",
  "description": "Updated description",
  "config": { "cron": "0 9 * * *" },
  "action": { "type": "notification", "payload": { "message": "..." } },
  "enabled": false,
  "priority": 8
}
```

If `config` is updated on a schedule trigger and includes `cron`, the new cron is validated. If `config` or `enabled` changes on a schedule trigger, `next_fire` is recalculated.

Priority is clamped to the range 1-10.

---

#### `DELETE /api/triggers/:id`

Permanently delete a trigger and all its history (cascade).

**Response (200):**

```json
{
  "success": true,
  "data": {
    "message": "Trigger deleted successfully."
  }
}
```

---

### Trigger Actions

#### `POST /api/triggers/:id/enable`

Enable a trigger.

#### `POST /api/triggers/:id/disable`

Disable a trigger.

#### `POST /api/triggers/:id/fire`

Manually fire a trigger immediately. The trigger does not need to be enabled to fire manually. Uses the trigger engine's `fireTrigger()` method.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "result": {
      "success": true,
      "message": "...",
      "data": { ... }
    },
    "message": "Trigger fired successfully."
  }
}
```

---

### History

#### `GET /api/triggers/history`

Get recent execution history across all triggers.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum entries |

**Response:** Returns array of history entries with `triggerName` included.

---

#### `GET /api/triggers/:id/history`

Get execution history for a specific trigger.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Maximum entries |

---

### Statistics

#### `GET /api/triggers/stats`

Get aggregate trigger statistics.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "total": 10,
    "enabled": 6,
    "byType": {
      "schedule": 3,
      "event": 3,
      "condition": 3,
      "webhook": 1
    },
    "totalFires": 42,
    "firesThisWeek": 12,
    "successRate": 95
  }
}
```

---

### Due Triggers

#### `GET /api/triggers/due`

Get schedule triggers whose `next_fire` is at or before the current time.

---

### History Cleanup

#### `POST /api/triggers/cleanup`

Remove old history entries.

**Request Body:**

```json
{
  "maxAgeDays": 30
}
```

Defaults to 30 days if omitted.

---

### Engine Control

#### `GET /api/triggers/engine/status`

Returns whether the trigger engine is running.

```json
{
  "success": true,
  "data": {
    "running": true
  }
}
```

#### `POST /api/triggers/engine/start`

Start the trigger engine.

#### `POST /api/triggers/engine/stop`

Stop the trigger engine. Clears all polling timers.

---

## Agent Tools

The AI agent can manage triggers through conversation using six tools in the `Automation` category.

**Source:** `packages/gateway/src/tools/trigger-tools.ts`

### `create_trigger`

Create a new proactive trigger.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Trigger name |
| `description` | string | No | What this trigger does |
| `type` | string | Yes | `schedule`, `event`, `condition`, `webhook` |
| `cron` | string | Conditional | Required for `schedule` type. 5-field cron expression. |
| `event_type` | string | Conditional | Required for `event` type. One of: `goal_completed`, `memory_added`, `message_received` |
| `condition` | string | Conditional | Required for `condition` type. One of: `stale_goals`, `upcoming_deadline`, `memory_threshold`, `low_progress`, `no_activity` |
| `threshold` | number | No | For `condition` type. Varies by condition (default: 3) |
| `action_type` | string | Yes | `chat`, `tool`, `notification`, `goal_check`, `memory_summary` |
| `action_payload` | object | Yes | Payload for the action |
| `enabled` | boolean | No | Default: `true` |
| `priority` | number | No | 1-10, default: 5 |

**Example (via agent conversation):**

> "Create a trigger that reminds me about stale goals every day at 9 AM."

The agent would call:

```json
{
  "name": "Daily Stale Goals Reminder",
  "type": "schedule",
  "cron": "0 9 * * *",
  "action_type": "chat",
  "action_payload": {
    "prompt": "Check for any goals that haven't been updated recently and remind me about them."
  }
}
```

---

### `list_triggers`

List all triggers with their status.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | Filter by trigger type |
| `enabled` | boolean | No | Filter by enabled status |

Returns up to 50 triggers with: id, name, type, enabled, priority, lastFired, nextFire, fireCount, description, actionType.

---

### `enable_trigger`

Enable or disable a trigger.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trigger_id` | string | Yes | Trigger ID |
| `enabled` | boolean | Yes | `true` to enable, `false` to disable |

---

### `fire_trigger`

Manually fire a trigger immediately, regardless of schedule or conditions.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trigger_id` | string | Yes | Trigger ID to fire |

---

### `delete_trigger`

Permanently delete a trigger.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trigger_id` | string | Yes | Trigger ID to delete |

---

### `trigger_stats`

Get aggregate statistics about triggers. No parameters. Returns total, enabled, byType, totalFires, firesThisWeek, successRate.

---

## Built-in Proactive Behaviors

The system ships with six default triggers that are created for each user on initialization. All are disabled by default -- the user must explicitly enable them.

**Source:** `packages/gateway/src/triggers/proactive.ts`

| Name | Type | Schedule/Condition | Action | Priority |
|------|------|-------------------|--------|----------|
| Morning Briefing | `schedule` | `0 8 * * *` (daily 8 AM) | `chat` -- generate briefing with goals, deadlines, events, priorities | 7 |
| Stale Goal Reminder | `condition` | `stale_goals`, threshold: 3 days, check every 6 hours | `notification` -- "goals need attention" | 5 |
| Deadline Warning | `condition` | `upcoming_deadline`, threshold: 3 days, check every 12 hours | `notification` -- "deadlines approaching" | 8 |
| Weekly Memory Summary | `schedule` | `0 18 * * 0` (Sunday 6 PM) | `memory_summary` | 4 |
| Low Progress Alert | `condition` | `low_progress`, threshold: 10%, check daily | `goal_check` -- find stale goals with 7-day threshold | 5 |
| Daily Goal Check | `schedule` | `0 21 * * *` (daily 9 PM) | `chat` -- review day's goal progress | 6 |

### Management Functions

```typescript
// Create defaults for a user (skips already-existing by name)
await initializeDefaultTriggers(userId);

// Get status of all proactive triggers
const status = await getProactiveStatus(userId);

// Enable/disable individual or all
await enableProactiveFeature('Morning Briefing', userId);
await disableProactiveFeature('Morning Briefing', userId);
await enableAllProactive(userId);
await disableAllProactive(userId);
```

---

## Seed Data

The seed script creates 10 sample triggers and 5 sample plans with detailed step configurations.

**Source:** `packages/gateway/scripts/seed-triggers-plans.ts`

**Run with:**

```bash
npx tsx packages/gateway/scripts/seed-triggers-plans.ts
```

The script requires the gateway API to be running (default: `http://localhost:3001/api`). Set the `API_URL` environment variable to override.

### Sample Triggers

| Name | Type | Description |
|------|------|-------------|
| Daily Morning Summary | `schedule` | Cron `0 8 * * *`, chat action for morning briefing |
| Weekly Review | `schedule` | Cron `0 18 * * 0`, goal_check action |
| Memory Consolidation | `schedule` | Cron `0 2 * * *`, memory_summary action (disabled) |
| Goal Completed Celebration | `event` | On `goal_completed`, notification action |
| High Priority Message Alert | `event` | On `message_received` (high priority), notification action |
| New Memory Learning | `event` | On `memory_added` (fact type), tool action (disabled) |
| Stale Goals Reminder | `condition` | `stale_goals` 7-day threshold, chat action |
| Deadline Approaching | `condition` | `upcoming_deadline` 24-hour threshold, notification action |
| Memory Storage Check | `condition` | `memory_threshold` 80%, notification action (disabled) |
| GitHub Webhook | `webhook` | External GitHub integration (disabled) |
| External API Webhook | `webhook` | Generic webhook processor (disabled) |

### Sample Plans

| Name | Steps | Autonomy Level | Description |
|------|-------|---------------|-------------|
| Morning Routine Analysis | 4 | 3 | Fetch calendar, fetch tasks, prioritize (LLM), send briefing |
| Weekly Goal Review | 5 | 2 | Fetch goals, calculate progress, analyze (LLM), user feedback, conditional action |
| Email Processing Pipeline | 5 | 4 | Fetch emails, categorize (LLM), check urgency, alert, archive |
| Code Review Assistant | 6 | 2 | Get PR URL (user input), fetch PR, review (LLM), confirm, conditional post |
| Research Topic Deep Dive | 7 | 3 | Get topic (user input), web search, fetch articles, check memories, synthesize (LLM), save, create memory |

---

## Source File Map

| File | Purpose |
|------|---------|
| `packages/gateway/src/db/schema.ts` | SQL schema for `triggers`, `trigger_history`, and `plans` tables with indexes |
| `packages/gateway/src/db/repositories/triggers.ts` | `TriggersRepository` class -- all CRUD, history, stats, due trigger queries |
| `packages/gateway/src/db/repositories/plans.ts` | `PlansRepository` class -- plan/step CRUD, progress tracking, dependency cycle detection |
| `packages/gateway/src/services/trigger-service.ts` | TriggerService -- business logic layer for trigger operations, EventBus emission |
| `packages/gateway/src/triggers/engine.ts` | `TriggerEngine` singleton -- polling, condition evaluation, event dispatch, action execution |
| `packages/gateway/src/triggers/proactive.ts` | Built-in default trigger definitions and management functions |
| `packages/gateway/src/triggers/index.ts` | Module barrel export |
| `packages/gateway/src/routes/triggers.ts` | Hono routes for trigger REST API (thin HTTP handler, delegates to TriggerService) |
| `packages/gateway/src/routes/autonomy.ts` | Hono routes for autonomy configuration, approvals, budgets |
| `packages/gateway/src/tools/trigger-tools.ts` | Agent-accessible tools for trigger management (6 tools) |
| `packages/gateway/src/autonomy/index.ts` | Autonomy module barrel export |
| `packages/gateway/src/autonomy/types.ts` | Autonomy levels, risk types, config, approval flow types |
| `packages/gateway/src/autonomy/risk.ts` | Risk assessment logic |
| `packages/gateway/src/autonomy/approvals.ts` | Approval manager singleton |
| `packages/gateway/scripts/seed-triggers-plans.ts` | Seed script for sample triggers and plans |
| `packages/ui/src/pages/AutonomyPage.tsx` | React UI for autonomy level, budget, tool permissions, pending approvals |
