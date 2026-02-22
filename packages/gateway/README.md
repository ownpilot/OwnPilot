# Gateway Package

The API gateway for OwnPilot - a unified REST API built with [Hono](https://hono.dev/) providing access to all OwnPilot services.

## Overview

The gateway serves as the central entry point for all client applications (UI, CLI, mobile) providing:

- **RESTful API endpoints** for all OwnPilot features
- **Authentication & authorization** via JWT/API keys
- **Request/response standardization** with consistent error handling
- **Database access layer** with repositories pattern
- **Service orchestration** coordinating business logic across domains

## Architecture

```
gateway/
├── src/
│   ├── server.ts           # Main server entry point
│   ├── routes/             # API route handlers
│   │   ├── helpers.ts      # Shared utilities (pagination, responses)
│   │   ├── error-codes.ts  # Centralized error codes
│   │   └── *.ts            # Domain-specific routes
│   ├── services/           # Business logic layer
│   ├── db/                 # Database layer
│   │   └── repositories/   # Data access objects
│   ├── middleware/         # HTTP middleware
│   └── types/              # TypeScript definitions
└── tests/                  # Test files
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Development server with hot reload
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Type checking
pnpm typecheck
```

## API Response Format

All API responses follow a standardized format:

### Success Response

```typescript
{
  success: true,
  data: T,                    // Response payload
  meta: {
    requestId: string,        // Unique request identifier
    timestamp: string         // ISO 8601 timestamp
  }
}
```

### Error Response

```typescript
{
  success: false,
  error: {
    code: string,             // Error code (see ERROR_CODES)
    message: string           // Human-readable error message
  },
  meta: {
    requestId: string,
    timestamp: string
  }
}
```

## Helper Functions

The gateway provides utility functions in `routes/helpers.ts`:

### `getUserId(c: Context): string`

Extracts authenticated user ID from request context.

**Resolution order:**

1. Auth middleware (`c.get('userId')`)
2. Query parameter (`?userId=...`)
3. Fallback: `'default'`

### `getPaginationParams(c, defaultLimit?, maxLimit?)`

Parses pagination parameters with bounds validation.

```typescript
const { limit, offset } = getPaginationParams(c, 20, 100);
// limit: min=1, max=100, default=20
// offset: min=0, default=0
```

### `getIntParam(c, name, defaultValue, min?, max?)`

Parses integer query parameter with optional bounds.

```typescript
const days = getIntParam(c, 'days', 30, 1, 365);
// Ensures: 1 <= days <= 365, defaults to 30
```

### `apiResponse<T>(c, data, status?)`

Creates standardized success response.

```typescript
return apiResponse(c, { users }, 201);
```

### `apiError(c, error, status?)`

Creates standardized error response.

```typescript
// Simple string error
return apiError(c, 'Invalid input', 400);

// Structured error
return apiError(
  c,
  {
    code: ERROR_CODES.NOT_FOUND,
    message: 'Resource not found',
  },
  404
);
```

## Error Codes

Centralized error codes in `routes/error-codes.ts`:

### Common Codes

- `NOT_FOUND` - Resource not found (404)
- `INVALID_REQUEST` - Invalid request payload (400)
- `ACCESS_DENIED` - Insufficient permissions (403)
- `ALREADY_RUNNING` - Operation in progress (409)
- `ERROR` - Generic error (500)

See `error-codes.ts` for the complete list of 90+ error codes organized by category.

## Route Development

### Creating a New Route

1. **Create route file** in `src/routes/`:

```typescript
import { Hono } from 'hono';
import { getUserId, apiResponse, apiError, getIntParam } from './helpers.js';
import { ERROR_CODES } from './error-codes.js';
import { getLog } from '../services/log.js';

const log = getLog('MyFeature');
export const myFeatureRoutes = new Hono();

myFeatureRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  try {
    const data = await fetchData(userId, limit);
    log.info('Data fetched', { userId, count: data.length });
    return apiResponse(c, { items: data });
  } catch (err) {
    log.error('Fetch failed', { userId, error: err.message });
    return apiError(
      c,
      {
        code: ERROR_CODES.ERROR,
        message: 'Failed to fetch data',
      },
      500
    );
  }
});
```

2. **Register route** in `src/server.ts`:

```typescript
import { myFeatureRoutes } from './routes/my-feature.js';

app.route('/my-feature', myFeatureRoutes);
```

3. **Add tests** in `src/routes/my-feature.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { myFeatureRoutes } from './my-feature.js';

describe('MyFeature Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/my-feature', myFeatureRoutes);
  });

  it('should return data', async () => {
    const res = await app.request('/my-feature');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
```

## Best Practices

### ✅ DO

- **Use helper functions** (`apiResponse`, `apiError`, `getIntParam`) for consistency
- **Use centralized error codes** from `ERROR_CODES` constant
- **Add structured logging** with contextual data (userId, IDs, status)
- **Validate inputs** with bounds checking for pagination/limits
- **Write tests** for all new routes
- **Document complex logic** with inline comments

### ❌ DON'T

- **Don't use inline `c.json()`** - use `apiResponse`/`apiError` helpers
- **Don't hardcode error codes** - use `ERROR_CODES` constant
- **Don't use `any` type** without documenting why
- **Don't skip input validation** - always validate user inputs
- **Don't commit without tests** - maintain test coverage

## Database Access

Use repository pattern for database operations:

```typescript
import { MyRepository } from '../db/repositories/my-repo.js';

const repo = new MyRepository(userId);
const items = await repo.list({ limit, offset });
```

## Logging

Use structured logging for observability:

```typescript
import { getLog } from '../services/log.js';

const log = getLog('ModuleName');

// Info logging
log.info('Operation completed', {
  userId,
  itemId,
  count: results.length,
});

// Error logging
log.error('Operation failed', {
  userId,
  error: err.message,
});

// Warning logging
log.warn('Validation failed', {
  userId,
  field: 'email',
});
```

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test my-feature.test.ts

# Watch mode
pnpm test --watch

# Coverage report
pnpm test --coverage
```

### Test Organization

- **Unit tests**: Route handlers, utilities, helpers
- **Integration tests**: Service interactions, database operations
- **Test files**: Co-located with source files (`*.test.ts`)

### Current Coverage

- **58 test files** covering route handlers and utilities
- **1227 tests** with 100% pass rate
- **Key modules tested**: helpers, error-codes, memories, goals, plans

## Performance

### Pagination Best Practices

- Always use bounded pagination with `getIntParam` or `getPaginationParams`
- Default limit: 20, typical max: 100-1000 depending on resource
- Prevents DoS via excessive pagination requests

### Caching

- Use service-level caching for expensive operations
- Cache keys should include userId for isolation

## Security

### Input Validation

- **Always validate** user inputs
- **Use bounds checking** for numeric parameters
- **Whitelist patterns** for string inputs (see calc_evaluate security example)
- **Sanitize** file paths and SQL inputs

### Authentication

- Routes are protected via middleware
- Use `getUserId(c)` to get authenticated user
- Test endpoints support `?userId=...` query parameter

## API Documentation

### Base URL

```
http://localhost:8080
```

### Authentication

Include JWT token in Authorization header:

```
Authorization: Bearer <token>
```

### Common Query Parameters

| Parameter | Type    | Description               | Default   |
| --------- | ------- | ------------------------- | --------- |
| `limit`   | integer | Max items to return       | 20        |
| `offset`  | integer | Skip N items              | 0         |
| `userId`  | string  | User identifier (testing) | 'default' |

### Key Endpoints

- `/memories` - Persistent AI memory management
- `/goals` - Goal tracking and management
- `/plans` - Autonomous plan execution
- `/triggers` - Proactive trigger configuration
- `/chat` - Chat session management
- `/tools` - Custom tool management
- `/workspaces` - Isolated workspace operations

See individual route files for detailed endpoint documentation.

## Contributing

### Code Style

- TypeScript strict mode enabled
- ESLint configuration for code quality
- Prettier for formatting (if configured)

### Commit Guidelines

```bash
# Format: <type>: <description>
feat: Add new memory search endpoint
fix: Correct pagination bounds in goals route
refactor: Extract pagination helpers
test: Add comprehensive helpers test suite
docs: Update gateway README
```

### Pull Request Checklist

- [ ] Tests added/updated
- [ ] TypeScript compilation passes (`pnpm typecheck`)
- [ ] All tests pass (`pnpm test`)
- [ ] Error handling uses `ERROR_CODES`
- [ ] Responses use `apiResponse`/`apiError` helpers
- [ ] Logging added for key operations
- [ ] Documentation updated if needed

## Troubleshooting

### Common Issues

**Port already in use**

```bash
# Change port in server.ts or set environment variable
PORT=8081 pnpm dev
```

**Database connection errors**

```bash
# Check database configuration in environment
DATABASE_URL=postgresql://...
```

**TypeScript errors**

```bash
# Rebuild and check types
pnpm build
pnpm typecheck
```

## Resources

- [Hono Documentation](https://hono.dev/)
- [Vitest Testing Framework](https://vitest.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## License

See root package LICENSE file.
