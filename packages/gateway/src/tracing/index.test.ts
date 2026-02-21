import { describe, it, expect, beforeEach } from 'vitest';
import {
  setGlobalTracing,
  isTracingEnabled,
  createTraceContext,
  withTraceContext,
  withTraceContextAsync,
  getTraceContext,
  traceEvent,
  traceToolCallStart,
  traceToolCallEnd,
  traceDbRead,
  traceDbWrite,
  traceMemoryOp,
  traceFileOp,
  traceModelCall,
  traceAutonomyCheck,
  traceTriggerFire,
  traceError,
  traceInfo,
  getTraceSummary,
  formatTraceSummary,
  createTracingMiddleware,
  type TraceContext as _TraceContextType,
  type TraceSummary,
} from './index.js';

beforeEach(() => {
  setGlobalTracing(true);
});

// =============================================================================
// setGlobalTracing / isTracingEnabled
// =============================================================================

describe('setGlobalTracing / isTracingEnabled', () => {
  it('isTracingEnabled returns false outside any context', () => {
    expect(isTracingEnabled()).toBe(false);
  });

  it('isTracingEnabled returns true inside an enabled context with global enabled', () => {
    const ctx = createTraceContext('req-1');
    withTraceContext(ctx, () => {
      expect(isTracingEnabled()).toBe(true);
    });
  });

  it('isTracingEnabled returns false when global tracing is disabled', () => {
    setGlobalTracing(false);
    const ctx = createTraceContext('req-1');
    // Note: createTraceContext captures globalTracingEnabled at creation time (false)
    withTraceContext(ctx, () => {
      expect(isTracingEnabled()).toBe(false);
    });
  });

  it('isTracingEnabled returns false when context has enabled=false', () => {
    const ctx = createTraceContext('req-1');
    ctx.enabled = false;
    withTraceContext(ctx, () => {
      expect(isTracingEnabled()).toBe(false);
    });
  });

  it('isTracingEnabled returns false if global disabled even when context enabled', () => {
    const ctx = createTraceContext('req-1');
    expect(ctx.enabled).toBe(true);
    setGlobalTracing(false);
    withTraceContext(ctx, () => {
      expect(isTracingEnabled()).toBe(false);
    });
  });

  it('setGlobalTracing(true) enables tracing globally', () => {
    setGlobalTracing(false);
    setGlobalTracing(true);
    const ctx = createTraceContext('req-1');
    withTraceContext(ctx, () => {
      expect(isTracingEnabled()).toBe(true);
    });
  });
});

// =============================================================================
// createTraceContext
// =============================================================================

describe('createTraceContext', () => {
  it('creates context with requestId, startTime, empty events, and enabled', () => {
    const before = Date.now();
    const ctx = createTraceContext('req-123');
    const after = Date.now();

    expect(ctx.requestId).toBe('req-123');
    expect(ctx.startTime).toBeGreaterThanOrEqual(before);
    expect(ctx.startTime).toBeLessThanOrEqual(after);
    expect(ctx.events).toEqual([]);
    expect(ctx.enabled).toBe(true);
  });

  it('includes userId when provided', () => {
    const ctx = createTraceContext('req-123', 'user-456');
    expect(ctx.userId).toBe('user-456');
  });

  it('userId is undefined when not provided', () => {
    const ctx = createTraceContext('req-123');
    expect(ctx.userId).toBeUndefined();
  });

  it('uses current globalTracingEnabled value for enabled field', () => {
    setGlobalTracing(false);
    const ctx = createTraceContext('req-1');
    expect(ctx.enabled).toBe(false);
  });

  it('enabled is true when global tracing is enabled', () => {
    setGlobalTracing(true);
    const ctx = createTraceContext('req-1');
    expect(ctx.enabled).toBe(true);
  });
});

// =============================================================================
// withTraceContext
// =============================================================================

