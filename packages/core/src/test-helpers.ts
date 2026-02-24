/**
 * Shared test helpers for @ownpilot/core
 *
 * Reduces mock duplication across 100+ test files by providing
 * reusable factories for common mocks and test data.
 *
 * IMPORTANT: Because vi.mock() is hoisted to the top of each test file,
 * these helpers are used INSIDE vi.mock factories, not as replacements
 * for vi.mock calls themselves.  The getLog mock factory is the exception:
 * since its shape is identical everywhere, we export the factory object
 * that can be spread directly into a vi.mock return value.
 */

import { vi } from 'vitest';
import type { ILogService } from './services/log-service.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from './agent/types.js';
import type { IProvider } from './agent/provider-types.js';
import type { UserProfile } from './memory/conversation.js';

// ---------------------------------------------------------------------------
// 1. Mock logger — used in 14+ test files
// ---------------------------------------------------------------------------

/**
 * Create a mock ILogService.
 *
 * Every method is a fresh vi.fn(), including `child()` which returns
 * a new mock log (allowing nested child assertions).
 *
 * Usage inside a test file:
 *   import { createMockLog } from '../test-helpers.js';
 *
 *   vi.mock('../services/get-log.js', () => ({
 *     getLog: () => createMockLog(),
 *   }));
 */
export function createMockLog(): ILogService {
  const log: ILogService = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLog()),
  };
  return log;
}

/**
 * Pre-built getLog mock factory object.
 *
 * Usage:
 *   vi.mock('../services/get-log.js', () => GET_LOG_MOCK);
 *
 * This is the simplest form for tests that don't need to assert on
 * individual log calls.
 */
export const GET_LOG_MOCK = {
  getLog: () => createMockLog(),
} as const;

// ---------------------------------------------------------------------------
// 2. Mock tool definition — used in 3+ test files
// ---------------------------------------------------------------------------

/**
 * Create a minimal ToolDefinition for testing.
 *
 * Usage:
 *   const tool = createMockToolDef('read_file');
 *   const tool2 = createMockToolDef('search', 'search');
 */
export function createMockToolDef(name: string, category?: string): ToolDefinition {
  return {
    name,
    description: `Desc for ${name}`,
    parameters: { type: 'object' as const, properties: {} },
    category,
  };
}

// ---------------------------------------------------------------------------
// 3. Mock tool executor — used in orchestrator tests
// ---------------------------------------------------------------------------

/**
 * Create a mock ToolExecutor that resolves with the given result.
 *
 * Usage:
 *   const executor = createMockToolExecutor('ok');
 *   const failExecutor = createMockToolExecutor('error message', true);
 */
export function createMockToolExecutor(result: unknown = 'ok', isError = false): ToolExecutor {
  return vi.fn().mockResolvedValue({ content: result, isError });
}

// ---------------------------------------------------------------------------
// 4. Mock IProvider — used in fallback/agent tests
// ---------------------------------------------------------------------------

/**
 * Create a mock IProvider with all methods stubbed.
 *
 * The `complete` method returns an ok result by default.
 * The `stream` method yields one content chunk then a done chunk.
 *
 * Usage:
 *   const provider = createMockProvider('openai');
 *   const provider2 = createMockProvider('anthropic', { isReady: vi.fn(() => false) });
 */
export function createMockProvider(
  type: string = 'openai',
  overrides: Partial<Record<string, unknown>> = {}
): IProvider & Record<string, unknown> {
  return {
    type,
    isReady: vi.fn().mockReturnValue(true),
    complete: vi.fn().mockResolvedValue({
      ok: true,
      value: { content: `response from ${type}`, usage: {} },
    }),
    stream: vi.fn().mockImplementation(function* () {
      yield { ok: true, value: { content: `chunk-${type}`, done: false } };
      yield { ok: true, value: { content: '', done: true } };
    }),
    countTokens: vi.fn().mockReturnValue(100),
    getModels: vi.fn().mockResolvedValue({ ok: true, value: [`${type}-model`] }),
    cancel: vi.fn(),
    ...overrides,
  } as unknown as IProvider & Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 5. Mock event system — used in orchestrator and plugins tests
// ---------------------------------------------------------------------------

/**
 * Create a mock event system object.
 *
 * Usage inside vi.hoisted():
 *   const mockEventSystem = createMockEventSystem();
 *
 *   vi.mock('../events/index.js', () => ({
 *     getEventSystem: vi.fn(() => mockEventSystem),
 *     getEventBus: vi.fn(() => ({ emit: vi.fn() })),
 *     createEvent: vi.fn((...args) => args),
 *     EventTypes: { ... },
 *   }));
 */
export function createMockEventSystem() {
  return {
    emit: vi.fn(),
    emitRaw: vi.fn(),
    on: vi.fn(() => vi.fn()),
    onAny: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
    off: vi.fn(),
    onCategory: vi.fn(() => vi.fn()),
    onPattern: vi.fn(() => vi.fn()),
    clear: vi.fn(),
    scoped: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
      off: vi.fn(),
      clear: vi.fn(),
    })),
    waitFor: vi.fn(),
    hooks: { tap: vi.fn(), call: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// 6. Mock UserProfile — used in prompt-composer and memory tests
// ---------------------------------------------------------------------------

/**
 * Create a mock UserProfile with sensible defaults.
 *
 * Usage:
 *   const profile = createMockUserProfile({ name: 'Bob' });
 */
export function createMockUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'u1',
    name: 'Alice',
    facts: [],
    preferences: [],
    communicationStyle: undefined,
    interests: [],
    topicsOfInterest: [],
    goals: [],
    relationships: [],
    customInstructions: [],
    lastInteraction: new Date().toISOString(),
    totalConversations: 0,
    completeness: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 7. Mock tool context — used when calling tool executors in tests
// ---------------------------------------------------------------------------

/**
 * Create a minimal ToolContext.
 *
 * Usage:
 *   const ctx = createMockToolContext({ userId: 'user-42' });
 *   await executor(args, ctx);
 */
export function createMockToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: 'call-1',
    conversationId: 'conv-1',
    ...overrides,
  };
}
