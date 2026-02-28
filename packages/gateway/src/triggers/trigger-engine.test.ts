/**
 * Comprehensive TriggerEngine Tests
 *
 * Covers every public and observable behavior of the TriggerEngine class:
 * - Lifecycle (constructor defaults, start, stop, isRunning)
 * - Default action handlers (notification, goal_check, memory_summary, chat, tool)
 * - Custom action handler registration
 * - Event system (on, emit, error isolation)
 * - Schedule trigger processing
 * - Event trigger processing with filter matching
 * - Condition trigger processing with all condition types
 * - Manual trigger firing (fireTrigger)
 * - Execution logging (success/failure paths)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Trigger } from '../db/repositories/triggers.js';

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const mockTriggerService = {
  getDueTriggers: vi.fn(async () => []),
  getByEventType: vi.fn(async () => []),
  getConditionTriggers: vi.fn(async () => []),
  getTrigger: vi.fn(async () => null),
  logExecution: vi.fn(async () => {}),
  markFired: vi.fn(async () => {}),
};

const mockGoalService = {
  getActive: vi.fn(async () => []),
  getUpcoming: vi.fn(async () => []),
};

const mockMemoryService = {
  getStats: vi.fn(async () => ({ total: 0, recentCount: 0, byType: {}, avgImportance: 0 })),
};

const mockServices: Record<string, unknown> = {
  trigger: mockTriggerService,
  goal: mockGoalService,
  memory: mockMemoryService,
};

// Hoisted mock fns — stable references shared between factory and tests
const { mockExecuteTool, mockHasTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
  mockHasTool: vi.fn(),
}));

const mockEventBusUnsub = vi.fn();
const mockEventBusOnPattern = vi.fn().mockReturnValue(mockEventBusUnsub);
const mockEventBusEmit = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: () => ({ get: (token: { name: string }) => mockServices[token.name] }),
    Services: {
      Trigger: { name: 'trigger' },
      Goal: { name: 'goal' },
      Memory: { name: 'memory' },
    },
    getNextRunTime: vi.fn(),
    getEventSystem: () => ({
      onPattern: mockEventBusOnPattern,
      emit: mockEventBusEmit,
      scoped: () => ({ on: vi.fn(), emit: vi.fn() }),
    }),
    createDynamicToolRegistry: vi.fn(() => ({ register: vi.fn(), execute: vi.fn() })),
    ALL_TOOLS: [],
  };
});

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
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

// Must import after mocks are declared
import { TriggerEngine } from './engine.js';
import { getNextRunTime } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trigger-1',
    userId: 'default',
    name: 'Test Trigger',
    description: null,
    type: 'schedule',
    config: { cron: '0 9 * * *' },
    action: { type: 'notification', payload: { message: 'Hello' } },
    enabled: true,
    priority: 5,
    lastFired: null,
    nextFire: null,
    fireCount: 0,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TriggerEngine', () => {
  let engine: TriggerEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Create with disabled=true so constructor does not auto-poll
    engine = new TriggerEngine({ enabled: false });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('lifecycle', () => {
    it('constructor sets default pollIntervalMs to 60000', () => {
      // The default engine is created; start an enabled one and verify
      // the poll interval by checking setInterval was called with 60000
      const e = new TriggerEngine({ enabled: true });
      const spy = vi.spyOn(global, 'setInterval');
      e.start();
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 60000);
      e.stop();
      spy.mockRestore();
    });

    it('constructor sets default conditionCheckIntervalMs to 300000', () => {
      const e = new TriggerEngine({ enabled: true });
      const spy = vi.spyOn(global, 'setInterval');
      e.start();
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 300000);
      e.stop();
      spy.mockRestore();
    });

    it('constructor defaults enabled to true', () => {
      const e = new TriggerEngine();
      e.start();
      expect(e.isRunning()).toBe(true);
      e.stop();
    });

    it('constructor defaults userId to "default"', async () => {
      // Verify by firing a trigger and checking the userId passed to service methods
      const e = new TriggerEngine({ enabled: false });
      const trigger = makeTrigger({
        action: { type: 'notification', payload: { message: 'hi' } },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      await e.fireTrigger('trigger-1');

      expect(mockTriggerService.getTrigger).toHaveBeenCalledWith('default', 'trigger-1');
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'trigger-1',
        'Test Trigger',
        'success',
        expect.anything(),
        undefined,
        expect.any(Number)
      );
      e.stop();
    });

    it('start() sets running to true and starts both intervals', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 50000,
        conditionCheckIntervalMs: 100000,
      });
      expect(e.isRunning()).toBe(false);
      const spy = vi.spyOn(global, 'setInterval');

      e.start();

      expect(e.isRunning()).toBe(true);
      // Two intervals: poll and condition check
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 50000);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 100000);
      e.stop();
      spy.mockRestore();
    });

    it('start() runs initial schedule and condition checks', async () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();

      // Initial checks now await waitForToolSync() — flush microtasks
      await vi.waitFor(() => {
        expect(mockTriggerService.getDueTriggers).toHaveBeenCalledWith('default');
      });
      // getConditionTriggers is called once for the initial condition check
      expect(mockTriggerService.getConditionTriggers).toHaveBeenCalledWith('default');
      e.stop();
    });

    it('stop() sets running to false and clears intervals', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      const clearSpy = vi.spyOn(global, 'clearInterval');

      e.start();
      expect(e.isRunning()).toBe(true);

      e.stop();
      expect(e.isRunning()).toBe(false);
      // Both intervals should be cleared
      expect(clearSpy).toHaveBeenCalledTimes(2);
      clearSpy.mockRestore();
    });

    it('isRunning() returns false before start', () => {
      const e = new TriggerEngine({ enabled: true });
      expect(e.isRunning()).toBe(false);
      e.stop();
    });

    it('isRunning() returns true after start', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      expect(e.isRunning()).toBe(true);
      e.stop();
    });

    it('isRunning() returns false after stop', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      e.stop();
      expect(e.isRunning()).toBe(false);
    });

    it('start() does nothing when disabled', () => {
      // engine was created with enabled: false
      engine.start();
      expect(engine.isRunning()).toBe(false);
      expect(mockTriggerService.getDueTriggers).not.toHaveBeenCalled();
    });

    it('start() does nothing when already running', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      const spy = vi.spyOn(global, 'setInterval');
      e.start();
      const callCount = spy.calls?.length ?? spy.mock.calls.length;
      e.start(); // second call
      // setInterval should not have been called again
      expect(spy.mock.calls.length).toBe(callCount);
      e.stop();
      spy.mockRestore();
    });

    it('stop() is idempotent when not running', () => {
      // Should not throw
      engine.stop();
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });
  });

  // ========================================================================
  // Action Handlers
  // ========================================================================

  describe('action handlers', () => {
    describe('default handlers are registered', () => {
      it('has notification handler', async () => {
        const trigger = makeTrigger({
          action: { type: 'notification', payload: { message: 'Test' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);
        const result = await engine.fireTrigger('trigger-1');
        expect(result.success).toBe(true);
      });

      it('has goal_check handler', async () => {
        const trigger = makeTrigger({
          action: { type: 'goal_check', payload: {} },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);
        const result = await engine.fireTrigger('trigger-1');
        expect(result.success).toBe(true);
      });

      it('has memory_summary handler', async () => {
        const trigger = makeTrigger({
          action: { type: 'memory_summary', payload: {} },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);
        const result = await engine.fireTrigger('trigger-1');
        expect(result.success).toBe(true);
      });

      it('has chat handler', async () => {
        const trigger = makeTrigger({
          action: { type: 'chat', payload: { prompt: 'hello' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);
        const result = await engine.fireTrigger('trigger-1');
        expect(result.success).toBe(true);
      });

      it('has tool handler', async () => {
        mockHasTool.mockResolvedValueOnce(true);
        mockExecuteTool.mockResolvedValueOnce({ success: true, result: 'ok' });

        const trigger = makeTrigger({
          action: { type: 'tool', payload: { tool: 'test_tool' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);
        const result = await engine.fireTrigger('trigger-1');
        expect(result.success).toBe(true);
      });
    });

    describe('notification handler', () => {
      it('returns success with "Notification sent" message', async () => {
        const trigger = makeTrigger({
          action: { type: 'notification', payload: { message: 'Important alert' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Notification sent');
        expect(result.data).toEqual({ message: 'Important alert' });
      });
    });

    describe('goal_check handler', () => {
      it('returns stale goals matching staleDays threshold', async () => {
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Old Goal', updatedAt: fiveDaysAgo },
          { id: 'g2', title: 'Fresh Goal', updatedAt: new Date() },
        ]);

        const trigger = makeTrigger({
          action: { type: 'goal_check', payload: { staleDays: 3 } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Found 1 stale goals');
        expect(result.data).toEqual({ staleGoals: [{ id: 'g1', title: 'Old Goal' }] });
      });

      it('uses default staleDays of 3 when not provided', async () => {
        const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Stale', updatedAt: fourDaysAgo },
        ]);

        const trigger = makeTrigger({
          action: { type: 'goal_check', payload: {} },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ staleGoals: [{ id: 'g1', title: 'Stale' }] });
      });
    });

    describe('memory_summary handler', () => {
      it('returns memory stats with total count in message', async () => {
        mockMemoryService.getStats.mockResolvedValueOnce({
          total: 150,
          recentCount: 10,
          byType: {},
          avgImportance: 0.5,
        });

        const trigger = makeTrigger({
          action: { type: 'memory_summary', payload: {} },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Memory summary: 150 memories');
        expect(result.data).toEqual({
          total: 150,
          recentCount: 10,
          byType: {},
          avgImportance: 0.5,
        });
      });
    });

    describe('chat handler', () => {
      it('calls injected chatHandler when available', async () => {
        const chatFn = vi.fn(async () => 'AI says hello');
        engine.setChatHandler(chatFn);

        const trigger = makeTrigger({
          action: { type: 'chat', payload: { prompt: 'Tell me a joke' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Chat executed');
        expect(result.data).toBe('AI says hello');
        expect(chatFn).toHaveBeenCalledWith(
          'Tell me a joke',
          expect.objectContaining({ prompt: 'Tell me a joke', triggerId: 'trigger-1' })
        );
      });

      it('uses message field as fallback when prompt is absent', async () => {
        const chatFn = vi.fn(async () => 'response');
        engine.setChatHandler(chatFn);

        const trigger = makeTrigger({
          action: { type: 'chat', payload: { message: 'Fallback msg' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(chatFn).toHaveBeenCalledWith(
          'Fallback msg',
          expect.objectContaining({ message: 'Fallback msg' })
        );
      });

      it('falls back to log when no chatHandler is set', async () => {
        const trigger = makeTrigger({
          action: { type: 'chat', payload: { prompt: 'Hello world' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toContain('agent not initialized');
        expect(result.data).toEqual({ prompt: 'Hello world' });
      });

      it('returns error when chatHandler throws', async () => {
        engine.setChatHandler(async () => {
          throw new Error('AI is down');
        });

        const trigger = makeTrigger({
          action: { type: 'chat', payload: { prompt: 'Test' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(false);
        expect(result.error).toBe('AI is down');
      });

      it('returns error when no prompt or message provided', async () => {
        const trigger = makeTrigger({
          action: { type: 'chat', payload: {} },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(false);
        expect(result.error).toContain('No message/prompt');
      });
    });

    describe('tool handler', () => {
      it('calls executeTool when hasTool returns true', async () => {
        mockHasTool.mockResolvedValueOnce(true);
        mockExecuteTool.mockResolvedValueOnce({
          success: true,
          result: { output: 'data' },
        });

        const trigger = makeTrigger({
          action: { type: 'tool', payload: { tool: 'web_search', query: 'vitest' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Tool web_search executed successfully');
        expect(result.data).toEqual({ output: 'data' });
        expect(mockExecuteTool).toHaveBeenCalledWith(
          'web_search',
          expect.objectContaining({ query: 'vitest' }),
          'default',
          expect.any(Object),
          expect.objectContaining({ source: 'trigger' })
        );
      });

      it('strips internal fields from tool args', async () => {
        mockHasTool.mockResolvedValueOnce(true);
        mockExecuteTool.mockResolvedValueOnce({ success: true, result: null });

        const trigger = makeTrigger({
          action: { type: 'tool', payload: { tool: 'my_tool', param: 'value' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        await engine.fireTrigger('trigger-1');

        // executeTool should NOT receive tool, triggerId, triggerName, manual
        const callArgs = mockExecuteTool.mock.calls[0]![1] as Record<string, unknown>;
        expect(callArgs).not.toHaveProperty('tool');
        expect(callArgs).not.toHaveProperty('triggerId');
        expect(callArgs).not.toHaveProperty('triggerName');
        expect(callArgs).not.toHaveProperty('manual');
        expect(callArgs).toHaveProperty('param', 'value');
      });

      it('returns error when hasTool returns false', async () => {
        mockHasTool.mockResolvedValueOnce(false);

        const trigger = makeTrigger({
          action: { type: 'tool', payload: { tool: 'nonexistent_tool' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(false);
        expect(result.error).toContain("'nonexistent_tool' not found");
        expect(mockExecuteTool).not.toHaveBeenCalled();
      });

      it('returns error when no tool name specified', async () => {
        const trigger = makeTrigger({
          action: { type: 'tool', payload: {} },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(false);
        expect(result.error).toContain('No tool name');
      });

      it('returns tool failure result', async () => {
        mockHasTool.mockResolvedValueOnce(true);
        mockExecuteTool.mockResolvedValueOnce({
          success: false,
          result: null,
          error: 'Permission denied',
        });

        const trigger = makeTrigger({
          action: { type: 'tool', payload: { tool: 'restricted_tool' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(false);
        expect(result.message).toBe('Tool restricted_tool failed');
        expect(result.error).toBe('Permission denied');
      });
    });

    describe('registerActionHandler', () => {
      it('adds a custom handler that can be invoked', async () => {
        const customHandler = vi.fn(async (payload: Record<string, unknown>) => ({
          success: true,
          message: `Custom result: ${payload.input}`,
        }));
        engine.registerActionHandler('custom_action', customHandler);

        const trigger = makeTrigger({
          action: {
            type: 'custom_action' as Trigger['action']['type'],
            payload: { input: 'hello' },
          },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Custom result: hello');
        expect(customHandler).toHaveBeenCalledWith(
          expect.objectContaining({ input: 'hello', triggerId: 'trigger-1', manual: true })
        );
      });

      it('overrides an existing handler when registered with same type', async () => {
        const overrideHandler = vi.fn(async () => ({
          success: true,
          message: 'Override notification',
        }));
        engine.registerActionHandler('notification', overrideHandler);

        const trigger = makeTrigger({
          action: { type: 'notification', payload: { message: 'Test' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        const result = await engine.fireTrigger('trigger-1');

        expect(result.message).toBe('Override notification');
        expect(overrideHandler).toHaveBeenCalled();
      });
    });

    describe('setChatHandler', () => {
      it('sets the handler used by chat action', async () => {
        const handler = vi.fn(async () => 'response');
        engine.setChatHandler(handler);

        const trigger = makeTrigger({
          action: { type: 'chat', payload: { prompt: 'test' } },
        });
        mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

        await engine.fireTrigger('trigger-1');

        expect(handler).toHaveBeenCalled();
      });
    });
  });

  // ========================================================================
  // Event System
  // ========================================================================

  describe('event system', () => {
    it('on() registers a handler that receives emitted events', async () => {
      const handler = vi.fn();
      engine.on('test_event', handler);
      mockTriggerService.getByEventType.mockResolvedValueOnce([]);

      await engine.emit('test_event', { key: 'value' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test_event',
          payload: { key: 'value' },
          timestamp: expect.any(Date),
        })
      );
    });

    it('on() supports multiple handlers for the same event type', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      engine.on('my_event', handler1);
      engine.on('my_event', handler2);
      mockTriggerService.getByEventType.mockResolvedValueOnce([]);

      await engine.emit('my_event', {});

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('emit() does not fail when no handlers are registered', async () => {
      mockTriggerService.getByEventType.mockResolvedValueOnce([]);

      // Should not throw
      await engine.emit('unhandled_event', { data: 123 });
    });

    it('emit() calls processEventTriggers for matching event type', async () => {
      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'goal_completed' },
        action: { type: 'notification', payload: { message: 'Done!' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('goal_completed', { goalId: 'g1' });

      expect(mockTriggerService.getByEventType).toHaveBeenCalledWith('default', 'goal_completed');
      expect(mockTriggerService.logExecution).toHaveBeenCalled();
    });

    it('event handler errors are caught and do not crash the engine', async () => {
      const badHandler = vi.fn(() => {
        throw new Error('Handler exploded');
      });
      const goodHandler = vi.fn();
      engine.on('test', badHandler);
      engine.on('test', goodHandler);
      mockTriggerService.getByEventType.mockResolvedValueOnce([]);

      // Should not throw
      await engine.emit('test', {});

      expect(badHandler).toHaveBeenCalled();
      // The good handler still executes after the bad one
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Schedule Triggers
  // ========================================================================

  describe('schedule trigger processing', () => {
    it('processScheduleTriggers gets due triggers and executes each', async () => {
      const trigger1 = makeTrigger({ id: 't1', name: 'Trigger 1' });
      const trigger2 = makeTrigger({ id: 't2', name: 'Trigger 2' });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger1, trigger2]);
      vi.mocked(getNextRunTime).mockReturnValue(new Date('2025-06-01T09:00:00Z'));

      // Start an enabled engine to trigger initial schedule processing
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();

      // Allow microtasks to settle
      await vi.advanceTimersByTimeAsync(0);

      expect(mockTriggerService.getDueTriggers).toHaveBeenCalledWith('default');
      expect(mockTriggerService.logExecution).toHaveBeenCalledTimes(2);
      expect(mockTriggerService.markFired).toHaveBeenCalledTimes(2);
      e.stop();
    });

    it('logs result and calculates next fire time via getNextRunTime after execution', async () => {
      const nextDate = new Date('2025-06-15T08:00:00Z');
      vi.mocked(getNextRunTime).mockReturnValue(nextDate);

      const trigger = makeTrigger({
        id: 'sched-1',
        type: 'schedule',
        config: { cron: '0 8 * * *' },
        action: { type: 'notification', payload: { message: 'Morning' } },
      });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      // logExecution called with 'success'
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'sched-1',
        'Test Trigger',
        'success',
        expect.anything(),
        undefined,
        expect.any(Number)
      );

      // markFired called with calculated next fire time
      expect(mockTriggerService.markFired).toHaveBeenCalledWith(
        'default',
        'sched-1',
        nextDate.toISOString()
      );

      e.stop();
    });

    it('calls markFired with undefined when getNextRunTime returns null', async () => {
      vi.mocked(getNextRunTime).mockReturnValue(null);

      const trigger = makeTrigger({
        id: 'sched-no-next',
        type: 'schedule',
        config: { cron: '0 8 * * *' },
        action: { type: 'notification', payload: { message: 'One-time' } },
      });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockTriggerService.markFired).toHaveBeenCalledWith(
        'default',
        'sched-no-next',
        undefined
      );

      e.stop();
    });

    it('polls on interval for schedule triggers', async () => {
      mockTriggerService.getDueTriggers.mockResolvedValue([]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 10000,
        conditionCheckIntervalMs: 999999,
      });
      e.start();

      // Clear initial call count
      const initialCalls = mockTriggerService.getDueTriggers.mock.calls.length;

      // Advance past one poll interval
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockTriggerService.getDueTriggers.mock.calls.length).toBeGreaterThan(initialCalls);
      e.stop();
    });

    it('handles schedule trigger execution failure gracefully', async () => {
      const trigger = makeTrigger({
        id: 'fail-trigger',
        type: 'schedule',
        config: { cron: '0 8 * * *' },
        action: { type: 'unknown_action' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should log failure, not throw
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'fail-trigger',
        'Test Trigger',
        'failure',
        undefined,
        expect.stringContaining('No handler for action type'),
        expect.any(Number)
      );

      e.stop();
    });
  });

  // ========================================================================
  // Event Triggers
  // ========================================================================

  describe('event trigger processing', () => {
    it('processEventTriggers gets triggers by event type', async () => {
      mockTriggerService.getByEventType.mockResolvedValueOnce([]);

      await engine.emit('memory_added', { memoryId: 'm1' });

      expect(mockTriggerService.getByEventType).toHaveBeenCalledWith('default', 'memory_added');
    });

    it('fires trigger when no filters are set', async () => {
      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'task_created' },
        action: { type: 'notification', payload: { message: 'New task!' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('task_created', { taskId: 't1' });

      expect(mockTriggerService.logExecution).toHaveBeenCalled();
    });

    it('fires trigger when payload matches filter criteria', async () => {
      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'goal_completed', filters: { status: 'completed', userId: 'u1' } },
        action: { type: 'notification', payload: { message: 'Goal done' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('goal_completed', { status: 'completed', userId: 'u1', extra: 'data' });

      expect(mockTriggerService.logExecution).toHaveBeenCalled();
      expect(mockTriggerService.markFired).toHaveBeenCalledWith('default', 'trigger-1');
    });

    it('skips trigger when payload does not match filter criteria', async () => {
      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'goal_completed', filters: { status: 'completed' } },
        action: { type: 'notification', payload: { message: 'Nope' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('goal_completed', { status: 'active' });

      expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
    });

    it('passes event payload merged with action payload', async () => {
      const chatFn = vi.fn(async () => 'ok');
      engine.setChatHandler(chatFn);

      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'data_changed' },
        action: { type: 'chat', payload: { prompt: 'Analyze change' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('data_changed', { changeId: 'c1', field: 'name' });

      expect(chatFn).toHaveBeenCalledWith(
        'Analyze change',
        expect.objectContaining({
          prompt: 'Analyze change',
          changeId: 'c1',
          field: 'name',
          triggerId: 'trigger-1',
          triggerName: 'Test Trigger',
        })
      );
    });

    it('event payload overrides action payload on conflict', async () => {
      const chatFn = vi.fn(async () => 'ok');
      engine.setChatHandler(chatFn);

      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'update' },
        action: { type: 'chat', payload: { prompt: 'action-prompt', source: 'action' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('update', { source: 'event-override' });

      expect(chatFn).toHaveBeenCalledWith(
        'action-prompt',
        expect.objectContaining({ source: 'event-override' })
      );
    });
  });

  // ========================================================================
  // Condition Triggers
  // ========================================================================

  describe('condition trigger processing', () => {
    it('processConditionTriggers gets condition triggers and evaluates each', async () => {
      mockTriggerService.getConditionTriggers.mockResolvedValueOnce([]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockTriggerService.getConditionTriggers).toHaveBeenCalledWith('default');
      e.stop();
    });

    it('respects checkInterval - skips if fired too recently', async () => {
      const recentlyFired = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const trigger = makeTrigger({
        type: 'condition',
        config: { condition: 'stale_goals', checkInterval: 60 }, // 60-min interval
        lastFired: recentlyFired,
        action: { type: 'notification', payload: { message: 'Stale goals' } },
      });
      mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should skip because 10 min < 60 min checkInterval
      expect(mockGoalService.getActive).not.toHaveBeenCalled();
      expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
      e.stop();
    });

    it('fires when checkInterval has elapsed since last fire', async () => {
      const longAgo = new Date(Date.now() - 120 * 60 * 1000); // 120 minutes ago
      const trigger = makeTrigger({
        type: 'condition',
        config: { condition: 'stale_goals', checkInterval: 60, threshold: 1 },
        lastFired: longAgo,
        action: { type: 'notification', payload: { message: 'Check goals' } },
      });
      mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      mockGoalService.getActive.mockResolvedValueOnce([
        { id: 'g1', title: 'Stale', updatedAt: twoDaysAgo },
      ]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockTriggerService.logExecution).toHaveBeenCalled();
      e.stop();
    });

    it('fires when trigger has never been fired (lastFired is null)', async () => {
      const trigger = makeTrigger({
        type: 'condition',
        config: { condition: 'upcoming_deadline', threshold: 7 },
        lastFired: null,
        action: { type: 'notification', payload: { message: 'Deadline approaching' } },
      });
      mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
      mockGoalService.getUpcoming.mockResolvedValueOnce([{ id: 'g1', title: 'Due Soon' }]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockTriggerService.logExecution).toHaveBeenCalled();
      e.stop();
    });

    describe('condition: stale_goals', () => {
      it('fires when goals have not been updated in threshold days', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'stale_goals', threshold: 5 },
          lastFired: null,
          action: { type: 'notification', payload: { message: 'Stale!' } },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

        const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Old Goal', updatedAt: sixDaysAgo },
        ]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });

      it('does not fire when all goals are fresh', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'stale_goals', threshold: 5 },
          lastFired: null,
          action: { type: 'notification', payload: { message: 'Stale!' } },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Fresh Goal', updatedAt: new Date() },
        ]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
        e.stop();
      });

      it('defaults threshold to 3 days when not specified', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'stale_goals' },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

        const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Stale', updatedAt: fourDaysAgo },
        ]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });
    });

    describe('condition: upcoming_deadline', () => {
      it('fires when upcoming goals exist within threshold days', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'upcoming_deadline', threshold: 7 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockGoalService.getUpcoming.mockResolvedValueOnce([{ id: 'g1', title: 'Due Friday' }]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockGoalService.getUpcoming).toHaveBeenCalledWith('default', 7);
        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });

      it('does not fire when no upcoming deadlines', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'upcoming_deadline', threshold: 3 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockGoalService.getUpcoming.mockResolvedValueOnce([]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
        e.stop();
      });

      it('defaults to 7 days when threshold is 0', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'upcoming_deadline', threshold: 0 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockGoalService.getUpcoming.mockResolvedValueOnce([]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockGoalService.getUpcoming).toHaveBeenCalledWith('default', 7);
        e.stop();
      });
    });

    describe('condition: memory_threshold', () => {
      it('fires when memory count meets threshold', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'memory_threshold', threshold: 50 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockMemoryService.getStats.mockResolvedValueOnce({
          total: 75,
          recentCount: 5,
          byType: {},
          avgImportance: 0,
        });

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });

      it('does not fire when memory count is below threshold', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'memory_threshold', threshold: 100 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockMemoryService.getStats.mockResolvedValueOnce({
          total: 50,
          recentCount: 5,
          byType: {},
          avgImportance: 0,
        });

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
        e.stop();
      });

      it('defaults threshold to 100 when not specified', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'memory_threshold' },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockMemoryService.getStats.mockResolvedValueOnce({
          total: 100,
          recentCount: 0,
          byType: {},
          avgImportance: 0,
        });

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });
    });

    describe('condition: low_progress', () => {
      it('fires when active goals have progress below threshold', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'low_progress', threshold: 30 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Behind', progress: 10, updatedAt: new Date() },
        ]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });

      it('does not fire when all goals have sufficient progress', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'low_progress', threshold: 20 },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'On Track', progress: 50, updatedAt: new Date() },
        ]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
        e.stop();
      });

      it('defaults threshold to 20 when not specified', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'low_progress' },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockGoalService.getActive.mockResolvedValueOnce([
          { id: 'g1', title: 'Low', progress: 15, updatedAt: new Date() },
        ]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });
    });

    describe('condition: no_activity', () => {
      it('fires when recentCount is 0', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'no_activity' },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockMemoryService.getStats.mockResolvedValueOnce({
          total: 10,
          recentCount: 0,
          byType: {},
          avgImportance: 0,
        });

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).toHaveBeenCalled();
        e.stop();
      });

      it('does not fire when there is recent activity', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'no_activity' },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);
        mockMemoryService.getStats.mockResolvedValueOnce({
          total: 10,
          recentCount: 5,
          byType: {},
          avgImportance: 0,
        });

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
        e.stop();
      });
    });

    describe('condition: unknown', () => {
      it('returns false for unknown condition type', async () => {
        const trigger = makeTrigger({
          type: 'condition',
          config: { condition: 'nonexistent_condition' },
          lastFired: null,
          action: { type: 'notification', payload: {} },
        });
        mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

        const e = new TriggerEngine({
          enabled: true,
          pollIntervalMs: 999999,
          conditionCheckIntervalMs: 999999,
        });
        e.start();
        await vi.advanceTimersByTimeAsync(0);

        // Condition returns false, so the trigger should NOT execute
        expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
        e.stop();
      });
    });

    it('uses default checkInterval of 60 minutes when not specified', async () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      const trigger = makeTrigger({
        type: 'condition',
        config: { condition: 'no_activity' }, // no checkInterval set
        lastFired: thirtyMinAgo,
        action: { type: 'notification', payload: {} },
      });
      mockTriggerService.getConditionTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      // 30 min < default 60 min interval, so should be skipped
      expect(mockMemoryService.getStats).not.toHaveBeenCalled();
      e.stop();
    });
  });

  // ========================================================================
  // Manual Fire (fireTrigger)
  // ========================================================================

  describe('fireTrigger', () => {
    it('gets trigger by ID and executes the handler', async () => {
      const trigger = makeTrigger({
        id: 'manual-1',
        action: { type: 'notification', payload: { message: 'Manual fire' } },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      const result = await engine.fireTrigger('manual-1');

      expect(mockTriggerService.getTrigger).toHaveBeenCalledWith('default', 'manual-1');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Notification sent');
    });

    it('returns error if trigger not found', async () => {
      mockTriggerService.getTrigger.mockResolvedValueOnce(null);

      const result = await engine.fireTrigger('missing-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Trigger not found');
    });

    it('returns error if no handler for action type', async () => {
      const trigger = makeTrigger({
        action: { type: 'nonexistent_action' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No handler for action type');
    });

    it('includes manual=true in the payload', async () => {
      const customHandler = vi.fn(async () => ({ success: true, message: 'ok' }));
      engine.registerActionHandler('test_action', customHandler);

      const trigger = makeTrigger({
        action: { type: 'test_action' as Trigger['action']['type'], payload: { key: 'val' } },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      await engine.fireTrigger('trigger-1');

      expect(customHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'val',
          triggerId: 'trigger-1',
          triggerName: 'Test Trigger',
          manual: true,
        })
      );
    });

    it('logs execution result on success', async () => {
      const trigger = makeTrigger({
        id: 'log-success',
        action: { type: 'notification', payload: { message: 'test' } },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      await engine.fireTrigger('log-success');

      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'log-success',
        'Test Trigger',
        'success',
        expect.objectContaining({ message: 'test' }),
        undefined,
        expect.any(Number)
      );
    });

    it('logs execution result on failure', async () => {
      engine.setChatHandler(async () => {
        throw new Error('Chat broke');
      });

      const trigger = makeTrigger({
        id: 'log-fail',
        action: { type: 'chat', payload: { prompt: 'test' } },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      const result = await engine.fireTrigger('log-fail');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Chat broke');
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'log-fail',
        'Test Trigger',
        'failure',
        undefined,
        'Chat broke',
        expect.any(Number)
      );
    });

    it('catches handler exceptions and returns error result', async () => {
      engine.registerActionHandler('throwing', async () => {
        throw new Error('Unexpected explosion');
      });

      const trigger = makeTrigger({
        action: { type: 'throwing' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected explosion');
    });

    it('handles non-Error thrown values', async () => {
      engine.registerActionHandler('string_throw', async () => {
        throw 'string error';
      });

      const trigger = makeTrigger({
        action: { type: 'string_throw' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ========================================================================
  // Execution (executeTrigger internal)
  // ========================================================================

  describe('execution details', () => {
    it('success path: logs as "success"', async () => {
      const trigger = makeTrigger({
        id: 'exec-ok',
        type: 'event',
        config: { eventType: 'test' },
        action: { type: 'notification', payload: { message: 'hello' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('test', {});

      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'exec-ok',
        'Test Trigger',
        'success',
        expect.anything(),
        undefined,
        expect.any(Number)
      );
    });

    it('failure path: logs as "failure" with error message', async () => {
      const trigger = makeTrigger({
        id: 'exec-fail',
        type: 'event',
        config: { eventType: 'test' },
        action: { type: 'no_such_handler' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('test', {});

      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'exec-fail',
        'Test Trigger',
        'failure',
        undefined,
        expect.stringContaining('No handler for action type'),
        expect.any(Number)
      );
    });

    it('missing handler throws "No handler" error in executeTrigger', async () => {
      const trigger = makeTrigger({
        id: 'no-handler',
        type: 'event',
        config: { eventType: 'test' },
        action: { type: 'completely_unknown' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('test', {});

      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'no-handler',
        'Test Trigger',
        'failure',
        undefined,
        'No handler for action type: completely_unknown',
        expect.any(Number)
      );
    });

    it('event triggers call markFired without nextFire', async () => {
      const trigger = makeTrigger({
        id: 'evt-mark',
        type: 'event',
        config: { eventType: 'ping' },
        action: { type: 'notification', payload: { message: 'pong' } },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('ping', {});

      // Event triggers call markFired with just userId and triggerId (no nextFire)
      expect(mockTriggerService.markFired).toHaveBeenCalledWith('default', 'evt-mark');
    });

    it('schedule triggers call markFired with next fire time', async () => {
      const nextDate = new Date('2025-12-01T10:00:00Z');
      vi.mocked(getNextRunTime).mockReturnValue(nextDate);

      const trigger = makeTrigger({
        id: 'sched-mark',
        type: 'schedule',
        config: { cron: '0 10 * * *' },
        action: { type: 'notification', payload: { message: 'Scheduled' } },
      });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockTriggerService.markFired).toHaveBeenCalledWith(
        'default',
        'sched-mark',
        nextDate.toISOString()
      );
      e.stop();
    });

    it('merges action payload with event payload, adding triggerId and triggerName', async () => {
      const handler = vi.fn(async () => ({ success: true, message: 'ok' }));
      engine.registerActionHandler('merge_test', handler);

      const trigger = makeTrigger({
        id: 'merge-1',
        name: 'Merge Trigger',
        type: 'event',
        config: { eventType: 'merge_event' },
        action: {
          type: 'merge_test' as Trigger['action']['type'],
          payload: { actionKey: 'actionVal' },
        },
      });
      mockTriggerService.getByEventType.mockResolvedValueOnce([trigger]);

      await engine.emit('merge_event', { eventKey: 'eventVal' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          actionKey: 'actionVal',
          eventKey: 'eventVal',
          triggerId: 'merge-1',
          triggerName: 'Merge Trigger',
        })
      );
    });
  });

  // ========================================================================
  // Custom userId
  // ========================================================================

  describe('custom userId', () => {
    it('passes custom userId to all service calls', async () => {
      const e = new TriggerEngine({ enabled: false, userId: 'user-42' });

      const trigger = makeTrigger({
        id: 'custom-user-trigger',
        action: { type: 'notification', payload: { message: 'hi' } },
      });
      mockTriggerService.getTrigger.mockResolvedValueOnce(trigger);

      await e.fireTrigger('custom-user-trigger');

      expect(mockTriggerService.getTrigger).toHaveBeenCalledWith('user-42', 'custom-user-trigger');
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'user-42',
        'custom-user-trigger',
        'Test Trigger',
        'success',
        expect.anything(),
        undefined,
        expect.any(Number)
      );
      e.stop();
    });
  });

  // ========================================================================
  // calculateNextFire edge cases
  // ========================================================================

  describe('calculateNextFire edge cases', () => {
    it('handles getNextRunTime throwing an error gracefully', async () => {
      vi.mocked(getNextRunTime).mockImplementation(() => {
        throw new Error('Invalid cron');
      });

      const trigger = makeTrigger({
        id: 'bad-cron',
        type: 'schedule',
        config: { cron: 'invalid' },
        action: { type: 'notification', payload: { message: 'test' } },
      });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should still call markFired with undefined (null -> undefined)
      expect(mockTriggerService.markFired).toHaveBeenCalledWith('default', 'bad-cron', undefined);
      e.stop();
    });

    it('handles empty cron expression', async () => {
      vi.mocked(getNextRunTime).mockReturnValue(null);

      const trigger = makeTrigger({
        id: 'empty-cron',
        type: 'schedule',
        config: { cron: '' },
        action: { type: 'notification', payload: { message: 'test' } },
      });
      mockTriggerService.getDueTriggers.mockResolvedValueOnce([trigger]);

      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      await vi.advanceTimersByTimeAsync(0);

      // Empty cron short-circuits, markFired called with undefined
      expect(mockTriggerService.markFired).toHaveBeenCalledWith('default', 'empty-cron', undefined);
      e.stop();
    });
  });
});
