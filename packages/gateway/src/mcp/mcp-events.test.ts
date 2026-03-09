/**
 * MCP Tool Call Event Bus Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitMcpToolEvent, onMcpToolEvents, type McpToolEvent } from './mcp-events.js';

describe('MCP Event Bus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should deliver events to subscribers with matching correlationId', () => {
    const handler = vi.fn();
    const unsub = onMcpToolEvents('corr-1', handler);

    const event: McpToolEvent = {
      type: 'tool_start',
      correlationId: 'corr-1',
      toolName: 'add_task',
      arguments: { title: 'Test' },
      timestamp: new Date().toISOString(),
    };
    emitMcpToolEvent(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);

    unsub();
  });

  it('should NOT deliver events to subscribers with different correlationId', () => {
    const handler = vi.fn();
    const unsub = onMcpToolEvents('corr-2', handler);

    emitMcpToolEvent({
      type: 'tool_start',
      correlationId: 'corr-1',
      toolName: 'add_task',
      timestamp: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();

    unsub();
  });

  it('should unsubscribe correctly', () => {
    const handler = vi.fn();
    const unsub = onMcpToolEvents('corr-3', handler);

    emitMcpToolEvent({
      type: 'tool_start',
      correlationId: 'corr-3',
      toolName: 'list_tasks',
      timestamp: new Date().toISOString(),
    });
    expect(handler).toHaveBeenCalledOnce();

    unsub();

    emitMcpToolEvent({
      type: 'tool_end',
      correlationId: 'corr-3',
      toolName: 'list_tasks',
      result: { success: true, preview: '[]', durationMs: 5 },
      timestamp: new Date().toISOString(),
    });
    expect(handler).toHaveBeenCalledOnce(); // still 1
  });

  it('should support multiple subscribers for the same correlationId', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub1 = onMcpToolEvents('corr-4', handler1);
    const unsub2 = onMcpToolEvents('corr-4', handler2);

    emitMcpToolEvent({
      type: 'tool_start',
      correlationId: 'corr-4',
      toolName: 'search_web',
      timestamp: new Date().toISOString(),
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });

  it('should handle tool_end events with result', () => {
    const handler = vi.fn();
    const unsub = onMcpToolEvents('corr-5', handler);

    const event: McpToolEvent = {
      type: 'tool_end',
      correlationId: 'corr-5',
      toolName: 'add_memory',
      result: {
        success: true,
        preview: 'Memory saved: "meeting notes"',
        durationMs: 12,
      },
      timestamp: new Date().toISOString(),
    };
    emitMcpToolEvent(event);

    expect(handler).toHaveBeenCalledWith(event);
    expect(handler.mock.calls[0]![0].result!.durationMs).toBe(12);

    unsub();
  });

  it('should handle error results', () => {
    const handler = vi.fn();
    const unsub = onMcpToolEvents('corr-6', handler);

    emitMcpToolEvent({
      type: 'tool_end',
      correlationId: 'corr-6',
      toolName: 'send_email',
      result: {
        success: false,
        preview: 'Error: SMTP not configured',
      },
      timestamp: new Date().toISOString(),
    });

    expect(handler.mock.calls[0]![0].result!.success).toBe(false);

    unsub();
  });
});
