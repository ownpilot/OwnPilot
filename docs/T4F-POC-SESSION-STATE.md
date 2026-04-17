# T4F BAM Daily Pipeline PoC — Session State & Handover

> **Session date:** 2026-04-16 (evening, ~40m hot work + 11m UI tour + state consolidation)
> **Branch:** `main`
> **Status:** PoC complete. Cron live at 05:00 UTC (= 08:00 Europe/Istanbul). First natural fire: 2026-04-17.
> **Next:** Yol B (host systemd HTTP MCP) → Yol A (Docker MCP container fleet pattern).
> **Related docs:**
> - [AGENT_ECOSYSTEM.md](./AGENT_ECOSYSTEM.md)
> - [CONTEXT_GRAPH_HOOK_ARCHITECTURE.md](./CONTEXT_GRAPH_HOOK_ARCHITECTURE.md)
> - [INJECT_ARCHITECTURE_ANALYSIS.md](./INJECT_ARCHITECTURE_ANALYSIS.md)
> - [PERSONAL_ASSISTANT_INJECTION_ROOT_CAUSE.md](./PERSONAL_ASSISTANT_INJECTION_ROOT_CAUSE.md)

---

## 0. Session Scope & Evolution

### Original Question (session start)
> "Cypack forunu ve upstream versiyonunu inceleyip bugün attığım agent commitleri çek; elimizdeki otomasyonlarin karşılığı neyse OwnPilot platformunda yaratalım."

Bu, Claude Code kurulumumdaki (~27 subagent + 143 skill + 8 rule + 20+ hook) otomasyonları OwnPilot'a nasıl taşırız sorusuyla başladı.

### Scope Narrowing (sıralı kararlar)
1. **İlk durum analizi**: Claude Code ↔ OwnPilot kaynaklarını mapledik (subagents → `agents` tablosu, skills → `user_extensions`, rules → yok! gap identified, hooks → `PluginHooks` partial).
2. **Kullanıcı odak daralttı**: Günlük iş akışlarına odaklan (BAM T4F, Voorinfra upload/weekly). MCP server kurgusu zaten mevcut.
3. **Mimari pivot**: OwnPilot'un kendi içinde MCP re-register yerine **mevcut bridge+OpenCode yığınını delegate** et.
4. **Scope final**: Sadece **T4F günlük görev listesi PoC**. Voorinfra + WhatsApp push → v2.
5. **3 Odak** tanımlandı:
   - MiniMax API sağlam mı?
   - Context injection (system_prompt) çalışıyor mu?
   - Agent local OpenCode + MCP'yi kullanabiliyor mu?

Sonuçta: **4 katmanlı OwnPilot-native otomasyon**: `local_providers` → `agents` → `workflows` → `triggers`, arkada bridge→OpenCode delegation.

---

## 1. Final Architecture (Cron Path, End-to-End)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. TRIGGER  (triggers table)                                        │
│    id:       trigger_1776371663768_8a6c466e                         │
│    type:     schedule                                                │
│    config:   { cron: '0 5 * * *', timezone: 'UTC' }                 │
│    action:   { type: 'workflow',                                    │
│                payload: { workflowId: 'wf_...' } }                  │
│    nextFire: 2026-04-17T05:00:00Z  (=08:00 Istanbul)                │
│                                                                      │
│    TriggerEngine (packages/gateway/src/triggers/engine.js)          │
│    polls every minute → fire at cron match.                         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ actionHandlers.get('workflow')(payload)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. WORKFLOW  (workflows table)                                      │
│    id:     wf_1776371556902_bd3233fa                                │
│    name:   "T4F Daily Fetcher"                                      │
│    status: active                                                    │
│    nodes:  [{ id: 'llm_t4f', type: 'llmNode',                       │
│               data: { provider: 'bridge-opencode',                  │
│                       model: 'minimax/MiniMax-M2.7',                │
│                       systemPrompt, userMessage,                    │
│                       maxTokens: 4096, temperature: 0.3 } }]        │
│                                                                      │
│    workflowService.executeWorkflow(wfId, 'default')                 │
│    → dispatchNode() → executeLlmNode(node, ...)                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ openai-compatible adapter
                           │ (createProvider with headers)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. OPENAI-COMPATIBLE PROVIDER ADAPTER                               │
