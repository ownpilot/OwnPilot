# Core Package

Shared TypeScript utilities, types, and services for the OwnPilot ecosystem.

## Overview

The core package provides foundational code used across all OwnPilot packages:

- **Type definitions** - Shared TypeScript interfaces and types
- **Utility functions** - Common helpers for validation, formatting, etc.
- **Agent infrastructure** - AI agent tools and execution framework
- **Event system** - Pub/sub event bus for cross-component communication
- **Privacy & security** - PII detection, redaction, and validation
- **Service abstractions** - Interfaces for logging, storage, etc.

## Installation

```bash
# Install from workspace
pnpm add @ownpilot/core
```

## Key Modules

### Agent Tools

Located in `src/agent/tools/`, provides tools that AI agents can execute:

#### Email Tools
```typescript
import { sendEmailExecutor, EMAIL_TOOLS } from '@ownpilot/core';

// Send email (requires nodemailer)
await sendEmailExecutor({
  to: 'user@example.com',
  subject: 'Hello',
  body: 'Email content',
  html: '<p>Email content</p>'
}, context);
```

#### Image Tools
```typescript
import { resizeImageExecutor, IMAGE_TOOLS } from '@ownpilot/core';

// Resize image (requires sharp)
await resizeImageExecutor({
  inputPath: '/path/to/image.jpg',
  outputPath: '/path/to/output.jpg',
  width: 800,
  height: 600,
  fit: 'cover'
}, context);
```

#### PDF Tools
```typescript
import { readPdfExecutor, createPdfExecutor, PDF_TOOLS } from '@ownpilot/core';

// Read PDF (requires pdf-parse)
await readPdfExecutor({
  path: '/path/to/document.pdf',
  pages: '1-5',
  extractTables: true
}, context);

// Create PDF (requires pdfkit)
await createPdfExecutor({
  path: '/path/to/output.pdf',
  content: 'PDF content',
  format: 'markdown',
  title: 'Document Title'
}, context);
```

**Note:** Image and PDF tools have optional dependencies:
- Email tools: `pnpm add nodemailer @types/nodemailer`
- Image tools: `pnpm add sharp`
- PDF tools: `pnpm add pdf-parse pdfkit @types/pdfkit`

### Event System

Pub/sub event bus for decoupled communication:

```typescript
import { createEventBus } from '@ownpilot/core';

const bus = createEventBus();

// Subscribe to events
bus.on('user.created', (event) => {
  console.log('User created:', event.data);
});

// Emit events
await bus.emit('user.created', {
  userId: '123',
  email: 'user@example.com'
});

// Scoped event bus
const userBus = bus.scoped('user');
userBus.on('created', handler); // Listens to 'user.created'
userBus.emit('created', data);  // Emits 'user.created'
```

### Privacy & Security

PII detection and redaction for sensitive data:

```typescript
import {
  PIIDetector,
  PIIRedactor,
  validateEmail,
  validateUrl
} from '@ownpilot/core';

// Detect PII
const detector = new PIIDetector();
const findings = detector.detect('My email is john@example.com');
// findings: [{ type: 'email', value: 'john@example.com', ... }]

// Redact PII
const redactor = new PIIRedactor();
const safe = redactor.redact('My SSN is 123-45-6789');
// safe: 'My SSN is [REDACTED:SSN]'

// Validate inputs
validateEmail('user@example.com');  // throws if invalid
validateUrl('https://example.com'); // throws if invalid
```

### Service Registry

Dependency injection container for services:

```typescript
import {
  createServiceRegistry,
  Services,
  type ILogService
} from '@ownpilot/core';

// Create registry
const registry = createServiceRegistry();

// Register services
const logService: ILogService = {
  debug: (msg, data) => console.debug(msg, data),
  info: (msg, data) => console.log(msg, data),
  warn: (msg, data) => console.warn(msg, data),
  error: (msg, data) => console.error(msg, data),
  child: (name) => createChildLogger(name)
};

registry.register(Services.Log, logService);

// Retrieve services
const log = registry.get(Services.Log);
log.info('Service initialized');
```

### Result Type

Type-safe error handling without exceptions:

```typescript
import { Result, ok, err } from '@ownpilot/core';

function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return err('Division by zero');
  }
  return ok(a / b);
}

const result = divide(10, 2);

if (result.ok) {
  console.log('Result:', result.value); // 5
} else {
  console.error('Error:', result.error);
}

// Transform results
const doubled = result.map(n => n * 2);

// Handle errors
const safe = result.unwrapOr(0);
```

### Branded Types

Type-safe wrappers for primitive types:

```typescript
import { brand, type Brand } from '@ownpilot/core';

type UserId = Brand<string, 'UserId'>;
type Email = Brand<string, 'Email'>;

function getUser(id: UserId) { /* ... */ }

const id = brand<UserId>('user-123');
getUser(id); // ✓ OK

getUser('user-123'); // ✗ TypeScript error
```

### Cost Tracking

Track LLM usage costs across providers:

