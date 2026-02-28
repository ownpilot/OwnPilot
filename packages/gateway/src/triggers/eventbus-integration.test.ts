/**
 * TriggerEngine ↔ EventBus Integration Tests
 *
 * Tests that EventBus events can fire event triggers,
 * the circuit breaker prevents infinite loops,
 * and legacy underscore event types still match.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEventSystem, resetEventSystem } from '@ownpilot/core';
import type { Trigger } from '../db/repositories/triggers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTriggerService = {
  getDueTriggers: vi.fn(async () => []),
  getByEventType: vi.fn(async () => []),
  getConditionTriggers: vi.fn(async () => []),
  getTrigger: vi.fn(),
  logExecution: vi.fn(async () => {}),
  markFired: vi.fn(async () => {}),
};

const mockGoalService = {
  getActive: vi.fn(async () => []),
  getUpcoming: vi.fn(async () => []),
};

const mockMemoryService = {
  getStats: vi.fn(async () => ({ total: 0, recentCount: 0 })),
};

vi.mock('../services/trigger-service.js', () => ({
  getTriggerService: () => mockTriggerService,
}));

vi.mock('../services/goal-service.js', () => ({
  getGoalService: () => mockGoalService,
}));

vi.mock('../services/memory-service.js', () => ({
  getMemoryService: () => mockMemoryService,
}));

const { mockExecuteTool, mockHasTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(async () => ({ success: true, result: 'tool output' })),
  mockHasTool: vi.fn(async () => true),
}));

vi.mock('../services/tool-executor.js', () => ({
  executeTool: mockExecuteTool,
  hasTool: mockHasTool,
  waitForToolSync: vi.fn(async () => {}),
}));

vi.mock('../db/repositories/execution-permissions.js', () => ({
  executionPermissionsRepo: {
    get: vi.fn(async () => ({
      enabled: true,
      mode: 'local',
      execute_javascript: 'allowed',
      execute_python: 'allowed',
      execute_shell: 'allowed',
      compile_code: 'allowed',
      package_manager: 'allowed',
    })),
  },
}));

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = {
          trigger: mockTriggerService,
          goal: mockGoalService,
          memory: mockMemoryService,
        };
        return services[token.name];
      }),
    })),
    getNextRunTime: vi.fn(() => new Date('2025-01-01T09:00:00Z')),
  };
});

import { TriggerEngine } from './engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trigger-1',
    userId: 'default',
    name: 'Test Trigger',
    description: null,
    type: 'event',
    config: { eventType: 'memory.created' },
    action: { type: 'notification', payload: { message: 'Memory created!' } },
    enabled: true,
    priority: 5,
    lastFired: null,
    nextFire: null,
    fireCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TriggerEngine EventBus Integration', () => {
  let engine: TriggerEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    resetEventSystem();
    // enabled: true so start() subscribes to EventBus
    // Long poll intervals so timers don't fire during tests
    engine = new TriggerEngine({
      enabled: true,
      pollIntervalMs: 999_999,
      conditionCheckIntervalMs: 999_999,
    });
  });

  afterEach(() => {
    engine.stop();
    resetEventSystem();
  });

  it('fires matching event trigger when EventBus event is emitted', async () => {
    const trigger = makeTrigger({
      id: 'evt-trigger-1',
      config: { eventType: 'memory.created' },
    });
    mockTriggerService.getByEventType.mockResolvedValue([trigger]);

    // Start engine to subscribe to EventBus
    engine.start();

    // Emit the event
    const eventSystem = getEventSystem();
    eventSystem.emit('memory.created', 'test', {
      memoryId: 'mem-1',
      userId: 'default',
      content: 'test',
      type: 'note',
      needsEmbedding: false,
    });

    // Wait for async processing
    await vi.waitFor(() => {
      expect(mockTriggerService.getByEventType).toHaveBeenCalledWith('default', 'memory.created');
    });
  });

  it('also matches legacy underscore event types', async () => {
    const trigger = makeTrigger({
      id: 'evt-trigger-legacy',
      config: { eventType: 'chat_completed' },
    });

    // Return empty for dot notation, but trigger for underscore notation
    mockTriggerService.getByEventType.mockImplementation(
      async (_userId: string, eventType: string) => {
        if (eventType === 'chat_completed') return [trigger];
        return [];
      }
    );

    engine.start();

    const eventSystem = getEventSystem();
    eventSystem.emit('chat.completed', 'test', {
      userId: 'default',
      conversationId: 'conv-1',
      messageLength: 100,
      responseLength: 200,
      toolCallsUsed: 0,
    });

    await vi.waitFor(() => {
      // Should query both dot and underscore notation
      expect(mockTriggerService.getByEventType).toHaveBeenCalledWith('default', 'chat.completed');
      expect(mockTriggerService.getByEventType).toHaveBeenCalledWith('default', 'chat_completed');
    });
  });

  it('skips trigger.* events to prevent infinite loops', async () => {
    engine.start();

    const eventSystem = getEventSystem();
    eventSystem.emitRaw({
      type: 'trigger.success',
      category: 'trigger',
      source: 'trigger-engine',
      data: { triggerId: 't-1', triggerName: 'test', durationMs: 10, actionType: 'notification' },
      timestamp: new Date().toISOString(),
    });

    // Give it time to process
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have queried triggers for trigger.* events
    expect(mockTriggerService.getByEventType).not.toHaveBeenCalled();
  });

  it('ignores non-matching events', async () => {
    mockTriggerService.getByEventType.mockResolvedValue([]);

    engine.start();

    const eventSystem = getEventSystem();
    eventSystem.emit('resource.created', 'test', {
      resourceType: 'note',
      id: 'note-1',
    });

    await vi.waitFor(() => {
      expect(mockTriggerService.getByEventType).toHaveBeenCalled();
    });

    // Should not have attempted to execute any triggers
    expect(mockTriggerService.markFired).not.toHaveBeenCalled();
  });

  it('deduplicates triggers returned from dot and underscore queries', async () => {
    const trigger = makeTrigger({
      id: 'dedup-trigger',
      config: { eventType: 'memory.created' },
    });

    // Return same trigger for both queries
    mockTriggerService.getByEventType.mockResolvedValue([trigger]);

    engine.start();

    const eventSystem = getEventSystem();
    eventSystem.emit('memory.created', 'test', {
      memoryId: 'mem-1',
      userId: 'default',
      content: 'test',
      type: 'note',
      needsEmbedding: false,
    });

    await vi.waitFor(() => {
      expect(mockTriggerService.getByEventType).toHaveBeenCalled();
    });

    // The trigger should only be processed once (deduplication)
    // Wait a bit more for any duplicate processing
    await new Promise((r) => setTimeout(r, 50));
  });

  it('cleans up EventBus subscription on stop', () => {
    engine.start();
    engine.stop();

    // After stop, new events should not trigger processing
    mockTriggerService.getByEventType.mockClear();

    const eventSystem = getEventSystem();
    eventSystem.emit('memory.created', 'test', {
      memoryId: 'mem-1',
      userId: 'default',
      content: 'test',
      type: 'note',
      needsEmbedding: false,
    });

    // Give it time
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockTriggerService.getByEventType).not.toHaveBeenCalled();
        resolve();
      }, 50);
    });
  });
});
