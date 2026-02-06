# OwnPilot Custom Tools System - Complete Architecture Analysis

## Executive Summary

OwnPilot's custom tools system is a multi-layered architecture allowing users and LLMs to create, register, execute, and manage reusable tools. The system uses:
- **Node.js VM sandbox** for code isolation
- **Permission-based access control** with dangerous pattern detection
- **Status workflow** (active/disabled/pending_approval/rejected)
- **Approval process** for LLM-created tools with dangerous permissions
- **Integration** with built-in tool ecosystem and Config Center

---

## 1. ROUTE LAYER - packages/gateway/src/routes/custom-tools.ts

### Endpoints & Validation

**GET /custom-tools/stats** - Tool statistics
- Returns: total, active, disabled, pendingApproval, createdByLLM, createdByUser, totalUsage

**GET /custom-tools** - List tools with filtering
- Filters: status, category, createdBy
- Pagination: limit, offset
- Returns: tools[], count

**GET /custom-tools/pending** - Pending approval tools
- Returns: tools pending user approval

**GET /custom-tools/:id** - Get specific tool
- Returns: full tool record

**POST /custom-tools** - Create new tool
- Validation: Code inspection for dangerous patterns
- Patterns blocked:
  - `process.exit`, `require(`, `import(`, `__dirname`, `__filename`
  - `global.`, `globalThis.`, `Function()`, `new Function()`, `eval()`
- Auto-status logic:
  - LLM-created tools with dangerous permissions (shell, filesystem, email) → pending_approval
  - User tools & LLM tools without dangerous permissions → active
- Config registration: requiredApiKeys auto-register in Config Center

**PATCH /custom-tools/:id** - Update tool
- Same dangerous pattern validation
- Re-syncs to registries on update
- Version increments on code/parameter changes

**DELETE /custom-tools/:id** - Delete tool
- Unregisters from both registries
- Unregisters API dependencies

**POST /custom-tools/:id/enable** - Enable tool
- Syncs to registries

**POST /custom-tools/:id/disable** - Disable tool
- Removes from registries

**POST /custom-tools/:id/approve** - Approve pending tool
- Transitions pending_approval → active
- Syncs to registries

**POST /custom-tools/:id/reject** - Reject pending tool
- Transitions pending_approval → rejected
- Does NOT delete the tool

**POST /custom-tools/:id/execute** - Execute tool directly
- Requires tool to be active
- Records usage
- Returns: result, isError, duration, metadata

**POST /custom-tools/test** - Test tool without saving (dry run)
- Creates temporary registry for testing
- Validates dangerous patterns
- Returns: result, isError, duration, metadata, testMode: true

**GET /custom-tools/active/definitions** - LLM tool definitions
- Returns tools in format suitable for LLM context
- Fields: name, description, parameters, category, requiresConfirmation

### Security Implementation

```typescript
const dangerousPatterns = [
  /process\.exit/i,
  /require\s*\(/i,
  /import\s*\(/i,
  /__dirname/i,
  /__filename/i,
  /global\./i,
  /globalThis\./i,
  /\bFunction\s*\(/i,      // Function constructor
  /\bnew\s+Function\b/i,   // new Function(...)
  /\beval\s*\(/i,           // eval()
];
```

**Issues with Pattern Detection:**
- Regex-based blocklist is brittle; can be bypassed
- No static code analysis to detect obfuscation
- No sandboxing enforcement at route level (only at VM level)
- Cannot detect IIFE abuse, Proxy access, property descriptor manipulation

### Registry Sync Strategy

Two-layer registration:
1. **Dynamic Registry** - for sandbox execution, handles permission mapping
2. **Shared Tool Registry** - for unified tool access from agents/triggers/plans

The route layer syncs to both registries whenever a tool is created/updated/enabled/disabled.

---

## 2. REPOSITORY LAYER - packages/gateway/src/db/repositories/custom-tools.ts

### Schema (SQLite/PostgreSQL)

```sql
CREATE TABLE custom_tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters JSONB NOT NULL,      -- JSON Schema for parameters
  code TEXT NOT NULL,              -- JavaScript code to execute
  category TEXT,
  status TEXT CHECK(...),           -- active, disabled, pending_approval, rejected
  permissions JSONB NOT NULL,       -- ["network", "filesystem", "shell", "email", "database", "scheduling"]
  requires_approval BOOLEAN,        -- Whether execution needs approval
  created_by TEXT,                  -- 'user' or 'llm'
  version INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  metadata JSONB,
  required_api_keys JSONB,          -- Array of {name, displayName, description, category, docsUrl}
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(user_id, name)
);
```

