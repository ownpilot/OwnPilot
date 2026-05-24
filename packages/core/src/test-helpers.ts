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
import type { ToolDefinition, ToolExecutor } from './agent/types.js';
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
function createMockLog(): ILogService {
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
// 4. Mock UserProfile — used in prompt-composer and memory tests
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