describe('withTraceContext', () => {
  it('runs sync function with context', () => {
    const ctx = createTraceContext('req-sync');
    let ran = false;
    withTraceContext(ctx, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('returns the function return value', () => {
    const ctx = createTraceContext('req-sync');
    const result = withTraceContext(ctx, () => 42);
    expect(result).toBe(42);
  });

  it('returns complex objects', () => {
    const ctx = createTraceContext('req-sync');
    const result = withTraceContext(ctx, () => ({ a: 1, b: 'two' }));
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  it('getTraceContext works inside withTraceContext', () => {
    const ctx = createTraceContext('req-sync');
    withTraceContext(ctx, () => {
      const inner = getTraceContext();
      expect(inner).toBe(ctx);
    });
  });

  it('getTraceContext returns undefined outside withTraceContext', () => {
    expect(getTraceContext()).toBeUndefined();
  });

  it('propagates exceptions from the function', () => {
    const ctx = createTraceContext('req-sync');
    expect(() =>
      withTraceContext(ctx, () => {
        throw new Error('sync error');
      })
    ).toThrow('sync error');
  });
});

// =============================================================================
// withTraceContextAsync
// =============================================================================

describe('withTraceContextAsync', () => {
  it('runs async function with context', async () => {
    const ctx = createTraceContext('req-async');
    let ran = false;
    await withTraceContextAsync(ctx, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('returns resolved value', async () => {
    const ctx = createTraceContext('req-async');
    const result = await withTraceContextAsync(ctx, async () => 99);
    expect(result).toBe(99);
  });

  it('getTraceContext works inside async fn', async () => {
    const ctx = createTraceContext('req-async');
    await withTraceContextAsync(ctx, async () => {
      const inner = getTraceContext();
      expect(inner).toBe(ctx);
    });
  });

  it('propagates rejections from the async function', async () => {
    const ctx = createTraceContext('req-async');
    await expect(
      withTraceContextAsync(ctx, async () => {
        throw new Error('async error');
      })
    ).rejects.toThrow('async error');
  });

  it('context is preserved across await boundaries', async () => {
    const ctx = createTraceContext('req-async');
    await withTraceContextAsync(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const inner = getTraceContext();
      expect(inner).toBe(ctx);
    });
  });
});

// =============================================================================
// traceEvent
// =============================================================================

describe('traceEvent', () => {
  it('adds event with auto-generated timestamp', () => {
    const ctx = createTraceContext('req-ev');
    withTraceContext(ctx, () => {
      const before = Date.now();
      traceEvent({ type: 'info', name: 'test' });
      const after = Date.now();

      expect(ctx.events).toHaveLength(1);
      expect(ctx.events[0]!.type).toBe('info');
      expect(ctx.events[0]!.name).toBe('test');
      expect(ctx.events[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(ctx.events[0]!.timestamp).toBeLessThanOrEqual(after);
    });
  });

  it('no-op when context is disabled', () => {
    const ctx = createTraceContext('req-ev');
    ctx.enabled = false;
    withTraceContext(ctx, () => {
      traceEvent({ type: 'info', name: 'should not appear' });
      expect(ctx.events).toHaveLength(0);
    });
  });

  it('no-op when no context (outside withTraceContext)', () => {
    // Should not throw
    traceEvent({ type: 'info', name: 'orphan' });
  });

  it('multiple events accumulate', () => {
    const ctx = createTraceContext('req-ev');
    withTraceContext(ctx, () => {
      traceEvent({ type: 'info', name: 'first' });
      traceEvent({ type: 'info', name: 'second' });
      traceEvent({ type: 'error', name: 'third' });
      expect(ctx.events).toHaveLength(3);
    });
  });

  it('preserves all event fields (details, success, error, category, duration)', () => {
    const ctx = createTraceContext('req-ev');
    withTraceContext(ctx, () => {
      traceEvent({
        type: 'tool_result',
        name: 'my_tool',
        duration: 123,
        details: { foo: 'bar' },
        success: true,
        error: undefined,
        category: 'tool',
      });
      const ev = ctx.events[0]!;
      expect(ev.duration).toBe(123);
      expect(ev.details).toEqual({ foo: 'bar' });
      expect(ev.success).toBe(true);
      expect(ev.category).toBe('tool');
    });
  });
});

// =============================================================================
// traceToolCallStart
// =============================================================================

describe('traceToolCallStart', () => {
  it('records tool_call event with name and args', () => {
    const ctx = createTraceContext('req-tc');
    withTraceContext(ctx, () => {
      traceToolCallStart('my_tool', { key: 'value' });
      expect(ctx.events).toHaveLength(1);
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('tool_call');
      expect(ev.name).toBe('my_tool');
      expect(ev.details).toEqual({ args: { key: 'value' } });
    });
  });

  it('returns a startTime number', () => {
    const ctx = createTraceContext('req-tc');
    withTraceContext(ctx, () => {
      const before = Date.now();
      const startTime = traceToolCallStart('tool');
      expect(typeof startTime).toBe('number');
      expect(startTime).toBeGreaterThanOrEqual(before);
    });
  });

  it('category is tool', () => {
    const ctx = createTraceContext('req-tc');
    withTraceContext(ctx, () => {
      traceToolCallStart('tool');
      expect(ctx.events[0]!.category).toBe('tool');
    });
  });

  it('args are optional', () => {
    const ctx = createTraceContext('req-tc');
    withTraceContext(ctx, () => {
      traceToolCallStart('tool');
      expect(ctx.events[0]!.details).toEqual({ args: undefined });
    });
  });

  it('returns startTime even when tracing is disabled (no event recorded)', () => {
    const ctx = createTraceContext('req-tc');
    ctx.enabled = false;
    withTraceContext(ctx, () => {
      const startTime = traceToolCallStart('tool');
      expect(typeof startTime).toBe('number');
      expect(ctx.events).toHaveLength(0);
    });
  });
});

// =============================================================================
// traceToolCallEnd
// =============================================================================

describe('traceToolCallEnd', () => {
  it('records tool_result event with duration', () => {
    const ctx = createTraceContext('req-te');
    withTraceContext(ctx, () => {
      const startTime = Date.now() - 50;
      traceToolCallEnd('my_tool', startTime, true);
      expect(ctx.events).toHaveLength(1);
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('tool_result');
      expect(ev.name).toBe('my_tool');
      expect(ev.duration).toBeGreaterThanOrEqual(50);
      expect(ev.success).toBe(true);
    });
  });

  it('includes error when provided', () => {
    const ctx = createTraceContext('req-te');
    withTraceContext(ctx, () => {
      traceToolCallEnd('tool', Date.now(), false, undefined, 'something broke');
      const ev = ctx.events[0]!;
      expect(ev.success).toBe(false);
      expect(ev.error).toBe('something broke');
    });
  });

  it('includes result in details', () => {
    const ctx = createTraceContext('req-te');
    withTraceContext(ctx, () => {
      traceToolCallEnd('tool', Date.now(), true, 'result data');
      expect(ctx.events[0]!.details).toEqual({ result: 'result data' });
    });
  });

  it('truncates string result to 200 chars', () => {
    const ctx = createTraceContext('req-te');
    const longResult = 'x'.repeat(300);
    withTraceContext(ctx, () => {
      traceToolCallEnd('tool', Date.now(), true, longResult);
      const result = ctx.events[0]!.details!.result as string;
      expect(result).toHaveLength(200);
      expect(result).toBe('x'.repeat(200));
    });
  });

  it('does not truncate non-string result', () => {
    const ctx = createTraceContext('req-te');
    const objResult = { key: 'value' };
    withTraceContext(ctx, () => {
      traceToolCallEnd('tool', Date.now(), true, objResult);
      expect(ctx.events[0]!.details!.result).toEqual({ key: 'value' });
    });
  });

  it('category is tool', () => {
    const ctx = createTraceContext('req-te');
    withTraceContext(ctx, () => {
      traceToolCallEnd('tool', Date.now(), true);
      expect(ctx.events[0]!.category).toBe('tool');
    });
  });

  it('string result exactly 200 chars is not truncated', () => {
    const ctx = createTraceContext('req-te');
    const exact200 = 'a'.repeat(200);
    withTraceContext(ctx, () => {
      traceToolCallEnd('tool', Date.now(), true, exact200);
      const result = ctx.events[0]!.details!.result as string;
      expect(result).toHaveLength(200);
    });
  });
});

// =============================================================================
// traceDbRead / traceDbWrite
// =============================================================================

describe('traceDbRead', () => {
  it('records db_read event with table, query, and count', () => {
    const ctx = createTraceContext('req-db');
    withTraceContext(ctx, () => {
      traceDbRead('users', 'SELECT *', 5);
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('db_read');
      expect(ev.name).toBe('Read from users');
      expect(ev.details).toEqual({ table: 'users', query: 'SELECT *', count: 5 });
      expect(ev.category).toBe('database');
    });
  });

  it('query and count are optional', () => {
    const ctx = createTraceContext('req-db');
    withTraceContext(ctx, () => {
      traceDbRead('agents');
      const ev = ctx.events[0]!;
      expect(ev.details).toEqual({ table: 'agents', query: undefined, count: undefined });
    });
  });
});

describe('traceDbWrite', () => {
  it('records db_write event with table, operation, and count', () => {
    const ctx = createTraceContext('req-db');
    withTraceContext(ctx, () => {
      traceDbWrite('tasks', 'INSERT', 1);
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('db_write');
      expect(ev.name).toBe('INSERT in tasks');
      expect(ev.details).toEqual({ table: 'tasks', operation: 'INSERT', count: 1 });
      expect(ev.category).toBe('database');
    });
  });

  it('count is optional', () => {
    const ctx = createTraceContext('req-db');
    withTraceContext(ctx, () => {
      traceDbWrite('notes', 'DELETE');
      expect(ctx.events[0]!.details).toEqual({ table: 'notes', operation: 'DELETE', count: undefined });
    });
  });
});

// =============================================================================
// traceMemoryOp
// =============================================================================

describe('traceMemoryOp', () => {
  it('type recall maps to memory_recall event type', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('recall', { query: 'search' });
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('memory_recall');
      expect(ev.name).toBe('Memory recall');
    });
  });

  it('type add maps to memory_add event type', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('add');
      expect(ctx.events[0]!.type).toBe('memory_add');
      expect(ctx.events[0]!.name).toBe('Memory add');
    });
  });

  it('type update maps to memory_add event type', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('update');
      expect(ctx.events[0]!.type).toBe('memory_add');
      expect(ctx.events[0]!.name).toBe('Memory update');
    });
  });

  it('type delete maps to memory_add event type', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('delete');
      expect(ctx.events[0]!.type).toBe('memory_add');
      expect(ctx.events[0]!.name).toBe('Memory delete');
    });
  });

  it('category is memory', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('add');
      expect(ctx.events[0]!.category).toBe('memory');
    });
  });

  it('details are optional', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('add');
      expect(ctx.events[0]!.details).toBeUndefined();
    });
  });

  it('details are included when provided', () => {
    const ctx = createTraceContext('req-mem');
    withTraceContext(ctx, () => {
      traceMemoryOp('recall', { query: 'test', count: 3 });
      expect(ctx.events[0]!.details).toEqual({ query: 'test', count: 3 });
    });
  });
});

