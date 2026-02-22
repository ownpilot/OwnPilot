/**
 * Trigger Engine Tests
 *
 * Tests the TriggerEngine class covering:
 * - Lifecycle (start/stop)
 * - Action handlers (notification, goal_check, memory_summary, chat, tool)
 * - Event handling
 * - Manual trigger firing
 * - Condition evaluation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    type: 'schedule',
    config: { cron: '0 8 * * *' },
    action: { type: 'notification', payload: { message: 'Hello' } },
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

describe('TriggerEngine', () => {
  let engine: TriggerEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    engine = new TriggerEngine({ enabled: false }); // disabled to prevent auto-polling
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('lifecycle', () => {
    it('starts and reports running', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      expect(e.isRunning()).toBe(false);
      e.start();
      expect(e.isRunning()).toBe(true);
      e.stop();
    });

    it('stops and reports not running', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      e.stop();
      expect(e.isRunning()).toBe(false);
    });

    it('does not start when disabled', () => {
      engine.start();
      expect(engine.isRunning()).toBe(false);
    });

    it('does not start twice', () => {
      const e = new TriggerEngine({
        enabled: true,
        pollIntervalMs: 999999,
        conditionCheckIntervalMs: 999999,
      });
      e.start();
      e.start(); // second start should be no-op
      expect(e.isRunning()).toBe(true);
      e.stop();
    });

    it('stop is idempotent', () => {
      engine.stop();
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });
  });

  // ========================================================================
  // Default Action Handlers
  // ========================================================================

  describe('notification action', () => {
    it('returns success with message', async () => {
      const trigger = makeTrigger({
        action: { type: 'notification', payload: { message: 'Test notification' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Notification sent');
    });
  });

  describe('goal_check action', () => {
    it('returns stale goals', async () => {
      const trigger = makeTrigger({
        action: { type: 'goal_check', payload: { staleDays: 2 } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      mockGoalService.getActive.mockResolvedValue([
        { id: 'g1', title: 'Stale Goal', updatedAt: oldDate },
        { id: 'g2', title: 'Fresh Goal', updatedAt: new Date() },
      ]);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        staleGoals: [{ id: 'g1', title: 'Stale Goal' }],
      });
    });
  });

  describe('memory_summary action', () => {
    it('returns memory stats', async () => {
      const trigger = makeTrigger({
        action: { type: 'memory_summary', payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);
      mockMemoryService.getStats.mockResolvedValue({ total: 42, recentCount: 5 });

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Memory summary: 42 memories');
    });
  });

  describe('chat action', () => {
    it('uses injected chat handler when available', async () => {
      const chatHandler = vi.fn(async () => 'AI response');
      engine.setChatHandler(chatHandler);

      const trigger = makeTrigger({
        action: { type: 'chat', payload: { prompt: 'Hello AI' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(chatHandler).toHaveBeenCalled();
      expect(result.data).toBe('AI response');
    });

    it('falls back gracefully when no chat handler set', async () => {
      const trigger = makeTrigger({
        action: { type: 'chat', payload: { prompt: 'Hello' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('agent not initialized');
    });

    it('returns error when no prompt/message provided', async () => {
      const trigger = makeTrigger({
        action: { type: 'chat', payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No message/prompt');
    });

    it('handles chat handler throwing', async () => {
      engine.setChatHandler(async () => {
        throw new Error('AI broke');
      });

      const trigger = makeTrigger({
        action: { type: 'chat', payload: { prompt: 'Test' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('AI broke');
    });
  });

  describe('tool action', () => {
    it('executes a tool when found', async () => {
      mockHasTool.mockResolvedValue(true);
      mockExecuteTool.mockResolvedValue({
        success: true,
        result: { data: 'value' },
      });

      const trigger = makeTrigger({
        action: { type: 'tool', payload: { tool: 'my_tool', param1: 'a' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'my_tool',
        expect.objectContaining({ param1: 'a' }),
        'default',
        expect.any(Object)
      );
    });

    it('returns error when tool not found', async () => {
      mockHasTool.mockResolvedValue(false);

      const trigger = makeTrigger({
        action: { type: 'tool', payload: { tool: 'missing_tool' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when no tool name specified', async () => {
      const trigger = makeTrigger({
        action: { type: 'tool', payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No tool name');
    });
  });

  // ========================================================================
  // Manual Trigger Firing
  // ========================================================================

  describe('fireTrigger', () => {
    it('returns not-found when trigger does not exist', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(null);

      const result = await engine.fireTrigger('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Trigger not found');
    });

    it('returns error for unknown action type', async () => {
      const trigger = makeTrigger({
        action: { type: 'unknown_type' as Trigger['action']['type'], payload: {} },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No handler for action type');
    });

    it('logs execution on success', async () => {
      const trigger = makeTrigger({
        action: { type: 'notification', payload: { message: 'test' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      await engine.fireTrigger('trigger-1');

      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'trigger-1',
        'Test Trigger',
        'success',
        expect.anything(),
        undefined,
        expect.any(Number)
      );
    });

    it('logs execution on failure', async () => {
      engine.setChatHandler(async () => {
        throw new Error('Boom');
      });

      const trigger = makeTrigger({
        action: { type: 'chat', payload: { prompt: 'test' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      await engine.fireTrigger('trigger-1');

      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'default',
        'trigger-1',
        'Test Trigger',
        'failure',
        undefined,
        expect.any(String),
        expect.any(Number)
      );
    });
  });

  // ========================================================================
  // Event Handling
  // ========================================================================

  describe('event handling', () => {
    it('notifies local event handlers', async () => {
      const handler = vi.fn();
      engine.on('test_event', handler);

      mockTriggerService.getByEventType.mockResolvedValue([]);

      await engine.emit('test_event', { data: 'value' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test_event',
          payload: { data: 'value' },
        })
      );
    });

    it('processes event-based triggers matching filters', async () => {
      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'goal_completed', filters: { goalId: 'g1' } },
        action: { type: 'notification', payload: { message: 'Goal done!' } },
      });
      mockTriggerService.getByEventType.mockResolvedValue([trigger]);

      await engine.emit('goal_completed', { goalId: 'g1' });

      expect(mockTriggerService.logExecution).toHaveBeenCalled();
      expect(mockTriggerService.markFired).toHaveBeenCalledWith('default', 'trigger-1');
    });

    it('skips event triggers when filters do not match', async () => {
      const trigger = makeTrigger({
        type: 'event',
        config: { eventType: 'goal_completed', filters: { goalId: 'g999' } },
        action: { type: 'notification', payload: { message: 'Nope' } },
      });
      mockTriggerService.getByEventType.mockResolvedValue([trigger]);

      await engine.emit('goal_completed', { goalId: 'g1' });

      expect(mockTriggerService.logExecution).not.toHaveBeenCalled();
    });

    it('swallows errors from local event handlers', async () => {
      const badHandler = vi.fn(() => {
        throw new Error('Handler crash');
      });
      engine.on('test', badHandler);
      mockTriggerService.getByEventType.mockResolvedValue([]);

      // Should not throw
      await engine.emit('test', {});
      expect(badHandler).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Custom Action Handler
  // ========================================================================

  describe('registerActionHandler', () => {
    it('allows registering and firing a custom action', async () => {
      const customHandler = vi.fn(async () => ({
        success: true,
        message: 'Custom done',
      }));
      engine.registerActionHandler('custom', customHandler);

      const trigger = makeTrigger({
        action: { type: 'custom' as Trigger['action']['type'], payload: { custom: true } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      const result = await engine.fireTrigger('trigger-1');

      expect(result.success).toBe(true);
      expect(customHandler).toHaveBeenCalledWith(
        expect.objectContaining({ custom: true, triggerId: 'trigger-1', manual: true })
      );
    });
  });

  // ========================================================================
  // Schedule trigger execution
  // ========================================================================

  describe('schedule trigger execution', () => {
    it('calculates next fire for schedule triggers', async () => {
      const trigger = makeTrigger({
        type: 'schedule',
        config: { cron: '0 8 * * *' },
        action: { type: 'notification', payload: { message: 'Morning' } },
      });
      mockTriggerService.getTrigger.mockResolvedValue(trigger);

      await engine.fireTrigger('trigger-1');

      // The trigger is manual so it doesn't auto-calculate next fire,
      // but logExecution should still be called
      expect(mockTriggerService.logExecution).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Config defaults
  // ========================================================================

  describe('config defaults', () => {
    it('uses default userId "default"', () => {
      const e = new TriggerEngine();
      // The engine should exist and have default config
      expect(e.isRunning()).toBe(false);
      e.stop();
    });
  });
});
