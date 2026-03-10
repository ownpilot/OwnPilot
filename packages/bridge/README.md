# OpenClaw Bridge

**Fastify-based Node.js daemon that acts as an API gateway between external clients (WhatsApp via OpenClaw, MCP tools, curl orchestrators) and Claude Code CLI processes.**

It exposes an OpenAI-compatible `/v1/chat/completions` endpoint and manages Claude Code session lifecycles — spawning, streaming, idle cleanup, pattern detection, and multi-project orchestration.

## Architecture

```
                    WhatsApp / MCP / curl
                           |
                    +------v------+
                    |  index.ts   |  Fastify + CORS + Rate Limit
                    +------+------+
                           |
                    +------v------+
                    |  routes.ts  |  30+ endpoints (REST + SSE)
                    +------+------+
                           |
              +------------+------------+
              v            v            v
        +----------+ +----------+ +------------+
        | router.ts| | commands | | GSD/Orch   |
        | (routing | | (intent  | | Services   |
        |  + GSD   | |  adapter | |            |
        | context) | |  + LLM)  | |            |
        +----+-----+ +----------+ +------------+
             |
      +------v------+
      | claude-     |  Core: Interactive CC process lifecycle
      | manager.ts  |  - spawn CC with --verbose --output-format stream-json
      |             |  - stdin/stdout NDJSON protocol
      |             |  - session tracking, idle timeout, token counting
      |             |  - pattern detection (QUESTION, PHASE_COMPLETE, etc.)
      +------+------+
             |
      +------v------+
      | event-bus.ts|  30+ typed events -> SSE broadcast + replay buffer
      +-------------+
```

## Tech Stack

| Component | Version |
|-----------|---------|
| Fastify | 5.x |
| @anthropic-ai/sdk | 0.78.x |
| @modelcontextprotocol/sdk | 1.27.x |
| Pino (logging) | 9.x |
| Vitest (tests) | 4.x |
| TypeScript | 5.x (stripped at runtime via `--experimental-strip-types`) |

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — set BRIDGE_API_KEY at minimum

# Run (development)
npm run dev

# Run (production)
npm start