// =============================================================================
// traceFileOp
// =============================================================================

describe('traceFileOp', () => {
  it('type read maps to file_read event type', () => {
    const ctx = createTraceContext('req-file');
    withTraceContext(ctx, () => {
      traceFileOp('read', '/path/to/file.txt', 1024);
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('file_read');
      expect(ev.name).toBe('File read: /path/to/file.txt');
      expect(ev.details).toEqual({ path: '/path/to/file.txt', size: 1024 });
    });
  });

  it('type write maps to file_write event type', () => {
    const ctx = createTraceContext('req-file');
    withTraceContext(ctx, () => {
      traceFileOp('write', '/output.json', 512);
      expect(ctx.events[0]!.type).toBe('file_write');
      expect(ctx.events[0]!.name).toBe('File write: /output.json');
    });
  });

  it('type delete maps to file_write event type', () => {
    const ctx = createTraceContext('req-file');
    withTraceContext(ctx, () => {
      traceFileOp('delete', '/tmp/old.log');
      expect(ctx.events[0]!.type).toBe('file_write');
      expect(ctx.events[0]!.name).toBe('File delete: /tmp/old.log');
    });
  });

  it('category is file', () => {
    const ctx = createTraceContext('req-file');
    withTraceContext(ctx, () => {
      traceFileOp('read', '/f');
      expect(ctx.events[0]!.category).toBe('file');
    });
  });

  it('size is optional', () => {
    const ctx = createTraceContext('req-file');
    withTraceContext(ctx, () => {
      traceFileOp('read', '/f');
      expect(ctx.events[0]!.details).toEqual({ path: '/f', size: undefined });
    });
  });
});

// =============================================================================
// traceModelCall
// =============================================================================

describe('traceModelCall', () => {
  it('records model_call with provider/model name', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      traceModelCall('openai', 'gpt-4o', Date.now());
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('model_call');
      expect(ev.name).toBe('openai/gpt-4o');
    });
  });

  it('calculates duration from startTime', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      const startTime = Date.now() - 100;
      traceModelCall('anthropic', 'claude', startTime);
      expect(ctx.events[0]!.duration).toBeGreaterThanOrEqual(100);
    });
  });

  it('success is true when no error', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      traceModelCall('openai', 'gpt-4o', Date.now());
      expect(ctx.events[0]!.success).toBe(true);
    });
  });

  it('success is false when error provided', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      traceModelCall('openai', 'gpt-4o', Date.now(), undefined, 'rate limited');
      expect(ctx.events[0]!.success).toBe(false);
      expect(ctx.events[0]!.error).toBe('rate limited');
    });
  });

  it('tokens included in details', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      traceModelCall('openai', 'gpt-4o', Date.now(), { input: 100, output: 50 });
      expect(ctx.events[0]!.details!.tokens).toEqual({ input: 100, output: 50 });
    });
  });

  it('category is model', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      traceModelCall('openai', 'gpt-4o', Date.now());
      expect(ctx.events[0]!.category).toBe('model');
    });
  });

  it('details include provider and model', () => {
    const ctx = createTraceContext('req-model');
    withTraceContext(ctx, () => {
      traceModelCall('google', 'gemini-pro', Date.now());
      expect(ctx.events[0]!.details!.provider).toBe('google');
      expect(ctx.events[0]!.details!.model).toBe('gemini-pro');
    });
  });
});

// =============================================================================
// traceAutonomyCheck
// =============================================================================

