# Bridge Directory Routing Deep Research

> Date: 2026-04-05 | Branch: feature/v2-contextual-chat
> Scope: CLI tools, bridge spawn mechanism, X-Project-Dir flow, security analysis

---

## 1. Installed CLI Tools

| Tool | Binary Path | Version | Config Location |
|------|-------------|---------|-----------------|
| Claude Code | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.92` | 2.1.92 | `~/.config/Claude/` |
| OpenCode | `~/.opencode/bin/opencode` | 1.3.15 | `~/.config/opencode/` |
| Codex | `~/.npm-global/bin/codex` | 0.118.0 | `.codex/config.toml` per-project |
| Gemini | `~/.npm-global/bin/gemini` | 0.36.0 | `GEMINI.md` per-project |
| Aider | `~/.local/bin/aider` | 0.86.2 | `.aider.conf.yml` per-project |

---

## 2. CWD Mechanism Per Tool

| Tool | CWD Flag | Default | Project Root Detection | Mid-Session CWD Change |
|------|----------|---------|----------------------|----------------------|
| Claude Code | **None** (SDK: `cwd` option) | Shell CWD | `.claude/` walk-up | Blocked (security) |
| Codex | `--cd` / `-C` | Shell CWD | `.git` required | N/A |
| Gemini | **None** | Shell CWD | `GEMINI.md` hierarchy | `/directory add` runtime cmd |
| OpenCode | `--cwd` (ACP), `--dir` (attach) | Shell CWD | Git root walk-up | New ACP session |
| Aider | **None** | Shell CWD | `.git` required | N/A |

**Key insight:** Claude Code CLI has NO --cwd flag (feature request #26287 closed as NOT_PLANNED). The ONLY way to set CWD is `cd /path && claude ...` or via the SDK `cwd` option.

---

## 3. Bridge Runtime Registry

File: `/home/ayaz/openclaw-bridge/src/runtime-factory.ts`

```
const runtimes: Record<RuntimeProvider, CoreRuntime> = {
  claude:   claudeManager,        // ClaudeManager
  opencode: openCodeAdapter,      // OpenCodeRuntimeAdapter(openCodeManager)
  codex:    codexAdapter,         // CodexRuntimeAdapter(codexManager)
  gemini:   geminiAdapter,        // GeminiRuntimeAdapter(geminiManager)
};
```

4 runtime registered. Runtime selection via:
1. `X-Runtime` header (explicit)
2. Project configuration
3. `DEFAULT_RUNTIME` env var (fallback)

---

## 4. Bridge Spawn CWD Flow (ALL Runtimes)

### 4.1 HTTP Request → projectDir Resolution

```
POST /v1/chat/completions
  Header: X-Project-Dir: /home/ayaz/ownpilot
  Header: X-Runtime: claude

routes.ts:833-836:
  rawProjectDir = request.headers['x-project-dir']
                  ?? body.metadata?.project_dir
                  ?? config.defaultProjectDir     // fallback: /home/ayaz/

routes.ts:148-159:
  validateProjectDir(rawProjectDir)
    → resolve() (normalize ../ sequences)
    → check ALLOWED_PREFIXES: ['/home/ayaz/', '/tmp/']
    → block hidden home dirs (.ssh, .gnupg)
    → returns boolean
```

### 4.2 projectDir → Session Creation

```
base-runtime-manager.ts:199:
  projectDir = options.projectDir ?? config.defaultProjectDir

  SessionInfo = {
    conversationId, sessionId,
    projectDir,           // ← stored here
    processAlive: false,
    ...
  }
