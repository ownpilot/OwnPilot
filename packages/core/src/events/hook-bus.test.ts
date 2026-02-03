/**
 * HookBus Tests
 *
 * Tests for the sequential interceptable hook system:
 * - tap/call with type safety
 * - Priority ordering
 * - Data modification
 * - Cancellation
 * - Error isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookBus } from './hook-bus.js';

describe('HookBus', () => {
  let hooks: HookBus;

  beforeEach(() => {
    hooks = new HookBus();
  });

  // ==========================================================================
  // Basic tap / call
  // ==========================================================================

  describe('tap and call', () => {
    it('calls tapped handler with hook context', async () => {
      const handler = vi.fn();
      hooks.tap('tool:before-execute', handler);

      const result = await hooks.call('tool:before-execute', {
        toolName: 'calculate',
        args: { expression: '2+2' },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.type).toBe('tool:before-execute');
      expect(result.data.toolName).toBe('calculate');
      expect(result.cancelled).toBe(false);
    });

    it('returns context with default values when no handlers', async () => {
      const result = await hooks.call('tool:before-execute', {
        toolName: 'calculate',
        args: {},
      });

      expect(result.type).toBe('tool:before-execute');
      expect(result.cancelled).toBe(false);
      expect(result.metadata).toEqual({});
    });
  });

  // ==========================================================================
  // Priority ordering
  // ==========================================================================

  describe('priority', () => {
    it('executes handlers in priority order (lower first)', async () => {
      const order: number[] = [];

      hooks.tap('tool:before-execute', () => { order.push(2); }, 20);
      hooks.tap('tool:before-execute', () => { order.push(1); }, 10);
      hooks.tap('tool:before-execute', () => { order.push(3); }, 30);

      await hooks.call('tool:before-execute', { toolName: 'test', args: {} });

      expect(order).toEqual([1, 2, 3]);
    });

    it('uses default priority of 10', async () => {
      const order: number[] = [];

      hooks.tap('tool:before-execute', () => { order.push(2); }); // default 10
      hooks.tap('tool:before-execute', () => { order.push(1); }, 5);

      await hooks.call('tool:before-execute', { toolName: 'test', args: {} });

      expect(order).toEqual([1, 2]);
    });
  });

  // ==========================================================================
  // Data modification
  // ==========================================================================

  describe('data modification', () => {
    it('allows handlers to modify context data', async () => {
      hooks.tap('tool:before-execute', (ctx) => {
        ctx.data.args = { ...ctx.data.args, injected: true };
      });

      const result = await hooks.call('tool:before-execute', {
        toolName: 'calculate',
        args: { expression: '2+2' },
      });

      expect(result.data.args).toEqual({ expression: '2+2', injected: true });
    });

    it('passes modified data through the handler chain', async () => {
      hooks.tap('tool:before-execute', (ctx) => {
        (ctx.data.args as Record<string, unknown>).step1 = true;
      }, 10);

      hooks.tap('tool:before-execute', (ctx) => {
        (ctx.data.args as Record<string, unknown>).step2 = true;
        // Verify step1 was already applied
        expect((ctx.data.args as Record<string, unknown>).step1).toBe(true);
      }, 20);

      const result = await hooks.call('tool:before-execute', {
        toolName: 'test',
        args: {},
      });

      expect(result.data.args).toEqual({ step1: true, step2: true });
    });

    it('allows metadata communication between handlers', async () => {
      hooks.tap('tool:before-execute', (ctx) => {
        ctx.metadata.validatedBy = 'security-middleware';
      }, 10);

      hooks.tap('tool:before-execute', (ctx) => {
        expect(ctx.metadata.validatedBy).toBe('security-middleware');
      }, 20);

      const result = await hooks.call('tool:before-execute', {
        toolName: 'test',
        args: {},
      });

      expect(result.metadata.validatedBy).toBe('security-middleware');
    });
  });

  // ==========================================================================
  // Cancellation
  // ==========================================================================

  describe('cancellation', () => {
    it('allows handlers to cancel via context.cancelled', async () => {
      hooks.tap('tool:before-execute', (ctx) => {
        ctx.cancelled = true;
      });

      const result = await hooks.call('tool:before-execute', {
        toolName: 'dangerous-tool',
        args: {},
      });

      expect(result.cancelled).toBe(true);
    });

    it('subsequent handlers still run after cancellation', async () => {
      const secondHandler = vi.fn();

      hooks.tap('tool:before-execute', (ctx) => {
        ctx.cancelled = true;
      }, 10);

      hooks.tap('tool:before-execute', secondHandler, 20);

      await hooks.call('tool:before-execute', {
        toolName: 'test',
        args: {},
      });

      expect(secondHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Async handlers
  // ==========================================================================

  describe('async handlers', () => {
    it('awaits async handlers sequentially', async () => {
      const order: number[] = [];

      hooks.tap('tool:before-execute', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(1);
      }, 10);

      hooks.tap('tool:before-execute', async () => {
        order.push(2);
      }, 20);

      await hooks.call('tool:before-execute', { toolName: 'test', args: {} });

      expect(order).toEqual([1, 2]);
    });
  });

  // ==========================================================================
  // Error isolation
  // ==========================================================================

  describe('error handling', () => {
    it('catches handler errors and continues', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const secondHandler = vi.fn();

      hooks.tap('tool:before-execute', () => {
        throw new Error('handler crashed');
      }, 10);

      hooks.tap('tool:before-execute', secondHandler, 20);

      const result = await hooks.call('tool:before-execute', {
        toolName: 'test',
        args: {},
      });

      expect(secondHandler).toHaveBeenCalledTimes(1);
      expect(result.cancelled).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('catches async handler errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      hooks.tap('tool:before-execute', async () => {
        throw new Error('async crash');
      });

      const result = await hooks.call('tool:before-execute', {
        toolName: 'test',
        args: {},
      });

      expect(result).toBeDefined();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Unsubscribe
  // ==========================================================================

  describe('unsubscribe', () => {
    it('removes handler via returned unsubscribe function', async () => {
      const handler = vi.fn();
      const unsub = hooks.tap('tool:before-execute', handler);

      unsub();

      await hooks.call('tool:before-execute', { toolName: 'test', args: {} });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // tapAny / callAny (escape hatch)
  // ==========================================================================

  describe('tapAny and callAny', () => {
    it('supports dynamic hook names', async () => {
      const handler = vi.fn();
      hooks.tapAny('custom:hook', handler);

      const result = await hooks.callAny('custom:hook', { custom: 'data' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual({ custom: 'data' });
    });
  });

  // ==========================================================================
  // clear()
  // ==========================================================================

  describe('clear', () => {
    it('removes all hook handlers', async () => {
      const handler = vi.fn();
      hooks.tap('tool:before-execute', handler);
      hooks.tapAny('custom:hook', handler);

      hooks.clear();

      await hooks.call('tool:before-execute', { toolName: 'test', args: {} });
      await hooks.callAny('custom:hook', {});

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