# Run tests
npm test
```

### Systemd (production)

```ini
[Service]
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts
Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/sysconfig/openclaw-bridge
```

## Key Subsystems

### 1. Claude Manager (`claude-manager.ts` — the heart)
- Spawns CC as interactive child process (`claude --verbose --output-format stream-json -p`)
- Maintains in-memory session registry (`Map<conversationId, session>`)
- NDJSON stdin/stdout protocol via `stream-parser.ts`
- Pattern detection for blocking states (QUESTION, TASK_BLOCKED)
- Config overrides (model, effort, permission mode)
- Idle timeout (30min default), LRU eviction

### 2. Message Router (`router.ts`)
- 3-tier intent resolution: slash commands -> regex intent -> LLM fallback (MiniMax)
- GSD context injection (system prompt from workflow files)
- Pattern detection post-processing with webhook/SSE notifications

### 3. Command System (`commands/`)
- 14 bridge-handled commands: cost, status, help, clear, compact, doctor, model, rename, diff, fast, effort, resume, context, usage
- Turkish + English keyword matching with normalization
- LLM router fallback for ambiguous messages (MiniMax API)

### 4. GSD Orchestration (`gsd-orchestration.ts`)
- Fire-and-forget trigger -> returns pending state -> async CC execution
- Per-project quota (max 5 concurrent GSD sessions)
- Progress tracking + SSE events

### 5. Orchestration Service (`orchestration-service.ts`)
- 5-stage pipeline: research -> devil's advocate -> plan generation -> execute -> verify
- Parallel research agents, risk scoring, auto-generated plans
- GSD delegation for execute stage

### 6. Multi-Project Orchestrator (`multi-project-orchestrator.ts`)
- Dependency-aware wave scheduling across multiple projects
- Wave-by-wave parallel execution via GSD service
- Failure cascade: failed dependency -> cancel dependents

### 7. Quality Gate + Reflection (`quality-gate.ts`, `reflection-service.ts`)
- 3 automated checks: tests, scope drift, commit quality
- Self-healing: spawn CC fix agent on failure, retry up to 3x
- SSE events for each check/fix/pass/fail

### 8. Circuit Breaker (`circuit-breaker.ts`)
- 3-tier system: global CB + per-project CB registry
- Sliding window, half-open recovery, configurable thresholds

### 9. Worktree Manager (`worktree-manager.ts`)
- Git worktree lifecycle: create/list/merge/remove/prune
- Max 5 per project, automatic branch naming (`bridge/wt-*`)
- Merge conflict detection

### 10. MCP Server (`mcp/`)
- 20 tools exposed via MCP SDK
- Thin HTTP client layer over bridge REST API
- Async spawn support with job store + polling

### 11. Event System (`event-bus.ts`, `event-replay-buffer.ts`)
- 30+ typed events (session, worktree, GSD, orchestration, multi-project, reflect)
- Auto-incrementing event IDs for SSE Last-Event-ID replay
- Wildcard channel for SSE broadcast, max 50 listeners

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ping` | Health ping |
| GET | `/health` | Service health + CB state |
| GET | `/metrics` | Spawn/timing/session metrics |
| GET | `/status` | Authenticated summary |
| POST | `/v1/chat/completions` | OpenAI-compatible chat (SSE/JSON) |
| GET | `/v1/models` | Model listing |
| GET | `/v1/projects` | Per-project session stats |
| GET | `/v1/projects/:dir/sessions` | Session list for project |
| GET | `/v1/metrics/projects` | Per-project resource metrics |
| POST | `/v1/projects/:dir/gsd` | Trigger GSD workflow |
| GET | `/v1/projects/:dir/gsd/status` | GSD session status |
| GET | `/v1/projects/:dir/gsd/progress` | GSD live progress |
| POST | `/v1/projects/:dir/orchestrate` | Orchestration pipeline |
| GET | `/v1/projects/:dir/orchestrate` | Orchestration history |
| POST | `/v1/orchestrate/multi` | Multi-project orchestration |
| POST/GET/DELETE | `/v1/projects/:dir/worktrees` | Worktree CRUD |
| POST | `/v1/sessions/start-interactive` | Start interactive CC |
| POST | `/v1/sessions/:id/input` | Send to interactive CC |
| POST | `/v1/sessions/:id/close-interactive` | Close interactive |
| DELETE | `/v1/sessions/:id` | Terminate session |
| GET | `/v1/notifications/stream` | SSE event stream |
| GET | `/v1/events` | Polling-based event fetch |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BRIDGE_API_KEY` | Yes | — | Bearer token for API auth |
| `PORT` | No | `9090` | Server port |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Default Claude model |
| `CLAUDE_PATH` | No | `~/.local/bin/claude` | Path to Claude CLI binary |
| `ANTHROPIC_API_KEY` | No | — | Optional API key (CC uses OAuth by default) |
| `CC_SPAWN_TIMEOUT_MS` | No | `1800000` | CC process timeout (30min) |
| `CLAUDE_MAX_BUDGET_USD` | No | `5` | Max budget per session |
| `DEFAULT_PROJECT_DIR` | No | — | Default project directory |
| `IDLE_TIMEOUT_MS` | No | `1800000` | Session idle timeout (30min) |
| `MINIMAX_API_KEY` | No | — | MiniMax API key for LLM intent routing |
| `MAX_CONCURRENT_PER_PROJECT` | No | `5` | Max concurrent CC per project |

## Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:e2e      # E2E interactive test
```

1664 tests across 78 files covering unit, integration, e2e, circuit breaker, SSE, worktree, and orchestration scenarios.

## Documentation

| File | Content |
|------|---------|
| [`SETUP-GUIDE.md`](./SETUP-GUIDE.md) | Full setup guide — zero to running system |
| [`docs/RESEARCH-LOG.md`](./docs/RESEARCH-LOG.md) | All research decisions and findings |
| [`docs/LESSONS-LEARNED.md`](./docs/LESSONS-LEARNED.md) | Golden paths, anti-patterns, quick debug |

## License

See [LICENSE](../../LICENSE) in the repository root.