```

### 4.3 Session → CLI Spawn (per runtime)

**Claude (claude-manager.ts:994-998):**
```typescript
const proc = spawn(config.claudePath, args, {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: session.info.projectDir,    // ← CWD set here
});
```

**OpenCode (opencode-manager.ts:132-134):**
```typescript
const proc = this._spawnFn(this.opencodePath, args, {
  cwd: projectDir,                 // ← CWD set here
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

**Codex (codex-manager.ts:121-123):**
```typescript
const proc = this._spawnFn(this.codexPath, args, {
  cwd: projectDir,                 // ← CWD set here
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

**Gemini (gemini-manager.ts:129-131):**
```typescript
const proc = this._spawnFn(this.geminiPath, args, {
  cwd: spawnCwd,                   // ← CWD set here (convDir or projectDir)
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

**All 4 runtimes use the same pattern: `child_process.spawn(..., { cwd: projectDir })`**

---

## 5. X-Project-Dir Flow — COMPLETE TRACE

```
OwnPilot UI (useChatStore.tsx:302)
  │  chatHeaders['X-Project-Dir'] = contextPath
  │
  ▼
OwnPilot Gateway (Hono, port 8080)
  │  ❌ DOES NOT FORWARD X-Project-Dir to bridge!
  │  Only forwards: X-Runtime, X-Session-Token
  │  agent-cache.ts: NO X-Project-Dir handling
  │
  ▼  (header DROPPED here)
Bridge (Fastify, port 9090)
  │  routes.ts:834: reads X-Project-Dir from request.headers
  │  ✅ Validates against allowlist
  │  ✅ Passes to runtime manager as projectDir
  │
  ▼
CLI Process (spawn)
  │  ✅ cwd: session.info.projectDir
  │
  ▼
AI operates in the correct directory
```

### CRITICAL GAP

**The OwnPilot Gateway does NOT forward X-Project-Dir to the Bridge.**

Evidence:
- `packages/gateway/src/routes/agent-cache.ts` only handles `X-Runtime`
- No mention of `X-Project-Dir` in gateway code (grep confirmed: 0 results)
- Recent commit `fc90fc0b` REMOVED X-Project-Dir from bridge requests (container path invalid)

### Container Path Problem

OwnPilot runs in Docker. Container paths (e.g., `/app/packages/gateway/`) don't exist on the host where bridge runs. This is WHY X-Project-Dir was removed. The solution requires a path-mapping mechanism.

---

## 6. Security Analysis (Devil's Advocate)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Path traversal (direct) | — | **Mitigated** (allowlist + resolve) |
| 2 | **Symlink bypass** | **Critical** | **UNMITIGATED** — no realpath() check |
| 3 | Non-existent directory | Low | Mostly mitigated (existsSync check) |
| 4 | Race condition (projectDir mismatch) | Medium | Silent wrong-dir, no warning |
| 5 | Session isolation | Low | **Well mitigated** |
| 6 | Docker container path mismatch | High | **Fixed** (fc90fc0b) |
| 7 | Default CWD too broad | Medium | `/home/ayaz/` = entire home dir |
| 8 | **additionalDirs no validation** | **High** | **UNMITIGATED** — bypasses all path checks |
| 9 | Mid-session directory change | Low | CWD immutable by design |
| 10 | DoS via large directory | Low | Rate limiting protects |

### Top 3 Security Fixes Needed

1. **`additionalDirs` validation** — `--add-dir` paths bypass validateProjectDir()
2. **Symlink resolution** — Add `realpathSync()` after `resolve()` in validateProjectDir()
3. **Narrow default CWD** — Change from `/home/ayaz/` to specific project dir

---

## 7. Best Practices from Web Research

### CWD Normalization Pattern (Recommended)

Each tool handles CWD differently. Bridge should normalize:

```typescript
function setCwdForRuntime(runtime: RuntimeProvider, projectDir: string): SpawnOptions {
  switch (runtime) {
    case 'claude':
      // No --cwd flag, use spawn cwd option
      return { cwd: projectDir };
    case 'codex':
      // Has --cd flag, but spawn cwd also works
      return { cwd: projectDir, args: ['--cd', projectDir] };
    case 'gemini':
      // No --cwd flag, use spawn cwd option
      return { cwd: projectDir };
    case 'opencode':
      // Has --cwd flag for ACP mode
      return { cwd: projectDir, args: ['--cwd', projectDir] };
  }
}
```

**Current bridge already does this correctly** — all 4 runtimes use `spawn({ cwd: projectDir })`.

### ACP (Agent Client Protocol) — Emerging Standard

- Supported by: OpenCode, Gemini CLI, Claude Code (adopting), Codex (adopting)
- `session/new` requires `cwd` parameter
- Future bridge could use ACP instead of CLI spawn for runtimes that support it

### Sandbox Comparison

| Tool | Linux Sandbox | Default State |
|------|--------------|---------------|
| Claude Code | Bubblewrap | Off by default |
| Codex | Landlock + seccomp | **On by default** |
| Gemini | gVisor / LXC / Docker | Off by default |
| OpenCode | None | No sandbox |
| Aider | None | No sandbox |

---

## 8. Architectural Decision: How to Enable Contextual Chat Directory Routing

### Problem Statement

OwnPilot UI detects page context (workspace path, coding-agent cwd) and wants to tell the bridge "run the AI in THIS directory." But:
1. Gateway doesn't forward X-Project-Dir
2. Container paths ≠ host paths
3. Not all contexts HAVE a physical directory

### Solution Options

#### Option A: Gateway-Level Path Mapping (Recommended)

```
UI sends: X-Project-Dir: /workspaces/abc123
Gateway resolves: workspace.path → /home/ayaz/projects/myproject
Gateway forwards to bridge: X-Project-Dir: /home/ayaz/projects/myproject
Bridge validates + spawns CLI with cwd
```

- Gateway has DB access to resolve workspace → physical path
- Gateway knows about OWNPILOT_HOST_FS bind mount mapping
- Bridge receives host-valid paths

#### Option B: Body-Level Context (Simpler)

```
UI sends: { message, pageContext: { type: 'workspace', path: '/home/ayaz/...' } }
Gateway extracts path from pageContext
Gateway injects X-Project-Dir header to bridge request
```

- No new API fields needed
- Context travels in request body
- Gateway can validate/transform path before forwarding

#### Option C: Bridge-Side Resolution (Complex)

```
UI sends: { workspaceId: 'abc123' }
Bridge calls OwnPilot API to resolve workspaceId → path
Bridge uses resolved path as CWD
```

- Bridge needs OwnPilot API access (coupling)
- More round trips
- NOT recommended

### Recommendation: Option A

Gateway already has:
- Workspace DB access (repositories)
- Provider config with bridge headers (agent-cache.ts)
- X-Runtime header forwarding pattern to copy

Just add X-Project-Dir forwarding alongside X-Runtime in agent-cache.ts `loadProviderConfig()`.

---

## 9. Cross-Reference Validation

| Claim | Evidence | Status |
|-------|----------|--------|
| All 4 runtimes use spawn({cwd}) | claude-manager.ts:997, opencode-manager.ts:133, codex-manager.ts:122, gemini-manager.ts:130 | ✅ Confirmed |
| Gateway drops X-Project-Dir | grep "X-Project-Dir" gateway/src = 0 results | ✅ Confirmed |
| Bridge validates paths | validateProjectDir() with allowlist | ✅ Confirmed |
| No symlink protection | grep "realpath\|lstat\|readlink" bridge/src = 0 | ✅ Confirmed (gap) |
| additionalDirs unvalidated | claude-manager.ts:980-983, no validateProjectDir call | ✅ Confirmed (gap) |
| Claude CLI has no --cwd | GitHub #26287 closed NOT_PLANNED | ✅ Confirmed |
| Default CWD = /home/ayaz/ | config.ts:78 | ✅ Confirmed |
| Container path problem | commit fc90fc0b removed X-Project-Dir | ✅ Confirmed |

---

## 10. Action Items for v2.0 Contextual Chat

### Must Do (Contextual Chat to work)

1. **Gateway: Forward X-Project-Dir to bridge** — Add header forwarding in agent-cache.ts loadProviderConfig()
2. **Gateway: Resolve workspace path** — Use fileWorkspacesApi or DB to map workspace ID → host path
3. **Handle Docker path mapping** — OWNPILOT_HOST_FS env var for container → host path translation

### Should Do (Security)

4. **Bridge: Add realpath() to validateProjectDir** — Prevent symlink bypass
5. **Bridge: Validate additionalDirs** — Apply same allowlist to --add-dir paths
6. **Bridge: Narrow default CWD** — /home/ayaz/ → /home/ayaz/ownpilot/ or similar

### Nice to Have (Future)

7. **ACP integration** — Use ACP protocol for runtimes that support it (OpenCode first)
8. **Per-workspace sandbox** — Different security profiles per workspace type
9. **Path mapping config** — Configurable Docker → host path translations

---

## 11. Security CVEs — Real-World Directory Routing Vulnerabilities

| CVE | Tool | Attack | Impact |
|-----|------|--------|--------|
| CVE-2025-53109 | MCP Filesystem Server | Symlink bypass past path prefix validation | Read /etc/sudoers |
| CVE-2025-53110 | MCP Filesystem Server | Symlink write exploit | Write macOS Launch Agents |
| CVE-2025-68143/44/45 | Anthropic Git MCP Server | Path traversal + argument injection | RCE via prompt injection |
| CVE-2026-20669 | Agent Safehouse | macOS sandbox path validation gap | Improved in patch |
| — | Claude Code | Bubblewrap escape via /proc/self/root | Sandbox disabled entirely |

**Lesson:** Simple path prefix checking is INSUFFICIENT (CVE-2025-53109). Use `realpathSync()` to resolve symlinks before validation. Kernel-level isolation (gVisor, microVMs) is the only robust approach.

---

## 12. Multi-Runtime Orchestrator Patterns (Industry)

### Overstory (github.com/jayminwest/overstory)
- 11 runtime support (Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Copilot, Cursor, Pi, Sapling)
- Each agent gets isolated git worktree — no file conflicts
- Runtime adapters deploy runtime-specific config (.claude/, .codex/, GEMINI.md)
- SQLite mail system for inter-agent coordination
- Tiered conflict resolution on merge

### pi-builder
- TypeScript monorepo wrapping 10+ CLI agents
- Capability-based routing, health caching, fallback chains
- Streaming OrchestratorService with SQLite persistence

### Composio Agent Orchestrator (github.com/ComposioHQ/agent-orchestrator)
- Plans tasks, spawns agents autonomously
- Handles CI fixes, merge conflicts, code reviews

### Wit (Function-Level Locking)
- Tree-sitter AST parsing to lock specific functions (not files)
- Agents declare intents, acquire symbol-level locks
- Conflict warnings before writing

---

## 13. Sandbox Comparison Table

| Tool | Linux Sandbox | macOS Sandbox | Default State | Mechanism |
|------|--------------|---------------|---------------|-----------|
| Claude Code | Bubblewrap | Seatbelt | **Off** | Process namespace |
| Codex | Landlock + seccomp | N/A (Docker) | **On** | Kernel LSM |
| Gemini CLI | gVisor / LXC / Docker | Seatbelt | Off | Container/microVM |
| OpenCode | None | None | — | No sandbox |
| Aider | None | None | — | No sandbox |

**NVIDIA AI Red Team Mandatory Controls:**
1. Network egress controls (no unrestricted outbound)
2. File write restrictions (designated workspace only)
3. Configuration file protection (block .bashrc, .gitconfig, .zshrc writes)

---

## 14. External Sources & References

- [Claude Code --cwd feature request #26287](https://github.com/anthropics/claude-code/issues/26287) — Closed NOT_PLANNED
- [Claude Code SDK cwd option](https://platform.claude.com/docs/en/agent-sdk/claude-code-features)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference) — --cd flag
- [Codex Config Reference](https://developers.openai.com/codex/config-reference) — .codex/config.toml
- [Gemini CLI Configuration](https://geminicli.com/docs/cli/sandbox/) — 5 sandbox modes
- [Gemini --include-directories bug #13669](https://github.com/google-gemini/gemini-cli/issues/13669)
- [OpenCode ACP Support](https://opencode.ai/docs/acp/) — session/new requires cwd
- [ACP Agent Registry (JetBrains)](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/)
- [Aider Options Reference](https://aider.chat/docs/config/options.html) — no --cwd
- [Overstory multi-agent](https://github.com/jayminwest/overstory) — 11 runtime orchestrator
- [Composio Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator)
- [AI Agent Sandbox Security (Northflank)](https://northflank.com/blog/how-to-sandbox-ai-agents)
- [OWASP AI Agent Security Top 10 2026](https://medium.com/@oracle_43885/owasps-ai-agent-security-top-10-agent-security-risks-2026)
- [MCP Filesystem CVEs (symlink bypass)](https://blog.cyberdesserts.com/ai-agent-security-risks/)
- OwnPilot HOST-FILESYSTEM-ACCESS.md — 3 security profiles (documented, not implemented)