### CRUD Operations

- **create()** - Inserts tool with status logic (see Auto-status above)
- **get(id)** - Single tool by ID
- **getByName(name)** - Lookup by name (unique per user)
- **list(filters)** - With status, category, createdBy filters + pagination
- **getActiveTools()** - Only active tools (for LLM context)
- **update(id, partial)** - Partial updates with version increment
- **delete(id)** - Removes tool completely
- **enable(id)** / **disable(id)** / **approve(id)** / **reject(id)** - Status transitions

### Usage Tracking

- **recordUsage(id)** - Increments usage_count and updates last_used_at
- **getStats()** - Aggregated stats: total, active, disabled, pendingApproval, by creator, totalUsage

### Data Protection

- User isolation via userId in all queries
- Parameterized queries prevent SQL injection
- UNIQUE(user_id, name) prevents name collisions

---

## 3. CORE TYPES - packages/core/src/agent/tools/dynamic-tools.ts

### DynamicToolDefinition

```typescript
interface DynamicToolDefinition {
  name: string;                    // Unique tool name
  description: string;
  parameters: JSONSchema object;   // Input schema validation
  code: string;                    // JavaScript code
  category?: string;
  permissions?: DynamicToolPermission[];  // network, filesystem, database, shell, email, scheduling
  requiresApproval?: boolean;
  requiredApiKeys?: RequiredConfigService[];
}
```

### Permission Mapping

Maps to sandbox permissions:
- **network** → network: true
- **filesystem** → fsRead: true + fsWrite: true
- **shell** → spawn: true
- **database**, **email**, **scheduling** → handled via injected APIs, not raw permissions

---

## 4. SANDBOX EXECUTION - packages/core/src/sandbox/executor.ts

### Sandbox Features

**Resource Limits (defaults):**
- maxMemory: 128MB
- maxCpuTime: 5 seconds
- maxExecutionTime: 30 seconds
- maxNetworkRequests: 10
- maxFsOperations: 100

**Permissions (defaults - very restrictive):**
- network: false
- fsRead: false, fsWrite: false
- spawn: false (no child processes)
- env: false
- timers: true
- crypto: true

**VM Isolation:**
- Node.js vm module with disabled code generation
  ```typescript
  codeGeneration: {
    strings: false,   // Disable eval-like functions
    wasm: false,      // Disable WebAssembly
  }
  ```
- Timeout enforcement: maxCpuTime + maxExecutionTime race
- Async/await support via IIFE wrapper

**Globals Injected to Tool Code:**

Tool code receives:
- `args` - Input arguments
- `context` - Tool metadata (callId, conversationId, userId)
- `fetch` - if network permission granted
- `console` - Namespaced logging
- `utils` - Extensive helper object with:
  - Hashing: hash(text, algorithm)
  - UUID: uuid()
  - Encoding: base64Encode/Decode, urlEncode/Decode, hexEncode/Decode
  - Date/Time: now(), timestamp(), dateDiff(), dateAdd(), formatDate()
  - Text: slugify(), camelCase(), snakeCase(), kebabCase(), titleCase(), truncate(), countWords(), removeDiacritics()
  - Validation: isEmail(), isUrl(), isJson(), isUuid()
  - Math: clamp(), round(), randomInt(), sum(), avg()
  - Data: parseJson(), toJson(), parseCsv(), flatten(), getPath()
  - Array: unique(), chunk(), shuffle(), sample(), groupBy()
  - Password: generatePassword()
  - API Keys: getApiKey(serviceName), getServiceConfig(), getConfigEntry(), getConfigEntries(), getFieldValue()
  - Tool Invocation: callTool(name, args), listTools()
- `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set`
- Encoding functions: `encodeURIComponent`, `decodeURIComponent`, `encodeURI`, `decodeURI`, `parseInt`, `parseFloat`

**Code Validation (buildSandboxContext):**
- Checks for dangerous patterns before execution
- Blocks: dangerous imports, file access outside allowed paths, env access

---

## 5. EXECUTION FLOW - packages/gateway/src/services/tool-executor.ts

### Shared Tool Registry

Single centralized ToolRegistry with:
1. Core tools (file system, code exec, web fetch, etc.)
2. Gateway provider tools (memory, goals, custom data, etc.)
3. Plugin tools (weather, expense, etc.)
4. Custom tools (user/LLM-created, sandboxed)

### Custom Tool Integration