```typescript
import {
  UsageTracker,
  BudgetManager,
  calculateCost,
  MODEL_PRICING
} from '@ownpilot/core';

// Track usage
const tracker = new UsageTracker();
await tracker.recordUsage({
  provider: 'openai',
  model: 'gpt-4',
  inputTokens: 1000,
  outputTokens: 500,
  userId: 'user-123'
});

// Calculate costs
const cost = calculateCost('openai', 'gpt-4', 1000, 500);
console.log(`Cost: $${cost.toFixed(4)}`);

// Budget management
const budget = new BudgetManager();
await budget.setLimit('user-123', { daily: 10.00 });
const canUse = await budget.checkLimit('user-123', 2.50);
```

### Workspace Management

Isolated containerized execution environments:

```typescript
import {
  WorkspaceOrchestrator,
  getWorkspaceStorage,
  isDockerAvailable
} from '@ownpilot/core';

// Check Docker availability
if (await isDockerAvailable()) {
  // Create orchestrator
  const orchestrator = getOrchestrator({
    userId: 'user-123'
  });

  // Execute code in container
  const result = await orchestrator.executeInContainer(
    'workspace-id',
    'python',
    'print("Hello from container")'
  );
}

// Workspace file storage
const storage = getWorkspaceStorage();
await storage.writeFile('workspace-id', 'file.txt', 'content');
const content = await storage.readFile('workspace-id', 'file.txt');
```

## Type Definitions

### Common Types

```typescript
import type {
  ApiResponse,
  ErrorCode,
  LogLevel,
  ToolDefinition,
  ToolExecutor,
  ToolExecutionResult
} from '@ownpilot/core';

// API Response
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

// Tool Definition
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Tool Executor
type ToolExecutor = (
  params: Record<string, unknown>,
  context?: ToolContext
) => Promise<ToolExecutionResult>;
```

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage

# Type checking
pnpm typecheck
```

### Current Coverage

- **17 test files** covering core utilities
- **367 tests** with 100% pass rate
- **Key modules tested**: Agent tools, event system, privacy, types, crypto

## Development

### Building

```bash
# Build TypeScript
pnpm build

# Watch mode
pnpm build --watch
```

### Project Structure

```
core/
├── src/
│   ├── agent/           # AI agent infrastructure
│   │   ├── tools/       # Tool implementations
│   │   └── memory.ts    # Agent memory system
│   ├── events/          # Event bus system
│   ├── privacy/         # PII detection/redaction
│   ├── crypto/          # Cryptographic utilities
│   ├── services/        # Service interfaces
│   ├── types/           # TypeScript utilities
│   └── index.ts         # Public API exports
└── tests/               # Test files
```

## Best Practices

### ✅ DO

- **Export types** for public APIs
- **Use Result<T, E>** for error handling instead of exceptions
- **Validate inputs** using provided validators
- **Use branded types** for domain-specific primitives
- **Write tests** for all utilities
- **Document optional dependencies** clearly

### ❌ DON'T

- **Don't use `any` type** - use `unknown` and type guards
- **Don't throw exceptions** in library code - return `Result`
- **Don't add heavy dependencies** - keep core lightweight
- **Don't expose internal APIs** - use explicit exports

## Optional Dependencies

Some tools require additional packages:

### Email Tools
```bash
pnpm add nodemailer @types/nodemailer
```

### Image Tools
```bash
pnpm add sharp
```

### PDF Tools
```bash
pnpm add pdf-parse pdfkit @types/pdfkit
```

Tools gracefully handle missing dependencies by returning error results.

## Performance Considerations

### Event Bus

- Use scoped buses for namespacing
- Unsubscribe when no longer needed
- Avoid heavy synchronous handlers

### Memory System

- Set appropriate memory limits
- Use decay for old memories
- Clean up low-importance memories periodically

### Workspace Containers

- Reuse containers when possible
- Set resource limits (CPU, memory)
- Clean up stopped containers

## Security

### Input Validation

Always validate untrusted inputs:

```typescript
import {
  validateEmail,
  validateUrl,
  validateCronExpression
} from '@ownpilot/core';

try {
  validateEmail(userInput);
  validateUrl(urlInput);
  validateCronExpression(cronInput);
} catch (err) {
  // Handle validation error
}
```

### PII Protection

Use redaction for logging sensitive data:

```typescript
import { PIIRedactor } from '@ownpilot/core';

const redactor = new PIIRedactor();
const safeLog = redactor.redact(userMessage);
console.log(safeLog); // PII replaced with [REDACTED:type]
```

### Sandboxed Execution

Use workspace containers for untrusted code:

```typescript
// Execute user code in isolated container
const result = await orchestrator.executeInContainer(
  workspaceId,
  language,
  userCode,
  {
    timeout: 30000,        // 30 second timeout
    maxMemory: '512m',     // Memory limit
    networkAccess: false   // Disable network
  }
);
```

## Contributing

### Code Style

- TypeScript strict mode enabled
- ESLint for code quality
- Comprehensive JSDoc for public APIs

### Pull Request Checklist

- [ ] Tests added/updated
- [ ] TypeScript compilation passes
- [ ] All tests pass
- [ ] Public APIs documented
- [ ] Breaking changes noted
- [ ] Optional dependencies documented

## Versioning

Follows Semantic Versioning (SemVer):

- **MAJOR**: Breaking API changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
- [Hono Framework](https://hono.dev/) (used in gateway)

## License

See root package LICENSE file.