describe('traceAutonomyCheck', () => {
  it('records autonomy_check event', () => {
    const ctx = createTraceContext('req-auto');
    withTraceContext(ctx, () => {
      traceAutonomyCheck('send_email', true, 'user approved');
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('autonomy_check');
      expect(ev.name).toBe('Autonomy check: send_email');
    });
  });

  it('details include tool, approved, and reason', () => {
    const ctx = createTraceContext('req-auto');
    withTraceContext(ctx, () => {
      traceAutonomyCheck('delete_file', false, 'risky operation');
      const ev = ctx.events[0]!;
      expect(ev.details).toEqual({
        tool: 'delete_file',
        approved: false,
        reason: 'risky operation',
      });
    });
  });

  it('category is autonomy', () => {
    const ctx = createTraceContext('req-auto');
    withTraceContext(ctx, () => {
      traceAutonomyCheck('tool', true);
      expect(ctx.events[0]!.category).toBe('autonomy');
    });
  });

  it('reason is optional', () => {
    const ctx = createTraceContext('req-auto');
    withTraceContext(ctx, () => {
      traceAutonomyCheck('tool', true);
      expect(ctx.events[0]!.details!.reason).toBeUndefined();
    });
  });

  it('success field matches approved', () => {
    const ctx = createTraceContext('req-auto');
    withTraceContext(ctx, () => {
      traceAutonomyCheck('tool', false);
      expect(ctx.events[0]!.success).toBe(false);
    });
  });
});

// =============================================================================
// traceTriggerFire
// =============================================================================

describe('traceTriggerFire', () => {
  it('records trigger_fire event with triggerName', () => {
    const ctx = createTraceContext('req-trig');
    withTraceContext(ctx, () => {
      traceTriggerFire('trig-1', 'Daily Reminder');
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('trigger_fire');
      expect(ev.name).toBe('Trigger: Daily Reminder');
    });
  });

  it('uses triggerId as fallback when no triggerName', () => {
    const ctx = createTraceContext('req-trig');
    withTraceContext(ctx, () => {
      traceTriggerFire('trig-abc');
      expect(ctx.events[0]!.name).toBe('Trigger: trig-abc');
    });
  });

  it('details include triggerId and triggerName', () => {
    const ctx = createTraceContext('req-trig');
    withTraceContext(ctx, () => {
      traceTriggerFire('trig-1', 'Morning Alert');
      expect(ctx.events[0]!.details).toEqual({
        triggerId: 'trig-1',
        triggerName: 'Morning Alert',
      });
    });
  });

  it('category is trigger', () => {
    const ctx = createTraceContext('req-trig');
    withTraceContext(ctx, () => {
      traceTriggerFire('trig-1');
      expect(ctx.events[0]!.category).toBe('trigger');
    });
  });

  it('triggerName is undefined when not provided', () => {
    const ctx = createTraceContext('req-trig');
    withTraceContext(ctx, () => {
      traceTriggerFire('trig-1');
      expect(ctx.events[0]!.details!.triggerName).toBeUndefined();
    });
  });
});

// =============================================================================
// traceError / traceInfo
// =============================================================================

describe('traceError', () => {
  it('records error event', () => {
    const ctx = createTraceContext('req-err');
    withTraceContext(ctx, () => {
      traceError('Something failed');
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('error');
      expect(ev.name).toBe('Something failed');
    });
  });

  it('sets success to false', () => {
    const ctx = createTraceContext('req-err');
    withTraceContext(ctx, () => {
      traceError('fail');
      expect(ctx.events[0]!.success).toBe(false);
    });
  });

  it('sets error field to the message', () => {
    const ctx = createTraceContext('req-err');
    withTraceContext(ctx, () => {
      traceError('disk full');
      expect(ctx.events[0]!.error).toBe('disk full');
    });
  });

  it('category is error', () => {
    const ctx = createTraceContext('req-err');
    withTraceContext(ctx, () => {
      traceError('oops');
      expect(ctx.events[0]!.category).toBe('error');
    });
  });

  it('details are optional', () => {
    const ctx = createTraceContext('req-err');
    withTraceContext(ctx, () => {
      traceError('oops');
      expect(ctx.events[0]!.details).toBeUndefined();
    });
  });

  it('details are included when provided', () => {
    const ctx = createTraceContext('req-err');
    withTraceContext(ctx, () => {
      traceError('oops', { stack: 'trace' });
      expect(ctx.events[0]!.details).toEqual({ stack: 'trace' });
    });
  });
});

describe('traceInfo', () => {
  it('records info event', () => {
    const ctx = createTraceContext('req-info');
    withTraceContext(ctx, () => {
      traceInfo('Processing started');
      const ev = ctx.events[0]!;
      expect(ev.type).toBe('info');
      expect(ev.name).toBe('Processing started');
    });
  });

  it('category is info', () => {
    const ctx = createTraceContext('req-info');
    withTraceContext(ctx, () => {
      traceInfo('hello');
      expect(ctx.events[0]!.category).toBe('info');
    });
  });

  it('details are optional', () => {
    const ctx = createTraceContext('req-info');
    withTraceContext(ctx, () => {
      traceInfo('hello');
      expect(ctx.events[0]!.details).toBeUndefined();
    });
  });

  it('details are included when provided', () => {
    const ctx = createTraceContext('req-info');
    withTraceContext(ctx, () => {
      traceInfo('hello', { extra: 'data' });
      expect(ctx.events[0]!.details).toEqual({ extra: 'data' });
    });
  });

  it('does not set success or error', () => {
    const ctx = createTraceContext('req-info');
    withTraceContext(ctx, () => {
      traceInfo('hello');
      expect(ctx.events[0]!.success).toBeUndefined();
      expect(ctx.events[0]!.error).toBeUndefined();
    });
  });
});

// =============================================================================
// getTraceSummary
// =============================================================================