```
POST /custom-tools/:id/execute
  ↓
Route layer checks: tool exists & active
  ↓
getSharedToolRegistry() → ToolRegistry with custom tools synced
  ↓
registry.execute(toolName, args, context)
  ↓
Custom tool executor → dynamicRegistry.execute()
  ↓
createSandbox() → VM execution
  ↓
Tool code runs with injected globals, args, utils
  ↓
Result captured → {content, isError, metadata, executionTime}
```

### Sync Strategy

Custom tools sync fire-and-forget:
- `syncCustomToolsIntoRegistry()` runs async in getSharedToolRegistry()
- Fetches active tools from DB
- Registers each in DynamicToolRegistry
- Registers in shared ToolRegistry with executor delegation

---

## 6. UI LAYER - packages/ui/src/pages/CustomToolsPage.tsx

### Features

1. **List View**
   - Displays all custom tools with cards
   - Shows: name, status badge, description, version, usage count
   - Filters: status, search by name/description/category
   - Search debounced 300ms

2. **Stats Bar**
   - Active, Disabled, Pending counts
   - Total usage

3. **Tool Detail Modal**
   - **Details Tab:** metadata (creator, version, usage, last used), permissions, parameters
   - **Code Tab:** Read-only tool implementation
   - **Test Tab:** Execute tool with JSON arguments, see result

4. **Create Tool Modal**
   - Name validation: lowercase letters, numbers, underscores only
   - Parameters: JSON Schema editor (required)
   - Code: JavaScript editor with default template
   - Permissions: checkboxes for network, filesystem, database, shell, email, scheduling
   - RequiresApproval: checkbox
   - Category: optional

5. **Actions**
   - Enable/Disable (status transitions)
   - Approve/Reject (pending_approval state)
   - Delete
   - Test (execute directly)

### API Integration

```typescript
customToolsApi = {
  list(status?),
  stats(),
  create(tool),
  action(id, action),
  delete(id),
  execute(id, args),
}
```

---

## 7. LLM INTEGRATION - Meta-Tools

### LLM-Available Tools

```typescript
create_tool(name, description, parameters, code, category?, permissions?, required_api_keys?)
  // Creates tool, requires approval if dangerous permissions
  // Only LLM-created tools can be deleted by LLM

list_custom_tools(category?, status?)
  // List tools with stats

delete_custom_tool(name, confirm)
  // PROTECTION: Cannot delete user-created tools
  // Can only delete LLM-created tools with confirmation

toggle_custom_tool(name, enabled)
  // Enable/disable by name
```

### LLM Safety

- LLM cannot delete user-created tools (protected)
- LLM cannot delete tools without explicit confirmation
- Tools with dangerous permissions auto-pending
- All code validated for dangerous patterns

---

## SECURITY ANALYSIS

### What's Well-Implemented ✓

1. **Dangerous Pattern Detection**
   - Comprehensive regex blocklist
   - Prevents require/import/eval/Function constructor
   - Checked at route layer AND sandbox layer

2. **Permission-Based Execution**
   - Sandbox respects declared permissions
   - Network, filesystem, shell blocked by default
   - Only granted if explicitly declared

3. **Resource Limits**
   - 30-second execution timeout
   - 5-second CPU time limit
   - 128MB memory limit
   - Request/operation quotas

4. **Approval Workflow**
   - LLM tools with shell/filesystem/email → pending_approval
   - User must approve before LLM can use
   - Tools can be rejected without execution

5. **Isolation**
   - VM context prevents access to require/globalThis
   - Custom globals sanitized (no process, no fs)
   - eval/Function constructor blocked
   - Code generation disabled in VM

6. **User Data Isolation**
   - All queries filtered by userId
   - Tools not shared between users
   - Usage tracked per-user

7. **Config Center Integration**
   - API keys registered automatically
   - Tools can access configured credentials via utils.getApiKey()

---

## SECURITY CONCERNS & GAPS 🚨

### Critical Issues

1. **Pattern Detection is Brittle**
   - Regex-based blocklist can be bypassed with:
    - String concatenation: `"proce" + "ss.exit"()`
    - Variable assignment: `const p = process; p.exit()`
    - Unicode encoding: `\u0070\u0072\u006f\u0063\u0065\u0073\u0073.exit`
    - Proxy objects: `new Proxy(process, {})`
    - Property descriptors: `Object.defineProperty(globalThis, 'x', {get: () => process})`
   - No static code analysis, just regex matching

2. **No Rate Limiting on Execution**
   - User can execute same tool 1000x/second
   - No per-user or global rate limits
   - Only soft limits inside sandbox (30s timeout, 128MB memory)
   - No quota on network requests beyond 10 per execution

3. **Network Permission is Unrestricted**
   - Network permission grants full fetch() capability
   - No domain whitelist unless manually configured
   - Tool can exfiltrate data to external servers
   - fetch() can make requests to internal services (SSRF risk)