│    File: packages/core/src/agent/providers/openai-compatible.js     │
│                                                                      │
│    Magic: providerId.startsWith('bridge-')                          │
│      → fetchOptions.headers['X-Runtime'] = 'opencode'                │
│      → fetchOptions.headers['X-Conversation-Id'] = conversationId    │
│      → Authorization: Bearer ${localProv.apiKey}                    │
│                                                                      │
│    loadProviderConfig('bridge-opencode') resolves to:               │
│      baseUrl: 'http://host.docker.internal:9090/v1'                 │
│      api_key: <BRIDGE_API_KEY from local_providers row>             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ POST /v1/chat/completions
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. BRIDGE (openclaw-bridge, host)                                   │
│    Port:       9090                                                  │
│    Auth:       Bearer BRIDGE_API_KEY                                │
│    Process:    ~/openclaw-bridge/mcp/index.ts                       │
│    Runtime:    X-Runtime: opencode → spawn_opencode adapter         │
│    Spawn cmd:  opencode run <prompt> --format json                  │
│                 --dir /home/ayaz/  (DEFAULT_PROJECT_DIR)            │
│                 --model minimax/MiniMax-M2.7                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. OPENCODE CLI (host, /home/ayaz/.opencode/bin/opencode)           │
│    Config: ~/.config/opencode/opencode.json (38 MCPs defined)       │
│    Auth:   ~/.local/share/opencode/auth.json (openrouter key)       │
│    Env:    MINIMAX_API_KEY (inherited from host env)                │
│                                                                      │
│    Loads T4FServer MCP subprocess:                                  │
│      /home/ayaz/projects/t4f-api-client/.venv/bin/python            │
│      /home/ayaz/projects/t4f-api-client/src/mcp_server.py           │
│                                                                      │
│    Agent rule (opencode.json agent: T4FServer-BAM-Ayaz):            │
│      → BAM profile autoselected when user says "BAM"/"Ayaz"         │
│      → Model: dashscope/kimi-k2.5 (if --agent flag used)            │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. T4F MCP (subprocess)                                             │
│    15 tools: get_session_status, get_task_list, get_tasks_by_date,  │
│              get_weekly_tasks, get_task_detail, get_batch_*,        │
│              download_*, export_to_xlsx, update_xlsx, login,       │
│              unlock_session                                          │
│                                                                      │
│    Uses patchright (stealth playwright) + chromium                  │
│    Browser profile: .venv-accompanying/browser-profile/             │
│    T4F endpoint: https://fiber-bam.twict.io/api/rest/web/v2         │
│    T4F UI: https://www.t4f.app/tasks                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Real JSON response
                           ▼
      Markdown table (10 tasks for today) →
      OpenCode response → Bridge → OwnPilot workflow-service →
      workflow_logs.nodeResults.llm_t4f.output → UI display