describe('getTraceSummary', () => {
  it('returns null outside context', () => {
    expect(getTraceSummary()).toBeNull();
  });

  it('returns summary with requestId and totalDuration', () => {
    const ctx = createTraceContext('req-sum');
    withTraceContext(ctx, () => {
      const summary = getTraceSummary();
      expect(summary).not.toBeNull();
      expect(summary!.requestId).toBe('req-sum');
      expect(summary!.totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  it('returns correct eventCounts', () => {
    const ctx = createTraceContext('req-sum');
    withTraceContext(ctx, () => {
      traceInfo('one');
      traceInfo('two');
      traceError('err');
      const summary = getTraceSummary()!;
      expect(summary.eventCounts['info']).toBe(2);
      expect(summary.eventCounts['error']).toBe(1);
    });
  });

  it('empty events produce empty arrays in summary', () => {
    const ctx = createTraceContext('req-sum');
    withTraceContext(ctx, () => {
      const summary = getTraceSummary()!;
      expect(summary.toolCalls).toEqual([]);
      expect(summary.dbOperations).toEqual([]);
      expect(summary.memoryOps).toEqual([]);
      expect(summary.fileOps).toEqual([]);
      expect(summary.modelCalls).toEqual([]);
      expect(summary.autonomyChecks).toEqual([]);
      expect(summary.triggersFired).toEqual([]);
      expect(summary.errors).toEqual([]);
      expect(summary.events).toEqual([]);
      expect(summary.eventCounts).toEqual({});
    });
  });

  describe('toolCalls', () => {
    it('merges tool_call args with tool_result data', () => {
      const ctx = createTraceContext('req-tc');
      withTraceContext(ctx, () => {
        const start = traceToolCallStart('my_tool', { q: 'test' });
        traceToolCallEnd('my_tool', start, true, 'result text');
        const summary = getTraceSummary()!;
        expect(summary.toolCalls).toHaveLength(1);
        expect(summary.toolCalls[0]!.name).toBe('my_tool');
        expect(summary.toolCalls[0]!.success).toBe(true);
        expect(summary.toolCalls[0]!.arguments).toEqual({ q: 'test' });
        expect(summary.toolCalls[0]!.result).toBe('result text');
      });
    });

    it('tool call without args has undefined arguments', () => {
      const ctx = createTraceContext('req-tc');
      withTraceContext(ctx, () => {
        const start = traceToolCallStart('tool_no_args');
        traceToolCallEnd('tool_no_args', start, true);
        const summary = getTraceSummary()!;
        expect(summary.toolCalls[0]!.arguments).toBeUndefined();
      });
    });

    it('includes duration from tool_result', () => {
      const ctx = createTraceContext('req-tc');
      withTraceContext(ctx, () => {
        const startTime = Date.now() - 75;
        traceToolCallEnd('tool', startTime, true);
        const summary = getTraceSummary()!;
        expect(summary.toolCalls[0]!.duration).toBeGreaterThanOrEqual(75);
      });
    });

    it('includes error from failed tool call', () => {
      const ctx = createTraceContext('req-tc');
      withTraceContext(ctx, () => {
        traceToolCallEnd('tool', Date.now(), false, undefined, 'timeout');
        const summary = getTraceSummary()!;
        expect(summary.toolCalls[0]!.success).toBe(false);
        expect(summary.toolCalls[0]!.error).toBe('timeout');
      });
    });

    it('defaults success to true when not explicitly set', () => {
      const ctx = createTraceContext('req-tc');
      withTraceContext(ctx, () => {
        // Manually push a tool_result without success field
        traceEvent({
          type: 'tool_result',
          name: 'implicit_success_tool',
          category: 'tool',
        });
        const summary = getTraceSummary()!;
        expect(summary.toolCalls[0]!.success).toBe(true);
      });
    });
  });

  describe('dbOperations', () => {
    it('maps db_read to type read', () => {
      const ctx = createTraceContext('req-db');
      withTraceContext(ctx, () => {
        traceDbRead('users', 'SELECT *', 5);
        const summary = getTraceSummary()!;
        expect(summary.dbOperations).toHaveLength(1);
        expect(summary.dbOperations[0]).toEqual({ type: 'read', table: 'users', count: 5 });
      });
    });

    it('maps db_write to type write', () => {
      const ctx = createTraceContext('req-db');
      withTraceContext(ctx, () => {
        traceDbWrite('tasks', 'INSERT', 2);
        const summary = getTraceSummary()!;
        expect(summary.dbOperations).toHaveLength(1);
        expect(summary.dbOperations[0]).toEqual({ type: 'write', table: 'tasks', count: 2 });
      });
    });

    it('handles multiple db operations', () => {
      const ctx = createTraceContext('req-db');
      withTraceContext(ctx, () => {
        traceDbRead('users');
        traceDbWrite('tasks', 'INSERT');
        traceDbRead('agents');
        const summary = getTraceSummary()!;
        expect(summary.dbOperations).toHaveLength(3);
      });
    });
  });

  describe('memoryOps', () => {
    it('maps memory_recall name to type recall', () => {
      const ctx = createTraceContext('req-mem');
      withTraceContext(ctx, () => {
        traceMemoryOp('recall');
        const summary = getTraceSummary()!;
        expect(summary.memoryOps).toHaveLength(1);
        expect(summary.memoryOps[0]!.type).toBe('recall');
      });
    });

    it('maps memory_add name with "add" to type add', () => {
      const ctx = createTraceContext('req-mem');
      withTraceContext(ctx, () => {
        traceMemoryOp('add');
        const summary = getTraceSummary()!;
        expect(summary.memoryOps[0]!.type).toBe('add');
      });
    });

    it('maps memory_add name with "update" to type update', () => {
      const ctx = createTraceContext('req-mem');
      withTraceContext(ctx, () => {
        traceMemoryOp('update');
        const summary = getTraceSummary()!;
        // name is "Memory update" which doesn't include 'recall' or 'add'
        expect(summary.memoryOps[0]!.type).toBe('update');
      });
    });

    it('maps memory_add name with "delete" to type update (no match for recall/add)', () => {
      const ctx = createTraceContext('req-mem');
      withTraceContext(ctx, () => {
        traceMemoryOp('delete');
        const summary = getTraceSummary()!;
        // name is "Memory delete" — doesn't include 'recall' or 'add' → falls to 'update'
        expect(summary.memoryOps[0]!.type).toBe('update');
      });
    });

    it('includes count from details when provided', () => {
      const ctx = createTraceContext('req-mem');
      withTraceContext(ctx, () => {
        traceMemoryOp('recall', { count: 7 });
        const summary = getTraceSummary()!;
        expect(summary.memoryOps[0]!.count).toBe(7);
      });
    });
  });

  describe('fileOps', () => {
    it('maps file_read to type read', () => {
      const ctx = createTraceContext('req-file');
      withTraceContext(ctx, () => {
        traceFileOp('read', '/data/input.txt');
        const summary = getTraceSummary()!;
        expect(summary.fileOps).toHaveLength(1);
        expect(summary.fileOps[0]).toEqual({ type: 'read', path: '/data/input.txt' });
      });
    });

    it('maps file_write to type write', () => {
      const ctx = createTraceContext('req-file');
      withTraceContext(ctx, () => {
        traceFileOp('write', '/out.json');
        const summary = getTraceSummary()!;
        expect(summary.fileOps[0]).toEqual({ type: 'write', path: '/out.json' });
      });
    });

    it('delete file operation maps to write type', () => {
      const ctx = createTraceContext('req-file');
      withTraceContext(ctx, () => {
        traceFileOp('delete', '/tmp/old');
        const summary = getTraceSummary()!;
        expect(summary.fileOps[0]!.type).toBe('write');
      });
    });
  });

  describe('modelCalls', () => {
    it('sums input and output tokens', () => {
      const ctx = createTraceContext('req-model');
      withTraceContext(ctx, () => {
        traceModelCall('openai', 'gpt-4o', Date.now(), { input: 100, output: 50 });
        const summary = getTraceSummary()!;
        expect(summary.modelCalls).toHaveLength(1);
        expect(summary.modelCalls[0]!.tokens).toBe(150);
      });
    });

    it('tokens undefined when not provided', () => {
      const ctx = createTraceContext('req-model');
      withTraceContext(ctx, () => {
        traceModelCall('openai', 'gpt-4o', Date.now());
        const summary = getTraceSummary()!;
        expect(summary.modelCalls[0]!.tokens).toBeUndefined();
      });
    });

    it('includes provider, model, and duration', () => {
      const ctx = createTraceContext('req-model');
      withTraceContext(ctx, () => {
        const start = Date.now() - 200;
        traceModelCall('anthropic', 'claude-3', start);
        const summary = getTraceSummary()!;
        expect(summary.modelCalls[0]!.provider).toBe('anthropic');
        expect(summary.modelCalls[0]!.model).toBe('claude-3');
        expect(summary.modelCalls[0]!.duration).toBeGreaterThanOrEqual(200);
      });
    });
  });

  describe('autonomyChecks', () => {
    it('extracts tool, approved, and reason', () => {
      const ctx = createTraceContext('req-auto');
      withTraceContext(ctx, () => {
        traceAutonomyCheck('send_email', true, 'whitelisted');
        const summary = getTraceSummary()!;
        expect(summary.autonomyChecks).toHaveLength(1);
        expect(summary.autonomyChecks[0]).toEqual({
          tool: 'send_email',
          approved: true,
          reason: 'whitelisted',
        });
      });
    });

    it('reason undefined when not provided', () => {
      const ctx = createTraceContext('req-auto');
      withTraceContext(ctx, () => {
        traceAutonomyCheck('tool', false);
        const summary = getTraceSummary()!;
        expect(summary.autonomyChecks[0]!.reason).toBeUndefined();
      });
    });
  });

  describe('triggersFired', () => {
    it('extracts trigger names', () => {
      const ctx = createTraceContext('req-trig');
      withTraceContext(ctx, () => {
        traceTriggerFire('t1', 'Morning Reminder');
        const summary = getTraceSummary()!;
        expect(summary.triggersFired).toEqual(['Morning Reminder']);
      });
    });

    it('falls back to triggerId when no triggerName', () => {
      const ctx = createTraceContext('req-trig');
      withTraceContext(ctx, () => {
        traceTriggerFire('trig-xyz');
        const summary = getTraceSummary()!;
        expect(summary.triggersFired).toEqual(['trig-xyz']);
      });
    });

    it('handles multiple triggers', () => {
      const ctx = createTraceContext('req-trig');
      withTraceContext(ctx, () => {
        traceTriggerFire('t1', 'Alpha');
        traceTriggerFire('t2', 'Beta');
        const summary = getTraceSummary()!;
        expect(summary.triggersFired).toEqual(['Alpha', 'Beta']);
      });
    });
  });

  describe('errors', () => {
    it('extracts error messages', () => {
      const ctx = createTraceContext('req-err');
      withTraceContext(ctx, () => {
        traceError('disk full');
        traceError('connection lost');
        const summary = getTraceSummary()!;
        expect(summary.errors).toEqual(['disk full', 'connection lost']);
      });
    });

    it('falls back to event name when error field not set', () => {
      const ctx = createTraceContext('req-err');
      withTraceContext(ctx, () => {
        // Manually push an error event without error field
        traceEvent({ type: 'error', name: 'fallback name' });
        const summary = getTraceSummary()!;
        expect(summary.errors).toEqual(['fallback name']);
      });
    });
  });

  it('includes all raw events in summary.events', () => {
    const ctx = createTraceContext('req-events');
    withTraceContext(ctx, () => {
      traceInfo('a');
      traceError('b');
      const summary = getTraceSummary()!;
      expect(summary.events).toHaveLength(2);
      expect(summary.events).toBe(ctx.events); // Same reference
    });
  });
});

// =============================================================================
// formatTraceSummary
// =============================================================================

describe('formatTraceSummary', () => {
  function makeEmptySummary(overrides?: Partial<TraceSummary>): TraceSummary {
    return {
      requestId: 'req-fmt',
      totalDuration: 42,
      eventCounts: {},
      toolCalls: [],
      dbOperations: [],
      memoryOps: [],
      fileOps: [],
      modelCalls: [],
      autonomyChecks: [],
      triggersFired: [],
      errors: [],
      events: [],
      ...overrides,
    };
  }

  it('includes requestId and totalDuration in header', () => {
    const output = formatTraceSummary(makeEmptySummary());
    expect(output).toContain('req-fmt');
    expect(output).toContain('42ms');
  });

  it('formats tool calls with success emoji', () => {
    const summary = makeEmptySummary({
      toolCalls: [{ name: 'search', duration: 10, success: true }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Tool Calls');
    expect(output).toContain('search');
    expect(output).toContain('10ms');
  });

  it('formats tool calls with failure emoji', () => {
    const summary = makeEmptySummary({
      toolCalls: [{ name: 'broken_tool', success: false, error: 'crash' }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('broken_tool');
    expect(output).toContain('Error: crash');
  });

  it('formats tool call without duration', () => {
    const summary = makeEmptySummary({
      toolCalls: [{ name: 'quick_tool', success: true }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('quick_tool');
    expect(output).not.toContain('ms)');
  });

  it('formats model calls', () => {
    const summary = makeEmptySummary({
      modelCalls: [{ provider: 'openai', model: 'gpt-4o', tokens: 500, duration: 1000 }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Model Calls');
    expect(output).toContain('openai/gpt-4o');
    expect(output).toContain('500 tokens');
    expect(output).toContain('1000ms');
  });

  it('formats model call without tokens', () => {
    const summary = makeEmptySummary({
      modelCalls: [{ provider: 'openai', model: 'gpt-4o' }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('openai/gpt-4o');
    expect(output).not.toContain('tokens');
  });

  it('formats model call without duration', () => {
    const summary = makeEmptySummary({
      modelCalls: [{ provider: 'openai', model: 'gpt-4o', tokens: 100 }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('openai/gpt-4o');
    expect(output).toContain('100 tokens');
    expect(output).not.toContain('ms)');
  });

  it('formats autonomy checks with approved emoji', () => {
    const summary = makeEmptySummary({
      autonomyChecks: [{ tool: 'send_email', approved: true, reason: 'whitelisted' }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Autonomy Checks');
    expect(output).toContain('send_email');
    expect(output).toContain('whitelisted');
  });

  it('formats autonomy checks with denied emoji', () => {
    const summary = makeEmptySummary({
      autonomyChecks: [{ tool: 'rm_rf', approved: false }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('rm_rf');
  });

  it('formats autonomy checks without reason', () => {
    const summary = makeEmptySummary({
      autonomyChecks: [{ tool: 'tool', approved: true }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('tool');
    expect(output).not.toContain(': undefined');
  });

  it('formats database operations with read and write counts', () => {
    const summary = makeEmptySummary({
      dbOperations: [
        { type: 'read', table: 'users' },
        { type: 'read', table: 'tasks' },
        { type: 'write', table: 'logs' },
      ],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Database: 2 reads, 1 writes');
  });

  it('formats memory operations with add and recall counts', () => {
    const summary = makeEmptySummary({
      memoryOps: [{ type: 'add' }, { type: 'recall' }, { type: 'recall' }],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Memory: 1 adds, 2 recalls');
  });

  it('formats file operations with paths', () => {
    const summary = makeEmptySummary({
      fileOps: [
        { type: 'read', path: '/data/input.csv' },
        { type: 'write', path: '/output/result.json' },
      ],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Files:');
    expect(output).toContain('/data/input.csv');
    expect(output).toContain('/output/result.json');
  });

  it('formats triggers section', () => {
    const summary = makeEmptySummary({
      triggersFired: ['Morning Alert', 'Backup Check'],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Triggers: Morning Alert, Backup Check');
  });

  it('formats errors section', () => {
    const summary = makeEmptySummary({
      errors: ['disk full', 'timeout'],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Errors:');
    expect(output).toContain('disk full');
    expect(output).toContain('timeout');
  });

  it('skips empty sections', () => {
    const output = formatTraceSummary(makeEmptySummary());
    expect(output).not.toContain('Tool Calls');
    expect(output).not.toContain('Model Calls');
    expect(output).not.toContain('Autonomy Checks');
    expect(output).not.toContain('Database');
    expect(output).not.toContain('Memory');
    expect(output).not.toContain('Files');
    expect(output).not.toContain('Triggers');
    expect(output).not.toContain('Errors:');
  });

  it('includes all sections when all populated', () => {
    const summary = makeEmptySummary({
      toolCalls: [{ name: 't', success: true }],
      modelCalls: [{ provider: 'p', model: 'm' }],
      autonomyChecks: [{ tool: 'a', approved: true }],
      dbOperations: [{ type: 'read' }],
      memoryOps: [{ type: 'add' }],
      fileOps: [{ type: 'read', path: '/f' }],
      triggersFired: ['trig'],
      errors: ['err'],
    });
    const output = formatTraceSummary(summary);
    expect(output).toContain('Tool Calls');
    expect(output).toContain('Model Calls');
    expect(output).toContain('Autonomy Checks');
    expect(output).toContain('Database');
    expect(output).toContain('Memory');
    expect(output).toContain('Files');
    expect(output).toContain('Triggers');
    expect(output).toContain('Errors');
  });
});

// =============================================================================
// createTracingMiddleware
// =============================================================================

describe('createTracingMiddleware', () => {
  it('start() creates a TraceContext', () => {
    const mw = createTracingMiddleware();
    const ctx = mw.start('req-mw', 'user-1');
    expect(ctx.requestId).toBe('req-mw');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.events).toEqual([]);
    expect(ctx.enabled).toBe(true);
  });

  it('start() without userId', () => {
    const mw = createTracingMiddleware();
    const ctx = mw.start('req-mw');
    expect(ctx.userId).toBeUndefined();
  });

  it('finish() returns TraceSummary within context', () => {
    const mw = createTracingMiddleware();
    const ctx = mw.start('req-mw');
    withTraceContext(ctx, () => {
      traceInfo('test');
      const summary = mw.finish();
      expect(summary).not.toBeNull();
      expect(summary!.requestId).toBe('req-mw');
      expect(summary!.eventCounts['info']).toBe(1);
    });
  });

  it('finish() returns null outside context', () => {
    const mw = createTracingMiddleware();
    mw.start('req-mw');
    const summary = mw.finish();
    expect(summary).toBeNull();
  });
});

// =============================================================================
// Integration tests
// =============================================================================

describe('integration', () => {
  it('full lifecycle: create context, record events, get summary, format', () => {
    const ctx = createTraceContext('req-full', 'user-42');
    withTraceContext(ctx, () => {
      // Tool call
      const toolStart = traceToolCallStart('web_search', { query: 'weather' });
      traceToolCallEnd('web_search', toolStart, true, 'Sunny, 72F');

      // DB operations
      traceDbRead('cache', 'SELECT * FROM cache WHERE key = ?', 1);
      traceDbWrite('cache', 'INSERT', 1);

      // Memory
      traceMemoryOp('add', { content: 'weather data' });
      traceMemoryOp('recall', { query: 'weather' });

      // File
      traceFileOp('write', '/tmp/weather.json', 256);

      // Model call
      const modelStart = Date.now() - 500;
      traceModelCall('openai', 'gpt-4o', modelStart, { input: 200, output: 100 });

      // Autonomy
      traceAutonomyCheck('web_search', true, 'auto-approved');

      // Trigger
      traceTriggerFire('t1', 'Weather Update');

      // Info and error
      traceInfo('Request processed');
      traceError('Minor warning', { code: 'W001' });

      const summary = getTraceSummary()!;
      expect(summary.requestId).toBe('req-full');
      expect(summary.toolCalls).toHaveLength(1);
      expect(summary.toolCalls[0]!.name).toBe('web_search');
      expect(summary.toolCalls[0]!.arguments).toEqual({ query: 'weather' });
      expect(summary.dbOperations).toHaveLength(2);
      expect(summary.memoryOps).toHaveLength(2);
      expect(summary.fileOps).toHaveLength(1);
      expect(summary.modelCalls).toHaveLength(1);
      expect(summary.modelCalls[0]!.tokens).toBe(300);
      expect(summary.autonomyChecks).toHaveLength(1);
      expect(summary.triggersFired).toEqual(['Weather Update']);
      expect(summary.errors).toEqual(['Minor warning']);

      const formatted = formatTraceSummary(summary);
      expect(formatted).toContain('req-full');
      expect(formatted).toContain('web_search');
      expect(formatted).toContain('openai/gpt-4o');
      expect(formatted).toContain('Weather Update');
      expect(formatted).toContain('Minor warning');
    });
  });

  it('multiple tool calls: start + end pairs correctly merged', () => {
    const ctx = createTraceContext('req-multi');
    withTraceContext(ctx, () => {
      const s1 = traceToolCallStart('tool_a', { x: 1 });
      const s2 = traceToolCallStart('tool_b', { y: 2 });
      traceToolCallEnd('tool_a', s1, true, 'result_a');
      traceToolCallEnd('tool_b', s2, false, undefined, 'failed');

      const summary = getTraceSummary()!;
      expect(summary.toolCalls).toHaveLength(2);

      const toolA = summary.toolCalls.find((tc) => tc.name === 'tool_a');
      const toolB = summary.toolCalls.find((tc) => tc.name === 'tool_b');

      expect(toolA!.success).toBe(true);
      expect(toolA!.arguments).toEqual({ x: 1 });
      expect(toolA!.result).toBe('result_a');

      expect(toolB!.success).toBe(false);
      expect(toolB!.error).toBe('failed');
      expect(toolB!.arguments).toEqual({ y: 2 });
    });
  });

  it('nested async: context preserved across async boundaries', async () => {
    const ctx = createTraceContext('req-nested');
    await withTraceContextAsync(ctx, async () => {
      traceInfo('before await');
      await new Promise((resolve) => setTimeout(resolve, 10));
      traceInfo('after await');

      await new Promise((resolve) => setTimeout(resolve, 5));
      traceDbRead('test_table');

      const summary = getTraceSummary()!;
      expect(summary.eventCounts['info']).toBe(2);
      expect(summary.eventCounts['db_read']).toBe(1);
      expect(summary.events).toHaveLength(3);
    });
  });

  it('disabled context: no events recorded but functions do not throw', () => {
    setGlobalTracing(false);
    const ctx = createTraceContext('req-disabled');
    expect(ctx.enabled).toBe(false);

    withTraceContext(ctx, () => {
      traceToolCallStart('tool');
      traceToolCallEnd('tool', Date.now(), true);
      traceDbRead('table');
      traceDbWrite('table', 'INSERT');
      traceMemoryOp('add');
      traceFileOp('read', '/path');
      traceModelCall('p', 'm', Date.now());
      traceAutonomyCheck('tool', true);
      traceTriggerFire('t1');
      traceError('err');
      traceInfo('info');

      expect(ctx.events).toHaveLength(0);
      const summary = getTraceSummary()!;
      expect(summary.toolCalls).toEqual([]);
      expect(summary.events).toEqual([]);
    });
  });

  it('context isolation: two concurrent trace contexts do not interfere', async () => {
    const ctx1 = createTraceContext('req-1');
    const ctx2 = createTraceContext('req-2');

    const p1 = withTraceContextAsync(ctx1, async () => {
      traceInfo('from ctx1');
      await new Promise((resolve) => setTimeout(resolve, 10));
      traceInfo('from ctx1 again');
      return getTraceSummary()!;
    });

    const p2 = withTraceContextAsync(ctx2, async () => {
      traceError('from ctx2');
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getTraceSummary()!;
    });

    const [summary1, summary2] = await Promise.all([p1, p2]);

    expect(summary1.requestId).toBe('req-1');
    expect(summary1.eventCounts['info']).toBe(2);
    expect(summary1.errors).toEqual([]);

    expect(summary2.requestId).toBe('req-2');
    expect(summary2.eventCounts['error']).toBe(1);
    expect(summary2.errors).toEqual(['from ctx2']);
  });

  it('same tool name called twice: argsMap uses last args for that name', () => {
    const ctx = createTraceContext('req-dup');
    withTraceContext(ctx, () => {
      traceToolCallStart('search', { q: 'first' });
      traceToolCallEnd('search', Date.now(), true, 'r1');
      traceToolCallStart('search', { q: 'second' });
      traceToolCallEnd('search', Date.now(), true, 'r2');

      const summary = getTraceSummary()!;
      expect(summary.toolCalls).toHaveLength(2);
      // argsMap overwrites with the last tool_call for same name
      // Both tool_results should get the LAST args since argsMap.set overwrites
      expect(summary.toolCalls[0]!.arguments).toEqual({ q: 'second' });
      expect(summary.toolCalls[1]!.arguments).toEqual({ q: 'second' });
    });
  });

  it('middleware flow: start, record events within context, finish', () => {
    const mw = createTracingMiddleware();
    const ctx = mw.start('req-mw-flow', 'user-99');

    withTraceContext(ctx, () => {
      traceInfo('middleware test');
      traceDbRead('sessions');
      const summary = mw.finish();
      expect(summary).not.toBeNull();
      expect(summary!.requestId).toBe('req-mw-flow');
      expect(summary!.eventCounts['info']).toBe(1);
      expect(summary!.eventCounts['db_read']).toBe(1);
    });
  });

  it('getTraceSummary totalDuration grows over time', async () => {
    const ctx = createTraceContext('req-dur');
    await withTraceContextAsync(ctx, async () => {
      const summary1 = getTraceSummary()!;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const summary2 = getTraceSummary()!;
      expect(summary2.totalDuration).toBeGreaterThan(summary1.totalDuration);
    });
  });

  it('traceEvent timestamp increases monotonically', () => {
    const ctx = createTraceContext('req-mono');
    withTraceContext(ctx, () => {
      for (let i = 0; i < 10; i++) {
        traceInfo(`event-${i}`);
      }
      for (let i = 1; i < ctx.events.length; i++) {
        expect(ctx.events[i]!.timestamp).toBeGreaterThanOrEqual(ctx.events[i - 1]!.timestamp);
      }
    });
  });
});
