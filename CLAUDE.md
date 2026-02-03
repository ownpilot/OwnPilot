# OwnPilot

Privacy-first personal AI assistant platform. TypeScript monorepo with Turborepo.

## Architecture

```
packages/
  core/      - Agent engine, tools, plugins, events, sandbox, privacy (zero external deps goal)
  gateway/   - Hono HTTP API server, routes, services, DB, channels, triggers, WebSocket
  ui/        - React 19 + Vite + Tailwind frontend (40 routes, code-split)
  cli/       - Commander.js CLI (bot, config, start, workspace commands)
  channels/  - Channel manager + Telegram bot
```

## Key Patterns

- **Response helpers**: `apiResponse(c, data, status?)` and `apiError(c, message, code, status)` in `packages/gateway/src/routes/helpers.ts`
- **Error codes**: `ERROR_CODES` constants in `packages/gateway/src/routes/helpers.ts`
- **Pagination**: `parsePagination(c)` and `paginatedResponse(c, items, total, page, limit)` helpers
- **Event system**: EventBus, HookBus, ScopedBus in `packages/core/src/events/`
- **Plugin system**: PluginRegistry with isolation, marketplace, runtime in `packages/core/src/plugins/`
- **Test framework**: Vitest across all packages. Gateway has 66 test files (1507 tests)

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

SQLite via better-sqlite3. Repositories in `packages/gateway/src/db/repositories/`. Data stores abstraction in `packages/gateway/src/db/data-stores.ts`.

## Conventions

- Barrel exports via `index.ts` in each module
- Route files return Hono app instances
- All API responses use `apiResponse`/`apiError` helpers (standardized)
- Tests colocated with source (`*.test.ts`)
- Unused variables prefixed with `_` (ESLint convention)
