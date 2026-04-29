# OwnPilot

Privacy-first personal AI assistant platform. TypeScript monorepo with Turborepo.

## Architecture

```
packages/
  core/      - Agent engine, tools, plugins, events, sandbox, privacy
  gateway/   - Hono HTTP API server, routes, services, DB, channels, triggers, WebSocket
  ui/        - React 19 + Vite + Tailwind frontend (55+ pages, code-split)
  cli/       - Commander.js CLI (bot, config, start, workspace commands)
  channels/  - Channel manager + Telegram bot
```

## Key Patterns

- **Response helpers**: `apiResponse(c, data, status?)` and `apiError(c, message, code, status)` in `packages/gateway/src/routes/helpers.ts`
- **Error codes**: `ERROR_CODES` constants in `packages/gateway/src/routes/helpers.ts`
- **Pagination**: `parsePagination(c)` and `paginatedResponse(c, items, total, page, limit)` helpers
- **Event system**: EventBus, HookBus, ScopedBus in `packages/core/src/events/`
- **Plugin system**: PluginRegistry with isolation, marketplace, runtime in `packages/core/src/plugins/`
- **User Extensions**: Native tool bundles (JS code, triggers, services) in `packages/gateway/src/services/extension-service.ts`. DB table: `user_extensions`. API: `/extensions`
- **Skills (AgentSkills.io)**: Open standard SKILL.md format for agent instructions. Parser: `packages/gateway/src/services/agentskills-parser.ts`. Format field: `'ownpilot' | 'agentskills'`
- **Edge/IoT**: MQTT broker (Mosquitto) integration for edge device management. Types: `packages/core/src/edge/`. Service: `packages/gateway/src/services/edge-service.ts`. Routes: `/api/v1/edge`
- **Test framework**: Vitest across all packages. 389+ test files, 22,100+ tests total (gateway: 239 files, 11,838 tests; core: 127 files, 9,750 tests; ui: 7 files; cli: 8 files; channels: 2 files)

## Commands

```bash
pnpm install          # Install dependencies
pnpm run test         # Run all tests (turbo)
pnpm run build        # Build all packages
pnpm run dev          # Dev mode with hot reload
pnpm run lint         # ESLint check
pnpm run lint:fix     # ESLint auto-fix
pnpm run format       # Prettier format
pnpm run typecheck    # TypeScript type checking
```

## Tech Stack

- **Runtime**: Node.js 22+, pnpm 10+
- **Language**: TypeScript 5.9
- **Server**: Hono 4.x
- **Frontend**: React 19, Vite 7, Tailwind CSS 4
- **Testing**: Vitest 4.x
- **Build**: Turborepo 2.x
- **Linting**: ESLint 10 (flat config), Prettier

## Database

PostgreSQL via pg adapter. Repositories in `packages/gateway/src/db/repositories/`. Adapter abstraction in `packages/gateway/src/db/adapters/`.

## Conventions

- Barrel exports via `index.ts` in each module
- Route files return Hono app instances
- All API responses use `apiResponse`/`apiError` helpers (standardized)
- Tests colocated with source (`*.test.ts`)
- Unused variables prefixed with `_` (ESLint convention)

<!-- dfmt:v1 begin -->
# Context Discipline — REQUIRED

This project uses DFMT to keep large tool outputs from exhausting the
context window. **Read this section at the start of every conversation
in this project.**

## Rule 1 — Prefer DFMT tools over native tools

Always use DFMT's MCP tools when an output might exceed 2 KB:

| Native     | DFMT replacement |
|------------|------------------|
| `Bash`     | `dfmt_exec`      |
| `Read`     | `dfmt_read`      |
| `WebFetch` | `dfmt_fetch`     |
| `Glob`     | `dfmt_glob`      |
| `Grep`     | `dfmt_grep`      |
| `Edit`     | `dfmt_edit`      |
| `Write`    | `dfmt_write`     |

Include an `intent` argument on every call, describing what you need
from the output. The `intent` lets DFMT return the relevant portion of
a large output without flooding the context.

## Rule 2 — On DFMT failure, report and fall back

DFMT is a strong preference, not a hard dependency. If a `dfmt_*` tool
errors, times out, or is unavailable, report the failure to the user
(one short line — which call, what error) and continue with the native
equivalent so the session is not blocked. The ban is on *silent*
fallback — every switch must be announced. After a fallback, drop a
brief `dfmt_remember` note tagged `gap` when practical. If the native
tool is also denied (permission rule, sandbox refusal), stop and ask
the user; do not retry blindly.

## Rule 3 — Record user decisions

When the user states a preference or correction ("use X instead of Y",
"do not modify Z"), call `dfmt_remember` with a `decision` tag so the
choice survives context compaction.

## Why these rules matter

Some agents do not provide hooks to enforce these rules automatically.
**Compliance is your responsibility as the agent.** A single raw shell
output above 8 KB can push earlier context out of the window, erasing
the conversation's history. Following the rules above preserves it.
<!-- dfmt:v1 end -->
