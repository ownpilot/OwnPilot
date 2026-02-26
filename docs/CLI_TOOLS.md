# CLI Tools System

OwnPilot provides a managed CLI tools system that lets the AI assistant discover, execute, and install command-line tools (linters, formatters, build tools, test runners, etc.) in a controlled, policy-governed manner. Unlike the coding agent system (long-running PTY sessions), CLI tools are short-lived fire-and-forget executions with bounded output capture.

This document covers the full architecture, catalog, discovery, policy system, risk scoring, API surface, security model, and UI management.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Overview](#architecture-overview)
3. [CLI Tools Catalog](#cli-tools-catalog)
4. [Discovery System](#discovery-system)
5. [Policy System](#policy-system)
6. [Approval Integration](#approval-integration)
7. [Dynamic Risk Scoring](#dynamic-risk-scoring)
8. [Custom Tool Registration](#custom-tool-registration)
9. [AI Tool Definitions](#ai-tool-definitions)
10. [REST API Reference](#rest-api-reference)
11. [Security Model](#security-model)
12. [Database Tables](#database-tables)
13. [UI](#ui)
14. [Key Source Files](#key-source-files)

---

## Overview

The CLI tools system bridges three concerns:

1. **Discovery** -- Scanning PATH for known binaries, detecting versions, checking npx availability.
2. **Policy enforcement** -- Per-user, per-tool policies (`allowed` / `prompt` / `blocked`) that control whether the AI can auto-execute, must ask for approval, or is completely blocked from using a tool.
3. **Safe execution** -- Binary allowlist, environment sanitization, args-array spawning (no shell injection), output size limits, and timeout enforcement.

The system is exposed to the AI agent via three tool definitions (`run_cli_tool`, `list_cli_tools`, `install_cli_tool`), to users via a REST API (`/cli-tools`), and to the UI via the CLI Tools Settings page.

---

## Architecture Overview

```
                           +------------------+
                           |  CLI Tools       |
                           |  Catalog         |
                           |  (26 built-in)   |
                           +--------+---------+
                                    |
                                    v
+-------------+          +-------------------+         +------------------+
| AI Agent    |          |  Discovery        |         | cli_providers    |
| Tool Call:  +--------->|  Service          |<--------+ (custom tools    |
| run_cli_tool|          |  (PATH scan,      |         |  from DB)        |
| list_cli_   |          |   cache 5-min)    |         +------------------+
| install_cli |          +--------+----------+
+-------------+                   |
                                  v
                         +-------------------+
                         |  CliToolService    |
                         |  (resolve, check  |
                         |   policy, execute) |
                         +--------+----------+
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
          +-----------------+         +-------------------+
          | Policy System   |         | Binary Utils      |
          | (cli_tool_      |         | (sanitized env,   |
          |  policies DB)   |         |  spawn, validate) |
          +-----------------+         +-------------------+
                    |
                    v
          +-----------------+
          | Orchestrator    |
          | (approval flow, |
          |  risk scoring)  |
          +-----------------+
```

### Request Flow

1. The AI calls `run_cli_tool(name, args, cwd)`.
2. The **orchestrator** intercepts the tool call, looks up the per-tool policy via `getCliToolPolicyForApproval()`, and either auto-approves, requires user approval, or blocks the call.
3. If approved, `CliToolService.executeTool()` is invoked:
   - Resolves the tool from the catalog or custom providers (binary allowlist).
   - Checks the per-user policy again (defense in depth).
   - Validates the working directory (absolute path, no traversal).
   - Checks if the binary is installed; falls back to `npx` if available.
   - Spawns the process with `spawnCliProcess()` (sanitized env, args array, timeout).
4. Output (stdout/stderr) is captured up to 1 MB, truncated if necessary, and returned.

---

## CLI Tools Catalog

The catalog is a hardcoded allowlist of well-known CLI tools. Only tools from this catalog or user-registered custom providers can be executed. Each entry defines the binary name, risk level, default policy, install methods, and metadata.

### Linters

| Name | Display Name | Binary | Risk | Default Policy | npx Package | Tags |
|------|-------------|--------|------|---------------|-------------|------|
| `eslint` | ESLint | `eslint` | low | allowed | `eslint` | javascript, typescript, lint, code-quality |
| `biome` | Biome | `biome` | low | allowed | `@biomejs/biome` | formatter, linter, javascript, typescript |
| `stylelint` | Stylelint | `stylelint` | low | allowed | `stylelint` | css, scss, lint, style |
| `markdownlint` | markdownlint | `markdownlint` | low | allowed | `markdownlint-cli` | markdown, lint, docs |

### Formatters

| Name | Display Name | Binary | Risk | Default Policy | npx Package | Tags |
|------|-------------|--------|------|---------------|-------------|------|
| `prettier` | Prettier | `prettier` | medium | prompt | `prettier` | format, style, javascript, typescript, css, html |

### Build Tools

| Name | Display Name | Binary | Risk | Default Policy | npx Package | Tags |
|------|-------------|--------|------|---------------|-------------|------|
| `tsc` | TypeScript Compiler | `tsc` | low | allowed | `typescript` | typescript, compiler, typecheck |
| `vite` | Vite | `vite` | medium | prompt | `vite` | build, frontend, bundler |
| `turbo` | Turborepo | `turbo` | medium | prompt | `turbo` | build, monorepo, ci |
| `esbuild` | esbuild | `esbuild` | low | allowed | `esbuild` | build, bundler, javascript, typescript |
| `webpack` | webpack | `webpack` | medium | prompt | `webpack-cli` | build, bundler, javascript |

### Test Runners

| Name | Display Name | Binary | Risk | Default Policy | npx Package | Install |
|------|-------------|--------|------|---------------|-------------|---------|
| `vitest` | Vitest | `vitest` | medium | prompt | `vitest` | npm, pnpm, npx |
| `jest` | Jest | `jest` | medium | prompt | `jest` | npm, pnpm, npx |
| `pytest` | pytest | `pytest` | medium | prompt | -- | system |

### Package Managers

| Name | Display Name | Binary | Risk | Default Policy | Install |
|------|-------------|--------|------|---------------|---------|
| `npm` | npm | `npm` | medium | prompt | system |
| `pnpm` | pnpm | `pnpm` | medium | prompt | npm-global, system |
| `yarn` | Yarn | `yarn` | medium | prompt | npm-global, system |
| `bun` | Bun | `bun` | medium | prompt | system |

### Containers

| Name | Display Name | Binary | Risk | Default Policy | Install |
|------|-------------|--------|------|---------------|---------|
| `docker` | Docker | `docker` | high | blocked | system, manual |
| `docker-compose` | Docker Compose | `docker-compose` | high | blocked | system, manual |

### Version Control

| Name | Display Name | Binary | Risk | Default Policy | Install |
|------|-------------|--------|------|---------------|---------|
| `git` | Git | `git` | medium | prompt | system |
| `gh` | GitHub CLI | `gh` | medium | prompt | system, manual |

### Utilities

| Name | Display Name | Binary | Risk | Default Policy | Install |
|------|-------------|--------|------|---------------|---------|
| `node` | Node.js | `node` | high | blocked | system |
| `python` | Python | `python` | high | blocked | system |
| `jq` | jq | `jq` | low | allowed | system, manual |
| `curl` | curl | `curl` | medium | prompt | system |
| `ripgrep` | ripgrep | `rg` | low | allowed | system, manual |

### Risk Level Summary

| Risk Level | Meaning | Default Policy | Examples |
|-----------|---------|---------------|----------|
| `low` | Read-only or safe output | `allowed` | eslint, tsc, jq, ripgrep |
| `medium` | Can modify files or access network | `prompt` | prettier, npm, git, vitest |
| `high` | System-level access, containers, runtimes | `blocked` | docker, node, python |
| `critical` | Reserved for destructive or irreversible tools | `blocked` | (none in current catalog) |

---

## Discovery System

The discovery service scans for installed CLI tools by probing each binary on the system PATH. Results are cached per-user with a 5-minute TTL to avoid repeated expensive binary lookups.

### How It Works

1. **Iterate the catalog** -- For each entry in `CLI_TOOLS_CATALOG`, call `isBinaryInstalled(binaryName)`.
2. **Binary detection** -- Uses `where` (Windows) or `which` (Unix) via `execFileSync` with a 5-second timeout. Safe, no shell injection.
3. **Version detection** -- If installed, runs `binary --version` (or a custom `versionFlag`) and captures the first line of output.
4. **npx fallback** -- If the binary is not installed but `npxPackage` is defined and `npx` is available, marks the tool as `npxAvailable: true`.
5. **Custom providers** -- Queries the `cli_providers` table for user-registered tools and adds them (prefixed with `custom:`).
6. **Policy overlay** -- For each tool, looks up the user's per-tool policy from `cli_tool_policies`. Falls back to catalog default if no custom policy exists.

### Caching

```typescript
const CACHE_TTL_MS = 300_000; // 5 minutes

// Per-user cache
const discoveryCache = new Map<string, CachedDiscovery>();
```

- Cache key: `userId`
- Cache is invalidated:
  - After a tool is installed via `installTool()` (clears the user's cache entry).
  - After a custom provider is added or removed.
  - When `POST /cli-tools/refresh` is called (clears all entries).
  - When `refreshDiscovery()` is called on the service.

### CliToolStatus Shape

```typescript
interface CliToolStatus {
  name: string;          // 'eslint' or 'custom:my-tool'
  displayName: string;   // 'ESLint'
  category: CliToolCategory;
  riskLevel: CliToolRiskLevel;
  installed: boolean;    // true if binary found on PATH
  version?: string;      // e.g., 'v9.21.0'
  npxAvailable: boolean; // true if not installed but npx can run it
  policy: CliToolPolicy; // 'allowed' | 'prompt' | 'blocked'
  source: 'catalog' | 'custom';
}
```

---

## Policy System

Every CLI tool has a per-user execution policy that controls how the AI interacts with it:

| Policy | Behavior |
|--------|----------|
| `allowed` | AI can run automatically without user approval |
| `prompt` | AI must request user approval before each execution |
| `blocked` | AI cannot run the tool at all |

### Policy Resolution

1. Check the `cli_tool_policies` table for a user-specific override.
2. If no override exists, use the catalog entry's `defaultPolicy`.
3. If the tool is not in the catalog (custom tool), default to `prompt`.

### Default Policies by Risk Level

When registering a custom tool, the default policy is derived from the risk level:

| Risk Level | Auto-Assigned Default Policy |
|-----------|------------------------------|
| `low` | `allowed` |
| `medium` | `prompt` |
| `high` | `blocked` |
| `critical` | `blocked` |

### Batch Policy Updates

Policies can be updated in bulk by risk level or by tool name list:

```json
POST /cli-tools/policies/batch
{
  "policy": "allowed",
  "riskLevel": "low"
}
```

Or by explicit tool list:

```json
POST /cli-tools/policies/batch
{
  "policy": "blocked",
  "tools": ["docker", "docker-compose", "node"]
}
```

---

## Approval Integration

The orchestrator (`orchestrator.ts`) integrates CLI tool policies into the autonomy approval flow. When the AI calls `run_cli_tool` or `install_cli_tool`, the orchestrator applies the per-tool policy **before** the generic risk-based approval logic.

### Decision Flow

```
Tool call: run_cli_tool(name="eslint", ...)
       |
       v
  Parse tool arguments -> extract CLI tool name
       |
       v
  getCliToolPolicyForApproval(cliToolName, userId)
       |
       +--> 'blocked'  --> REJECT (with message: update in Settings)
       |
       +--> 'allowed'  --> AUTO-APPROVE (except install_cli_tool)
       |
       +--> 'prompt'   --> REQUIRE APPROVAL (regardless of autonomy level)
       |
       v
  (Fall through to generic risk-based approval)
```

### Key Rules

- **`blocked`** -- The tool call is immediately rejected. The user must change the policy in Settings before the AI can use it.
- **`allowed` + `run_cli_tool`** -- Auto-approved, bypassing the generic autonomy level check.
- **`allowed` + `install_cli_tool`** -- Still requires approval. Installing tools always needs user confirmation regardless of policy.
- **`prompt`** -- Always requires approval, regardless of the global autonomy level (even `FULL` autonomy).
- **Fallback** -- If the CLI tool service is not ready (startup race), the policy defaults to `prompt` (safe default).

### Implementation

```typescript
async function getCliToolPolicyForApproval(
  cliToolName: string,
  userId: string
): Promise<CliToolPolicy> {
  try {
    return await getCliToolService().getToolPolicy(cliToolName, userId);
  } catch {
    return 'prompt'; // Safe default if service not ready
  }
}
```

---

## Dynamic Risk Scoring

The risk assessment system (`risk.ts`) dynamically adjusts risk factors for CLI tool invocations based on the catalog's risk level for each tool.

### Static Risk Factors

By default, `run_cli_tool` is mapped to the `system_command` risk factor (weight: 0.95), and `install_cli_tool` is mapped to `system_command` + `irreversible` + `code_execution`.

### Dynamic Override for run_cli_tool

When `run_cli_tool` is called with a specific tool name, the risk engine looks up the catalog entry and overrides the static factors:

| Catalog Risk Level | Risk Factors Applied | Effect |
|-------------------|---------------------|--------|
| `low` | (none) | Minimal risk score -- safe tools like eslint, jq |
| `medium` | `code_execution` (weight: 0.9) | Moderate risk -- npm, tsc, vitest |
| `high` | `system_command` (weight: 0.95) | High risk -- docker, node, python |
| `critical` | `system_command` + `irreversible` | Maximum risk |

### Risk Score Calculation

```
risk_score = (base_risk_for_category + factor_score) / 2
```

Where:
- `base_risk_for_category`: For `tool_execution` = 20, for `system_command` = 80.
- `factor_score`: Percentage of present risk factors weighted by their importance.

Risk levels derived from score:
- `low`: score < 25
- `medium`: score 25-49
- `high`: score 50-74
- `critical`: score >= 75

### Compound Risk Detection

When 3 or more high-severity factors (weight >= 0.7) are present simultaneously, the risk score is floored at 75 (critical).

---

## Custom Tool Registration

Users can register custom CLI tools beyond the built-in catalog. Custom tools are stored in the `cli_providers` table and namespaced with the `custom:` prefix.

### Register a Custom Tool

```
POST /cli-tools/custom
```

**Request body:**

```json
{
  "name": "my-linter",
  "displayName": "My Custom Linter",
  "binaryName": "my-linter",
  "description": "A custom linting tool",
  "category": "linter",
  "riskLevel": "low"
}
```

**Validation rules:**
- `name` must be lowercase alphanumeric with hyphens/underscores (`^[a-z0-9_-]+$`).
- `name` must not collide with a catalog tool name.
- `displayName` and `binaryName` are required.
- `category` must be one of: `linter`, `formatter`, `build`, `test`, `package-manager`, `container`, `version-control`, `coding-agent`, `utility`, `security`, `database`.
- `riskLevel` must be one of: `low`, `medium`, `high`, `critical`.

**Response (201):**

```json
{
  "data": {
    "name": "custom:my-linter",
    "displayName": "My Custom Linter",
    "binaryName": "my-linter",
    "category": "linter",
    "riskLevel": "low",
    "policy": "allowed",
    "providerId": "uuid"
  }
}
```

### Remove a Custom Tool

```
DELETE /cli-tools/custom/:name
```

Where `:name` is the base name (without the `custom:` prefix). Removes the provider record and its policy entry, and clears the discovery cache.

**Response (200):**

```json
{
  "data": {
    "deleted": true,
    "name": "custom:my-linter"
  }
}
```

---

## AI Tool Definitions

The CLI tools system exposes three tools to the AI agent. These are registered in the tool provider and available in any conversation.

### run_cli_tool

Run an installed CLI tool and return its output.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Tool name from catalog (e.g., `eslint`) or custom provider (`custom:my-tool`) |
| `args` | string[] | yes | Command-line arguments array |
| `cwd` | string | yes | Working directory (absolute path) |
| `timeout_seconds` | number | no | Timeout in seconds (default: 60, max: 300) |

**Behavior:**
- Checks the binary allowlist (catalog + custom providers).
- Checks per-tool policy (`blocked` = rejected, `prompt` = requires approval).
- If binary is not installed but npx is available, auto-invokes via `npx --yes <package>`.
- Returns stdout (truncated to 8,000 chars for LLM context), stderr (truncated to 2,000 chars), exit code, and duration.

**Examples:**
```
run_cli_tool(name="eslint", args=["--format", "json", "src/"], cwd="/project")
run_cli_tool(name="prettier", args=["--check", "**/*.ts"], cwd="/project")
run_cli_tool(name="git", args=["status"], cwd="/project")
run_cli_tool(name="tsc", args=["--noEmit"], cwd="/project")
```

### list_cli_tools

List all available CLI tools with their status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | | | |

Returns an array of `CliToolStatus` objects including name, category, risk level, installed status, version, npx availability, policy, and source.

### install_cli_tool

Install a missing CLI tool globally via npm or pnpm.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Tool name from the catalog |
| `method` | string | yes | `npm-global` or `pnpm-global` |

**Behavior:**
- Only catalog tools can be installed (not custom providers).
- Always requires user approval regardless of policy.
- Runs `npm install -g <package>` or `pnpm add -g <package>`.
- Clears discovery cache after installation.
- Not usable in workflows (`workflowUsable: false`).

---

## REST API Reference

All endpoints are under `/cli-tools`. Responses use the standard `apiResponse` / `apiError` helpers.

### GET /cli-tools

List all CLI tools with discovery status, policy, and metadata.

**Response:**
```json
{
  "data": [
    {
      "name": "eslint",
      "displayName": "ESLint",
      "category": "linter",
      "riskLevel": "low",
      "installed": true,
      "version": "v9.21.0",
      "npxAvailable": false,
      "policy": "allowed",
      "source": "catalog"
    }
  ]
}
```

### GET /cli-tools/policies

Get all per-tool policies for the current user.

**Response:**
```json
{
  "data": [
    {
      "name": "eslint",
      "displayName": "ESLint",
      "category": "linter",
      "riskLevel": "low",
      "policy": "allowed",
      "source": "catalog"
    }
  ]
}
```

### PUT /cli-tools/policies/:toolName

Update a single tool's policy.

**Request body:**
```json
{ "policy": "allowed" }
```

Valid values: `allowed`, `prompt`, `blocked`.

**Response:**
```json
{
  "data": { "toolName": "eslint", "policy": "allowed" }
}
```

### POST /cli-tools/policies/batch

Batch update policies by risk level or explicit tool list.

**Request body (by risk level):**
```json
{
  "policy": "blocked",
  "riskLevel": "high"
}
```

**Request body (by tool list):**
```json
{
  "policy": "allowed",
  "tools": ["eslint", "biome", "jq"]
}
```

**Response:**
```json
{
  "data": { "updated": 3, "policy": "allowed" }
}
```

### POST /cli-tools/:name/install

Install a catalog tool globally.

**Request body:**
```json
{ "method": "npm-global" }
```

Valid methods: `npm-global`, `pnpm-global`.

**Response (success):**
```json
{
  "data": {
    "success": true,
    "toolName": "prettier",
    "stdout": "added 1 package...",
    "stderr": "",
    "exitCode": 0,
    "durationMs": 4521,
    "truncated": false
  }
}
```

### POST /cli-tools/refresh

Clear the discovery cache and force a re-scan on next request.

**Response:**
```json
{
  "data": { "refreshed": true }
}
```

### POST /cli-tools/custom

Register a custom CLI tool. See [Custom Tool Registration](#custom-tool-registration) for full details.

### DELETE /cli-tools/custom/:name

Remove a custom CLI tool by its base name (without the `custom:` prefix).

---

## Security Model

The CLI tools system implements defense-in-depth security across multiple layers.

### 1. Binary Allowlist

Only tools from the catalog (`CLI_TOOLS_BY_NAME`) or user-registered custom providers (`cli_providers` table) can run. Any tool name not in either list is rejected with an error.

Custom tools are additionally namespaced with `custom:` to prevent ambiguity with catalog tools.

### 2. Environment Sanitization

Before spawning any child process, `createSanitizedEnv()` strips sensitive variables:

```typescript
const sensitivePatterns = [
  /^OWNPILOT_/i,     // All OwnPilot internal vars
  /^DATABASE_/i,      // Database connection strings
  /^ADMIN_KEY$/i,     // Admin authentication key
  /^JWT_SECRET$/i,    // JWT signing secret
  /^SESSION_SECRET$/i // Session secret
];
```

Additionally, nesting-detection variables are removed to prevent child CLIs from refusing to start:

```typescript
delete env.CLAUDECODE;
delete env.CLAUDE_CODE;
```

### 3. Args Array Spawning (No Shell Injection)

All process spawning uses `spawn(command, argsArray, ...)` with explicit argument arrays -- never shell strings. This eliminates shell injection vulnerabilities entirely.

```typescript
const proc = spawn(command, args, {
  cwd: options.cwd,
  env: options.env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
```

### 4. Working Directory Validation

The `validateCwd()` function ensures:
- Path is absolute (rejects relative paths).
- No path traversal (`..` components are rejected).

### 5. Output Size Limits

Both stdout and stderr are capped at 1 MB (`MAX_OUTPUT_SIZE = 1_048_576`). If output exceeds the limit, it is truncated and the `truncated` flag is set to `true` on the result.

For LLM context, output is further truncated: stdout to 8,000 characters and stderr to 2,000 characters (keeping the first and last half with a truncation marker in the middle).

### 6. Timeout Enforcement

- Default timeout: 60 seconds (`DEFAULT_TIMEOUT_MS`).
- Maximum timeout: 300 seconds / 5 minutes (`MAX_TIMEOUT_MS`).
- For installations, the maximum timeout (5 minutes) is used.
- On timeout: `SIGTERM` is sent, followed by `SIGKILL` after a 5-second grace period.

### 7. Per-Tool Policy Enforcement

Policies are checked at two points:
1. **Orchestrator level** -- Before the tool call reaches the service (approval flow).
2. **Service level** -- Inside `executeTool()` as defense-in-depth.

---

## Database Tables

### cli_providers

Stores user-registered custom CLI tools.

```sql
CREATE TABLE IF NOT EXISTS cli_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  binary_path TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  icon TEXT,
  color TEXT,
  auth_method TEXT NOT NULL DEFAULT 'none'
    CHECK(auth_method IN ('none', 'config_center', 'env_var')),
  config_service_name TEXT,
  api_key_env_var TEXT,
  default_args JSONB NOT NULL DEFAULT '[]',
  prompt_template TEXT,
  output_format TEXT DEFAULT 'text'
    CHECK(output_format IN ('text', 'json', 'stream-json')),
  default_timeout_ms INTEGER NOT NULL DEFAULT 300000,
  max_timeout_ms INTEGER NOT NULL DEFAULT 1800000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);
```

**Indexes:**
- `idx_cli_providers_user` on `user_id`
- `idx_cli_providers_active` on `is_active`
- `idx_cli_providers_user_name` on `(user_id, name)`

### cli_tool_policies

Stores per-user, per-tool policies.

```sql
CREATE TABLE IF NOT EXISTS cli_tool_policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  tool_name TEXT NOT NULL,
  policy TEXT NOT NULL DEFAULT 'prompt'
    CHECK(policy IN ('allowed', 'prompt', 'blocked')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tool_name)
);
```

**Indexes:**
- `idx_cli_tool_policies_user` on `user_id`
- `idx_cli_tool_policies_user_tool` on `(user_id, tool_name)`

Policy updates use `ON CONFLICT ... DO UPDATE` (UPSERT) to insert or overwrite in a single statement.

---

## UI

The CLI Tools Settings page (`/settings/cli-tools`) provides a visual management interface with the following features:

### Stats Dashboard

Displays three stat cards: Total Tools, Installed, and npx Available.

### Quick Actions

Batch policy buttons for common operations:
- **Allow All Low-Risk** -- Sets all `low` risk tools to `allowed`.
- **Block All High-Risk** -- Sets all `high` risk tools to `blocked`.
- **Block All Critical** -- Sets all `critical` risk tools to `blocked`.

### Policy Legend

Visual indicator of what each policy means:
- Green dot: `Allowed` -- AI runs automatically.
- Yellow dot: `Prompt` -- AI asks for approval.
- Red dot: `Blocked` -- AI cannot use this.

### Search and Filters

- Text search across tool name, display name, and category.
- Category dropdown filter (Linters, Formatters, Build Tools, Test Runners, etc.).

### Tool Table (grouped by category)

Each row displays:
- Tool name and display name (with `custom` badge for custom tools).
- Installation status: Installed (green), npx (blue), Missing (gray).
- Version string (if installed).
- Risk level badge (color-coded: green, yellow, red, dark red).
- Policy dropdown selector (allowed / prompt / blocked).
- AI behavior indicator (Auto-runs / Needs approval / Blocked).
- Action buttons: Install (for npx-available tools), Delete (for custom tools).

### Register Custom Tool Modal

A modal form with fields for:
- Tool ID (slug) -- auto-lowercased, restricted to `[a-z0-9_-]`.
- Display Name.
- Binary Name (must be in PATH).
- Description (optional).
- Category dropdown.
- Risk Level dropdown.

---

## Key Source Files

| File | Package | Description |
|------|---------|-------------|
| `packages/core/src/services/cli-tool-service.ts` | core | Type definitions and `ICliToolService` interface |
| `packages/gateway/src/services/cli-tool-service.ts` | gateway | Service implementation (resolve, policy, install) |
| `packages/gateway/src/services/cli-tools-catalog.ts` | gateway | Hardcoded catalog of 26 known CLI tools |
| `packages/gateway/src/services/cli-tools-discovery.ts` | gateway | PATH scanning, version detection, caching (5-min TTL) |
| `packages/gateway/src/services/binary-utils.ts` | gateway | Binary detection, env sanitization, safe process spawning |
| `packages/gateway/src/routes/cli-tools.ts` | gateway | REST API endpoints (`/cli-tools`) |
| `packages/gateway/src/tools/cli-tool-tools.ts` | gateway | AI tool definitions (run/list/install) and executor |
| `packages/gateway/src/autonomy/risk.ts` | gateway | Dynamic risk scoring with catalog-aware factor override |
| `packages/gateway/src/assistant/orchestrator.ts` | gateway | Approval integration, `getCliToolPolicyForApproval()` |
| `packages/gateway/src/db/repositories/cli-tool-policies.ts` | gateway | Per-tool policy DB repository (CRUD, batch) |
| `packages/gateway/src/db/repositories/cli-providers.ts` | gateway | Custom CLI provider DB repository (CRUD) |
| `packages/gateway/src/db/schema.ts` | gateway | Table definitions for `cli_providers` and `cli_tool_policies` |
| `packages/ui/src/pages/CliToolsSettingsPage.tsx` | ui | Settings page UI component |
| `packages/ui/src/api/endpoints/cli-tools.ts` | ui | API client types and methods |
