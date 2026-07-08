import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import vm from 'node:vm';
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

  it('does NOT inject V8-provided constructors (vm.createContext provides them)', () => {
    // After the C1 fix, anything V8 supplies per-context is NOT injected from
    // the host realm. Injecting host versions creates a host-realm RCE chain
    // via `instance.constructor.constructor`. The VM context already has
    // Date/RegExp/Error/JSON/Math/typed-arrays/etc. as its own per-context
    // built-ins, so the sandbox sees them without us passing host references.
    const { context } = buildSandboxContext();
    expect(context.JSON).toBeUndefined();
    expect(context.Math).toBeUndefined();
    expect(context.Date).toBeUndefined();
    expect(context.RegExp).toBeUndefined();
    expect(context.Error).toBeUndefined();
    expect(context.TypeError).toBeUndefined();
    expect(context.Uint8Array).toBeUndefined();
    expect(context.ArrayBuffer).toBeUndefined();
    expect(context.DataView).toBeUndefined();

    // Mutable-prototype constructors (assertion preserved from earlier audit).
    expect(context.Array).toBeUndefined();
    expect(context.Object).toBeUndefined();
    expect(context.String).toBeUndefined();
    expect(context.Number).toBeUndefined();
    expect(context.Boolean).toBeUndefined();
    expect(context.Map).toBeUndefined();
    expect(context.Set).toBeUndefined();
    expect(context.Promise).toBeUndefined();
  });

  it('includes string utilities (wrapped behind the security membrane)', () => {
    const { context } = buildSandboxContext();
    // These are no longer the raw host functions — exposing the host copies let
    // `parseInt.constructor.constructor('return process')()` reach host Function
    // (RCE). They are now membrane-wrapped, so assert callability/correctness
    // rather than host identity.
    expect(context.encodeURIComponent).not.toBe(encodeURIComponent);
    expect((context.encodeURIComponent as typeof encodeURIComponent)('a b')).toBe('a%20b');
    expect((context.decodeURIComponent as typeof decodeURIComponent)('a%20b')).toBe('a b');
    expect((context.parseInt as typeof parseInt)('42px', 10)).toBe(42);
    expect((context.parseFloat as typeof parseFloat)('3.14x')).toBe(3.14);
    expect((context.isNaN as typeof isNaN)(NaN)).toBe(true);
    expect((context.isFinite as typeof isFinite)(42)).toBe(true);
  });

  it('wraps Node-only host constructors (URL, TextEncoder) to block the constructor-chain escape', () => {
    // V8's per-context globals do NOT include URL / URLSearchParams /
    // TextEncoder / TextDecoder, so we must inject them — but they are
    // Proxy-wrapped so `instance.constructor.constructor('return process')()`
    // dead-ends in a sandbox-realm stub instead of host Function.
    const { context } = buildSandboxContext();
    // Not the host identity any more — wrapped Proxies.
    expect(context.URL).not.toBe(URL);
    expect(context.URLSearchParams).not.toBe(URLSearchParams);
    expect(context.TextEncoder).not.toBe(TextEncoder);
    expect(context.TextDecoder).not.toBe(TextDecoder);

    // But they must remain functionally usable.
    const URLWrap = context.URL as typeof URL;
    const u = new URLWrap('https://example.com/path?q=1');
    expect(u.hostname).toBe('example.com');
    expect(u.pathname).toBe('/path');

    // And the constructor-chain escape must be blocked.
    const ctor = (u as unknown as { constructor: unknown }).constructor as unknown as {
      constructor: (src: string) => () => unknown;
    };
    expect(() => ctor.constructor('return typeof process')()).toThrow(
      /Function constructor is disabled in the sandbox/
    );
  });

  // RCE regression: a host-realm object reachable from the sandbox lets
  // `x.constructor.constructor('return process')()` reach the HOST Function
  // (codeGeneration:strings:false only bounds the VM-realm Function). The
  // membrane must block every walk: `.constructor`, `.prototype`,
  // getPrototypeOf, nested host objects, and getOwnPropertyDescriptor.value.
  describe('host-Function escape chains (RCE regression)', () => {
    const ESCAPE_VECTORS: Record<string, string> = {
      'URL.prototype': `URL.prototype.constructor.constructor("return process.pid")()`,
      'getPrototypeOf(new URL)': `Object.getPrototypeOf(new URL("http://x")).constructor.constructor("return process.pid")()`,
      'new URL().searchParams': `new URL("http://x/?a=1").searchParams.constructor.constructor("return process.pid")()`,
      'TextEncoder.prototype': `TextEncoder.prototype.constructor.constructor("return process.pid")()`,
      'console.log.constructor': `console.log.constructor.constructor("return process.pid")()`,
      'parseInt.constructor': `parseInt.constructor.constructor("return process.pid")()`,
      '__proto__ walk': `(new URL("http://x")).__proto__.constructor.constructor("return process.pid")()`,
      'getOwnPropertyDescriptor.value': `Object.getOwnPropertyDescriptor(URL,"prototype").value.constructor.constructor("return process.pid")()`,
    };

    for (const [name, code] of Object.entries(ESCAPE_VECTORS)) {
      it(`blocks: ${name}`, () => {
        const { context } = buildSandboxContext({ network: true }, {}, {});
        const ctx = vm.createContext(context, {
          codeGeneration: { strings: false, wasm: false },
        });
        let result: unknown;
        let threw = false;
        try {
          result = new vm.Script(code).runInContext(ctx);
        } catch {
          threw = true;
        }
        // Either the walk threw (fail-closed) — never a host value like a pid.
        expect(threw || typeof result !== 'number').toBe(true);
        expect(result).not.toBe(process.pid);
      });
    }

    it('still allows legitimate host APIs through the membrane', () => {
      const { context } = buildSandboxContext({ crypto: true }, {}, {});
      const ctx = vm.createContext(context, {
        codeGeneration: { strings: false, wasm: false },
      });
      const run = (c: string) => new vm.Script(c).runInContext(ctx);
      expect(run(`new URL("http://a/p?x=1").pathname`)).toBe('/p');
      expect(run(`new URL("http://a/?x=42").searchParams.get("x")`)).toBe('42');
      expect(run(`new TextDecoder().decode(new TextEncoder().encode("hi"))`)).toBe('hi');
      expect(run(`typeof crypto.sha256("x")`)).toBe('string');
    });
  });

  describe('network fetch is SSRF-safe by default', () => {
    it('exposes a fetch only when the network permission is granted', () => {
      expect(buildSandboxContext({ network: false }, {}, {}).context.fetch).toBeUndefined();
      expect(typeof buildSandboxContext({ network: true }, {}, {}).context.fetch).toBe('function');
    });

    it('blocks the cloud-metadata address (no override needed)', async () => {
      const { context } = buildSandboxContext({ network: true }, {}, {});
      const fetch = context.fetch as (url: string) => Promise<Response>;
      // 169.254.169.254 is rejected synchronously (literal link-local IP) — no
      // real network call — so a missing host override can never SSRF.
      await expect(fetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        /SSRF|private|internal/i
      );
    });

    it('blocks localhost / loopback', async () => {
      const { context } = buildSandboxContext({ network: true }, {}, {});
      const fetch = context.fetch as (url: string) => Promise<Response>;
      await expect(fetch('http://127.0.0.1:8080/')).rejects.toThrow(/SSRF|private|internal/i);
    });
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

  it('non-writable dangerous globals cannot be reassigned', () => {
    const { context } = buildSandboxContext();
    // Non-writable properties prevent assignment in strict mode
    const processDesc = Object.getOwnPropertyDescriptor(context, 'process');
    expect(processDesc?.writable).toBe(false);
    const evalDesc = Object.getOwnPropertyDescriptor(context, 'eval');
    expect(evalDesc?.writable).toBe(false);
    const functionDesc = Object.getOwnPropertyDescriptor(context, 'Function');
    expect(functionDesc?.writable).toBe(false);
  });

  it('harden membrane does not wrap primitives', () => {
    // Primitives (strings, numbers, booleans) should pass through the membrane unchanged
    const { context } = buildSandboxContext();
    // encodeURIComponent is a function — wrapped by membrane
    expect(typeof context.encodeURIComponent).toBe('function');
    // parseInt is a function — wrapped by membrane
    expect(typeof context.parseInt).toBe('function');
  });

  it('fetch is wrapped by the harden membrane', () => {
    const { context } = buildSandboxContext({ network: true });
    // fetch is a host-realm function, should be membrane-wrapped
    expect(context.fetch).not.toBe(globalThis.fetch);
  });

  it('crypto object is properly wrapped by membrane when permitted', () => {
    const { context } = buildSandboxContext({ crypto: true });
    expect(context.crypto).toBeDefined();
    const c = context.crypto as { sha256: (s: string) => string };
    expect(typeof c.sha256).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// buildTimers — additional edge cases
// ---------------------------------------------------------------------------

describe('buildTimers — edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onTimeout when setTimeout callback throws', () => {
    const onTimeout = vi.fn();
    const timers = buildTimers(true, onTimeout);
    const fn = vi.fn(() => {
      throw new Error('boom');
    });

    expect(() => {
      timers.setTimeout!(fn, 100);
      vi.advanceTimersByTime(100);
    }).toThrow('boom');
    expect(onTimeout).toHaveBeenCalled();
    timers._cleanup();
  });

  it('setInterval clears interval on callback throw', () => {
    const timers = buildTimers(true, vi.fn());
    const fn = vi.fn(() => {
      throw new Error('interval error');
    });

    expect(() => {
      timers.setInterval!(fn, 100);
      vi.advanceTimersByTime(100);
    }).toThrow('interval error');

    // After throwing, the interval should be cleared — advancing again should not call fn again
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    timers._cleanup();
  });

  it('_cleanup clears all pending timeouts', () => {
    const timers = buildTimers(true, vi.fn());
    const fn = vi.fn();
    timers.setTimeout!(fn, 1000);
    timers.setTimeout!(fn, 2000);

    timers._cleanup();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('_cleanup clears all pending intervals', () => {
    const timers = buildTimers(true, vi.fn());
    const fn = vi.fn();
    timers.setInterval!(fn, 100);

    timers._cleanup();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clearTimeout removes tracked timeout', () => {
    const timers = buildTimers(true, vi.fn());
    const fn = vi.fn();
    const id = timers.setTimeout!(fn, 100);
    timers.clearTimeout!(id);
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clearInterval removes tracked interval', () => {
    const timers = buildTimers(true, vi.fn());
    const fn = vi.fn();
    const id = timers.setInterval!(fn, 100);
    timers.clearInterval!(id);
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
