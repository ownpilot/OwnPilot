/**
 * Shared Test Helpers
 *
 * Reusable mock factories and utilities for gateway tests.
 * Reduces duplication of common mock patterns across 200+ test files.
 *
 * Usage:
 *   import { createMockLog, createMockAdapter, ... } from '../test-helpers.js';
 *   // or from deeper paths:
 *   import { createMockLog, createMockAdapter, ... } from '../../test-helpers.js';
 */

import { vi } from 'vitest';

// ============================================================
// Mock Log
// ============================================================

/**
 * Create a mock log object matching the getLog() return type.
 *
 * Replaces the repeated pattern (28+ files):
 *   vi.mock('../../services/log.js', () => ({
 *     getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
 *   }));
 */
export function createMockLog(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ============================================================
// Mock Database Adapter
// ============================================================

/**
 * Create a mock database adapter matching the PostgresAdapter interface.
 *
 * Replaces the repeated pattern (18+ files, ~15 lines each):
 *   const mockAdapter = { type: 'postgres', query: vi.fn(), ... };
 *
 * Two variants are provided:
 * - Non-hoisted (default): methods have default return values.
 *   Good for files that don't need vi.hoisted().
 * - Hoisted: all methods are bare vi.fn() for use with vi.hoisted().
 *   Good for files that reference mockAdapter before vi.mock() resolves.
 */
export function createMockAdapter() {
  return {
    type: 'postgres' as const,
    isConnected: () => true,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
    execute: vi.fn(async () => ({ changes: 1 })),
    transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    exec: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    now: () => 'NOW()',
    date: (col: string) => `DATE(${col})`,
    dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
    placeholder: (i: number) => `$${i}`,
    boolean: (v: boolean) => v,
    parseBoolean: (v: unknown) => Boolean(v),
  };
}

/**
 * Create a mock database adapter suitable for use inside vi.hoisted().
 * All methods are bare vi.fn() — no default return values.
 *
 * Usage:
 *   const mockAdapter = vi.hoisted(() => createMockAdapterHoisted());
 */
export function createMockAdapterHoisted(): Record<string, unknown> {
  return {
    query: vi.fn(),
    queryOne: vi.fn(),
    execute: vi.fn(),
    exec: vi.fn(),
    transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
    isConnected: vi.fn(() => true),
    close: vi.fn(),
    now: vi.fn(() => 'NOW()'),
    date: vi.fn((col: string) => `DATE(${col})`),
    dateSubtract: vi.fn(),
    placeholder: vi.fn((i: number) => `$${i}`),
    boolean: vi.fn((v: boolean) => v),
    parseBoolean: vi.fn((v: unknown) => Boolean(v)),
    type: 'postgres' as const,
  };
}

// ============================================================
// Mock Event Bus
// ============================================================

/**
 * Create a mock event bus matching the getEventBus() return shape.
 *
 * Replaces the repeated pattern (12+ files):
 *   getEventBus: () => ({ emit: mockEmit }),
 */
export function createMockEventBus(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// ============================================================
// Mock @ownpilot/core for Repository Tests
// ============================================================

/**
 * Create the standard @ownpilot/core mock object used by repository tests.
 * Returns the mock emit function so tests can assert on emitted events.
 *
 * Usage:
 *   const mockEmit = vi.hoisted(() => vi.fn());
 *   vi.mock('@ownpilot/core', () => createMockCoreForRepo(mockEmit));
 */
export function createMockCoreForRepo(mockEmit: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return {
    getEventBus: () => ({ emit: mockEmit }),
    createEvent: vi.fn((type: string, category: string, source: string, data: unknown) => ({
      type,
      category,
      source,
      data,
      timestamp: new Date().toISOString(),
    })),
    EventTypes: {
      RESOURCE_CREATED: 'resource.created',
      RESOURCE_UPDATED: 'resource.updated',
      RESOURCE_DELETED: 'resource.deleted',
    },
  };
}

// ============================================================
// Mock Service Registry
// ============================================================

/**
 * Create a mock service registry with named service lookup.
 *
 * Replaces the repeated pattern (20+ files):
 *   getServiceRegistry: vi.fn(() => ({
 *     get: vi.fn((token: { name: string }) => {
 *       const services = { goal: mockGoalService };
 *       return services[token.name];
 *     }),
 *   })),
 *
 * @param services - A map of token name to mock service instance
 */
export function createMockServiceRegistry(services: Record<string, unknown> = {}) {
  return {
    get: vi.fn((token: { name: string }) => services[token.name]),
    has: vi.fn((token: { name: string }) => token.name in services),
  };
}

// ============================================================
// Row Factory Helper
// ============================================================

/**
 * Generic row factory helper for creating database row mocks.
 *
 * Replaces the repeated pattern:
 *   function makeXxxRow(overrides = {}) { return { ...defaults, ...overrides }; }
 *
 * @param defaults - Default values for the row
 * @returns A factory function that merges overrides into defaults
 */
export function createRowFactory<T extends Record<string, unknown>>(defaults: T) {
  return (overrides?: Partial<T>): T => ({ ...defaults, ...overrides }) as T;
}

// ============================================================
// Mock Hono App for Route Tests
// ============================================================

/**
 * Create a test Hono app with standard middleware (requestId, errorHandler, auth).
 *
 * Replaces the repeated pattern in route tests (15+ files):
 *   function createApp() {
 *     const app = new Hono();
 *     app.use('*', requestId);
 *     app.use('*', async (c, next) => { c.set('userId', 'u1'); await next(); });
 *     app.route('/path', routes);
 *     app.onError(errorHandler);
 *     return app;
 *   }
 *
 * NOTE: This cannot be used in files that import Hono lazily (after vi.mock).
 * It's best suited for route test files that import Hono statically.
 *
 * @param routePath - The route path (e.g., '/goals')
 * @param routes - The Hono route instance
 * @param options - Optional configuration
 * @param options.userId - The user ID to set in context (default: 'u1')
 * @param options.skipAuth - Skip the auth middleware (default: false)
 */
export async function createTestApp(
  routePath: string,
  routes: import('hono').Hono,
  options: { userId?: string; skipAuth?: boolean } = {}
) {
  const { Hono } = await import('hono');
  const { requestId } = await import('./middleware/request-id.js');
  const { errorHandler } = await import('./middleware/error-handler.js');

  const app = new Hono();
  app.use('*', requestId);
  if (!options.skipAuth) {
    const userId = options.userId ?? 'u1';
    app.use('*', async (c, next) => {
      c.set('userId', userId);
      await next();
    });
  }
  app.route(routePath, routes);
  app.onError(errorHandler);
  return app;
}