```

---

## 2. Built Artifacts (Database Rows + Config)

### 2.1 `local_providers` — **NEW literal-id row**

```sql
-- id='bridge-opencode' literal (added for cache lookup-by-name compatibility)
INSERT INTO local_providers (
  id, user_id, name, provider_type, base_url, api_key, is_enabled, ...
) VALUES (
  'bridge-opencode',                                     -- id = name (CRITICAL: was UUID-only before)
  'default',
  'bridge-opencode',
  'custom',
  'http://host.docker.internal:9090/v1',
  '<BRIDGE_API_KEY — 39 chars, from /home/ayaz/openclaw-bridge/.env>',
  true,
  ...
);
```

**Why this was needed**: `providersCache` keyed by `r.id` (see `packages/gateway/src/db/repositories/local-providers.js:79`). Lookup by name `'bridge-opencode'` returns null unless a row with id='bridge-opencode' literal exists. This was the root cause of the 404 "Agent not found" we hit.

### 2.2 `local_models` — **3 new rows**

```sql
-- minimax/MiniMax-M2.7 (used in PoC)
-- minimax/MiniMax-M2.7-highspeed (listed but plan doesn't support)
-- dashscope/kimi-k2.5 (alt for future)
-- All FK → 'bridge-opencode' literal id
```

### 2.3 `agents` — **NEW t4f-agent row**

```sql
INSERT INTO agents (id, name, provider, model, system_prompt, config)
VALUES (
  't4f-agent',
  'T4F Pipeline Agent',
  'bridge-opencode',
  'minimax/MiniMax-M2.7',
  '<2097-char Turkish T4F domain prompt>',
  '{"maxTokens":4096,"temperature":0.3,"maxTurns":3,"maxToolCalls":10}'
);
```

### 2.4 `workflows` — **NEW wf_1776371556902_bd3233fa**

```json
{
  "id": "wf_1776371556902_bd3233fa",
  "name": "T4F Daily Fetcher",
  "description": "Cron'a bağlı: bugünün T4F görevlerini bridge-opencode üzerinden OpenCode'a sorar, markdown tablo döndürür.",
  "status": "active",
  "nodes": [{
    "id": "llm_t4f",
    "type": "llmNode",
    "position": {"x": 200, "y": 200},
    "data": {
      "provider": "bridge-opencode",
      "model": "minimax/MiniMax-M2.7",
      "maxTokens": 4096,
      "temperature": 0.3,
      "systemPrompt": "Sen OwnPilot'un T4F Daily Cron agent'ısın. Görev: BAM (Ayaz) profili için bugünün T4F görevlerini çekmek. Herhangi bir soru sorma, onay bekleme; doğrudan tool çağrısı yap.",
      "userMessage": "BAM (Ayaz) profili için: T4FServer MCP'de `get_task_list` tool'unu `headless=true` ile çağır. Dönen JSON'dan bugüne ait (YYYY-MM-DD) görevleri markdown tablo olarak aç: | Saat | Adres | Durum | POP | DP | ODF Strand |. Alta `Kaynak: T4F (fiber-bam.twict.io)` ekle. <think> bloklarını gösterme. Sadece tabloyu döndür."
    }
  }],
  "edges": []
}
```

### 2.5 `triggers` — **NEW trigger_1776371663768_8a6c466e**

```json
{
  "id": "trigger_1776371663768_8a6c466e",
  "name": "T4F Daily 08:00",
  "description": "Her sabah 08:00 Europe/Istanbul — T4F günlük görev listesini BAM profili için çeker",
  "type": "schedule",
  "config": { "cron": "0 5 * * *", "timezone": "UTC" },
  "action": {
    "type": "workflow",
    "payload": { "workflowId": "wf_1776371556902_bd3233fa" }
  },
  "enabled": true,
  "priority": 5,
  "nextFire": "2026-04-17T05:00:00.000Z"
}
```

---

## 3. Decisions & Rationale

| Decision | Alternative(s) considered | Chose because |
|---|---|---|
| Use `bridge-opencode` provider not custom MCP register | Register T4F MCP directly to OwnPilot (`mcp_servers`) | OwnPilot container is Alpine (musl), T4F MCP is stdio-only with glibc venv. Direct spawn impossible. Bridge HTTP works today. |
| Workflow + trigger instead of custom_tool | Custom_tool with fetch() | Sandbox 30s walltime + SSRF private-IP block would fail (OpenCode cold start 33s). |
| llmNode provider=bridge-opencode | HTTP node calling bridge manually | Adapter auto-injects `X-Runtime: opencode` header from `bridge-` prefix (lines 85-89 of `packages/core/src/agent/providers/openai-compatible.js`). Cleaner. |
| model=`minimax/MiniMax-M2.7` (not `-highspeed`) | `-highspeed` variant | MiniMax API returned `(2061) your current token plan not support model, MiniMax-M2.7-highspeed`. Key only supports base M2.7. |
| Cron `0 5 * * *` UTC | `0 8 * * *` + timezone='Europe/Istanbul' | UI validation was quirky on timezone — UTC-offset cron more reliable across scheduler versions. Equivalent time. |
| Dedicated `t4f-agent` row | Add tool to Personal Assistant | User explicit: "Personal Assistant'a dokunma". Separation of concerns. |
| PoC keeps Personal Assistant bug unfixed | Fix model='minimax/MiniMax-M2.7' → 'MiniMax-M2.7' | Out-of-scope for PoC. Pre-existing bug. Documented for separate fix. |

---

## 4. Problems Encountered & Resolved

| # | Problem | Evidence | Resolution |
|---|---|---|---|
| 1 | OpenCode binary `/host-home/.opencode/bin/opencode` not executable in OwnPilot container | `ldd` errors: `ld-linux-x86-64.so.2` missing, `gnu_get_libc_version` symbol not found | Alpine musl vs host glibc ABI mismatch. **Pivoted from direct exec → bridge HTTP delegation.** |
| 2 | Chat POST 404 "Agent not found: t4f-agent" despite GET /agents/t4f-agent returning data | getAgent returns undefined in 11ms (too fast for failed createAgentFromRecord) | Root cause: `localProvidersRepo.getProvider('bridge-opencode')` returns null because cache keyed by `r.id` (UUID), not `r.name`. **Fix**: INSERT literal `id='bridge-opencode'` row mirroring existing `id='bridge-claude'` pattern. |
| 3 | MiniMax 500 error: `invalid params, unknown model 'minimax/minimax-m2.7'` | Default agent `model` field = `minimax/MiniMax-M2.7` (bridge prefix) but MiniMax API expects `MiniMax-M2.7` bare | **Scoped out**. Pre-existing bug in Personal Assistant config. t4f-agent uses correct format. Workflow llmNode provider=`bridge-opencode` makes prefix valid (routed via bridge, not direct MiniMax). |
| 4 | Custom_tool runtime sandbox blocked bridge HTTP | `SAFE_FETCH_TIMEOUT_MS = 30_000`, `isPrivateUrlAsync` rejects `host.docker.internal`→172.17.0.1 | **Switched from custom_tool to workflow llmNode**. llmNode uses provider adapter path, not sandbox fetch. No SSRF check on that path. |
| 5 | Trigger manual-fire returned `Missing workflowId in payload` | Engine spreads `...trigger.action.payload`, but action had workflowId at action root | **Fixed**: move workflowId under `action.payload.workflowId` (correct schema). |
| 6 | Cron `0 8 * * *` + timezone `Europe/Istanbul` → nextFire computed as 08:00 UTC (3h early) | UI shows `nextFire=2026-04-17T08:00:00Z` | **Fixed**: use `0 5 * * *` + timezone `UTC` (explicit UTC offset). nextFire=05:00 UTC = 08:00 Istanbul. Clear. |
| 7 | Bridge /v1/chat/completions returned "unknown model" for `model:"opencode"` | OpenCode's own error: "Run --model to pick a different model" | Bridge routing: `model` field expects real model name, **`X-Runtime` header** selects CLI (opencode/claude/codex/gemini). Used `X-Runtime: opencode` + model=`minimax/MiniMax-M2.7`. |

---

## 5. Verification Evidence

### Test log summary (from execution_logs)

| Run | logId | Started | Duration | Status |
|---|---|---|---|---|
| 1 | `wflog_1776371470...` | 10:32:36 PM | 17.6s | completed (early test, incomplete prompt) |
| 2 | `wflog_1776371631...` | 10:33:24 PM | 36.7s | completed (workflow direct execute) |
| 3 | `wflog_1776371718835_af1d5d2b` | 10:35:18 PM | 37.3s | completed (trigger manual fire — the key test) |

### Sample output (from run 3)

```
| Saat        | Adres                         | Durum       | POP     | DP              | ODF Strand          |
|-------------|-------------------------------|-------------|---------|-----------------|---------------------|
| 08:00-09:00 | Pieter Dekkerstraat 29, Winkel | IN_PROGRESS | WKL-AAJ | WKL-AAJ-ODP106  | WKL-AAJ/101/10/53   |
| 09:00-10:00 | P. van Zoonenstraat 18, Winkel | COMPLETED   | WKL-AAJ | WKL-AAJ-ODP107  | WKL-AAJ/101/11/51   |
... (10 rows total)
Kaynak: T4F (fiber-bam.twict.io)
```

### Cost / perf

- Cold OpenCode spawn: ~33s
- Warm runs: 20-37s
- Token usage: bridge OpenAI-compat doesn't forward usage field → OwnPilot cost tracking shows 0
- Success rate in tests: 3/3

---

## 6. Source File References (Code Paths Touched or Analyzed)

All paths relative to repo root unless marked `(host)`.

### OwnPilot — Provider Layer
- `packages/core/src/agent/providers/openai-compatible.js` — **lines 85-89** (`X-Runtime` auto-inject). **Core magic enabling bridge routing**.
- `packages/gateway/src/routes/agent-cache.js:131-199` — `getProvider`, `getProviderApiKey`, `loadProviderConfig`. **Cache UUID-keyed**. Root cause of bug #2.
- `packages/gateway/src/db/repositories/local-providers.js:75-105` — `refreshCache` creates cache Map keyed by `r.id`. **The lookup mismatch source**.

### OwnPilot — Agent Runtime
- `packages/gateway/src/routes/agent-service.js:40-155` — `createAgentFromRecord`. Where provider resolution happens. Silent failure on provider lookup → 404.
- `packages/gateway/src/routes/agent-service.js:215-244` — `getAgent`. `.catch { return undefined }` swallows errors; debugging difficult.

### OwnPilot — Workflow Engine
- `packages/gateway/src/services/workflow/node-executors.js:123-230` — `executeLlmNode`. Resolves provider via same `loadProviderConfig` path. Headers propagate.
- `packages/gateway/src/services/workflow/workflow-service.js:640-700` — `dispatchNode`. Central dispatch for 24 node types.

### OwnPilot — Trigger Engine
- `packages/gateway/src/triggers/engine.js:151-230` — `registerActionHandler`. `chat`/`tool`/`workflow`/`notification`/`goal_check`/`memory_summary` built-in handlers.
- `packages/gateway/src/triggers/engine.js:186-216` — `chat` handler **ignores payload.agentId** → forced us to workflow path.
- `packages/gateway/src/triggers/engine.js:530-575` — `fireTrigger`. Spreads `action.payload` into handler call.

### OwnPilot — Chat Route
- `packages/gateway/src/routes/chat.js:103-170` — POST `/api/v1/chat`. Body: `{message, agentId?, conversationId?, provider?, model?, stream?}`. Agent lookup via `getAgent(body.agentId)`.

### OwnPilot — Sandbox (why custom_tool abandoned)
- `packages/core/src/agent/tools/dynamic-tool-executor.js:15-40` — `limits: {maxExecutionTime: 30_000}`. Hard walltime.
- `packages/core/src/agent/tools/dynamic-tool-sandbox.js:14-40` — `createSafeFetch`. Uses `isPrivateUrlAsync` → blocks 172.x.
- `packages/gateway/src/utils/ssrf.js:26-85` — `isBlockedUrl` + `isPrivateUrlAsync`. Blocks RFC1918, `host.docker.internal`.

### Bridge (host, outside repo)
- `/home/ayaz/openclaw-bridge/mcp/index.ts` — bridge server entry
- `/home/ayaz/openclaw-bridge/.env` — `BRIDGE_API_KEY`, `DEFAULT_PROJECT_DIR=/home/ayaz/`, `IDLE_TIMEOUT_MS=1800000`, `MINIMAX_API_KEY`
- `/home/ayaz/openclaw-bridge/docs/MULTI-PROVIDER-GUIDE.md` — `X-Runtime` header docs, spawn commands per runtime

### OpenCode (host, outside repo)
- `/home/ayaz/.opencode/bin/opencode` — binary (glibc)
- `/home/ayaz/.config/opencode/opencode.json` — 38 MCPs, providers, agents, default model
- `/home/ayaz/.local/share/opencode/auth.json` — only openrouter api key
- `/home/ayaz/.local/share/opencode/opencode.db` — session store

### T4F (host, outside repo)
- `/home/ayaz/projects/t4f-api-client/.venv/bin/python` — Python 3.14 venv
- `/home/ayaz/projects/t4f-api-client/src/mcp_server.py` — FastMCP stdio server, 15 tools
- `/home/ayaz/projects/t4f-api-client/browser-profile/` — patchright chromium session
- `/home/ayaz/projects/scrapling-workspace/tasks/t4f/MCP-ARCHITECTURE.md` — T4F MCP design notes

### Similar-purpose Docker MCP projects (host, template for Yol A)
- `/home/ayaz/projects/voorinfra-mcp-ownpilot/Dockerfile` — template to adapt
- `localhost:5000/voorinfra-mcp:latest` (registry) — serves on :8766
- `localhost:5000/evolution-mcp:latest` — :8765
- `localhost:5000/soulforge-mcp:latest` — :8767

---

## 7. UI Reference Screenshots

All 19 screenshots in `docs/screenshots/t4f-poc/`:

| File | What it shows |
|---|---|
| `t4f_01_home.png` | OwnPilot home (sidebar shows T4F Daily Fetcher workflow) |
| `t4f_02_workflows_list.png` | Workflows Home tab — 7 workflows, 1 active |
| `t4f_03_workflows_tab.png` | Workflows tab — T4F Daily Fetcher card with Run/Deactivate |
| `t4f_04_workflow_editor.png` | Canvas with LLM node + 24-node sidebar |
| `t4f_05_workflow_source.png` | **JSON source view** of the workflow |
| `t4f_06_execution_logs.png` | Workflows → Execution Logs tab |
| `t4f_07_exec_logs.png` | 3 execution runs list |
| `t4f_08_log_detail.png` | Individual log — llm_t4f card |
| `t4f_09_log_expanded.png` | **Full output** of the llm_t4f node (markdown table) |
| `t4f_10_triggers.png` | Triggers home — Engine Running ✓ |
| `t4f_11_triggers_list.png` | Triggers list — T4F Daily 08:00 card |
| `t4f_12_trigger_detail.png` | **Edit Trigger dialog** — cron, timezone, action type, workflow |
| `t4f_13_agents.png` | Agents home |
| `t4f_14_agents_list.png` | 4 agents: T4F Pipeline Agent visible |
| `t4f_15_agent_config.png` | Agent Edit dialog — Config tab |
| `t4f_18_agent_info.png` | **Agent Info tab** — system prompt |
| `t4f_19_agent_model_tab.png` | **Agent Model tab** — model picker with categories |

---

## 8. Pre-existing Bugs Documented (Not Fixed, Out of Scope)

### Bug A — Personal Assistant model prefix
```
agents.default.model = 'minimax/MiniMax-M2.7'  (bridge prefix)
But default agent has provider='minimax' (direct MiniMax API, no bridge)
→ MiniMax API rejects "unknown model minimax/minimax-m2.7"
```

**Impact**: Chat with `agentId:'default'` fails with HTTP 500.
**Fix** (separate work): `UPDATE agents SET model='MiniMax-M2.7' WHERE id='default'`

### Bug B — OpenCode `<think>` blocks in response
OpenCode reasoning mode emits `<think>...</think>` blocks in output. Currently persisted in `workflow_logs.nodeResults.llm_t4f.output`.

**Fix** (v2): add `transformerNode` after llmNode to regex-strip `<think>` blocks.

### Bug C — Bridge OpenAI-compat doesn't forward usage
Bridge response lacks `usage: {prompt_tokens, completion_tokens}`. OwnPilot cost tracking shows 0 for this path.

**Fix** (bridge PR): populate usage from OpenCode stream metadata.

### Bug D — `getAgent` swallows errors
`packages/gateway/src/routes/agent-service.js:215` — `.catch { return undefined }` makes debugging 404 "Agent not found" extremely hard (we spent ~30min tracing bug #2). Should log error internally even if returning undefined.

---

## 9. Operational Cheatsheet

### Manual trigger fire (skip waiting for cron)
```bash
TOKEN=$(curl -sS -m 5 -X POST -H "Content-Type: application/json" \
  -d '{"password":"OwnPilot2026!"}' \
  http://localhost:8080/api/v1/auth/login \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

curl -sS -X POST -H "X-Session-Token: $TOKEN" \
  http://localhost:8080/api/v1/triggers/trigger_1776371663768_8a6c466e/fire
```

### Workflow manual execute
```bash
curl -sS -X POST -H "X-Session-Token: $TOKEN" -d '{}' \
  http://localhost:8080/api/v1/workflows/wf_1776371556902_bd3233fa/execute
```

### Fetch latest log
```bash
curl -sS -H "X-Session-Token: $TOKEN" \
  http://localhost:8080/api/v1/workflows/logs/<LOG_ID>
```

### Chat with t4f-agent directly
```bash
curl -sS -X POST -H "X-Session-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Bugünkü görevleri göster","agentId":"t4f-agent","stream":false}' \
  http://localhost:8080/api/v1/chat
```

### Change cron via UI
`/triggers` → T4F Daily 08:00 kart → Edit dialog → Cron expression / Timezone / Workflow dropdown → Save.

### Disable auto-run
`/triggers` → T4F Daily 08:00 → pause icon. Or SQL: `UPDATE triggers SET enabled=false WHERE id='trigger_1776371663768_8a6c466e'`.

---

## 10. Next Plan (Agreed)

### Yol B (immediate next, ~20 min)
Host `t4f-mcp.service` systemd user unit exposing T4F MCP as `streamable-http` on port 8768. OwnPilot registers in `mcp_servers` table.

Steps:
1. Patch `/home/ayaz/projects/t4f-api-client/src/mcp_server.py` with `argparse --http --host --port`
2. Smoke test host: `python -m src.mcp_server --http --port 8768` + `curl localhost:8768/mcp initialize`
3. `~/.config/systemd/user/t4f-mcp.service` unit file
4. `systemctl --user enable --now t4f-mcp`
5. Register in OwnPilot `mcp_servers` with `transport='streamable-http', url='http://host.docker.internal:8768/mcp'`
6. Restart OwnPilot container → verify MCP `connected` status
7. Test Personal Assistant chat: "bugünkü T4F görevleri" → direct MCP call (no OpenCode spawn, ~2s instead of 33s)

### Yol A (production, after B works, ~45 min)
Docker image `localhost:5000/t4f-mcp:latest` mirroring `voorinfra-mcp-ownpilot/` pattern.

Steps:
1. `cp -r /home/ayaz/projects/voorinfra-mcp-ownpilot /home/ayaz/projects/t4f-mcp-ownpilot`
2. Adapt Dockerfile: base `mcr.microsoft.com/playwright/python:v1.48.0-jammy`, install patchright + project deps
3. Volume mount `browser-profile/` for session persistence
4. `docker build -t localhost:5000/t4f-mcp:latest . && docker push`
5. `docker run -d --name t4f-mcp --restart unless-stopped --shm-size=2g -p 8768:8768 -v t4f_browser_profile:/app/browser-profile localhost:5000/t4f-mcp:latest`
6. Update `mcp_servers` row URL to container
7. Shutdown systemd service from Yol B (Yol A supersedes)

Benefits of Yol A over Yol B:
- No host daemon dependency (container-orchestrated)
- Consistent with existing fleet (voorinfra/evolution/soulforge pattern)
- Isolated dependencies (no venv rot on host upgrades)

---

## 11. Glossary

- **MCP** — Model Context Protocol. JSON-RPC over stdio/SSE/HTTP. Exposes tools/resources/prompts to LLM orchestrators.
- **Agent runtime** — The orchestrator that runs the tool-call loop: LLM → tool_calls → execute via MCP → tool_result → LLM → answer.
- **Bridge** — `openclaw-bridge` on `:9090`. OpenAI-compat HTTP gateway that routes to Claude Code / OpenCode / Codex / Gemini CLIs based on `X-Runtime` header.
- **Local provider** — OwnPilot concept: a non-builtin LLM endpoint registered via the `local_providers` table. Uses openai-compatible adapter.
- **bridge-opencode** — Magic provider name. The `bridge-` prefix triggers `X-Runtime: opencode` auto-injection in the adapter, routing chat through bridge to OpenCode.
- **llmNode** — A type of workflow node. Uses provider resolver + createProvider to call an LLM endpoint. Bypasses custom_tool sandbox restrictions.
- **SSRF block** — Server-Side Request Forgery protection. OwnPilot blocks fetch to private IPs (`127.0.0.1`, `host.docker.internal`→`172.17.0.1`, etc.) from custom_tool sandbox and workflow httpRequest node.
- **Cold start** — First OpenCode spawn takes ~33s (MCP subprocess init, Playwright warm-up). Subsequent spawns within session share less state; bridge may kill on idle.

---

## 12. How This Doc Was Produced

This state doc consolidates:
- Session conversation (40m hot work + 11m UI tour + final consolidation)
- `docker logs` + `docker inspect` + psql query outputs
- Source code reads of ~15 OwnPilot files + 3 bridge docs + 1 T4F MCP doc
- 19 Playwright screenshots
- 4 end-to-end test executions
- ~8 iterations of bug discovery + fix

No code was modified in this PoC. All mutations are DB inserts/updates in the 5 entity tables (local_providers, local_models, agents, workflows, triggers). Rollback is `DELETE` on those 5 rows.

---

*Last updated: 2026-04-16 — PoC complete, Yol B pending.*
