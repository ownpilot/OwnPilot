import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ResourceCounter,
  buildConsole,
  buildCrypto,
  buildTimers,
  buildSandboxContext,
} from './context.js';

// ---------------------------------------------------------------------------
// ResourceCounter
// ---------------------------------------------------------------------------
describe('ResourceCounter', () => {
  it('starts at zero', () => {
    const rc = new ResourceCounter();
    expect(rc.getStats()).toEqual({ networkRequests: 0, fsOperations: 0 });
  });

  it('incrementNetwork returns true within limit', () => {
    const rc = new ResourceCounter({ maxNetworkRequests: 2 });
    expect(rc.incrementNetwork()).toBe(true);
    expect(rc.incrementNetwork()).toBe(true);
    expect(rc.incrementNetwork()).toBe(false);
  });

  it('incrementFs returns true within limit', () => {
    const rc = new ResourceCounter({ maxFsOperations: 1 });
    expect(rc.incrementFs()).toBe(true);
    expect(rc.incrementFs()).toBe(false);
  });

  it('getStats reflects increments', () => {
    const rc = new ResourceCounter();
    rc.incrementNetwork();
    rc.incrementNetwork();
    rc.incrementFs();
    expect(rc.getStats()).toEqual({ networkRequests: 2, fsOperations: 1 });
  });

  it('reset clears counters', () => {
    const rc = new ResourceCounter();
    rc.incrementNetwork();
    rc.incrementFs();
    rc.reset();
    expect(rc.getStats()).toEqual({ networkRequests: 0, fsOperations: 0 });
  });

  it('uses default limits when none provided', () => {
    const rc = new ResourceCounter();
    // Default maxNetworkRequests is 10
    for (let i = 0; i < 10; i++) {
      expect(rc.incrementNetwork()).toBe(true);
    }
    expect(rc.incrementNetwork()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildConsole
// ---------------------------------------------------------------------------
describe('buildConsole', () => {
  let logs: Array<{ level: string; message: string }>;
  let sandboxConsole: ReturnType<typeof buildConsole>;

  beforeEach(() => {
    logs = [];
    sandboxConsole = buildConsole((level, message) => {
      logs.push({ level, message });
    });
  });

  it('log maps to info level', () => {
    sandboxConsole.log('hello');
    expect(logs).toEqual([{ level: 'info', message: 'hello' }]);
  });

  it('info maps to info level', () => {
    sandboxConsole.info('test');
    expect(logs[0]!.level).toBe('info');
  });

  it('warn maps to warn level', () => {
    sandboxConsole.warn('warning');
    expect(logs[0]!.level).toBe('warn');
  });

  it('error maps to error level', () => {
    sandboxConsole.error('error');
    expect(logs[0]!.level).toBe('error');
  });

  it('debug maps to debug level', () => {
    sandboxConsole.debug('dbg');
    expect(logs[0]!.level).toBe('debug');
  });

  it('formats strings directly', () => {
    sandboxConsole.log('a', 'b', 'c');
    expect(logs[0]!.message).toBe('a b c');
  });

  it('formats objects as JSON', () => {
    sandboxConsole.log({ key: 'value' });
    expect(logs[0]!.message).toContain('"key"');
    expect(logs[0]!.message).toContain('"value"');
  });

  it('formats numbers as strings', () => {
    sandboxConsole.log(42);
    expect(logs[0]!.message).toBe('42');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    sandboxConsole.log(obj);
    // Should not throw, falls back to String()
    expect(logs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildCrypto
// ---------------------------------------------------------------------------
describe('buildCrypto', () => {
  it('returns undefined when not allowed', () => {
    expect(buildCrypto(false)).toBeUndefined();
  });

  it('returns crypto utilities when allowed', () => {
    const crypto = buildCrypto(true)!;
    expect(crypto).toBeDefined();
    expect(typeof crypto.randomUUID).toBe('function');
    expect(typeof crypto.randomBytes).toBe('function');
    expect(typeof crypto.sha256).toBe('function');
    expect(typeof crypto.sha512).toBe('function');
    expect(typeof crypto.md5).toBe('function');
  });

  it('randomUUID returns valid UUID', () => {
    const crypto = buildCrypto(true)!;
    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('randomBytes respects size limit', () => {
    const crypto = buildCrypto(true)!;
    expect(() => crypto.randomBytes(1025)).toThrow('exceeds limit');
    const bytes = crypto.randomBytes(16);
    expect(bytes).toHaveLength(16);
  });

  it('sha256 produces consistent hash', () => {
    const crypto = buildCrypto(true)!;
    const hash1 = crypto.sha256('hello');
    const hash2 = crypto.sha256('hello');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('sha512 produces 128-char hash', () => {
    const crypto = buildCrypto(true)!;
    expect(crypto.sha512('test')).toHaveLength(128);
  });

  it('md5 produces 32-char hash', () => {
    const crypto = buildCrypto(true)!;
    expect(crypto.md5('test')).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// buildTimers
// ---------------------------------------------------------------------------
describe('buildTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns undefined timers when not allowed', () => {
    const timers = buildTimers(false, () => {});
    expect(timers.setTimeout).toBeUndefined();
    expect(timers.setInterval).toBeUndefined();
    expect(timers.clearTimeout).toBeUndefined();
    expect(timers.clearInterval).toBeUndefined();
  });

  it('cleanup is always a function', () => {
    const timers = buildTimers(false, () => {});
    expect(typeof timers._cleanup).toBe('function');
    timers._cleanup(); // should not throw
  });

  it('setTimeout executes callback', () => {
    const timers = buildTimers(true, () => {});
    const fn = vi.fn();
    timers.setTimeout!(fn, 100);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalled();
    timers._cleanup();
  });

  it('setTimeout caps delay at 10000ms', () => {
    const timers = buildTimers(true, () => {});
    const fn = vi.fn();
    timers.setTimeout!(fn, 999999);
    vi.advanceTimersByTime(10000);
    expect(fn).toHaveBeenCalled();
    timers._cleanup();
  });

  it('setInterval enforces minimum 100ms delay', () => {
    const timers = buildTimers(true, () => {});
    const fn = vi.fn();
    timers.setInterval!(fn, 10); // should be bumped to 100
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    timers._cleanup();
  });

  it('clearTimeout cancels timeout', () => {
    const timers = buildTimers(true, () => {});
    const fn = vi.fn();
    const id = timers.setTimeout!(fn, 100);
    timers.clearTimeout!(id);
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    timers._cleanup();
  });

  it('clearInterval cancels interval', () => {
    const timers = buildTimers(true, () => {});
    const fn = vi.fn();
    const id = timers.setInterval!(fn, 200);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    timers.clearInterval!(id);
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
    timers._cleanup();
  });

  it('cleanup clears all timers', () => {
    const timers = buildTimers(true, () => {});
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    timers.setTimeout!(fn1, 500);
    timers.setInterval!(fn2, 200);
    timers._cleanup();
    vi.advanceTimersByTime(1000);
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// buildSandboxContext
// ---------------------------------------------------------------------------
describe('buildSandboxContext', () => {
  it('returns context and cleanup', () => {
    const result = buildSandboxContext();
    expect(result.context).toBeDefined();
    expect(typeof result.cleanup).toBe('function');
  });

  it('includes safe globals', () => {
    const { context } = buildSandboxContext();
    expect(context.JSON).toBe(JSON);
    expect(context.Math).toBe(Math);
    expect(context.Date).toBe(Date);
    expect(context.Array).toBe(Array);
    expect(context.Object).toBe(Object);
    expect(context.String).toBe(String);
    expect(context.Number).toBe(Number);
    expect(context.Boolean).toBe(Boolean);
    expect(context.RegExp).toBe(RegExp);
    expect(context.Map).toBe(Map);
    expect(context.Set).toBe(Set);
    expect(context.Promise).toBe(Promise);
  });

  it('includes string utilities', () => {
    const { context } = buildSandboxContext();
    expect(context.encodeURIComponent).toBe(encodeURIComponent);
    expect(context.decodeURIComponent).toBe(decodeURIComponent);
    expect(context.parseInt).toBe(parseInt);
    expect(context.parseFloat).toBe(parseFloat);
    expect(context.isNaN).toBe(isNaN);
    expect(context.isFinite).toBe(isFinite);
  });

  it('includes typed arrays', () => {
    const { context } = buildSandboxContext();
    expect(context.Uint8Array).toBe(Uint8Array);
    expect(context.ArrayBuffer).toBe(ArrayBuffer);
    expect(context.DataView).toBe(DataView);
  });

  it('includes text encoding', () => {
    const { context } = buildSandboxContext();
    expect(context.TextEncoder).toBe(TextEncoder);
    expect(context.TextDecoder).toBe(TextDecoder);
  });

  it('includes URL parsing', () => {
    const { context } = buildSandboxContext();
    expect(context.URL).toBe(URL);
    expect(context.URLSearchParams).toBe(URLSearchParams);
  });

  it('blocks dangerous globals as undefined', () => {
    const { context } = buildSandboxContext();
    expect(context.process).toBeUndefined();
    expect(context.require).toBeUndefined();
    expect(context.module).toBeUndefined();
    expect(context.exports).toBeUndefined();
    expect(context.__dirname).toBeUndefined();
    expect(context.__filename).toBeUndefined();
    expect(context.global).toBeUndefined();
    expect(context.globalThis).toBeUndefined();
    expect(context.eval).toBeUndefined();
    expect(context.Function).toBeUndefined();
    expect(context.Atomics).toBeUndefined();
    expect(context.SharedArrayBuffer).toBeUndefined();
  });

  it('makes dangerous globals non-writable', () => {
    const { context } = buildSandboxContext();
    const desc = Object.getOwnPropertyDescriptor(context, 'process');
    expect(desc?.writable).toBe(false);
    expect(desc?.configurable).toBe(false);
  });

  it('includes timers when permitted (default)', () => {
    // Default permissions have timers: true
    const { context } = buildSandboxContext();
    expect(context.setTimeout).toBeDefined();
    expect(context.setInterval).toBeDefined();
    expect(context.clearTimeout).toBeDefined();
    expect(context.clearInterval).toBeDefined();
  });

  it('excludes timers when not permitted', () => {
    const { context } = buildSandboxContext({ timers: false });
    expect(context.setTimeout).toBeUndefined();
    expect(context.setInterval).toBeUndefined();
  });

  it('includes crypto when permitted (default)', () => {
    const { context } = buildSandboxContext();
    expect(context.crypto).toBeDefined();
  });

  it('excludes crypto when not permitted', () => {
    const { context } = buildSandboxContext({ crypto: false });
    expect(context.crypto).toBeUndefined();
  });

  it('includes custom globals', () => {
    const { context } = buildSandboxContext({}, {}, { myVar: 42 });
    expect(context.myVar).toBe(42);
  });

  it('provides a console object', () => {
    const logs: string[] = [];
    const { context } = buildSandboxContext({}, {}, {}, (level, msg) => {
      logs.push(`${level}:${msg}`);
    });
    const c = context.console as { log: (...args: unknown[]) => void };
    c.log('hello');
    expect(logs).toEqual(['info:hello']);
  });

  it('cleanup does not throw', () => {
    const { cleanup } = buildSandboxContext();
    expect(() => cleanup()).not.toThrow();
  });
});
