# Agent System Architecture

This document provides a comprehensive reference for the OwnPilot agent system. It covers every layer of the architecture, from the core abstractions and execution loop through prompt composition, memory injection, permissions, provider routing, and the gateway integration that ties everything together.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Classes](#core-classes)
   - [Agent](#agent)
   - [AgentOrchestrator](#agentorchestrator)
   - [AgentBuilder](#agentbuilder)
   - [MultiAgentOrchestrator](#multiagentorchestrator)
3. [Agent Configuration](#agent-configuration)
   - [AgentConfig (Agent class)](#agentconfig-agent-class)
   - [AgentConfig (Orchestrator)](#agentconfig-orchestrator)
4. [Execution Lifecycle](#execution-lifecycle)
   - [Agent Tool-Calling Loop](#agent-tool-calling-loop)
   - [Orchestrator Execution Loop](#orchestrator-execution-loop)
   - [Streaming Execution](#streaming-execution)
   - [Cancellation](#cancellation)
5. [Prompt Composition](#prompt-composition)
   - [PromptComposer](#promptcomposer)
   - [Prompt Sections](#prompt-sections)
   - [Autonomy Guidelines](#autonomy-guidelines)
6. [Memory System](#memory-system)
   - [ConversationMemory](#conversationmemory)
   - [MemoryInjector](#memoryinjector)
   - [Memory Injection Flow](#memory-injection-flow)
7. [Permission System](#permission-system)
   - [Permission Levels and Categories](#permission-levels-and-categories)
   - [PermissionChecker](#permissionchecker)
   - [Rate Limiting](#rate-limiting)
8. [Provider System](#provider-system)
   - [IProvider Interface](#iprovider-interface)
   - [Built-in Providers](#built-in-providers)
   - [FallbackProvider](#fallbackprovider)
   - [ProviderRouter](#providerrouter)
9. [Code Generator](#code-generator)
10. [Tool System](#tool-system)
    - [Tool Definition](#tool-definition)
    - [Tool Registry](#tool-registry)
    - [Meta-Tools](#meta-tools)
    - [Tool Categories](#tool-categories)
11. [Planning System](#planning-system)
12. [Gateway Integration](#gateway-integration)
    - [Database Schema](#database-schema)
    - [REST API](#rest-api)
    - [Agent Lifecycle in the Gateway](#agent-lifecycle-in-the-gateway)
    - [Default Agents](#default-agents)
13. [Type Reference](#type-reference)
14. [File Map](#file-map)

---

## Overview

The OwnPilot agent system is a modular, multi-provider AI framework that supports tool-calling loops, dynamic prompt composition, persistent memory injection, fine-grained permissions, and multi-agent coordination. It is organized into three packages:

| Package            | Role                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| `packages/core`    | All agent abstractions, providers, tools, memory, permissions, prompt composition       |
| `packages/gateway` | HTTP API (Hono), database persistence, tool executor wiring, agent lifecycle management |
| `packages/ui`      | React frontend for agent configuration and chat                                         |

The system provides two parallel agent abstractions:

1. **Agent class** (`agent.ts`) -- the production runtime used by the gateway. It manages conversation memory, a tool registry, streaming, and a turn-based tool-calling loop with approval callbacks.
2. **AgentOrchestrator class** (`orchestrator.ts`) -- an event-driven orchestrator with an iteration-based loop, streaming generator, and memory injection support. It also provides the `AgentBuilder` fluent API and the `MultiAgentOrchestrator` for team-based agent coordination.

Both abstractions follow the same fundamental pattern: send messages to an LLM, check if the response contains tool calls, execute the tools, feed the results back, and repeat until the LLM produces a final text response.

---

## Core Classes

### Agent

**File:** `packages/core/src/agent/agent.ts`

The `Agent` class is the primary runtime abstraction used in production. It owns a provider, a tool registry, and a conversation memory instance.

```typescript
class Agent {
  readonly name: string;

  constructor(
    config: AgentConfig,
    options?: {
      tools?: ToolRegistry;
      memory?: ConversationMemory;
    }
  );

  // State
  isReady(): boolean;
  getState(): Readonly<AgentState>;
  getConversation(): Conversation;

  // Tools
  getTools(): readonly ToolDefinition[];
  getAllToolDefinitions(): readonly ToolDefinition[];
  setAdditionalTools(toolNames: string[]): void;
  clearAdditionalTools(): void;
  getToolRegistry(): ToolRegistry;

  // Chat
  chat(message: string, options?: ChatOptions): Promise<Result<CompletionResponse, Error>>;

  // Memory
  getMemory(): ConversationMemory;
  reset(): Conversation;
  loadConversation(conversationId: string): boolean;
  fork(): Conversation | undefined;
  updateSystemPrompt(prompt: string): void;

  // Workspace
  setWorkspaceDir(dir: string | undefined): void;

  // Lifecycle
  cancel(): void;
}
```

**Key behaviors:**

- On construction, core tools are registered unless a custom registry is provided.
- A new conversation is created in memory with the configured system prompt.
- The `chat()` method adds the user message to memory, then enters the tool-calling loop (`processConversation`).
- Tool calls are filtered through an optional `onBeforeToolCall` approval callback before execution.
- Approved tools run in parallel via `Promise.all`.
- Callbacks `onToolStart`, `onToolEnd`, and `onProgress` provide real-time observability.
- Supports both streaming and non-streaming modes.

**Default limits:**

| Parameter      | Default |
| -------------- | ------- |
| `maxTurns`     | 50      |
| `maxToolCalls` | 200     |

---

### AgentOrchestrator

**File:** `packages/core/src/agent/orchestrator.ts`

An event-driven orchestrator that manages an execution context (`OrchestratorContext`) through an iteration loop.

```typescript
class AgentOrchestrator extends EventEmitter {
  constructor(config: AgentConfig);

  // Configuration
  getConfig(): AgentConfig;
  updateConfig(updates: Partial<AgentConfig>): void;
  setToolRegistry(registry: ToolRegistry): void;

  // Execution
  execute(
    userMessage: string,
    history?: Message[],
    metadata?: Record<string, unknown>
  ): Promise<OrchestratorContext>;
  stream(
    userMessage: string,
    history?: Message[],
    metadata?: Record<string, unknown>
  ): AsyncGenerator<AgentStep, OrchestratorContext>;

  // Control
  cancel(): void;
  getCurrentExecution(): OrchestratorContext | null;
}
```

**Events emitted:**

| Event       | Payload                             | When                                                              |
| ----------- | ----------------------------------- | ----------------------------------------------------------------- |
| `step`      | `(step: AgentStep, context)`        | Each processing step (thinking, tool_call, tool_result, response) |
| `tool_call` | `(record: ToolCallRecord, context)` | After each tool execution completes                               |
| `iteration` | `(iteration: number, context)`      | At the start of each loop iteration                               |
| `complete`  | `(context)`                         | When execution finishes successfully                              |
| `error`     | `(error: Error, context)`           | When execution fails                                              |

**Default parameters:**

| Parameter       | Default |
| --------------- | ------- |
| `maxIterations` | 10      |
| `maxTokens`     | 4096    |
| `temperature`   | 0.7     |
| `verbose`       | false   |

---

### AgentBuilder

**File:** `packages/core/src/agent/orchestrator.ts` (line 609)

A fluent builder API for constructing `AgentOrchestrator` instances.

```typescript
import { createAgent } from './orchestrator.js';

const agent = createAgent()
  .name('Research Agent')
  .description('Performs web research')
  .systemPrompt('You are a research agent...')
  .provider(myProvider)
  .model('gpt-4o')
  .tool(searchDefinition, searchExecutor)
  .maxIterations(20)
  .maxTokens(8192)
  .temperature(0.5)
  .verbose()
  .build();
```

The `build()` method validates that `name`, `systemPrompt`, `provider`, and `model` are all set, then returns a configured `AgentOrchestrator`.

---

### MultiAgentOrchestrator

**File:** `packages/core/src/agent/orchestrator.ts` (line 752)

Coordinates multiple agents organized into teams. Each team has a router function that selects the appropriate agent for a given message.

```typescript
class MultiAgentOrchestrator extends EventEmitter {
  registerTeam(team: AgentTeam): void;
  setDefaultTeam(teamName: string): void;
  execute(
    message: string,
    teamName?: string,
    context?: Record<string, unknown>
  ): Promise<OrchestratorContext>;
  getTeams(): string[];
  getAgents(teamName: string): string[];
}

interface AgentTeam {
  name: string;
  agents: Map<string, AgentOrchestrator>;
  router: (message: string, context: Record<string, unknown>) => string;
  sharedContext: Record<string, unknown>;
}
```

**Execution flow:**

1. Look up the team (by name or default).
2. Call the team's `router` function with the user message and merged context.
3. The router returns the name of the agent that should handle the request.
4. That agent's `execute()` is called with the message and the team's shared context.

---

## Agent Configuration

### AgentConfig (Agent class)

Defined in `packages/core/src/agent/types.ts`:

```typescript
interface AgentConfig {
  name: string;
  systemPrompt: string;
  provider: ProviderConfig;
  model: ModelConfig;
  tools?: readonly ToolId[]; // Filter: only expose these tools to the LLM
  maxTurns?: number; // Default: 50
  maxToolCalls?: number; // Default: 200
  memory?: MemoryConfig;
}
```

### AgentConfig (Orchestrator)

Defined in `packages/core/src/agent/orchestrator.ts`:

```typescript
interface AgentConfig {
  name: string;
  description?: string;
  systemPrompt: string;
  provider: LLMProvider;
  model: string;
  tools: ToolDefinition[];
  toolExecutors: Map<string, ToolExecutor>;
  maxIterations?: number; // Default: 10
  maxTokens?: number; // Default: 4096
  temperature?: number; // Default: 0.7
  verbose?: boolean;
  userId?: string;
  memoryOptions?: Omit<MemoryInjectionOptions, 'userId' | 'tools'>;
  enableDynamicPrompts?: boolean;
}
```

When `enableDynamicPrompts` is `true` and `userId` is provided, the orchestrator uses `injectMemoryIntoPrompt` to enhance the system prompt with user profile data, custom instructions, tool descriptions, and time context before each execution.

---

## Execution Lifecycle

### Agent Tool-Calling Loop

The `Agent.processConversation()` method implements the following loop:

```
1. Initialize turn counter = 0

2. WHILE turn < maxTurns:
   a. Increment turn counter
   b. Get full conversation context from memory (system prompt + messages)
   c. Build completion request with messages, model config, and tool definitions
   d. Fire onProgress callback

   e. IF streaming mode:
        Stream response, accumulate content and tool calls
      ELSE:
        Call provider.complete() synchronously

   f. Add assistant message to memory (content + tool calls)

   g. IF response contains tool calls:
        i.   Check total tool call count against maxToolCalls
        ii.  For each tool call, invoke onBeforeToolCall for approval
        iii. Separate approved and rejected tool calls
        iv.  Execute approved tools in PARALLEL (Promise.all)
             - Fire onToolStart before each
             - Fire onToolEnd after each (with duration)
        v.   Combine approved results + rejection messages
        vi.  Add tool results to memory
        vii. Update tool call counter
        viii. CONTINUE loop (go back to step 2)

   h. IF response has NO tool calls:
        Return final response (exit loop)

3. IF loop exhausted: return error "Maximum turns exceeded"
```

**Important implementation details:**

- Tool calls are detected by checking `response.toolCalls` array presence regardless of `finishReason`. Some providers (notably Google) return `stop` even when tool calls are present.
- Rejected tool calls produce an error result message that is fed back to the LLM so it can adapt.
- The `isProcessing` state flag prevents concurrent `chat()` calls on the same agent.

### Orchestrator Execution Loop

The `AgentOrchestrator.runExecutionLoop()` follows a similar pattern but operates on a mutable `OrchestratorContext`:

```
1. Create execution context with unique ID, status = 'running'
2. Compose system prompt (with optional memory injection)
3. Build initial messages: [system, ...history, user]

4. WHILE iteration < maxIterations AND not aborted:
   a. Increment iteration counter
   b. Emit 'iteration' event
   c. Call provider.complete() with current messages

   d. IF response has tool calls:
        i.   Convert OpenAI-format tool calls to internal format
        ii.  Add assistant message with tool calls
        iii. Execute each tool sequentially via executeToolCall()
        iv.  Add tool result messages
        v.   Record ToolCallRecord with timing and success status
        vi.  Emit 'tool_call' event for each
        vii. CONTINUE loop

   e. IF no tool calls:
        i.   Add assistant message
        ii.  Set context.response
        iii. BREAK loop

5. If max iterations hit without response, extract last content or '[Max iterations reached]'
6. Set context.status = 'completed' or 'failed'
7. Emit 'complete' or 'error' event
```

**Key difference from the Agent class:** The orchestrator executes tools sequentially rather than in parallel, and it uses an event-emitter pattern instead of callbacks.

### Streaming Execution

Both abstractions support streaming:

**Agent streaming:**

- The `chat()` method accepts `stream: true` and an `onChunk` callback.
- Tool calls are accumulated across stream chunks by matching tool call IDs.
- Streaming and tool-calling are fully interleaved: the agent streams the LLM response, processes any tool calls, then streams the next iteration.

**Orchestrator streaming:**

- The `stream()` method returns an `AsyncGenerator<AgentStep>`.
- Yields `AgentStep` objects with types: `thinking`, `tool_call`, `tool_result`, `response`.
- Falls back to non-streaming `complete()` if the provider does not implement `stream()`.

### Cancellation

Both abstractions support cancellation via `AbortController`:

- **Agent:** `agent.cancel()` aborts the provider's in-flight request and resets `isProcessing`.
- **Orchestrator:** `orchestrator.cancel()` aborts the controller and sets context status to `cancelled`. The execution loop checks `abortController.signal.aborted` at each iteration boundary.

---

## Prompt Composition

### PromptComposer

**File:** `packages/core/src/agent/prompt-composer.ts`

The `PromptComposer` dynamically assembles a system prompt from multiple contextual sections. It operates on a `PromptContext` object and produces a single string by joining sections with `\n\n---\n\n` dividers.

```typescript
class PromptComposer {
  constructor(options?: PromptComposerOptions);
  compose(context: PromptContext): string;
}
```

**PromptComposerOptions:**

| Option                    | Type    | Default | Description                                |
| ------------------------- | ------- | ------- | ------------------------------------------ |
| `includeToolDescriptions` | boolean | true    | Include tool availability section          |
| `includeUserProfile`      | boolean | true    | Include user facts, preferences, interests |
| `includeTimeContext`      | boolean | true    | Include current date/time and timezone     |
| `includeCapabilities`     | boolean | true    | Include agent capability list              |
| `maxPromptLength`         | number  | 16000   | Maximum characters before truncation       |

**PromptContext fields:**

| Field                 | Type                      | Description                                                          |
| --------------------- | ------------------------- | -------------------------------------------------------------------- |
| `basePrompt`          | string                    | The agent's core system prompt                                       |
| `userProfile`         | UserProfile               | Name, facts, preferences, communication style, interests, goals      |
| `tools`               | ToolDefinition[]          | Available tools for the tool workflow section                        |
| `customInstructions`  | string[]                  | User-defined instructions that must always be followed               |
| `timeContext`         | TimeContext               | Current time, timezone, day of week, time of day                     |
| `capabilities`        | AgentCapabilities         | Code execution, file access, web, memory, scheduling, autonomy level |
| `conversationContext` | PromptConversationContext | Message count, topics, current task, previous summary                |
| `workspaceContext`    | WorkspaceContext          | Workspace directory, home directory, temp directory                  |

### Prompt Sections

The composer assembles sections in this order:

1. **Base Prompt** -- the agent's identity and core instructions.
2. **User Profile** -- personal facts, communication style, interests, goals.
3. **Custom Instructions** -- user-defined rules the agent must always follow.
4. **Available Tools** -- tool category summary and the mandatory 3-step tool workflow:
   - Step 1: `search_tools("keyword")` to discover tools.
   - Step 2: `get_tool_help("tool_name")` to learn parameters.
   - Step 3: `use_tool("tool_name", { params })` to execute.
5. **Automation System** -- trigger and plan documentation (only if automation tools are registered).
6. **Workspace Context** -- allowed directories for file operations.
7. **Capabilities** -- what the agent can do (code execution, file access, web browsing, memory, scheduling).
8. **Autonomy Guidelines** -- behavioral rules based on autonomy level.
9. **Time Context** -- current date, day, timezone.
10. **Conversation Context** -- message count, topics, current task.

**Truncation:** If the composed prompt exceeds `maxPromptLength`, sections are dropped from the end while always preserving the base prompt.

### Autonomy Guidelines

The autonomy level controls how aggressively the agent acts without user confirmation:

| Level    | Behavior                                                                     |
| -------- | ---------------------------------------------------------------------------- |
| `none`   | Ask for explicit permission before taking any action                         |
| `low`    | Read-only operations are free; ask for any modifications                     |
| `medium` | Most operations are free; ask for destructive or irreversible actions        |
| `high`   | Almost all operations are autonomous; ask only for truly destructive actions |
| `full`   | Full autonomy; take action immediately                                       |

The autonomy level is sourced from the user's AI preferences in their personal memory profile.

---

## Memory System

### ConversationMemory

**File:** `packages/core/src/agent/memory.ts`

An in-memory conversation store that manages multiple conversations with configurable message and token limits.

```typescript
class ConversationMemory {
  constructor(config?: MemoryConfig);

  // Conversation lifecycle
  create(systemPrompt?: string, metadata?: Record<string, unknown>): Conversation;
  get(id: string): Conversation | undefined;
  has(id: string): boolean;
  delete(conversationId: string): boolean;
  fork(conversationId: string): Conversation | undefined;
  clear(): void;

  // Messages
  addMessage(conversationId: string, message: Message): Conversation | undefined;
  addUserMessage(conversationId: string, content: string | ContentPart[]): Conversation | undefined;
  addAssistantMessage(
    conversationId: string,
    content: string,
    toolCalls?: ToolCall[]
  ): Conversation | undefined;
  addToolResults(conversationId: string, results: ToolResult[]): Conversation | undefined;
  clearMessages(conversationId: string): boolean;

  // Context
  getContextMessages(conversationId: string): readonly Message[];
  getFullContext(conversationId: string): readonly Message[];

  // Management
  updateSystemPrompt(conversationId: string, systemPrompt: string): Conversation | undefined;
  updateMetadata(
    conversationId: string,
    metadata: Record<string, unknown>
  ): Conversation | undefined;
  getStats(
    conversationId: string
  ): { messageCount: number; estimatedTokens: number; lastActivity: Date } | undefined;
  export(conversationId: string): string | undefined;
  import(json: string): Conversation | undefined;
}
```

**MemoryConfig:**

| Option        | Type    | Default   | Description                              |
| ------------- | ------- | --------- | ---------------------------------------- |
| `maxMessages` | number  | 100       | Maximum messages to retain               |
| `maxTokens`   | number  | 100000    | Token budget for context window          |
| `summarize`   | boolean | false     | Whether to summarize old messages        |
| `persistence` | string  | 'session' | `'none'`, `'session'`, or `'persistent'` |

**Token estimation:** Characters are divided by 4 to approximate token count. Tool calls and tool results add their string length plus 50 characters overhead each.

**Context windowing:** `getContextMessages()` trims messages from the beginning (oldest first) to fit within the `maxTokens` budget. `getFullContext()` prepends the system prompt.

**Forking:** `fork()` creates a deep copy of a conversation with a new UUID and a `forkedFrom` metadata field.

### MemoryInjector

**File:** `packages/core/src/agent/memory-injector.ts`

The `MemoryInjector` bridges the personal memory store and the prompt composer. It fetches the user's comprehensive profile, converts it to a `UserProfile`, extracts custom instructions, and delegates to `PromptComposer.compose()`.

```typescript
class MemoryInjector {
  injectMemory(basePrompt: string, options?: MemoryInjectionOptions): Promise<InjectedPromptResult>;
  createAgentPrompt(agentName: string, agentDescription: string, options?: ...): Promise<string>;
  getRelevantContext(userId: string, query: string): Promise<string | null>;
}
```

**MemoryInjectionOptions:**

| Option                    | Type                      | Description                                            |
| ------------------------- | ------------------------- | ------------------------------------------------------ |
| `userId`                  | string                    | User ID for personal memory retrieval                  |
| `tools`                   | ToolDefinition[]          | Tools to include in prompt                             |
| `capabilities`            | AgentCapabilities         | Agent capability flags                                 |
| `conversationContext`     | PromptConversationContext | Current conversation metadata                          |
| `workspaceContext`        | WorkspaceContext          | File operation directories                             |
| `includeProfile`          | boolean                   | Whether to include user profile (default: true)        |
| `includeInstructions`     | boolean                   | Whether to include custom instructions (default: true) |
| `includeTimeContext`      | boolean                   | Whether to include time context (default: true)        |
| `includeToolDescriptions` | boolean                   | Whether to include tool section (default: true)        |
| `maxPromptLength`         | number                    | Maximum prompt length                                  |

**InjectedPromptResult:**

| Field              | Type        | Description                            |
| ------------------ | ----------- | -------------------------------------- |
| `systemPrompt`     | string      | The fully composed system prompt       |
| `userProfile`      | UserProfile | The user profile used (if any)         |
| `toolCount`        | number      | Number of tools included               |
| `instructionCount` | number      | Number of custom instructions included |
| `hasTimeContext`   | boolean     | Whether time context was included      |
| `promptLength`     | number      | Total character count of the prompt    |

### Memory Injection Flow

The complete flow from user message to enriched prompt:

```
1. Gateway receives chat request
2. Gateway calls injectMemoryIntoPrompt(basePrompt, options)
3. MemoryInjector:
   a. Creates PromptContext with base prompt, tools, capabilities
   b. Adds TimeContext (current date, timezone, time of day)
   c. If userId provided:
      - Loads ComprehensiveProfile from PersonalMemoryStore
      - Converts to UserProfile format (identity, facts, communication style, interests, goals)
      - Extracts customInstructions from AI preferences
      - Applies autonomyLevel from profile to capabilities
   d. Delegates to PromptComposer.compose(context)
4. PromptComposer assembles sections:
   [Base Prompt]
   ---
   [User Profile]
   ---
   [Custom Instructions]
   ---
   [Available Tools + Workflow]
   ---
   [Automation System]
   ---
   [Workspace Context]
   ---
   [Capabilities]
   ---
   [Autonomy Guidelines]
   ---
   [Time Context]
   ---
   [Conversation Context]
5. Returns composed systemPrompt to gateway
6. Gateway creates/updates Agent with the enriched prompt
```

Additionally, the gateway builds separate memory and goal contexts by querying the `MemoriesRepository` and `GoalsRepository` databases. These are prepended to the base prompt before memory injection:

```
basePrompt + memoryContext + goalContext -> injectMemoryIntoPrompt() -> enrichedPrompt
```

---

## Permission System

**File:** `packages/core/src/agent/permissions.ts`

### Permission Levels and Categories

**Permission hierarchy (ascending privilege):**

```
none -> read -> write -> execute -> admin
```

**Tool categories:**

| Category        | Description                 | Example tools                                              |
| --------------- | --------------------------- | ---------------------------------------------------------- |
| `file_read`     | Read files and directories  | `read_file`, `list_directory`, `search_files`, `file_info` |
| `file_write`    | Create or modify files      | `write_file`, `download_file`, `copy_file`                 |
| `file_delete`   | Delete files or directories | `delete_file`                                              |
| `code_execute`  | Run code in sandbox         | `execute_javascript`, `execute_python`, `compile_code`     |
| `network_read`  | HTTP GET, fetch pages       | `http_request`, `fetch_web_page`, `search_web`, `json_api` |
| `network_write` | HTTP POST/PUT/DELETE        | (network write operations)                                 |
| `system`        | System commands             | `execute_shell`, `package_manager`                         |
| `memory`        | Memory management           | `memory_store`, `memory_recall`                            |
| `custom`        | Plugin and custom tools     | (user-defined tools)                                       |

### PermissionChecker

```typescript
class PermissionChecker {
  constructor(policy?: PermissionPolicy);

  check(
    toolName: string,
    context: ToolContext,
    args?: Record<string, unknown>
  ): PermissionCheckResult;
  recordUsage(
    toolName: string,
    context: ToolContext,
    result: PermissionCheckResult,
    args?: Record<string, unknown>
  ): void;
  getToolConfig(toolName: string): ToolPermissionConfig | undefined;
  updatePolicy(updates: Partial<PermissionPolicy>): PermissionPolicy;
  addUserPermissions(userId: string, permissions: Omit<UserPermissions, 'userId'>): void;
}
```

**Permission check sequence:**

1. Look up tool configuration in the policy.
2. If tool is unknown, deny access.
3. Get user permissions (user-specific or default).
4. If tool is in `deniedTools`, deny.
5. If tool is in `allowedTools`, skip level and category checks.
6. Check permission level: user level must be >= tool required level.
7. Check category: tool category must be in user's allowed categories.
8. Check path restrictions (for file tools): file path must start with an allowed path.
9. Check host restrictions (for network tools): hostname must match allowed hosts.
10. Check rate limit: per-user, per-tool, 60-second sliding window.
11. Determine if confirmation is required.

**PermissionCheckResult:**

```typescript
interface PermissionCheckResult {
  allowed: boolean;
  reason?: string; // Reason for denial
  requiresConfirmation?: boolean; // Whether user must confirm
  context?: Record<string, unknown>;
}
```

### Rate Limiting

Rate limits are enforced per `userId:toolName` key with a 60-second sliding window. When a tool has a `rateLimit` configured, the checker tracks call counts and resets them after one minute. If the global `globalRateLimit` is set (default: 60 calls/minute), it applies to all tools.

Tool-specific rate limits from the default configuration:

| Tool                 | Rate Limit (calls/min) |
| -------------------- | ---------------------- |
| `execute_javascript` | 10                     |
| `execute_python`     | 10                     |
| `execute_shell`      | 5                      |
| `compile_code`       | 5                      |
| `package_manager`    | 3                      |
| `search_web`         | 20                     |

**Factory functions:**

```typescript
// Default policy (read-only by default)
createPermissionChecker(policy?: Partial<PermissionPolicy>): PermissionChecker;

// Read-only (file_read + memory only)
createRestrictiveChecker(): PermissionChecker;

// Full access (all categories, admin level)
createPermissiveChecker(): PermissionChecker;

// Wrap a tool executor with permission checking
withPermissionCheck(toolName, executor, checker): WrappedExecutor;
```

---

## Provider System

### IProvider Interface

**File:** `packages/core/src/agent/provider.ts`

Every AI provider implements:

```typescript
interface IProvider {
  readonly type: AIProvider;
  isReady(): boolean;
  complete(request: CompletionRequest): Promise<Result<CompletionResponse, Error>>;
  stream(request: CompletionRequest): AsyncGenerator<Result<StreamChunk, Error>>;
  countTokens(messages: readonly Message[]): number;
  getModels(): Promise<Result<string[], Error>>;
}
```

**Supported `AIProvider` types:**

`openai`, `anthropic`, `google`, `deepseek`, `groq`, `mistral`, `zhipu`, `cohere`, `together`, `fireworks`, `perplexity`, `openrouter`, `xai`, `local`, `custom`

### Built-in Providers

| Provider  | Class                      | Base URL                       | Auth               |
| --------- | -------------------------- | ------------------------------ | ------------------ |
| OpenAI    | `OpenAIProvider`           | `https://api.openai.com/v1`    | Bearer token       |
| Anthropic | `AnthropicProvider`        | `https://api.anthropic.com/v1` | `x-api-key` header |
| Google    | `GoogleProvider`           | Native Gemini SDK              | API key            |
| Others    | `OpenAICompatibleProvider` | Provider-specific              | Bearer token       |

All providers inherit from `BaseProvider` which provides:

- `cancel()` via `AbortController`
- `createFetchOptions()` with configurable timeout (default: 5 minutes)
- `parseToolCalls()` for normalizing tool call formats
- `buildMessages()` for converting internal messages to OpenAI format
- `buildTools()` for converting tool definitions to OpenAI function calling format
- `countTokens()` approximation (~4 chars per token)

**Retry configuration:**
All providers use exponential backoff with jitter:

| Parameter          | Value   |
| ------------------ | ------- |
| Max retries        | 3       |
| Initial delay      | 1000ms  |
| Max delay          | 10000ms |
| Backoff multiplier | 2       |
| Jitter             | enabled |

### FallbackProvider

**File:** `packages/core/src/agent/providers/fallback.ts`

Wraps a primary provider with ordered fallback providers. On failure, it automatically tries the next provider.

```typescript
class FallbackProvider implements IProvider {
  constructor(config: FallbackProviderConfig);
  complete(request): Promise<Result<CompletionResponse, Error>>;
  stream(request): AsyncGenerator<Result<StreamChunk, Error>>;
  getCurrentProvider(): AIProvider;
  cancel(): void;
}
```

**Fallback rules:**

- Always fallback on `TimeoutError`.
- Fallback on rate limits (429), server errors (500-504), network errors.
- Do NOT fallback on API key errors or validation errors (they would fail everywhere).
- Unknown errors: attempt fallback.

### ProviderRouter

**File:** `packages/core/src/agent/providers/router.ts`

Smart routing between providers based on cost, speed, quality, and capability requirements.

```typescript
class ProviderRouter {
  constructor(config?: RouterConfig);
  getAvailableProviders(): ResolvedProviderConfig[];
  selectProvider(criteria?, strategy?): Result<RoutingResult, Error>;
  complete(request, criteria?, strategy?): Promise<Result<CompletionResponse & { routingInfo }, Error>>;
  stream(request, criteria?, strategy?): AsyncGenerator<...>;
  completeWithFallback(request, criteria?): Promise<Result<... & { attempts: string[] }, Error>>;
  estimateCost(inputTokens, outputTokens, criteria?, strategy?): Result<{ estimatedCost }, Error>;
}
```

**Routing strategies:**

| Strategy   | Behavior                                                |
| ---------- | ------------------------------------------------------- |
| `cheapest` | Select the lowest-cost model with required capabilities |
| `fastest`  | Select the lowest-latency model                         |
| `smartest` | Select the highest-quality model for complex reasoning  |
| `balanced` | Balance cost and quality (default)                      |
| `fallback` | Try providers in priority order until one succeeds      |

Default fallback order: `anthropic -> openai -> google -> deepseek -> groq`

Provider instances are cached to avoid repeated initialization.

---

## Code Generator

**File:** `packages/core/src/agent/code-generator.ts`

AI-driven code generation with sandbox execution support.

```typescript
class CodeGenerator {
  constructor(config?: Partial<CodeGeneratorConfig>);
  setLLMProvider(provider: CodeLLMProvider): void;
  generate(request: CodeGenerationRequest): Promise<CodeGenerationResponse>;
  execute(code: string, language: CodeLanguage, options?): Promise<CodeExecutionResult>;
  validateCode(code: string, language: CodeLanguage): { valid: boolean; errors: string[] };
  isExecutable(language: CodeLanguage): boolean;
  saveSnippet(userId, snippet): CodeSnippet;
  getSnippets(userId, filter?): CodeSnippet[];
  getStats(userId?): ExecutionStats;
}
```

**Supported languages:** `javascript`, `typescript`, `python`, `shell`, `sql`, `html`, `css`, `json`, `markdown`

**Executable languages (sandbox):** `javascript`, `typescript` only

**Code validation checks:**

- Maximum code length (default: 50,000 characters)
- Language-specific validation (JavaScript/TypeScript)
- Dangerous pattern detection:
  - `process.exit`
  - `require('child_process')`
  - `require('fs')`
  - `eval()`
  - `Function()`
  - Dynamic `import()`

**Sandbox defaults:**

- Allowed: timers, crypto
- Denied: network, env, spawn, fs read, fs write
- Resource limits: 64MB memory, 30s CPU time, 30s execution timeout

When no LLM provider is configured, the generator falls back to built-in code templates for common patterns (Fibonacci, factorial, prime checks, sorting, date formatting, array utilities).

---

## Tool System

### Tool Definition

```typescript
interface ToolDefinition {
  name: string; // Unique identifier (e.g., "read_file")
  description: string; // Human-readable description
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  requiresConfirmation?: boolean; // Whether to ask the user first
  category?: string; // Grouping category
  tags?: string[]; // Hidden search tags for discovery
}
```

### Tool Registry

The `ToolRegistry` manages tool definitions and their executors. It supports:

- Registration and unregistration
- Executor updates (for plugin overrides)
- Filtering by names
- Tool discovery by name or definition
- Workspace directory configuration
- API key center integration

### Meta-Tools

The system exposes three meta-tools to the LLM instead of 100+ individual tool schemas. This reduces token consumption from approximately 20K+ tokens per request to under 1K.

| Meta-Tool                        | Purpose                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_tools(query, category?)` | Keyword search across all registered tools. Supports AND matching, category filtering, and "all" to list everything.                                 |
| `get_tool_help(tool_name)`       | Returns detailed help for a specific tool: description, required/optional parameters with types, default values, examples, and rate limits.          |
| `use_tool(tool_name, arguments)` | Proxy executor that validates parameters, applies max limits, executes the tool, and auto-includes parameter help on errors for LLM self-correction. |

**Error recovery:** When `use_tool` fails, the error response includes full parameter documentation so the LLM can fix its call and retry without needing a separate `get_tool_help` call.

**Tool max limits:** List-returning tools have enforced maximum values (e.g., `list_emails` capped at 50 results) via the `applyToolLimits()` function to prevent unbounded queries.

### Tool Categories

The system organizes tools into these categories:

| Category        | Tools                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Tasks           | `add_task`, `batch_add_tasks`, `list_tasks`, `complete_task`, `update_task`, `delete_task`         |
| Bookmarks       | `add_bookmark`, `batch_add_bookmarks`, `list_bookmarks`, `delete_bookmark`                         |
| Notes           | `add_note`, `batch_add_notes`, `list_notes`, `update_note`, `delete_note`                          |
| Calendar        | `add_calendar_event`, `batch_add_calendar_events`, `list_calendar_events`, `delete_calendar_event` |
| Contacts        | `add_contact`, `batch_add_contacts`, `list_contacts`, `update_contact`, `delete_contact`           |
| Custom Data     | `create_custom_table`, `add_custom_record`, `list_custom_records`, `search_custom_records`, ...    |
| File System     | `read_file`, `write_file`, `list_directory`, `search_files`, `download_file`, `file_info`, ...     |
| PDF             | `read_pdf`, `create_pdf`, `pdf_info`                                                               |
| Code Execution  | `execute_javascript`, `execute_python`, `execute_shell`, `compile_code`, `package_manager`         |
| Git             | `git_status`, `git_diff`, `git_log`, `git_commit`, `git_add`, `git_branch`, `git_checkout`         |
| Web and API     | `http_request`, `fetch_web_page`, `search_web`, `json_api`                                         |
| Email           | `send_email`, `list_emails`, `read_email`, `delete_email`, `search_emails`, `reply_email`          |
| Image           | `analyze_image`, `generate_image`, `edit_image`, `image_variation`, `resize_image`                 |
| Audio           | `text_to_speech`, `speech_to_text`, `translate_audio`, `audio_info`, `split_audio`                 |
| Translation     | `translate_text`, `detect_language`, `list_languages`, `batch_translate`                           |
| Data Extraction | `extract_structured_data`, `extract_entities`, `extract_table_data`, `summarize_text`              |
| Vector Search   | `create_embedding`, `semantic_search`, `upsert_vectors`, `delete_vectors`, ...                     |
| Finance         | `add_expense`, `batch_add_expenses`, `parse_receipt`, `query_expenses`, `export_expenses`, ...     |
| Weather         | `get_weather`, `get_weather_forecast`                                                              |
| Memory          | `remember`, `batch_remember`, `recall`, `forget`, `list_memories`, `boost_memory`, `memory_stats`  |
| Goals           | `create_goal`, `list_goals`, `update_goal`, `decompose_goal`, `get_next_actions`, ...              |
| Dynamic Tools   | `create_tool`, `list_custom_tools`, `delete_custom_tool`, `toggle_custom_tool`                     |
| Utilities       | `get_current_datetime`, `calculate`, `convert_units`, `generate_uuid`, `regex`, `format_json`, ... |

---

## Planning System

**File:** `packages/core/src/agent/orchestrator.ts` (line 820)

The planning system decomposes complex goals into executable step sequences.

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

**`createPlanningPrompt(goal, availableTools)`** generates a prompt that instructs the LLM to decompose a goal into numbered steps, specifying which tool to use for each and listing dependencies.

**`parsePlan(response)`** extracts the JSON plan from the LLM's response using regex matching.

Additionally, the gateway provides plan management tools:

- `create_plan(name, goal)` -- create a new plan
- `add_plan_step(plan_id, order, type, name, ...)` -- add steps (types: `tool_call`, `llm_decision`, `user_input`, `condition`, `parallel`, `loop`)
- `execute_plan(plan_id)` -- execute with dependency resolution, retry with exponential backoff, deadlock detection
- `pause_plan`, `delete_plan`, `list_plans`, `get_plan_details`

---

## Gateway Integration

### Database Schema

Agent records are stored in a database table:

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',  -- JSON blob
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

The `config` JSON blob contains:

```json
{
  "maxTokens": 8192,
  "temperature": 0.7,
  "maxTurns": 25,
  "maxToolCalls": 200,
  "tools": ["read_file", "write_file"],
  "toolGroups": ["file_system", "memory"]
}
```

**Repository:** `packages/gateway/src/db/repositories/agents.ts`

```typescript
class AgentsRepository extends BaseRepository {
  create(data): Promise<AgentRecord>;
  getById(id: string): Promise<AgentRecord | null>;
  getByName(name: string): Promise<AgentRecord | null>;
  getAll(): Promise<AgentRecord[]>;
  update(id: string, data): Promise<AgentRecord | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}
```

### REST API

**Base path:** `/api/agents`

| Method   | Path         | Description                     |
| -------- | ------------ | ------------------------------- |
| `GET`    | `/`          | List all agents                 |
| `POST`   | `/`          | Create a new agent              |
| `GET`    | `/:id`       | Get agent details               |
| `PATCH`  | `/:id`       | Update agent configuration      |
| `DELETE` | `/:id`       | Delete an agent                 |
| `POST`   | `/:id/reset` | Reset agent conversation        |
| `POST`   | `/resync`    | Resync from default agents JSON |

**Create agent request:**

```json
{
  "name": "Research Agent",
  "systemPrompt": "You are a research assistant...",
  "provider": "default",
  "model": "default",
  "maxTokens": 8192,
  "temperature": 0.7,
  "maxTurns": 25,
  "maxToolCalls": 200,
  "tools": ["read_file"],
  "toolGroups": ["web_access", "memory"]
}
```

Provider and model default to `"default"`, which resolves at runtime to the user's configured default provider and model.

### Agent Lifecycle in the Gateway

The gateway manages the full lifecycle of runtime Agent instances:

```
1. CREATION (POST /api/agents)
   - Store configuration in database
   - Runtime Agent is NOT created yet (lazy initialization)

2. FIRST USE (chat request referencing the agent)
   a. Load AgentRecord from database
   b. Resolve "default" provider/model to actual values from user settings
   c. Load API key for the resolved provider
   d. Create ToolRegistry and register ALL tool categories:
      - Core tools (file, code, web, etc.)
      - Memory tools (with gateway executor wiring)
      - Goal tools (with gateway executor wiring)
      - Custom data tools
      - Personal data tools (tasks, bookmarks, notes, calendar, contacts)
      - Config center tools
      - Trigger management tools
      - Plan management tools
      - Dynamic tool meta-tools (search_tools, get_tool_help, use_tool)
      - Active custom tools (user-created)
      - Channel tools
      - Plugin tools (with core stub replacement)
   e. Remove superseded core stubs when plugins provide real implementations
   f. Build memory context from persistent memories database
   g. Build goal context from active goals database
   h. Compose enriched system prompt via injectMemoryIntoPrompt()
   i. Configure Agent with meta-tool filter (only expose search_tools, get_tool_help, use_tool)
   j. Create and cache Agent instance

3. CACHING
   - Named agents: cached in agentCache (Map<string, Agent>)
   - Chat agents: cached in chatAgentCache (Map<string, Agent>) keyed by "chat:{provider}:{model}"
   - Config cached in agentConfigCache (Map<string, AgentConfig>)

4. INVALIDATION
   - Agent update (PATCH): cache entry deleted, recreated on next use
   - Agent delete (DELETE): cache entry deleted
   - Plugin/tool changes: invalidateAgentCache() clears all caches
   - New chat: resetChatAgentContext() creates fresh conversation within existing agent

5. TOOL EXECUTION FLOW (at runtime)
   a. LLM calls search_tools("keyword") -> returns matching tool names
   b. LLM calls get_tool_help("tool_name") -> returns parameter schema and example
   c. LLM calls use_tool("tool_name", { args }) -> gateway validates and executes:
      - Pre-validates required parameters
      - Applies max limits for list-returning tools
      - Executes via ToolRegistry
      - On error: returns error + auto-generated parameter help for self-correction
   d. All tool executions are traced via the tracing system
```

### Default Agents

Default agents are loaded from `data/seeds/default-agents.json` via the seed loader at `packages/gateway/src/db/seeds/default-agents.ts`.

Each default agent has:

```typescript
interface AgentSeed {
  id: string;
  name: string;
  systemPrompt: string;
  provider: string; // Always "default"
  model: string; // Always "default"
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
    tools?: string[];
    toolGroups?: string[];
  };
}
```

The JSON file supports additional fields: `emoji`, `category`, `dataAccess`, and `triggers` (with keyword matching for automatic agent selection).

The `POST /api/agents/resync` endpoint reloads defaults from the JSON file, updating existing agents and creating new ones.

---

## Type Reference

### Core Message Types

```typescript
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface Message {
  role: MessageRole;
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
  metadata?: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}
```

### Execution Context Types

```typescript
interface OrchestratorContext {
  id: string;
  iteration: number;
  messages: Message[];
  toolCalls: ToolCallRecord[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  response?: string;
  error?: string;
  metadata: Record<string, unknown>;
}

interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  error?: string;
}

interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response';
  content: unknown;
  timestamp: Date;
}

interface AgentState {
  conversation: Conversation;
  toolCallCount: number;
  turnCount: number;
  isProcessing: boolean;
  lastError?: string;
}
```

### Completion Types

```typescript
interface CompletionRequest {
  messages: readonly Message[];
  model: ModelConfig;
  tools?: readonly ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  stream?: boolean;
  user?: string;
}

interface CompletionResponse {
  id: string;
  content: string;
  toolCalls?: readonly ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage?: TokenUsage;
  model: string;
  createdAt: Date;
}

interface StreamChunk {
  id: string;
  content?: string;
  toolCalls?: readonly Partial<ToolCall>[];
  done: boolean;
  finishReason?: CompletionResponse['finishReason'];
  usage?: TokenUsage;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}
```

---

## File Map

| File                                                     | Contents                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/core/src/agent/agent.ts`                       | `Agent` class, `createAgent()`, `createSimpleAgent()`                                         |
| `packages/core/src/agent/orchestrator.ts`                | `AgentOrchestrator`, `AgentBuilder`, `MultiAgentOrchestrator`, `Plan`, planning utilities     |
| `packages/core/src/agent/types.ts`                       | All TypeScript interfaces and type definitions                                                |
| `packages/core/src/agent/provider.ts`                    | `IProvider`, `BaseProvider`, `OpenAIProvider`, `AnthropicProvider`, `createProvider()`        |
| `packages/core/src/agent/providers/google.ts`            | `GoogleProvider` (native Gemini SDK)                                                          |
| `packages/core/src/agent/providers/openai-compatible.ts` | `OpenAICompatibleProvider` for third-party providers                                          |
| `packages/core/src/agent/providers/fallback.ts`          | `FallbackProvider` with automatic provider failover                                           |
| `packages/core/src/agent/providers/router.ts`            | `ProviderRouter` with strategy-based selection                                                |
| `packages/core/src/agent/providers/configs/`             | Provider config loader and sync logic                                                         |
| `data/providers/`                                        | Provider JSON configuration files (100+), synced from models.dev                              |
| `packages/core/src/events/`                              | EventBus -- typed event system with wildcard subscriptions for agent, tool, and system events |
| `packages/core/src/agent/prompt-composer.ts`             | `PromptComposer`, `WorkspaceContext`, `TimeContext`, `AgentCapabilities`                      |
| `packages/core/src/agent/memory-injector.ts`             | `MemoryInjector`, `injectMemoryIntoPrompt()`, `createEnhancedAgentPrompt()`                   |
| `packages/core/src/agent/memory.ts`                      | `ConversationMemory`, `createMemory()`                                                        |
| `packages/core/src/agent/permissions.ts`                 | `PermissionChecker`, permission levels, categories, policies                                  |
| `packages/core/src/agent/code-generator.ts`              | `CodeGenerator`, sandbox execution, code validation                                           |
| `packages/core/src/agent/tools.ts`                       | `ToolRegistry`, `registerCoreTools()`                                                         |
| `packages/core/src/agent/tools/index.ts`                 | All tool exports, `registerAllTools()`, `TOOL_CATEGORIES`, `TOOL_SETS`                        |
| `packages/core/src/agent/tools/dynamic-tools.ts`         | Meta-tools: `search_tools`, `get_tool_help`, `use_tool`, `create_tool`                        |
| `packages/core/src/agent/tools/tool-tags.ts`             | Hidden search tags for tool discovery                                                         |
| `packages/core/src/agent/tools/tool-limits.ts`           | Maximum parameter limits for list-returning tools                                             |
| `packages/core/src/agent/retry.ts`                       | `withRetry()` exponential backoff utility                                                     |
| `packages/core/src/agent/debug.ts`                       | Request/response logging, payload breakdown                                                   |
| `packages/core/src/agent/presets.ts`                     | Agent presets                                                                                 |
| `packages/gateway/src/routes/agents.ts`                  | Agent CRUD routes, runtime agent creation, tool registration, caching                         |
| `packages/gateway/src/db/repositories/agents.ts`         | `AgentsRepository` database access                                                            |
| `packages/gateway/src/db/seeds/default-agents.ts`        | Default agent loader from JSON                                                                |
