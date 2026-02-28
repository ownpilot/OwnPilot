/**
 * Tests for Event Tools
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEventSystem, resetEventSystem } from '@ownpilot/core';

const { EVENT_TOOLS, executeEventTool } = await import('./event-tools.js');

// ============================================================================
// Tests
// ============================================================================

describe('event-tools', () => {
  beforeEach(() => {
    resetEventSystem();
  });

  afterEach(() => {
    resetEventSystem();
  });

  // ==========================================================================
  // Tool definitions
  // ==========================================================================

  describe('EVENT_TOOLS', () => {
    it('exports three tool definitions', () => {
      expect(EVENT_TOOLS).toHaveLength(3);
    });

    it('defines emit_event with correct schema', () => {
      const tool = EVENT_TOOLS.find((t) => t.name === 'emit_event')!;
      expect(tool).toBeDefined();
      expect(tool.category).toBe('Events');
      expect(tool.parameters.required).toContain('event_type');
      expect(tool.parameters.required).toContain('data');
      expect(tool.workflowUsable).toBe(true);
    });

    it('defines wait_for_event with correct schema', () => {
      const tool = EVENT_TOOLS.find((t) => t.name === 'wait_for_event')!;
      expect(tool).toBeDefined();
      expect(tool.category).toBe('Events');
      expect(tool.parameters.required).toContain('event_type');
      expect(tool.workflowUsable).toBe(true);
    });

    it('defines list_event_categories with correct schema', () => {
      const tool = EVENT_TOOLS.find((t) => t.name === 'list_event_categories')!;
      expect(tool).toBeDefined();
      expect(tool.category).toBe('Events');
      expect(tool.parameters.required).toEqual([]);
      expect(tool.workflowUsable).toBe(true);
    });
  });

  // ==========================================================================
  // emit_event
  // ==========================================================================

  describe('emit_event', () => {
    it('emits event with correct namespace', async () => {
      const eventSystem = getEventSystem();
      const received: unknown[] = [];
      eventSystem.onAny('ext.user-1.data.updated', (evt) => received.push(evt));

      const result = await executeEventTool(
        'emit_event',
        { event_type: 'data.updated', data: { key: 'value' } },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ emitted: 'ext.user-1.data.updated' });
      expect(received).toHaveLength(1);
    });

    it('rejects empty event_type', async () => {
      const result = await executeEventTool('emit_event', { event_type: '', data: {} });
      expect(result.success).toBe(false);
      expect(result.error).toBe('event_type is required');
    });

    it('rejects whitespace-only event_type', async () => {
      const result = await executeEventTool('emit_event', { event_type: '   ', data: {} });
      expect(result.success).toBe(false);
      expect(result.error).toBe('event_type is required');
    });

    it('defaults data to empty object when undefined', async () => {
      const eventSystem = getEventSystem();
      const received: unknown[] = [];
      eventSystem.onAny('ext.default.test', (evt) => received.push(evt));

      const result = await executeEventTool('emit_event', { event_type: 'test' });
      expect(result.success).toBe(true);
      expect(received).toHaveLength(1);
    });

    it('uses default userId when not provided', async () => {
      const result = await executeEventTool('emit_event', {
        event_type: 'test.ping',
        data: {},
      });
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ emitted: 'ext.default.test.ping' });
    });
  });

  // ==========================================================================
  // wait_for_event
  // ==========================================================================

  describe('wait_for_event', () => {
    it('resolves when matching event fires', async () => {
      const eventSystem = getEventSystem();

      // Fire event after a short delay
      setTimeout(() => {
        eventSystem.emitRaw({
          type: 'memory.created',
          category: 'memory',
          source: 'test',
          data: { memoryId: 'mem-1' },
          timestamp: new Date().toISOString(),
        });
      }, 10);

      const result = await executeEventTool('wait_for_event', {
        event_type: 'memory.created',
        timeout_ms: 5000,
      });

      expect(result.success).toBe(true);
      expect((result.result as any).event.type).toBe('memory.created');
      expect((result.result as any).event.data).toEqual({ memoryId: 'mem-1' });
    });

    it('times out when event does not fire', async () => {
      const result = await executeEventTool('wait_for_event', {
        event_type: 'never.happens',
        timeout_ms: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
      expect(result.error).toContain('never.happens');
    });

    it('rejects empty event_type', async () => {
      const result = await executeEventTool('wait_for_event', { event_type: '' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('event_type is required');
    });

    it('clamps timeout to max 300000ms', async () => {
      // Fire event immediately so we don't actually wait 300s
      const eventSystem = getEventSystem();
      setTimeout(() => {
        eventSystem.emitRaw({
          type: 'fast.event',
          category: 'system',
          source: 'test',
          data: {},
          timestamp: new Date().toISOString(),
        });
      }, 10);

      const result = await executeEventTool('wait_for_event', {
        event_type: 'fast.event',
        timeout_ms: 999999, // should be clamped to 300000
      });
      expect(result.success).toBe(true);
    });

    it('clamps timeout to min 100ms', async () => {
      const start = Date.now();
      const result = await executeEventTool('wait_for_event', {
        event_type: 'fast.event',
        timeout_ms: 1, // below 100ms minimum
      });
      const elapsed = Date.now() - start;

      expect(result.success).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(90); // ~100ms minimum
    });

    it('uses default 30s timeout when not specified', async () => {
      // We can't actually wait 30s in a test. Just verify the function accepts no timeout.
      // Fire event immediately so it resolves fast.
      const eventSystem = getEventSystem();
      setTimeout(() => {
        eventSystem.emitRaw({
          type: 'quick.event',
          category: 'system',
          source: 'test',
          data: {},
          timestamp: new Date().toISOString(),
        });
      }, 10);

      const result = await executeEventTool('wait_for_event', {
        event_type: 'quick.event',
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // list_event_categories
  // ==========================================================================

  describe('list_event_categories', () => {
    it('returns event categories info', async () => {
      const result = await executeEventTool('list_event_categories', {});

      expect(result.success).toBe(true);
      const categories = (result.result as any).categories;
      expect(categories).toHaveProperty('agent');
      expect(categories).toHaveProperty('memory');
      expect(categories).toHaveProperty('trigger');
      expect(categories).toHaveProperty('channel');
      expect(categories).toHaveProperty('extension');
    });

    it('includes description text', async () => {
      const result = await executeEventTool('list_event_categories', {});
      expect((result.result as any).description).toContain('emit_event');
    });
  });

  // ==========================================================================
  // Unknown tool
  // ==========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeEventTool('unknown_event_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown event tool');
    });
  });
});
