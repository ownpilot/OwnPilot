# Coding Agents

OwnPilot can orchestrate external AI coding CLI tools -- Claude Code (Anthropic), Codex (OpenAI), and Gemini CLI (Google) -- as first-class coding agents. Users can also register custom CLI providers beyond the built-in three.

Each coding agent runs as a child process in a user-specified working directory, authenticates with the user's own credentials, and streams output to the web UI in real time via WebSocket.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Supported Providers](#supported-providers)
- [Session Lifecycle](#session-lifecycle)
- [Execution Modes](#execution-modes)
- [Environment Sanitization](#environment-sanitization)
- [Custom Providers](#custom-providers)
- [AI Tool Definitions](#ai-tool-definitions)
- [REST API Reference](#rest-api-reference)
  - [Coding Agents Endpoints](#coding-agents-endpoints)
  - [CLI Providers Endpoints](#cli-providers-endpoints)
- [WebSocket Events](#websocket-events)
- [Database Tables](#database-tables)
- [UI Pages and Components](#ui-pages-and-components)
- [Key Source Files](#key-source-files)

---

## Architecture Overview

```
User (UI / AI tool)
       |
       v
  REST API (/coding-agents/sessions)
       |
       v
  CodingAgentService  (singleton, gateway)
       |
       +---> resolves provider (built-in or custom:name)
       +---> resolves API key (Config Center -> env var -> none)
       +---> validates binary installed on PATH
       +---> creates sanitized env (strips OwnPilot secrets, injects API key)
       +---> builds CLI args per provider
       |
       v
  CodingAgentSessionManager  (singleton, max 3 per user)
       |
       +---> mode=auto: spawnStreamingProcess() (child_process.spawn)
       +---> mode=interactive: spawnStreamingPty() (node-pty)
       |
       v
  PtyHandle  (write, resize, kill, dispose)
       |
       +---> onData -> ring buffer (100 KB) + broadcast to WS subscribers
       +---> onExit -> persist result to DB + fire completion callbacks
       +---> onError -> persist error + broadcast
       |
       v
  WebSocket (coding-agent:session:output / state / exit / error)
       |
       v
  XTerminal / AutoModePanel  (xterm.js or structured view in browser)
```

The flow in detail:

1. **Provider selection** -- Built-in (`claude-code`, `codex`, `gemini-cli`) or custom (`custom:{name}`).
2. **API key resolution** -- Config Center service lookup, then environment variable fallback. API keys are optional for all CLI providers since they support login-based auth (OAuth, Google account, ChatGPT subscription).
3. **Session creation** -- `CodingAgentSessionManager` enforces a maximum of 3 concurrent sessions per user, assigns a UUID, and spawns the process.
4. **Process spawning** -- Auto mode uses `child_process.spawn` with piped stdio (no native dependencies). Interactive mode uses `node-pty` for full terminal emulation (requires native compilation tools).
5. **Output streaming** -- Raw data flows through the ring buffer (last 100 KB kept for reconnection replay) and is broadcast to all subscribed WebSocket clients. Claude Code `stream-json` output is parsed by `AutoModePanel` for structured display.
6. **Result storage** -- On exit, ANSI escape codes are stripped and the result is persisted to the `coding_agent_results` table.

---

## Supported Providers

| Provider      | Binary   | Install Command                      | Auth                                 | API Key Env Var     | Docs                                                   |
| ------------- | -------- | ------------------------------------ | ------------------------------------ | ------------------- | ------------------------------------------------------ |
| `claude-code` | `claude` | `npm i -g @anthropic-ai/claude-code` | Claude Pro subscription or API key   | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `codex`       | `codex`  | `npm i -g @openai/codex`             | ChatGPT Plus subscription or API key | `CODEX_API_KEY`     | [platform.openai.com](https://platform.openai.com)     |
| `gemini-cli`  | `gemini` | `npm i -g @google/gemini-cli`        | Google account login or API key      | `GEMINI_API_KEY`    | [aistudio.google.com](https://aistudio.google.com)     |

All three providers support **login-based auth** -- no API key is strictly required. When an API key is configured (via Config Center or environment variable), it is injected into the child process environment. When no key is configured, the CLI falls back to its native authentication flow (OAuth, browser login, etc.), which works in interactive mode.

**Claude Code** additionally supports an SDK mode (`@anthropic-ai/claude-agent-sdk`) that runs in-process without spawning a CLI binary. SDK mode always requires `ANTHROPIC_API_KEY`.

### Provider CLI Arguments

Each provider gets specific CLI arguments depending on the mode:

**Auto mode (non-interactive):**

| Provider      | CLI Arguments                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `claude-code` | `-p <prompt> --dangerously-skip-permissions --output-format stream-json --verbose [--model M]` |
| `codex`       | `exec --full-auto <prompt> [--model M]`                                                        |
| `gemini-cli`  | `-p <prompt> [--model M]`                                                                      |

**Interactive mode:** All providers are launched with no arguments (bare REPL mode) since user input drives the session.

---

## Session Lifecycle

```
       create
         |
         v
    [ starting ]
         |
     spawn OK?
    /         \
  yes          no
   |            |
   v            v
[ running ]  (cleanup, throw)
   |
   +--- onData -> stream to WS subscribers
   |
   +--- onExit(0) ---------> [ completed ]
   +--- onExit(non-0) -----> [ failed ]
   +--- onError ------------> [ failed ]
   +--- terminateSession() -> [ terminated ]
   |
   v
(persist result to DB)
(fire completion callbacks)
(cleanup after 5 minutes)
```

### Key Constants

| Constant                 | Value              | Description                             |
| ------------------------ | ------------------ | --------------------------------------- |
| `MAX_SESSIONS_PER_USER`  | 3                  | Maximum concurrent sessions per user    |
| `SESSION_TIMEOUT_MS`     | 1,800,000 (30 min) | Default session timeout                 |
| `OUTPUT_BUFFER_MAX`      | 102,400 (100 KB)   | Ring buffer for reconnection replay     |
| `CLEANUP_INTERVAL_MS`    | 60,000 (1 min)     | Cleanup interval for expired sessions   |
| `DEFAULT_TIMEOUT_MS`     | 300,000 (5 min)    | Default task timeout (legacy `runTask`) |
| `MAX_TIMEOUT_MS`         | 1,800,000 (30 min) | Maximum allowed timeout                 |
| `DEFAULT_MAX_TURNS`      | 10                 | Default agent turns (Claude Code SDK)   |
| `DEFAULT_MAX_BUDGET_USD` | 1.0                | Default cost cap (Claude Code SDK)      |

### Session States

| State        | Description                                               |
| ------------ | --------------------------------------------------------- |
| `starting`   | Session created, process being spawned                    |
| `running`    | Process is alive and producing output                     |
| `waiting`    | Process is waiting for user input (interactive mode)      |
| `completed`  | Process exited with code 0                                |
| `failed`     | Process exited with non-zero code or encountered an error |
| `terminated` | User manually killed the session                          |

Completed, failed, and terminated sessions are automatically cleaned up 5 minutes after completion.

---

## Execution Modes

### Auto Mode (default)

- Uses `child_process.spawn` via `spawnStreamingProcess()` -- **no native dependencies required**.
- stdin is closed immediately after spawn (auto-mode CLIs read prompts from arguments, not stdin).
- stdout and stderr are merged into a single output stream.
- `resize()` is a no-op (no terminal dimensions).
- On Windows, commands are wrapped with `cmd.exe /c` for `.cmd`/`.bat` script resolution.

### Interactive Mode

- Uses `node-pty` via `spawnStreamingPty()` -- **requires `node-pty` as an optional dependency**.
- Full PTY (pseudo-terminal) emulation with ANSI color support.
- Users can type input, approve/deny tool calls, and interact with the CLI.
- Terminal resize events propagate from the browser (xterm.js) through WebSocket to the PTY.
- On Windows, `cmd.exe /c` wrapping is used for PATH resolution of npm global binaries.

### PTY Mode (legacy)

- Used by the legacy `runTask()` API (blocking, non-streaming).
- Calls `runWithPty()` which spawns a PTY, collects all output, strips ANSI codes, and returns on exit.
- Only available for built-in providers.

### Comparison

| Feature                 | Auto Mode               | Interactive Mode       |
| ----------------------- | ----------------------- | ---------------------- |
| Native dependency       | None                    | `node-pty` required    |
| Terminal emulation      | No (piped stdio)        | Yes (full PTY)         |
| ANSI colors             | Only if CLI forces them | Full support           |
| User input              | Not supported           | Full keyboard input    |
| Resize support          | No                      | Yes                    |
| Default for AI tools    | Yes                     | No                     |
| Default for UI sessions | Yes                     | No (requires node-pty) |

---

## Environment Sanitization

The `createSanitizedEnv()` function in `binary-utils.ts` prepares the environment for child processes:

```typescript
function createSanitizedEnv(
  provider: string,
  apiKey?: string,
  apiKeyEnvVar?: string
): Record<string, string>;
```

### What it does

1. **Copies** the current `process.env` as the base.

2. **Strips sensitive OwnPilot variables** matching these patterns:
   - `OWNPILOT_*`
   - `DATABASE_*`
   - `ADMIN_KEY`
   - `JWT_SECRET`
   - `SESSION_SECRET`

3. **Removes nesting-detection variables** that prevent child CLI processes from starting:
   - `CLAUDECODE` -- Claude Code sets this; child processes refuse to start if present ("cannot be launched inside another session").
   - `CLAUDE_CODE` -- Same purpose, alternate name.

4. **Injects the provider's API key** (if available) into the correct environment variable:
   - `claude-code` -> `ANTHROPIC_API_KEY`
   - `codex` -> `CODEX_API_KEY`
   - `gemini-cli` -> `GEMINI_API_KEY`
   - Custom providers -> value of `apiKeyEnvVar` field from the `cli_providers` record

### Binary Detection

`isBinaryInstalled()` and `getBinaryVersion()` use `execFileSync` with `which` (Unix) or `where` (Windows) to safely detect CLI binaries without shell injection.

### Working Directory Validation

`validateCwd()` ensures the path is absolute and contains no path traversal (`..`).

---

## Custom Providers

Users can register any CLI tool as a coding agent provider. Custom providers appear in the system as `custom:{name}` and are stored in the `cli_providers` database table.

### Registration

Custom providers are created via `POST /cli-providers` with these fields:

| Field                 | Required | Description                                                       |
| --------------------- | -------- | ----------------------------------------------------------------- |
| `name`                | Yes      | Lowercase alphanumeric with hyphens (e.g., `aider`, `my-tool`)    |
| `display_name`        | Yes      | Human-readable name shown in UI                                   |
| `binary`              | Yes      | CLI binary name (must be on PATH)                                 |
| `description`         | No       | Short description                                                 |
| `category`            | No       | Category string (default: `general`)                              |
| `auth_method`         | No       | `none`, `config_center`, or `env_var` (default: `none`)           |
| `config_service_name` | No       | Config Center service name (when `auth_method` = `config_center`) |
| `api_key_env_var`     | No       | Environment variable name for the API key                         |
| `default_args`        | No       | Default CLI arguments (JSON array of strings)                     |
| `prompt_template`     | No       | Template with `{prompt}`, `{cwd}`, `{model}` placeholders         |
| `output_format`       | No       | `text`, `json`, or `stream-json` (default: `text`)                |
| `default_timeout_ms`  | No       | Default timeout (default: 300,000 ms)                             |
| `max_timeout_ms`      | No       | Maximum timeout (default: 1,800,000 ms)                           |

### Prompt Template

When `prompt_template` is set, the template string is expanded with these placeholders:

- `{prompt}` -- The user's task description
- `{cwd}` -- The working directory
- `{model}` -- The model override (empty string if not specified)

When no template is set, the prompt is passed as the last argument after `default_args`.

### Example: Registering Aider

```json
{
  "name": "aider",
  "display_name": "Aider",
  "binary": "aider",
  "description": "AI pair programming in your terminal",
  "auth_method": "env_var",
  "api_key_env_var": "OPENAI_API_KEY",
  "default_args": ["--no-auto-commits", "--yes"],
  "prompt_template": "--message {prompt}",
  "output_format": "text"
}
```

After registration, the provider is available as `custom:aider` in session creation and AI tool calls.

---

## AI Tool Definitions

Four AI tools are registered in the `Coding Agents` category, usable by OwnPilot's main agent and in workflows:

### `run_coding_task`

Delegates a coding task to an external AI coding agent. Creates a visible session that the user can watch in real-time via the MiniTerminal.

**Parameters:**

| Parameter         | Type   | Required | Description                                               |
| ----------------- | ------ | -------- | --------------------------------------------------------- |
| `provider`        | string | Yes      | `claude-code`, `codex`, `gemini-cli`, or `custom:{name}`  |
| `prompt`          | string | Yes      | Task description                                          |
| `cwd`             | string | No       | Working directory (absolute path)                         |
| `model`           | string | No       | Model override (e.g., `claude-sonnet-4-5-20250929`, `o3`) |
| `max_budget_usd`  | number | No       | Cost cap in USD (default: 1.0, Claude Code SDK only)      |
| `max_turns`       | number | No       | Max agent turns (default: 10, Claude Code SDK only)       |
| `timeout_seconds` | number | No       | Timeout (default: 300, max: 1800)                         |

The tool creates a session in `auto` mode with `source: 'ai-tool'`, waits for completion via `waitForCompletion()`, and returns the persisted result. Output is truncated to 8,000 characters for the LLM context window.

### `list_coding_agents`

Lists all available coding agents (built-in and custom) with their status: installed, configured, version, PTY availability.

### `get_task_result`

Retrieves a previously executed coding agent task result by its result ID.

**Parameters:** `result_id` (string, required)

### `list_task_results`

Lists recent coding agent task results with summaries.

**Parameters:** `limit` (number, optional, default: 10, max: 50)

### Config Requirements

Each built-in provider registers a Config Center service for API key management:

| Config Service       | Display Name | Env Var             |
| -------------------- | ------------ | ------------------- |
| `coding-claude-code` | Claude Code  | `ANTHROPIC_API_KEY` |
| `coding-codex`       | OpenAI Codex | `CODEX_API_KEY`     |
| `coding-gemini`      | Gemini CLI   | `GEMINI_API_KEY`    |

---

## REST API Reference

### Coding Agents Endpoints

All endpoints are prefixed with `/coding-agents`.

#### `GET /coding-agents/status`

List all provider statuses (built-in + custom).

**Response:** Array of `CodingAgentStatus` objects:

```json
[
  {
    "provider": "claude-code",
    "displayName": "Claude Code",
    "installed": true,
    "hasApiKey": false,
    "configured": false,
    "authMethod": "both",
    "version": "1.0.18",
    "ptyAvailable": false
  }
]
```

#### `POST /coding-agents/run`

Run a coding task (legacy blocking mode). Returns the result when complete.

**Request body:**

```json
{
  "provider": "claude-code",
  "prompt": "Add error handling to src/api.ts",
  "cwd": "/home/user/project",
  "model": "claude-sonnet-4-5-20250929",
  "max_budget_usd": 1.0,
  "max_turns": 10,
  "timeout_seconds": 300,
  "mode": "auto"
}
```

**Response:** `CodingAgentResult` (200 on success, 422 on task failure).

#### `POST /coding-agents/test`

Quick connectivity test for a provider.

**Request body:** `{ "provider": "claude-code" }`

**Response:**

```json
{
  "provider": "claude-code",
  "available": true,
  "installed": true,
  "configured": false,
  "version": "1.0.18",
  "ptyAvailable": false
}
```

#### `GET /coding-agents/sessions`

List active sessions for the authenticated user.

#### `POST /coding-agents/sessions`

Create a new session.

**Request body:**

```json
{
  "provider": "claude-code",
  "prompt": "Refactor the authentication module",
  "cwd": "/home/user/project",
  "mode": "auto",
  "model": "claude-sonnet-4-5-20250929",
  "timeout_seconds": 600
}
```

**Response:** `CodingAgentSession` (201 Created)

**Error codes:**

- 400: Invalid provider or missing prompt
- 409: Maximum 3 concurrent sessions
- 422: CLI not installed or node-pty not available
- 500: Internal error

#### `GET /coding-agents/sessions/:id`

Get a specific session.

#### `DELETE /coding-agents/sessions/:id`

Terminate a session. Sends SIGTERM to the process.

#### `POST /coding-agents/sessions/:id/input`

Send input to a session's stdin (REST fallback for WebSocket).

**Request body:** `{ "data": "y\r" }`

#### `POST /coding-agents/sessions/:id/resize`

Resize terminal dimensions (interactive mode only).

**Request body:** `{ "cols": 120, "rows": 40 }`

#### `GET /coding-agents/sessions/:id/output`

Get the session output buffer (REST fallback for WebSocket reconnection).

**Response:**

```json
{
  "sessionId": "uuid",
  "state": "running",
  "output": "... last 100KB of output ...",
  "hasOutput": true
}
```

#### `GET /coding-agents/results`

List persisted coding agent results. Supports pagination via `page` and `limit` query params.

#### `GET /coding-agents/results/:id`

Get a specific persisted result.

### CLI Providers Endpoints

All endpoints are prefixed with `/cli-providers`.

#### `GET /cli-providers`

List all custom CLI providers for the authenticated user.

#### `POST /cli-providers`

Create a new custom CLI provider.

**Request body:**

```json
{
  "name": "aider",
  "display_name": "Aider",
  "binary": "aider",
  "description": "AI pair programming",
  "auth_method": "env_var",
  "api_key_env_var": "OPENAI_API_KEY",
  "default_args": ["--no-auto-commits", "--yes"],
  "prompt_template": "--message {prompt}",
  "output_format": "text"
}
```

**Response:** `CliProviderRecord` (201 Created)

#### `PUT /cli-providers/:id`

Update a custom CLI provider. All fields are optional.

#### `DELETE /cli-providers/:id`

Delete a custom CLI provider.

#### `POST /cli-providers/:id/test`

Test if the provider's binary is installed and get its version.

**Response:**

```json
{
  "installed": true,
  "version": "0.75.1",
  "binary": "aider"
}
```

---

## WebSocket Events

### Server-to-Client Events

| Event                          | Payload                                                                              | Description                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `coding-agent:session:created` | `{ session: { id, provider, displayName, state, mode, prompt, startedAt, userId } }` | New session created (broadcast to all clients)                 |
| `coding-agent:session:output`  | `{ sessionId, data }`                                                                | Incremental output from the process (raw bytes including ANSI) |
| `coding-agent:session:state`   | `{ sessionId, state }`                                                               | Session state changed                                          |
| `coding-agent:session:exit`    | `{ sessionId, exitCode, signal? }`                                                   | Process exited                                                 |
| `coding-agent:session:error`   | `{ sessionId, error }`                                                               | Error occurred (timeout, spawn failure)                        |

### Client-to-Server Events

| Event                    | Payload                     | Description                                                    |
| ------------------------ | --------------------------- | -------------------------------------------------------------- |
| `coding-agent:input`     | `{ sessionId, data }`       | Send input to session stdin                                    |
| `coding-agent:resize`    | `{ sessionId, cols, rows }` | Resize terminal dimensions                                     |
| `coding-agent:subscribe` | `{ sessionId }`             | Subscribe to session output (triggers replay of output buffer) |

### Subscriber Management

When a WebSocket client sends `coding-agent:subscribe`, the session manager:

1. Adds the WS session ID to the session's subscriber set.
2. Replays the entire output buffer (last 100 KB) as a single `coding-agent:session:output` event.
3. Sends the current state via `coding-agent:session:state`.

When a WS connection disconnects, `removeSubscriber()` cleans up all subscription entries.

---

## Database Tables

### `coding_agent_results`

Persists outcomes from coding agent task executions.

| Column        | Type      | Default     | Description                              |
| ------------- | --------- | ----------- | ---------------------------------------- |
| `id`          | TEXT (PK) | --          | Unique result ID                         |
| `user_id`     | TEXT      | `'default'` | Owner user ID                            |
| `session_id`  | TEXT      | NULL        | Associated session ID (if session-based) |
| `provider`    | TEXT      | --          | Provider identifier                      |
| `prompt`      | TEXT      | --          | Original task prompt                     |
| `cwd`         | TEXT      | NULL        | Working directory                        |
| `model`       | TEXT      | NULL        | Model used                               |
| `success`     | BOOLEAN   | FALSE       | Whether the task completed successfully  |
| `output`      | TEXT      | `''`        | Final output (ANSI stripped)             |
| `exit_code`   | INTEGER   | NULL        | Process exit code                        |
| `error`       | TEXT      | NULL        | Error message if failed                  |
| `duration_ms` | INTEGER   | 0           | Execution duration                       |
| `cost_usd`    | REAL      | NULL        | Cost in USD (if reported)                |
| `mode`        | TEXT      | NULL        | Execution mode (`auto`, `sdk`, `pty`)    |
| `created_at`  | TIMESTAMP | NOW()       | When the result was created              |

**Indexes:** `user_id`, `session_id`, `created_at DESC`

### `cli_providers`

User-registered CLI tools that serve as custom coding agent providers.

| Column                | Type      | Default     | Description                                     |
| --------------------- | --------- | ----------- | ----------------------------------------------- |
| `id`                  | TEXT (PK) | --          | Unique provider ID                              |
| `user_id`             | TEXT      | `'default'` | Owner user ID                                   |
| `name`                | TEXT      | --          | Unique name (lowercase, alphanumeric + hyphens) |
| `display_name`        | TEXT      | --          | Human-readable display name                     |
| `description`         | TEXT      | NULL        | Short description                               |
| `binary_path`         | TEXT      | --          | CLI binary name/path                            |
| `category`            | TEXT      | `'general'` | Category                                        |
| `icon`                | TEXT      | NULL        | Icon identifier                                 |
| `color`               | TEXT      | NULL        | Color for UI                                    |
| `auth_method`         | TEXT      | `'none'`    | `none`, `config_center`, or `env_var`           |
| `config_service_name` | TEXT      | NULL        | Config Center service name                      |
| `api_key_env_var`     | TEXT      | NULL        | Environment variable for API key                |
| `default_args`        | JSONB     | `'[]'`      | Default CLI arguments                           |
| `prompt_template`     | TEXT      | NULL        | Template with `{prompt}`, `{cwd}`, `{model}`    |
| `output_format`       | TEXT      | `'text'`    | `text`, `json`, or `stream-json`                |
| `default_timeout_ms`  | INTEGER   | 300,000     | Default timeout                                 |
| `max_timeout_ms`      | INTEGER   | 1,800,000   | Maximum timeout                                 |
| `is_active`           | BOOLEAN   | TRUE        | Whether the provider is active                  |
| `created_at`          | TIMESTAMP | NOW()       | Created timestamp                               |
| `updated_at`          | TIMESTAMP | NOW()       | Last updated timestamp                          |

**Constraints:** `UNIQUE(user_id, name)`

**Indexes:** `user_id`, `is_active`, `(user_id, name)`

---

## UI Pages and Components

### CodingAgentsPage (`/coding-agents`)

The main coding agents page with a split panel layout:

- **Left sidebar** -- Session list (with state badges), collapsible result history, and collapsible provider status cards.
- **Right panel** -- Active session terminal. Auto mode sessions render `AutoModePanel`; interactive mode sessions render `XTerminal`.
- **New Session Modal** -- Provider selection grid, workspace or custom path picker for working directory, prompt textarea, and auto/interactive mode toggle.
- Maximum 3 concurrent sessions enforced in UI (button disabled at limit).

### CodingAgentSettingsPage (`/settings/coding-agents`)

Provider configuration page showing:

- Install status and version for each provider.
- PTY availability indicator.
- Auth information (subscription vs API key).
- Install command for providers that are not installed.
- "Test" button for connectivity verification.
- Info banner explaining that no API key is required (subscription-based login works).

### XTerminal Component

Full xterm.js terminal renderer with:

- **Direct keyboard capture** on the wrapper div (`onKeyDown`) -- bypasses xterm.js's hidden-textarea focus mechanism.
- Key-to-ANSI mapping: Ctrl+C (`\x03`), Ctrl+D (`\x04`), arrow keys, backspace, tab, function keys.
- REST-based input sending (`POST /sessions/:id/input`) -- more reliable than WebSocket for input.
- WebSocket output subscription with REST fallback polling (if no WS output within 3 seconds).
- Interactive mode: full input bar with text field, arrow up/down buttons, Enter, Ctrl+C, and "y+Enter" quick buttons.
- Auto mode: minimal status bar with a Ctrl+C stop button.
- Dark theme, JetBrains Mono font, 10,000 line scrollback.

### MiniTerminal Component

Floating terminal widget (fixed bottom-right, above MiniChat):

- Auto-opens when a `coding-agent:session:created` WebSocket event arrives.
- Resizable via drag handle (stored in localStorage).
- Maximize/restore toggle.
- Session tabs when multiple sessions are active.
- Routes to full `/coding-agents` page via expand button.
- Hidden on `/coding-agents` route and on mobile viewports.
- Renders `AutoModePanel` for auto mode sessions, `XTerminal` for interactive mode.
- Completed sessions are automatically removed after 60 seconds.

### AutoModePanel Component

Structured output view for auto mode sessions (replaces raw terminal):

- Parses Claude Code `stream-json` events into structured entries: tool calls (with file/command summaries), assistant text, errors, and status messages.
- Falls back to raw text display for Codex and Gemini CLI.
- Shows elapsed time counter, cost (for Claude Code), exit code, provider badge.
- Current activity line shows the active tool call.
- Copy button extracts text entries (or raw buffer for non-Claude providers).
- Collapsible prompt display for long prompts.
- REST fallback polling when WebSocket is unavailable.

---

## Key Source Files

| File                                                           | Description                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/core/src/services/coding-agent-service.ts`           | Core interface: types, session states, `ICodingAgentService`                  |
| `packages/gateway/src/services/coding-agent-service.ts`        | Main service: provider adapters, session creation, API key resolution         |
| `packages/gateway/src/services/coding-agent-sessions.ts`       | Session manager: spawn, stream, cleanup, WS subscriber management             |
| `packages/gateway/src/services/coding-agent-pty.ts`            | PTY adapter: `runWithPty()`, `spawnStreamingPty()`, `spawnStreamingProcess()` |
| `packages/gateway/src/services/binary-utils.ts`                | Binary detection, environment sanitization, process spawning                  |
| `packages/gateway/src/routes/coding-agents.ts`                 | REST API: sessions CRUD, run, test, results                                   |
| `packages/gateway/src/routes/cli-providers.ts`                 | REST API: custom provider CRUD + test                                         |
| `packages/gateway/src/tools/coding-agent-tools.ts`             | AI tool definitions: `run_coding_task`, `list_coding_agents`, etc.            |
| `packages/gateway/src/db/repositories/coding-agent-results.ts` | Results repository: save, getById, getBySessionId, list, count                |
| `packages/gateway/src/db/repositories/cli-providers.ts`        | CLI providers repository: CRUD, list, listActive                              |
| `packages/gateway/src/ws/types.ts`                             | WebSocket event type definitions (coding-agent:\* events)                     |
| `packages/ui/src/pages/CodingAgentsPage.tsx`                   | Sessions page: split panel, session list, new session modal                   |
| `packages/ui/src/pages/CodingAgentSettingsPage.tsx`            | Settings page: provider status, install info, test                            |
| `packages/ui/src/components/XTerminal.tsx`                     | xterm.js terminal with keyboard capture and REST/WS output                    |
| `packages/ui/src/components/MiniTerminal.tsx`                  | Floating terminal widget with resize and session tabs                         |
| `packages/ui/src/components/AutoModePanel.tsx`                 | Structured auto mode output: stream-json parser, tool call display            |
| `packages/ui/src/api/endpoints/coding-agents.ts`               | Frontend API client: types and endpoint wrappers                              |
