# Memory and Goal Systems

OwnPilot includes a persistent memory system and a long-term goal tracking system that together enable autonomous, context-aware AI behavior. The AI remembers facts about the user across conversations, tracks long-term objectives, and connects those objectives to executable plans and automated triggers.

This document provides a comprehensive reference for both systems: their database schemas, tool interfaces, internal lifecycle mechanics, prompt injection pipeline, and the integration points that tie memories, goals, plans, and triggers together.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Memory System](#memory-system)
  - [Database Schema: memories](#database-schema-memories)
  - [Memory Types](#memory-types)
  - [Memory Lifecycle](#memory-lifecycle)
  - [Importance Scoring](#importance-scoring)
  - [Memory Deduplication](#memory-deduplication)
  - [Memory Decay and Cleanup](#memory-decay-and-cleanup)
  - [Access Tracking](#access-tracking)
  - [Memory Tools](#memory-tools)
  - [Memory Tool Executor](#memory-tool-executor)
- [Memory Injection](#memory-injection)
  - [MemoryInjector Class](#memoryinjector-class)
  - [PersonalMemoryStore](#personalmemorystore)
  - [PromptComposer Pipeline](#promptcomposer-pipeline)
  - [Injection Flow Diagram](#injection-flow-diagram)
- [Conversation Memory](#conversation-memory)
  - [ConversationMemory Class](#conversationmemory-class)
  - [Persistence Strategies](#persistence-strategies)
  - [Token Estimation and Trimming](#token-estimation-and-trimming)
- [Goal System](#goal-system)
  - [Database Schema: goals](#database-schema-goals)
  - [Database Schema: goal_steps](#database-schema-goal_steps)
  - [Goal Statuses](#goal-statuses)
  - [Goal Priority](#goal-priority)
  - [Goal Hierarchy](#goal-hierarchy)
  - [Goal Decomposition](#goal-decomposition)
  - [Step Dependencies](#step-dependencies)
  - [Automatic Progress Recalculation](#automatic-progress-recalculation)
  - [Next Actions Resolution](#next-actions-resolution)
  - [Goal Tools](#goal-tools)
  - [Goal Tool Executor](#goal-tool-executor)
  - [Goal Statistics](#goal-statistics)
- [Gateway API](#gateway-api)
  - [Memory Endpoints](#memory-endpoints)
  - [Goal Endpoints](#goal-endpoints)
  - [Goal Step Endpoints](#goal-step-endpoints)
- [Cross-System Integration](#cross-system-integration)
  - [Goal-Plan Connection](#goal-plan-connection)
  - [Trigger-Goal Integration](#trigger-goal-integration)
  - [Memory-Goal Relationship](#memory-goal-relationship)
  - [Autonomy Integration](#autonomy-integration)
- [UI: GoalsPage](#ui-goalspage)
- [Source File Reference](#source-file-reference)

---

## Architecture Overview

```
                        +-------------------+
                        |   LLM Provider    |
                        +--------+----------+
                                 ^
                                 | system prompt with
                                 | injected memories
                                 |
+------------------+    +--------+----------+    +-------------------+
|  Personal Memory |    |  MemoryInjector   |    |  PromptComposer   |
|  Store (JSON)    +--->+  (memory-         +--->+  (prompt-         |
|                  |    |   injector.ts)     |    |   composer.ts)    |
+------------------+    +-------------------+    +-------------------+
                                                          |
                                                          v
+------------------+    +-------------------+    +-------------------+
|  Memories DB     |    |  Memory Tools     |    |  Agent Runtime    |
|  (PostgreSQL)    +<---+  (remember,       +<---+  (tool calls)     |
|                  |    |   recall, etc.)    |    |                   |
+------------------+    +-------------------+    +-------------------+

+------------------+    +-------------------+    +-------------------+
|  Goals DB        |    |  Goal Tools       |    |  Plans & Triggers |
|  (PostgreSQL)    +<---+  (create_goal,    +<-->+  (automation      |
|  + Goal Steps    |    |   decompose, etc.)|    |   system)         |
+------------------+    +-------------------+    +-------------------+
```

The system operates at three layers:

1. **Storage layer** -- PostgreSQL tables (`memories`, `goals`, `goal_steps`) and local JSON files for personal profile data.
2. **Tool layer** -- Tool definitions in `@ownpilot/core` and tool executors in `@ownpilot/gateway` that the AI invokes during conversations.
3. **Injection layer** -- The `MemoryInjector` and `PromptComposer` classes that automatically enrich every system prompt with user profile data, custom instructions, available capabilities, and time context before the prompt reaches the LLM.

---

## Memory System

### Database Schema: memories

The `memories` table lives in PostgreSQL and stores every piece of information the AI explicitly remembers about the user.

```sql
CREATE TABLE IF NOT EXISTS memories (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL DEFAULT 'default',
  type            TEXT NOT NULL CHECK(type IN (
                    'fact', 'preference', 'conversation', 'event', 'skill'
                  )),
  content         TEXT NOT NULL,
  embedding       BYTEA,
  source          TEXT,
  source_id       TEXT,
  importance      DOUBLE PRECISION NOT NULL DEFAULT 0.5
                    CHECK(importance >= 0 AND importance <= 1),
  tags            JSONB DEFAULT '[]'::jsonb,
  accessed_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  accessed_at     TIMESTAMP WITH TIME ZONE,
  metadata        JSONB DEFAULT '{}'::jsonb
);
```

**Key columns:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | UUID primary key |
| `user_id` | TEXT | Owner of the memory; defaults to `'default'` |
| `type` | TEXT | One of the five memory types (see below) |
| `content` | TEXT | The textual information being remembered |
| `embedding` | BYTEA | Reserved for future vector-based semantic search |
| `source` | TEXT | Where the memory originated (e.g., `'conversation'`) |
| `source_id` | TEXT | ID of the source entity (e.g., conversation ID) |
| `importance` | DOUBLE PRECISION | Floating-point score from 0.0 to 1.0 |
| `tags` | JSONB | Array of string tags for categorization |
| `accessed_count` | INTEGER | How many times this memory has been retrieved |
| `accessed_at` | TIMESTAMP | When the memory was last accessed |
| `metadata` | JSONB | Arbitrary key-value metadata |

**Indexes (for performance):**

```sql
CREATE INDEX idx_memories_user       ON memories(user_id);
CREATE INDEX idx_memories_type       ON memories(type);
CREATE INDEX idx_memories_importance  ON memories(importance DESC);
CREATE INDEX idx_memories_created     ON memories(created_at DESC);
CREATE INDEX idx_memories_accessed    ON memories(accessed_at DESC);
```

### Memory Types

Each memory must have exactly one type. The type constrains what kind of information the memory represents.

| Type | Description | Example |
|------|-------------|---------|
| `fact` | Factual information about the user or the world | "User's name is Alex" |
| `preference` | User preferences, likes, and dislikes | "User prefers dark mode in all applications" |
| `conversation` | Key conversation highlights worth preserving | "Discussed project architecture on 2025-06-15" |
| `event` | Important events, milestones, deadlines | "User's birthday is March 12" |
| `skill` | Skills and expertise the user possesses | "User is proficient in TypeScript and Rust" |

The `conversation` type is available in the database schema but is intentionally omitted from the tool-facing enum in `memory-tools.ts`. The `remember` and `batch_remember` tools expose only `fact`, `preference`, `event`, and `skill` to the AI, keeping conversation-type memories reserved for programmatic use.

### Memory Lifecycle

A memory goes through the following stages:

```
1. CREATION
   |
   +-- AI calls `remember` or `batch_remember` tool
   |   OR API POST /memories
   |
   +-- Deduplication check (findSimilar)
   |     |
   |     +-- If duplicate found: boost existing memory by +0.1
   |     +-- If no duplicate: INSERT new row with default importance 0.5
   |
2. ACTIVE USE
   |
   +-- AI calls `recall` or `list_memories`
   |   OR MemoryInjector fetches relevant memories
   |
   +-- On every read: accessed_count incremented, accessed_at updated
   |
   +-- AI calls `boost_memory` when information is reinforced
   |
3. DECAY (periodic)
   |
   +-- POST /memories/decay triggers importance decay
   |   - Memories not accessed in N days (default: 30)
   |   - importance *= decayFactor (default: 0.9)
   |   - Only affects memories with importance > 0.1
   |
4. DELETION
   |
   +-- AI calls `forget` (explicit user request)
   |   OR POST /memories/cleanup (automated)
   |     - Deletes memories where:
   |       importance < minImportance (default: 0.1)
   |       AND age > maxAge (default: 90 days)
   |       AND not recently accessed
   |   OR DELETE /memories/:id (direct API)
```

### Importance Scoring

Importance is a floating-point value between 0.0 and 1.0 that determines how prominently a memory surfaces during recall and injection.

**Initial assignment:**
- When the AI creates a memory via `remember`, it may specify an `importance` parameter.
- If not specified, the default is **0.5**.
- The AI's tool description instructs it to set higher values for truly important information.

**Boosting:**
- The `boost_memory` tool increases importance by a specified amount (default: +0.1, maximum per call: +0.5).
- Importance is capped at 1.0: `newImportance = Math.min(1, existing.importance + amount)`.
- Deduplication also triggers a boost: when the AI tries to remember something that already exists, the existing memory's importance increases by +0.1.

**Decay:**
- The `POST /memories/decay` endpoint reduces importance for stale memories.
- Default behavior: memories not accessed in the last 30 days have their importance multiplied by 0.9.
- Decay only affects memories with importance above 0.1 (preventing memories from decaying to effectively zero).
- This endpoint is designed to be called periodically by a scheduled trigger.

**Ordering by importance:**
- `list_memories` orders by `importance DESC, updated_at DESC`.
- `recall` (relevance mode) orders by `importance DESC, accessed_at DESC NULLS LAST`.

### Memory Deduplication

Both the `remember` tool executor and the `POST /memories` API endpoint perform deduplication before creating a new memory.

The deduplication logic in `MemoriesRepository.findSimilar()` performs an exact text match on `content` (and optionally filters by `type`):

```typescript
async findSimilar(content: string, type?: MemoryType): Promise<Memory | null> {
  let sql = `
    SELECT * FROM memories
    WHERE user_id = $1
      AND content = $2
  `;
  // ... optional type filter
}
```

When a duplicate is found:
1. The existing memory's importance is boosted by +0.1.
2. The tool returns a result indicating deduplication occurred.
3. No new row is inserted.

The `batch_remember` executor tracks deduplication counts separately: `{ created: N, deduplicated: M }`.

Future improvement: The `embedding` (BYTEA) column is reserved for vector-based semantic similarity, which would allow fuzzy deduplication rather than exact string matching.

### Memory Decay and Cleanup

Two maintenance operations keep the memory store healthy:

**Decay** (`POST /memories/decay`):

```typescript
async decay(options: {
  daysThreshold?: number;  // default: 30
  decayFactor?: number;    // default: 0.9
}): Promise<number>
```

SQL logic:
```sql
UPDATE memories SET
  importance = importance * $decayFactor,
  updated_at = NOW()
WHERE user_id = $userId
  AND importance > 0.1
  AND (accessed_at IS NULL OR accessed_at < NOW() - INTERVAL '$days days')
  AND created_at < NOW() - INTERVAL '$days days'
```

Memories that are frequently accessed are protected from decay because their `accessed_at` timestamp stays recent.

**Cleanup** (`POST /memories/cleanup`):

```typescript
async cleanup(options: {
  maxAge?: number;         // default: 90 days
  minImportance?: number;  // default: 0.1
}): Promise<number>
```

SQL logic:
```sql
DELETE FROM memories
WHERE user_id = $userId
  AND importance < $minImportance
  AND created_at < NOW() - INTERVAL '$maxAge days'
  AND (accessed_at IS NULL OR accessed_at < NOW() - INTERVAL '$maxAge days')
```

Both operations return the number of affected rows.

### Access Tracking

Every time a memory is retrieved via `MemoriesRepository.get()` with `trackAccess = true` (the default), two columns are updated:

```sql
UPDATE memories SET
  accessed_at = NOW(),
  accessed_count = accessed_count + 1
WHERE id = $id AND user_id = $userId
```

This tracking serves two purposes:
1. **Decay protection** -- Recently accessed memories are excluded from importance decay.
2. **Relevance ranking** -- The `getFrequentlyAccessed()` method orders by `accessed_count DESC`, allowing the system to surface the most-referenced memories.

Reads via `get(id, false)` (e.g., during update or delete operations) skip access tracking to avoid inflating counts.

### Memory Tools

Tool definitions live in `packages/core/src/agent/tools/memory-tools.ts`. These are pure schema definitions (no execution logic) that are registered with the agent runtime.

| Tool | Parameters | Description |
|------|-----------|-------------|
| `remember` | `content` (required), `type` (required: fact/preference/event/skill), `importance` (0-1), `tags` (string[]) | Store a single memory. Deduplicates automatically. |
| `batch_remember` | `memories` (required: array of {content, type, importance?, tags?}) | Store multiple memories in one call. Each entry is individually deduplicated. |
| `recall` | `query` (required), `type` (optional filter), `tags` (optional filter), `limit` (default: 10) | Search memories by natural language query. Returns sorted by relevance and importance. |
| `forget` | `memoryId` (required) | Delete a specific memory by ID. Used only when user explicitly requests it or information is outdated. |
| `list_memories` | `type` (optional filter), `limit` (default: 20), `minImportance` (0-1 threshold) | List memories ordered by importance. |
| `boost_memory` | `memoryId` (required), `amount` (default: 0.1, max: 0.5) | Increase a memory's importance score. Used when information is reinforced or becomes more relevant. |
| `memory_stats` | (none) | Returns total count, breakdown by type, average importance, and count of memories added in the last 7 days. |

All tools are exported as `MEMORY_TOOLS: ToolDefinition[]` and tool names as `MEMORY_TOOL_NAMES: string[]`.

### Memory Tool Executor

The execution logic lives in `packages/gateway/src/routes/memories.ts` in the `executeMemoryTool()` function. This function is called by the agent runtime when the AI invokes a memory tool.

```typescript
export async function executeMemoryTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult>
```

Each tool name maps to a case in a switch statement. The executor:
1. Instantiates `MemoriesRepository` with the user ID.
2. Validates required parameters.
3. Performs deduplication where applicable.
4. Returns a `ToolExecutionResult` with `success`, `result`, and optionally `error`.

---

## Memory Injection

Memory injection is the process of enriching the system prompt sent to the LLM with the user's personal information, custom instructions, and contextual data. This happens before every LLM call.

### MemoryInjector Class

**Source:** `packages/core/src/agent/memory-injector.ts`

The `MemoryInjector` class is the primary entry point for memory injection.

```typescript
export class MemoryInjector {
  private readonly composer: PromptComposer;

  async injectMemory(
    basePrompt: string,
    options: MemoryInjectionOptions
  ): Promise<InjectedPromptResult>;

  async createAgentPrompt(
    agentName: string,
    agentDescription: string,
    options: MemoryInjectionOptions & {
      personality?: string;
      specialInstructions?: string[];
    }
  ): Promise<string>;

  async getRelevantContext(
    userId: string,
    query: string
  ): Promise<string | null>;
}
```

**MemoryInjectionOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `userId` | string | - | User ID for memory retrieval |
| `tools` | ToolDefinition[] | - | Available tools to list in the prompt |
| `capabilities` | AgentCapabilities | - | Agent capability flags |
| `conversationContext` | PromptConversationContext | - | Current conversation metadata |
| `workspaceContext` | WorkspaceContext | - | File system paths |
| `includeProfile` | boolean | true | Whether to include user profile |
| `includeInstructions` | boolean | true | Whether to include custom instructions |
| `includeTimeContext` | boolean | true | Whether to include current time |
| `includeToolDescriptions` | boolean | true | Whether to describe tools |
| `maxPromptLength` | number | 16000 | Maximum prompt character length |

**InjectedPromptResult:**

| Field | Type | Description |
|-------|------|-------------|
| `systemPrompt` | string | The fully composed system prompt |
| `userProfile` | UserProfile | The user profile object (if loaded) |
| `toolCount` | number | Number of tools included |
| `instructionCount` | number | Number of custom instructions included |
| `hasTimeContext` | boolean | Whether time context was added |
| `promptLength` | number | Length of the final prompt in characters |

A global singleton instance is available via `getMemoryInjector()`. Convenience functions `injectMemoryIntoPrompt()` and `createEnhancedAgentPrompt()` wrap the singleton.

### PersonalMemoryStore

**Source:** `packages/core/src/memory/personal.ts`

The `PersonalMemoryStore` is a file-based key-value store that maintains a comprehensive user profile across 30+ data categories. It stores data in `~/.ownpilot/personal/{userId}/personal.json`.

The `MemoryInjector` loads the personal profile via `getPersonalMemoryStore(userId)` and converts it to a `UserProfile` object that the `PromptComposer` can format.

Key profile sections used during injection:
- **Identity** -- name, nickname, age, nationality
- **Location** -- city, country, timezone
- **Work** -- occupation, company, skills
- **Communication** -- preferred style, verbosity, language
- **Interests** -- hobbies and skills combined
- **Goals** -- short-term and medium-term goals
- **AI Preferences** -- autonomy level, custom instructions, boundaries

The profile `completeness` score (0-100) is calculated based on how many key profile sections have data.

### PromptComposer Pipeline

**Source:** `packages/core/src/agent/prompt-composer.ts`

The `PromptComposer` assembles the final system prompt from multiple sections in a defined order:

```
1. Base Prompt         -- Agent identity and core behavior guidelines
2. User Profile        -- Name, facts, communication style, interests, goals
3. Custom Instructions -- User-defined rules the AI must follow
4. Available Tools     -- Tool count by category, mandatory tool workflow
5. Automation Context  -- Trigger and plan documentation (if automation tools present)
6. Workspace Context   -- Allowed file system directories
7. Capabilities        -- Feature flags (code execution, web browsing, memory, etc.)
8. Autonomy Guidelines -- Behavioral rules based on autonomy level
9. Time Context        -- Current time, day of week, timezone
10. Conversation Context -- Message count, topics, current task, previous summary
```

Sections are separated by `\n\n---\n\n` dividers.

**Truncation:** If the composed prompt exceeds `maxPromptLength` (default: 16000 characters), the composer keeps the first section (base prompt) and adds subsequent sections only while they fit within the limit.

**Autonomy levels** directly affect the guidelines injected into the prompt:

| Level | Guideline |
|-------|-----------|
| `none` | Ask for explicit permission before taking any action. |
| `low` | Perform read-only operations freely. Ask permission for modifications. |
| `medium` | Perform most operations freely. Ask permission for destructive or irreversible actions. |
| `high` | Perform almost all operations autonomously. Only ask for truly destructive actions. |
| `full` | Full autonomy. Take action immediately. The user trusts your judgment. |

### Injection Flow Diagram

```
User sends message
        |
        v
Agent Runtime prepares LLM call
        |
        v
MemoryInjector.injectMemory(basePrompt, options)
        |
        +---> getPersonalMemoryStore(userId)
        |         |
        |         +---> Load ~/.ownpilot/personal/{userId}/personal.json
        |         +---> Build ComprehensiveProfile
        |         +---> Convert to UserProfile
        |         +---> Extract customInstructions[]
        |         +---> Extract autonomyLevel
        |
        +---> getTimeContext()
        |         |
        |         +---> Current time, timezone, day of week, time of day
        |
        +---> PromptComposer.compose(context)
        |         |
        |         +---> Assemble all sections
        |         +---> Format user profile (high-confidence facts)
        |         +---> Format tool descriptions
        |         +---> Apply autonomy guidelines
        |         +---> Truncate if exceeding maxPromptLength
        |
        v
InjectedPromptResult { systemPrompt, userProfile, toolCount, ... }
        |
        v
LLM receives enriched system prompt + conversation messages
```

---

## Conversation Memory

### ConversationMemory Class

**Source:** `packages/core/src/agent/memory.ts`

`ConversationMemory` manages in-session conversation state. It is distinct from the persistent memory system -- it holds the raw message history for a single conversation session.

```typescript
export class ConversationMemory {
  constructor(config?: MemoryConfig);

  create(systemPrompt?: string, metadata?: Record<string, unknown>): Conversation;
  get(id: string): Conversation | undefined;
  addMessage(conversationId: string, message: Message): Conversation | undefined;
  addUserMessage(conversationId: string, content: string | ContentPart[]): Conversation | undefined;
  addAssistantMessage(conversationId: string, content: string, toolCalls?: ToolCall[]): Conversation | undefined;
  addToolResults(conversationId: string, results: ToolResult[]): Conversation | undefined;
  getContextMessages(conversationId: string): readonly Message[];
  getFullContext(conversationId: string): readonly Message[];
  clearMessages(conversationId: string): boolean;
  delete(conversationId: string): boolean;
  fork(conversationId: string): Conversation | undefined;
  export(conversationId: string): string | undefined;
  import(json: string): Conversation | undefined;
  getStats(conversationId: string): { messageCount, estimatedTokens, lastActivity } | undefined;
}
```

### Persistence Strategies

The `MemoryConfig` type accepts a `persistence` field:

| Strategy | Behavior |
|----------|----------|
| `none` | Messages exist only in memory; lost on restart |
| `session` | Messages persist for the duration of the session (default) |
| `persistent` | Messages survive across sessions (not yet fully implemented at this layer; persistent conversations are handled by the database) |

### Token Estimation and Trimming

The `getContextMessages()` method applies a token budget when returning messages:

```typescript
private estimateTokens(message: Message): number {
  // ~4 characters per token
  // + 500 chars for images
  // + overhead for tool calls and results
  return Math.ceil(chars / 4);
}
```

When `maxTokens` is configured (default: 100,000), the method scans messages from most recent to oldest, accumulating estimated token counts. Once the budget is exceeded, older messages are dropped.

Default configuration:
- `maxMessages`: 100
- `maxTokens`: 100,000
- `summarize`: false
- `persistence`: `'session'`

---

## Goal System

### Database Schema: goals

```sql
CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL DEFAULT 'default',
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK(status IN ('active', 'paused', 'completed', 'abandoned')),
  priority     INTEGER NOT NULL DEFAULT 5
                 CHECK(priority >= 1 AND priority <= 10),
  parent_id    TEXT REFERENCES goals(id) ON DELETE SET NULL,
  due_date     TEXT,
  progress     DOUBLE PRECISION NOT NULL DEFAULT 0
                 CHECK(progress >= 0 AND progress <= 100),
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata     JSONB DEFAULT '{}'::jsonb
);
```

**Indexes:**

```sql
CREATE INDEX idx_goals_user     ON goals(user_id);
CREATE INDEX idx_goals_status   ON goals(status);
CREATE INDEX idx_goals_priority ON goals(priority DESC);
CREATE INDEX idx_goals_parent   ON goals(parent_id);
```

### Database Schema: goal_steps

```sql
CREATE TABLE IF NOT EXISTS goal_steps (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped')),
  order_num    INTEGER NOT NULL,
  dependencies JSONB DEFAULT '[]'::jsonb,
  result       TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);
```

**Indexes:**

```sql
CREATE INDEX idx_goal_steps_goal   ON goal_steps(goal_id);
CREATE INDEX idx_goal_steps_status ON goal_steps(status);
```

The `ON DELETE CASCADE` on `goal_id` means deleting a goal automatically removes all its steps.

### Goal Statuses

| Status | Description |
|--------|-------------|
| `active` | Goal is being actively pursued |
| `paused` | Goal is temporarily on hold |
| `completed` | Goal has been achieved; `completed_at` is set automatically |
| `abandoned` | Goal was intentionally dropped |

### Goal Priority

Priority is an integer from 1 (lowest) to 10 (highest). Default is 5.

When the AI updates priority, it is clamped: `Math.max(1, Math.min(10, priority))`.

Goals are typically listed ordered by `priority DESC, created_at DESC`, meaning higher-priority goals appear first.

### Goal Hierarchy

Goals support a parent-child relationship through the `parent_id` self-referencing foreign key:

```
Goal A (parent_id: NULL)           -- Top-level goal
  +-- Goal B (parent_id: A.id)     -- Sub-goal
  +-- Goal C (parent_id: A.id)     -- Sub-goal
        +-- Goal D (parent_id: C.id) -- Sub-sub-goal
```

When a parent goal is deleted, its children's `parent_id` is set to NULL (ON DELETE SET NULL), promoting them to top-level goals rather than deleting them.

The AI can create sub-goals by passing `parentId` to the `create_goal` tool.

### Goal Decomposition

Goal decomposition is the process of breaking a high-level goal into concrete, ordered steps. The `decompose_goal` tool accepts a goal ID and an array of step definitions:

```typescript
// Tool parameters
{
  goalId: string,          // Required: ID of the goal to decompose
  steps: Array<{
    title: string,         // Required: actionable verb phrase
    description?: string   // Optional: detailed description
  }>
}
```

**Executor behavior:**

1. Validates that the goal exists.
2. Iterates through the provided steps array.
3. For each step, calls `repo.addStep(goalId, stepInput)`.
4. Each step is assigned an auto-incrementing `order_num` based on the existing maximum for that goal: `MAX(order_num) + 1`.
5. All new steps start with status `'pending'`.
6. Returns the list of created steps with their IDs.

**Example decomposition:**

```
Goal: "Learn Spanish basics"
  Step 1: "Download a Spanish learning app" (pending)
  Step 2: "Complete first 10 lessons" (pending)
  Step 3: "Practice speaking with a language partner" (pending)
  Step 4: "Watch a Spanish movie without subtitles" (pending)
  Step 5: "Hold a 5-minute conversation in Spanish" (pending)
```

### Step Dependencies

Each step has a `dependencies` field (JSONB array of step IDs). A step with dependencies cannot be started until all dependency steps are completed.

```json
{
  "id": "step_003",
  "title": "Practice speaking",
  "dependencies": ["step_001", "step_002"]
}
```

Step 003 is blocked until both step 001 and step 002 have status `'completed'`.

### Automatic Progress Recalculation

When a step's status is updated (via `updateStep` or `complete_step`), the repository automatically recalculates the parent goal's progress:

```typescript
async recalculateProgress(goalId: string): Promise<number> {
  const steps = await this.getSteps(goalId);
  if (steps.length === 0) return 0;

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const progress = Math.round((completedSteps / steps.length) * 100);

  await this.update(goalId, { progress });
  return progress;
}
```

This means:
- A goal with 5 steps where 3 are completed has progress = 60%.
- Adding new steps reduces the percentage (denominator increases).
- Deleting a step also triggers recalculation.

### Next Actions Resolution

The `get_next_actions` tool returns the most actionable steps across all active goals. The SQL query is:

```sql
SELECT s.*, g.title as goal_title
FROM goal_steps s
JOIN goals g ON s.goal_id = g.id
WHERE g.user_id = $1
  AND g.status = 'active'
  AND s.status IN ('pending', 'in_progress')
  AND NOT EXISTS (
    SELECT 1 FROM goal_steps dep
    WHERE dep.id = ANY(
      SELECT jsonb_array_elements_text(s.dependencies::jsonb)
    )
    AND dep.status != 'completed'
  )
ORDER BY g.priority DESC, s.order_num ASC
LIMIT $2
```

This query:
1. Only considers steps belonging to **active** goals.
2. Only considers **pending** or **in_progress** steps.
3. Excludes steps that have **uncompleted dependencies**.
4. Orders by goal priority (highest first), then step order (lowest first).
5. Returns up to the specified limit (default: 5).

### Goal Tools

Tool definitions live in `packages/core/src/agent/tools/goal-tools.ts`.

| Tool | Parameters | Description |
|------|-----------|-------------|
| `create_goal` | `title` (required), `description`, `priority` (1-10, default: 5), `dueDate` (ISO), `parentId` | Create a new goal. Can be a sub-goal if parentId is provided. |
| `list_goals` | `status` (default: active), `limit` (default: 10) | List goals filtered by status, ordered by priority. |
| `update_goal` | `goalId` (required), `status`, `progress` (0-100), `title`, `description`, `priority`, `dueDate` | Update any field of an existing goal. Setting status to `completed` auto-sets `completed_at`. |
| `decompose_goal` | `goalId` (required), `steps` (required: array of {title, description?}) | Break a goal into ordered, actionable steps. |
| `get_next_actions` | `limit` (default: 5) | Get next pending steps across all active goals, respecting dependencies. |
| `complete_step` | `stepId` (required), `result` (optional notes) | Mark a step as completed. Auto-recalculates parent goal progress. |
| `get_goal_details` | `goalId` (required) | Get full goal details including all steps, completion count, and step count. |
| `goal_stats` | (none) | Returns total goals, breakdown by status, completed this week, average progress, overdue count. |

All tools are exported as `GOAL_TOOLS: ToolDefinition[]` and tool names as `GOAL_TOOL_NAMES: string[]`.

### Goal Tool Executor

The execution logic lives in `packages/gateway/src/routes/goals.ts` in the `executeGoalTool()` function.

```typescript
export async function executeGoalTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult>
```

Each tool ID maps to a case that validates inputs, interacts with `GoalsRepository`, and returns a structured result.

### Goal Statistics

The `goal_stats` tool and `GET /goals/stats` endpoint return:

```typescript
{
  total: number;              // Total goals across all statuses
  byStatus: {
    active: number;
    paused: number;
    completed: number;
    abandoned: number;
  };
  completedThisWeek: number;  // Goals completed in the last 7 days
  averageProgress: number;    // Average progress of active goals (0-100)
  overdueCount: number;       // Active goals past their due date
}
```

---

## Gateway API

The gateway exposes REST endpoints for both memories and goals. All endpoints accept a `userId` query parameter (default: `'default'`).

### Memory Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/memories` | List memories. Query: `type`, `limit`, `minImportance` |
| `POST` | `/memories` | Create a memory. Body: `{ content, type, importance?, tags? }`. Deduplicates. |
| `GET` | `/memories/search` | Search memories. Query: `q` (required), `type`, `limit` |
| `GET` | `/memories/stats` | Get memory statistics |
| `GET` | `/memories/:id` | Get a specific memory |
| `PATCH` | `/memories/:id` | Update a memory. Body: `{ content?, importance?, tags? }` |
| `POST` | `/memories/:id/boost` | Boost importance. Body: `{ amount? }` (default: 0.1) |
| `DELETE` | `/memories/:id` | Delete a memory |
| `POST` | `/memories/decay` | Run decay. Body: `{ daysThreshold?, decayFactor? }` |
| `POST` | `/memories/cleanup` | Clean up low-importance memories. Body: `{ maxAge?, minImportance? }` |

### Goal Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/goals` | List goals. Query: `status`, `limit`, `parentId` |
| `POST` | `/goals` | Create a goal. Body: `{ title, description?, priority?, dueDate?, parentId? }` |
| `GET` | `/goals/stats` | Get goal statistics |
| `GET` | `/goals/next-actions` | Get next actionable steps. Query: `limit` |
| `GET` | `/goals/upcoming` | Get goals with upcoming due dates. Query: `days` (default: 7) |
| `GET` | `/goals/:id` | Get a goal with its steps |
| `PATCH` | `/goals/:id` | Update a goal |
| `DELETE` | `/goals/:id` | Delete a goal (cascades to steps) |

### Goal Step Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/goals/:id/steps` | Add steps to a goal. Body: `{ steps: [{title, description?}] }` or single step |
| `GET` | `/goals/:id/steps` | List steps for a goal, ordered by `order_num` |
| `PATCH` | `/goals/:goalId/steps/:stepId` | Update a step |
| `POST` | `/goals/:goalId/steps/:stepId/complete` | Mark step completed. Body: `{ result? }` |
| `DELETE` | `/goals/:goalId/steps/:stepId` | Delete a step |

---

## Cross-System Integration

### Goal-Plan Connection

The `plans` table includes a `goal_id` foreign key:

```sql
CREATE TABLE plans (
  ...
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  ...
);
```

This allows plans (autonomous multi-step workflows) to be linked to goals. When a plan is created to achieve a specific goal:
1. The AI sets `goal_id` on the plan.
2. As plan steps complete, the AI can update the corresponding goal's progress.
3. When the plan completes successfully, the AI can mark the goal as completed.

Plans and goals share a similar decomposition pattern (goals have `goal_steps`, plans have `plan_steps`), but they serve different purposes:
- **Goal steps** represent what needs to be done (declarative).
- **Plan steps** represent how to do it (imperative -- tool calls, LLM decisions, conditions).

### Trigger-Goal Integration

Triggers can automate goal-related behavior:

| Trigger Type | Goal Use Case |
|-------------|--------------|
| `schedule` | Periodic goal review ("Every Monday at 9 AM, review active goals") |
| `condition: stale_goals` | Alert when goals have not progressed in N days |
| `condition: upcoming_deadline` | Notify about approaching due dates |
| `condition: low_progress` | Flag goals with low progress relative to their deadline |
| `event: goal_completed` | Fire when a goal is marked completed (e.g., create a celebration memory) |

A trigger's action can invoke goal tools:
```json
{
  "type": "schedule",
  "config": { "cron": "0 9 * * 1" },
  "action": {
    "type": "chat",
    "payload": {
      "prompt": "Review all active goals. Check which ones are overdue or stalled. Suggest next actions."
    }
  }
}
```

### Memory-Goal Relationship

Memories and goals complement each other:

1. **Memory informs goal creation** -- The AI recalls user preferences and past conversations to suggest relevant goals.
2. **Goal progress becomes memory** -- When a goal is completed, the AI can store it as an `event`-type memory for long-term recall.
3. **Memories contextualize goal work** -- When working on a goal, the AI recalls related facts and preferences to make better decisions.
4. **Personal profile includes goals** -- The `PersonalMemoryStore` profile has a `goals` section (shortTerm, mediumTerm, longTerm) that is injected into the system prompt.

### Autonomy Integration

The memory and goal systems are core enablers of autonomous AI behavior:

1. **Goal review cycle** -- Scheduled triggers periodically prompt the AI to review active goals, identify stalled objectives, and suggest next actions via `get_next_actions`.
2. **Proactive memory** -- The AI autonomously stores important information from conversations without being asked, guided by the `remember` tool's description: "Be selective -- only remember truly important information."
3. **Context-aware decisions** -- The `MemoryInjector` ensures every LLM call has full awareness of the user's profile, preferences, active goals, and communication style.
4. **Autonomy levels** -- The system prompt includes behavioral guidelines that scale from "ask permission for everything" (`none`) to "take action immediately" (`full`), directly controlling how aggressively the AI pursues goals.

The full autonomy loop:

```
Trigger fires (scheduled or condition-based)
    |
    v
AI receives prompt with injected memory context
    |
    v
AI calls get_next_actions to identify what to work on
    |
    v
AI recalls relevant memories for context
    |
    v
AI executes plan steps / tool calls
    |
    v
AI calls complete_step to update progress
    |
    v
AI calls remember to store outcomes
    |
    v
Goal progress auto-recalculates
```

---

## UI: GoalsPage

The frontend provides a `GoalsPage` component at `packages/ui/src/pages/GoalsPage.tsx` that renders a visual interface for goal management. It communicates with the gateway API endpoints listed above.

---

## Source File Reference

| File | Package | Purpose |
|------|---------|---------|
| `packages/core/src/agent/tools/memory-tools.ts` | @ownpilot/core | Memory tool definitions (7 tools) |
| `packages/core/src/agent/tools/goal-tools.ts` | @ownpilot/core | Goal tool definitions (8 tools) |
| `packages/core/src/agent/memory-injector.ts` | @ownpilot/core | MemoryInjector class, prompt enrichment |
| `packages/core/src/agent/prompt-composer.ts` | @ownpilot/core | PromptComposer, section assembly, autonomy guidelines |
| `packages/core/src/agent/memory.ts` | @ownpilot/core | ConversationMemory class (in-session) |
| `packages/core/src/memory/personal.ts` | @ownpilot/core | PersonalMemoryStore (file-based profile) |
| `packages/gateway/src/services/memory-service.ts` | @ownpilot/gateway | MemoryService -- business logic layer for memory operations, EventBus emission |
| `packages/gateway/src/services/goal-service.ts` | @ownpilot/gateway | GoalService -- business logic layer for goal operations, EventBus emission |
| `packages/gateway/src/routes/memories.ts` | @ownpilot/gateway | Memory REST API (thin HTTP handler, delegates to MemoryService) |
| `packages/gateway/src/routes/goals.ts` | @ownpilot/gateway | Goals REST API (thin HTTP handler, delegates to GoalService) |
| `packages/gateway/src/db/repositories/memories.ts` | @ownpilot/gateway | MemoriesRepository (PostgreSQL) |
| `packages/gateway/src/db/repositories/goals.ts` | @ownpilot/gateway | GoalsRepository (PostgreSQL) |
| `packages/gateway/src/db/schema.ts` | @ownpilot/gateway | Full database schema DDL |
| `packages/ui/src/pages/GoalsPage.tsx` | @ownpilot/ui | Goal management UI |