4. **File System Permission is Unrestricted**
   - If fsRead granted, tool can read ANY file in allowed paths
   - If fsWrite granted, tool can write ANY file in allowed paths
   - Default allowed paths: no configuration shown in code
   - No directory traversal prevention visible

5. **Shell Permission Allows Process Spawning**
   - spawn: true allows child process execution
   - Could spawn rm -rf, malicious binaries, etc.
   - No command whitelist
   - Only blocked by default (spawn: false) but can be declared

6. **No Audit Logging**
   - Tool executions not logged comprehensively
   - No way to audit what data was passed in/out
   - No compliance trail for debugging incidents
   - Usage count tracks executions but not inputs

7. **LLM Jailbreak Potential**
   - LLM could create tools with obfuscated code
   - Approval process only checks patterns, not semantic intent
   - User might not understand what code does
   - LLM could build tools incrementally to hide malice

8. **Config Center Integration Risk**
   - Tools can declare requiredApiKeys
   - Utils.getApiKey() gives raw credentials to tool
   - No scoping - tool gets full API key
   - No audit of which tools access which keys

9. **No Max Code Size Limit in Routes**
   - API routes don't validate code length
   - Can submit 1GB of code → DoS
   - Sandbox has no pre-execution size check visible
   - Database has no code length constraint

10. **Approval Bypass in Parameters**
    - Parameters are JSON Schema only
    - No schema validation for output shape
    - Tool could return arbitrary object with secrets

---

### Medium Issues

1. **No Tool Timeout Customization**
   - All tools get same 30s timeout
   - Long-running tools fail silently
   - No way to tune per-tool

2. **Error Messages Leak Information**
   - Stack traces returned to client
   - Could leak file paths, variable names, etc.

3. **Utils.callTool() Can Chain Execution**
   - A tool can call other tools recursively
   - No recursion depth limit visible
   - Could create infinite loops

4. **Metadata Field is Unrestricted**
   - Tools can store arbitrary metadata
   - Could be used to store secrets or state
   - No validation of metadata contents

5. **Category Field Has No Enum**
   - Custom categories can be anything
   - Could create XSS via unsanitized category display
   - UI displays category in tool cards

6. **Test Endpoint Doesn't Rate Limit**
   - POST /custom-tools/test allows dry-run
   - No limit on test executions
   - Could test 1000x/second without approval

---

### Low Issues

1. **Tool Name Collision After Delete**
   - UNIQUE(user_id, name) can be reused after deletion
   - Could create confusion or version conflicts

2. **Version Not Incremented on Permission Changes**
   - Only incremented on code/parameter changes
   - Changing permissions doesn't version
   - Hard to audit permission changes

3. **LastUsedAt Only in DB, Not Exposed**
   - Track usage but field barely used in UI
   - Good for cleanup but not leveraged

4. **RequiresApproval Field Unused**
   - Tools declare requiresApproval: true
   - Route layer doesn't enforce it
   - Should block execution until approved per-run

5. **No Tool Signing/Integrity Check**
   - Code stored plaintext
   - No way to verify tool wasn't modified
   - No checksums or signatures

---

## WHAT'S MISSING FOR PRODUCTION

### Code Safety

- [ ] **Semantic Code Analysis** - Use AST parser to detect obfuscation, prototype pollution, etc.
- [ ] **Static Type Checking** - TypeScript compilation of tool code (with strict mode)
- [ ] **Dependency Analysis** - Detect require/import attempts even if syntactically hidden
- [ ] **Output Sanitization** - Ensure tool output doesn't contain secrets before returning
- [ ] **Code Review Workflow** - User approval requires manual review of full code, not just pattern check

### Execution Safety

- [ ] **Rate Limiting** - Per-user execution quotas (X tools/minute)
- [ ] **Audit Logging** - Comprehensive logging of all executions with inputs/outputs
- [ ] **Timeout Customization** - Allow tool to declare its own timeout (with cap)
- [ ] **Max Code Size Limit** - Enforce 50KB limit in POST/PATCH endpoints
- [ ] **Network Allowlist** - Tools must declare allowed domains, blocked by default
- [ ] **Per-Tool Sandbox Config** - Let tools declare exact resources needed
- [ ] **Signature Verification** - Sign tools to detect tampering
- [ ] **Execution Quotas** - Prevent tool from running 1000x/second

### API Security

