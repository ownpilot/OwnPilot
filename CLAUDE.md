# OwnPilot

Privacy-first personal AI assistant platform. TypeScript monorepo with Turborepo.

## Architecture

```
packages/
  core/      - Agent engine, tools, plugins, events, sandbox, privacy
  gateway/   - Hono HTTP API server, routes, services, DB, channels, triggers, WebSocket
  ui/        - React 19 + Vite + Tailwind frontend (43 routes, code-split)
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
- **Test framework**: Vitest across all packages. 312 test files, 19,200+ tests total (gateway: 192 files, 9,860 tests; core: 109 files, 9,004 tests; ui: 5 files; cli: 4 files; channels: 2 files)

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

- **Runtime**: Node.js 22+, pnpm 9+
- **Language**: TypeScript 5.9
- **Server**: Hono 4.x
- **Frontend**: React 19, Vite, Tailwind CSS
- **Testing**: Vitest 2.x
- **Build**: Turborepo 2.x
- **Linting**: ESLint 9 (flat config), Prettier

## Database

PostgreSQL via pg adapter. Repositories in `packages/gateway/src/db/repositories/`. Adapter abstraction in `packages/gateway/src/db/adapters/`.

## Conventions

- Barrel exports via `index.ts` in each module
- Route files return Hono app instances
- All API responses use `apiResponse`/`apiError` helpers (standardized)
- Tests colocated with source (`*.test.ts`)
- Unused variables prefixed with `_` (ESLint convention)
