# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OwnPilot is a privacy-first personal AI assistant platform. TypeScript monorepo with Turborepo.

## Architecture

```
packages/
  core/      - Agent engine, tools, plugins, events, sandbox, privacy
  gateway/   - Hono HTTP API server, routes, services, DB, channels, triggers, WebSocket
  ui/        - React 19 + Vite + Tailwind frontend (64 pages, code-split)
  cli/       - Commander.js CLI (bot, config, start, workspace commands)
```

### Key Dependencies

- **Runtime**: Node.js 22+, pnpm 10+
- **Language**: TypeScript 5.9
- **Server**: Hono 4.x
- **Frontend**: React 19, Vite 7, Tailwind CSS 4
- **Testing**: Vitest 4.x
- **Build**: Turborepo 2.x
- **Database**: PostgreSQL via pg adapter

## Commands

### Root Level (Monorepo)

```bash
pnpm install          # Install dependencies
pnpm run build        # Build all packages
pnpm run dev          # Dev mode with hot reload (turbo)
pnpm run test         # Run all tests (turbo)
pnpm run test:watch   # Run tests in watch mode
pnpm run test:coverage # Run tests with coverage
pnpm run lint         # ESLint check
pnpm run lint:fix     # ESLint auto-fix
pnpm run format       # Prettier format
pnpm run format:check # Prettier format check
pnpm run typecheck    # TypeScript type checking
pnpm run clean        # Clean all packages
```

### Package-Specific Commands

```bash
# Gateway (API server)
cd packages/gateway
pnpm run dev                    # Start with hot reload (tsx watch)
pnpm run start                  # Start production server
pnpm run seed                   # Seed database
pnpm run seed:triggers-plans    # Seed triggers and plans
pnpm run migrate:postgres       # Run PostgreSQL migration

# UI (Frontend)
cd packages/ui
pnpm run dev                    # Vite dev server
pnpm run preview                # Preview production build

# Core / CLI
cd packages/core   # or packages/cli
pnpm run dev                    # TypeScript watch mode
```

### Testing Specific Files

```bash
# Run a single test file
pnpm vitest run src/path/to/file.test.ts

# Run tests in a specific package
cd packages/gateway && pnpm vitest run

# Run tests matching a pattern
pnpm vitest run --reporter=verbose -t "pattern"

# Run with coverage for specific package
cd packages/core && pnpm vitest run --coverage
```

## Key Patterns

### API Response Helpers

All API responses use standardized helpers from `packages/gateway/src/routes/helpers.ts`:

```typescript
// Success response
return apiResponse(c, data, status?);

// Error response
return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: '...' }, 404);

// Legacy string error (avoid in new code)
return apiError(c, 'message', 400);
```

### Pagination

Gateway uses `getPaginationParams()` from helpers.ts (returns `{ limit, offset }`):

```typescript
const { limit, offset } = getPaginationParams(c, defaultLimit = 20, maxLimit = 100);
```

Repositories use `StandardQuery` interface and return `PaginatedResult<T>`:

```typescript
// Repository interface
list(query?: StandardQuery): Promise<PaginatedResult<TEntity>>;

// Use buildPaginatedResult() helper
return buildPaginatedResult(items, total, limit, offset);
```

### Event System

Use the typed EventSystem (new API) from `@ownpilot/core/events`:

```typescript
import { getEventSystem } from '@ownpilot/core/events';

const system = getEventSystem();

// Emit events (compile-time checked)
system.emit('agent.complete', 'source', { ... });

// Subscribe to events
system.on('agent.complete', (event) => { ... });

// Hooks
typeof system.hooks.tap('tool:before-execute', handler);

// Scoped bus
const scoped = system.scoped('category', 'source');
```

### Database / Repositories

Repositories extend `BaseRepository` in `packages/gateway/src/db/repositories/base.ts`:

```typescript
export class FooRepository extends BaseRepository implements IRepository<Foo> {
  async list(query?: StandardQuery): Promise<PaginatedResult<Foo>> {
    const { limit, offset } = query ?? {};
    // ... query logic
    return buildPaginatedResult(items, total, limit ?? 50, offset ?? 0);
  }
}
```

### Tool Registration

Tools use dot-prefixed namespaces:
- `core.` - Built-in tools
- `custom.` - User-created tools
- `plugin.{id}.` - Plugin tools
- `skill.{id}.` - Skill tools

Meta-tools (unprefixed) sent to LLM: `search_tools`, `get_tool_help`, `use_tool`, `batch_use_tool`

### User Extensions

Native tool bundles with custom tools, triggers, services. Managed via:
- Service: `packages/gateway/src/services/extension-service.ts`
- DB table: `user_extensions`
- API: `/extensions`

### Testing Patterns

Tests colocated with source (`*.test.ts`). Vitest with globals enabled:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock with hoisted for module-level variables
const { MockClass } = vi.hoisted(() => ({
  MockClass: vi.fn().mockImplementation(function() { ... })
}));

vi.mock('./module.js', () => ({ Class: MockClass }));

// Repository test pattern
beforeEach(() => {
  resetSingleton();  // Clear module singletons
  vi.clearAllMocks();
});
```

## Database Migrations

**Critical**: All migrations must be idempotent (`IF NOT EXISTS` / `IF EXISTS`).

Pattern for new tables:
1. Add `CREATE TABLE IF NOT EXISTS` to `001_initial_schema.sql` (fresh installs)
2. Add same to your migration file (existing installs)

```sql
-- Idempotent table creation
CREATE TABLE IF NOT EXISTS my_table (...);

-- Idempotent column addition
ALTER TABLE my_table ADD COLUMN IF NOT EXISTS new_col TEXT;
```

## Code Conventions

- Barrel exports via `index.ts` in each module
- Route files return Hono app instances
- Tests colocated with source (`*.test.ts`)
- Unused variables prefixed with `_` (ESLint)
- Use `getLog('ModuleName')` for structured logging (not raw console)

## Key Files Reference

| Purpose | Path |
|---------|------|
| API Response Helpers | `packages/gateway/src/routes/helpers.ts` |
| Error Codes | `packages/gateway/src/routes/error-codes.ts` |
| Event System | `packages/core/src/events/index.ts` |
| Base Repository | `packages/gateway/src/db/repositories/base.ts` |
| Repository Interfaces | `packages/gateway/src/db/repositories/interfaces.ts` |
| Tool Registry | `packages/core/src/agent/tools/registry.ts` |
| Plugin System | `packages/core/src/plugins/index.ts` |
| Gateway Config | `packages/gateway/src/config/defaults.ts` |

## System Components

- **Claw Runtime**: Autonomous agents with workspace + tools (`claw-{runner,manager,service}.ts`)
- **Soul Agents**: Heartbeat-driven agents with identity (`soul-*-service.ts`)
- **Subagents**: Fire-and-forget child agents (`subagent-{runner,manager,service}.ts`)
- **Fleet Command**: Worker-based task queue (`fleet-manager.ts`, `fleet-worker.ts`)
- **Workflow System**: 24 node types with executors (`workflow-service.ts`, `node-executors.ts`)
- **Extensions**: User-defined tools/triggers (`extension-service.ts`)
- **Channels**: Telegram + WhatsApp via plugin system (`channels/`)
- **MCP**: Client + server for external tool integration (`mcp-client-*.ts`, `mcp-server.ts`)