- [ ] **Per-Request Rate Limit** - Global rate limit on all tool execution endpoints
- [ ] **Input Validation** - Validate tool arguments against declared schema (JSON Schema validator)
- [ ] **Output Validation** - Validate tool return value against schema
- [ ] **Error Masking** - Hide internal errors from client, log separately
- [ ] **Approval Gate** - Enforce requiresApproval before execution (not just status check)

### Data Security

- [ ] **Encryption at Rest** - Encrypt tool code in database
- [ ] **Secret Management** - Don't return raw API keys to tools; use scoped tokens
- [ ] **Config Entry Scoping** - Tools can only access config entries they declared
- [ ] **Metadata Validation** - Enforce schema for metadata field
- [ ] **PII Detection** - Warn if output contains emails, phone numbers, SSN, etc.

### Monitoring & Compliance

- [ ] **Metrics** - Track tool execution success rate, avg latency, errors
- [ ] **Alerts** - Alert on high failure rate or abnormal usage patterns
- [ ] **Audit Trail** - Immutable log of all tool creation/modification/execution
- [ ] **Compliance Reports** - Generate reports for security reviews
- [ ] **Health Check** - Monitor sandbox resource usage

### UX/Safety

- [ ] **Tool Diff on Update** - Show diff of code changes before approval
- [ ] **Permission Warnings** - Warn user about dangerous permissions in approval UI
- [ ] **Code Syntax Highlighting** - Help user understand code before approval
- [ ] **Test Mode Integration** - Require passing test before tool can be approved
- [ ] **Documentation** - Show tool docs alongside approval dialog

---

## PRODUCTION-READINESS SCORE

| Category | Score | Notes |
|----------|-------|-------|
| Code Isolation | 7/10 | Good VM sandbox, but pattern detection bypasses possible |
| Permission Model | 6/10 | Declared but not strictly enforced per-execution |
| Execution Safety | 5/10 | Basic timeouts/limits, no rate limiting or audit |
| Data Protection | 6/10 | User isolation good, but API key handling risky |
| Error Handling | 4/10 | Leaks stack traces, no error masking |
| Monitoring | 2/10 | Only usage count, no comprehensive audit logging |
| Documentation | 5/10 | Code well-structured, but security docs missing |

**Overall: 5/10 - NOT PRODUCTION-READY** without addressing critical gaps (especially code pattern detection bypasses, rate limiting, audit logging, and API key scoping).

---

## RECOMMENDATIONS (Priority Order)

### 🔴 Critical (Block Production)

1. **Add AST-based code analysis** (not just regex)
   - Parse tool code as JavaScript AST
   - Reject suspicious patterns (property access chains, prototype pollution, etc.)
   - ~2-3 days work using @babel/parser

2. **Implement rate limiting**
   - Per-user execution quotas (e.g., 100 tools/minute)
   - Global rate limit (e.g., 10,000 tools/minute)
   - ~1 day work using existing rate-limit middleware

3. **Add comprehensive audit logging**
   - Log all tool executions: toolName, userId, arguments, result, error, duration, permissions
   - Immutable append-only log (PostgreSQL)
   - ~2 days work

4. **Enforce input/output validation**
   - Validate arguments against tool parameters schema
   - Validate output against expected shape
   - ~1 day work using ajv (JSON Schema validator)

### 🟠 High (Strongly Recommended)

5. **Scoped API key access**
   - Tools get token, not raw API key
   - Token scoped to declared permissions
   - ~3-5 days work

6. **Code size enforcement**
   - Add 50KB limit to POST/PATCH routes
   - Return 413 Payload Too Large
   - ~1 hour work

7. **Error masking**
   - Hide stack traces from client
   - Log errors with UUID for support reference
   - ~2 hours work

8. **Approval workflow enforcement**
   - Respect requiresApproval field
   - Require user interaction per-execution
   - ~1 day work

### 🟡 Medium (Nice to Have)

9. Execution metrics & dashboards
10. Tool diff on updates
11. Network allowlist per-tool
12. Per-tool resource customization
13. Tool signing & integrity verification

---

## Code References

- **Route Definitions:** /packages/gateway/src/routes/custom-tools.ts (L1-969)
- **Repository:** /packages/gateway/src/db/repositories/custom-tools.ts (L1-476)
- **Dynamic Tools:** /packages/core/src/agent/tools/dynamic-tools.ts (L1-937)
- **Sandbox Executor:** /packages/core/src/sandbox/executor.ts (L1-200+)
- **Tool Executor Service:** /packages/gateway/src/services/tool-executor.ts (L1-200+)
- **UI Page:** /packages/ui/src/pages/CustomToolsPage.tsx (L1-787)
- **Database Schema:** /packages/gateway/src/db/migrations/postgres/001_initial_schema.sql (L654-674)
