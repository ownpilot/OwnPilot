# Contributing to OwnPilot

Thank you for your interest in contributing to OwnPilot! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0
- **PostgreSQL** 16+ (via Docker recommended: `docker compose --profile postgres up -d`)
- **Docker** (optional, for sandbox code execution)

### Getting Started

```bash
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install
cp .env.example .env
# Edit .env with your PostgreSQL connection details
pnpm dev
```

## Coding Standards

### General

- **Language**: All code, comments, commit messages, and documentation must be in **English**.
- **TypeScript**: Strict mode enabled. Use proper types — avoid `any`.
- **Formatting**: Prettier 3.8 — run `pnpm format` before committing.
- **Linting**: ESLint 10 flat config — run `pnpm lint` before committing.
- **Pre-commit hooks**: Husky runs lint + typecheck automatically.

### Key Patterns

- **API responses**: Always use `apiResponse(c, data, status?)` and `apiError(c, message, code, status)` from `packages/gateway/src/routes/helpers.ts`.
- **Error codes**: Use constants from `ERROR_CODES` in helpers.ts.
- **Logging**: Use `getLog('ModuleName')` — never use raw `console.*` in production code.
- **Error handling**: Use `Result<T, E>` pattern for functional error handling in core.
- **Repository pattern**: All database access goes through repository classes extending `BaseRepository`.
- **Service registry**: Use typed `ServiceToken` for dependency injection.
- **Barrel exports**: Each module directory has an `index.ts` re-exporting public APIs.
- **Unused variables**: Prefix with `_` (e.g., `_unusedParam`).

### File Organization

- Route files return Hono app instances.
- Tests are colocated with source files (`*.test.ts`).
- Prefer editing existing files over creating new ones.

## Testing

We use **Vitest 2.x** across all packages. The test suite contains **307 test files** with **19,200+ tests**.

| Package    | Test Files | Tests  |
| ---------- | ---------- | ------ |
| `gateway`  | 188        | 9,800+ |
| `core`     | 109        | 9,000+ |
| `ui`       | 5          | 51     |
| `cli`      | 4          | ~50    |
| `channels` | 2          | ~20    |

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage reports

# Run tests for a specific package
pnpm --filter @ownpilot/gateway test
pnpm --filter @ownpilot/core test
```

### Writing Tests

- Every new feature or bug fix should include tests.
- Mock external dependencies — never call real APIs in tests.
- Clear module-level caches in `beforeEach` to avoid test pollution.
- Use `vi.mock()` with `importOriginal` when you need to preserve some exports.

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Implement** your changes following the coding standards above.
3. **Test** — ensure all existing tests pass and add new tests for your changes.
4. **Lint & Format** — run `pnpm lint` and `pnpm format:check`.
5. **TypeCheck** — run `pnpm typecheck`.
6. **Commit** with a descriptive message following the conventions below.
7. **Open a PR** against `main` with a clear description of the changes.

### CI Checks

All PRs must pass:

- Build (`pnpm build`)
- TypeCheck (`pnpm typecheck`)
- Lint (`pnpm lint`)
- Tests (`pnpm test`)
- Format Check (`pnpm format:check`)

## Commit Message Conventions

Use conventional commit prefixes:

| Prefix      | Usage                                            |
| ----------- | ------------------------------------------------ |
| `feat:`     | New feature                                      |
| `fix:`      | Bug fix                                          |
| `test:`     | Adding or updating tests                         |
| `docs:`     | Documentation changes                            |
| `chore:`    | Build, CI, dependency updates                    |
| `refactor:` | Code changes that don't fix bugs or add features |
| `style:`    | Formatting, whitespace changes                   |
| `perf:`     | Performance improvements                         |

Examples:

```
feat: Add webhook trigger support
fix: Resolve memory leak in embedding queue
test: Add unit tests for approval manager TTL
docs: Update deployment instructions for Docker
```

## Reporting Issues

- Use [GitHub Issues](https://github.com/ownpilot/ownpilot/issues) for bug reports and feature requests.
- For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

By contributing to OwnPilot, you agree that your contributions will be licensed under the [MIT License](LICENSE).
